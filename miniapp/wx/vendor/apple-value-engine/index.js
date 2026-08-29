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
export { computePerformance, computePerformanceForNewProduct, getChipCoefficient, getChipMultiCoreScore, getCategoryFlagshipScore, getMemoryWeight, getStorageWeight, getEffectiveR, } from './performance.js';
export { computeMonthlyCost, computeMonthlyCostForWaitCandidate, computeMaintenanceCost, getCurrentNewPrice, getBuyPrice, } from './cost.js';
export { computeParetoFrontier, recomputeFrontierFromPoints, buildPlanPointFromInputs } from './pareto.js';
export { parseReleasePlan, computeWaitMonths, predictNewProductPrice, predictDiscountedOldPrice, lookupImpactTimeVaryingFactor, shouldGenerateWaitCandidates, isAnchorCandidate, computeAdjustedImpact, computeResidualImpactFactor, resolveProductReleaseDate, } from './release.js';
export { ConstantsValidationError, } from './types.js';
//# sourceMappingURL=index.js.map