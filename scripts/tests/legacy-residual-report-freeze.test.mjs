import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const constants = JSON.parse(readFileSync(
  join(ROOT, '.agents/skills/apple-value-analysis/constants.json'),
  'utf8',
));

const SNAPSHOT = constants['实时市场价快照'];
const RELEASE = constants['产品发布日期'];
const CATEGORIES = [
  'Mac_mini', 'iPhone_proMax', 'iPhone_Pro', 'iPhone_标准',
  'MacBook_Air', 'MacBook_Pro', 'iPad_Pro', 'iPad_Air', 'iPad_标准', 'iPad_mini',
];
const V45 = { 0: 100, 3: 90, 6: 82, 12: 80, 18: 72, 24: 65, 36: 52, 48: 46, 60: 35 };
const INVALID_V48 = { 0: 100, 3: 90, 6: 82, 12: 80, 18: 68, 24: 55, 36: 47, 48: 41, 60: 35 };

function numberFrom(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const numbers = (value.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n >= 30);
  if (!numbers.length) return null;
  if (numbers.length >= 2 && /\d+\s*[-~到至]\s*\d+/.test(value)) {
    return Math.round((numbers[0] + numbers[1]) / 2);
  }
  return Math.round(numbers[0]);
}

function usedPrice(record) {
  return numberFrom(record['闲鱼中位价_二手同款'])
    ?? numberFrom(record['闲鱼中位价'])
    ?? numberFrom(record['闲鱼中位价_原值'])
    ?? numberFrom(record['闲鱼中位价_二手同款_参考'])
    ?? numberFrom(record['闲鱼中位价_二手同款_参考_资讯稿'])
    ?? numberFrom(record['闲鱼中位价_二手同款_参考_资讯稿2'])
    ?? numberFrom(record['闲鱼中位价_二手同款_参考_卖家挂单'])
    ?? numberFrom(record['闲鱼中位价_二手同款_参考_海外']);
}

function matchRelease(category, item) {
  const name = item.replace(/_(新品|二手)$/, '');
  if (category.startsWith('iPhone')) {
    const match = name.match(/iPhone_(\d+)/);
    return match ? RELEASE[`iPhone_${match[1]}`] : null;
  }
  if (category === 'Mac_mini' || category === 'MacBook_Air') {
    const match = name.match(/^(M\d[A-Za-z0-9]*)/);
    const prefix = category === 'Mac_mini' ? 'Mac_mini_' : 'MacBook_Air_';
    return match ? RELEASE[prefix + match[1]] : null;
  }
  if (category === 'MacBook_Pro') {
    const match = name.match(/^(M\d[A-Za-z0-9]*)_(\d+)寸/);
    if (!match) return null;
    const [, chip, rawSize] = match;
    const size = rawSize === '16' ? '16' : '14';
    return RELEASE[`MacBook_Pro_${size}_${chip}`]
      ?? RELEASE[`MacBook_Pro_${size}_${chip.replace('Pro', '').replace('Max', '')}`]
      ?? null;
  }
  if (category.startsWith('iPad')) {
    const match = name.match(/^(M\d[A-Za-z0-9]*|A\d+[A-Za-z_0-9]*?)(?=_\d|\d+寸)/);
    if (!match) return null;
    const prefixes = { iPad_Pro: 'iPad_Pro_', iPad_Air: 'iPad_Air_', iPad_mini: 'iPad_mini_' };
    const prefix = prefixes[category];
    if (!prefix) return null;
    const chip = match[1];
    for (const candidate of [chip, chip.replace('_Pro', 'Pro'), chip.replace('Pro', ''), `${chip}Pro`, chip.replace('_', '')]) {
      if (RELEASE[prefix + candidate]) return RELEASE[prefix + candidate];
    }
  }
  return null;
}

function ageMonths(observedAt, releasedAt) {
  const [observedYear, observedMonth] = observedAt.split('-').map(Number);
  const [releaseYear, releaseMonth] = releasedAt.split('-').map(Number);
  return (observedYear - releaseYear) * 12 + observedMonth - releaseMonth;
}

function rateFromKnots(curve, age, floor = 5, halfLife = 45) {
  const knots = Object.keys(curve).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
  const last = knots.at(-1);
  if (age > last) return floor + (curve[last] - floor) * Math.pow(0.5, (age - last) / halfLife);
  for (let index = 0; index < knots.length - 1; index += 1) {
    const left = knots[index];
    const right = knots[index + 1];
    if (age >= left && age <= right) {
      return curve[left] + (curve[right] - curve[left]) * (age - left) / (right - left);
    }
  }
  return curve[last];
}

function buildLegacyDots() {
  const firstOfficial = Object.fromEntries(CATEGORIES.map((category) => {
    const records = SNAPSHOT[category] ?? {};
    const first = Object.entries(records).find(([item, record]) => (
      item.includes('新品') && typeof record?.['官方价'] === 'number'
    ));
    return [category, first?.[1]?.['官方价'] ?? null];
  }));

  const dots = [];
  for (const category of CATEGORIES) {
    for (const [item, record] of Object.entries(SNAPSHOT[category] ?? {})) {
      if (!item.includes('二手') || !record || typeof record !== 'object') continue;
      const price = usedPrice(record);
      const release = matchRelease(category, item);
      if (!price || !release) continue;

      const note = record['官方价_说明'] ?? '';
      const explicit = note.match(/(?:残值分母|分母)[^。]*?(\d{2,6})\s*元/);
      let denominator = null;
      let source = '未确定';
      if (explicit) {
        denominator = Number(explicit[1]);
        source = '说明明示';
      } else if (note.includes('当前在售同品类新品官方价') && firstOfficial[category]) {
        denominator = firstOfficial[category];
        source = '同品类在售新品';
      }
      if (!denominator) continue;

      const observedAt = record['搜索日期'] || SNAPSHOT.snapshot_date;
      dots.push({ category, item, price, denominator, source, age: ageMonths(observedAt, release) });
    }
  }
  return dots;
}

describe('旧残值报告分母与 Mac mini v4.8 MAE 冻结复现', () => {
  const dots = buildLegacyDots();

  it('70 个报告点全部来自不兼容分母：20 个当前在售新品、50 个说明文本', () => {
    expect(dots).toHaveLength(70);
    expect(dots.filter((dot) => dot.source === '同品类在售新品')).toHaveLength(20);
    expect(dots.filter((dot) => dot.source === '说明明示')).toHaveLength(50);
  });

  it('错误分母会复现 v4.8 所宣称的 Mac mini MAE 改善', () => {
    const macMini = dots.filter((dot) => dot.category === 'Mac_mini' && !dot.item.includes('_参考'));
    expect(macMini).toHaveLength(9);
    const mae = (curve) => macMini.reduce((sum, dot) => (
      sum + Math.abs(dot.price / dot.denominator * 100 - rateFromKnots(curve, dot.age))
    ), 0) / macMini.length;

    expect(mae(V45)).toBeCloseTo(7.75, 2);
    expect(mae(INVALID_V48)).toBeCloseTo(6.24, 2);
  });
});
