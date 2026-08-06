/**
 * apple-value-engine 一致性单测
 *
 * 测试策略:
 * 1. loadConstants 校验逻辑(含缺失字段错误)
 * 2. 保值率插值/外推
 * 3. 性能满足度公式(对照 SKILL.md 示例)
 * 4. 月均成本公式(对照 constants.json 月均成本计算公式.示例)
 * 5. 帕累托前沿筛选(合成数据)
 *
 * fixtures: 直接读取仓库内 constants.json 作为真实数据源
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, computeParetoFrontier, getRetentionRate, computePerformance, computeMonthlyCost, computeMaintenanceCost, getEffectiveR, ConstantsValidationError } from '../src/index.js';
import type { Constants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

// ============================================================================
// loadConstants
// ============================================================================

describe('loadConstants', () => {
  it('解析合法 constants.json', () => {
    const c = loadConstants(constantsJson);
    expect(c.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(c.retentionCurves).toBeDefined();
    expect(c.chipBenchmarks).toBeDefined();
    expect(c.marketSnapshots).toBeDefined();
    expect(c.maintenanceCosts).toBeDefined();
  });

  it('缺失 retention_curves 抛 ConstantsValidationError', () => {
    const raw = JSON.parse(constantsJson) as Record<string, unknown>;
    delete raw['保值率曲线'];
    const text = JSON.stringify(raw);
    expect(() => loadConstants(text)).toThrow(ConstantsValidationError);
    expect(() => loadConstants(text)).toThrow(/retention_curves/);
  });

  it('缺失 last_updated 抛 ConstantsValidationError', () => {
    const raw = JSON.parse(constantsJson) as Record<string, unknown>;
    const meta = raw['metadata'] as Record<string, unknown>;
    delete meta.last_updated;
    const text = JSON.stringify(raw);
    expect(() => loadConstants(text)).toThrow(/last_updated/);
  });

  it('JSON 语法错误抛 SyntaxError', () => {
    expect(() => loadConstants('{invalid json')).toThrow(SyntaxError);
  });
});

// ============================================================================
// 保值率插值与外推
// ============================================================================

describe('getRetentionRate', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('范围内线性插值: iPhone_ProMax 15月 = 12月(78)与18月(73)之间', () => {
    // 15月在12(78)和18(73)之间, t=(15-12)/(18-12)=0.5, rate=78+(73-78)*0.5=75.5
    const rate = getRetentionRate(constants.retentionCurves, 'iPhone_ProMax', 15);
    expect(rate).toBeCloseTo(75.5, 1);
  });

  it('范围外外推: 72月按48-60月斜率外推', () => {
    // iPhone_ProMax: 48月=42, 60月=32, 斜率=(32-42)/12=-0.833/月
    // 72月 = 32 + (-0.833)×12 = 22, 保底3%
    const rate = getRetentionRate(constants.retentionCurves, 'iPhone_ProMax', 72);
    expect(rate).toBeCloseTo(22, 0);
  });

  it('保值率不低于 3% 保底', () => {
    // 极远月数应保底 3%
    const rate = getRetentionRate(constants.retentionCurves, 'iPhone_ProMax', 600);
    expect(rate).toBeGreaterThanOrEqual(3);
  });

  it('0月保值率为100', () => {
    const rate = getRetentionRate(constants.retentionCurves, 'iPhone_ProMax', 0);
    expect(rate).toBe(100);
  });
});

// ============================================================================
// 性能满足度
// ============================================================================

describe('computePerformance', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('SKILL.md 示例: Mac mini M2 16G 256G, S(0)≈48%', () => {
    // SKILL.md: M2 多核9700 / M5 多核17100 = 0.567, ×16G(1.0) ×256G(0.85) = 0.4819
    const perf = computePerformance(constants, 'M2', 16, 256, 'Mac_mini', 24);
    expect(perf.s0).toBeCloseTo(0.482, 2);
  });

  it('SKILL.md 示例: M2 持24月, S̄(24)≈42%', () => {
    // S(0)=0.482, S(24)=0.482/(1.16)^2=0.482/1.3456=0.358, S̄=(0.482+0.358)/2=0.420
    const perf = computePerformance(constants, 'M2', 16, 256, 'Mac_mini', 24);
    expect(perf.sN).toBeCloseTo(0.358, 2);
    expect(perf.avgS).toBeCloseTo(0.420, 2);
  });

  it('SKILL.md 示例: M2 持36月, S̄(36)≈40%', () => {
    // S(36)=0.482/(1.16)^3=0.482/1.5609=0.309, S̄=(0.482+0.309)/2=0.395
    const perf = computePerformance(constants, 'M2', 16, 256, 'Mac_mini', 36);
    expect(perf.avgS).toBeCloseTo(0.395, 2);
  });

  it('M4 Mac mini S(0)≈75% (SKILL.md 示例)', () => {
    // M4 多核15000 / M5 17100 = 0.877, ×16G(1.0) ×256G(0.85) = 0.7456
    const perf = computePerformance(constants, 'M4', 16, 256, 'Mac_mini', 12);
    expect(perf.s0).toBeCloseTo(0.746, 2);
  });

  it('性能满足度误差 ≤ 0.001', () => {
    // 验证公式精度
    const perf = computePerformance(constants, 'M2', 16, 256, 'Mac_mini', 24);
    const expectedS0 = (9700 / 17100) * 1.0 * 0.85;
    expect(Math.abs(perf.s0 - expectedS0)).toBeLessThan(0.001);
  });
});

// ============================================================================
// 代际跃升识别
// ============================================================================

describe('getEffectiveR', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('跃升代际(M2, M1→M2为跃升): r × 1.5 = 0.24', () => {
    // M1→M2 类型 = "跃升(架构首次大改)", M2 为目标代
    const { r } = getEffectiveR(constants, 'M2', 0.16, 0.15);
    expect(r).toBeCloseTo(0.24, 4);
  });

  it('常规代际(M3, M2→M3为常规): r = 0.16', () => {
    // M2→M3 类型 = "常规"
    const { r } = getEffectiveR(constants, 'M3', 0.16, 0.15);
    expect(r).toBeCloseTo(0.16, 4);
  });

  it('节点首发(A17_Pro, A16→A17Pro为低谷/3nm首发): r × 0.5 = 0.075', () => {
    // A16→A17_Pro 类型 = "低谷(3nm首发良率受限)"
    const { r } = getEffectiveR(constants, 'A17_Pro', 0.16, 0.15);
    expect(r).toBeCloseTo(0.075, 4);
  });
});

// ============================================================================
// 月均成本
// ============================================================================

describe('computeMonthlyCost', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('constants.json 示例: Mac mini M2 二手, 买入2400, 持24月, 月均≈72元', () => {
    // 示例: 买入价2400, 当前机龄42月, 持24月→卖出66月
    // Mac_mini 保值率: 60月=18%(查表), 48月=25%, 48-60月斜率=(18-25)/12=-0.583/月
    // 66月 = 18 + (-0.583)×6 = 14.5%
    // 残值 = 5999 × 14.5% = 870
    // 维修 = Mac_mini无电池 + 100/年×2 = 200
    // 月均 = (2400 - 870 + 200) / 24 = 72.08
    const cost = computeMonthlyCost(constants, 'Mac_mini', 2400, 42, 24, 5999);
    expect(cost.retentionRate).toBeCloseTo(14.5, 1);
    expect(cost.residual).toBeCloseTo(870, 0);
    expect(cost.maintenanceCost).toBe(200);
    expect(cost.monthlyCost).toBeCloseTo(72.08, 1);
  });

  it('月均成本误差 ≤ 0.5 元', () => {
    const cost = computeMonthlyCost(constants, 'Mac_mini', 2400, 42, 24, 5999);
    expect(Math.abs(cost.monthlyCost - 72.08)).toBeLessThan(0.5);
  });

  it('spec 示例: mac-mini 二手 2700, 持3年, 保值率0.42, 新品4499, 维修200/年', () => {
    // spec: 月均成本 = (2700 − 0.42×4499 + 200×3) / 36
    // = (2700 - 1889.58 + 600) / 36 = 1410.42 / 36 = 39.18
    // 注: 这里直接用保值率0.42即42%, 残值=0.42×4499=1889.58
    const cost = computeMonthlyCost(constants, 'Mac_mini', 2700, 0, 36, 4499);
    // 0月机龄+持36月→卖出36月, 查Mac_mini曲线36月保值率
    // 这里验证公式正确性, 不验证具体保值率值
    const expected = (2700 - cost.residual + cost.maintenanceCost) / 36;
    expect(cost.monthlyCost).toBeCloseTo(expected, 4);
  });
});

// ============================================================================
// 维修成本
// ============================================================================

describe('computeMaintenanceCost', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('Mac mini 无电池, 仅故障维修 100/年', () => {
    // 持24月 = 2年, 100×2 = 200
    const cost = computeMaintenanceCost(constants, 'Mac_mini', 24);
    expect(cost).toBe(200);
  });

  it('iPhone 电池36月周期, 持48月 = 1次电池(748) + 2年维修(400)', () => {
    // floor(48/36)=1, 1×748 + 4×200 = 748 + 800 = 1548
    const cost = computeMaintenanceCost(constants, 'iPhone', 48);
    expect(cost).toBe(1548);
  });
});

// ============================================================================
// 帕累托前沿
// ============================================================================

describe('computeParetoFrontier', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('mac-mini 二手返回非空前沿', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 5000,
      holdingYears: [2, 3, 4],
      buyTiming: 'used',
      performanceFloor: 0.3,
    });
    expect(result.frontier.length).toBeGreaterThan(0);
    expect(result.dominated.length).toBeGreaterThanOrEqual(0);
  });

  it('前沿点不存在被支配: 每个前沿点不被其他点同时成本更低且性能更高', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 10000,
      holdingYears: [2, 3, 4, 5],
      buyTiming: 'used',
      performanceFloor: 0,
    });
    for (const p of result.frontier) {
      for (const q of result.frontier) {
        if (p === q) continue;
        // q 不应支配 p: 不存在 q.cost<=p.cost 且 q.perf>=p.perf (至少一个严格)
        const dominated = q.monthlyCost <= p.monthlyCost && q.avgPerformance >= p.avgPerformance &&
          (q.monthlyCost < p.monthlyCost || q.avgPerformance > p.avgPerformance);
        expect(dominated).toBe(false);
      }
    }
  });

  it('前沿按月均成本升序', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 10000,
      holdingYears: [2, 3, 4],
      buyTiming: 'used',
      performanceFloor: 0,
    });
    for (let i = 1; i < result.frontier.length; i++) {
      expect(result.frontier[i].monthlyCost).toBeGreaterThanOrEqual(result.frontier[i - 1].monthlyCost);
    }
  });

  it('推荐区间过滤: 买入价 ≤ 预算 且 性能 ≥ 地板', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 3000,
      holdingYears: [2, 3, 4],
      buyTiming: 'used',
      performanceFloor: 0.4,
    });
    for (const p of result.recommendationRange.plans) {
      expect(p.buyPrice).toBeLessThanOrEqual(3000);
      expect(p.avgPerformance).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('空结果兜底: 预算极低时推荐区间为空', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100,
      holdingYears: [2],
      buyTiming: 'used',
      performanceFloor: 0.99,
    });
    expect(result.recommendationRange.plans.length).toBe(0);
  });
});
