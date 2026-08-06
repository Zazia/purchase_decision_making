#!/usr/bin/env node
/**
 * sync-engine.mjs — apple-value-engine 产物同步到小程序 vendor 目录
 *
 * 将 packages/apple-value-engine/dist/ 下的 .js 与 .d.ts 文件拷贝到
 * miniapp/wx/vendor/apple-value-engine/，让 engine-bridge 用相对路径 import 引用。
 *
 * 为什么不用 miniprogram_npm 机制:
 *   微信小程序的 miniprogram_npm/ 必须由开发者工具「工具 → 构建 npm」触发注册,
 *   手动放文件进去运行时不会识别。而引擎包在 monorepo packages/ 下不在 node_modules/,
 *   开发者工具的「构建 npm」找不到它。改用 vendor/ + 相对路径 require 完全绕过 npm 机制。
 *
 * 为什么拷贝 .d.ts:
 *   engine-bridge/index.ts 用 import { ... } from '../vendor/apple-value-engine/index',
 *   TS 编译时需要 index.d.ts 做类型检查, 运行时 require 解析到 index.js。
 *
 * 校验:
 * 1. 源 dist 目录与 index.js / index.d.ts 存在
 * 2. 拷贝 .js 与 .d.ts 文件(忽略 .map)
 * 3. 拷贝后入口文件存在性校验
 *
 * 失败退出非零码并指明失败步骤。
 *
 * 用法: node scripts/sync-engine.mjs
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_DIR = join(ROOT, 'packages/apple-value-engine/dist');
const TARGET_DIR = join(ROOT, 'miniapp/wx/vendor/apple-value-engine');

function fail(step, message) {
  console.error(`[sync-engine] FAIL @ ${step}: ${message}`);
  process.exit(1);
}

// Step 1: 源 dist 目录与入口存在校验
if (!existsSync(SOURCE_DIR)) {
  fail('source-check', `Source dist dir not found at ${SOURCE_DIR}. Run "npm run build --workspace apple-value-engine" first.`);
}
const sourceIndexJs = join(SOURCE_DIR, 'index.js');
const sourceIndexDts = join(SOURCE_DIR, 'index.d.ts');
if (!existsSync(sourceIndexJs)) {
  fail('source-check', `Source entry index.js not found at ${sourceIndexJs}. Run "npm run build --workspace apple-value-engine" first.`);
}
if (!existsSync(sourceIndexDts)) {
  fail('source-check', `Source entry index.d.ts not found at ${sourceIndexDts}. Run "npm run build --workspace apple-value-engine" first.`);
}
console.log('[sync-engine] Source dist found.');

// Step 2: 确保目标目录存在
if (!existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true });
  console.log(`[sync-engine] Created target dir: ${TARGET_DIR}`);
}

// Step 3: 拷贝 .js 与 .d.ts 文件(忽略 .map / 其它)
const files = readdirSync(SOURCE_DIR).filter(
  (f) => f.endsWith('.js') || f.endsWith('.d.ts'),
);
if (files.length === 0) {
  fail('copy', 'No .js or .d.ts files found in source dist.');
}
let copiedJs = 0;
let copiedDts = 0;
for (const file of files) {
  const src = join(SOURCE_DIR, file);
  const dst = join(TARGET_DIR, file);
  copyFileSync(src, dst);
  if (file.endsWith('.js')) copiedJs++;
  if (file.endsWith('.d.ts')) copiedDts++;
}
console.log(`[sync-engine] Copied ${copiedJs} .js files + ${copiedDts} .d.ts files.`);

// Step 4: 拷贝后入口存在性校验
if (!existsSync(join(TARGET_DIR, 'index.js'))) {
  fail('verify', 'index.js missing in target after copy.');
}
if (!existsSync(join(TARGET_DIR, 'index.d.ts'))) {
  fail('verify', 'index.d.ts missing in target after copy.');
}
console.log('[sync-engine] Entry verified: vendor/apple-value-engine/index.js + index.d.ts exist.');
console.log('[sync-engine] Done. engine-bridge 现在可以用 import from "../vendor/apple-value-engine/index" 引用。');
process.exit(0);
