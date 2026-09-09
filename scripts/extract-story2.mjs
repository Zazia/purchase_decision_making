import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('.agents/skills/apple-value-analysis/constants.json', 'utf8'));

const curves = {};
const snapshots = {};
const impacts = {};
const texts = [];
const structure = [];

function walk(node, path, depth) {
  if (depth > 4) return;
  if (typeof node === 'string') {
    if (node.length > 80) texts.push([path, node.slice(0, 500)]);
    return;
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return;

  const keys = Object.keys(node);
  const numericKeys = keys.filter(k => /^\d+$/.test(k));
  const hasUnderscore = keys.some(k => k.startsWith('_'));
  const hasXly = keys.some(k => k.includes('闲鱼'));
  const hasMean = keys.includes('均值');

  if ((numericKeys.length >= 3 && hasUnderscore) || numericKeys.length >= 5) {
    curves[path] = node;
    return;
  }
  if (hasXly) {
    snapshots[path] = node;
    return;
  }
  if (hasMean) {
    impacts[path] = node;
    return;
  }
  if (depth <= 2) structure.push(path + ' :: ' + keys.slice(0, 30).join(' | '));
  for (const [k, v] of Object.entries(node)) walk(v, path + '/' + k, depth + 1);
}

for (const [k, v] of Object.entries(data)) walk(v, k, 1);

const out = [];
out.push('=== METADATA ===');
out.push(JSON.stringify({ version: data.metadata?.version, last_updated: data.metadata?.last_updated }, null, 0));
const chg = data.metadata?.变更摘要;
if (chg) out.push(JSON.stringify(chg).slice(0, 3000));

out.push('\n=== STRUCTURE (depth<=2) ===');
out.push(...structure);

out.push('\n=== CURVES ===');
for (const [p, c] of Object.entries(curves)) {
  out.push(p + ' => ' + Object.entries(c).map(([a, b]) => `${a}:${b}`).join(' '));
}

out.push('\n=== SNAPSHOTS ===');
for (const [p, s] of Object.entries(snapshots)) {
  const fields = Object.entries(s)
    .filter(([, v]) => typeof v !== 'object')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  out.push(p + ' => ' + fields);
}

out.push('\n=== IMPACTS ===');
for (const [p, s] of Object.entries(impacts)) out.push(p + ' => ' + JSON.stringify(s).slice(0, 500));

out.push('\n=== LONG TEXTS ===');
for (const [p, t] of texts) out.push(p + ' => ' + t);

writeFileSync('scripts/debug/story2-data.txt', out.join('\n'), 'utf8');
console.log('OK curves=' + Object.keys(curves).length + ' snapshots=' + Object.keys(snapshots).length + ' impacts=' + Object.keys(impacts).length + ' texts=' + texts.length);
