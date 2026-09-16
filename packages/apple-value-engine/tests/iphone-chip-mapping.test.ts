import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadConstants, computeParetoFrontier, computePerformance } from '../src/index.js';

const base = loadConstants(readFileSync(new URL('../../../.agents/skills/apple-value-analysis/constants.json', import.meta.url), 'utf8'));

describe('iPhone 快照候选芯片与性能', () => {
  it.each([
    ['iPhone_14_ProMax', 'A16'],
    ['iPhone_15_ProMax', 'A17_Pro'],
    ['iPhone_16_ProMax', 'A18_Pro'],
    ['iPhone_17_ProMax', 'A19_Pro'],
    ['iPhone_18_ProMax', 'A20_Pro'],
    ['iPhone_Duo', 'A20_Pro'],
    ['iPhone_17', 'A19'],
    ['iPhone_18', 'A20'],
  ])('%s 使用 %s 跑分', (model, chip) => {
    const constants = structuredClone(base);
    // 只固定报价，避免未来快照删除旧款或 Duo 尚无快照造成空跑。
    const modelKey = `${model}_256G_新品`;
    constants.marketSnapshots.iPhone_ProMax = { [modelKey]: { 官方价: 10000 } };
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_ProMax', budget: 30000, holdingYears: [2],
      buyTiming: 'new', performanceFloor: 0, considerWait: false,
    });
    const points = [...result.frontier, ...result.dominated];
    expect(points).toHaveLength(1);
    expect(points[0].chip).toBe(chip);
    const expected = computePerformance(constants, chip, 6, 256, 'iPhone_ProMax', 24);
    expect(points[0].performanceS0).toBeCloseTo(expected.s0, 10);
    expect(points[0].avgPerformance).toBeCloseTo(expected.avgS, 10);
  });
});
