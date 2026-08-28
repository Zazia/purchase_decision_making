#!/usr/bin/env node
// 2026-08-28 Mac mini 购买决策引擎计算(预算5000左右)
// 用法: node scripts/mac-mini-analysis-20260828.mjs
// 输出: scripts/debug/mac-mini-frontier-20260828.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from '../.agents/skills/apple-value-analysis/scripts/load-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CONSTANTS_PATH = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const OUT_PATH = join(ROOT, 'scripts/debug/mac-mini-frontier-20260828.json');

const { engine } = await loadEngine();
const constants = engine.loadConstants(readFileSync(CONSTANTS_PATH, 'utf-8'));

const baseOptions = {
  category: 'Mac_mini',
  holdingYears: [1, 1.5, 2, 3, 4, 5],
  buyTiming: 'both',
  performanceFloor: 0,
  considerWait: true,
  macroContext: {
    storageSuperCycleStage: 'ongoing',
    hasGlobalPriceHike: true,
    analysisMonth: '2026-08',
  },
};

// 主口径:预算5000
const main = engine.computeParetoFrontier(constants, { ...baseOptions, budget: 5000 });
// 对照口径:预算7000(提取 M6 类型B,用于报告"超预算参考"段)
const stretch = engine.computeParetoFrontier(constants, { ...baseOptions, budget: 7000 });

const simplify = (r) => ({
  frontier: r.frontier,
  dominated: r.dominated,
  recommendationRange: r.recommendationRange ?? null,
});

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify({ main: simplify(main), stretch: simplify(stretch) }, null, 2), 'utf-8');

const fmt = (p) =>
  `${p.model ?? p.device ?? '?'}|${p.memory ?? '?'}G/${p.storage ?? '?'}G|类型${p.candidateType ?? '?'}|持有${p.holdingMonths ?? p.holdingYears ?? '?'}月|买${p.buyPrice ?? '?'}|月均${p.monthlyCost?.toFixed?.(1) ?? p.monthlyCost ?? '?'}|S̄${((p.avgPerformance ?? p.performance ?? 0) * 100).toFixed?.(0) ?? '?'}%`;

console.log('=== 预算5000 前沿 ===');
for (const p of main.frontier) console.log(fmt(p));
console.log(`\n=== 预算5000 被支配 ${main.dominated.length} 个(明细见JSON) ===`);
console.log('\n=== 预算7000 前沿(对照,含M6) ===');
for (const p of stretch.frontier) console.log(fmt(p));
console.log(`\n输出已写入 ${OUT_PATH}`);
