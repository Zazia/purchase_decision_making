// 检验「保值率曲线可否用解析函数描述」：对 0-60 月 knots 拟合多种候选模型，
// 评估 knots 误差与连续域上相对现行分段线性插值的最大偏差。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));
const CURVES = data['保值率曲线'];

const CATS = Object.keys(CURVES).filter(k => !k.startsWith('_'));

function getKnots(cat) {
  const e = CURVES[cat];
  const ks = Object.keys(e).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  return ks.map(t => [t, e[String(t)]]);
}

// 现行实现：0-60 线性插值（与 visualize-residual-curves.mjs 一致）
function currentR(cat) {
  const e = CURVES[cat];
  const knots = getKnots(cat);
  return t => {
    if (t <= 0) return 100;
    for (let i = 0; i < knots.length - 1; i++) {
      if (t >= knots[i][0] && t <= knots[i + 1][0]) {
        const [t0, v0] = knots[i], [t1, v1] = knots[i + 1];
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
      }
    }
    return knots[knots.length - 1][1];
  };
}

// ---------- Nelder-Mead ----------
function nelderMead(obj, x0, step = 1, maxIter = 8000) {
  const n = x0.length;
  let simp = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step; simp.push(p); }
  let f = simp.map(obj);
  for (let it = 0; it < maxIter; it++) {
    const order = f.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    simp = order.map(o => simp[o[1]]); f = order.map(o => o[0]);
    if (Math.abs(f[n] - f[0]) < 1e-12) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simp[i][j] / n;
    const xr = c.map((v, i) => v + (v - simp[n][i]));
    const fr = obj(xr);
    if (fr < f[0]) {
      const xe = c.map((v, i) => v + 2 * (v - simp[n][i]));
      const fe = obj(xe);
      if (fe < fr) { simp[n] = xe; f[n] = fe; } else { simp[n] = xr; f[n] = fr; }
    } else if (fr < f[n - 1]) { simp[n] = xr; f[n] = fr; }
    else {
      const xc = c.map((v, i) => v + 0.5 * (simp[n][i] - v));
      const fc = obj(xc);
      if (fc < f[n]) { simp[n] = xc; f[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          simp[i] = simp[0].map((v, j) => v + 0.5 * (simp[i][j] - v));
          f[i] = obj(simp[i]);
        }
      }
    }
  }
  const bi = f.indexOf(Math.min(...f));
  return { x: simp[bi], fx: f[bi] };
}

// ---------- 多项式最小二乘（正规方程 + 高斯消元） ----------
function polyfit(ts, vs, deg) {
  const m = deg + 1;
  const A = new Array(m).fill(0).map(() => new Array(m + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let k = 0; k < ts.length; k++) s += Math.pow(ts[k], i + j);
      A[i][j] = s;
    }
    let b = 0;
    for (let k = 0; k < ts.length; k++) b += vs[k] * Math.pow(ts[k], i);
    A[i][m] = b;
  }
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const factor = A[r][col] / A[col][col];
      for (let c = col; c <= m; c++) A[r][c] -= factor * A[col][c];
    }
  }
  return A.map((row, i) => row[m] / row[i]);
}

// ---------- 候选模型 ----------
const BIG = 1e9;
const MODELS = [
  {
    name: 'M1 单指数+地板(锚定0月=100)',
    n: 2,
    guess: cat => { const e = CURVES[cat]; return [e._floor ?? 3, 30]; },
    fn: p => t => p[0] + (100 - p[0]) * Math.pow(2, -t / p[1]),
    penalty: p => (p[0] < 0 || p[0] > 50 || p[1] < 3 || p[1] > 200) ? BIG : 0,
    fmt: p => `floor=${p[0].toFixed(1)}, 半衰期=${p[1].toFixed(1)}月`
  },
  {
    name: 'M2 单指数+地板(自由)',
    n: 3,
    guess: () => [3, 100, 30],
    fn: p => t => p[0] + p[1] * Math.pow(2, -t / p[2]),
    penalty: p => (p[0] < 0 || p[0] > 60 || p[1] < 20 || p[1] > 150 || p[2] < 3 || p[2] > 200) ? BIG : 0,
    fmt: p => `floor=${p[0].toFixed(1)}, A=${p[1].toFixed(1)}, 半衰期=${p[2].toFixed(1)}月`
  },
  {
    name: 'M3 幂律',
    n: 2,
    guess: () => [20, 0.7],
    fn: p => t => 100 * Math.pow(1 + t / p[0], -p[1]),
    penalty: p => (p[0] < 1 || p[0] > 300 || p[1] < 0.05 || p[1] > 5) ? BIG : 0,
    fmt: p => `a=${p[0].toFixed(1)}月, b=${p[1].toFixed(3)}`
  },
  {
    name: 'M4 双指数(锚定0月=100)',
    n: 3,
    guess: () => [0.5, 6, 40],
    fn: p => t => 100 * (p[0] * Math.pow(2, -t / p[1]) + (1 - p[0]) * Math.pow(2, -t / p[2])),
    penalty: p => (p[0] < 0 || p[0] > 1 || p[1] < 1 || p[1] > 60 || p[2] < 10 || p[2] > 400) ? BIG : 0,
    fmt: p => `快分量=${(p[0] * 100).toFixed(0)}%@半衰期${p[1].toFixed(1)}月, 慢分量=${((1 - p[0]) * 100).toFixed(0)}%@半衰期${p[2].toFixed(1)}月`
  }
];

function fitModel(model, cat) {
  const knots = getKnots(cat);
  const ts = knots.map(k => k[0]), vs = knots.map(k => k[1]);
  const starts = [model.guess(cat)];
  // 多起点防局部最优
  for (let s = 0; s < 3; s++) {
    starts.push(model.guess(cat).map(v => v * (0.5 + 0.75 * Math.random())));
  }
  let best = null;
  for (const st of starts) {
    const r = nelderMead(p => {
      const pen = model.penalty(p);
      if (pen >= BIG) return BIG;
      let sse = 0;
      for (let i = 0; i < ts.length; i++) {
        const f = model.fn(p);
        const e = f(ts[i]) - vs[i];
        sse += e * e;
      }
      return sse + pen;
    }, st);
    if (!best || r.fx < best.fx) best = r;
  }
  const f = model.fn(best.x);
  let sse = 0, maxAE = 0;
  for (let i = 0; i < ts.length; i++) {
    const e = Math.abs(f(ts[i]) - vs[i]);
    sse += e * e;
    maxAE = Math.max(maxAE, e);
  }
  const rmse = Math.sqrt(sse / ts.length);
  // 连续域 vs 现行插值
  const cur = currentR(cat);
  let contMax = 0, contAt = 0;
  for (let t = 0; t <= 60; t += 0.5) {
    const e = Math.abs(f(t) - cur(t));
    if (e > contMax) { contMax = e; contAt = t; }
  }
  // R²
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sst = vs.reduce((a, b) => a + (b - mean) ** 2, 0);
  const r2 = 1 - sse / sst;
  return { params: best.x, fmt: model.fmt(best.x), rmse, maxAE, r2, contMax, contAt };
}

function fitPoly(cat, deg) {
  const knots = getKnots(cat);
  const ts = knots.map(k => k[0]), vs = knots.map(k => k[1]);
  const c = polyfit(ts, vs, deg);
  const f = t => c.reduce((s, ci, i) => s + ci * Math.pow(t, i), 0);
  let sse = 0, maxAE = 0;
  for (let i = 0; i < ts.length; i++) {
    const e = Math.abs(f(ts[i]) - vs[i]);
    sse += e * e;
    maxAE = Math.max(maxAE, e);
  }
  const cur = currentR(cat);
  let contMax = 0, contAt = 0;
  for (let t = 0; t <= 60; t += 0.5) {
    const e = Math.abs(f(t) - cur(t));
    if (e > contMax) { contMax = e; contAt = t; }
  }
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sst = vs.reduce((a, b) => a + (b - mean) ** 2, 0);
  return { rmse: Math.sqrt(sse / ts.length), maxAE, r2: 1 - sse / sst, contMax, contAt, fmt: c.map((v, i) => `${i === 0 ? '' : v >= 0 ? '+' : ''}${v.toFixed(4)}t^${i}`).join(' ') };
}

// ---------- 主流程 ----------
const rows = [];
for (const cat of CATS) {
  for (const m of MODELS) {
    const r = fitModel(m, cat);
    rows.push({ cat, model: m.name, ...r });
  }
  for (const deg of [3, 4]) {
    const r = fitPoly(cat, deg);
    rows.push({ cat, model: `M${deg + 2} ${deg}阶多项式`, ...r });
  }
}

// 输出：每品类 × 模型
console.log('=== 各品类 × 各模型拟合精度（knots RMSE / MaxAE，pp；全域MaxAE = 相对现行分段线性插值） ===\n');
for (const cat of CATS) {
  const sub = rows.filter(r => r.cat === cat).sort((a, b) => a.contMax - b.contMax);
  console.log(`【${cat}】`);
  for (const r of sub) {
    console.log(`  ${r.model.padEnd(26)} knotsRMSE=${r.rmse.toFixed(2).padStart(5)}  knotsMaxAE=${r.maxAE.toFixed(2).padStart(5)}  全域MaxAE=${r.contMax.toFixed(2).padStart(5)}pp@${r.contAt.toFixed(0)}月  R²=${r.r2.toFixed(4)}  [${r.fmt}]`);
  }
  console.log('');
}

// 汇总：每模型跨品类的平均/最差
console.log('=== 模型汇总（跨 ' + CATS.length + ' 个品类） ===');
const modelNames = [...new Set(rows.map(r => r.model))];
for (const mn of modelNames) {
  const sub = rows.filter(r => r.model === mn);
  const avgRMSE = sub.reduce((a, b) => a + b.rmse, 0) / sub.length;
  const worstCont = Math.max(...sub.map(r => r.contMax));
  const avgCont = sub.reduce((a, b) => a + b.contMax, 0) / sub.length;
  console.log(`  ${mn.padEnd(26)} 平均knotsRMSE=${avgRMSE.toFixed(2)}pp  平均全域MaxAE=${avgCont.toFixed(2)}pp  最差全域MaxAE=${worstCont.toFixed(2)}pp`);
}

// 重点品类最优模型的参数表
console.log('\n=== 五大品类最优解析模型（按全域MaxAE最小） ===');
const FOCUS = ['Mac_mini', 'iPhone_标准', 'iPhone_Pro', 'iPhone_ProMax', 'MacBook_Air', 'MacBook_Pro', 'iPad_Pro', 'iPad_Air', 'iPad_标准', 'iPad_mini'];
for (const cat of FOCUS) {
  const best = rows.filter(r => r.cat === cat && !r.model.includes('多项式')).sort((a, b) => a.contMax - b.contMax)[0];
  console.log(`  ${cat.padEnd(14)} ${best.model}: ${best.fmt} | 全域MaxAE=${best.contMax.toFixed(2)}pp`);
}
