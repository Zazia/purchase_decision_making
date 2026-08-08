#!/usr/bin/env node
/**
 * sync-snapshot.mjs — constants.json 快照同步脚本
 *
 * 将源文件 .agents/skills/apple-value-analysis/constants.json 拷贝到
 * 小程序快照目录 miniapp/wx/snapshot/constants.json,
 * 并生成 constants.js 包装版本 (供小程序 require, 因 devtools 不能直接 require .json)。
 *
 * 同时将维护者人工维护的 macro-context.json 注入 constants.js 顶部 MACRO_CONTEXT 字段,
 * 供 engine-bridge 读取并作为 macroContext 传入引擎 (见任务 11.2)。
 *
 * 校验:
 * 1. 源文件存在
 * 2. hash 比对(若一致则跳过)
 * 3. 拷贝后 hash 一致性校验
 * 4. last_updated 字段非空校验
 * 5. v3.8 新品发布期嵌套字段存在性校验 (见任务 11.1)
 * 6. macro-context.json 字段完整性校验 (见任务 11.2)
 *
 * 失败退出非零码并指明失败步骤。
 *
 * 用法: node scripts/sync-snapshot.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const TARGET_DIR = join(ROOT, 'miniapp/wx/snapshot');
const TARGET_JSON = join(TARGET_DIR, 'constants.json');
const TARGET_JS = join(TARGET_DIR, 'constants.js');
const MACRO_SOURCE = join(TARGET_DIR, 'macro-context.json');

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function fail(step, message) {
  console.error(`[sync-snapshot] FAIL @ ${step}: ${message}`);
  process.exit(1);
}

// Step 1: 源文件存在校验
if (!existsSync(SOURCE)) {
  fail('source-check', `Source constants.json not found at ${SOURCE}`);
}
console.log('[sync-snapshot] Source file found.');

const sourceContent = readFileSync(SOURCE, 'utf-8');
const sourceHash = sha256(sourceContent);

// Step 2: hash 比对(.json 内容)
// 注: 即使 .json hash 一致, 仍需重新生成 .js 包装, 因为 macro-context.json 可能独立更新。
// 仅跳过 .json 拷贝(Step 4), Step 7-9 (校验 + .js 生成) 始终执行。
let jsonInSync = false;
if (existsSync(TARGET_JSON)) {
  const targetContent = readFileSync(TARGET_JSON, 'utf-8');
  const targetHash = sha256(targetContent);
  if (sourceHash === targetHash) {
    jsonInSync = true;
    console.log(`[sync-snapshot] .json already in sync (hash: ${sourceHash.slice(0, 12)}...), skip copy. .js wrapper will be regenerated.`);
  } else {
    console.log('[sync-snapshot] Hash differs, will update .json.');
  }
} else {
  console.log('[sync-snapshot] Target .json not found, will create.');
}

// Step 3: 确保目标目录存在
if (!existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true });
  console.log(`[sync-snapshot] Created target dir: ${TARGET_DIR}`);
}

// Step 4: 拷贝 .json (hash 一致时跳过)
if (!jsonInSync) {
  writeFileSync(TARGET_JSON, sourceContent, 'utf-8');
  console.log('[sync-snapshot] JSON file copied.');
}

// Step 5: hash 一致性校验 (读取目标 .json, 无论是否刚拷贝)
// 注: .js 包装生成移至 Step 9 (需先完成 v3.8 与 macro 校验后注入 MACRO_CONTEXT)
const copiedContent = readFileSync(TARGET_JSON, 'utf-8');
const copiedHash = sha256(copiedContent);
if (copiedHash !== sourceHash) {
  fail('hash-verify', `Hash mismatch: source=${sourceHash.slice(0, 12)} target=${copiedHash.slice(0, 12)}`);
}
console.log(`[sync-snapshot] Hash verified: ${copiedHash.slice(0, 12)}...`);

// Step 7: last_updated 非空校验 + v3.8 嵌套字段存在性校验 (任务 11.1)
let parsed;
try {
  parsed = JSON.parse(copiedContent);
} catch (err) {
  fail('json-parse', `Failed to parse copied snapshot as JSON: ${err.message}`);
}

const lastUpdated = parsed?.metadata?.last_updated;
if (typeof lastUpdated !== 'string' || lastUpdated.length === 0) {
  fail('last-updated-check', 'metadata.last_updated is missing or empty in copied snapshot');
}
console.log(`[sync-snapshot] last_updated verified: ${lastUpdated}`);

// v3.8 新品发布期嵌套字段校验 (任务 11.1)
// 这些字段嵌套于 "苹果产品发布节奏" 与 "新品发布对老款冲击" 顶层键内,
// loadConstants() 会提取为 Constants 接口的英文字段。这里校验源数据存在性。
const V38_FIELDS = [
  ['苹果产品发布节奏', '_缺货等待期模型_v3.8'],
  ['苹果产品发布节奏', '_发布时间预测校验_v3.8'],
  ['新品发布对老款冲击', '_宏观因子调整_v3.8'],
  ['新品发布对老款冲击', '_冲击时变曲线_v3.8'],
  ['新品发布对老款冲击', '_新品价格预测模型_v3.8'],
];
const missingV38 = V38_FIELDS.filter(([parent, child]) => {
  const parentObj = parsed?.[parent];
  return !parentObj || typeof parentObj !== 'object' || parentObj[child] === undefined;
});
if (missingV38.length > 0) {
  const detail = missingV38.map(([p, c]) => `${p}.${c}`).join(', ');
  fail('v38-fields-check', `Missing v3.8 nested fields in snapshot: ${detail}`);
}
console.log(`[sync-snapshot] v3.8 nested fields verified (${V38_FIELDS.length} fields).`);

// Step 8: 读取 macro-context.json 并注入 constants.js 顶部 MACRO_CONTEXT (任务 11.2)
let macroContext = null;
if (existsSync(MACRO_SOURCE)) {
  try {
    const macroRaw = readFileSync(MACRO_SOURCE, 'utf-8');
    macroContext = JSON.parse(macroRaw);
  } catch (err) {
    fail('macro-context-parse', `Failed to parse macro-context.json: ${err.message}`);
  }
  // 字段完整性校验
  const stage = macroContext?.storageSuperCycleStage;
  const hike = macroContext?.hasGlobalPriceHike;
  const month = macroContext?.analysisMonth;
  const validStages = ['ongoing', 'peaking', 'easing', 'none'];
  if (!validStages.includes(stage)) {
    fail('macro-context-check', `macro-context.json storageSuperCycleStage invalid: ${stage} (expected one of ${validStages.join('/')})`);
  }
  if (typeof hike !== 'boolean') {
    fail('macro-context-check', `macro-context.json hasGlobalPriceHike must be boolean, got: ${typeof hike}`);
  }
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    fail('macro-context-check', `macro-context.json analysisMonth must be YYYY-MM, got: ${month}`);
  }
  console.log(`[sync-snapshot] MACRO_CONTEXT verified (stage=${stage}, hike=${hike}, month=${month}).`);
} else {
  console.log('[sync-snapshot] macro-context.json not found, MACRO_CONTEXT will be omitted (engine falls back to none).');
}

// Step 9: 生成 .js 包装 (供小程序 require)
// 微信小程序运行时 require('xxx.json') 会被解析成 xxx.json.js 导致找不到模块,
// 所以生成一个 .js 包装文件, engine-bridge 通过 require('../snapshot/constants.js') 加载。
// 用 Object.assign 注入 MACRO_CONTEXT 顶部字段 (任务 11.2), engine-bridge 通过 snapshotRaw.MACRO_CONTEXT 读取。
const macroMerge = macroContext ? `, ${JSON.stringify({ MACRO_CONTEXT: macroContext })}` : '';
const jsWrapper = `// AUTO-GENERATED by scripts/sync-snapshot.mjs — 不要手动编辑\nmodule.exports = Object.assign(${sourceContent.trim()}${macroMerge});\n`;
writeFileSync(TARGET_JS, jsWrapper, 'utf-8');
console.log('[sync-snapshot] JS wrapper generated (with MACRO_CONTEXT injection if present).');

console.log(`[sync-snapshot] Snapshot synced: ${copiedHash}`);
process.exit(0);
