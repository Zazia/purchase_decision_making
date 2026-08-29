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
};
/** 必需字段(英文键名), 缺失则抛 ConstantsValidationError */
const REQUIRED_FIELDS = [
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
export function loadConstants(jsonText) {
    const raw = JSON.parse(jsonText);
    // 校验 metadata.last_updated
    const metadata = raw['metadata'];
    if (!metadata || typeof metadata.last_updated !== 'string' || metadata.last_updated.length === 0) {
        throw new ConstantsValidationError('last_updated', 'Missing required field: last_updated');
    }
    // 校验其余必需字段(检查中文键是否存在)
    for (const { english, chinese } of REQUIRED_FIELDS) {
        if (english === 'last_updated')
            continue;
        if (raw[chinese] === undefined) {
            throw new ConstantsValidationError(english, `Missing required field: ${english}`);
        }
    }
    // v3.8 子对象 (嵌套于现有顶层键内, 提取为独立英文字段便于 release.ts 解析)
    const releaseRhythmRaw = raw['苹果产品发布节奏'];
    const newReleaseImpactRaw = raw['新品发布对老款冲击'];
    return {
        lastUpdated: metadata.last_updated,
        version: typeof metadata.version === 'string' ? metadata.version : '',
        retentionCurves: raw['保值率曲线'],
        chipBenchmarks: raw['芯片性能跑分'],
        chipGenerationAssumptions: raw['芯片代际提升假设'],
        memoryWeights: raw['内存体验权重'],
        storageWeights: raw['存储体验权重'],
        releaseRhythm: raw['苹果产品发布节奏'],
        newReleaseImpact: raw['新品发布对老款冲击'],
        maintenanceCosts: raw['持有期预期维修成本'],
        performanceFormula: raw['性能满足度计算公式'],
        productReleaseDates: raw['产品发布日期'],
        costFormula: raw['月均成本计算公式'],
        marketSnapshots: raw['实时市场价快照'],
        designTokens: raw['design_tokens'],
        waitPeriodModel: releaseRhythmRaw?.['_缺货等待期模型_v3.8'],
        releaseTimeValidation: releaseRhythmRaw?.['_发布时间预测校验_v3.8'],
        macroFactorAdjustment: newReleaseImpactRaw?.['_宏观因子调整_v3.8'],
        impactTimeVaryingCurve: newReleaseImpactRaw?.['_冲击时变曲线_v3.8'],
        pricePredictionModel: newReleaseImpactRaw?.['_新品价格预测模型_v3.8'],
    };
}
/** 供调试: 查看键映射表 */
export function getKeyMap() {
    return KEY_MAP;
}
//# sourceMappingURL=load.js.map