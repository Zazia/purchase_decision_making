import { ConstantsValidationError } from './types.js';
import { computePerformance, computePerformanceForNewProduct } from './performance.js';
import { computeMonthlyCost, computeMonthlyCostForWaitCandidate, getCurrentNewPrice, getBuyPrice } from './cost.js';
import { parseReleasePlan, computeWaitMonths, predictNewProductPrice, predictDiscountedOldPrice, shouldGenerateWaitCandidates, isAnchorCandidate, computeResidualImpactFactor, resolveProductReleaseDate, } from './release.js';
/**
 * 计算帕累托前沿
 *
 * @param constants 常量数据(由 loadConstants 加载)
 * @param params 决策参数
 * @returns { frontier, dominated, recommendationRange }
 */
export function computeParetoFrontier(constants, params) {
    const categoryKey = resolveCategoryKey(constants, params.category);
    const candidates = extractCandidates(constants, categoryKey, params.buyTiming);
    // v3.8: 当 considerWait !== false 时, 自动判断是否生成类型 B/C 候选
    if (params.considerWait !== false) {
        const macroContext = resolveMacroContext(constants, params.macroContext);
        const releasePlan = parseReleasePlan(constants, categoryKey, macroContext);
        if (releasePlan && shouldGenerateWaitCandidates(releasePlan, macroContext)) {
            const waitCandidates = extractWaitCandidates(constants, categoryKey, releasePlan, macroContext, params.buyTiming);
            candidates.push(...waitCandidates);
        }
    }
    // 为每个候选机型 × 持有年数生成方案点
    const points = [];
    for (const cand of candidates) {
        for (const years of params.holdingYears) {
            const point = buildPlanPoint(constants, cand, years, params);
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
// ============================================================================
// 按给定方案集重算前沿 (用户编辑后)
// ============================================================================
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
export function recomputeFrontierFromPoints(constants, params, editedPoints) {
    // 1. 过滤 excluded / deferred
    const active = editedPoints.filter((p) => !p.excluded && !p.deferred);
    // 2. 逐个重建 PlanPoint (original 直接复用, edited 重算成本, custom 用 buildPlanPointFromInputs)
    const points = [];
    for (const ep of active) {
        const point = rebuildPlanPoint(constants, params, ep);
        if (point)
            points.push(point);
    }
    // 3. 复用 selectFrontier / selectRecommendationRange
    const { frontier, dominated } = selectFrontier(points);
    const recommendationRange = selectRecommendationRange(frontier, params);
    return { frontier, dominated, recommendationRange };
}
/**
 * 把单个 EditedPlanPoint 重建为 PlanPoint。
 * - source='original': 直接复用 (口径与原始计算一致)
 * - source='edited':   用 editedBuyPrice 重算月均成本 (性能不变)
 * - source='custom':   用 buildPlanPointFromInputs 完整重建 (因端内只有自定义字段)
 */
function rebuildPlanPoint(constants, params, ep) {
    if (ep.source === 'original') {
        return ep;
    }
    if (ep.source === 'edited') {
        return rebuildEditedPlanPoint(constants, params, ep);
    }
    // source === 'custom'
    return rebuildCustomPlanPoint(constants, params, ep);
}
/**
 * 用 editedBuyPrice 重算月均成本 (性能满足度、保值率、维修成本口径不变)。
 *
 * 实现策略: 构造一个 Candidate (复用原方案的芯片/内存/存储/品类/候选类型/等待月数/
 * 发布日期 key), 用 editedBuyPrice 作为 buyPrice, 走 buildPlanPoint 同款计算。
 * 这样保证月均成本公式与 computeParetoFrontier 完全一致 (含 v3.8 候选类型 B/C 分支)。
 */
function rebuildEditedPlanPoint(constants, params, ep) {
    const editedBuyPrice = typeof ep.editedBuyPrice === 'number' ? ep.editedBuyPrice : ep.buyPrice;
    if (!(editedBuyPrice > 0))
        return null; // 非法买入价拦截
    const memoryGb = ep.memoryGb ?? extractMemoryGb(ep);
    const storageGb = ep.storageGb ?? extractStorageGb(ep);
    const isCustomCopy = ep.memoryGb !== undefined || ep.storageGb !== undefined;
    // 品类解析 (D2c): 自添加方案的复制副本优先取决策参数品类 (params.category),
    // original/edited 快照方案保持 model 命中快照的既有行为不变
    const categoryKey = isCustomCopy
        ? resolveCustomPlanCategoryKey(constants, params, ep)
        : resolveCategoryKeyFromPlanPoint(constants, ep);
    // releaseDateKey 解析: 优先从 model 解析 (original/edited 快照方案);
    // 自添加方案的复制副本 (带显式内存字段, model 为自由文本) 解析无效时,
    // 按 芯片+内存+存储 在 marketSnapshots 匹配同配置机型兜底 (机龄取相同型号)
    let releaseDateKey = resolveReleaseDateKeyFromModel(ep, categoryKey);
    if (isCustomCopy && computeAgeMonths(constants, releaseDateKey) < 0) {
        releaseDateKey = resolveReleaseDateKeyForCustomPlan(constants, categoryKey, ep.chip, memoryGb, storageGb);
    }
    // 构造 Candidate, 复用原方案的发布日期 key 与候选类型 (保证机龄计算口径一致)
    const cand = {
        modelKey: stripHoldingYearsSuffix(ep.model),
        chip: ep.chip,
        memoryGb,
        storageGb,
        buyTiming: ep.buyTiming,
        buyPrice: editedBuyPrice,
        releaseDateKey,
        categoryKey,
        candidateType: ep.candidateType ?? 'A',
        waitMonths: ep.waitMonths,
        predictedPrice: ep.predictedPrice,
    };
    // 自添加方案的复制副本 (model 为自由文本): releaseDateKey 仍无效时
    // 机龄按 0 兜底 (与 buildPlanPointFromInputs 的兜底行为一致), 不丢弃
    if ((ep.candidateType ?? 'A') === 'A'
        && isCustomCopy
        && computeAgeMonths(constants, cand.releaseDateKey) < 0) {
        return buildPlanPointFromCandidateWithAgeOverride(constants, cand, ep.holdingYears, 0, getCurrentNewPrice(constants, categoryKey), params.mSeriesCAGR, params.aSeriesCAGR, params.macroContext, cand.releaseDateKey);
    }
    return buildPlanPoint(constants, cand, ep.holdingYears, params);
}
/**
 * 用 buildPlanPointFromInputs 完整重建自定义方案。
 * EditedPlanPoint 已经包含 chip/memory/storage 等字段 (端内新增时填入),
 * 这里把它们组装成 CustomPlanInputs 调 buildPlanPointFromInputs。
 */
function rebuildCustomPlanPoint(constants, params, ep) {
    if (!(ep.buyPrice > 0))
        return null;
    const inputs = {
        model: stripHoldingYearsSuffix(ep.model),
        chip: ep.chip,
        memoryGb: ep.memoryGb ?? extractMemoryGb(ep),
        storageGb: ep.storageGb ?? extractStorageGb(ep),
        categoryKey: resolveCustomPlanCategoryKey(constants, params, ep),
        buyTiming: ep.buyTiming,
        buyPrice: ep.buyPrice,
        holdingYears: ep.holdingYears,
        candidateType: ep.candidateType ?? 'A',
        waitMonths: ep.waitMonths,
        predictedPrice: ep.predictedPrice,
        channel: ep.channel,
        useSubsidy: ep.useSubsidy,
        mSeriesCAGR: params.mSeriesCAGR,
        aSeriesCAGR: params.aSeriesCAGR,
        macroContext: params.macroContext,
    };
    try {
        return buildPlanPointFromInputs(constants, inputs);
    }
    catch {
        // 自定义方案芯片无法解析 → 不参与重算 (端内应在提交前拦截, 引擎这里兜底)
        return null;
    }
}
/** 去掉 model 末尾 " × Ny年" 后缀, 得到 modelKey (支持小数持有期如 1.5 年) */
function stripHoldingYearsSuffix(model) {
    return model.replace(/\s*×\s*[\d.]+年$/, '');
}
/** 从 PlanPoint 提取内存 GB (没有则回退默认 8) */
function extractMemoryGb(p) {
    // PlanPoint 没有显式 memoryGb 字段, 从 model 解析 (如 "M2_16G_256G_二手 × 3年")
    const m = p.model.match(/(\d+)G_(\d+)G/);
    if (m)
        return Number(m[1]);
    // iPhone 产品名格式: "iPhone_16_Pro_256G_二手 × 3年"
    const iPhone = p.model.match(/^iPhone_[^_]+(?:_[^_]+)?_(\d+)G/);
    if (iPhone)
        return 6;
    // 仅一个 GB 段 (如 "M3_24寸_二手"), 视为存储
    return 8;
}
/** 从 PlanPoint 提取存储 GB (没有则回退默认 256) */
function extractStorageGb(p) {
    const m = p.model.match(/(\d+)G_(\d+)G/);
    if (m)
        return Number(m[2]);
    const single = p.model.match(/_(\d+)G_/);
    if (single)
        return Number(single[1]);
    const tail = p.model.match(/_(\d+)G(?:\s*×|$)/);
    if (tail)
        return Number(tail[1]);
    return 256;
}
/**
 * 从 PlanPoint 推导 releaseDateKey (用于 computeAgeMonths)。
 * 端内编辑后没有保留 releaseDateKey, 这里从 model 解析 (与 parseModelKey 同款)。
 *
 * parseModelKey 的 releaseDateKey 推导规则:
 *   - iPhone: "iPhone_16_Pro_256G_二手" → "iPhone_16" (前两段)
 *   - Mac (无屏幕尺寸): "M2_16G_256G_二手" → "${categoryKey}_${rawChip}" = "Mac_mini_M2"
 *   - Mac (带屏幕尺寸): "M5_Pro_14寸_16G_512G_新品" → "${categoryKey}_${screenSize}_${rawChip}"
 */
function resolveReleaseDateKeyFromModel(p, categoryKey) {
    const modelKey = stripHoldingYearsSuffix(p.model);
    const segments = modelKey.split('_');
    // iPhone 特殊处理: 取前两段 (iPhone_16), 不含 Pro/ProMax 后缀
    if (segments[0] === 'iPhone') {
        return segments.slice(0, 2).join('_');
    }
    // 找内存/存储段
    const gbSegments = [];
    segments.forEach((seg, i) => {
        if (/^(\d+)G$/i.test(seg)) {
            gbSegments.push({ index: i, value: Number(seg.replace(/G$/i, '')) });
        }
    });
    // 屏幕尺寸段
    const screenSizeMatch = segments.find((s) => /^\d+寸$/.test(s));
    const screenSize = screenSizeMatch ? screenSizeMatch.replace('寸', '') : '';
    // 芯片段 = 内存段之前的所有段(去掉屏幕尺寸)
    const chipEndIndex = gbSegments.length >= 2 ? gbSegments[0].index : (gbSegments[0]?.index ?? segments.length);
    const chipSegments = segments.slice(0, chipEndIndex).filter((s) => !/^\d+寸$/.test(s));
    const rawChip = chipSegments.join('_'); // 原始芯片名 (M1Pro / M2), 与 productReleaseDates 键对齐
    if (!rawChip)
        return '';
    if (screenSize)
        return `${categoryKey}_${screenSize}_${rawChip}`;
    return `${categoryKey}_${rawChip}`;
}
/**
 * 为自添加方案解析 releaseDateKey (机龄取「相同型号的机器」的机龄)。
 * 用户输入的 model 是自由文本 (如 "M4 Mac mini"), 无法从 model 解析,
 * 改为在 marketSnapshots 中按 芯片+内存+存储 匹配同配置机型条目,
 * 用该条目的 modelKey 推导 releaseDateKey (与 parseModelKey 同款规则)。
 * - 精确配置匹配不到 → 按 chip 前缀匹配同芯片任意配置 (机龄按芯片级一致)
 * - 都匹配不到 → 返回 '' (调用方按机龄 0 兜底)
 */
function resolveReleaseDateKeyForCustomPlan(constants, categoryKey, chip, memoryGb, storageGb) {
    const snaps = constants.marketSnapshots[categoryKey];
    if (!snaps || typeof snaps !== 'object')
        return '';
    const keys = Object.keys(snaps).filter((k) => !k.startsWith('_'));
    // 芯片前缀双写法容错 (D2d): 解析后的芯片名为规范化写法 (M3_Pro),
    // 而快照 key 用紧凑写法 (M3Pro_14寸_...), 两种前缀互试避免带
    // Pro/Max/Ultra 后缀的芯片因写法差异匹配失败而错按机龄 0 兜底
    const chipPrefixes = Array.from(new Set([
        `${chip}_`,
        `${chip.replace(/_(Pro|Max|Ultra)/g, '$1')}_`,
    ]));
    const memStorageSeg = `_${memoryGb}G_${storageGb}G`;
    // 1. 精确匹配: 同芯片 + 同内存/存储 (如 "M4_16G_256G_二手" / "M3Pro_14寸_16G_512G_二手")
    const exact = keys.find((k) => chipPrefixes.some((p) => k.startsWith(p)) && k.includes(memStorageSeg));
    // 2. 退化匹配: 同芯片任意配置 (机龄按芯片级, 与配置无关)
    const fallback = exact ?? keys.find((k) => chipPrefixes.some((p) => k.startsWith(p)));
    if (!fallback)
        return '';
    // 复用 model 解析规则推导 releaseDateKey (MacBook 带屏幕尺寸段也能处理)
    return resolveReleaseDateKeyFromModel({ model: fallback }, categoryKey);
}
/**
 * 从 PlanPoint 推导 categoryKey (用于保值率/维修/性能查表)。
 * 优先用解析过的子品类 (如 "Mac_mini"); 找不到时回退品类前缀 (如 "iPhone")。
 */
function resolveCategoryKeyFromPlanPoint(constants, p) {
    // 在 marketSnapshots 中找包含此 modelKey 的子品类
    const modelKey = stripHoldingYearsSuffix(p.model);
    for (const [snapKey, snaps] of Object.entries(constants.marketSnapshots)) {
        if (snapKey.startsWith('_'))
            continue;
        if (Object.prototype.hasOwnProperty.call(snaps, modelKey)) {
            return snapKey;
        }
    }
    // 兜底: 按 chip 推断品类 (M 系列 → Mac_mini, A 系列 → iPhone_Pro)
    if (p.chip.startsWith('M'))
        return 'Mac_mini';
    if (p.chip.startsWith('A'))
        return 'iPhone_Pro';
    return 'Mac_mini';
}
/**
 * 解析自添加方案 (及其复制副本) 的品类键 (D2c 残留修复)。
 * 优先取决策参数品类 (params.category, 端内为 kebab-case 如 'macbook-pro'),
 * 经 resolveCategoryKey 对齐到 marketSnapshots 键 (如 'MacBook_Pro'),
 * 保证旗舰基准/权重表/保值率/维修成本/残值分母/机龄匹配全部按正确品类查表;
 * 决策参数品类缺失、或解析结果不是有效快照品类 (父品类如 'iphone' 无同名
 * 快照键) 时, 回退 resolveCategoryKeyFromPlanPoint (按芯片前缀推断)。
 * original/edited 快照方案不走此函数 (model 可精确命中快照第一分支)。
 */
function resolveCustomPlanCategoryKey(constants, params, ep) {
    if (params.category) {
        const resolved = resolveCategoryKey(constants, params.category);
        const snaps = constants.marketSnapshots[resolved];
        if (snaps && typeof snaps === 'object')
            return resolved;
    }
    return resolveCategoryKeyFromPlanPoint(constants, ep);
}
/**
 * 解析宏观状态: macroContext 缺省时按 storageSuperCycleStage='none' + hasGlobalPriceHike=false 处理,
 * analysisMonth 缺省时回退 constants.lastUpdated (YYYY-MM), 保证向后兼容。
 */
function resolveMacroContext(constants, macroContext) {
    if (macroContext)
        return macroContext;
    const analysisMonth = constants.lastUpdated.slice(0, 7);
    return {
        storageSuperCycleStage: 'none',
        hasGlobalPriceHike: false,
        analysisMonth,
    };
}
/**
 * 从市场快照提取候选机型
 * 支持「父品类」聚合: 当 categoryKey 本身不存在时, 搜索所有子品类
 * (如 "iphone" → iPhone_Pro + iPhone_proMax + iPhone_标准)
 *
 * buyTiming 语义:
 *   - 'new' / 'used': 仅收集对应条件候选, 候选自身 buyTiming 与之一致
 *   - 'both': 同时收集新品与二手候选, 每个候选自身 buyTiming 为 'new' 或 'used' (具体到机型)
 */
function extractCandidates(constants, categoryKey, buyTiming) {
    // 确定要搜索的快照键列表
    let snapshotKeys;
    if (constants.marketSnapshots[categoryKey]) {
        snapshotKeys = [categoryKey];
    }
    else {
        // 父品类: 搜索所有以 categoryKey + '_' 开头的子品类
        const prefix = categoryKey.toLowerCase() + '_';
        snapshotKeys = Object.keys(constants.marketSnapshots).filter((k) => !k.startsWith('_') && k.toLowerCase().startsWith(prefix));
    }
    // 'both' 时同时匹配新品与二手; 每个候选自身 buyTiming 具体到机型
    const conditions = buyTiming === 'both'
        ? [{ tag: '新品', timing: 'new' }, { tag: '二手', timing: 'used' }]
        : [{ tag: buyTiming === 'new' ? '新品' : '二手', timing: buyTiming === 'new' ? 'new' : 'used' }];
    const candidates = [];
    for (const snapKey of snapshotKeys) {
        const snapshots = constants.marketSnapshots[snapKey];
        if (!snapshots)
            continue;
        for (const [modelKey, entry] of Object.entries(snapshots)) {
            for (const { tag, timing } of conditions) {
                if (!modelKey.includes(tag))
                    continue;
                const parsed = parseModelKey(modelKey, snapKey);
                if (!parsed)
                    continue;
                const buyPrice = getBuyPrice(entry, timing);
                if (buyPrice === null || buyPrice <= 0)
                    continue;
                candidates.push({
                    modelKey,
                    chip: parsed.chip,
                    memoryGb: parsed.memoryGb,
                    storageGb: parsed.storageGb,
                    buyTiming: timing,
                    buyPrice,
                    releaseDateKey: parsed.releaseDateKey,
                    categoryKey: snapKey,
                    candidateType: 'A',
                });
            }
        }
    }
    return candidates;
}
// ============================================================================
// v3.8 类型 B/C 候选生成 (等新品候选)
// ============================================================================
/**
 * 生成类型 B（等新品买新品）与类型 C（等新品后买降价老款）候选
 *
 * 类型 B: 虚拟候选, 代表即将发布的新一代产品, 买入价为预测价
 * 类型 C: 基于现有候选, 买入价施加冲击时变下降因子
 *
 * @param buyTiming 用户选择的买入时机 (控制类型 C 收集哪些老款)
 */
function extractWaitCandidates(constants, categoryKey, releasePlan, macroContext, buyTiming) {
    const waitMonths = computeWaitMonths(releasePlan, macroContext);
    const candidates = [];
    // --- 类型 B: 等新品买新品 ---
    const newProductPrice = predictNewProductPrice(constants, categoryKey, releasePlan);
    if (newProductPrice > 0) {
        candidates.push({
            modelKey: `${categoryKey}_下一代新品`,
            chip: '',
            memoryGb: 0,
            storageGb: 0,
            buyTiming: 'new',
            buyPrice: newProductPrice,
            releaseDateKey: '',
            categoryKey,
            candidateType: 'B',
            waitMonths,
            predictedPrice: true,
        });
    }
    // --- 类型 C: 等新品后买降价老款 ---
    // 复用 extractCandidates 获取当前在售机型, 对每个施加冲击时变价格下降
    const oldCandidates = extractCandidates(constants, categoryKey, buyTiming);
    for (const oldCand of oldCandidates) {
        // v4.2: 锚定品 (属于本次待发布批次, 如已官宣未发售) 跳过 —— 锚定品自身价
        // 不得套用「老款 × (1+锚涨幅) × (1−冲击)」公式, 它作为类型 A 买入时残值
        // 也不施加本场发布的冲击 (贬值由保值率曲线覆盖)
        if (isAnchorCandidate(constants, oldCand.releaseDateKey, releasePlan))
            continue;
        const discountedPrice = predictDiscountedOldPrice(constants, oldCand.buyPrice, releasePlan, macroContext);
        if (discountedPrice <= 0)
            continue;
        candidates.push({
            ...oldCand,
            buyPrice: discountedPrice,
            candidateType: 'C',
            waitMonths,
            predictedPrice: true,
        });
    }
    return candidates;
}
/**
 * 规范化芯片名: 将快照 modelKey 中的紧凑写法转为 benchmark 表的键名
 * M1Pro → M1_Pro, M5Max → M5_Max, M5Pro_Max → M5_Pro_Max
 */
function normalizeChipName(chip) {
    return chip.replace(/(?<!_)(Pro|Max|Ultra)/g, '_$1');
}
/** iPhone 产品名 → 芯片名映射 (productReleaseDates 用 iPhone_N, benchmarks 用 A_N) */
const IPHONE_CHIP_MAP = {
    'iPhone_12': 'A14', 'iPhone_13': 'A15',
    'iPhone_14': 'A15', 'iPhone_14_Pro': 'A16',
    'iPhone_15': 'A16', 'iPhone_15_Pro': 'A17_Pro',
    'iPhone_16': 'A18', 'iPhone_16_Pro': 'A18_Pro',
    'iPhone_17': 'A19', 'iPhone_17_Pro': 'A19_Pro',
    'iPhone_18': 'A20', 'iPhone_18_Pro': 'A20_Pro',
};
/**
 * 解析机型 key, 如 "M4_16G_256G_新品" → { chip: "M4", memoryGb: 16, storageGb: 256, releaseDateKey: "Mac_mini_M4" }
 * 支持带屏幕尺寸的格式, 如 "M5_Pro_14寸_16G_512G_新品"
 * 支持无内存/存储段的格式, 如 "M3_24寸_二手" (iMac), 此时使用默认值
 * 支持 iPhone 产品名格式, 如 "iPhone_16_Pro_256G_二手"
 */
function parseModelKey(modelKey, categoryKey) {
    // 去掉条件后缀及附加修饰(如 _基础款, _升级款)
    const withoutCondition = modelKey.replace(/_(新品|二手)(_.*)?$/, '');
    const segments = withoutCondition.split('_');
    // 找内存和存储段(匹配 \d+G)
    const gbSegments = [];
    segments.forEach((seg, i) => {
        const m = seg.match(/^(\d+)G$/i);
        if (m)
            gbSegments.push({ index: i, value: Number(m[1]) });
    });
    // 找屏幕尺寸段(如 "14寸")
    const screenSizeMatch = segments.find((s) => /^\d+寸$/.test(s));
    const screenSize = screenSizeMatch ? screenSizeMatch.replace('寸', '') : '';
    // iPhone 特殊处理: modelKey 以 iPhone_ 开头, 需映射到芯片名
    if (segments[0] === 'iPhone') {
        // 提取产品代际名: iPhone_16_Pro 或 iPhone_16 (到第一个 GB 段之前)
        const productEnd = gbSegments[0]?.index ?? segments.length;
        const productSegments = segments.slice(0, productEnd).filter((s) => !/^\d+寸$/.test(s));
        const productName = productSegments.join('_'); // 如 "iPhone_16_Pro"
        // 只取前两段作为发布日期 key (iPhone_16), 不含 Pro/ProMax 后缀
        const releaseDateKey = productSegments.slice(0, 2).join('_'); // 如 "iPhone_16"
        // 映射到芯片名
        const chip = IPHONE_CHIP_MAP[productName] ?? IPHONE_CHIP_MAP[productSegments.slice(0, 2).join('_')] ?? 'A14';
        // iPhone 内存默认 6GB, 存储从 key 提取
        const storageGb = gbSegments[0]?.value ?? 128;
        return { chip, memoryGb: 6, storageGb, releaseDateKey };
    }
    // 内存/存储可能缺失(如 iMac 的 "M3_24寸_二手"), 使用默认值
    // 仅 1 个 GB 段时视为存储(Mac/iPad 通常不标内存)
    const memoryGb = gbSegments.length >= 2 ? gbSegments[0].value : 8;
    const storageGb = gbSegments.length >= 2 ? gbSegments[1].value : (gbSegments[0]?.value ?? 256);
    // 芯片 = 内存段之前的所有段(或全部段如果无 GB), 去掉屏幕尺寸段
    const chipEndIndex = gbSegments.length >= 2 ? gbSegments[0].index : (gbSegments[0]?.index ?? segments.length);
    const chipSegments = segments
        .slice(0, chipEndIndex)
        .filter((s) => !/^\d+寸$/.test(s));
    const rawChip = chipSegments.join('_');
    if (!rawChip)
        return null;
    // 规范化芯片名: M1Pro → M1_Pro (匹配 benchmark 表)
    const chip = normalizeChipName(rawChip);
    // 发布日期 key: 优先带屏幕尺寸 (如 "MacBook_Pro_14_M3Pro"), 其次不带 (如 "Mac_mini_M4")
    // 注意: releaseDateKey 用原始芯片名(非规范化), 因为 productReleaseDates 用 M1Pro 不用 M1_Pro
    const releaseDateKey = screenSize
        ? `${categoryKey}_${screenSize}_${rawChip}`
        : `${categoryKey}_${rawChip}`;
    return { chip, memoryGb, storageGb, releaseDateKey };
}
// ============================================================================
// 方案点构建
// ============================================================================
/**
 * 校验芯片名是否在 constants.chipBenchmarks 中可解析。
 * 支持 M 系列与 A 系列, 以及规范化前后的写法 (M1Pro / M1_Pro)。
 * @returns 规范化后的芯片名 (与 chipBenchmarks 键对齐); 不可解析时返回 null
 */
function resolveChipBenchmark(constants, chip) {
    if (!chip)
        return null;
    // 1. 直接命中 (M 系列)
    const mBench = constants.chipBenchmarks.Mac芯片 ?? {};
    if (mBench[chip])
        return chip;
    // 2. 规范化后命中 (M1Pro → M1_Pro)
    const normalized = normalizeChipName(chip);
    if (mBench[normalized])
        return normalized;
    // 3. A 系列
    const aBench = constants.chipBenchmarks.iPhone_iPad芯片 ?? {};
    if (aBench[chip])
        return chip;
    if (aBench[normalized])
        return normalized;
    // 4. 紧凑化兜底 (M1_Pro → M1Pro)
    const compact = chip.replace(/_(Pro|Max|Ultra)/g, '$1');
    if (mBench[compact])
        return compact;
    if (aBench[compact])
        return compact;
    return null;
}
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
export function buildPlanPointFromInputs(constants, inputs) {
    const resolvedChip = resolveChipBenchmark(constants, inputs.chip);
    if (!resolvedChip) {
        throw new ConstantsValidationError('chipBenchmarks', `无法识别该芯片: ${inputs.chip}, 无法重算`);
    }
    const candidateType = inputs.candidateType ?? 'A';
    // 复用 Candidate 接口, 内部走 buildPlanPoint 同款计算
    const cand = {
        modelKey: inputs.model,
        chip: resolvedChip,
        memoryGb: inputs.memoryGb,
        storageGb: inputs.storageGb,
        buyTiming: inputs.buyTiming,
        buyPrice: inputs.buyPrice,
        releaseDateKey: '', // 用户新增方案无发布日期 key, buildPlanPoint 内部 computeAgeMonths 会返回 -1
        categoryKey: inputs.categoryKey,
        candidateType,
        waitMonths: inputs.waitMonths,
        predictedPrice: inputs.predictedPrice,
    };
    // 类型 A 需要 releaseDateKey 计算 currentAgeMonths; 类型 B 不需要机龄
    if (candidateType === 'A') {
        // 机龄取「相同型号的机器」的真实机龄 (按 芯片+内存+存储 在 marketSnapshots
        // 匹配同配置机型, 解析其 releaseDateKey); 匹配不到时按 0 兜底 (视为刚发布机型)
        const releaseDateKey = resolveReleaseDateKeyForCustomPlan(constants, inputs.categoryKey, resolvedChip, inputs.memoryGb, inputs.storageGb);
        const ageMonths = releaseDateKey ? computeAgeMonths(constants, releaseDateKey) : -1;
        return buildPlanPointFromCandidateWithAgeOverride(constants, cand, inputs.holdingYears, ageMonths >= 0 ? ageMonths : 0, // currentAgeMonths 兜底为 0
        getCurrentNewPrice(constants, inputs.categoryKey), inputs.mSeriesCAGR, inputs.aSeriesCAGR, inputs.macroContext, releaseDateKey);
    }
    // 类型 B/C 走原 buildPlanPoint (不依赖机龄解析的兜底分支)
    // 注: 类型 C 需要 releaseDateKey 计算机龄, 用户新增方案没有, 可能返回 null
    return buildPlanPoint(constants, cand, inputs.holdingYears, {
        mSeriesCAGR: inputs.mSeriesCAGR,
        aSeriesCAGR: inputs.aSeriesCAGR,
    });
}
/**
 * 类型 A 的兜底构建: 用显式 currentAgeMonths + currentNewPrice 计算,
 * 跳过 computeAgeMonths 的发布日期查找 (用户新增方案没有发布日期)。
 * v4.2: 与 buildPlanPoint 类型 A 分支同口径施加残值冲击调整
 * (保证自添加方案 source='custom' 与其复制副本 source='edited' 结果一致)。
 */
function buildPlanPointFromCandidateWithAgeOverride(constants, cand, holdingYears, currentAgeMonths, currentNewPrice, mSeriesCAGR, aSeriesCAGR, macroContext, releaseDateKey) {
    const holdingMonths = holdingYears * 12;
    let cost = computeMonthlyCost(constants, cand.categoryKey, cand.buyPrice, currentAgeMonths, holdingMonths, currentNewPrice);
    // 残值冲击: releaseDateKey 缺省时用 cand.releaseDateKey (自添加方案可能为 '')
    cost = applyResidualImpact(constants, { ...cand, releaseDateKey: releaseDateKey ?? cand.releaseDateKey }, holdingMonths, macroContext, cost);
    const perf = computePerformance(constants, cand.chip, cand.memoryGb, cand.storageGb, cand.categoryKey, holdingMonths, mSeriesCAGR, aSeriesCAGR);
    const supportRisk = computeSystemSupportRiskForAge(cand, currentAgeMonths, holdingMonths);
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
        candidateType: cand.candidateType,
        waitMonths: cand.waitMonths,
        predictedPrice: cand.predictedPrice,
        systemSupportRisk: supportRisk.risk,
        systemSupportExceedMonths: supportRisk.exceedMonths,
    };
}
/**
 * 计算系统支持期风险标注 (显式机龄版本, 供 buildPlanPointFromInputs 用)。
 * 复用 getSystemSupportThreshold / 候选类型 → buyAgeMonths 推导。
 */
function computeSystemSupportRiskForAge(cand, currentAgeMonths, holdingMonths) {
    const threshold = getSystemSupportThreshold(cand.categoryKey);
    const waitMonths = cand.waitMonths ?? 0;
    let buyAgeMonths;
    if (cand.candidateType === 'B') {
        buyAgeMonths = 0;
    }
    else {
        buyAgeMonths = currentAgeMonths < 0 ? 0 : currentAgeMonths + waitMonths;
    }
    const sellAgeMonths = buyAgeMonths + holdingMonths;
    if (sellAgeMonths >= threshold) {
        return { risk: 'exceeded', exceedMonths: sellAgeMonths - threshold };
    }
    if (sellAgeMonths >= threshold - 12) {
        return { risk: 'near-end' };
    }
    return { risk: 'normal' };
}
/**
 * v4.2 类型 A 残值冲击调整 (spec「月均成本计算」):
 * 持有期内有新品发布且候选非锚定品时,
 * 残值 × (1 − 调整后冲击 × 残值调整时变因子(卖出点距发布整月数))。
 * computeResidualImpactFactor 内部含全部触发条件, 不满足时返回 1 → cost 原样返回。
 */
function applyResidualImpact(constants, cand, holdingMonths, macroContext, cost) {
    const resolved = resolveMacroContext(constants, macroContext);
    const releasePlan = parseReleasePlan(constants, cand.categoryKey, resolved);
    if (!releasePlan)
        return cost;
    const factor = computeResidualImpactFactor(constants, cand.releaseDateKey, releasePlan, resolved, holdingMonths);
    if (factor >= 1)
        return cost;
    const residual = cost.residual * factor;
    const monthlyCost = (cand.buyPrice - residual + cost.maintenanceCost) / holdingMonths;
    return { ...cost, residual, monthlyCost };
}
function buildPlanPoint(constants, cand, holdingYears, params) {
    const holdingMonths = holdingYears * 12;
    const waitMonths = cand.waitMonths ?? 0;
    // ---- 按候选类型分流性能与成本计算 ----
    let cost;
    let perf;
    if (cand.candidateType === 'B') {
        // 类型 B: 等新品买新品 — S(0)=1.0, 机龄 0, 残值分母 = 买入价(预测新品价)
        perf = computePerformanceForNewProduct(constants, cand.categoryKey, holdingMonths, params.mSeriesCAGR, params.aSeriesCAGR);
        const currentNewPrice = cand.buyPrice; // 新品自身即当前新品价
        cost = computeMonthlyCostForWaitCandidate(constants, cand.categoryKey, cand.buyPrice, holdingMonths, currentNewPrice, holdingMonths);
    }
    else if (cand.candidateType === 'C') {
        // 类型 C: 等新品后买降价老款 — 同款老芯片, 卖出时机龄 = 当前机龄 + 等待月数 + 持有月数
        const currentAgeMonths = computeAgeMonths(constants, cand.releaseDateKey);
        if (currentAgeMonths < 0)
            return null;
        const currentNewPrice = getCurrentNewPrice(constants, cand.categoryKey);
        const sellAgeMonths = currentAgeMonths + waitMonths + holdingMonths;
        cost = computeMonthlyCostForWaitCandidate(constants, cand.categoryKey, cand.buyPrice, holdingMonths, currentNewPrice, sellAgeMonths);
        perf = computePerformance(constants, cand.chip, cand.memoryGb, cand.storageGb, cand.categoryKey, holdingMonths, params.mSeriesCAGR, params.aSeriesCAGR);
    }
    else {
        // 类型 A: 现在买 — 原有逻辑
        const currentAgeMonths = computeAgeMonths(constants, cand.releaseDateKey);
        if (currentAgeMonths < 0)
            return null;
        const currentNewPrice = getCurrentNewPrice(constants, cand.categoryKey);
        cost = computeMonthlyCost(constants, cand.categoryKey, cand.buyPrice, currentAgeMonths, holdingMonths, currentNewPrice);
        // v4.2: 残值冲击调整 — 持有期内有新品发布且候选非锚定品时,
        // 残值 × (1 − 调整后冲击 × 残值调整时变因子(卖出点距发布整月数))
        cost = applyResidualImpact(constants, cand, holdingMonths, params.macroContext, cost);
        perf = computePerformance(constants, cand.chip, cand.memoryGb, cand.storageGb, cand.categoryKey, holdingMonths, params.mSeriesCAGR, params.aSeriesCAGR);
    }
    // ---- 系统支持期风险标注 ----
    const supportRisk = computeSystemSupportRisk(constants, cand, holdingMonths);
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
        candidateType: cand.candidateType,
        waitMonths: cand.waitMonths,
        predictedPrice: cand.predictedPrice,
        systemSupportRisk: supportRisk.risk,
        systemSupportExceedMonths: supportRisk.exceedMonths,
    };
}
/**
 * 计算系统支持期风险标注
 * macOS 72 月 / iOS 60 月 (iPhone/iPad)
 * 返回: normal(距尾声>12月) / near-end(≤12月) / exceeded(已超出)
 */
function computeSystemSupportRisk(constants, cand, holdingMonths) {
    const threshold = getSystemSupportThreshold(cand.categoryKey);
    const waitMonths = cand.waitMonths ?? 0;
    // 买入时机龄
    let buyAgeMonths;
    if (cand.candidateType === 'B') {
        buyAgeMonths = 0; // 新品机龄 0
    }
    else {
        const age = computeAgeMonths(constants, cand.releaseDateKey);
        buyAgeMonths = age < 0 ? 0 : age + waitMonths;
    }
    const sellAgeMonths = buyAgeMonths + holdingMonths;
    if (sellAgeMonths >= threshold) {
        return { risk: 'exceeded', exceedMonths: sellAgeMonths - threshold };
    }
    if (sellAgeMonths >= threshold - 12) {
        return { risk: 'near-end' };
    }
    return { risk: 'normal' };
}
/** 系统支持期阈值(月): Mac=72, iPhone/iPad=60 */
function getSystemSupportThreshold(categoryKey) {
    const c = categoryKey.toLowerCase();
    if (c.startsWith('iphone') || c.startsWith('ipad'))
        return 60;
    return 72; // Mac 系列 (含 Vision Pro 等)
}
/** 计算机龄(月) = (分析日期 - 发布日期) × 12; 发布日期解析复用 release.ts 的共享实现 */
function computeAgeMonths(constants, releaseDateKey) {
    const releaseDate = resolveProductReleaseDate(constants, releaseDateKey);
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
    // v3.8: 取消性能地板过滤 (性能地板仅作图上参考线, 不再过滤候选)
    // 仅保留买入价 ≤ 预算 硬约束
    const plans = frontier.filter((p) => p.buyPrice <= params.budget);
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