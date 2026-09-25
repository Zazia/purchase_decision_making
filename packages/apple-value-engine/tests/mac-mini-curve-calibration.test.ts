import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRetentionRate, loadConstants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const constantsText = readFileSync(
  join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json'),
  'utf8',
);
const constants = loadConstants(constantsText);

describe('Mac mini v4.9 临时风险控制基线', () => {
  it('恢复 v4.5 中期节点并保持曲线单调不增', () => {
    const expected = new Map([
      [0, 100], [3, 90], [6, 82], [12, 80], [18, 72],
      [24, 65], [36, 52], [48, 46], [60, 35],
    ]);
    const rates = [...expected].map(([month, rate]) => {
      const actual = getRetentionRate(constants.retentionCurves, 'Mac_mini', month);
      expect(actual).toBeCloseTo(rate, 8);
      return actual;
    });
    for (let index = 1; index < rates.length; index += 1) {
      expect(rates[index]).toBeLessThanOrEqual(rates[index - 1]);
    }
  });

  it('明确标记 provisional/unverified 且保留 v4.8 失效原因', () => {
    const raw = JSON.parse(constantsText) as Record<string, any>;
    const curve = raw['保值率曲线'].Mac_mini;
    expect(curve['_临时基线_v4.9']['_状态']).toBe('provisional/unverified');
    expect(curve['_无效校准_v4.8']['_状态']).toBe('invalid_calibration_applied');
    expect(curve['_无效校准_v4.8']['_失效原因_v4.9']).toContain('同型号同配置首发官方价');
    const manifest = raw['保值率校准清单'].records.find((item: any) => item.id === 'mac-mini-v4.9-provisional-rollback');
    expect(manifest.status).toBe('provisional_unverified');
    expect(manifest.input_observation_ids).toEqual([]);
    expect(manifest.metrics.training_weighted_mae).toBeNull();
  });

  it('60月节点与69月指数外推保持不变', () => {
    expect(getRetentionRate(constants.retentionCurves, 'Mac_mini', 60)).toBeCloseTo(35, 8);
    expect(getRetentionRate(constants.retentionCurves, 'Mac_mini', 69)).toBeCloseTo(31.12, 2);
  });
});
