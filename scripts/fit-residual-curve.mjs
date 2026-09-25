#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCalibrationManifest, fitResidualCurve, prepareCalibrationSamples } from './lib/residual-curve-fit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const categoryIndex = process.argv.indexOf('--category');
const category = categoryIndex >= 0 ? process.argv[categoryIndex + 1] : 'Mac_mini';
const constants = JSON.parse(readFileSync(sourcePath, 'utf8'));
const baseline = constants['保值率曲线'][category];
if (!baseline) throw new Error(`Unknown curve category: ${category}`);
const preparation = prepareCalibrationSamples(constants, category);
const fit = fitResidualCurve(preparation.accepted, baseline);
const manifest = buildCalibrationManifest({
  category,
  version: constants.metadata.version,
  baselineCurve: baseline,
  preparation,
  fit,
});
const output = { category, preparation, fit, manifest };
const outputDir = join(ROOT, 'scripts/debug');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, `residual-fit-${category}.json`), JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`[fit-residual-curve] category=${category}`);
console.log(`[fit-residual-curve] accepted=${preparation.accepted.length}, excluded=${preparation.excluded.length}, validationOnly=${preparation.validationOnly.length}`);
console.log(`[fit-residual-curve] cv=${fit.validation_metrics.method}, lambda=${fit.lambda}, publishable=${fit.publishable}`);
if (fit.gaps.length) console.log(`[fit-residual-curve] gaps=${fit.gaps.join(',')}`);
console.log(`[fit-residual-curve] wrote scripts/debug/residual-fit-${category}.json`);
