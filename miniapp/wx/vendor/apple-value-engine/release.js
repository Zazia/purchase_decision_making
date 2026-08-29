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
    // v4.1: 已官宣时传导因子按锚涨幅查表 (官宣价是事实, 不依赖宏观触发);
    //       未官宣时沿用 v3.8 逻辑 (宏观触发的预测涨幅, 否则 0)
    const anchorHike = releasePlan.anchorHike ?? 0;
    const transmissionHike = anchorHike > 0
        ? anchorHike
        : resolveHikeForTransmission(releasePlan, macroContext);
    const transmissionFactor = lookupTransmissionFactor(constants, transmissionHike);
    const adjustedImpact = historicalMean * (1 + transmissionFactor);
    // 新品发布后到买入的月数 = 上市到货延迟(月) × 宏观产能因子
    const delayMonths = Math.ceil(releasePlan.baselineDelayDays / 30);
    const monthsSinceRelease = delayMonths * releasePlan.macroCapacityFactor;
    const timeVaryingFactor = lookupImpactTimeVaryingFactor(constants, Math.ceil(monthsSinceRelease - 1e-9)).buyPriceDropFactor;
    const drop = adjustedImpact * timeVaryingFactor;
    return oldCandBuyPrice * (1 + anchorHike) * (1 - drop);
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