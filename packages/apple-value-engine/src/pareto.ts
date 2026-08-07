/**
 * 帕累托前沿筛选模块
 *
 * 在(月均成本, 持有期平均性能满足度)二维平面上筛选非劣解。
 * 前沿点定义: 不存在其他点同时满足「成本更低且性能更高」(至少一个严格不等)。
 * 用户偏好(性能地板/预算上限)仅用于在前沿上截取推荐区间, 不改变前沿本身。
 */
import type { Constants, DecisionParams, PlanPoint, BuyTiming } from './types.js';
import { computePerformance } from './performance.js';
import { computeMonthlyCost, getCurrentNewPrice, getBuyPrice } from './cost.js';
import type { ParetoFrontierResult } from './types.js';

/**
 * 计算帕累托前沿
 *
 * @param constants 常量数据(由 loadConstants 加载)
 * @param params 决策参数
 * @returns { frontier, dominated, recommendationRange }
 */
export function computeParetoFrontier(
  constants: Constants,
  params: DecisionParams,
): ParetoFrontierResult {
  const categoryKey = resolveCategoryKey(constants, params.category);
  const candidates = extractCandidates(constants, categoryKey, params.buyTiming);

  // 为每个候选机型 × 持有年数生成方案点
  const points: PlanPoint[] = [];
  for (const cand of candidates) {
    for (const years of params.holdingYears) {
      const point = buildPlanPoint(constants, cand, years, params);
      if (point) points.push(point);
    }
  }

  // 帕累托前沿筛选
  const { frontier, dominated } = selectFrontier(points);

  // 推荐区间: 用户偏好截取
  const recommendationRange = selectRecommendationRange(frontier, params);

  return { frontier, dominated, recommendationRange };
}

// ============================================================================
// 候选方案提取
// ============================================================================

interface Candidate {
  modelKey: string;
  chip: string;
  memoryGb: number;
  storageGb: number;
  buyTiming: BuyTiming;
  buyPrice: number;
  releaseDateKey: string;
  /** 该候选所属的快照品类键(子品类, 如 iPhone_Pro), 用于保值率/维修/性能查表 */
  categoryKey: string;
}

/**
 * 从市场快照提取候选机型
 * 支持「父品类」聚合: 当 categoryKey 本身不存在时, 搜索所有子品类
 * (如 "iphone" → iPhone_Pro + iPhone_proMax + iPhone_标准)
 */
function extractCandidates(
  constants: Constants,
  categoryKey: string,
  buyTiming: BuyTiming,
): Candidate[] {
  // 确定要搜索的快照键列表
  let snapshotKeys: string[];
  if (constants.marketSnapshots[categoryKey]) {
    snapshotKeys = [categoryKey];
  } else {
    // 父品类: 搜索所有以 categoryKey + '_' 开头的子品类
    const prefix = categoryKey.toLowerCase() + '_';
    snapshotKeys = Object.keys(constants.marketSnapshots).filter(
      (k) => !k.startsWith('_') && k.toLowerCase().startsWith(prefix),
    );
  }

  const candidates: Candidate[] = [];
  for (const snapKey of snapshotKeys) {
    const snapshots = constants.marketSnapshots[snapKey];
    if (!snapshots) continue;

    for (const [modelKey, entry] of Object.entries(snapshots)) {
      const condition = buyTiming === 'new' ? '新品' : '二手';
      if (!modelKey.includes(condition)) continue;

      const parsed = parseModelKey(modelKey, snapKey);
      if (!parsed) continue;

      const buyPrice = getBuyPrice(entry, buyTiming);
      if (buyPrice === null || buyPrice <= 0) continue;

      candidates.push({
        modelKey,
        chip: parsed.chip,
        memoryGb: parsed.memoryGb,
        storageGb: parsed.storageGb,
        buyTiming,
        buyPrice,
        releaseDateKey: parsed.releaseDateKey,
        categoryKey: snapKey,
      });
    }
  }
  return candidates;
}

/**
 * 规范化芯片名: 将快照 modelKey 中的紧凑写法转为 benchmark 表的键名
 * M1Pro → M1_Pro, M5Max → M5_Max, M5Pro_Max → M5_Pro_Max
 */
function normalizeChipName(chip: string): string {
  return chip.replace(/(?<!_)(Pro|Max|Ultra)/g, '_$1');
}

/** iPhone 产品名 → 芯片名映射 (productReleaseDates 用 iPhone_N, benchmarks 用 A_N) */
const IPHONE_CHIP_MAP: Record<string, string> = {
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
function parseModelKey(
  modelKey: string,
  categoryKey: string,
): { chip: string; memoryGb: number; storageGb: number; releaseDateKey: string } | null {
  // 去掉条件后缀及附加修饰(如 _基础款, _升级款)
  const withoutCondition = modelKey.replace(/_(新品|二手)(_.*)?$/, '');
  const segments = withoutCondition.split('_');

  // 找内存和存储段(匹配 \d+G)
  const gbSegments: { index: number; value: number }[] = [];
  segments.forEach((seg, i) => {
    const m = seg.match(/^(\d+)G$/i);
    if (m) gbSegments.push({ index: i, value: Number(m[1]) });
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

  if (!rawChip) return null;

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

function buildPlanPoint(
  constants: Constants,
  cand: Candidate,
  holdingYears: number,
  params: DecisionParams,
): PlanPoint | null {
  const holdingMonths = holdingYears * 12;

  // 当前机龄(月) — 用候选自身的子品类键查发布日期
  const currentAgeMonths = computeAgeMonths(constants, cand.releaseDateKey);
  if (currentAgeMonths < 0) return null;

  // 当前同品类新品价(残值分母) — 用候选自身的子品类键
  const currentNewPrice = getCurrentNewPrice(constants, cand.categoryKey);

  // 月均成本 — 用候选自身的子品类键查保值率/维修费
  const cost = computeMonthlyCost(
    constants,
    cand.categoryKey,
    cand.buyPrice,
    currentAgeMonths,
    holdingMonths,
    currentNewPrice,
  );

  // 性能满足度 — 用候选自身的子品类键查基准芯片
  const perf = computePerformance(
    constants,
    cand.chip,
    cand.memoryGb,
    cand.storageGb,
    cand.categoryKey,
    holdingMonths,
    params.mSeriesCAGR,
    params.aSeriesCAGR,
  );

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
function computeAgeMonths(constants: Constants, releaseDateKey: string): number {
  let releaseDate = constants.productReleaseDates[releaseDateKey];

  // 模糊兜底 1: 去掉屏幕尺寸段再试 (MacBook_Pro_14_M3Pro → MacBook_Pro_M3Pro)
  if (!releaseDate) {
    const withoutScreen = releaseDateKey.replace(/_\d+_(?=[^_]+$)/, '_');
    if (withoutScreen !== releaseDateKey) {
      releaseDate = constants.productReleaseDates[withoutScreen];
    }
  }

  // 模糊兜底 2: 按芯片名(最后一段)搜索其他尺寸/子品类的发布日期
  // (如 "MacBook_Pro_14_M3Pro" 不存在, 但 "MacBook_Pro_16_M3Pro" 存在)
  if (!releaseDate) {
    const chip = releaseDateKey.split('_').pop();
    if (chip) {
      // 优先匹配同品类前缀 + 同芯片后缀
      const categoryPrefix = releaseDateKey.split('_').slice(0, -2).join('_'); // 如 "MacBook_Pro"
      for (const [key, val] of Object.entries(constants.productReleaseDates)) {
        if (key.startsWith(categoryPrefix + '_') && key.endsWith('_' + chip) && typeof val === 'string') {
          releaseDate = val;
          break;
        }
      }
    }
  }
  if (!releaseDate) return -1;

  // 解析 "YYYY-MM" 或 "YYYY-MM(预计)"
  const match = releaseDate.match(/^(\d{4})-(\d{1,2})/);
  if (!match) return -1;

  const releaseYear = Number(match[1]);
  const releaseMonth = Number(match[2]);

  // 分析日期 = constants.lastUpdated
  const analysisMatch = constants.lastUpdated.match(/^(\d{4})-(\d{1,2})/);
  if (!analysisMatch) return -1;
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
function selectFrontier(
  points: PlanPoint[],
): { frontier: PlanPoint[]; dominated: PlanPoint[] } {
  if (points.length === 0) return { frontier: [], dominated: [] };

  // 按月均成本升序, 成本相同按性能降序
  const sorted = [...points].sort((a, b) => {
    if (a.monthlyCost !== b.monthlyCost) return a.monthlyCost - b.monthlyCost;
    return b.avgPerformance - a.avgPerformance;
  });

  const frontier: PlanPoint[] = [];
  const dominated: PlanPoint[] = [];
  let maxPerf = -Infinity;

  for (const p of sorted) {
    if (p.avgPerformance > maxPerf) {
      frontier.push(p);
      maxPerf = p.avgPerformance;
    } else {
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

function selectRecommendationRange(
  frontier: PlanPoint[],
  params: DecisionParams,
): ParetoFrontierResult['recommendationRange'] {
  // 截取: 买入价 ≤ 预算 且 性能 ≥ 性能地板
  const plans = frontier.filter(
    (p) => p.buyPrice <= params.budget && p.avgPerformance >= params.performanceFloor,
  );

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
function resolveCategoryKey(constants: Constants, category: string): string {
  // 直接命中
  if (constants.marketSnapshots[category]) return category;

  // kebab → snake (mac-mini → Mac_mini)
  const snakeFromKebab = category
    .toLowerCase()
    .split('-')
    .map((part, i) =>
      i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join('_');

  if (constants.marketSnapshots[snakeFromKebab]) return snakeFromKebab;

  // 全大写首字母 (mac_mini → Mac_mini)
  const titleCase = category
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('_');

  if (constants.marketSnapshots[titleCase]) return titleCase;

  // 兜底: 遍历找不区分大小写匹配
  const lower = category.toLowerCase().replace(/[-\s]/g, '_');
  for (const key of Object.keys(constants.marketSnapshots)) {
    if (key.toLowerCase() === lower) return key;
  }

  return snakeFromKebab;
}
