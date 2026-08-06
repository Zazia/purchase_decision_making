/**
 * apple-value-engine
 *
 * 苹果产品价值分析与帕累托前沿计算引擎。
 * 纯函数, 零运行时依赖, 支持 Node / 浏览器 / 微信小程序三端。
 *
 * 用法:
 *   import { loadConstants, computeParetoFrontier } from 'apple-value-engine';
 *   const constants = loadConstants(jsonText);
 *   const result = computeParetoFrontier(constants, {
 *     category: 'mac-mini',
 *     budget: 5000,
 *     holdingYears: [2, 3, 4],
 *     buyTiming: 'used',
 *     performanceFloor: 0.7,
 *   });
 */
export { loadConstants, getKeyMap } from './load.js';
export { getRetentionRate, } from './retention.js';
export { computePerformance, getChipCoefficient, getChipMultiCoreScore, getCategoryFlagshipScore, getMemoryWeight, getStorageWeight, getEffectiveR, } from './performance.js';
export type { PerformanceResult } from './performance.js';
export { computeMonthlyCost, computeMaintenanceCost, getCurrentNewPrice, getBuyPrice, } from './cost.js';
export type { CostBreakdown } from './cost.js';
export { computeParetoFrontier } from './pareto.js';
export { ConstantsValidationError, } from './types.js';
export type { Constants, DecisionParams, PlanPoint, ParetoFrontierResult, BuyTiming, RetentionCurves, ChipBenchmarks, ChipGenerationAssumptions, ExperienceWeights, ReleaseRhythm, NewReleaseImpact, MaintenanceCosts, PerformanceFormula, ProductReleaseDates, CostFormula, MarketSnapshots, MarketSnapshotEntry, DesignTokens, } from './types.js';
//# sourceMappingURL=index.d.ts.map