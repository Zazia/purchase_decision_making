/**
 * v4.2 测试: 锚定品识别 + S(0) 不截断 + 类型 A 残值冲击 + 新品价选择
 *
 * 夹具镜像 2026-08 真实常量形态:
 *   - Mac_mini nextReleaseMonth = 2026-08 (M6/M5 Pro 已官宣, 9-22 发售)
 *   - M6 / M5_Pro 发布月 2026-08 → 锚定品; M4 = 2024-10 → 非锚定品
 *   - 冲击均值 35%, 锚涨幅 16.7% → 传导因子 -0.25 → 调整后冲击 26.25%
 *   - Mac_mini 品类基准芯片 M5 多核 17100, M6 推算多核 21000
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConstants,
  computeParetoFrontier,
  computePerformance,
  computeMonthlyCost,
  computeMaintenanceCost,
  getCurrentNewPrice,
  getRetentionRate,
  isAnchorCandidate,
  parseReleasePlan,
} from '../src/index.js';
import type { Constants, MacroContext } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

/** 与 v38 测试同款默认宏观状态 (无宏观事件, 分析月 = 2026-08) */
const defaultMacro: MacroContext = {
  storageSuperCycleStage: 'none',
  hasGlobalPriceHike: false,
  analysisMonth: '2026-08',
};

describe('v4.2 锚定品识别 (isAnchorCandidate)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('M6 (发布月 2026-08 = nextReleaseMonth) 是锚定品', () => {
    const plan = parseReleasePlan(constants, 'Mac_mini', defaultMacro);
    expect(plan!.nextReleaseMonth).toBe('2026-08');
    expect(isAnchorCandidate(constants, 'Mac_mini_M6', plan!)).toBe(true);
  });

  it('M5_Pro (发布月 2026-08) 是锚定品', () => {
    const plan = parseReleasePlan(constants, 'Mac_mini', defaultMacro);
    expect(isAnchorCandidate(constants, 'Mac_mini_M5_Pro', plan!)).toBe(true);
  });

  it('M4 (发布月 2024-10 < nextReleaseMonth) 不是锚定品', () => {
    const plan = parseReleasePlan(constants, 'Mac_mini', defaultMacro);
    expect(isAnchorCandidate(constants, 'Mac_mini_M4', plan!)).toBe(false);
  });
});

describe('v4.2 类型 C 候选排除锚定品', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('M6/M5_Pro 不出现在类型 C 候选集, M4 正常出现, M6 仍为类型 A 候选', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [1, 2],
      buyTiming: 'both',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const typeC = allPoints.filter((p) => p.candidateType === 'C');
    const typeA = allPoints.filter((p) => p.candidateType === 'A');

    // 锚定品不得套用「老款 × (1+锚涨幅) × (1−冲击)」公式 → 不生成类型 C
    expect(typeC.some((p) => p.chip === 'M6')).toBe(false);
    expect(typeC.some((p) => p.chip === 'M5_Pro')).toBe(false);
    // 非锚定老款正常生成类型 C
    expect(typeC.some((p) => p.chip === 'M4')).toBe(true);
    // 锚定品仍作为类型 A (现在买) 候选
    expect(typeA.some((p) => p.chip === 'M6' && p.model.startsWith('M6_16G_256G_新品'))).toBe(true);
  });
});

describe('v4.2 S(0) 不截断于 1', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('M6 推算跑分 21000 ÷ 实测基准 17100 → s0 ≈ 1.044 (>1 不截断)', () => {
    // chipCoeff = 21000/17100 = 1.2281; memWeight(16G)=1, storageWeight(256G)=0.85
    // s0 = 1.2281 × 1 × 0.85 ≈ 1.0439
    const perf = computePerformance(constants, 'M6', 16, 256, 'Mac_mini', 12);
    expect(perf.s0).toBeGreaterThan(1);
    expect(perf.s0).toBeCloseTo(1.044, 3);
  });

  it('老款 M4 回归: s0 数值不变 (≤ 1, 不受截断移除影响)', () => {
    const perf = computePerformance(constants, 'M4', 16, 256, 'Mac_mini', 12);
    expect(perf.s0).toBeLessThanOrEqual(1);
    expect(perf.s0).toBeCloseTo(0.7456, 3);
  });
});

describe('v4.2 类型 A 残值冲击调整', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  /** 基线残值 (无冲击): 保值率(卖出时机龄) / 100 × 当前新品价 6999 */
  function baselineResidual(sellAgeMonths: number): number {
    const rate = getRetentionRate(constants.retentionCurves, 'Mac_mini', sellAgeMonths);
    return (rate / 100) * getCurrentNewPrice(constants, 'Mac_mini');
  }

  it('M4 二手持有 12 月: 残值 = 原残值 × 0.92125 (调整后冲击 26.25% × 因子 0.30)', () => {
    // M4 发布 2024-10, 分析月 2026-08 → 当前机龄 22 月; nextReleaseMonth=2026-08,
    // monthsToRelease=0, 卖出点距发布 12 月 → 残值调整因子 0.30
    // 乘数 = 1 − 0.2625 × 0.30 = 0.92125
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [1],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    // 同名方案存在类型 A/C 两个点 (类型 C 残值不施冲击, 见 cost.ts 注释),
    // 此处断言类型 A (现在买) 的残值冲击
    const point = [...result.frontier, ...result.dominated].find(
      (p) => p.model === 'M4_16G_256G_二手 × 1年' && p.candidateType === 'A',
    );
    expect(point).toBeDefined();
    const expected = baselineResidual(22 + 12) * 0.92125;
    expect(point!.residual).toBeCloseTo(expected, 6);
    // 月均成本同步受残值影响
    const maintenance = computeMaintenanceCost(constants, 'Mac_mini', 12);
    expect(point!.monthlyCost).toBeCloseTo((4200 - expected + maintenance) / 12, 6);
  });

  it('M4 二手持有 18 月: 卖出点距发布 18 月 (12月后) → 残值 × 0.97375', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [1.5],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const point = [...result.frontier, ...result.dominated].find(
      (p) => p.model === 'M4_16G_256G_二手 × 1.5年' && p.candidateType === 'A',
    );
    expect(point).toBeDefined();
    // 乘数 = 1 − 0.2625 × 0.10 = 0.97375
    const expected = baselineResidual(22 + 18) * 0.97375;
    expect(point!.residual).toBeCloseTo(expected, 6);
  });

  it('锚定品 M6 不施加残值冲击 (贬值由保值率曲线覆盖)', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [1],
      buyTiming: 'new',
      performanceFloor: 0,
      considerWait: true,
      macroContext: defaultMacro,
    });
    const point = [...result.frontier, ...result.dominated].find(
      (p) => p.model === 'M6_16G_256G_新品 × 1年',
    );
    expect(point).toBeDefined();
    // M6 机龄 0, 卖出时机龄 12 → 残值 = 保值率(12月) × 6999, 无冲击乘数
    const expected = baselineResidual(0 + 12);
    expect(point!.residual).toBeCloseTo(expected, 6);
  });

  it('持有期短于发布窗口 (发布月超出持有期) → 不施加冲击', () => {
    // 改写发布节奏: 下一次预计 2026-12 (距分析月 4 月), 持有 3 月 < 4 月 → 不触发
    const cloned = structuredClone(constants) as Constants;
    cloned.releaseRhythm.Mac_mini.下一次预计 = '2026-12';
    const result = computeParetoFrontier(cloned, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [0.25],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
      macroContext: { ...defaultMacro, analysisMonth: '2026-08' },
    });
    const point = [...result.frontier, ...result.dominated].find(
      (p) => p.model === 'M4_16G_256G_二手 × 0.25年',
    );
    expect(point).toBeDefined();
    const expected = baselineResidual(22 + 3); // 无乘数
    expect(point!.residual).toBeCloseTo(expected, 6);
  });
});

describe('v4.2 新品价选择 (getCurrentNewPrice)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  /** 按给定键顺序重建 Mac_mini 快照对象 */
  function reorderSnapshots(c: Constants, firstKeys: string[]): Constants {
    const cloned = structuredClone(c) as Constants;
    const snaps = cloned.marketSnapshots.Mac_mini as Record<string, unknown>;
    const rebuilt: Record<string, unknown> = {};
    for (const k of firstKeys) rebuilt[k] = snaps[k];
    for (const [k, v] of Object.entries(snaps)) {
      if (!(k in rebuilt)) rebuilt[k] = v;
    }
    cloned.marketSnapshots.Mac_mini = rebuilt as typeof snaps;
    return cloned;
  }

  it('M5_Pro(Pro 12999) 在前 → 仍返回 M6 基础款 6999 (发布月最晚 + 基础款优先)', () => {
    const reordered = reorderSnapshots(constants, ['M5_Pro_24G_512G_新品', 'M6_16G_256G_新品']);
    expect(getCurrentNewPrice(reordered, 'Mac_mini')).toBe(6999);
  });

  it('M6 基础款在前 → 返回 6999 (与键顺序无关)', () => {
    const reordered = reorderSnapshots(constants, ['M6_16G_256G_新品', 'M5_Pro_24G_512G_新品']);
    expect(getCurrentNewPrice(reordered, 'Mac_mini')).toBe(6999);
  });

  it('仅含老款时返回老款官方价 (兜底兼容: M4 基础款 5999)', () => {
    const cloned = structuredClone(constants) as Constants;
    const snaps = cloned.marketSnapshots.Mac_mini as Record<string, unknown>;
    delete snaps['M6_16G_256G_新品'];
    delete snaps['M5_Pro_24G_512G_新品'];
    // 剩余新品均为 M4 (2024-10), 同月基础款优先 → M4_16G_256G_新品 5999
    expect(getCurrentNewPrice(cloned, 'Mac_mini')).toBe(5999);
  });
});
