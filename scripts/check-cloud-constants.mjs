/**
 * check-cloud-constants.mjs — 云端 constants 发布状态诊断
 * 用服务端 API 查询云数据库 constants/latest 文档实际内容, 与本地 constants.json 比对。
 * 用法: node scripts/check-cloud-constants.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const cred = JSON.parse(readFileSync(join(ROOT, 'scripts/.wx-publish-credentials.json'), 'utf-8'));
const appid = JSON.parse(readFileSync(join(ROOT, 'miniapp/wx/project.config.json'), 'utf-8')).appid;
const ENV = 'cloud1-d7gb4dzhoaca5534d';

const tokenRes = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credential', appid, secret: cred.secret, force_refresh: false }),
}).then(r => r.json());
if (!tokenRes.access_token) {
  console.error('[check] stable_token FAIL:', JSON.stringify(tokenRes));
  process.exit(1);
}

const q = await fetch(`https://api.weixin.qq.com/tcb/databasequery?access_token=${tokenRes.access_token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ env: ENV, query: 'db.collection("constants").limit(10).get()' }),
}).then(r => r.json());
if (q.errcode !== 0) {
  console.error('[check] databasequery FAIL:', JSON.stringify(q));
  process.exit(1);
}

const docs = (q.data || []).map(s => JSON.parse(s));
if (docs.length === 0) {
  console.error('[check] 集合 constants 为空(或不存在)! data:', JSON.stringify(q.data), 'pager:', JSON.stringify(q.pagewriter || {}));
  process.exit(1);
}
const doc = docs.find(d => d._id === 'latest') ?? docs[0];
console.log(`[check] 集合内文档数: ${docs.length}, _id 列表: ${docs.map(d => d._id).join(', ')}`);

let meta = {};
try { meta = JSON.parse(doc.payload || '{}').metadata ?? {}; } catch { /* payload 损坏 */ }
console.log('=== 云端 constants/latest 实际内容 ===');
console.log('doc.version:           ', doc.version);
console.log('doc._ready:            ', doc._ready);
console.log('doc.publishedAt:       ', doc.publishedAt);
console.log('doc.hash(前12):        ', (doc.hash || '').slice(0, 12));
console.log('payload 可解析:         ', !!meta.last_updated ? '是' : '否(JSON损坏?)');
console.log('payload.metadata.version:', meta.version);
console.log('payload.last_updated:   ', meta.last_updated);
console.log('payload bytes:         ', (doc.payload || '').length);
console.log('macroContext:          ', JSON.stringify(doc.macroContext).slice(0, 160));

const localRaw = readFileSync(join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf-8');
console.log('本地 constants hash(前12):', localRaw.length === doc.payload?.length ? '(长度一致)' : `(长度不一致: 本地${localRaw.length} vs 云端${doc.payload?.length})`);
