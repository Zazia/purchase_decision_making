#!/usr/bin/env node
// 2026-08-28 Mac mini 前沿后处理:SOP人工补齐三修正后重算帕累托前沿
// 修正1:剔除类型C(三情景加权失效,见 analysis-facts.md)与类型B(被M6类型A支配,保留参考)
// 修正2:M6 性能按推算跑分 21000/17100=122.8% 计算(引擎截断100%),区间20500-21700
// 修正3:老款(M4/M2/M1)残值施加 M6 发布冲击调整(调整后冲击26.25%,残值时变因子按卖出点距发售月数)
// 用法: node scripts/mac-mini-postprocess-20260828.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH = join(__dirname, 'debug/mac-mini-frontier-20260828.json');
const OUT_PATH = join(__dirname, 'debug/mac-mini-corrected-20260828.json');

const raw = JSON.parse(readFileSync(IN_PATH, 'utf-8'));
const all = [...raw.main.frontier, ...raw.main.dominated];

// M6 发售 2026-09-22,分析日 2026-08-28 → 距发售约0.82月
const RELEASE_LAG = 0.82;
// 残值调整时变因子(卖出点距发售月数):1月内0.95/3月内0.85/6月内0.60/12月内0.30/12月后0.10
function residualFactor(monthsPostRelease) {
  if (monthsPostRelease < 1) return 0.95;
  if (monthsPostRelease < 3) return 0.85;
  if (monthsPostRelease < 6) return 0.6;
  if (monthsPostRelease < 12) return 0.3;
  return 0.1;
}
const ADJUSTED_IMPACT = 0.2625; // 35% × (1−25%传导因子)

// 修正2:M6 推算口径性能(S(0)=122.8%×1.0×0.85=104.4%,衰减 r=0.16)
const R = 0.16;
function m6Perf(holdingMonths) {
  const s0 = (21000 / 17100) * 1.0 * 0.85; // 1.0439
  const sn = s0 / Math.pow(1 + R, holdingMonths / 12);
  return { s0, sn, avg: (s0 + sn) / 2 };
}

const typeA = all.filter((p) => p.candidateType === 'A');
const corrected = [];
for (const p of typeA) {
  const isM6 = p.chip === 'M6';
  const monthsPostRelease = p.holdingMonths - RELEASE_LAG;
  const factor = residualFactor(monthsPostRelease);
  // 修正3:非M6机型残值施加冲击调整;M6自身不施加(自身即锚定品;M8影响作为不确定性标注)
  const residualAdj = isM6 ? p.residual : p.residual * (1 - ADJUSTED_IMPACT * factor);
  // 修正2:M6性能用推算口径;其他机型引擎值即SOP口径
  const perf = isM6 ? m6Perf(p.holdingMonths) : { s0: p.performanceS0, sn: p.performanceSN, avg: p.avgPerformance };
  const monthlyCostAdj = (p.buyPrice - residualAdj + p.maintenanceCost) / p.holdingMonths;
  corrected.push({
    model: p.model,
    chip: p.chip,
    holdingMonths: p.holdingMonths,
    buyPrice: p.buyPrice,
    residualEngine: p.residual,
    residualAdj: Math.round(residualAdj),
    impactFactor: isM6 ? 0 : factor,
    maintenanceCost: p.maintenanceCost,
    monthlyCostEngine: +p.monthlyCost.toFixed(1),
    monthlyCostAdj: +monthlyCostAdj.toFixed(1),
    s0: +perf.s0.toFixed(4),
    sn: +perf.sn.toFixed(4),
    avgPerfAdj: +perf.avg.toFixed(4),
    systemSupportRisk: p.systemSupportRisk,
    predictedPrice: false,
  });
}

// 帕累托前沿(月均成本升序 = 成本越低越好;性能越高越好)
function pareto(points) {
  const sorted = [...points].sort((a, b) => a.monthlyCostAdj - b.monthlyCostAdj || b.avgPerfAdj - a.avgPerfAdj);
  const front = [];
  let bestPerf = -Infinity;
  for (const p of sorted) {
    if (p.avgPerfAdj > bestPerf) {
      front.push(p);
      bestPerf = p.avgPerfAdj;
    }
  }
  return front;
}

const frontierAll = pareto(corrected);
const inBudget = corrected.filter((p) => p.buyPrice <= 5000);
const frontierBudget = pareto(inBudget);

writeFileSync(OUT_PATH, JSON.stringify({ corrected, frontierAll, frontierBudget }, null, 2), 'utf-8');

const label = (p) =>
  `${p.model}|买${Math.round(p.buyPrice)}|月均${p.monthlyCostAdj}(引擎${p.monthlyCostEngine})|残值${p.residualAdj}(冲击f=${p.impactFactor})|S̄${(p.avgPerfAdj * 100).toFixed(0)}%`;

console.log('=== 全量前沿(含M6国补价5949.2) ===');
for (const p of frontierAll) console.log(label(p));
console.log('\n=== 预算内(买价≤5000)前沿 ===');
for (const p of frontierBudget) console.log(label(p));
console.log(`\n共 ${corrected.length} 个类型A候选(7机型×6持有期,含M1_512G等变体由引擎快照决定)`);
console.log(`输出已写入 ${OUT_PATH}`);
