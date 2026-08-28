// engine-diagnose-20260827.mjs — apple-value-engine 调用问题诊断
// 背景: Mac mini M6 官宣场景选购分析中引擎调用异常,本脚本实证定位问题(只诊断,不产出选购结论)
// 运行: node scripts/engine-diagnose-20260827.mjs
// 建议重定向: node scripts/engine-diagnose-20260827.mjs > scripts/debug/engine-diagnose-20260827-output.txt
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const distDir = join(ROOT, 'packages/apple-value-engine/dist');

// P0 修复(2026-08-27): tsconfig 改为 NodeNext 后 dist 已重建为纯 ESM,
// 直接动态 import 加载(旧 CJS 垫片已随模块格式切换废弃)。
const E = await import(pathToFileURL(join(distDir, 'index.js')).href);
const {
  loadConstants, computeParetoFrontier, parseReleasePlan, computeWaitMonths,
  predictNewProductPrice, predictDiscountedOldPrice, getCurrentNewPrice, getBuyPrice,
  shouldGenerateWaitCandidates,
} = E;

const CHECKS = [];
const check = (id, desc, expected, actual) => {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  CHECKS.push({ id, desc, expected, actual, ok });
  return ok;
};
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const hr = (t) => console.log('\n' + '═'.repeat(72) + `\n${t}\n` + '═'.repeat(72));

// ── S0 环境快照 ─────────────────────────────────────────────
hr('S0 环境快照');
const distIndex = join(distDir, 'index.js');
const gitHead = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
const distMtime = execSync(
  `powershell -NoProfile -Command "(Get-Item '${distIndex.replace(/'/g, "''")}').LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')"`,
).toString().trim();
console.log(`诊断时间   : ${new Date().toISOString()}`);
console.log(`Node       : ${process.version}`);
console.log(`git HEAD   : ${gitHead}`);
console.log(`engine dist: ${distMtime} (dist/index.js,ESM动态import加载)`);

// ── S1 常量加载 ─────────────────────────────────────────────
hr('S1 loadConstants 加载与校验');
const raw = readFileSync(join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf-8');
const C = loadConstants(raw);
console.log(`constants  : v${C.version} / last_updated ${C.lastUpdated}`);
console.log(`加载校验   : 通过 (必需字段齐全)`);
check('S1-1', 'loadConstants 不抛错,版本字段可读', true, true);

// ── S2 发布计划解析 ─────────────────────────────────────────
hr('S2 parseReleasePlan — Mac_mini (M6 已官宣场景)');
const MACRO = { storageSuperCycleStage: 'ongoing', hasGlobalPriceHike: true, analysisMonth: '2026-08' };
const planMini = parseReleasePlan(C, 'Mac_mini', MACRO);
console.log(JSON.stringify(planMini, null, 2));
check('S2-1', 'Mac_mini 发布置信度(快照值为"高(已官宣)")', 'high', planMini.releaseConfidence);
check('S2-2', 'Mac_mini anchorHike(官宣 16.7%)', 0.167, Number(planMini.anchorHike.toFixed(3)));
check('S2-3', 'Mac_mini hasHikeOccurred(已官宣)', true, planMini.hasHikeOccurred);
check('S2-4', 'Mac_mini 下次发布月(官宣 2026-08)', '2026-08', planMini.nextReleaseMonth);
check('S2-5', 'Mac_mini 到货延迟基线(中位14天)', 14, planMini.baselineDelayDays);
check('S2-6', 'Mac_mini 宏观产能因子(进行中→2.0)', 2, planMini.macroCapacityFactor);

console.log('\n对照 1: MacBook_Pro (置信度字段恰为纯"高")');
const planMbp = parseReleasePlan(C, 'MacBook_Pro', MACRO);
console.log(`  releaseConfidence = ${planMbp.releaseConfidence}`);
check('S2-7', 'MacBook_Pro 置信度(纯"高")→high', 'high', planMbp.releaseConfidence);

console.log('对照 2: Mac_studio (置信度字段同为"高(已官宣)")');
const planStudio = parseReleasePlan(C, 'Mac_studio', MACRO);
console.log(`  releaseConfidence = ${planStudio.releaseConfidence}`);
check('S2-8', 'Mac_studio 置信度"高(已官宣)"→high', 'high', planStudio.releaseConfidence);

// ── S3 等待候选生成判定 ─────────────────────────────────────
hr('S3 shouldGenerateWaitCandidates — 已官宣品类应生成类型B/C');
const genMini = shouldGenerateWaitCandidates(planMini, MACRO);
console.log(`Mac_mini  shouldGenerate = ${genMini}  (距发布 0 月,官宣置信度应为高)`);
check('S3-1', 'Mac_mini 应生成等待候选(类型B/C)', true, genMini);
if (planMini) console.log(`(若生成)等待月数 computeWaitMonths = ${computeWaitMonths(planMini, MACRO)}`);
const genMbp = shouldGenerateWaitCandidates(planMbp, MACRO);
console.log(`MacBook_Pro shouldGenerate = ${genMbp} (对照,置信度high)`);
check('S3-2', '对照:MacBook_Pro(纯"高")生成等待候选', true, genMbp);

// ── S4 快照候选提取审计 ─────────────────────────────────────
hr('S4 候选提取审计 — extractCandidates 等价逻辑逐条核对');
const snap = C.marketSnapshots.Mac_mini;
const conditions = [
  { tag: '新品', timing: 'new' },
  { tag: '二手', timing: 'used' },
];
console.log('快照键'.padEnd(28) + '新品价'.padEnd(12) + '二手价'.padEnd(10) + '进入引擎?');
const extracted = [];
for (const [key, entry] of Object.entries(snap)) {
  if (key.startsWith('_')) continue;
  const prices = {};
  let hit = false;
  for (const { tag, timing } of conditions) {
    if (!key.includes(tag)) { prices[timing] = '-'; continue; }
    const p = getBuyPrice(entry, timing);
    prices[timing] = p == null ? 'null' : String(p);
    if (p != null && p > 0) { hit = true; extracted.push({ key, timing, price: p }); }
  }
  console.log(key.padEnd(28) + String(prices.new).padEnd(12) + String(prices.used).padEnd(10) + (hit ? '是' : '否(丢弃)'));
}
const m4Entry = snap['M4_16G_256G_新品'];
check('S4-1', 'M4_16G_256G_新品 按新品取价(国补参考,幽灵候选)', 5073.66, getBuyPrice(m4Entry, 'new'));
check('S4-2', 'M4_16G_256G_新品 二手参考已迁出(_参考字段删除后used取价为null)', null, getBuyPrice(m4Entry, 'used'));
check('S4-3', 'M4_16G_256G_二手 键存在且二手取价4200(数据口径拆分)', 4200, getBuyPrice(snap['M4_16G_256G_二手'], 'used'));
const m6Entry = snap['M6_16G_256G_新品'];
check('S4-4', 'M6_16G_256G_新品 新品取价(官宣6999)', 6999, getBuyPrice(m6Entry, 'new'));
check('S4-5', '残值分母 getCurrentNewPrice(首个新品官方价=M6)', 6999, getCurrentNewPrice(C, 'Mac_mini'));

// ── S5 类型 B/C 价格预测探针 ────────────────────────────────
hr('S5 类型B/C 价格预测(若等待候选被生成)');
const bPrice = predictNewProductPrice(C, 'Mac_mini', planMini);
console.log(`类型B predictNewProductPrice = ${bPrice} (期望 6999:已官宣→快照官方价,不再外推)`);
check('S5-1', '类型B 买入价=官宣快照价', 6999, bPrice);
const m2Used = 3566;
const cPrice = predictDiscountedOldPrice(C, m2Used, planMini, MACRO);
// 手工复算: 3566 × (1+0.167) × (1 − 0.35×(1−0.25) × 0.95[3月内买入价下降因子])
const manual = m2Used * (1 + 0.167) * (1 - 0.35 * 0.75 * 0.95);
console.log(`类型C predictDiscountedOldPrice(M2二手3566) = ${cPrice.toFixed(1)}`);
console.log(`  手工复算(§9.4情景A): 3566×1.167×(1−0.35×0.75×0.95) = ${manual.toFixed(1)}`);
check('S5-2', '类型C 情景A公式与手工复算一致', Number(manual.toFixed(1)), Number(cPrice.toFixed(1)));
console.log('  ⚠️ 注意:引擎类型C仅实现§9.4情景A(全额传导),三情景加权与失效判定走SKILL文字路径');

// ── S6 全量帕累托运行(本次分析的目标调用) ───────────────────
hr('S6 computeParetoFrontier — 目标调用 (预算5000/持有3-4年/全新+二手)');
const PARAMS = {
  category: 'Mac_mini',
  budget: 5000,
  holdingYears: [3, 4],
  buyTiming: 'both',
  performanceFloor: 0.7,
  considerWait: true,
  macroContext: MACRO,
};
const R = computeParetoFrontier(C, PARAMS);
const all = [...R.frontier, ...R.dominated];
const byType = {};
for (const p of all) byType[p.candidateType] = (byType[p.candidateType] ?? 0) + 1;
console.log(`方案点总数: ${all.length}  前沿: ${R.frontier.length}  被支配: ${R.dominated.length}`);
console.log(`按候选类型分布: ${JSON.stringify(byType)}`);
check('S6-1', '已官宣场景应出现类型B/C方案点', true, (byType.B ?? 0) + (byType.C ?? 0) > 0);

console.log('\n全部方案点 (按月均成本升序):');
console.log('机型×持有期'.padEnd(34) + '型'.padEnd(4) + '等待'.padEnd(5) + '买入价'.padEnd(9)
  + '月均成本'.padEnd(10) + 'S(0)'.padEnd(8) + 'S̄'.padEnd(8) + '残值'.padEnd(8) + '前沿'.padEnd(5) + '支持期');
const sortedAll = [...all].sort((a, b) => a.monthlyCost - b.monthlyCost);
for (const p of sortedAll) {
  const onF = R.frontier.includes(p);
  console.log(
    p.model.padEnd(34) + p.candidateType.padEnd(4)
    + String(p.waitMonths ?? '-').padEnd(5)
    + String(p.buyPrice).padEnd(9)
    + String(Math.round(p.monthlyCost)).padEnd(10)
    + pct(p.performanceS0).padEnd(8)
    + pct(p.avgPerformance).padEnd(8)
    + String(Math.round(p.residual)).padEnd(8)
    + (onF ? '●'.padEnd(5) : '○'.padEnd(5))
    + (p.systemSupportRisk === 'exceeded' ? `超${p.systemSupportExceedMonths}月` : (p.systemSupportRisk === 'near-end' ? '近尾声' : 'normal')),
  );
}
console.log('\n推荐区间(买入价≤预算5000):');
for (const p of R.recommendationRange.plans) {
  console.log(`  ${p.model}  月均${Math.round(p.monthlyCost)}元  S̄${pct(p.avgPerformance)}  买入${p.buyPrice}`);
}
if (R.recommendationRange.plans.length === 0) console.log('  (空)');

// M4 Pro 静默丢弃验证(修复后: 发布日期 Mac_mini_M4_Pro 已补,候选应出现)
const hasM4Pro = all.some((p) => p.model.includes('M4_Pro'));
console.log(`\nM4_Pro_24G_512G_新品(快照存在,价12499) 是否出现在方案点: ${hasM4Pro}`);
check('S6-2', 'M4_Pro 候选出现(发布日期已补,不再静默丢弃)', true, hasM4Pro);
// M4 二手候选验证(修复后: 独立 M4_16G_256G_二手 键,候选应出现)
const hasM4Used = all.some((p) => p.model.includes('M4') && p.buyTiming === 'used');
console.log(`M4 二手(真实参考价4200,独立二手键) 是否出现: ${hasM4Used}`);
check('S6-3', 'M4 二手候选出现(数据口径拆分后不再被键名过滤)', true, hasM4Used);

// M6 类型A的 S(0): 推算口径 21000/17100×0.85≈104%,引擎 min(1,·) 截断
const m6Pts = all.filter((p) => p.chip === 'M6');
if (m6Pts.length) {
  console.log(`\nM6 类型A方案点 S(0) = ${pct(m6Pts[0].performanceS0)} (§9.5推算口径应≈104.6%,引擎上限截断为100%)`);
  check('S6-4', 'M6 S(0) 推算区间敏感性(§9.5 允许>100%)', 1, m6Pts[0].performanceS0);
} else {
  console.log('\nM6 类型A方案点不存在(意外)');
  check('S6-4', 'M6 新品候选应进入方案点', true, false);
}

// ── S7 汇总 ─────────────────────────────────────────────────
hr('S7 期望对照汇总');
let fails = 0;
for (const c of CHECKS) {
  console.log(`${c.ok ? '✓ PASS' : '✗ FAIL'}  [${c.id}] ${c.desc}`);
  if (!c.ok) { console.log(`         期望: ${JSON.stringify(c.expected)}  实际: ${JSON.stringify(c.actual)}`); fails++; }
}
console.log(`\n合计 ${CHECKS.length} 项,失败 ${fails} 项`);
process.exitCode = fails > 0 ? 1 : 0;
