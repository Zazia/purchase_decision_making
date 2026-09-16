#!/usr/bin/env node
/**
 * verify-cloud-constants.mjs — 云端 constants.latest 一致性校验 (data-maintenance-automation)
 *
 * 发布后回读云端文档, 与本地 constants.json 比对三项:
 *   V1 云端自洽: sha256(doc.payload) === doc.hash (云端文档自身未被截断/篡改)
 *   V2 payload 一致: 本地文件 sha256 === doc.hash, 且字节长度一致
 *   V3 版本一致: doc.version === 本地 metadata.last_updated
 *
 * 用法: node scripts/verify-cloud-constants.mjs [--env <envId>] [--dry-run]
 *   --dry-run: 干跑——照常读取并输出两侧对照, 差异/读取失败不阻断 (退出码 0)。
 *
 * 退出码: 三项全部一致 0; 任一不一致或读取失败 1 (--dry-run 除外), 并输出两侧对照。
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createCloudClient, DEFAULT_ENV_ID } from './lib/wx-cloud-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOCAL_FILE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const COLLECTION = 'constants';
const DOC_ID = 'latest';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const envFlagIdx = args.indexOf('--env');
const ENV_ID = envFlagIdx !== -1 && args[envFlagIdx + 1] ? args[envFlagIdx + 1] : DEFAULT_ENV_ID;

const sha256 = (s) => createHash('sha256').update(s, 'utf-8').digest('hex');

// ---- 本地侧 ----
if (!existsSync(LOCAL_FILE)) {
  console.error(`[verify-constants] FAIL @ local-read: 本地文件不存在 ${LOCAL_FILE}`);
  process.exit(1);
}
const localPayload = readFileSync(LOCAL_FILE, 'utf-8');
const localHash = sha256(localPayload);
let localVersion;
try {
  localVersion = JSON.parse(localPayload)?.metadata?.last_updated;
} catch { /* 损坏的本地 JSON, lint 环节会拦, 此处仅显示 */ }

// ---- 云端侧 ----
let doc = null;
let readErr = null;
try {
  const client = await createCloudClient({ envId: ENV_ID });
  doc = await client.getDoc(COLLECTION, DOC_ID);
} catch (err) {
  readErr = err;
}

const problems = [];
if (readErr) {
  problems.push(`云端读取失败: ${readErr.message}`);
} else if (!doc) {
  problems.push(`云端 ${COLLECTION}/${DOC_ID} 文档不存在 (尚未发布过?)`);
} else {
  const cloudSelfHash = typeof doc.payload === 'string' ? sha256(doc.payload) : null;
  if (cloudSelfHash !== doc.hash) {
    problems.push(`V1 云端自洽失败: sha256(doc.payload)=${cloudSelfHash} != doc.hash=${doc.hash}`);
  }
  if (localHash !== doc.hash) {
    problems.push(`V2 payload 不一致: 本地 sha256=${localHash} != 云端 doc.hash=${doc.hash} `
      + `(本地 ${Buffer.byteLength(localPayload)} bytes vs 云端 ${typeof doc.payload === 'string' ? Buffer.byteLength(doc.payload) : '?'} bytes)`);
  }
  if (localVersion !== doc.version) {
    problems.push(`V3 版本不一致: 本地 metadata.last_updated=${JSON.stringify(localVersion)} != 云端 doc.version=${JSON.stringify(doc.version)}`);
  }
}

// ---- 两侧对照 ----
console.log('[verify-constants] === 云端一致性校验 ===');
console.log(`  env:                 ${ENV_ID}${DRY_RUN ? '  (dry-run, 差异不阻断)' : ''}`);
console.log(`  本地 version:        ${localVersion ?? '(缺失)'}`);
console.log(`  云端 doc.version:    ${doc?.version ?? '(读取失败)'}`);
console.log(`  本地 sha256(前16):   ${localHash.slice(0, 16)}…`);
console.log(`  云端 doc.hash(前16): ${doc?.hash?.slice(0, 16) ?? '(读取失败)'}…`);
if (doc && typeof doc.payload === 'string') {
  const selfHash = sha256(doc.payload);
  console.log(`  云端自洽 sha256(doc.payload): ${selfHash.slice(0, 16)}… ${selfHash === doc.hash ? '[OK]' : '[MISMATCH]'}`);
} else {
  console.log('  云端自洽 sha256(doc.payload): [N/A]');
}
console.log(`  payload 字节:         本地 ${Buffer.byteLength(localPayload)} vs 云端 ${doc && typeof doc.payload === 'string' ? Buffer.byteLength(doc.payload) : '?'}`);
console.log(`  云端 publishedAt:     ${doc?.publishedAt ?? '(读取失败)'}`);

if (problems.length > 0) {
  console.error(`[verify-constants] FAIL: ${problems.length} 项不一致:`);
  for (const p of problems) console.error(`  - ${p}`);
  if (DRY_RUN) {
    console.warn('[verify-constants] dry-run 模式: 不阻断退出 (正式发布时会以此为准拦截)。');
    process.exit(0);
  }
  process.exit(1);
}

console.log('[verify-constants] OK: 云端与本地一致 (payload / 自洽 / 版本)。');
