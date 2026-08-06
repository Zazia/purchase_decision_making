/**
 * 性能满足度计算模块
 *
 * 公式(来自 SKILL.md 步骤4 & constants.json "性能满足度计算公式"):
 *   S(0) = 芯片性能系数 × 内存权重 × 存储权重 × 100%
 *   芯片性能系数 = 该芯片多核跑分 / 该品类当前旗舰芯片多核跑分
 *   S(t) = S(0) / (1 + r)^(t/12)
 *   S̄(N) = [S(0) + S(N)] / 2   (持有期平均, 线性近似)
 *
 * r 值:
 *   M 系列: 0.16 (CAGR, v3.8 用 M5 实测重算, 可通过参数注入)
 *   A 系列: 0.15 (CAGR, 可通过参数注入)
 *
 * 代际跃升识别:
 *   跃升代际(节点成熟/架构大改/核心数增): r × 1.5
 *   节点首发代际(2nm/3nm 首发良率受限): r × 0.5
 *   常规代际: r
 */
import type { Constants } from './types.js';

/** 性能满足度计算结果 */
export interface PerformanceResult {
  /** S(0), 初始性能满足度 (0-1) */
  s0: number;
  /** S(N), 持有期末性能满足度 (0-1) */
  sN: number;
  /** S̄(N), 持有期平均性能满足度 (0-1) */
  avgS: number;
  /** 使用的有效 r 值 */
  effectiveR: number;
}

/** 默认 CAGR */
const DEFAULT_M_CAGR = 0.16;
const DEFAULT_A_CAGR = 0.15;

/**
 * 计算某机型在指定持有月数下的性能满足度
 *
 * @param constants 常量数据
 * @param chipName 芯片名, 如 "M2", "M2_Pro", "A18_Pro"
 * @param memoryGb 内存(GB), 如 16
 * @param storageGb 存储(GB), 如 256
 * @param category 品类(英文/中文均可), 如 "Mac_mini"
 * @param holdingMonths 持有月数
 * @param mCAGR M 系列 CAGR(默认 0.16)
 * @param aCAGR A 系列 CAGR(默认 0.15)
 */
export function computePerformance(
  constants: Constants,
  chipName: string,
  memoryGb: number,
  storageGb: number,
  category: string,
  holdingMonths: number,
  mCAGR: number = DEFAULT_M_CAGR,
  aCAGR: number = DEFAULT_A_CAGR,
): PerformanceResult {
  const chipCoeff = getChipCoefficient(constants, chipName, category);
  const memWeight = getMemoryWeight(constants, category, memoryGb);
  const storageWeight = getStorageWeight(constants, category, storageGb);

  const s0 = Math.min(1, chipCoeff * memWeight * storageWeight);

  // 默认使用基础 r 值(CAGR), 不自动应用代际跃升调整。
  // 跃升调整(r×1.5 / r×0.5)是对下一代新品性能预测的可选修正,
  // SKILL.md 示例均使用基础 r。调用方可通过 getEffectiveR() 获取调整后 r 再传入。
  const isMSeries = chipName.startsWith('M');
  const r = isMSeries ? mCAGR : aCAGR;
  const sN = s0 / Math.pow(1 + r, holdingMonths / 12);
  const avgS = (s0 + sN) / 2;

  return { s0, sN, avgS, effectiveR: r };
}

/**
 * 计算芯片性能系数 = 该芯片多核跑分 / 品类旗舰芯片多核跑分
 */
export function getChipCoefficient(constants: Constants, chipName: string, category: string): number {
  const chipScore = getChipMultiCoreScore(constants, chipName);
  const flagshipScore = getCategoryFlagshipScore(constants, category);
  if (flagshipScore <= 0) return 0;
  return chipScore / flagshipScore;
}

/** 从 chipBenchmarks 查询芯片多核跑分 */
export function getChipMultiCoreScore(constants: Constants, chipName: string): number {
  const benchmarks = constants.chipBenchmarks;
  // Mac 芯片
  const macChips = benchmarks.Mac芯片;
  if (macChips && macChips[chipName]) {
    return Number(macChips[chipName].多核) || 0;
  }
  // iPhone/iPad 芯片
  const aChips = benchmarks.iPhone_iPad芯片;
  if (aChips && aChips[chipName]) {
    return Number(aChips[chipName].多核) || 0;
  }
  return 0;
}

/**
 * 从 performanceFormula.品类基准芯片 获取品类旗舰芯片多核跑分
 * 字段值格式如 "M5(多核17100)" 或 "A19 Pro(多核9500)"
 */
export function getCategoryFlagshipScore(constants: Constants, category: string): number {
  const base = constants.performanceFormula.品类基准芯片;
  if (!base) return 0;

  // 品类 → 基准芯片字段名映射
  const fieldKey = getCategoryBenchmarkKey(category);
  const entry = base[fieldKey];
  if (typeof entry !== 'string') return 0;

  // 解析 "M5(多核17100)" → 17100
  const match = entry.match(/多核\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** 品类 → 基准芯片字段名 */
function getCategoryBenchmarkKey(category: string): string {
  const c = normalizeCategory(category);
  const map: Record<string, string> = {
    'iphone': 'iPhone_iPad',
    'iphone_promax': 'iPhone_iPad',
    'iphone_pro': 'iPhone_iPad',
    'iphone_标准': 'iPhone_iPad',
    'ipad': 'iPhone_iPad',
    'ipad_pro': 'iPhone_iPad',
    'macbook_air': 'MacBook_Air',
    'macbook_pro': 'MacBook_Pro',
    'mac_mini': 'Mac_mini_基础',
    'mac_mini_pro': 'Mac_mini_Pro',
    'mac_studio': 'Mac_Studio_Pro',
    'imac': 'iMac',
    'mac_pro': 'Mac_Pro',
    'vision_pro': 'Vision_Pro',
  };
  return map[c] ?? 'MacBook_Air';
}

/** 获取内存权重 */
export function getMemoryWeight(constants: Constants, category: string, memoryGb: number): number {
  const table = getWeightTable(constants.memoryWeights, category);
  return lookupWeight(table, memoryGb);
}

/** 获取存储权重 */
export function getStorageWeight(constants: Constants, category: string, storageGb: number): number {
  const table = getWeightTable(constants.storageWeights, category);
  return lookupWeight(table, storageGb);
}

/** 根据品类选择权重子表 */
function getWeightTable(
  weights: Constants['memoryWeights'],
  category: string,
): Record<string, number> {
  const c = normalizeCategory(category);
  if (c.startsWith('iphone') || c.startsWith('ipad')) {
    return weights.iPhone_iPad ?? {};
  }
  if (c === 'macbook_pro' || c === 'mac_studio' || c === 'mac_pro') {
    return weights.Mac_Pro ?? {};
  }
  return weights.Mac_基础 ?? {};
}

/** 在权重表中查找, 支持 "16GB" / "16G" / 16 等键形式 */
function lookupWeight(table: Record<string, number>, value: number): number {
  const keys = [`${value}GB`, `${value}G`, `${value}gb`];
  for (const k of keys) {
    if (k in table) return table[k];
  }
  if (`${value}` in table) return table[`${value}`];
  // 找不到时取最接近的较小值
  const numericKeys = Object.entries(table)
    .map(([k, v]) => ({ num: parseInt(k, 10), weight: v }))
    .filter((x) => !Number.isNaN(x.num))
    .sort((a, b) => b.num - a.num);
  for (const x of numericKeys) {
    if (value >= x.num) return x.weight;
  }
  return numericKeys.length > 0 ? numericKeys[numericKeys.length - 1].weight : 1;
}

/**
 * 获取有效 r 值, 含代际跃升识别
 * - 跃升代际: r × 1.5
 * - 节点首发: r × 0.5
 * - 常规: r
 */
export function getEffectiveR(
  constants: Constants,
  chipName: string,
  mCAGR: number,
  aCAGR: number,
): { r: number; isMSeries: boolean } {
  const isMSeries = chipName.startsWith('M');
  const baseR = isMSeries ? mCAGR : aCAGR;

  const multiplier = getGenerationMultiplier(constants, chipName);
  return { r: baseR * multiplier, isMSeries };
}

/**
 * 查询芯片的代际类型倍率
 * 从 芯片代际提升假设.{M系列|A系列}.per_generation详表_v3.8 查找
 * 返回 1.5(跃升) / 0.5(节点首发) / 1.0(常规)
 */
function getGenerationMultiplier(constants: Constants, chipName: string): number {
  const series = chipName.startsWith('M') ? 'M系列' : 'A系列';
  const assumptions = constants.chipGenerationAssumptions[series as 'M系列' | 'A系列'];
  if (!assumptions) return 1;

  const perGen = assumptions['per_generation详表_v3.8'] as
    | Record<string, { 类型?: string }>
    | undefined;
  if (!perGen) return 1;

  // 提取芯片代号(去修饰), 如 "M2_Pro" → "M2", "A18_Pro" → "A18"
  const baseName = chipName.replace(/_(Pro|Max|Ultra)$/i, '');

  // 查找包含该芯片的代际转换(作为目标代)
  for (const [transition, info] of Object.entries(perGen)) {
    if (typeof info !== 'object' || info === null) continue;
    const type = info.类型 ?? '';
    // transition 格式如 "M1→M2", 检查目标代是否匹配
    const target = transition.split('→')[1]?.trim();
    if (target === baseName || target === chipName) {
      if (type.includes('跃升')) return 1.5;
      if (type.includes('低谷') || type.includes('首发')) return 0.5;
      return 1;
    }
  }
  return 1;
}

/** 品类名归一化(小写, 去连字符) */
function normalizeCategory(category: string): string {
  return category.toLowerCase().replace(/[-\s]/g, '_');
}
