import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIT_STATUSES, buildResidualCurveAudit } from '../lib/residual-curve-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const sha = (value) => createHash('sha256').update(value).digest('hex');

describe('残值曲线全品类审计', () => {
  it('完整覆盖 18 个品类并提供合法状态、证据和动作', () => {
    const before = readFileSync(sourcePath, 'utf8');
    const audit = buildResidualCurveAudit(JSON.parse(before));
    const after = readFileSync(sourcePath, 'utf8');
    expect(audit.records).toHaveLength(18);
    expect(new Set(audit.records.map((record) => record.category)).size).toBe(18);
    for (const record of audit.records) {
      expect(AUDIT_STATUSES.has(record.status)).toBe(true);
      expect(record.evidence.length).toBeGreaterThan(0);
      expect(record.recommended_action.length).toBeGreaterThan(0);
    }
    expect(sha(after)).toBe(sha(before));
  });

  it('人工复核分类：Mac mini 为已应用错误校准，其他旧报告品类仅判错误评估', () => {
    const audit = buildResidualCurveAudit(JSON.parse(readFileSync(sourcePath, 'utf8')));
    expect(audit.records.find((record) => record.category === 'Mac_mini')?.status).toBe('invalid_calibration_applied');
    expect(audit.records.find((record) => record.category === 'iPhone_Pro')?.status).toBe('invalid_evaluation_only');
    expect(audit.records.find((record) => record.category === 'MacBook_Pro')?.status).toBe('invalid_evaluation_only');
    expect(audit.records.find((record) => record.category === 'Apple_Watch')?.status).toBe('provenance_missing');
  });
});
