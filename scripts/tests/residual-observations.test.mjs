import { describe, expect, it } from 'vitest';
import { normalizeObservation, sameConfiguration } from '../lib/residual-observations.mjs';

const launch = {
  id: 'cn_mac-mini_m4_16_512',
  category: 'Mac_mini',
  generation: 'M4',
  model_key: 'M4_16G_512G',
  configuration: { size: null, chip_tier: 'base', memory_gb: 16, storage_gb: 512 },
  region: 'CN',
  currency: 'CNY',
  release_date: '2024-10-29',
  launch_msrp: 5999,
  price_kind: 'launch_msrp',
  source_url: 'https://www.apple.com.cn/newsroom/',
  verification_status: 'verified',
};
const catalog = { [launch.id]: launch };
const base = {
  id: 'obs-1',
  category: 'Mac_mini',
  generation: 'M4',
  model_key: 'M4_16G_512G',
  configuration: { size: null, chip_tier: 'base', memory_gb: 16, storage_gb: 512 },
  region: 'CN',
  currency: 'CNY',
  observed_at: '2026-09-08',
  observed_price: 3850,
  price_type: 'transaction',
  condition: 'good',
  sample_size: 3,
  source_url: 'https://example.test/source',
  confidence: 'high',
  event_state: 'normal',
  launch_price_id: launch.id,
  calibration_eligible: true,
};

describe('残值观测归一化', () => {
  it('只对同地区同配置首发价做精确匹配', () => {
    expect(sameConfiguration(base, launch)).toBe(true);
    const row = normalizeObservation(base, catalog);
    expect(row.calibration_eligible).toBe(true);
    expect(row.retention_observed).toBeCloseTo(3850 / 5999, 8);
  });

  it('CTO 首发价缺失时保留观测但禁止校准', () => {
    const row = normalizeObservation({
      ...base,
      id: 'cto',
      model_key: 'M4_32G_2TB',
      configuration: { ...base.configuration, memory_gb: 32, storage_gb: 2048 },
      launch_price_id: null,
      calibration_eligible: false,
    }, catalog);
    expect(row.retention_observed).toBeNull();
    expect(row.calibration_eligible).toBe(false);
    expect(row.exclusion_reasons).toContain('launch_price_missing');
  });

  it.each([
    ['region', { region: 'US' }, 'region_mismatch'],
    ['currency', { currency: 'USD' }, 'currency_mismatch'],
  ])('拒绝跨%s匹配', (_label, patch, reason) => {
    const row = normalizeObservation({ ...base, ...patch }, catalog);
    expect(row.retention_observed).toBeNull();
    expect(row.calibration_eligible).toBe(false);
    expect(row.exclusion_reasons).toContain(reason);
  });

  it('补贴实付与官方首发价分别计算，不互相替代', () => {
    const row = normalizeObservation({
      ...base,
      current_new_same_tier_price: 6999,
      actual_paid_price: 3699,
    }, catalog);
    expect(row.retention_observed).toBeCloseTo(3850 / 5999, 8);
    expect(row.replacement_value_ratio).toBeCloseTo(3850 / 6999, 8);
    expect(row.owner_value_ratio).toBeCloseTo(3850 / 3699, 8);
  });

  it('备注文本中的数字永远不会成为分母', () => {
    const row = normalizeObservation({
      ...base,
      launch_price_id: null,
      calibration_eligible: false,
      notes: '残值分母 6999 元',
    }, catalog);
    expect(row.launch_msrp).toBeNull();
    expect(row.retention_observed).toBeNull();
  });
});
