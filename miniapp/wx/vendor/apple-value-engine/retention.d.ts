/**
 * 保值率插值与外推模块
 *
 * 算法(来自 SKILL.md 步骤5):
 * - 范围内: 线性插值
 * - 范围外(>最大月数): 按最后一区间斜率外推
 * - 范围外(<最小月数, 通常为0): 用0月值(100%)
 * - 保底: 保值率不低于 3%
 *
 * 保值率曲线为 { 月数: 保值率% }, 如 { 0: 100, 12: 78, 24: 65, ... }
 */
import type { RetentionCurves } from './types.js';
/**
 * 查询某品类在指定月数的保值率(%)
 * @param curves 保值率曲线表
 * @param category 品类(如 'Mac_mini', 'iPhone_ProMax')
 * @param months 发布后月数
 * @returns 保值率(%), 范围 [3, 100]
 */
export declare function getRetentionRate(curves: RetentionCurves, category: string, months: number): number;
//# sourceMappingURL=retention.d.ts.map