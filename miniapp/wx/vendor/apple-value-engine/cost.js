import { getRetentionRate } from './retention.js';
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
export function computeMonthlyCost(constants, category, buyPrice, currentAgeMonths, holdingMonths, currentNewPrice) {
    const sellAgeMonths = currentAgeMonths + holdingMonths;
    // 保值率(查表插值/外推)
    const retentionRate = getRetentionRate(constants.retentionCurves, category, sellAgeMonths);
    const residual = (retentionRate / 100) * currentNewPrice;
    // 维修成本
    const maintenanceCost = computeMaintenanceCost(constants, category, holdingMonths);
    const monthlyCost = (buyPrice - residual + maintenanceCost) / holdingMonths;
    return {
        monthlyCost,
        buyPrice,
        residual,
        maintenanceCost,
        sellAgeMonths,
        retentionRate,
        currentNewPrice,
        holdingMonths,
    };
}
/**
 * 计算持有期预期维修成本
 * = floor(持有月数 / 电池寿命周期) × 单次电池更换费 + 持有年数 × 年均故障维修费
 */
export function computeMaintenanceCost(constants, category, holdingMonths) {
    const mc = constants.maintenanceCosts;
    const batteryCycleMonths = mc.电池寿命周期_月;
    const holdingYears = holdingMonths / 12;
    // 品类名 → 维修成本表键名映射
    const categoryKey = mapCategoryToMaintenanceKey(category);
    const batteryReplacement = mc.单次电池更换费用[categoryKey] ?? 0;
    const annualRepair = mc.年均故障维修费用[categoryKey] ?? 0;
    const batteryCount = Math.floor(holdingMonths / batteryCycleMonths);
    const batteryCost = batteryCount * batteryReplacement;
    const repairCost = holdingYears * annualRepair;
    return batteryCost + repairCost;
}
/**
 * 类型 B/C 候选的月均成本计算
 *
 * 与类型 A 的差异 (SKILL.md 步骤 5.4):
 *   - 残值 MUST NOT 施加新品发布冲击调整 (冲击已体现在买入价中, 或买入的就是新品)
 *   - 卖出时机龄由调用方显式传入:
 *     · 类型 B (等新品买新品): sellAgeMonths = holdingMonths (买入时为新机, 机龄 0)
 *     · 类型 C (等新品后买降价老款): sellAgeMonths = 当前机龄 + 等待月数 + 持有月数
 *
 * @param sellAgeMonths 卖出时机龄 (月), 由调用方按候选类型计算
 */
export function computeMonthlyCostForWaitCandidate(constants, category, buyPrice, holdingMonths, currentNewPrice, sellAgeMonths) {
    const retentionRate = getRetentionRate(constants.retentionCurves, category, sellAgeMonths);
    const residual = (retentionRate / 100) * currentNewPrice;
    const maintenanceCost = computeMaintenanceCost(constants, category, holdingMonths);
    const monthlyCost = (buyPrice - residual + maintenanceCost) / holdingMonths;
    return {
        monthlyCost,
        buyPrice,
        residual,
        maintenanceCost,
        sellAgeMonths,
        retentionRate,
        currentNewPrice,
        holdingMonths,
    };
}
/** 品类名 → 维修成本表键名 */
function mapCategoryToMaintenanceKey(category) {
    const c = category.toLowerCase().replace(/[-\s]/g, '_');
    const map = {
        'mac_mini': 'Mac_mini',
        'macbook_air': 'MacBook_Air',
        'macbook_pro': 'MacBook_Pro',
        'imac': 'iMac',
        'mac_studio': 'Mac_Studio',
        'mac_pro': 'Mac_Pro',
        'iphone_promax': 'iPhone',
        'iphone_pro': 'iPhone',
        'iphone_标准': 'iPhone',
        'iphone': 'iPhone',
        'ipad_pro': 'iPad',
        'ipad_air': 'iPad',
        'ipad_标准': 'iPad',
        'ipad_mini': 'iPad',
        'ipad': 'iPad',
        'apple_watch': 'Apple_Watch',
        'airpods': 'AirPods',
        'vision_pro': 'Vision_Pro',
        'apple_tv': 'Apple_TV',
        'homepod': 'HomePod',
    };
    return map[c] ?? category;
}
/**
 * 从市场快照中提取当前同品类新品价(残值分母)
 * 优先取 新品官方价, 其次取快照 _说明 中的残值分母
 */
export function getCurrentNewPrice(constants, category) {
    const snapshots = constants.marketSnapshots[category];
    if (!snapshots)
        return 0;
    // 优先: 新品机型的官方价
    for (const [key, entry] of Object.entries(snapshots)) {
        if (key.includes('新品') && typeof entry.官方价 === 'number' && entry.官方价 > 0) {
            return entry.官方价;
        }
    }
    // 兜底: 任意有官方价的机型
    for (const entry of Object.values(snapshots)) {
        if (typeof entry.官方价 === 'number' && entry.官方价 > 0) {
            return entry.官方价;
        }
    }
    return 0;
}
/**
 * 从市场快照中提取买入价
 * - 新品: 优先 京东国补到手价, 其次 官方价
 * - 二手: 优先 闲鱼中位价_二手同款, 其次 _参考
 */
export function getBuyPrice(entry, buyTiming) {
    if (buyTiming === 'new') {
        if (typeof entry.京东国补到手价 === 'number' && entry.京东国补到手价 > 0) {
            return entry.京东国补到手价;
        }
        if (typeof entry.京东国补到手价_参考 === 'number' && entry.京东国补到手价_参考 > 0) {
            return entry.京东国补到手价_参考;
        }
        if (typeof entry.官方价 === 'number' && entry.官方价 > 0) {
            return entry.官方价;
        }
        return null;
    }
    // 二手
    if (typeof entry.闲鱼中位价_二手同款 === 'number' && entry.闲鱼中位价_二手同款 > 0) {
        return entry.闲鱼中位价_二手同款;
    }
    if (typeof entry.闲鱼中位价_二手同款_参考 === 'number' && entry.闲鱼中位价_二手同款_参考 > 0) {
        return entry.闲鱼中位价_二手同款_参考;
    }
    // 兜底: iPhone/iPad 快照使用 "闲鱼中位价" (无 _二手同款 后缀)
    if (typeof entry.闲鱼中位价 === 'number' && entry.闲鱼中位价 > 0) {
        return entry.闲鱼中位价;
    }
    return null;
}
//# sourceMappingURL=cost.js.map