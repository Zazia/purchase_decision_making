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

const V45 = {
  0: 100,
  3: 90,
  6: 82,
  12: 80,
  18: 72,
  24: 65,
  36: 52,
  48: 46,
  60: 35,
} as const;

const SAMPLES = [
  { age: 23, rate: 3850 / 6999 * 100 },
  { age: 44, rate: 3500 / 6999 * 100 },
  { age: 44, rate: 3200 / 6999 * 100 },
  { age: 44, rate: 2800 / 6999 * 100 },
  { age: 44, rate: 2300 / 6999 * 100 },
  { age: 69, rate: 3500 / 6999 * 100 },
  { age: 69, rate: 2650 / 6999 * 100 },
  { age: 69, rate: 2500 / 6999 * 100 },
  { age: 69, rate: 2244 / 6999 * 100 },
];

function interpolateV45(age: number): number {
  const knots = Object.keys(V45).map(Number).sort((a, b) => a - b);
  if (age > 60) {
    return 5 + (V45[60] - 5) * Math.pow(0.5, (age - 60) / 45);
  }
  for (let index = 1; index < knots.length; index += 1) {
    const right = knots[index];
    if (age <= right) {
      const left = knots[index - 1];
      const leftRate = V45[left as keyof typeof V45];
      const rightRate = V45[right as keyof typeof V45];
      return leftRate + (rightRate - leftRate) * (age - left) / (right - left);
    }
  }
  return V45[60];
}

describe('Mac mini v4.8 残值曲线校准', () => {
  it('固定校准节点并保持曲线单调不增', () => {
    const expected = new Map([
      [0, 100], [3, 90], [6, 82], [12, 80], [18, 68],
      [24, 55], [36, 47], [48, 41], [60, 35],
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

  it('关键机龄贴合长期稳定的 M4/M2 中枢', () => {
    const month23 = getRetentionRate(constants.retentionCurves, 'Mac_mini', 23);
    const month44 = getRetentionRate(constants.retentionCurves, 'Mac_mini', 44);
    expect(month23).toBeCloseTo(57.1667, 3);
    expect(month44).toBeCloseTo(43, 8);
    expect(Math.abs(3850 / 6999 * 100 - month23)).toBeLessThan(3);
  });

  it('九个实测点 MAE 优于 v4.5 基线', () => {
    const oldMae = SAMPLES.reduce((sum, sample) => sum + Math.abs(sample.rate - interpolateV45(sample.age)), 0) / SAMPLES.length;
    const newMae = SAMPLES.reduce((sum, sample) => {
      const predicted = getRetentionRate(constants.retentionCurves, 'Mac_mini', sample.age);
      return sum + Math.abs(sample.rate - predicted);
    }, 0) / SAMPLES.length;
    expect(oldMae).toBeCloseTo(7.75, 1);
    expect(newMae).toBeLessThan(oldMae);
    expect(newMae).toBeLessThan(6.25);
  });

  it('60月节点与69月指数外推保持不变', () => {
    expect(getRetentionRate(constants.retentionCurves, 'Mac_mini', 60)).toBeCloseTo(35, 8);
    expect(getRetentionRate(constants.retentionCurves, 'Mac_mini', 69)).toBeCloseTo(31.12, 2);
  });
});
