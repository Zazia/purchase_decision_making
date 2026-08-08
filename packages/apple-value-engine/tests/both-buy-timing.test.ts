/**
 * v3.8 测试: buyTiming='both' 同时生成新品+二手候选
 *
 * 验证: 当 buyTiming='both' 时, 前沿/被支配集合中同时包含
 * buyTiming='new' 和 buyTiming='used' 的方案点。
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

describe('buyTiming=both', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('同时生成新品与二手候选 (Mac_mini)', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 10000,
      holdingYears: [2, 3, 4],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: false, // 排除 B/C 候选干扰
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const hasNew = allPoints.some((p) => p.buyTiming === 'new');
    const hasUsed = allPoints.some((p) => p.buyTiming === 'used');
    expect(hasNew).toBe(true);
    expect(hasUsed).toBe(true);
  });

  it('both 候选数量 ≥ 仅新品 + 仅二手', () => {
    const base = {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2, 3] as number[],
      performanceFloor: 0,
      considerWait: false,
    };
    const rBoth = computeParetoFrontier(constants, { ...base, buyTiming: 'both' });
    const rNew = computeParetoFrontier(constants, { ...base, buyTiming: 'new' });
    const rUsed = computeParetoFrontier(constants, { ...base, buyTiming: 'used' });
    const countBoth = rBoth.frontier.length + rBoth.dominated.length;
    const countNew = rNew.frontier.length + rNew.dominated.length;
    const countUsed = rUsed.frontier.length + rUsed.dominated.length;
    expect(countBoth).toBeGreaterThanOrEqual(countNew + countUsed);
  });

  it('iPhone_Pro both 同时包含新品与二手', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 20000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: false,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const hasNew = allPoints.some((p) => p.buyTiming === 'new');
    const hasUsed = allPoints.some((p) => p.buyTiming === 'used');
    expect(hasNew).toBe(true);
    expect(hasUsed).toBe(true);
  });
});
