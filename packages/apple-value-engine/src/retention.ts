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

/** 默认外推参数(常量中未指定时使用) */
const DEFAULT_FLOOR = 3;
const DEFAULT_HALF_LIFE = 24;

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
  let curve = curves[category];
  if (!curve) {
    // 大小写兜底: 快照键 iPhone_proMax vs 保值率曲线键 iPhone_ProMax
    const lower = category.toLowerCase();
    for (const [k, v] of Object.entries(curves)) {
      if (k.toLowerCase() === lower) { curve = v; break; }
    }
  }
  if (!curve) {
    throw new Error(`Retention curve not found for category: ${category}`);
  }

  // 读取外推参数(非数字键, 不参与插值点)
  const floor = readParam(curve, '_floor', DEFAULT_FLOOR);
  const halfLife = readParam(curve, '_half_life_months', DEFAULT_HALF_LIFE);

  // 解析月数并排序(过滤掉非数字键如 _floor / _half_life_months)
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

  // 高于最大月数: 指数衰减外推(v3.9)
  // R(t) = floor + (R(last) - floor) × 0.5^((t - last_month) / half_life)
  const last = points[points.length - 1];
  if (months >= last.month) {
    const decay = Math.pow(0.5, (months - last.month) / halfLife);
    const extrapolated = floor + (last.rate - floor) * decay;
    return clampRate(extrapolated);
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

/**
 * 从曲线对象读取外推参数(数字), 缺失或无效时返回默认值
 * curve 类型为 Record<number, number>, 但 JSON 运行时键为 string, 需类型断言访问
 */
function readParam(
  curve: Record<number, number>,
  key: string,
  defaultValue: number,
): number {
  const raw = (curve as Record<string, unknown>)[key];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

/** 保值率保底 3%, 上限 100% */
function clampRate(rate: number): number {
  return Math.max(3, Math.min(100, rate));
}
