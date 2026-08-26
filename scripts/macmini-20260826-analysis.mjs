// 2026-08-26 Mac mini 购买决策分析(v4.1 文字路径:锚定-冲击双因子模型 + §9.5 推算口径)
// 输入数据全部来自 .agents/skills/apple-value-analysis/constants.json v4.1(2026-08-26)
import { writeFileSync, mkdirSync } from 'node:fs';

const ANALYSIS = { date: '2026-08-26', budget: 4000, scenario: '开发/中度生产(无修正)', periods: [12, 18, 24, 36, 48, 60] };

// 保值率曲线 Mac_mini(v3.9.1 修订,中国市场口径)
const CURVE = { 0: 100, 3: 90, 6: 82, 12: 80, 18: 72, 24: 65, 36: 52, 48: 46, 60: 35 };
const FLOOR = 5, HALF_LIFE = 24, R = 0.16, BENCH = 17100; // 基准=实测 M5(§9.5 保留实测口径)
const DENOM = { base: 6999, pro: 12999 }; // 残值分母:基础档 M6 官宣价 / Pro 档 M5 Pro 官宣价
const REPAIR_PER_YEAR = 100; // Mac mini 年均故障维修,无电池

function retention(t) {
  const ks = Object.keys(CURVE).map(Number).sort((a, b) => a - b);
  if (t <= ks[ks.length - 1]) {
    for (let i = 0; i < ks.length - 1; i++) {
      if (t >= ks[i] && t <= ks[i + 1]) {
        return CURVE[ks[i]] + (CURVE[ks[i + 1]] - CURVE[ks[i]]) * (t - ks[i]) / (ks[i + 1] - ks[i]);
      }
    }
  }
  // 末点后指数衰减(v3.9)
  const last = ks[ks.length - 1], Rlast = CURVE[last];
  return Math.max(FLOOR, FLOOR + (Rlast - FLOOR) * Math.pow(0.5, (t - last) / HALF_LIFE));
}

// 冲击时变因子:距新品发布后月数 d → 因子
function impactFactor(d) {
  if (d === null || d <= 0) return null;
  if (d <= 1) return 0.95;
  if (d <= 3) return 0.85;
  if (d <= 6) return 0.60;
  if (d <= 12) return 0.30;
  return 0.10;
}

const M6_IMPACT = 0.38 * (1 - 0.25); // 38% × 价格传导因子(-25%,锚涨幅16.7%∈15-30%档) = 28.5%
const M8_IMPACT = 0.38;              // M8 假定平价换代(存储周期2027见顶后),传导因子0,不折减
const M6_RELEASE_M = 1;   // 距分析月数(2026-09)
const M8_RELEASE_M = 22;  // 距分析月数(约2028年中,22月周期外推,低置信度)

// 候选机型(价格:闲鱼挂牌中位/用户实采/官宣价,来源 constants.json 快照)
const typeA = [
  { id: 'A1', name: 'M1 8G/256G', tier: 'base', price: 2244, age: 69, mult: 7400, memW: 0.65, stoW: 0.85, conf: '低(2样本挂牌)' },
  { id: 'A2', name: 'M1 16G/256G', tier: 'base', price: 2650, age: 69, mult: 7400, memW: 1.0, stoW: 0.85, conf: '中(5样本挂牌+实采佐证)' },
  { id: 'A3', name: 'M1 16G/512G', tier: 'base', price: 3500, age: 69, mult: 7400, memW: 1.0, stoW: 1.0, conf: '高(用户实采)' },
  { id: 'A4', name: 'M2 8G/256G', tier: 'base', price: 2675, age: 43, mult: 9700, memW: 0.65, stoW: 0.85, conf: '低(2样本挂牌)' },
  { id: 'A5', name: 'M2 16G/256G', tier: 'base', price: 3566, age: 43, mult: 9700, memW: 1.0, stoW: 0.85, conf: '中(4样本挂牌)' },
  { id: 'A6', name: 'M2 16G/512G', tier: 'base', price: 4799, age: 43, mult: 9700, memW: 1.0, stoW: 1.0, conf: '中(7样本挂牌)' },
  { id: 'A7', name: 'M4 16G/256G', tier: 'base', price: 4500, age: 22, mult: 15000, memW: 1.0, stoW: 0.85, conf: '中低(叫价口径)' },
];
const typeB = [
  { id: 'B1', name: 'M6 16G/256G 新品', tier: 'base', price: 6999, buyAge: 2, mult: 21000, multRange: [20500, 21700], memW: 1.0, stoW: 0.85, conf: '高(官宣价)', waitBase: 2, waitPess: 4 },
  { id: 'B2', name: 'M5 Pro 24G/512G 新品', tier: 'pro', price: 12999, buyAge: 2, mult: 25892, multRange: null, memW: 0.8, stoW: 0.85, conf: '高(官宣价)', waitBase: 2, waitPess: 4 },
];

function sBar(s0, n) { return s0 * (1 + 1 / Math.pow(1 + R, n / 12)) / 2; }
const rnd = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function buildPoints(withM8 = true) {
  const pts = [];
  for (const m of typeA) {
    const s0 = (m.mult / BENCH) * m.memW * m.stoW;
    for (const n of ANALYSIS.periods) {
      const sellAge = m.age + n;
      let rAdj = retention(sellAge);
      const f6 = impactFactor(n - M6_RELEASE_M);
      const adj6 = f6 === null ? 1 : 1 - M6_IMPACT * f6;
      const f8 = withM8 ? impactFactor(n - M8_RELEASE_M) : null;
      const adj8 = f8 === null ? 1 : 1 - M8_IMPACT * f8;
      rAdj *= adj6 * adj8;
      const residual = rAdj / 100 * DENOM[m.tier];
      const repair = n / 12 * REPAIR_PER_YEAR;
      const cost = (m.price - residual + repair) / n;
      pts.push({
        id: `${m.id}·${n}月`, machine: m.name, type: 'A', price: m.price, n, sellAge: Math.round(sellAge),
        s0: rnd(s0 * 100), sBar: rnd(sBar(s0, n) * 100), curveR: rnd(retention(sellAge)),
        adj6: rnd(adj6, 4), adj8: rnd(adj8, 4), rAdj: rnd(rAdj), residual: Math.round(residual),
        repair: Math.round(repair), cost: Math.round(cost), conf: m.conf,
        overBudget: m.price > ANALYSIS.budget,
        overSupport: sellAge > 72 ? sellAge - 72 : (72 - sellAge < 12 ? 'near' : null),
        f6, f8,
      });
    }
  }
  for (const m of typeB) {
    const s0 = (m.mult / BENCH) * m.memW * m.stoW;
    for (const n of ANALYSIS.periods) {
      const sellAge = m.buyAge + n;
      let rAdj = retention(sellAge);
      const f8 = withM8 ? impactFactor(n + m.buyAge - M8_RELEASE_M) : null;
      const adj8 = f8 === null ? 1 : 1 - M8_IMPACT * f8;
      rAdj *= adj8;
      const residual = rAdj / 100 * DENOM[m.tier];
      const repair = n / 12 * REPAIR_PER_YEAR;
      const cost = (m.price - residual + repair) / n;
      pts.push({
        id: `${m.id}·${n}月`, machine: m.name, type: 'B', price: m.price, n, sellAge,
        s0: rnd(s0 * 100), sBar: rnd(sBar(s0, n) * 100), curveR: rnd(retention(sellAge)),
        adj6: 1, adj8: rnd(adj8, 4), rAdj: rnd(rAdj), residual: Math.round(residual),
        repair: Math.round(repair), cost: Math.round(cost), conf: m.conf,
        overBudget: m.price > ANALYSIS.budget, overSupport: sellAge > 72 ? sellAge - 72 : null,
        f8, waitBase: m.waitBase, waitPess: m.waitPess, predicted: true,
      });
    }
  }
  return pts;
}

function frontier(pts) {
  return pts.filter(a => !pts.some(b => b !== a && b.cost <= a.cost && b.sBar >= a.sBar && (b.cost < a.cost || b.sBar > a.sBar)));
}

// 类型C三情景(§9.4):锚涨幅16.7%,冲击A=28.5%×0.95,B=3%×0.95(iPhone17实证2-4%中值),C=0;权重30/45/25
const ANCHOR = 6999 / 5999 - 1;
const W = { A: 0.30, B: 0.45, C: 0.25 };
const typeC = typeA.map(m => {
  const a = m.price * (1 + ANCHOR) * (1 - M6_IMPACT * 0.95);
  const b = m.price * (1 + ANCHOR) * (1 - 0.03 * 0.95);
  const c = m.price * (1 + ANCHOR);
  const w = W.A * a + W.B * b + W.C * c;
  return { machine: m.name, current: m.price, sA: Math.round(a), sB: Math.round(b), sC: Math.round(c), weighted: Math.round(w), fail: w >= m.price };
});

// M6 推算区间敏感性(§9.5)
function b1Sensitivity() {
  const out = [];
  for (const mult of [20500, 21000, 21700]) {
    const s0 = (mult / BENCH) * 1.0 * 0.85;
    out.push({ mult, s0: rnd(s0 * 100), sBar60: rnd(sBar(s0, 60) * 100) });
  }
  return out;
}

const ptsM8 = buildPoints(true);
const ptsNoM8 = buildPoints(false);
const frM8 = frontier(ptsM8);
const frNoM8 = frontier(ptsNoM8);

const result = {
  analysis: ANALYSIS, anchor: rnd(ANCHOR * 100), m6Impact: rnd(M6_IMPACT * 100),
  points: ptsM8, frontier: frM8,
  frontierNoM8: frNoM8,
  frontierFlip: JSON.stringify(frM8.map(p => p.id)) !== JSON.stringify(frNoM8.map(p => p.id)),
  typeC, b1Sensitivity: b1Sensitivity(),
  inBudgetFrontier: frM8.filter(p => !p.overBudget),
  overBudgetFrontier: frM8.filter(p => p.overBudget),
};

mkdirSync('i:/_Devolopment/1-small-tools/purchase_decision_making/scripts/debug', { recursive: true });
writeFileSync('i:/_Devolopment/1-small-tools/purchase_decision_making/scripts/debug/macmini-20260826-result.json', JSON.stringify(result, null, 2), 'utf8');

console.log('=== 帕累托前沿(含超预算参考点,按月均成本升序) ===');
for (const p of frM8.sort((a, b) => a.cost - b.cost))
  console.log(`${p.id} [${p.machine}] 成本${p.cost}元/月 S̄${p.sBar}% 买入${p.price} 残值${p.residual} ${p.overBudget ? '【超预算】' : ''}${p.overSupport ? (typeof p.overSupport === 'number' ? `⚠超支持期${p.overSupport}月` : '⚠接近支持尾声') : ''}`);
console.log('\n=== 预算内(≤4000)前沿 ===');
for (const p of result.inBudgetFrontier.sort((a, b) => a.cost - b.cost))
  console.log(`${p.id} 成本${p.cost} S̄${p.sBar}% 残值${p.residual} 保值率调整后${p.rAdj}% (曲线${p.curveR}%×M6修正${p.adj6}×M8修正${p.adj8})`);
console.log('\n=== 类型C三情景(等M6发售后买老款) ===');
for (const c of typeC)
  console.log(`${c.machine}: 现价${c.current} → A:${c.sA} B:${c.sB} C:${c.sC} 加权:${c.weighted} ${c.fail ? '⚠失效(等待无收益)' : '可考虑'}`);
console.log('\n=== 前沿是否因M8建模翻转 ===', result.frontierFlip);
console.log('M6推算区间敏感性:', JSON.stringify(b1Sensitivity()));
