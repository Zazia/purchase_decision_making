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
export declare function computePerformance(constants: Constants, chipName: string, memoryGb: number, storageGb: number, category: string, holdingMonths: number, mCAGR?: number, aCAGR?: number): PerformanceResult;
/**
 * 计算芯片性能系数 = 该芯片多核跑分 / 品类旗舰芯片多核跑分
 */
export declare function getChipCoefficient(constants: Constants, chipName: string, category: string): number;
/** 从 chipBenchmarks 查询芯片多核跑分 */
export declare function getChipMultiCoreScore(constants: Constants, chipName: string): number;
/**
 * 从 performanceFormula.品类基准芯片 获取品类旗舰芯片多核跑分
 * 字段值格式如 "M5(多核17100)" 或 "A19 Pro(多核9500)"
 */
export declare function getCategoryFlagshipScore(constants: Constants, category: string): number;
/** 获取内存权重 */
export declare function getMemoryWeight(constants: Constants, category: string, memoryGb: number): number;
/** 获取存储权重 */
export declare function getStorageWeight(constants: Constants, category: string, storageGb: number): number;
/**
 * 获取有效 r 值, 含代际跃升识别
 * - 跃升代际: r × 1.5
 * - 节点首发: r × 0.5
 * - 常规: r
 */
export declare function getEffectiveR(constants: Constants, chipName: string, mCAGR: number, aCAGR: number): {
    r: number;
    isMSeries: boolean;
};
//# sourceMappingURL=performance.d.ts.map