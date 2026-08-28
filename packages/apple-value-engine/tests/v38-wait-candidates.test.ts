/**
 * v3.8 测试: 类型 B/C 等新品候选自动生成
 *
 * 验证:
 * - 距发布 ≤ 90 天 且 confidence != 'low' 时自动生成 B/C 候选
 * - releaseConfidence='low' 时跳过 B/C 候选
 * - considerWait=false 时跳过 B/C 候选
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, computeParetoFrontier, parseReleasePlan, shouldGenerateWaitCandidates } from '../src/index.js';
import type { Constants, MacroContext } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

describe('v3.8 wait candidates', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  // 默认宏观状态: 无宏观事件, analysisMonth 取 constants.lastUpdated
  const defaultMacro: MacroContext = {
    storageSuperCycleStage: 'none',
    hasGlobalPriceHike: false,
    analysisMonth: '2026-08',
  };

  it('iPhone_Pro 距 2026-09 发布 ≤ 90 天, confidence=高 → shouldGenerate=true', () => {
    const plan = parseReleasePlan(constants, 'iPhone_Pro', defaultMacro);
    expect(plan).not.toBeNull();
    expect(plan!.releaseConfidence).toBe('high');
    expect(plan!.nextReleaseMonth).toBe('2026-09');
    expect(shouldGenerateWaitCandidates(plan!, defaultMacro)).toBe(true);
  });

  it('iPhone_Pro 自动生成类型 B/C 候选', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 20000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const typeB = allPoints.filter((p) => p.candidateType === 'B');
    const typeC = allPoints.filter((p) => p.candidateType === 'C');
    expect(typeB.length).toBeGreaterThan(0);
    expect(typeC.length).toBeGreaterThan(0);
  });

  it('Mac_mini confidence=高(已官宣) → shouldGenerate=true (P1 修复: 复合格式前缀匹配)', () => {
    // constants v4.0 (2026-08-25) 已回填 "高(已官宣)"; 旧断言 low 是把 P1 bug 固化进用例
    const plan = parseReleasePlan(constants, 'Mac_mini', defaultMacro);
    expect(plan).not.toBeNull();
    expect(plan!.releaseConfidence).toBe('high');
    expect(shouldGenerateWaitCandidates(plan!, defaultMacro)).toBe(true);
  });

  it('Mac_mini confidence=高(已官宣) → 生成 B/C 候选', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const typeB = allPoints.filter((p) => p.candidateType === 'B');
    const typeC = allPoints.filter((p) => p.candidateType === 'C');
    expect(typeB.length).toBeGreaterThan(0);
    expect(typeC.length).toBeGreaterThan(0);
  });

  it('confidence=低 → 不生成 B/C 候选 (构造变异 constants 验证 low 分支)', () => {
    // 当前真实数据无纯"低"品类, 深拷贝并改写 Mac_mini 置信度以覆盖 low 分支
    const cloned = structuredClone(constants) as Constants;
    const validation = cloned.releaseTimeValidation as Record<string, unknown>;
    for (const [k, v] of Object.entries(validation)) {
      if (k.startsWith('_当前校验结果_') && v && typeof v === 'object') {
        (v as Record<string, Record<string, string>>)['Mac_mini']['置信度'] = '低';
        break;
      }
    }
    const plan = parseReleasePlan(cloned, 'Mac_mini', defaultMacro);
    expect(plan!.releaseConfidence).toBe('low');
    expect(shouldGenerateWaitCandidates(plan!, defaultMacro)).toBe(false);
    const result = computeParetoFrontier(cloned, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const waitPoints = allPoints.filter((p) => p.candidateType === 'B' || p.candidateType === 'C');
    expect(waitPoints.length).toBe(0);
  });

  it('considerWait=false → 不生成 B/C 候选 (即使距发布 ≤ 90 天)', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 20000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: false,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const waitPoints = allPoints.filter((p) => p.candidateType === 'B' || p.candidateType === 'C');
    expect(waitPoints.length).toBe(0);
  });

  it('类型 B 候选 waitMonths > 0, predictedPrice=true', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 20000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const typeB = allPoints.filter((p) => p.candidateType === 'B');
    for (const p of typeB) {
      expect(p.waitMonths).toBeGreaterThan(0);
      expect(p.predictedPrice).toBe(true);
    }
  });

  it('类型 C 候选 waitMonths > 0, predictedPrice=true, buyTiming 继承自老款', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 20000,
      holdingYears: [2, 3],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const typeC = allPoints.filter((p) => p.candidateType === 'C');
    for (const p of typeC) {
      expect(p.waitMonths).toBeGreaterThan(0);
      expect(p.predictedPrice).toBe(true);
      // buyTiming 应为 'new' 或 'used' (继承自老款候选)
      expect(p.buyTiming === 'new' || p.buyTiming === 'used').toBe(true);
    }
  });
});
