/**
 * P2 修复测试: 发布日期兜底不得跨芯片代际错配
 *
 * 背景 (2026-08-27 排障 P2): computeAgeMonths 兜底 3 原取 key 末段作芯片名,
 * "Mac_mini_M4_Pro" 的末段是裸 "Pro", endsWith("_Pro") 错配到 Mac_mini_M2_Pro,
 * 机龄虚增 21 个月, 残值/系统支持期连锁算错。
 * 修复后: 裸 Pro/Max/Ultra 后缀与前段合并为完整芯片名, 缺日期时候选被跳过(-1)而非取错值。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConstants,
  computeParetoFrontier,
  getBuyPrice,
  getRetentionRate,
  parseReleasePlan,
  computeResidualImpactFactor,
} from '../src/index.js';
import type { Constants, MacroContext } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

const defaultMacro: MacroContext = {
  storageSuperCycleStage: 'none',
  hasGlobalPriceHike: false,
  analysisMonth: '2026-08',
};

function allPoints(result: ReturnType<typeof computeParetoFrontier>) {
  return [...result.frontier, ...result.dominated];
}

describe('发布日期兜底: 完整芯片名匹配', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('M4_Pro 日期缺失时 MUST NOT 错配 M2_Pro (候选被跳过而非取错日期)', () => {
    // 构造变异数据: 删除 Mac_mini_M4_Pro 日期, 保留 Mac_mini_M2_Pro
    const mutated = structuredClone(constants) as Constants;
    delete (mutated.productReleaseDates as Record<string, string>)['Mac_mini_M4_Pro'];

    const result = computeParetoFrontier(mutated, {
      category: 'mac-mini',
      budget: 30000,
      holdingYears: [3, 4],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: false,
      macroContext: defaultMacro,
    });
    // 旧代码: M4_Pro 候选存在(错配 M2_Pro 日期, 机龄虚增 21 个月); 新代码: 跳过
    const m4Pro = allPoints(result).filter((p) => p.model.includes('M4_Pro'));
    expect(m4Pro.length).toBe(0);
  });

  it('M4_Pro 日期补齐 (2024-10) 后按真实日期计算: 4年残值 ≈ 1923, 支持期不超', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 30000,
      holdingYears: [4],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: false,
      macroContext: defaultMacro,
    });
    const m4Pro4y = allPoints(result).find((p) => p.model.includes('M4_Pro') && p.holdingYears === 4);
    expect(m4Pro4y).toBeDefined();
    // v4.3 买入价锚定: 残值 = 买入价 × R(22+48)/R(22) × 冲击乘数(卖出点距发布 48 月 → 12月后因子)
    // (旧口径为 R(70)/100 × 当前新品价 ≈ 1923)
    const buyPrice = getBuyPrice(constants.marketSnapshots.Mac_mini['M4_Pro_24G_512G_新品'], 'new')!;
    const r70 = getRetentionRate(constants.retentionCurves, 'Mac_mini', 70);
    const r22 = getRetentionRate(constants.retentionCurves, 'Mac_mini', 22);
    const plan = parseReleasePlan(constants, 'Mac_mini', defaultMacro)!;
    const impactFactor = computeResidualImpactFactor(constants, 'Mac_mini_M4_Pro', plan, defaultMacro, 48);
    const expected = buyPrice * Math.min(1, r70 / r22) * impactFactor;
    expect(m4Pro4y!.residual).toBeCloseTo(expected, 0);
    expect(m4Pro4y!.residual).toBeLessThan(m4Pro4y!.buyPrice);
    // 真实机龄 22 月 + 持有 48 月 = 70 ≤ 72 (macOS 支持期), 不应标 exceeded
    expect(m4Pro4y!.systemSupportRisk).not.toBe('exceeded');
  });

  it('MacBook_Pro_14_M3Pro 缺失时正当兜底到 MacBook_Pro_16_M3Pro (候选不被跳过)', () => {
    const result = computeParetoFrontier(constants, {
      category: 'MacBook_Pro',
      budget: 30000,
      holdingYears: [3],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
      macroContext: defaultMacro,
    });
    const m3Pro14 = allPoints(result).filter((p) => p.model.includes('M3Pro') && p.model.includes('14寸'));
    expect(m3Pro14.length).toBeGreaterThan(0);
  });

  it('兜底目标也被删除时, M3Pro 14寸候选被跳过 (证明上例确经兜底命中 16_M3Pro)', () => {
    const mutated = structuredClone(constants) as Constants;
    delete (mutated.productReleaseDates as Record<string, string>)['MacBook_Pro_16_M3Pro'];

    const result = computeParetoFrontier(mutated, {
      category: 'MacBook_Pro',
      budget: 30000,
      holdingYears: [3],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
      macroContext: defaultMacro,
    });
    const m3Pro14 = allPoints(result).filter((p) => p.model.includes('M3Pro') && p.model.includes('14寸'));
    expect(m3Pro14.length).toBe(0);
  });
});
