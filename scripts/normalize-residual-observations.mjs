#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeObservationData, rowsToCsv } from './lib/residual-observations.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const outputDir = join(ROOT, 'scripts/debug');
const constants = JSON.parse(readFileSync(sourcePath, 'utf8'));
const result = normalizeObservationData(constants);

if (result.violations.length > 0) {
  for (const violation of result.violations) console.error(`[normalize-residual-observations] ${violation}`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'residual-observations-normalized.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  constants_version: constants.metadata?.version,
  count: result.rows.length,
  eligible_count: result.rows.filter((row) => row.calibration_eligible).length,
  rows: result.rows,
}, null, 2) + '\n', 'utf8');
writeFileSync(join(outputDir, 'residual-observations-normalized.csv'), rowsToCsv(result.rows), 'utf8');

console.log(`[normalize-residual-observations] observations=${result.rows.length}`);
console.log(`[normalize-residual-observations] eligible=${result.rows.filter((row) => row.calibration_eligible).length}`);
console.log('[normalize-residual-observations] wrote scripts/debug/residual-observations-normalized.{json,csv}');
