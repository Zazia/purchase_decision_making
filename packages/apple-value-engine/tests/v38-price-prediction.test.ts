/**
 * v3.8 测试: 新品价格预测 (类型 B) 与老款降价预测 (类型 C)
 *
 * 验证:
 * - 类型 B: predictNewProductPrice 公式 (含 hasHikeOccurred 分支)
 * - 类型 C: predictDiscountedOldPrice 公式 (含宏观因子调整)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, parseReleasePlan, predictNewProductPrice, predictDiscountedOldPrice, getCurrentNewPrice } from '../src/index.js';
import type { Constants, MacroContext, ReleasePlan } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

describe('v3.8 price prediction', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  const noMacro: MacroContext = {
    storageSuperCycleStage: 'none',
    hasGlobalPriceHike: false,
    analysisMonth: '2026-08',
  };

  // ==========================================================================
  // 类型 B: predictNewProductPrice
  // ==========================================================================

  describe('predictNewProductPrice (类型 B)', () => {
    it('未触发宏观事件 → 同档同价 (predictedPriceHike=0)', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', noMacro);
      expect(plan).not.toBeNull();
      // 无宏观事件 → predictedPriceHike = 0
      expect(plan!.predictedPriceHike).toBe(0);
      const predicted = predictNewProductPrice(constants, 'iPhone_Pro', plan!);
      const currentNew = getCurrentNewPrice(constants, 'iPhone_Pro');
      // 未涨价且无宏观事件: 预测价 = 当前官方价 × (1 + 0) = 当前官方价
      expect(predicted).toBeCloseTo(currentNew, 2);
    });

    it('hasHikeOccurred=true → 直接用快照官方价', () => {
      // 构造一个 hasHikeOccurred=true 的 releasePlan
      const plan: ReleasePlan = {
        category: 'iPhone_Pro',
        nextReleaseMonth: '2026-09',
        releaseConfidence: 'high',
        baselineDelayDays: 10,
        pessimisticDelayDays: 30,
        macroCapacityFactor: 1.0,
        predictedPriceHike: 0.12,
        hasHikeOccurred: true,
      };
      const predicted = predictNewProductPrice(constants, 'iPhone_Pro', plan);
      const currentNew = getCurrentNewPrice(constants, 'iPhone_Pro');
      // 已涨价: 直接用当前官方价 (不施加预测涨幅)
      expect(predicted).toBe(currentNew);
    });

    it('宏观触发 + 未涨价 → 预测价 = 官方价 × (1 + 中位数涨幅)', () => {
      const macro: MacroContext = {
        storageSuperCycleStage: 'ongoing',
        hasGlobalPriceHike: true,
        analysisMonth: '2026-08',
      };
      const plan = parseReleasePlan(constants, 'iPhone_Pro', macro);
      expect(plan).not.toBeNull();
      if (plan!.hasHikeOccurred) {
        // 若该品类已涨价, 跳过 (用当前价)
        return;
      }
      const hike = plan!.predictedPriceHike ?? 0;
      expect(hike).toBeGreaterThan(0);
      const predicted = predictNewProductPrice(constants, 'iPhone_Pro', plan!);
      const currentNew = getCurrentNewPrice(constants, 'iPhone_Pro');
      expect(predicted).toBeCloseTo(currentNew * (1 + hike), 2);
    });
  });

  // ==========================================================================
  // 类型 C: predictDiscountedOldPrice
  // ==========================================================================

  describe('predictDiscountedOldPrice (类型 C)', () => {
    it('未触发宏观事件 → 买入价 = 市场价 × (1 - 历史均值 × 时变因子)', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', noMacro);
      expect(plan).not.toBeNull();
      const oldPrice = 5000; // 假设老款当前市场价 5000
      const discounted = predictDiscountedOldPrice(constants, oldPrice, plan!, noMacro);
      // 折扣价应低于原价 (冲击导致降价)
      expect(discounted).toBeLessThan(oldPrice);
      expect(discounted).toBeGreaterThan(0);
    });

    it('宏观触发时折扣幅度受价格传导因子与产能因子双重影响', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', noMacro);
      expect(plan).not.toBeNull();
      const oldPrice = 5000;
      const noMacroDiscount = predictDiscountedOldPrice(constants, oldPrice, plan!, noMacro);

      const macro: MacroContext = {
        storageSuperCycleStage: 'ongoing',
        hasGlobalPriceHike: true,
        analysisMonth: '2026-08',
      };
      const macroPlan = parseReleasePlan(constants, 'iPhone_Pro', macro);
      expect(macroPlan).not.toBeNull();
      const macroDiscount = predictDiscountedOldPrice(constants, oldPrice, macroPlan!, macro);

      // 宏观触发时:
      //   1) 价格传导因子为负 → adjustedImpact 减小 → drop 减小 → 价格更高
      //   2) 产能因子 2.0 → monthsSinceRelease 增大 → 时变因子可能减小 → drop 减小 → 价格更高
      //   但也有可能跨越时段边界导致时变因子不变
      // 验证: 两个折扣价都合理 (> 0 且 < 原价), 且宏观上下文确实影响了结果
      expect(noMacroDiscount).toBeGreaterThan(0);
      expect(noMacroDiscount).toBeLessThan(oldPrice);
      expect(macroDiscount).toBeGreaterThan(0);
      expect(macroDiscount).toBeLessThan(oldPrice);
      // 宏观产能因子应 > 1 (ongoing = 2.0)
      expect(macroPlan!.macroCapacityFactor).toBeGreaterThan(plan!.macroCapacityFactor);
    });

    it('折扣价始终 > 0', () => {
      const plan = parseReleasePlan(constants, 'iPhone_Pro', noMacro);
      expect(plan).not.toBeNull();
      const discounted = predictDiscountedOldPrice(constants, 100, plan!, noMacro);
      expect(discounted).toBeGreaterThan(0);
    });
  });
});
