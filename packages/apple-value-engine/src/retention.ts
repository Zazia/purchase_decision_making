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
export function getRetentionRate(
  curves: RetentionCurves,
  category: string,
  months: number,
): number {
  const curve = curves[category];
  if (!curve) {
    throw new Error(`Retention curve not found for category: ${category}`);
  }

  // 解析月数并排序
  const points = Object.entries(curve)
    .map(([k, v]) => ({ month: Number(k), rate: Number(v) }))
    .filter((p) => !Number.isNaN(p.month) && !Number.isNaN(p.rate))
    .sort((a, b) => a.month - b.month);

  if (points.length === 0) {
    throw new Error(`Empty retention curve for category: ${category}`);
  }

  // 低于最小月数: 返回首点
  if (months <= points[0].month) {
    return clampRate(points[0].rate);
  }

  // 高于最大月数: 按末段斜率外推
  const last = points[points.length - 1];
  if (months >= last.month) {
    if (points.length >= 2) {
      const prev = points[points.length - 2];
      const slope = (last.rate - prev.rate) / (last.month - prev.month);
      const extrapolated = last.rate + slope * (months - last.month);
      return clampRate(extrapolated);
    }
    return clampRate(last.rate);
  }

  // 范围内: 线性插值
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (months >= a.month && months <= b.month) {
      const t = (months - a.month) / (b.month - a.month);
      const rate = a.rate + (b.rate - a.rate) * t;
      return clampRate(rate);
    }
  }

  return clampRate(last.rate);
}

/** 保值率保底 3%, 上限 100% */
function clampRate(rate: number): number {
  return Math.max(3, Math.min(100, rate));
}
