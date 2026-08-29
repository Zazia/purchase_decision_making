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
 * 解析 releaseDateKey 对应的发布日期字符串 (productReleaseDates 查找, 含模糊兜底)。
 * 查找顺序: 精确键 → 去屏幕尺寸段 → 芯片名紧凑/展开互试 → 同品类前缀+完整芯片后缀搜索。
 * (从 pareto.ts computeAgeMonths 抽出共享: v4.2 锚定品识别复用同一解析路径)
 * @returns 发布日期字符串 (如 "2026-08"), 未找到返回 undefined
 */
export declare function resolveProductReleaseDate(constants: Constants, releaseDateKey: string): string | undefined;
/**
 * 锚定品识别 (v4.2): 候选的 productReleaseDates 发布月 ≥ releasePlan.nextReleaseMonth
 * 即视为「属于本次待发布批次」的锚定品 (如已官宣未发售、快照已录入官宣价的新品)。
 * - 类型 C 生成时跳过锚定品 (锚定品自身价不得套用「老款 × (1+锚涨幅) × (1−冲击)」公式);
 * - 锚定品自身作为类型 A 买入时, 残值不施加本场发布的冲击 (贬值由保值率曲线覆盖)。
 * 发布月无法解析时返回 false (保守保留旧行为, 不因识别失败丢弃候选)。
 */
export declare function isAnchorCandidate(constants: Constants, releaseDateKey: string, releasePlan: ReleasePlan): boolean;
/**
 * 调整后冲击幅度 = 品类冲击历史均值 × (1 + 价格传导因子) (v4.1, SOP §9.4)
 * 传导因子: 锚涨幅>0 (已官宣) 时按锚涨幅查表 (官宣价是事实, 不依赖宏观触发);
 * 否则沿用 v3.8 逻辑 (宏观触发的预测涨幅, 未触发为 0)。
 * 从 predictDiscountedOldPrice 抽出共享 (v4.2 类型 A 残值冲击复用同一口径)。
 */
export declare function computeAdjustedImpact(constants: Constants, releasePlan: ReleasePlan, macroContext?: MacroContext): number;
/**
 * 类型 A 残值冲击调整乘数 (v4.2, SKILL.md 步骤5.4-4 / spec「月均成本计算」)
 *
 * 触发条件全部满足时返回 保值率乘数 = 1 − 调整后冲击 × 残值调整时变因子, 否则返回 1:
 *   1. 存在 nextReleaseMonth, 且 分析月 ≤ 发布月 ≤ 分析月 + 持有月数 (持有期内有新品发布);
 *   2. 候选非锚定品 (买新品的人不受「新品发布」冲击; 新品自身贬值由保值率曲线覆盖);
 *   3. 品类冲击均值 > 0。
 * 残值调整时变因子按「卖出点距新品发布的整月数」= (分析月 + 持有月数) − 发布月 查
 * `_冲击时变曲线_v3.8` 的「残值调整因子」。只计下一次已知发布一次, 更远期换代贬值
 * 由保值率曲线 (经验曲线, 含平均换代贬值) 覆盖。
 */
export declare function computeResidualImpactFactor(constants: Constants, releaseDateKey: string, releasePlan: ReleasePlan, macroContext: MacroContext | undefined, holdingMonths: number): number;
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