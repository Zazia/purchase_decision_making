// 引擎 dist 产物 ESM import 冒烟检查
// 用途: 每次重建 dist 后验证模块格式与包声明 (type: module) 一致, 防止 P0 回归
// 运行: node scripts/engine-esm-smoke.mjs  (exit 0 = 通过)
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const distUrl = pathToFileURL(path.join(root, '..', 'packages', 'apple-value-engine', 'dist', 'index.js')).href;

const mod = await import(distUrl);

const required = ['computeParetoFrontier', 'loadConstants'];
const missing = required.filter((name) => typeof mod[name] !== 'function');

if (missing.length > 0) {
  console.error(`[esm-smoke] FAIL: 缺少导出或非函数: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`[esm-smoke] PASS: ${distUrl}`);
console.log(`[esm-smoke] 导出可用: ${required.join(', ')}`);
