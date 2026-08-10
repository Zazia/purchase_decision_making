/**
 * 保值率插值与外推模块
 *
 * 算法:
 * - 范围内: 线性插值
 * - 范围外(>最大月数): 指数衰减外推(v3.9, 替代线性外推)
 * - 范围外(<最小月数, 通常为0): 用0月值(100%)
 * - 保底: 保值率不低于 3% (clampRate 安全网)
 *
 * v3.9 指数衰减外推:
 *   R(t) = floor + (R(last) - floor) × 0.5^((t - last_month) / half_life)
 *   - floor: 渐近线锚点(亮机底价标准化值), 由 constants.json 各品类曲线的 _floor 指定
 *   - half_life: 半衰期(月), 由 _half_life_months 指定, 默认 24
 *   - 解决线性外推在 96-120 月区间残值为负的问题
 *
 * 保值率曲线为 { 月数: 保值率% }, 如 { 0: 100, 12: 78, 24: 65, ... }
 * 可选外推参数: { "_floor": 5, "_half_life_months": 24 } (非数字键自动跳过)
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