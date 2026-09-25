#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCurveRelease } from './lib/curve-release-gate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readArg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
};
const sourcePath = readArg('--source', join(ROOT, '.agents/skills/apple-value-analysis/constants.json'));
const baselinePath = readArg('--baseline', join(ROOT, 'miniapp/wx/snapshot/constants.json'));
const current = JSON.parse(readFileSync(sourcePath, 'utf8'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const result = auditCurveRelease(current, baseline);

console.log(`[curve-release-gate] mode=${result.mode}`);
console.log(`[curve-release-gate] changed=${result.changed_categories.join(',') || '(none)'}`);
console.log(`[curve-release-gate] observations=${result.observation_count}, eligible=${result.eligible_observation_count}`);
if (!result.ok) {
  result.errors.forEach((error) => console.error(`[curve-release-gate] ERROR ${error}`));
  process.exit(1);
}
console.log('[curve-release-gate] PASS');
