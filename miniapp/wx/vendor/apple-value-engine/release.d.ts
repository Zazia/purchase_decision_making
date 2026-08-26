/**
 * v3.8 新品发布期模块 (release window)
 *
 * 实现 SKILL.md 步骤 1/2/5/9.3 定义的 v3.8 机制:
 *   - 缺货等待期模型 (类型 B/C 的等待月数)
 *   - 新品价格预测模型 (类型 B 买入价)
 *   - 冲击时变曲线 + 宏观因子调整 (类型 C 买入价)
 *
 * 全部为纯函数, 数据来自 constants 的 v3.8 字段, 宏观状态由调用方注入。
 * 引擎不发起网络请求。
 */
import type { Constants, MacroContext, ReleasePlan } from './types.js';
/**
 * 从 constants 解析某品类的发布计划。
 * @param categoryKey 市场快照品类键 (如 "Mac_mini" / "iPhone_Pro")
 * @param macroContext 宏观状态 (缺省按 none 处理)
 * @returns ReleasePlan, 若品类无发布节奏信息返回 null
 */
export declare function parseReleasePlan(constants: Constants, categoryKey: string, macroContext?: MacroContext): ReleasePlan | null;
/**
 * 计算等待月数 = max(0, 预计发布月 - 分析月) + 上市到货延迟(月) × 宏观产能因子
 * 上市到货延迟(月) = ceil(baselineDelayDays / 30)
 */
export declare function computeWaitMonths(releasePlan: ReleasePlan, macroContext?: MacroContext): number;
/**
 * 类型 B 买入价预测 (新品价格预测模型)
 * - hasHikeOccurred=true: 直接用快照当前同档老款官方价
 * - 否则: 当前同档老款官方价 × (1 + 预测涨幅中位数)
 *   未触发宏观事件时 predictedPriceHike=0, 即回退「同档同价假设」
 */
export declare function predictNewProductPrice(constants: Constants, categoryKey: string, releasePlan: ReleasePlan): number;
/**
 * 类型 C 买入价预测 (v4.1 锚定-冲击双因子模型, 见 SKILL.md §9.4)
 * 类型 C 买入价 = 当前市场价 × (1 + 锚涨幅) × (1 - 调整后冲击幅度 × 冲击时变因子)
 *   锚涨幅 = (新品官宣价 - 老款现行官方价) / 老款现行官方价
 *            已官宣时 = 预测涨幅表中位数; 未官宣时 = 0 (退化 v3.8 形式)
 *   调整后冲击幅度 = 历史均值 × (1 + 价格传导因子), 传导因子按锚涨幅查表 (锚涨幅>0 时)
 *   冲击时变因子 = 按新品发布后到买入的月数查「买入价下降因子」
 *
 * 注: 本公式为 §9.4 情景A (全额传导) 口径, 三情景加权与失效判定仍走 SOP 文字路径。
 *
 * @param oldCandBuyPrice 老款当前市场价 (通常是二手闲鱼中位价)
 */
export declare function predictDiscountedOldPrice(constants: Constants, oldCandBuyPrice: number, releasePlan: ReleasePlan, macroContext?: MacroContext): number;
/**
 * 查冲击时变曲线, 返回 { 残值调整因子, 买入价下降因子 }
 * 按「距新品发布的月数」查表: 1月内/3月内/6月内/12月内/12月后
 *
 * 注: monthsSinceRelease 语义由调用方决定:
 *   - 类型 A 残值调整: 距下次新品发布的剩余月数
 *   - 类型 C 买入价下降: 新品发布后到买入的月数
 */
export declare function lookupImpactTimeVaryingFactor(constants: Constants, monthsSinceRelease: number): {
    residualFactor: number;
    buyPriceDropFactor: number;
};
/**
 * 是否应生成类型 B/C 候选
 * 距下次发布 ≤ 90 天 (3 月) 且 releaseConfidence !== 'low' 时返回 true
 */
export declare function shouldGenerateWaitCandidates(releasePlan: ReleasePlan, macroContext?: MacroContext): boolean;
//# sourceMappingURL=release.d.ts.map