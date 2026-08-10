/**
 * 帕累托前沿筛选模块
 *
 * 在(月均成本, 持有期平均性能满足度)二维平面上筛选非劣解。
 * 前沿点定义: 不存在其他点同时满足「成本更低且性能更高」(至少一个严格不等)。
 * 用户偏好(性能地板/预算上限)仅用于在前沿上截取推荐区间, 不改变前沿本身。
 */
import type { Constants, DecisionParams, PlanPoint, EditedPlanPoint, CustomPlanInputs, RecomputeParams } from './types.js';
import type { ParetoFrontierResult } from './types.js';
/**
 * 计算帕累托前沿
 *
 * @param constants 常量数据(由 loadConstants 加载)
 * @param params 决策参数
 * @returns { frontier, dominated, recommendationRange }
 */
export declare function computeParetoFrontier(constants: Constants, params: DecisionParams): ParetoFrontierResult;
/**
 * 按给定方案集重算帕累托前沿
 *
 * 与 `computeParetoFrontier` 的差异:
 *   - 不重新从 constants 市场快照提取候选 (extractCandidates)
 *   - 在调用方传入的 EditedPlanPoint[] 上做帕累托筛选与推荐区间截取
 *   - source='edited' 的方案用 editedBuyPrice 重算月均成本 (性能满足度不变)
 *   - source='custom' 的方案用 buildPlanPointFromInputs 重新构建 (因端内只有自定义字段)
 *   - source='original' 的方案直接复用原 PlanPoint (口径与原始计算一致)
 *   - excluded/deferred 的方案过滤掉, 不参与重算
 *
 * 口径一致性: 复用 selectFrontier / selectRecommendationRange / computeMonthlyCost /
 *   computePerformance, 保证「未改价重算 == 原始结果」(误差 ≤ 0.5 元 / ≤ 0.001)。
 *
 * @param constants 常量数据
 * @param params    决策参数 (用于推荐区间截取与 CAGR 透传)
 * @param editedPoints 用户编辑后的方案集 (含 original/edited/custom/excluded/deferred 标记)
 * @returns { frontier, dominated, recommendationRange }
 */
export declare function recomputeFrontierFromPoints(constants: Constants, params: RecomputeParams, editedPoints: EditedPlanPoint[]): ParetoFrontierResult;
/**
 * 按显式输入构建方案点 (供端内用户新增自定义方案 + recomputeFrontierFromPoints 共用)。
 *
 * 与 buildPlanPoint (从快照 Candidate 构建) 的差异:
 *   - 不依赖 constants.marketSnapshots 中的 modelKey, 由调用方传 model 字符串
 *   - 必须传 chip/memoryGb/storageGb/categoryKey, 芯片无法解析时抛 ConstantsValidationError
 *   - 用 buildPlanPoint 同款的成本/性能/系统支持期风险计算, 保证口径一致
 *
 * candidateType 默认 'A' (现在买); 类型 B/C 由调用方显式传入并附带 waitMonths。
 *
 * @throws ConstantsValidationError 当芯片无法在 chipBenchmarks 中匹配
 * @returns PlanPoint; 类型 C 且无 releaseDateKey 时返回 null (端内应在提交前避免此场景)
 */
export declare function buildPlanPointFromInputs(constants: Constants, inputs: CustomPlanInputs): PlanPoint | null;
//# sourceMappingURL=pareto.d.ts.map