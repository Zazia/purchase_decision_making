#!/usr/bin/env node
/**
 * publish-constants.mjs — constants 云端发布脚本 (cloud-constants-distribution)
 *
 * 将源 constants.json + macro-context.json 发布到云数据库 `constants` 集合的
 * `latest` 文档 (单文档 payload 存 JSON 字符串, 字段契约见
 * openspec/specs/data-snapshot-bundling/spec.md「云端 constants 文档契约」)。
 * 发布后小程序无需重新提审发版, 用户端下次会话即用新数据。
 *
 * 用法:
 *   node scripts/publish-constants.mjs [--dry-run] [--env <envId>]
 *
 * 凭证 (MUST NOT 入库):
 *   - appid: 优先级 WX_APPID 环境变量 > 凭证文件 > miniapp/wx/project.config.json
 *   - secret: WX_SECRET 环境变量 > scripts/.wx-publish-credentials.json ({"appid?": "...", "secret": "..."})
 *
 * 一次性运维 (首次使用前):
 *   1. 云开发控制台 → 数据库 → 创建集合 `constants`
 *   2. 集合权限设为「所有用户可读，仅管理端可写」
 *      (客户端 wx.cloud.database() 直读 latest 文档依赖读权限)
 *   3. 本地配置 AppSecret (环境变量或凭证文件)
 *
 * 写入路径: stable_token 获取 access_token → tcb/databaseupdate (doc latest 原子更新)，
 * 失败时按序回退 doc().set() upsert → add(显式 _id) → update，保证已存在/不存在两种
 * 状态下均能发布成功。
 *
 * 失败退出非零码并指明失败步骤。
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const MACRO_SOURCE = join(ROOT, 'miniapp/wx/snapshot/macro-context.json');
const CREDENTIALS_FILE = join(ROOT, 'scripts/.wx-publish-credentials.json');
const PROJECT_CONFIG = join(ROOT, 'miniapp/wx/project.config.json');
const COLLECTION = 'constants';
const DOC_ID = 'latest';
/** 云数据库单文档上限 512KB, 保留安全余量 */
const MAX_PAYLOAD_BYTES = 450 * 1024;
/** 与 miniapp/wx/app.ts 的 CLOUD_ENV 保持一致, 可用 --env 覆盖 */
const DEFAULT_ENV = 'cloud1-d7gb4dzhoaca5534d';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const envFlagIdx = args.indexOf('--env');
const ENV_ID = envFlagIdx !== -1 && args[envFlagIdx + 1] ? args[envFlagIdx + 1] : DEFAULT_ENV;

function fail(step, message) {
  console.error(`[publish-constants] FAIL @ ${step}: ${message}`);
  process.exit(1);
}

// ---- Step 1: 读取与校验源数据 ----
if (!existsSync(SOURCE)) {
  fail('source-check', `Source constants.json not found at ${SOURCE}`);
}
const payload = readFileSync(SOURCE, 'utf-8');

let parsed;
try {
  parsed = JSON.parse(payload);
} catch (err) {
  fail('json-parse', `Source constants.json is not valid JSON: ${err.message}`);
}
const version = parsed?.metadata?.last_updated;
if (typeof version !== 'string' || version.length === 0) {
  fail('version-check', 'metadata.last_updated is missing or empty in source constants.json');
}

const payloadBytes = Buffer.byteLength(payload, 'utf-8');
if (payloadBytes > MAX_PAYLOAD_BYTES) {
  fail('size-check', `payload ${payloadBytes} bytes exceeds safe limit ${MAX_PAYLOAD_BYTES} bytes ` +
    `(cloud database single-doc limit is 512KB). Consider splitting distribution to cloud storage.`);
}

let macroContext = null;
if (existsSync(MACRO_SOURCE)) {
  try {
    macroContext = JSON.parse(readFileSync(MACRO_SOURCE, 'utf-8'));
  } catch (err) {
    fail('macro-parse', `Failed to parse macro-context.json: ${err.message}`);
  }
}

const hash = createHash('sha256').update(payload, 'utf-8').digest('hex');

console.log('[publish-constants] === 数据摘要 ===');
console.log(`  env:         ${ENV_ID}`);
console.log(`  version:     ${version} (metadata.last_updated)`);
console.log(`  payload:     ${payloadBytes} bytes (limit ${MAX_PAYLOAD_BYTES})`);
console.log(`  sha256:      ${hash}`);
console.log(`  macroCtx:    ${macroContext ? JSON.stringify(macroContext) : '(absent, will publish null)'}`);

if (DRY_RUN) {
  console.log('[publish-constants] dry-run: 校验通过, 未发起任何网络请求。');
  process.exit(0);
}

// ---- Step 2: 凭证 ----
if (typeof fetch !== 'function') {
  fail('node-version', '此脚本需要 Node 18+ (global fetch)');
}
let credentials = {};
if (existsSync(CREDENTIALS_FILE)) {
  try {
    credentials = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
  } catch (err) {
    fail('credentials-parse', `Failed to parse ${CREDENTIALS_FILE}: ${err.message}`);
  }
}
const appid = process.env.WX_APPID || credentials.appid
  || (() => {
    try {
      return JSON.parse(readFileSync(PROJECT_CONFIG, 'utf-8')).appid;
    } catch {
      return undefined;
    }
  })();
const secret = process.env.WX_SECRET || credentials.secret;
if (!appid) {
  fail('credentials-check', '未找到 appid (WX_APPID / 凭证文件 / project.config.json 均缺失)');
}
if (!secret) {
  fail('credentials-check',
    '未找到 AppSecret。配置方式任选其一:\n' +
    '  1) 设置环境变量 WX_SECRET (推荐, 如 [Environment]::SetEnvironmentVariable("WX_SECRET","xxx","User") 后重开终端)\n' +
    `  2) 创建 ${CREDENTIALS_FILE} 内容 {"secret": "你的AppSecret"} (已加入 .gitignore)`);
}

// ---- Step 3: stable_token (不作废其他 token, 与云函数内置凭证互不干扰) ----
async function getAccessToken() {
  const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid, secret, force_refresh: false }),
  });
  const data = await res.json();
  if (!data.access_token) {
    fail('stable_token', `获取 access_token 失败: ${JSON.stringify(data)} ` +
      '(检查 appid 与 AppSecret 是否匹配, IP 是否在白名单)');
  }
  return data.access_token;
}

/** 调用微信云开发 HTTP API (POST JSON); 非 JSON 响应(如网关 413)转成 errcode 形式 */
async function callCloudApi(path, accessToken, body) {
  const res = await fetch(`https://api.weixin.qq.com${path}?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errcode: -1, errmsg: `HTTP ${res.status}, 非 JSON 响应: ${text.slice(0, 200)}` };
  }
}

const docData = {
  _ready: true,
  version,
  payload,
  macroContext,
  hash,
  publishedAt: new Date().toISOString(),
};

async function main() {
  console.log('[publish-constants] 获取 access_token ...');
  const token = await getAccessToken();

  // 写入策略: 单次原子更新全部字段; 按序尝试, 保证文档存在/不存在两种状态均可成功
  //   1) databaseupdate: doc(latest).update({data: {...}})   (常规路径: 文档已存在)
  //   2) databaseupdate: doc(latest).set({data: {...}})      (upsert 语义)
  //   3) databaseadd:    add({data: {_id: 'latest', ...}})   (首次创建; 撞已存在则回退 1 重试)
  const attempts = [
    {
      name: 'update',
      path: '/tcb/databaseupdate',
      query: `db.collection("${COLLECTION}").doc("${DOC_ID}").update({data: ${JSON.stringify(docData)}})`,
    },
    {
      name: 'set (upsert)',
      path: '/tcb/databaseupdate',
      query: `db.collection("${COLLECTION}").doc("${DOC_ID}").set({data: ${JSON.stringify(docData)}})`,
    },
    {
      name: 'add',
      path: '/tcb/databaseadd',
      query: `db.collection("${COLLECTION}").add({data: ${JSON.stringify({ _id: DOC_ID, ...docData })}})`,
    },
  ];

  const allResponses = [];
  for (const attempt of attempts) {
    console.log(`[publish-constants] 尝试写入 (${attempt.name}) ...`);
    const resp = await callCloudApi(attempt.path, token, { env: ENV_ID, query: attempt.query });
    allResponses.push({ attempt: attempt.name, resp });
    if (resp.errcode === 0) {
      console.log(`[publish-constants] 发布成功 (via ${attempt.name})`);
      console.log(`  collection:  ${COLLECTION}`);
      console.log(`  doc:         ${DOC_ID}`);
      console.log(`  version:     ${version}`);
      console.log(`  publishedAt: ${docData.publishedAt}`);
      console.log('[publish-constants] 小程序端下次会话将自动采用新数据 (无需提审发版)。');
      process.exit(0);
    }
    const msg = `${resp.errcode} ${resp.errmsg || ''}`;
    console.warn(`[publish-constants] ${attempt.name} 未成功: ${JSON.stringify(resp)}`);
    if (/access_token|40001|42001|40014/i.test(msg)) {
      fail('write', `access_token 无效: ${JSON.stringify(resp)} (检查 appid 与 AppSecret 是否匹配, IP 是否在白名单)`);
    }
    // 其余错误(文档不存在/DSL 不支持/集合不存在等)继续尝试下一种写入方式
  }

  // add 撞已存在 → 用 update 最后重试一次 (覆盖前两步均不可用的极端情况)
  const addResp = allResponses.find((r) => r.attempt === 'add');
  if (addResp && /exist|duplicate|重复|-502001/i.test(`${addResp.resp.errcode} ${addResp.resp.errmsg || ''}`)) {
    console.log('[publish-constants] 文档已存在, 回退 update 重试 ...');
    const retry = await callCloudApi('/tcb/databaseupdate', token, {
      env: ENV_ID,
      query: `db.collection("${COLLECTION}").doc("${DOC_ID}").update({data: ${JSON.stringify(docData)}})`,
    });
    if (retry.errcode === 0) {
      console.log('[publish-constants] 发布成功 (via update retry)');
      process.exit(0);
    }
    allResponses.push({ attempt: 'update retry', resp: retry });
  }

  const anyCollectionErr = allResponses.some((r) =>
    /collection|集合/i.test(`${r.resp.errcode} ${r.resp.errmsg || ''}`));
  if (anyCollectionErr) {
    fail('write', `集合操作失败(若为集合不存在, 请先在云开发控制台创建集合 ${COLLECTION} 并设为「所有用户可读，仅管理端可写」)。全部响应: ${JSON.stringify(allResponses)}`);
  }
  fail('write', `所有写入方式均失败。全部响应: ${JSON.stringify(allResponses)}`);
}

main().catch((err) => {
  fail('unexpected', err && err.stack ? err.stack : String(err));
});
