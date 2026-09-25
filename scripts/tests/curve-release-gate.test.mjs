import { describe, expect, it } from 'vitest';
import { auditCurveRelease } from '../lib/curve-release-gate.mjs';

const curve = { 0: 100, 12: 80, 24: 65, 60: 35, _floor: 5, _half_life_months: 45 };
const base = {
  metadata: { version: '4.9' },
  '保值率曲线': { Mac_mini: curve },
  '首发价目录': { records: {} },
  '二手价格观测': { records: [] },
  '保值率校准清单': { records: [] },
  '实时市场价快照': { Mac_mini: { item: { 官方价: 4499 } } },
};

describe('曲线发布门禁', () => {
  it('仅市场快照变化时走快速路径但仍执行结构检查', () => {
    const current = structuredClone(base);
    const baseline = structuredClone(base);
    current['实时市场价快照'].Mac_mini.item.官方价 = 4399;
    const result = auditCurveRelease(current, baseline);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('market_snapshot_fast_path');
    expect(result.changed_categories).toEqual([]);
  });

  it('快速路径仍拒绝非法可校准观测', () => {
    const current = structuredClone(base);
    current['二手价格观测'].records.push({
      id: 'bad', calibration_eligible: true, observed_price: 1000, price_type: 'listing',
      condition: 'good', confidence: 'high', event_state: 'normal', sample_size: 1,
    });
    const result = auditCurveRelease(current, structuredClone(base));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('launch_price_missing');
  });

  it('曲线变化但 manifest 缺失时失败', () => {
    const current = structuredClone(base);
    current['保值率曲线'].Mac_mini[24] = 60;
    const result = auditCurveRelease(current, structuredClone(base));
    expect(result.ok).toBe(false);
    expect(result.mode).toBe('full_curve_validation');
    expect(result.errors).toContain('Mac_mini: curve changed but matching calibration manifest is missing');
  });

  it('完整 manifest 与目标曲线一致时通过', () => {
    const baseline = structuredClone(base);
    const current = structuredClone(base);
    current['保值率曲线'].Mac_mini[24] = 60;
    current['保值率校准清单'].records.push({
      id: 'mac-mini-4.9', category: 'Mac_mini', target_constants_version: '4.9',
      status: 'provisional', generated_at: '2026-09-25T00:00:00.000Z', script_version: '1.0.0',
      input_observation_ids: [], excluded_observations: [], fit_parameters: { method: 'rollback' },
      metrics: { training_weighted_mae: null, training_weighted_mape: null, validation_method: 'not_applicable', validation_weighted_mae: null, validation_weighted_mape: null },
      old_curve: baseline['保值率曲线'].Mac_mini,
      new_curve: current['保值率曲线'].Mac_mini,
      coverage: { generation_count: 0, observation_count: 0, age_span_days: 0 },
    });
    const result = auditCurveRelease(current, baseline);
    expect(result.ok).toBe(true);
    expect(result.changed_categories).toEqual(['Mac_mini']);
  });
});
