/**
 * 月均成本计算模块
 *
 * 公式(来自 SKILL.md 步骤5 & constants.json "月均成本计算公式"):
 *   月均成本 = (买入价 − 预期卖出残值 + 持有期预期维修成本) / 持有月数
 *   预期卖出残值 = 买入价 × R(卖出机龄) / R(买入机龄)   (v4.3 买入价锚定)
 *   维修成本 = floor(持有月数 / 电池寿命周期) × 单次电池更换费 + 持有年数 × 年均故障维修费
 *
 * v4.3 残值买入价锚定:
 *   旧口径 残值 = R(卖出机龄) × 当前同品类新品价 与买入价脱钩, 当快照市场价低于
 *   曲线隐含值时出现 残值 > 买入价 (月均成本为负)。新口径以买入价为锚, 按保值曲线
 *   取买入→卖出区间的相对衰减, 结构性保证 残值 ≤ 买入价。
 *   买入机龄取值(按候选类型):
 *     · 类型 A (现在买):            买入机龄 = 当前机龄
 *     · 类型 B (等新品买新品):      买入机龄 = 0 (R(0)=100%, 行为与旧公式等价)
 *     · 类型 C (等新品后买降价老款): 买入机龄 = 当前机龄 + 等待月数
 *   (发布冲击折扣已锚定在买入价中, 自然传导至残值; 类型 A 的冲击时变调整由
 *    pareto.ts applyResidualImpact 叠加在锚定残值之上)
 *   安全网: 比率 R(卖出机龄)/R(买入机龄) 封顶 1, 防曲线非单调/两端触底时残值超买入价。
 *
 * 注: 本模块计算"基础月均成本", 不含 v3.8 宏观因子调整(冲击时变曲线/价格传导)。
 *     v3.8 机制涉及实时宏观扫描, 不适合确定性引擎, 留给 skill 层处理。
 */
import type { Constants } from './types.js';
import { getRetentionRate } from './retention.js';

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
  /** 买入时保值率(%, 0-100, v4.3 锚定公式的分母项) */
  buyRetentionRate: number;
  /** 当前同品类新品价(元, 仅信息展示, 不参与残值计算) */
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
 * @param currentAgeMonths 当前机龄(月), 类型 A 的买入机龄
 * @param holdingMonths 持有月数
 * @param currentNewPrice 当前同品类新品价(仅信息展示, 不参与残值计算)
 */
export function computeMonthlyCost(
  constants: Constants,
  category: string,
  buyPrice: number,
  currentAgeMonths: number,
  holdingMonths: number,
  currentNewPrice: number,
): CostBreakdown {
  const sellAgeMonths = currentAgeMonths + holdingMonths;
  const buyAgeMonths = currentAgeMonths;

  // 保值率(查表插值/外推), v4.3 残值 = 买入价 × R(卖出机龄)/R(买入机龄), 比率封顶 1
  const retentionRate = getRetentionRate(constants.retentionCurves, category, sellAgeMonths);
  const buyRetentionRate = getRetentionRate(constants.retentionCurves, category, buyAgeMonths);
  const residual = buyPrice * Math.min(1, retentionRate / buyRetentionRate);

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
    buyRetentionRate,
    currentNewPrice,
    holdingMonths,
  };
}

/**
 * 计算持有期预期维修成本
 * = floor(持有月数 / 电池寿命周期) × 单次电池更换费 + 持有年数 × 年均故障维修费
 */
export function computeMaintenanceCost(
  constants: Constants,
  category: string,
  holdingMonths: number,
): number {
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
 *   - 残值 MUST NOT 施加新品发布冲击调整 (类型 C 的冲击已体现在买入价中, 且 v4.3
 *     锚定公式让冲击折扣自然传导至残值; 类型 B 买入的就是新品)
 *   - 卖出时机龄由调用方显式传入:
 *     · 类型 B (等新品买新品): sellAgeMonths = holdingMonths (买入时为新机, 机龄 0)
 *     · 类型 C (等新品后买降价老款): sellAgeMonths = 当前机龄 + 等待月数 + 持有月数
 *
 * v4.3 残值买入价锚定: 买入机龄 = sellAgeMonths − holdingMonths
 *   (类型 B 得 0, 类型 C 得 当前机龄+等待月数), 残值 = 买入价 × R(卖出机龄)/R(买入机龄)
 *
 * @param sellAgeMonths 卖出时机龄 (月), 由调用方按候选类型计算
 */
export function computeMonthlyCostForWaitCandidate(
  constants: Constants,
  category: string,
  buyPrice: number,
  holdingMonths: number,
  currentNewPrice: number,
  sellAgeMonths: number,
): CostBreakdown {
  const buyAgeMonths = sellAgeMonths - holdingMonths;
  const retentionRate = getRetentionRate(constants.retentionCurves, category, sellAgeMonths);
  const buyRetentionRate = getRetentionRate(constants.retentionCurves, category, buyAgeMonths);
  const residual = buyPrice * Math.min(1, retentionRate / buyRetentionRate);
  const maintenanceCost = computeMaintenanceCost(constants, category, holdingMonths);
  const monthlyCost = (buyPrice - residual + maintenanceCost) / holdingMonths;

  return {
    monthlyCost,
    buyPrice,
    residual,
    maintenanceCost,
    sellAgeMonths,
    retentionRate,
    buyRetentionRate,
    currentNewPrice,
    holdingMonths,
  };
}

/** 品类名 → 维修成本表键名 */
function mapCategoryToMaintenanceKey(category: string): string {
  const c = category.toLowerCase().replace(/[-\s]/g, '_');
  const map: Record<string, string> = {
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
 * 从市场快照中提取当前同品类新品价
 *
 * v4.3 起不参与残值计算(残值已改为买入价锚定), 仅用于:
 *   - 类型 B 买入价预测的基准价 (predictNewProductPrice)
 *   - 报表/端上的信息展示
 *
 * 取值规则 (v4.2, 原「残值分母选择规则」): 在「新品」且含官方价的条目中,
 * 取 productReleaseDates 发布月最晚者; 发布月并列时优先基础款 (芯片名不含
 * Pro/Max/Ultra 后缀)。MUST NOT 依赖快照键的插入顺序。
 * 无可解析条目时兜底旧行为: 首个含官方价的新品条目, 再退任意含官方价条目。
 */
export function getCurrentNewPrice(
  constants: Constants,
  category: string,
): number {
  const snapshots = constants.marketSnapshots[category];
  if (!snapshots) return 0;

  // v4.2: 发布月最晚 + 同月基础款优先 (不依赖键顺序)
  let best: { price: number; month: string; isBase: boolean } | null = null;
  for (const [key, entry] of Object.entries(snapshots)) {
    if (!key.includes('新品')) continue;
    if (typeof entry.官方价 !== 'number' || entry.官方价 <= 0) continue;
    const month = resolveSnapshotReleaseMonth(constants, category, key);
    if (!month) continue;
    const isBase = !/(Pro|Max|Ultra)/.test(extractSnapshotChip(key));
    if (
      !best
      || month > best.month
      || (month === best.month && isBase && !best.isBase)
    ) {
      best = { price: entry.官方价, month, isBase };
    }
  }
  if (best) return best.price;

  // 兜底: 首个含官方价的新品条目 (旧行为)
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
 * 从快照 modelKey 推导 productReleaseDates 键并解析发布月 (YYYY-MM)。
 * 推导规则与 pareto.ts parseModelKey 的 releaseDateKey 部分同款:
 *   - iPhone: "iPhone_16_Pro_256G_新品" → "iPhone_16" (前两段)
 *   - Mac 无屏幕尺寸: "M6_16G_256G_新品" → "${category}_${rawChip}"
 *   - Mac 带屏幕尺寸: "M5_Pro_14寸_16G_512G_新品" → "${category}_${屏幕}_${rawChip}"
 * 解析失败返回 null。
 */
function resolveSnapshotReleaseMonth(
  constants: Constants,
  category: string,
  modelKey: string,
): string | null {
  const withoutCondition = modelKey.replace(/_(新品|二手)(_.*)?$/, '');
  const segments = withoutCondition.split('_');

  let releaseDateKey: string;
  if (segments[0] === 'iPhone') {
    releaseDateKey = segments.slice(0, 2).join('_');
  } else {
    const gbIndex = segments.findIndex((s) => /^(\d+)G$/i.test(s));
    const chipEnd = gbIndex >= 0 ? gbIndex : segments.length;
    const rawChip = segments.slice(0, chipEnd).filter((s) => !/^\d+寸$/.test(s)).join('_');
    if (!rawChip) return null;
    const screenMatch = segments.find((s) => /^\d+寸$/.test(s));
    releaseDateKey = screenMatch
      ? `${category}_${screenMatch.replace('寸', '')}_${rawChip}`
      : `${category}_${rawChip}`;
  }

  let date: string | undefined = constants.productReleaseDates[releaseDateKey];
  if (!date) {
    date = constants.productReleaseDates[releaseDateKey.replace(/_(Pro|Max|Ultra)/g, '$1')];
  }
  if (!date) {
    date = constants.productReleaseDates[releaseDateKey.replace(/(?<!_)(Pro|Max|Ultra)/g, '_$1')];
  }
  if (typeof date !== 'string') return null;
  const m = date.match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : null;
}

/** 从快照 modelKey 提取芯片段 (内存/存储段之前, 去屏幕尺寸段), 如 "M5_Pro_24G_512G_新品" → "M5_Pro" */
function extractSnapshotChip(modelKey: string): string {
  const withoutCondition = modelKey.replace(/_(新品|二手)(_.*)?$/, '');
  const segments = withoutCondition.split('_');
  const gbIndex = segments.findIndex((s) => /^(\d+)G$/i.test(s));
  const chipEnd = gbIndex >= 0 ? gbIndex : segments.length;
  return segments.slice(0, chipEnd).filter((s) => !/^\d+寸$/.test(s)).join('_');
}

/**
 * 从市场快照中提取买入价
 * - 新品: 优先 京东国补到手价, 其次 官方价
 * - 二手: 优先 闲鱼中位价_二手同款, 其次 _参考
 */
export function getBuyPrice(
  entry: Constants['marketSnapshots'][string][string],
  buyTiming: 'new' | 'used',
): number | null {
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
