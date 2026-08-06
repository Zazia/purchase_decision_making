"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeParetoFrontier = computeParetoFrontier;
const performance_js_1 = require("./performance.js");
const cost_js_1 = require("./cost.js");
/**
 * 计算帕累托前沿
 *
 * @param constants 常量数据(由 loadConstants 加载)
 * @param params 决策参数
 * @returns { frontier, dominated, recommendationRange }
 */
function computeParetoFrontier(constants, params) {
    const categoryKey = resolveCategoryKey(constants, params.category);
    const candidates = extractCandidates(constants, categoryKey, params.buyTiming);
    // 为每个候选机型 × 持有年数生成方案点
    const points = [];
    for (const cand of candidates) {
        for (const years of params.holdingYears) {
            const point = buildPlanPoint(constants, cand, years, categoryKey, params);
            if (point)
                points.push(point);
        }
    }
    // 帕累托前沿筛选
    const { frontier, dominated } = selectFrontier(points);
    // 推荐区间: 用户偏好截取
    const recommendationRange = selectRecommendationRange(frontier, params);
    return { frontier, dominated, recommendationRange };
}
/** 从市场快照提取候选机型 */
function extractCandidates(constants, categoryKey, buyTiming) {
    const snapshots = constants.marketSnapshots[categoryKey];
    if (!snapshots)
        return [];
    const candidates = [];
    for (const [modelKey, entry] of Object.entries(snapshots)) {
        const condition = buyTiming === 'new' ? '新品' : '二手';
        if (!modelKey.includes(condition))
            continue;
        const parsed = parseModelKey(modelKey, categoryKey);
        if (!parsed)
            continue;
        const buyPrice = (0, cost_js_1.getBuyPrice)(entry, buyTiming);
        if (buyPrice === null || buyPrice <= 0)
            continue;
        candidates.push({
            modelKey,
            chip: parsed.chip,
            memoryGb: parsed.memoryGb,
            storageGb: parsed.storageGb,
            buyTiming,
            buyPrice,
            releaseDateKey: parsed.releaseDateKey,
        });
    }
    return candidates;
}
/**
 * 解析机型 key, 如 "M4_16G_256G_新品" → { chip: "M4", memoryGb: 16, storageGb: 256, releaseDateKey: "Mac_mini_M4" }
 * 支持带屏幕尺寸的格式, 如 "M5_Pro_14寸_16G_512G_新品"
 */
function parseModelKey(modelKey, categoryKey) {
    // 去掉条件后缀
    const withoutCondition = modelKey.replace(/_(新品|二手)$/, '');
    const segments = withoutCondition.split('_');
    // 找内存和存储段(匹配 \d+G)
    const gbSegments = [];
    segments.forEach((seg, i) => {
        const m = seg.match(/^(\d+)G$/i);
        if (m)
            gbSegments.push({ index: i, value: Number(m[1]) });
    });
    if (gbSegments.length < 2)
        return null;
    const memoryGb = gbSegments[0].value;
    const storageGb = gbSegments[1].value;
    // 芯片 = 内存段之前的所有段, 去掉屏幕尺寸段(如 "13寸")
    const chipSegments = segments
        .slice(0, gbSegments[0].index)
        .filter((s) => !/^\d+寸$/.test(s));
    const chip = chipSegments.join('_');
    if (!chip)
        return null;
    // 发布日期 key: 如 "Mac_mini_M4", "Mac_mini_M2_Pro"
    const releaseDateKey = `${categoryKey}_${chip}`;
    return { chip, memoryGb, storageGb, releaseDateKey };
}
// ============================================================================
// 方案点构建
// ============================================================================
function buildPlanPoint(constants, cand, holdingYears, categoryKey, params) {
    const holdingMonths = holdingYears * 12;
    // 当前机龄(月)
    const currentAgeMonths = computeAgeMonths(constants, cand.releaseDateKey);
    if (currentAgeMonths < 0)
        return null;
    // 当前同品类新品价(残值分母)
    const currentNewPrice = (0, cost_js_1.getCurrentNewPrice)(constants, categoryKey);
    // 月均成本
    const cost = (0, cost_js_1.computeMonthlyCost)(constants, categoryKey, cand.buyPrice, currentAgeMonths, holdingMonths, currentNewPrice);
    // 性能满足度
    const perf = (0, performance_js_1.computePerformance)(constants, cand.chip, cand.memoryGb, cand.storageGb, categoryKey, holdingMonths, params.mSeriesCAGR, params.aSeriesCAGR);
    return {
        model: `${cand.modelKey} × ${holdingYears}年`,
        chip: cand.chip,
        buyTiming: cand.buyTiming,
        holdingYears,
        monthlyCost: cost.monthlyCost,
        avgPerformance: perf.avgS,
        buyPrice: cand.buyPrice,
        residual: cost.residual,
        maintenanceCost: cost.maintenanceCost,
        holdingMonths,
        performanceS0: perf.s0,
        performanceSN: perf.sN,
    };
}
/** 计算机龄(月) = (分析日期 - 发布日期) × 12 */
function computeAgeMonths(constants, releaseDateKey) {
    const releaseDate = constants.productReleaseDates[releaseDateKey];
    if (!releaseDate)
        return -1;
    // 解析 "YYYY-MM" 或 "YYYY-MM(预计)"
    const match = releaseDate.match(/^(\d{4})-(\d{1,2})/);
    if (!match)
        return -1;
    const releaseYear = Number(match[1]);
    const releaseMonth = Number(match[2]);
    // 分析日期 = constants.lastUpdated
    const analysisMatch = constants.lastUpdated.match(/^(\d{4})-(\d{1,2})/);
    if (!analysisMatch)
        return -1;
    const analysisYear = Number(analysisMatch[1]);
    const analysisMonth = Number(analysisMatch[2]);
    return (analysisYear - releaseYear) * 12 + (analysisMonth - releaseMonth);
}
// ============================================================================
// 帕累托前沿筛选
// ============================================================================
/**
 * 二维非劣解筛选
 * 最小化 monthlyCost, 最大化 avgPerformance
 */
function selectFrontier(points) {
    if (points.length === 0)
        return { frontier: [], dominated: [] };
    // 按月均成本升序, 成本相同按性能降序
    const sorted = [...points].sort((a, b) => {
        if (a.monthlyCost !== b.monthlyCost)
            return a.monthlyCost - b.monthlyCost;
        return b.avgPerformance - a.avgPerformance;
    });
    const frontier = [];
    const dominated = [];
    let maxPerf = -Infinity;
    for (const p of sorted) {
        if (p.avgPerformance > maxPerf) {
            frontier.push(p);
            maxPerf = p.avgPerformance;
        }
        else {
            dominated.push(p);
        }
    }
    // 前沿按月均成本升序
    frontier.sort((a, b) => a.monthlyCost - b.monthlyCost);
    return { frontier, dominated };
}
// ============================================================================
// 推荐区间截取
// ============================================================================
function selectRecommendationRange(frontier, params) {
    // 截取: 买入价 ≤ 预算 且 性能 ≥ 性能地板
    const plans = frontier.filter((p) => p.buyPrice <= params.budget && p.avgPerformance >= params.performanceFloor);
    if (plans.length === 0) {
        return { lowerCost: 0, upperCost: 0, plans: [] };
    }
    const costs = plans.map((p) => p.monthlyCost);
    return {
        lowerCost: Math.min(...costs),
        upperCost: Math.max(...costs),
        plans: plans.sort((a, b) => a.monthlyCost - b.monthlyCost),
    };
}
// ============================================================================
// 品类名解析
// ============================================================================
/**
 * 将用户传入的品类名(kebab-case 或中文)解析为 constants.marketSnapshots 的键名
 * 如 "mac-mini" → "Mac_mini", "macbook-air" → "MacBook_Air"
 */
function resolveCategoryKey(constants, category) {
    // 直接命中
    if (constants.marketSnapshots[category])
        return category;
    // kebab → snake (mac-mini → Mac_mini)
    const snakeFromKebab = category
        .toLowerCase()
        .split('-')
        .map((part, i) => i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part)
        .join('_');
    if (constants.marketSnapshots[snakeFromKebab])
        return snakeFromKebab;
    // 全大写首字母 (mac_mini → Mac_mini)
    const titleCase = category
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('_');
    if (constants.marketSnapshots[titleCase])
        return titleCase;
    // 兜底: 遍历找不区分大小写匹配
    const lower = category.toLowerCase().replace(/[-\s]/g, '_');
    for (const key of Object.keys(constants.marketSnapshots)) {
        if (key.toLowerCase() === lower)
            return key;
    }
    return snakeFromKebab;
}
//# sourceMappingURL=pareto.js.map