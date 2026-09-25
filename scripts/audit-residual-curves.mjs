#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResidualCurveAudit, auditToMarkdown, AUDIT_STATUSES } from './lib/residual-curve-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const outputDir = join(ROOT, 'scripts/debug');
const constants = JSON.parse(readFileSync(sourcePath, 'utf8'));
const audit = buildResidualCurveAudit(constants);
const errors = [];
if (audit.category_count !== 18) errors.push(`expected 18 categories, got ${audit.category_count}`);
for (const record of audit.records) {
  if (!AUDIT_STATUSES.has(record.status)) errors.push(`${record.category}: invalid status ${record.status}`);
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) errors.push(`${record.category}: evidence missing`);
  if (!record.recommended_action) errors.push(`${record.category}: recommended_action missing`);
}
if (errors.length) {
  errors.forEach((error) => console.error(`[audit-residual-curves] ERROR ${error}`));
  process.exit(1);
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'residual-curve-audit.json'), JSON.stringify(audit, null, 2) + '\n', 'utf8');
writeFileSync(join(outputDir, 'residual-curve-audit.md'), auditToMarkdown(audit), 'utf8');
console.log(`[audit-residual-curves] categories=${audit.category_count}`);
for (const status of AUDIT_STATUSES) {
  console.log(`[audit-residual-curves] ${status}=${audit.records.filter((record) => record.status === status).length}`);
}
console.log('[audit-residual-curves] wrote scripts/debug/residual-curve-audit.{json,md}');
