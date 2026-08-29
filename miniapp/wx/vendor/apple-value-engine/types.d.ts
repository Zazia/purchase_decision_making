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
/** v3.8 缺货等待期模型 (嵌套于 苹果产品发布节奏._缺货等待期模型_v3.8) */
export interface WaitPeriodModel {
    _分品类上市到货延迟_基线?: Record<string, {
        中位?: string;
        悲观?: string;
        [k: string]: unknown;
    }>;
    '_宏观产能延迟_v3.8'?: {
        _宏观产能因子表?: Record<string, {
            因子?: string;
            [k: string]: unknown;
        }>;
        [k: string]: unknown;
    };
    [k: string]: unknown;
}
/** v3.8 发布时间预测校验 (嵌套于 苹果产品发布节奏._发布时间预测校验_v3.8) */
export interface ReleaseTimeValidation {
    [resultKey: string]: Record<string, {
        预测?: string;
        实测?: string;
        置信度?: string;
        处理?: string;
        [k: string]: unknown;
    }> | unknown;
}
/** v3.8 宏观因子调整 (嵌套于 新品发布对老款冲击._宏观因子调整_v3.8) */
export interface MacroFactorAdjustment {
    _价格传导因子表?: Record<string, string>;
    [k: string]: unknown;
}
/** v3.8 冲击时变曲线 (嵌套于 新品发布对老款冲击._冲击时变曲线_v3.8) */
export interface ImpactTimeVaryingCurve {
    [period: string]: {
        残值调整因子?: number;
        买入价下降因子?: number;
        [k: string]: unknown;
    } | string | unknown;
}
/** v3.8 新品价格预测模型 (嵌套于 新品发布对老款冲击._新品价格预测模型_v3.8) */
export interface PricePredictionModel {
    _分品类预测涨幅表?: {
        [k: string]: Record<string, {
            预测涨幅?: string;
            中位数?: string;
            依据?: string;
            [k: string]: unknown;
        }> | unknown;
    };
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
    /** 缺货等待期模型 (苹果产品发布节奏._缺货等待期模型_v3.8) */
    waitPeriodModel?: WaitPeriodModel;
    /** 发布时间预测校验 (苹果产品发布节奏._发布时间预测校验_v3.8) */
    releaseTimeValidation?: ReleaseTimeValidation;
    /** 宏观因子调整 (新品发布对老款冲击._宏观因子调整_v3.8) */
    macroFactorAdjustment?: MacroFactorAdjustment;
    /** 冲击时变曲线 (新品发布对老款冲击._冲击时变曲线_v3.8) */
    impactTimeVaryingCurve?: ImpactTimeVaryingCurve;
    /** 新品价格预测模型 (新品发布对老款冲击._新品价格预测模型_v3.8) */
    pricePredictionModel?: PricePredictionModel;
}
/** 买入时机: new=新品, used=二手, both=同时收集新品与二手候选 */
export type BuyTiming = 'new' | 'used' | 'both';
/** v3.8 宏观状态 (由调用方注入, 引擎不发起网络请求) */
export interface MacroContext {
    /** 存储超级周期阶段, 未触发为 'none' */
    storageSuperCycleStage: 'ongoing' | 'peaking' | 'easing' | 'none';
    /** 是否检测到苹果全线涨价事件 */
    hasGlobalPriceHike: boolean;
    /** 分析日期 (YYYY-MM), 用于计算距下次发布的月数 */
    analysisMonth: string;
}
/** v3.8 品类发布计划 (从 constants 解析得出) */
export interface ReleasePlan {
    category: string;
    /** 下次预计发布月 (YYYY-MM), 无预测时为 null */
    nextReleaseMonth: string | null;
    /** 发布时间预测置信度: high=已官宣/medium=同季度/low=偏离≥1季度或无信息 */
    releaseConfidence: 'high' | 'medium' | 'low';
    /** 上市到货延迟基线 (天), 来自 _分品类上市到货延迟_基线.中位 */
    baselineDelayDays: number;
    /** 上市到货延迟悲观值 (天), 来自 _分品类上市到货延迟_基线.悲观 */
    pessimisticDelayDays: number;
    /** 宏观产能因子 (1.0/1.5/2.0), 按 storageSuperCycleStage 查表 */
    macroCapacityFactor: number;
    /** 预测涨幅中位数 (如 0.12 表示 12%), 未触发宏观事件时为 0 */
    predictedPriceHike?: number;
    /** 该品类是否已涨价 (true 时类型 B 直接用快照官方价; v4.1 起含"已官宣"状态) */
    hasHikeOccurred: boolean;
    /**
     * 锚涨幅 (v4.1, SOP §9.4): 新品已官宣定价且高于老款现行官方价时,
     * = 预测涨幅表中位数 (相对老款现行官方价口径); 未官宣时为 0, 公式退化为 v3.8 形式。
     * 类型 C 买入价乘 (1 + 锚涨幅), 价格传导因子按锚涨幅查表。
     */
    anchorHike?: number;
}
/** 决策参数 */
export interface DecisionParams {
    /** 品类, 如 'mac-mini' / 'Mac_mini' / 'macbook-air' */
    category: string;
    /** 预算上限(元), 用于截取推荐区间 */
    budget: number;
    /** 候选持有年数, 如 [2, 3, 4] */
    holdingYears: number[];
    /** 买入时机: new=新品, used=二手, both=同时收集两类 */
    buyTiming: BuyTiming;
    /** 性能地板(0-1), 仅作图上参考线与推荐区间内徽章标注, 不再过滤候选 */
    performanceFloor: number;
    /** M 系列 CAGR(默认 0.16), 可注入不硬编码 */
    mSeriesCAGR?: number;
    /** A 系列 CAGR(默认 0.15), 可注入不硬编码 */
    aSeriesCAGR?: number;
    /** 是否考虑等新品候选(默认 true, 引擎自动判断是否生成 B/C 候选) */
    considerWait?: boolean;
    /** 宏观状态(由调用方注入, 引擎不发起网络请求); 缺省按 none 处理 */
    macroContext?: MacroContext;
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
    /** 候选类型: A=现在买, B=等新品买新品, C=等新品后买降价老款 */
    candidateType: 'A' | 'B' | 'C';
    /** 等待月数 (仅类型 B/C, 含缺货延迟) */
    waitMonths?: number;
    /** 买入价是否为预测值 (类型 B/C 恒为 true) */
    predictedPrice?: boolean;
    /** 系统支持期风险标注 (来自步骤 1.6) */
    systemSupportRisk?: 'normal' | 'near-end' | 'exceeded';
    /** 超出系统支持期的月数 (仅 exceeded 时有值) */
    systemSupportExceedMonths?: number;
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
/**
 * 用户编辑后的方案点
 *
 * - source='original': 来自原 result 页快照, 未被用户修改 (引擎按原 buyPrice 重算)
 * - source='edited':   用户修改了买入价 (引擎用 editedBuyPrice 重算月均成本)
 * - source='custom':   用户新增的自定义方案 (引擎用 buildPlanPointFromInputs 构建)
 *
 * excluded/deferred 标记由端内编辑器维护, 引擎重算时过滤掉这两类。
 * channel/useSubsidy 为端内众包回传影子库用, 引擎透传不参与计算。
 */
export interface EditedPlanPoint extends PlanPoint {
    /** 用户覆盖的买入价 (仅 source='edited' 时有意义, 引擎重算时替代 buyPrice) */
    editedBuyPrice?: number;
    /** 方案来源: 原始 / 用户改价 / 用户新增 */
    source: 'original' | 'edited' | 'custom';
    /** 已排除: 引擎重算时过滤掉 */
    excluded?: boolean;
    /** 暂不考虑: 引擎重算时过滤掉 (与 excluded 同义, 端内用于分组区分) */
    deferred?: boolean;
    /** 购买渠道 (端内众包回传用, 引擎不参与计算) */
    channel?: string;
    /** 是否使用国补 (端内众包回传用) */
    useSubsidy?: boolean;
    /** 内存 GB (端内自添加方案显式填写, 优先于 model 字符串解析) */
    memoryGb?: number;
    /** 存储 GB (端内自添加方案显式填写, 优先于 model 字符串解析) */
    storageGb?: number;
}
/**
 * 用户新增自定义方案的输入参数
 * 用于 buildPlanPointFromInputs 与 recomputeFrontierFromPoints 内部构建。
 */
export interface CustomPlanInputs {
    /** 机型名 (展示用, 如 "M2 Mac mini") */
    model: string;
    /** 芯片 (如 "M2", 必须能在 constants.chipBenchmarks 中匹配, 否则抛 ConstantsValidationError) */
    chip: string;
    /** 内存 GB */
    memoryGb: number;
    /** 存储 GB */
    storageGb: number;
    /** 品类 key (如 "Mac_mini", 与 constants.marketSnapshots 键名对齐) */
    categoryKey: string;
    /** 买入时机 */
    buyTiming: BuyTiming;
    /** 买入价 (元) */
    buyPrice: number;
    /** 持有年数 */
    holdingYears: number;
    /** 候选类型 (默认 'A', 用于系统支持期风险标注) */
    candidateType?: 'A' | 'B' | 'C';
    /** 等待月数 (仅类型 B/C) */
    waitMonths?: number;
    /** 买入价是否为预测值 */
    predictedPrice?: boolean;
    /** 用于在端内众包回传时透传的渠道与国补标记 */
    channel?: string;
    useSubsidy?: boolean;
    /** M 系列 CAGR (透传给 computePerformance, 缺省用引擎默认) */
    mSeriesCAGR?: number;
    /** A 系列 CAGR (透传给 computePerformance, 缺省用引擎默认) */
    aSeriesCAGR?: number;
}
/** recomputeFrontierFromPoints 的参数 (与 DecisionParams 同口径) */
export type RecomputeParams = DecisionParams;
/** 常量校验错误 */
export declare class ConstantsValidationError extends Error {
    readonly fieldName: string;
    constructor(fieldName: string, message?: string);
}
//# sourceMappingURL=types.d.ts.map