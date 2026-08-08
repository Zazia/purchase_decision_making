/**
 * v3.8 测试: 冲击时变因子查表
 *
 * 验证 lookupImpactTimeVaryingFactor 按「距新品发布的月数」返回正确的时段因子:
 *   1月内 / 3月内 / 6月内 / 12月内 / 12月后
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, lookupImpactTimeVaryingFactor } from '../src/index.js';
import type { Constants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

describe('lookupImpactTimeVaryingFactor', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('0月 → 1月内: 残值因子最大, 买入价下降因子最大', () => {
    const f = lookupImpactTimeVaryingFactor(constants, 0);
    expect(f.residualFactor).toBeGreaterThan(0.8);
    expect(f.buyPriceDropFactor).toBeGreaterThan(0.8);
  });

  it('1月 → 1月内', () => {
    const f = lookupImpactTimeVaryingFactor(constants, 1);
    const f0 = lookupImpactTimeVaryingFactor(constants, 0);
    // 1月和0月都属「1月内」, 因子相同
    expect(f.residualFactor).toBe(f0.residualFactor);
    expect(f.buyPriceDropFactor).toBe(f0.buyPriceDropFactor);
  });

  it('2月 → 3月内: 残值因子下降', () => {
    const f1 = lookupImpactTimeVaryingFactor(constants, 1);
    const f3 = lookupImpactTimeVaryingFactor(constants, 2);
    // 3月内残值因子 < 1月内
    expect(f3.residualFactor).toBeLessThan(f1.residualFactor);
  });

  it('4月 → 6月内: 残值因子继续下降', () => {
    const f3 = lookupImpactTimeVaryingFactor(constants, 3);
    const f6 = lookupImpactTimeVaryingFactor(constants, 4);
    expect(f6.residualFactor).toBeLessThan(f3.residualFactor);
  });

  it('7月 → 12月内', () => {
    const f6 = lookupImpactTimeVaryingFactor(constants, 6);
    const f12 = lookupImpactTimeVaryingFactor(constants, 7);
    expect(f12.residualFactor).toBeLessThan(f6.residualFactor);
  });

  it('13月 → 12月后: 残值因子最小', () => {
    const f12 = lookupImpactTimeVaryingFactor(constants, 12);
    const fAfter = lookupImpactTimeVaryingFactor(constants, 13);
    expect(fAfter.residualFactor).toBeLessThan(f12.residualFactor);
    expect(fAfter.residualFactor).toBeLessThanOrEqual(0.15);
  });

  it('因子单调递减: 残值因子随月数增加而减小', () => {
    const months = [0, 2, 4, 7, 13];
    const factors = months.map((m) => lookupImpactTimeVaryingFactor(constants, m).residualFactor);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeLessThanOrEqual(factors[i - 1]);
    }
  });

  it('买入价下降因子单调递减', () => {
    const months = [0, 2, 4, 7, 13];
    const factors = months.map((m) => lookupImpactTimeVaryingFactor(constants, m).buyPriceDropFactor);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeLessThanOrEqual(factors[i - 1]);
    }
  });
});
