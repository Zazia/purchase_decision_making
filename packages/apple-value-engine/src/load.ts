/**
 * loadConstants: 解析 constants.json 文本, 校验必需字段, 映射中文键 → 英文类型字段
 *
 * constants.json 实际使用中文键名(如 "保值率曲线"), 本函数将其映射为
 * Constants 接口的英文字段名(如 retentionCurves), 使引擎公共 API 符合 spec 约定。
 * 映射表在此处集中维护, 调用方无感知。
 */
import type { Constants } from './types.js';
import { ConstantsValidationError } from './types.js';

/** 中文键 → 英文字段名映射 */
const KEY_MAP = {
  metadata: 'metadata',
  保值率曲线: 'retentionCurves',
  芯片性能跑分: 'chipBenchmarks',
  芯片代际提升假设: 'chipGenerationAssumptions',
  内存体验权重: 'memoryWeights',
  存储体验权重: 'storageWeights',
  苹果产品发布节奏: 'releaseRhythm',
  新品发布对老款冲击: 'newReleaseImpact',
  持有期预期维修成本: 'maintenanceCosts',
  性能满足度计算公式: 'performanceFormula',
  产品发布日期: 'productReleaseDates',
  月均成本计算公式: 'costFormula',
  实时市场价快照: 'marketSnapshots',
  design_tokens: 'designTokens',
} as const;

/** 必需字段(英文键名), 缺失则抛 ConstantsValidationError */
const REQUIRED_FIELDS: ReadonlyArray<{ english: string; chinese: string }> = [
  { english: 'last_updated', chinese: 'metadata.last_updated' },
  { english: 'retention_curves', chinese: '保值率曲线' },
  { english: 'chip_benchmarks', chinese: '芯片性能跑分' },
  { english: 'market_snapshots', chinese: '实时市场价快照' },
  { english: 'release_rhythm', chinese: '苹果产品发布节奏' },
  { english: 'maintenance_costs', chinese: '持有期预期维修成本' },
  { english: 'performance_formula', chinese: '性能满足度计算公式' },
  { english: 'product_release_dates', chinese: '产品发布日期' },
  { english: 'chip_generation_assumptions', chinese: '芯片代际提升假设' },
  { english: 'memory_weights', chinese: '内存体验权重' },
  { english: 'storage_weights', chinese: '存储体验权重' },
];

/**
 * 解析 constants.json 文本并校验。
 * @throws {ConstantsValidationError} 必需字段缺失时抛出, 错误信息含英文 spec 字段名
 * @throws {SyntaxError} JSON 解析失败
 */
export function loadConstants(jsonText: string): Constants {
  const raw: Record<string, unknown> = JSON.parse(jsonText);

  // 校验 metadata.last_updated
  const metadata = raw['metadata'] as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata.last_updated !== 'string' || metadata.last_updated.length === 0) {
    throw new ConstantsValidationError('last_updated', 'Missing required field: last_updated');
  }

  // 校验其余必需字段(检查中文键是否存在)
  for (const { english, chinese } of REQUIRED_FIELDS) {
    if (english === 'last_updated') continue;
    if (raw[chinese] === undefined) {
      throw new ConstantsValidationError(english, `Missing required field: ${english}`);
    }
  }

  return {
    lastUpdated: metadata.last_updated as string,
    version: typeof metadata.version === 'string' ? metadata.version : '',
    retentionCurves: raw['保值率曲线'] as Constants['retentionCurves'],
    chipBenchmarks: raw['芯片性能跑分'] as Constants['chipBenchmarks'],
    chipGenerationAssumptions: raw['芯片代际提升假设'] as Constants['chipGenerationAssumptions'],
    memoryWeights: raw['内存体验权重'] as Constants['memoryWeights'],
    storageWeights: raw['存储体验权重'] as Constants['storageWeights'],
    releaseRhythm: raw['苹果产品发布节奏'] as Constants['releaseRhythm'],
    newReleaseImpact: raw['新品发布对老款冲击'] as Constants['newReleaseImpact'],
    maintenanceCosts: raw['持有期预期维修成本'] as Constants['maintenanceCosts'],
    performanceFormula: raw['性能满足度计算公式'] as Constants['performanceFormula'],
    productReleaseDates: raw['产品发布日期'] as Constants['productReleaseDates'],
    costFormula: raw['月均成本计算公式'] as Constants['costFormula'],
    marketSnapshots: raw['实时市场价快照'] as Constants['marketSnapshots'],
    designTokens: raw['design_tokens'] as Constants['designTokens'],
  };
}

/** 供调试: 查看键映射表 */
export function getKeyMap(): Readonly<Record<string, string>> {
  return KEY_MAP;
}
