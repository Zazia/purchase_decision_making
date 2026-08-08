/**
 * v3.8 测试: 多持有年数生成对应倍数候选点
 *
 * 验证: holdingYears=[2,3,4,5] 生成的总点数 ≈ 4 × holdingYears=[2] 的点数
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, computeParetoFrontier } from '../src/index.js';
import type { Constants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

describe('multi-holding-years', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('[2,3,4,5] 总点数 = 4 × [2] 的点数 (Mac_mini 二手)', () => {
    const base = {
      category: 'mac-mini',
      budget: 100000, // 高预算避免推荐区间过滤影响计数
      performanceFloor: 0,
      buyTiming: 'used' as const,
      considerWait: false,
    };
    const r1 = computeParetoFrontier(constants, { ...base, holdingYears: [2] });
    const r4 = computeParetoFrontier(constants, { ...base, holdingYears: [2, 3, 4, 5] });
    const count1 = r1.frontier.length + r1.dominated.length;
    const count4 = r4.frontier.length + r4.dominated.length;
    expect(count1).toBeGreaterThan(0);
    expect(count4).toBe(count1 * 4);
  });

  it('不同持有年数的方案点 holdingYears 字段正确', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2, 3, 4, 5],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const yearsSet = new Set(allPoints.map((p) => p.holdingYears));
    expect(yearsSet.has(2)).toBe(true);
    expect(yearsSet.has(3)).toBe(true);
    expect(yearsSet.has(4)).toBe(true);
    expect(yearsSet.has(5)).toBe(true);
  });

  it('[2,3] vs [3,2] 顺序不影响结果', () => {
    const base = {
      category: 'mac-mini',
      budget: 100000,
      performanceFloor: 0,
      buyTiming: 'used' as const,
      considerWait: false,
    };
    const r1 = computeParetoFrontier(constants, { ...base, holdingYears: [2, 3] });
    const r2 = computeParetoFrontier(constants, { ...base, holdingYears: [3, 2] });
    const c1 = r1.frontier.length + r1.dominated.length;
    const c2 = r2.frontier.length + r2.dominated.length;
    expect(c1).toBe(c2);
  });
});
