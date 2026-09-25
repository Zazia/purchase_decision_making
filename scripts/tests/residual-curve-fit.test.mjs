import { describe, expect, it } from 'vitest';
import { fitResidualCurve, prepareCalibrationSamples } from '../lib/residual-curve-fit.mjs';

const baseline = { 0: 100, 12: 82, 24: 68, 36: 55, 48: 45, 60: 36, _floor: 5, _half_life_months: 30 };
const sample = (id, generation, age, retention, extra = {}) => ({
  observation_id: id,
  generation,
  observed_at: extra.observed_at ?? `202${generation}-01-01`,
  age_months: age,
  retention,
  weight: extra.weight ?? 1,
  price_type: extra.price_type ?? 'transaction',
  confidence: 'high',
});

describe('单调约束残值曲线拟合', () => {
  it('固定 R(0)=100、节点单调不增且不低于 floor', () => {
    const fit = fitResidualCurve([
      sample('a', '1', 12, 0.84), sample('b', '1', 24, 0.66), sample('c', '1', 36, 0.58),
      sample('d', '2', 12, 0.8), sample('e', '2', 24, 0.7), sample('f', '2', 36, 0.5),
    ], baseline);
    const values = Object.entries(fit.curve).filter(([key]) => /^\d+$/.test(key)).map(([, value]) => value);
    expect(fit.curve[0]).toBeCloseTo(100, 8);
    for (let index = 1; index < values.length; index += 1) expect(values[index]).toBeLessThanOrEqual(values[index - 1]);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(5);
    expect([0, 0.1, 1, 10]).toContain(fit.lambda);
  });

  it('单一代际异常低点在留一代验证中不会自动取得发布资格', () => {
    const fit = fitResidualCurve([
      sample('a', '1', 24, 0.7), sample('b', '1', 36, 0.58),
      sample('c', '2', 24, 0.35), sample('d', '2', 36, 0.52),
    ], baseline);
    expect(fit.validation_metrics.method).toBe('leave_one_generation_out');
    expect(fit.validation_metrics.weighted_mae).toBeGreaterThan(5);
  });

  it('无成交/实付样本时即使拟合误差低也不可发布', () => {
    const fit = fitResidualCurve([
      sample('a', '1', 12, 0.82, { price_type: 'listing' }),
      sample('b', '1', 24, 0.68, { price_type: 'listing' }),
      sample('c', '2', 36, 0.55, { price_type: 'reference' }),
    ], baseline);
    expect(fit.training_metrics.weighted_mae).toBeLessThan(1);
    expect(fit.publishable).toBe(false);
    expect(fit.gaps).toContain('no_transaction_or_verified_paid_observation');
  });

  it('事件样本、错误分母和无配对高配不会进入训练', () => {
    const launch = {
      id: 'lp', category: 'Mac_mini', generation: 'M4', model_key: 'M4_16G_256G',
      configuration: { size: null, chip_tier: 'base', memory_gb: 16, storage_gb: 256 },
      region: 'CN', currency: 'CNY', release_date: '2024-10-29', launch_msrp: 4499,
      price_kind: 'launch_msrp', source_url: 'https://apple.test', verification_status: 'verified',
    };
    const observation = (id, patch = {}) => ({
      id, category: 'Mac_mini', generation: 'M4', model_key: 'M4_16G_256G',
      configuration: { ...launch.configuration }, region: 'CN', currency: 'CNY', observed_at: '2025-10-29',
      observed_price: 3000, price_type: 'transaction', condition: 'good', sample_size: 3,
      source_url: 'https://example.test', confidence: 'high', event_state: 'normal',
      launch_price_id: 'lp', calibration_eligible: true, ...patch,
    });
    const constants = {
      '首发价目录': { records: { lp: launch } },
      '二手价格观测': { records: [
        observation('good'),
        observation('event', { event_state: 'launch_window', calibration_eligible: false }),
        observation('wrong-currency', { currency: 'USD', calibration_eligible: false }),
      ] },
    };
    const prepared = prepareCalibrationSamples(constants, 'Mac_mini');
    expect(prepared.accepted.map((item) => item.observation_id)).toEqual(['good']);
    expect(prepared.excluded.find((item) => item.observation_id === 'event')?.reasons).toContain('event_state_excluded');
    expect(prepared.excluded.find((item) => item.observation_id === 'wrong-currency')?.reasons).toContain('currency_mismatch');
  });
});
