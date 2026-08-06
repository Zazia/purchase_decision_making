/**
 * 帕累托前沿筛选模块
 *
 * 在(月均成本, 持有期平均性能满足度)二维平面上筛选非劣解。
 * 前沿点定义: 不存在其他点同时满足「成本更低且性能更高」(至少一个严格不等)。
 * 用户偏好(性能地板/预算上限)仅用于在前沿上截取推荐区间, 不改变前沿本身。
 */
import type { Constants, DecisionParams } from './types.js';
import type { ParetoFrontierResult } from './types.js';
/**
 * 计算帕累托前沿
 *
 * @param constants 常量数据(由 loadConstants 加载)
 * @param params 决策参数
 * @returns { frontier, dominated, recommendationRange }
 */
export declare function computeParetoFrontier(constants: Constants, params: DecisionParams): ParetoFrontierResult;
//# sourceMappingURL=pareto.d.ts.map