import { getCurrentNewPrice } from './cost.js';
// ============================================================================
// 公共解析函数
// ============================================================================
/**
 * 从 constants 解析某品类的发布计划。
 * @param categoryKey 市场快照品类键 (如 "Mac_mini" / "iPhone_Pro")
 * @param macroContext 宏观状态 (缺省按 none 处理)
 * @returns ReleasePlan, 若品类无发布节奏信息返回 null
 */
export function parseReleasePlan(constants, categoryKey, macroContext) {
    let rhythm = lookupByCategory(constants.releaseRhythm, categoryKey);
    let resolvedCategoryKey = categoryKey;
    // 父品类兜底: lookupByCategory 找不到时, 搜索以 categoryKey 为前缀的子品类
    // 优先选 confidence 最高的子品类 (high > medium > low)
    if (!rhythm) {
        const prefix = categoryKey.toLowerCase() + '_';
        const subKeys = Object.keys(constants.releaseRhythm ?? {})
            .filter((k) => !k.startsWith('_') && k.toLowerCase().startsWith(prefix));
        let bestConf = -1;
        for (const sk of subKeys) {
            const conf = lookupConfidence(constants, sk);
            const rank = conf === 'high' ? 2 : conf === 'medium' ? 1 : 0;
            if (rank > bestConf) {
                bestConf = rank;
                resolvedCategoryKey = sk;
                rhythm = constants.releaseRhythm[sk];
            }
        }
    }
    if (!rhythm)
        return null;
    const nextReleaseMonth = parseReleaseMonth(rhythm['下一次预计']);
    const releaseConfidence = lookupConfidence(constants, resolvedCategoryKey);
    const { baselineDelayDays, pessimisticDelayDays } = lookupDelay(constants, resolvedCategoryKey);
    const macroCapacityFactor = lookupMacroCapacityFactor(constants, macroContext);
    const macroTriggered = isMacroTriggered(macroContext);
    const hikeInfo = lookupPriceHike(constants, resolvedCategoryKey);
    // 预测涨幅: 仅在宏观事件触发且品类未涨价时使用预测中位数; 否则 0 (同档同价)
    const predictedPriceHike = macroTriggered && !hikeInfo.hasHikeOccurred
        ? hikeInfo.median
        : 0;
    // v4.1 锚涨幅: 新品已官宣定价时 = 中位数 (相对老款现行官方价口径), 否则 0
    const anchorHike = hikeInfo.isAnnounced ? hikeInfo.median : 0;
    return {
        category: resolvedCategoryKey,
        nextReleaseMonth,
        releaseConfidence,
        baselineDelayDays,
        pessimisticDelayDays,
        macroCapacityFactor,
        predictedPriceHike,
        hasHikeOccurred: hikeInfo.hasHikeOccurred,
        anchorHike,
    };
}
/**
 * 计算等待月数 = max(0, 预计发布月 - 分析月) + 上市到货延迟(月) × 宏观产能因子
 * 上市到货延迟(月) = ceil(baselineDelayDays / 30)
 */
export function computeWaitMonths(releasePlan, macroContext) {
    if (!releasePlan.nextReleaseMonth)
        return 0;
    const analysisMonth = resolveAnalysisMonth(macroContext, undefined);
    if (!analysisMonth)
        return 0;
    const monthsToRelease = diffMonths(analysisMonth, releasePlan.nextReleaseMonth);
    const monthsToReleaseClamped = Math.max(0, monthsToRelease);
    const delayMonths = Math.ceil(releasePlan.baselineDelayDays / 30);
    const waitMonths = monthsToReleaseClamped + delayMonths * releasePlan.macroCapacityFactor;
    // 向上取整为整数月 (等待期保守向上取整)
    return Math.ceil(waitMonths - 1e-9);
}
/**
 * 类型 B 买入价预测 (新品价格预测模型)
 * - hasHikeOccurred=true: 直接用快照当前同档老款官方价
 * - 否则: 当前同档老款官方价 × (1 + 预测涨幅中位数)
 *   未触发宏观事件时 predictedPriceHike=0, 即回退「同档同价假设」
 */
export function predictNewProductPrice(constants, categoryKey, releasePlan) {
    const currentOfficialPrice = getCurrentNewPrice(constants, categoryKey);
    if (releasePlan.hasHikeOccurred) {
        return currentOfficialPrice;
    }
    const hike = releasePlan.predictedPriceHike ?? 0;
    return currentOfficialPrice * (1 + hike);
}
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
export function predictDiscountedOldPrice(constants, oldCandBuyPrice, releasePlan, macroContext) {
    const historicalMean = lookupImpactMean(constants, releasePlan.category);
    if (historicalMean <= 0)
        return oldCandBuyPrice;
    const adjustedImpact = computeAdjustedImpact(constants, releasePlan, macroContext);
    const anchorHike = releasePlan.anchorHike ?? 0;
    // 新品发布后到买入的月数 = 上市到货延迟(月) × 宏观产能因子
    const delayMonths = Math.ceil(releasePlan.baselineDelayDays / 30);
    const monthsSinceRelease = delayMonths * releasePlan.macroCapacityFactor;
    const timeVaryingFactor = lookupImpactTimeVaryingFactor(constants, Math.ceil(monthsSinceRelease - 1e-9)).buyPriceDropFactor;
    const drop = adjustedImpact * timeVaryingFactor;
    return oldCandBuyPrice * (1 + anchorHike) * (1 - drop);
}
// ============================================================================
// v4.2 锚定品识别与类型 A 残值冲击调整
// ============================================================================
/**
 * 解析 releaseDateKey 对应的发布日期字符串 (productReleaseDates 查找, 含模糊兜底)。
 * 查找顺序: 精确键 → 去屏幕尺寸段 → 芯片名紧凑/展开互试 → 同品类前缀+完整芯片后缀搜索。
 * (从 pareto.ts computeAgeMonths 抽出共享: v4.2 锚定品识别复用同一解析路径)
 * @returns 发布日期字符串 (如 "2026-08"), 未找到返回 undefined
 */
export function resolveProductReleaseDate(constants, releaseDateKey) {
    let releaseDate = constants.productReleaseDates[releaseDateKey];
    // 模糊兜底 1: 去掉屏幕尺寸段再试 (MacBook_Pro_14_M3Pro → MacBook_Pro_M3Pro)
    if (!releaseDate) {
        const withoutScreen = releaseDateKey.replace(/_\d+_(?=[^_]+$)/, '_');
        if (withoutScreen !== releaseDateKey) {
            releaseDate = constants.productReleaseDates[withoutScreen];
        }
    }
    // 模糊兜底 2: 芯片名紧凑/展开互试 (A17_Pro → A17Pro, M1_Pro → M1Pro)
    if (!releaseDate) {
        const compactKey = releaseDateKey.replace(/_(Pro|Max|Ultra)/g, '$1');
        if (compactKey !== releaseDateKey) {
            releaseDate = constants.productReleaseDates[compactKey];
        }
    }
    if (!releaseDate) {
        const expandedKey = releaseDateKey.replace(/(?<!_)(Pro|Max|Ultra)/g, '_$1');
        if (expandedKey !== releaseDateKey) {
            releaseDate = constants.productReleaseDates[expandedKey];
        }
    }
    // 模糊兜底 3: 按完整芯片名搜索其他尺寸/子品类的发布日期
    // (如 "MacBook_Pro_14_M3Pro" 不存在, 但 "MacBook_Pro_16_M3Pro" 存在)
    // P2 修复 (2026-08-27): 原实现取最后一段作芯片名, "Mac_mini_M4_Pro" 的末段是裸 "Pro",
    // endsWith("_Pro") 会错配任意 Pro 型号 (曾把 M4_Pro 错配到 M2_Pro, 机龄虚增 21 个月)。
    // 现改为: 末段为裸 Pro/Max/Ultra 后缀时与前一段合并为完整芯片名 (M4_Pro),
    // 且品类前缀同时去掉芯片段与屏幕尺寸段, 避免跨品类泄漏。
    if (!releaseDate) {
        const segments = releaseDateKey.split('_');
        // 芯片段: 末尾若为裸 Pro/Max/Ultra, 与前一段合并 (M4_Pro / M5_Max)
        const chipSegCount = /^(Pro|Max|Ultra)$/.test(segments[segments.length - 1] ?? '') ? 2 : 1;
        const chip = segments.slice(-chipSegCount).join('_');
        // 品类前缀: 去掉芯片段; 若剩余末段是纯数字(屏幕尺寸)也去掉
        const prefixSegments = segments.slice(0, -chipSegCount);
        if (prefixSegments.length && /^\d+$/.test(prefixSegments[prefixSegments.length - 1] ?? '')) {
            prefixSegments.pop();
        }
        const categoryPrefix = prefixSegments.join('_');
        if (chip && categoryPrefix) {
            // 优先匹配同品类前缀 + 同完整芯片后缀
            for (const [key, val] of Object.entries(constants.productReleaseDates)) {
                if (key.startsWith(categoryPrefix + '_') && key.endsWith('_' + chip) && typeof val === 'string') {
                    releaseDate = val;
                    break;
                }
            }
        }
    }
    return typeof releaseDate === 'string' ? releaseDate : undefined;
}
/**
 * 锚定品识别 (v4.2): 候选的 productReleaseDates 发布月 ≥ releasePlan.nextReleaseMonth
 * 即视为「属于本次待发布批次」的锚定品 (如已官宣未发售、快照已录入官宣价的新品)。
 * - 类型 C 生成时跳过锚定品 (锚定品自身价不得套用「老款 × (1+锚涨幅) × (1−冲击)」公式);
 * - 锚定品自身作为类型 A 买入时, 残值不施加本场发布的冲击 (贬值由保值率曲线覆盖)。
 * 发布月无法解析时返回 false (保守保留旧行为, 不因识别失败丢弃候选)。
 */
export function isAnchorCandidate(constants, releaseDateKey, releasePlan) {
    const next = releasePlan.nextReleaseMonth;
    if (!next)
        return false;
    const releaseDate = resolveProductReleaseDate(constants, releaseDateKey);
    if (!releaseDate)
        return false;
    const m = releaseDate.match(/^(\d{4})-(\d{1,2})/);
    if (!m)
        return false;
    const releaseMonth = `${m[1]}-${m[2].padStart(2, '0')}`;
    // 候选发布月 ≥ nextReleaseMonth (diffMonths(from, to) = to − from)
    return diffMonths(next, releaseMonth) >= 0;
}
/**
 * 调整后冲击幅度 = 品类冲击历史均值 × (1 + 价格传导因子) (v4.1, SOP §9.4)
 * 传导因子: 锚涨幅>0 (已官宣) 时按锚涨幅查表 (官宣价是事实, 不依赖宏观触发);
 * 否则沿用 v3.8 逻辑 (宏观触发的预测涨幅, 未触发为 0)。
 * 从 predictDiscountedOldPrice 抽出共享 (v4.2 类型 A 残值冲击复用同一口径)。
 */
export function computeAdjustedImpact(constants, releasePlan, macroContext) {
    const historicalMean = lookupImpactMean(constants, releasePlan.category);
    if (historicalMean <= 0)
        return 0;
    const anchorHike = releasePlan.anchorHike ?? 0;
    const transmissionHike = anchorHike > 0
        ? anchorHike
        : resolveHikeForTransmission(releasePlan, macroContext);
    const transmissionFactor = lookupTransmissionFactor(constants, transmissionHike);
    return historicalMean * (1 + transmissionFactor);
}
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
export function computeResidualImpactFactor(constants, releaseDateKey, releasePlan, macroContext, holdingMonths) {
    const next = releasePlan.nextReleaseMonth;
    if (!next)
        return 1;
    if (isAnchorCandidate(constants, releaseDateKey, releasePlan))
        return 1;
    const analysisMonth = resolveAnalysisMonth(macroContext, constants.lastUpdated);
    if (!analysisMonth)
        return 1;
    const monthsToRelease = diffMonths(analysisMonth, next);
    if (monthsToRelease < 0 || monthsToRelease > holdingMonths)
        return 1;
    const adjustedImpact = computeAdjustedImpact(constants, releasePlan, macroContext);
    if (adjustedImpact <= 0)
        return 1;
    // 卖出点距新品发布的整月数
    const monthsSinceReleaseAtSell = holdingMonths - monthsToRelease;
    const { residualFactor } = lookupImpactTimeVaryingFactor(constants, monthsSinceReleaseAtSell);
    return 1 - adjustedImpact * residualFactor;
}
/**
 * 查冲击时变曲线, 返回 { 残值调整因子, 买入价下降因子 }
 * 按「距新品发布的月数」查表: 1月内/3月内/6月内/12月内/12月后
 *
 * 注: monthsSinceRelease 语义由调用方决定:
 *   - 类型 A 残值调整: 距下次新品发布的剩余月数
 *   - 类型 C 买入价下降: 新品发布后到买入的月数
 */
export function lookupImpactTimeVaryingFactor(constants, monthsSinceRelease) {
    const curve = constants.impactTimeVaryingCurve;
    const period = resolvePeriod(monthsSinceRelease);
    const fallback = TIME_VARYING_FALLBACK[period] ?? { residualFactor: 0.1, buyPriceDropFactor: 0.2 };
    if (!curve)
        return fallback;
    const entry = curve[period];
    if (entry && typeof entry === 'object') {
        const e = entry;
        return {
            residualFactor: typeof e.残值调整因子 === 'number' ? e.残值调整因子 : fallback.residualFactor,
            buyPriceDropFactor: typeof e.买入价下降因子 === 'number' ? e.买入价下降因子 : fallback.buyPriceDropFactor,
        };
    }
    return fallback;
}
/**
 * 是否应生成类型 B/C 候选
 * 距下次发布 ≤ 90 天 (3 月) 且 releaseConfidence !== 'low' 时返回 true
 */
export function shouldGenerateWaitCandidates(releasePlan, macroContext) {
    if (!releasePlan.nextReleaseMonth)
        return false;
    if (releasePlan.releaseConfidence === 'low')
        return false;
    const analysisMonth = resolveAnalysisMonth(macroContext, undefined);
    if (!analysisMonth)
        return false;
    const monthsToRelease = diffMonths(analysisMonth, releasePlan.nextReleaseMonth);
    // 距发布 0~3 月 (≤90 天) 才生成; 已过发布月 (负值) 不生成
    return monthsToRelease >= 0 && monthsToRelease <= 3;
}
// ============================================================================
// 内部辅助: 品类键查找 (大小写不敏感 + 最长前缀匹配)
// ============================================================================
/**
 * 在以品类为键的表中查找, 大小写不敏感:
 *   1. 精确匹配 (大小写不敏感)
 *   2. 最长前缀匹配 (categoryKey 以 table key 开头, 如 "iPhone_Pro" → "iPhone")
 */
function lookupByCategory(table, categoryKey) {
    if (!table)
        return undefined;
    const lower = categoryKey.toLowerCase();
    // 1. 精确匹配
    for (const [k, v] of Object.entries(table)) {
        if (k.toLowerCase() === lower)
            return v;
    }
    // 2. 最长前缀匹配 (categoryKey 以 k 开头)
    let bestKey = '';
    let bestVal;
    for (const [k, v] of Object.entries(table)) {
        if (k.startsWith('_'))
            continue;
        const kl = k.toLowerCase();
        if (lower.startsWith(kl) && k.length > bestKey.length) {
            bestKey = k;
            bestVal = v;
        }
    }
    return bestVal;
}
// ============================================================================
// 内部辅助: 字段解析
// ============================================================================
/** "10天" → 10, "30天(Pro Max常缺货)" → 30 */
function parseDays(s) {
    if (typeof s === 'number')
        return s;
    if (typeof s !== 'string')
        return 0;
    const m = s.match(/(\d+)/);
    return m ? Number(m[1]) : 0;
}
/** "38%" → 0.38, "12%" → 0.12, "0.38" → 0.38, "-25%(...)" → -0.25 (传导因子表为负值) */
function parsePercent(s) {
    if (typeof s === 'number')
        return s;
    if (typeof s !== 'string')
        return 0;
    const m = s.match(/(-?\d+(?:\.\d+)?)/);
    if (!m)
        return 0;
    const n = Number(m[1]);
    // 含 "%" 视为百分比, 否则视为已归一化小数
    return s.includes('%') ? n / 100 : n;
}
/**
 * 解析「下一次预计」字段为 YYYY-MM
 *   "2026-09 iPhone 18 Pro" → "2026-09"
 *   "2026-10" → "2026-10"
 *   "2027" → "2027-01" (仅年份, 默认 1 月)
 *   "2026年第三季度 M5" → "2026-07" (Q1=1/Q2=4/Q3=7/Q4=10)
 *   无效 → null
 */
function parseReleaseMonth(s) {
    if (typeof s !== 'string' || s.length === 0)
        return null;
    // 优先匹配 YYYY-MM
    const ym = s.match(/(\d{4})-(\d{1,2})/);
    if (ym)
        return `${ym[1]}-${ym[2].padStart(2, '0')}`;
    // 季度: "第三季度" / "第二季度" ...
    const quarterMatch = s.match(/(\d{4})[^0-9]*第([一二三四])季度/);
    if (quarterMatch) {
        const year = quarterMatch[1];
        const qMap = { '一': 1, '二': 4, '三': 7, '四': 10 };
        const month = qMap[quarterMatch[2]] ?? 1;
        return `${year}-${String(month).padStart(2, '0')}`;
    }
    // 仅年份
    const yearOnly = s.match(/^(\d{4})\b/);
    if (yearOnly)
        return `${yearOnly[1]}-01`;
    return null;
}
/** 月份差: 从 fromMonth 到 toMonth 的月数 (toMonth - fromMonth) */
function diffMonths(fromMonth, toMonth) {
    const f = parseYearMonth(fromMonth);
    const t = parseYearMonth(toMonth);
    if (!f || !t)
        return 0;
    return (t.year - f.year) * 12 + (t.month - f.month);
}
function parseYearMonth(s) {
    const m = s.match(/^(\d{4})-(\d{1,2})/);
    if (!m)
        return null;
    return { year: Number(m[1]), month: Number(m[2]) };
}
/** 按月数映射到冲击时变曲线的时段键 */
function resolvePeriod(months) {
    if (months <= 1)
        return '1月内';
    if (months <= 3)
        return '3月内';
    if (months <= 6)
        return '6月内';
    if (months <= 12)
        return '12月内';
    return '12月后';
}
const TIME_VARYING_FALLBACK = {
    '1月内': { residualFactor: 0.95, buyPriceDropFactor: 1 },
    '3月内': { residualFactor: 0.85, buyPriceDropFactor: 0.95 },
    '6月内': { residualFactor: 0.6, buyPriceDropFactor: 0.8 },
    '12月内': { residualFactor: 0.3, buyPriceDropFactor: 0.5 },
    '12月后': { residualFactor: 0.1, buyPriceDropFactor: 0.2 },
};
// ============================================================================
// 内部辅助: constants 字段查找
// ============================================================================
/** 查找品类的发布时间预测置信度 */
function lookupConfidence(constants, categoryKey) {
    const validation = constants.releaseTimeValidation;
    if (!validation)
        return 'low';
    // 键名带日期后缀 (如 _当前校验结果_2026-08-02), 取第一个以 _当前校验结果_ 开头的子表
    let results;
    for (const [k, v] of Object.entries(validation)) {
        if (k.startsWith('_当前校验结果_') && v && typeof v === 'object') {
            results = v;
            break;
        }
    }
    if (!results)
        return 'low';
    const entry = lookupByCategory(results, categoryKey);
    const conf = entry?.置信度;
    // 前缀匹配: 数据侧存在复合格式如 "高(已官宣)"、"中(主流媒体爆料,非官宣)",
    // 严格等值会把它们判为 low, 导致已官宣品类的类型 B/C 等待候选整体缺失
    if (conf?.startsWith('高'))
        return 'high';
    if (conf?.startsWith('中'))
        return 'medium';
    return 'low';
}
/** 查找品类的上市到货延迟 (基线/悲观) */
function lookupDelay(constants, categoryKey) {
    const table = constants.waitPeriodModel?._分品类上市到货延迟_基线;
    const entry = lookupByCategory(table, categoryKey);
    if (!entry)
        return { baselineDelayDays: 0, pessimisticDelayDays: 0 };
    return {
        baselineDelayDays: parseDays(entry.中位),
        pessimisticDelayDays: parseDays(entry.悲观),
    };
}
/**
 * 查找品类的新品价格预测涨幅 (中位数 + 涨价状态)
 * - hasHikeOccurred: "已发生/已涨价/已官宣" 均为 true (快照官方价已含涨价, 不再外推)
 * - isAnnounced: "已官宣" (v4.1) — 新品官宣定价, 中位数即锚涨幅 (相对老款现行官方价)
 */
function lookupPriceHike(constants, categoryKey) {
    const table = constants.pricePredictionModel?._分品类预测涨幅表;
    if (!table)
        return { median: 0, hasHikeOccurred: false, isAnnounced: false };
    // 键名带日期后缀 (如 _当前值_2026-08), 取第一个以 _当前值_ 开头的子表
    let current;
    for (const [k, v] of Object.entries(table)) {
        if (k.startsWith('_当前值_') && v && typeof v === 'object') {
            current = v;
            break;
        }
    }
    if (!current)
        return { median: 0, hasHikeOccurred: false, isAnnounced: false };
    const entry = lookupByCategory(current, categoryKey);
    if (!entry)
        return { median: 0, hasHikeOccurred: false, isAnnounced: false };
    const trend = entry.预测涨幅 ?? '';
    const isAnnounced = trend.includes('已官宣');
    const hasHikeOccurred = isAnnounced || trend.includes('已发生') || trend.includes('已涨价');
    const median = parsePercent(entry.中位数);
    return { median, hasHikeOccurred, isAnnounced };
}
/** 查找品类的新品发布对老款冲击历史均值 (如 "38%" → 0.38) */
function lookupImpactMean(constants, categoryKey) {
    const table = constants.newReleaseImpact;
    const entry = lookupByCategory(table, categoryKey);
    if (!entry || typeof entry !== 'object')
        return 0;
    const e = entry;
    return parsePercent(e.均值);
}
/** 按新品涨幅查价格传导因子 (返回小数, 如 -0.35) */
function lookupTransmissionFactor(constants, hike) {
    const table = constants.macroFactorAdjustment?._价格传导因子表;
    if (!table) {
        return defaultTransmissionFactor(hike);
    }
    // 按区间查表, 区间键形如 "新品涨幅5-15%"
    const key = resolveTransmissionKey(hike);
    const raw = table[key];
    if (typeof raw === 'string')
        return parsePercent(raw);
    // 表缺失时回退默认
    return defaultTransmissionFactor(hike);
}
function resolveTransmissionKey(hike) {
    const pct = hike * 100;
    if (pct <= 0)
        return '新品涨幅≤0%';
    if (pct <= 5)
        return '新品涨幅0-5%';
    if (pct <= 15)
        return '新品涨幅5-15%';
    if (pct <= 30)
        return '新品涨幅15-30%';
    return '新品涨幅>30%';
}
function defaultTransmissionFactor(hike) {
    const pct = hike * 100;
    if (pct <= 0)
        return 0;
    if (pct <= 5)
        return -0.05;
    if (pct <= 15)
        return -0.15;
    if (pct <= 30)
        return -0.25;
    return -0.35;
}
// ============================================================================
// 内部辅助: 宏观状态解析
// ============================================================================
/** 宏观事件是否触发 (storageSuperCycleStage !== 'none' 或 hasGlobalPriceHike) */
function isMacroTriggered(macroContext) {
    if (!macroContext)
        return false;
    return macroContext.storageSuperCycleStage !== 'none' || macroContext.hasGlobalPriceHike;
}
/** 宏观产能因子: 来自 _宏观产能延迟_v3.8._宏观产能因子表, 按 storageSuperCycleStage 查表 */
function lookupMacroCapacityFactor(constants, macroContext) {
    const stage = macroContext?.storageSuperCycleStage ?? 'none';
    const table = constants.waitPeriodModel?.['_宏观产能延迟_v3.8']?._宏观产能因子表;
    const chineseKey = STAGE_TO_CHINESE_KEY[stage];
    if (table && chineseKey) {
        const raw = table[chineseKey]?.因子;
        if (typeof raw === 'string') {
            const m = raw.match(/(\d+(?:\.\d+)?)/);
            if (m)
                return Number(m[1]);
        }
    }
    // 回退默认: ongoing=2.0, peaking=1.5, easing=1.0, none=1.0
    return DEFAULT_MACRO_CAPACITY_FACTOR[stage];
}
const STAGE_TO_CHINESE_KEY = {
    ongoing: '存储超级周期_进行中',
    peaking: '存储超级周期_见顶中',
    easing: '存储超级周期_缓解',
    none: '无宏观事件',
};
const DEFAULT_MACRO_CAPACITY_FACTOR = {
    ongoing: 2.0,
    peaking: 1.5,
    easing: 1.0,
    none: 1.0,
};
/**
 * 解析用于「价格传导因子」的涨幅:
 * - 已涨价品类用实际涨幅中位数
 * - 未涨价但宏观触发用预测涨幅
 * - 未触发宏观事件用 0
 */
function resolveHikeForTransmission(releasePlan, macroContext) {
    if (!isMacroTriggered(macroContext))
        return 0;
    return releasePlan.predictedPriceHike ?? 0;
}
/** 解析分析月: 优先 macroContext.analysisMonth, 否则用 constants.lastUpdated */
function resolveAnalysisMonth(macroContext, constantsLastUpdated) {
    if (macroContext?.analysisMonth)
        return macroContext.analysisMonth;
    if (constantsLastUpdated) {
        const m = constantsLastUpdated.match(/^(\d{4}-\d{1,2})/);
        if (m)
            return m[1];
    }
    return null;
}
//# sourceMappingURL=release.js.map