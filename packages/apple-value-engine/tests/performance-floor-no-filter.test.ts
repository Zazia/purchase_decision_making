/**
 * v3.8 测试: 性能地板不再过滤前沿候选
 *
 * 验证: performanceFloor=0.7 时, 低于 0.7 的候选仍出现在 frontier 中;
 * performanceFloor 仅影响推荐区间标注, 不改变前沿本身。
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

describe('performance-floor-no-filter', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('performanceFloor=0.7 时前沿仍包含 avgPerformance < 0.7 的点', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2, 3, 4, 5],
      buyTiming: 'used',
      performanceFloor: 0.7,
      considerWait: false,
    });
    // 前沿中应存在低于性能地板的点 (Mac_mini 二手旧款性能多低于 0.7)
    const belowFloor = result.frontier.filter((p) => p.avgPerformance < 0.7);
    expect(belowFloor.length).toBeGreaterThan(0);
  });

  it('performanceFloor=0 与 performanceFloor=0.7 生成相同的前沿', () => {
    const base = {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2, 3, 4],
      buyTiming: 'used' as const,
      considerWait: false,
    };
    const r0 = computeParetoFrontier(constants, { ...base, performanceFloor: 0 });
    const r07 = computeParetoFrontier(constants, { ...base, performanceFloor: 0.7 });
    // 前沿点数相同 (性能地板不过滤前沿)
    expect(r0.frontier.length).toBe(r07.frontier.length);
    expect(r0.dominated.length).toBe(r07.dominated.length);
    // 前沿点一一对应 (相同 monthlyCost + avgPerformance)
    for (let i = 0; i < r0.frontier.length; i++) {
      expect(r0.frontier[i].monthlyCost).toBe(r07.frontier[i].monthlyCost);
      expect(r0.frontier[i].avgPerformance).toBe(r07.frontier[i].avgPerformance);
    }
  });

  it('推荐区间仅受预算约束, 不受性能地板约束', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 4000,
      holdingYears: [2, 3, 4],
      buyTiming: 'used',
      performanceFloor: 0.99, // 极高地板
      considerWait: false,
    });
    // 推荐区间内可能存在 avgPerformance < 0.99 的方案 (仅受 budget 过滤)
    for (const p of result.recommendationRange.plans) {
      expect(p.buyPrice).toBeLessThanOrEqual(4000);
    }
    // 若推荐区间非空, 应存在低于 0.99 的方案 (Mac_mini 二手性能远低于 0.99)
    if (result.recommendationRange.plans.length > 0) {
      const below = result.recommendationRange.plans.filter((p) => p.avgPerformance < 0.99);
      expect(below.length).toBeGreaterThan(0);
    }
  });
});
