#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResidualCurveAudit } from './lib/residual-curve-audit.mjs';
import { fitResidualCurve, prepareCalibrationSamples } from './lib/residual-curve-fit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const OUTPUT_DIR = join(ROOT, 'scripts/debug');
const constants = JSON.parse(readFileSync(SOURCE, 'utf8'));
const targetCategories = [
  'Mac_mini', 'iPhone_ProMax', 'iPhone_Pro', 'iPhone_标准',
  'MacBook_Air', 'MacBook_Pro', 'iPad_Pro', 'iPad_Air', 'iPad_标准', 'iPad_mini',
];

const validations = targetCategories.map((category) => {
  const preparation = prepareCalibrationSamples(constants, category);
  const fit = fitResidualCurve(preparation.accepted, constants['保值率曲线'][category]);
  let result = 'insufficient_data';
  if (fit.publishable) result = 'refittable';
  else if (preparation.accepted.length > 0) result = 'report_only';
  return {
    category,
    result,
    accepted_observations: preparation.accepted.length,
    excluded_observations: preparation.excluded.length,
    validation_only_observations: preparation.validationOnly.length,
    validation_method: fit.validation_metrics.method,
    gaps: fit.gaps,
    curve_changed: false,
  };
});

const audit = buildResidualCurveAudit(constants);
constants['保值率曲线审计状态'] = {
  _schema_version: '1.0',
  _说明: 'v4.9 全品类只读审计状态。该字段不改变曲线节点；详细证据在 scripts/debug/residual-curve-audit.json。',
  records: Object.fromEntries(audit.records.map((record) => [record.category, {
    status: record.status,
    observation_count: record.observation_count,
    eligible_observation_count: record.eligible_observation_count,
    recommendation: record.recommended_action,
  }])),
};

writeFileSync(SOURCE, JSON.stringify(constants, null, 2) + '\n', 'utf8');
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'residual-category-validation.json'), JSON.stringify({
  constants_version: constants.metadata.version,
  validations,
}, null, 2) + '\n', 'utf8');

for (const result of ['refittable', 'report_only', 'insufficient_data']) {
  console.log(`[validate-residual-categories] ${result}=${validations.filter((item) => item.result === result).length}`);
}
console.log('[validate-residual-categories] no curve nodes changed');
console.log('[validate-residual-categories] wrote scripts/debug/residual-category-validation.json');
