/**
 * 月均成本计算模块
 *
 * 公式(来自 SKILL.md 步骤5 & constants.json "月均成本计算公式"):
 *   月均成本 = (买入价 − 预期卖出残值 + 持有期预期维修成本) / 持有月数
 *   预期卖出残值 = 调整后保值率 × 当前同品类新品价
 *   维修成本 = floor(持有月数 / 电池寿命周期) × 单次电池更换费 + 持有年数 × 年均故障维修费
 *
 * 注: 本模块计算"基础月均成本", 不含 v3.8 宏观因子调整(冲击时变曲线/价格传导)。
 *     v3.8 机制涉及实时宏观扫描, 不适合确定性引擎, 留给 skill 层处理。
 */
import type { Constants } from './types.js';
/** 月均成本计算结果 */
export interface CostBreakdown {
    /** 月均成本(元/月) */
    monthlyCost: number;
    /** 买入价(元) */
    buyPrice: number;
    /** 预期卖出残值(元) */
    residual: number;
    /** 持有期预期维修成本(元) */
    maintenanceCost: number;
    /** 卖出时机龄(月) */
    sellAgeMonths: number;
    /** 卖出时保值率(%, 0-100) */
    retentionRate: number;
    /** 当前同品类新品价(残值分母, 元) */
    currentNewPrice: number;
    /** 持有月数 */
    holdingMonths: number;
}
/**
 * 计算某机型在指定持有月数下的月均成本
 *
 * @param constants 常量数据
 * @param category 品类(中文, 如 "Mac_mini")
 * @param buyPrice 买入价(元)
 * @param currentAgeMonths 当前机龄(月)
 * @param holdingMonths 持有月数
 * @param currentNewPrice 当前同品类新品价(残值分母)
 */
export declare function computeMonthlyCost(constants: Constants, category: string, buyPrice: number, currentAgeMonths: number, holdingMonths: number, currentNewPrice: number): CostBreakdown;
/**
 * 计算持有期预期维修成本
 * = floor(持有月数 / 电池寿命周期) × 单次电池更换费 + 持有年数 × 年均故障维修费
 */
export declare function computeMaintenanceCost(constants: Constants, category: string, holdingMonths: number): number;
/**
 * 从市场快照中提取当前同品类新品价(残值分母)
 * 优先取 新品官方价, 其次取快照 _说明 中的残值分母
 */
export declare function getCurrentNewPrice(constants: Constants, category: string): number;
/**
 * 从市场快照中提取买入价
 * - 新品: 优先 京东国补到手价, 其次 官方价
 * - 二手: 优先 闲鱼中位价_二手同款, 其次 _参考
 */
export declare function getBuyPrice(entry: Constants['marketSnapshots'][string][string], buyTiming: 'new' | 'used'): number | null;
//# sourceMappingURL=cost.d.ts.map