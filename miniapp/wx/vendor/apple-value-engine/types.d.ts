/**
 * apple-value-engine 类型定义
 *
 * 注意: constants.json 实际使用中文键名, loadConstants() 内部完成
 * 中文键 → 英文字段名的映射。公共 API 仅暴露英文字段名(符合 spec 约定)。
 */
/** 保值率曲线: { 品类: { 发布后月数: 保值率% } } */
export type RetentionCurves = Record<string, Record<number, number>>;
/** 芯片跑分 */
export interface ChipBenchmarks {
    Mac芯片?: Record<string, {
        单核: number;
        多核: number;
        GPU_OpenCL?: number;
        [k: string]: unknown;
    }>;
    iPhone_iPad芯片?: Record<string, {
        单核: number;
        多核: number;
        [k: string]: unknown;
    }>;
}
/** 芯片代际提升假设 */
export interface ChipGenerationAssumptions {
    M系列?: {
        r: number;
        [k: string]: unknown;
    };
    A系列?: {
        r: number;
        [k: string]: unknown;
    };
}
/** 内存/存储体验权重 */
export interface ExperienceWeights {
    iPhone_iPad?: Record<string, number>;
    Mac_基础?: Record<string, number>;
    Mac_Pro?: Record<string, number>;
}
/** 发布节奏 */
export type ReleaseRhythm = Record<string, {
    发布周期月?: number;
    典型发布月?: number | string;
    [k: string]: unknown;
}>;
/** 新品发布对老款冲击 */
export interface NewReleaseImpact {
    [k: string]: unknown;
}
/** 维修成本 */
export interface MaintenanceCosts {
    电池寿命周期_月: number;
    单次电池更换费用: Record<string, number>;
    年均故障维修费用: Record<string, number>;
}
/** 性能满足度计算公式(含品类基准芯片) */
export type PerformanceFormula = {
    品类基准芯片?: Record<string, string>;
    [k: string]: unknown;
};
/** 产品发布日期: { 机型key: "YYYY-MM" } */
export type ProductReleaseDates = Record<string, string>;
/** 月均成本计算公式(参考用) */
export type CostFormula = {
    [k: string]: unknown;
};
/** 市场价快照中的单条机型记录 */
export interface MarketSnapshotEntry {
    官方价?: number | null;
    闲鱼中位价_二手同款?: number;
    闲鱼中位价_二手同款_参考?: number;
    京东国补到手价?: number;
    京东国补到手价_参考?: number;
    京东自营价_参考?: number;
    [k: string]: unknown;
}
/** 市场价快照: { 品类: { 机型key: MarketSnapshotEntry } } */
export type MarketSnapshots = Record<string, Record<string, MarketSnapshotEntry>>;
/** 设计 token */
export type DesignTokens = {
    [k: string]: unknown;
};
/** 引擎使用的 Constants 结构(英文键名, 由 loadConstants 映射) */
export interface Constants {
    lastUpdated: string;
    version: string;
    retentionCurves: RetentionCurves;
    chipBenchmarks: ChipBenchmarks;
    chipGenerationAssumptions: ChipGenerationAssumptions;
    memoryWeights: ExperienceWeights;
    storageWeights: ExperienceWeights;
    releaseRhythm: ReleaseRhythm;
    newReleaseImpact: NewReleaseImpact;
    maintenanceCosts: MaintenanceCosts;
    performanceFormula: PerformanceFormula;
    productReleaseDates: ProductReleaseDates;
    costFormula: CostFormula;
    marketSnapshots: MarketSnapshots;
    designTokens: DesignTokens;
}
/** 买入时机 */
export type BuyTiming = 'new' | 'used';
/** 决策参数 */
export interface DecisionParams {
    /** 品类, 如 'mac-mini' / 'Mac_mini' / 'macbook-air' */
    category: string;
    /** 预算上限(元), 用于截取推荐区间 */
    budget: number;
    /** 候选持有年数, 如 [2, 3, 4] */
    holdingYears: number[];
    /** 买入时机: new=新品, used=二手 */
    buyTiming: BuyTiming;
    /** 性能地板(0-1), 用于截取推荐区间 */
    performanceFloor: number;
    /** M 系列 CAGR(默认 0.16), 可注入不硬编码 */
    mSeriesCAGR?: number;
    /** A 系列 CAGR(默认 0.15), 可注入不硬编码 */
    aSeriesCAGR?: number;
}
/** 候选方案点(帕累托二维平面上的点) */
export interface PlanPoint {
    /** 机型标识, 如 "Mac mini M2 16G 256G" */
    model: string;
    /** 芯片, 如 "M2" */
    chip: string;
    /** 买入时机 */
    buyTiming: BuyTiming;
    /** 持有年数 */
    holdingYears: number;
    /** 月均成本(元/月) */
    monthlyCost: number;
    /** 持有期平均性能满足度(0-1) */
    avgPerformance: number;
    /** 买入价(元) */
    buyPrice: number;
    /** 预期卖出残值(元) */
    residual: number;
    /** 持有期预期维修成本(元) */
    maintenanceCost: number;
    /** 持有月数 */
    holdingMonths: number;
    /** 初始性能满足度 S(0) (0-1) */
    performanceS0: number;
    /** 持有期末性能满足度 S(N) (0-1) */
    performanceSN: number;
}
/** 帕累托前沿结果 */
export interface ParetoFrontierResult {
    /** 前沿上的非劣方案(按月均成本升序) */
    frontier: PlanPoint[];
    /** 被支配的方案 */
    dominated: PlanPoint[];
    /** 推荐区间(经用户偏好截取后) */
    recommendationRange: {
        lowerCost: number;
        upperCost: number;
        /** 推荐区间内的方案 */
        plans: PlanPoint[];
    };
}
/** 常量校验错误 */
export declare class ConstantsValidationError extends Error {
    readonly fieldName: string;
    constructor(fieldName: string, message?: string);
}
//# sourceMappingURL=types.d.ts.map