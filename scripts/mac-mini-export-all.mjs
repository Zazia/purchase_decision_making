import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEngine } from '../.agents/skills/apple-value-analysis/scripts/load-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../.agents/skills/apple-value-analysis');
const { engine } = await loadEngine();
const { loadConstants, computeParetoFrontier } = engine;
const constants = loadConstants(readFileSync(`${SKILL_DIR}/constants.json`, 'utf-8'));

const result = computeParetoFrontier(constants, {
  category: 'Mac_mini',
  budget: 6000,
  holdingYears: [3, 4],
  buyTiming: 'both',
  performanceFloor: 0.5,
  considerWait: true,
  macroContext: { storageSuperCycleStage: 'ongoing', hasGlobalPriceHike: true, analysisMonth: '2026-08' },
});

// 合并全部候选, 构建统一记录
const all = [];
const norm = (p, isFront) => ({
  label: p.model,
  chip: p.chip,
  buyTiming: p.buyTiming,          // new / used
  candidateType: p.candidateType,  // A / B / C
  predictedPrice: !!p.predictedPrice,
  waitMonths: p.waitMonths ?? 0,
  holdingYears: p.holdingYears,
  monthlyCost: Math.round(p.monthlyCost * 100) / 100,
  avgPerf: Math.round(p.avgPerformance * 1000) / 10,
  buyPrice: Math.round(p.buyPrice),
  residual: Math.round(p.residual),
  maintenance: p.maintenanceCost,
  supportRisk: p.systemSupportRisk,
  supportExceed: p.systemSupportExceedMonths ?? 0,
  front: isFront,
});
for (const p of result.frontier) all.push(norm(p, true));
for (const p of result.dominated) all.push(norm(p, false));

// 计算每个被支配候选的第一个支配者
const typed = all.map(r => ({ cost: r.monthlyCost, perf: r.avgPerf, r }));
for (const r of all) {
  if (r.front) continue;
  const dom = typed.find(o => o.r !== r && o.cost <= r.monthlyCost && o.perf >= r.avgPerf && (o.cost < r.monthlyCost || o.perf > r.avgPerf));
  r.dominatedBy = dom ? dom.r.label : null;
}

// 按 月成本 升序排序
all.sort((a, b) => a.monthlyCost - b.monthlyCost);

const summary = {
  total: all.length,
  frontier: all.filter(r => r.front).length,
  dominated: all.filter(r => !r.front).length,
};
writeFileSync(resolve(__dirname, '..', 'scripts', 'debug', 'mac-mini-all-candidates.json'),
  JSON.stringify({ summary, candidates: all }, null, 2));

// 生成报告可引用的紧凑 JS 行数组: [label, type, cost, perf, buy, hold, dominatedBy, exceed, isFront]
const typeZh = { A: '现在买', B: '等新品·新品', C: '等新品·老款预测' };
const rows = all.map(r => {
  const label = r.label
    .replace(/_/g, ' ')
    .replace('M2 8G 256G 二手', '二手 M2 8G/256G')
    .replace('M2 8G 256G 新品', '新品 M2 8G/256G')
    .replace('M2 16G 256G 二手', '二手 M2 16G/256G')
    .replace('M2 16G 256G 新品', '新品 M2 16G/256G')
    .replace('M2 16G 512G 二手', '二手 M2 16G/512G')
    .replace('M1 8G 256G 二手', '二手 M1 8G/256G')
    .replace('M1 16G 256G 二手', '二手 M1 16G/256G')
    .replace('M1 16G 512G 二手', '二手 M1 16G/512G')
    .replace('M4 16G 256G 二手', '二手 M4 16G/256G')
    .replace('M4 16G 256G 新品', '新品 M4 16G/256G')
    .replace('M4 16G 512G 新品', '新品 M4 16G/512G')
    .replace('M4 16G 1T 新品', '新品 M4 16G/1T')
    .replace('M4 Pro 24G 512G 新品', '新品 M4 Pro 24G/512G')
    .replace('M5 Pro 24G 512G 新品', '新品 M5 Pro 24G/512G')
    .replace('M6 16G 256G 新品', '新品 M6 16G/256G')
    .replace('Mac mini 下一代新品', '新品 Mac mini（M6）')
    .replace(/ (\d+) 年/, ' · $1 年')
    .trim();
  const type = (r.predictedPrice ? '预测·' : '') + typeZh[r.candidateType];
  return [label, type, r.monthlyCost, r.avgPerf, r.buyPrice, r.holdingYears,
          (r.dominatedBy || '').replace(/ \d+ 年/, ' · $&'), r.supportExceed, r.front];
});
const snippet = 'const MINI_ROWS=' + JSON.stringify(rows) + ';';
writeFileSync(resolve(__dirname, '..', 'scripts', 'debug', 'mac-mini-candidates.snippet.js'), snippet);
console.log('总数', summary.total, '| 前沿', summary.frontier, '| 被支配', summary.dominated);
// 打印被支配候选的支配者缺失情况
const noDom = all.filter(r => !r.front && !r.dominatedBy);
console.log('被支配点中未标出支配者的数量:', noDom.length);
if (noDom.length) console.log(noDom.map(r => r.label).join(' ; '));