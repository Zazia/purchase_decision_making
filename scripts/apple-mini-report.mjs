import { readFileSync } from 'node:fs';
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
  macroContext: {
    storageSuperCycleStage: 'ongoing',
    hasGlobalPriceHike: true,
    analysisMonth: '2026-08',
  },
});

console.log('=== FRONTIER ===');
console.log(JSON.stringify(result.frontier, null, 2));
console.log('=== DOMINATED ===');
console.log(JSON.stringify(result.dominated, null, 2));
console.log('=== RANGE ===');
console.log(JSON.stringify(result.recommendationRange, null, 2));