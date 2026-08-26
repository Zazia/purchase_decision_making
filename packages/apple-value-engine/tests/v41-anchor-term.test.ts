/**
 * v4.1 测试: 锚定-冲击双因子模型 (SOP §9.4) 引擎同步
 *
 * 覆盖:
 * - "已官宣"识别: hasHikeOccurred / anchorHike 解析 (此前引擎不识别"已官宣")
 * - 类型 B 防重复计算: 已官宣时直接用快照官方价 (官宣价已入库, 不再乘预测涨幅)
 * - 类型 C 锚定公式: 买入价 = 市场价 × (1+锚涨幅) × (1 − 调整后冲击 × 时变因子)
 *   传导因子按锚涨幅查表 (官宣价是事实, 不依赖宏观触发)
 * - parsePercent 负号修复: 传导因子表 "-25%(...)" 此前被解析为 +0.25 (方向反转)
 * - 未官宣品类回归: anchorHike=0, 公式退化为 v3.8 形式
 * - v4.2 传导因子实证点校验用例: MacBook 30%×(1−25%)=22.5% 机制预测口径
 *   (对应《2026-08-26-常量数据更新执行报告》§3 MacBook_M5Pro 配对点)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConstants,
  parseReleasePlan,
  predictNewProductPrice,
  predictDiscountedOldPrice,
  getCurrentNewPrice,
  lookupImpactTimeVaryingFactor,
} from '../src/index.js';
import type { Constants, MacroContext, ReleasePlan } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

describe('v4.1 anchor-term (锚定-冲击双因子模型)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  const noMacro: MacroContext = {
    storageSuperCycleStage: 'none',
    hasGlobalPriceHike: false,
    analysisMonth: '2026-08',
  };
  const macroOngoing: MacroContext = {
    storageSuperCycleStage: 'ongoing',
    hasGlobalPriceHike: true,
    analysisMonth: '2026-08',
  };

  // ==========================================================================
  // "已官宣" 识别 (Mac_mini: 预测涨幅="已官宣", 中位数=16.7%)
  // ==========================================================================

  describe('"已官宣"状态识别', () => {
    it('hasHikeOccurred=true 且 anchorHike=中位数 (无宏观)', () => {
      const plan = parseReleasePlan(constants, 'Mac_mini', noMacro);
      expect(plan).not.toBeNull();
      expect(plan!.hasHikeOccurred).toBe(true);
      expect(plan!.anchorHike).toBeCloseTo(0.167, 4);
    });

    it('宏观触发时同样成立 (已官宣不依赖宏观事件)', () => {
      const plan = parseReleasePlan(constants, 'Mac_mini', macroOngoing);
      expect(plan).not.toBeNull();
      expect(plan!.hasHikeOccurred).toBe(true);
      // 已官宣 → 不再用预测涨幅外推 → predictedPriceHike=0
      expect(plan!.predictedPriceHike).toBe(0);
      expect(plan!.anchorHike).toBeCloseTo(0.167, 4);
    });

    it('未官宣品类 (iPhone_Pro) anchorHike=0, hasHikeOccurred=false', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', macroOngoing);
      expect(plan).not.toBeNull();
      expect(plan!.hasHikeOccurred).toBe(false);
      expect(plan!.anchorHike ?? 0).toBe(0);
    });

    it('已发生品类 (MacBook_Pro) hasHikeOccurred=true 但 anchorHike=0 (无新品官宣价)', () => {
      const plan = parseReleasePlan(constants, 'MacBook_Pro', macroOngoing);
      expect(plan).not.toBeNull();
      expect(plan!.hasHikeOccurred).toBe(true);
      expect(plan!.anchorHike ?? 0).toBe(0);
    });
  });

  // ==========================================================================
  // 类型 B: 官宣价已入库, 不再乘预测涨幅 (防重复计算)
  // ==========================================================================

  describe('类型B防重复计算', () => {
    it('已官宣 → 预测价 = 快照官方价 (M6 6999), 不乘 (1+16.7%)', () => {
      const plan = parseReleasePlan(constants, 'Mac_mini', macroOngoing);
      expect(plan).not.toBeNull();
      const predicted = predictNewProductPrice(constants, 'Mac_mini', plan!);
      const currentNew = getCurrentNewPrice(constants, 'Mac_mini');
      // 快照首位新品条目为 M6 官宣价 6999
      expect(currentNew).toBe(6999);
      expect(predicted).toBe(currentNew);
    });
  });

  // ==========================================================================
  // 类型 C: 锚定公式
  // Mac_mini 实测口径: 均值 35%, 锚涨幅 16.7% → 传导因子 -25% → 调整后 26.25%
  // 延迟 14天 → 1月; 无宏观产能因子 1.0 → 1月内 (买入价下降因子 1.0);
  // 宏观进行中因子 2.0 → 2月 → 3月内 (因子 0.95)
  // ==========================================================================

  describe('类型C锚定公式 (Mac_mini)', () => {
    const oldPrice = 4500; // M4 丐版当前叫价 (SKILL.md v4.1 更新注场景)

    it('无宏观: 4500 × (1+16.7%) × (1 − 26.25% × 1.0) ≈ 3873', () => {
      const plan = parseReleasePlan(constants, 'Mac_mini', noMacro);
      expect(plan).not.toBeNull();
      const discounted = predictDiscountedOldPrice(constants, oldPrice, plan!, noMacro);
      const expected = oldPrice * 1.167 * (1 - 0.35 * (1 - 0.25) * 1.0);
      expect(discounted).toBeCloseTo(expected, 1);
      expect(discounted).toBeCloseTo(3872.98, 0);
    });

    it('宏观进行中: 时变因子随产能因子切换 → 价格高于无宏观口径的冲击项', () => {
      const plan = parseReleasePlan(constants, 'Mac_mini', macroOngoing);
      expect(plan).not.toBeNull();
      const discounted = predictDiscountedOldPrice(constants, oldPrice, plan!, macroOngoing);
      // 2月 → 3月内 → 买入价下降因子 0.95
      const expected = oldPrice * 1.167 * (1 - 0.35 * 0.75 * 0.95);
      expect(discounted).toBeCloseTo(expected, 1);
      expect(discounted).toBeCloseTo(3941.91, 0);
    });

    it('锚定项生效: 含锚定项的价格 > 纯冲击公式价格 (v3.8 会高估捡漏空间)', () => {
      const plan = parseReleasePlan(constants, 'Mac_mini', noMacro);
      expect(plan).not.toBeNull();
      const withAnchor = predictDiscountedOldPrice(constants, oldPrice, plan!, noMacro);
      const withoutAnchor = oldPrice * (1 - 0.35 * 0.75 * 1.0); // v3.8 形式
      expect(withAnchor).toBeGreaterThan(withoutAnchor);
      // 对应 SKILL.md v4.1 更新注: 漏掉锚定项会高估捡漏空间
      expect(withAnchor - withoutAnchor).toBeGreaterThan(500);
    });
  });

  // ==========================================================================
  // parsePercent 负号修复: 传导因子方向
  // ==========================================================================

  describe('传导因子符号修复', () => {
    const oldPrice = 5000;
    const mkPlan = (hike: number): ReleasePlan => ({
      category: 'iPhone_Pro',
      nextReleaseMonth: '2026-09',
      releaseConfidence: 'high',
      baselineDelayDays: 0,
      pessimisticDelayDays: 0,
      macroCapacityFactor: 1.0,
      predictedPriceHike: hike,
      hasHikeOccurred: false,
    });

    it('涨价越大 → 传导因子越负 → 老款冲击越小 → 预测价越高', () => {
      const p0 = predictDiscountedOldPrice(constants, oldPrice, mkPlan(0), macroOngoing);
      const p12 = predictDiscountedOldPrice(constants, oldPrice, mkPlan(0.12), macroOngoing);
      const p20 = predictDiscountedOldPrice(constants, oldPrice, mkPlan(0.2), macroOngoing);
      // iPhone 均值 10%: hike=0 → +0%; 12% → 5-15%档 -15%; 20% → 15-30%档 -25%
      expect(p12).toBeGreaterThan(p0);
      expect(p20).toBeGreaterThan(p12);
      // 修复前 parsePercent 丢负号: -15% 被解析为 +15%, 方向完全反转
    });

    it('v4.2 实证校验用例: MacBook 30% × (1−25%) = 22.5% 机制预测口径', () => {
      // 对应执行报告 §3 MacBook_M5Pro 配对点: 毛冲击 -10~-20% 与
      // "30%基准×传导因子-25%=22.5%" 同量级 —— 此处验证机制预测本身的数值
      const plan: ReleasePlan = {
        category: 'MacBook_Pro',
        nextReleaseMonth: '2026-10',
        releaseConfidence: 'medium',
        baselineDelayDays: 0,
        pessimisticDelayDays: 0,
        macroCapacityFactor: 1.0,
        predictedPriceHike: 0.185, // 2026-06 全线涨幅 18.5% → 15-30% 档
        hasHikeOccurred: false,
      };
      const discounted = predictDiscountedOldPrice(constants, oldPrice, plan, macroOngoing);
      // 均值 30% × (1 − 0.25) = 22.5%; delay=0 → 1月内 → 因子 1.0; anchorHike=0
      expect(discounted).toBeCloseTo(oldPrice * (1 - 0.225), 1);
    });
  });

  // ==========================================================================
  // 未官宣品类回归: v3.8 形式不变
  // ==========================================================================

  describe('未官宣品类回归 (iPhone_Pro)', () => {
    it('无宏观: 公式退化 v3.8 (无锚定项, 传导因子 +0%)', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', noMacro);
      expect(plan).not.toBeNull();
      const oldPrice = 5000;
      const discounted = predictDiscountedOldPrice(constants, oldPrice, plan!, noMacro);
      const months = Math.ceil(
        (Math.ceil(plan!.baselineDelayDays / 30) * plan!.macroCapacityFactor) - 1e-9,
      );
      const tv = lookupImpactTimeVaryingFactor(constants, months).buyPriceDropFactor;
      // iPhone 均值 10%, 无宏观 → 传导因子 +0% → 无锚定项
      expect(discounted).toBeCloseTo(oldPrice * (1 - 0.1 * tv), 1);
    });

    it('折扣价仍满足 (0, 原价) 区间', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', noMacro);
      expect(plan).not.toBeNull();
      const discounted = predictDiscountedOldPrice(constants, 5000, plan!, noMacro);
      expect(discounted).toBeGreaterThan(0);
      expect(discounted).toBeLessThan(5000);
    });
  });
});
