/**
 * load-engine.mjs — apple-value-engine 加载器(纯 Node 零依赖)
 *
 * 处理引擎 dist 产物的已知加载陷阱: tsc 编译为 CJS 语法,但包 package.json 声明
 * "type":"module" → 直接动态 import 报 "exports is not defined in ES module scope",
 * require() 报 ERR_REQUIRE_ESM(见排查日志 2026-08-27 P0)。
 *
 * 加载策略(不改引擎任何文件):
 *   1. 候选路径依次尝试(技能所在仓库 > 当前工作目录 > node_modules)
 *   2. 每个候选先按 ESM 动态 import(引擎未来改为 ESM 构建时直接可用)
 *   3. import 失败则用 CJS 兼容垫片执行(引擎零运行时依赖,仅需支持相对路径 require)
 *
 * 导出:
 *   await loadEngine() → { engine, path }  成功时返回引擎模块与入口绝对路径
 *   失败时抛错,错误信息含所有候选路径与失败原因
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');

// 候选引擎入口(按优先级): 技能所在仓库(本技能位于仓库 .agents/skills/ 下) > 当前工作目录 > node_modules
export function engineCandidates() {
  return [
    join(SKILL_DIR, '..', '..', '..', 'packages', 'apple-value-engine', 'dist', 'index.js'),
    resolve('packages', 'apple-value-engine', 'dist', 'index.js'),
    resolve('node_modules', 'apple-value-engine', 'dist', 'index.js'),
  ];
}

// CJS 兼容垫片: 用 Function 构造器在 CJS 语义下执行 dist 产物
// (仅支持相对路径 require——引擎零运行时依赖,外部依赖直接报错)
const cjsCache = new Map();
function loadCjs(file) {
  if (cjsCache.has(file)) return cjsCache.get(file);
  const mod = { exports: {} };
  cjsCache.set(file, mod.exports);
  const code = readFileSync(file, 'utf-8');
  const req = (id) => {
    if (!id.startsWith('.')) throw new Error(`引擎外部依赖不支持: ${id}`);
    return loadCjs(join(dirname(file), id));
  };
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(
    mod.exports, req, mod, file, dirname(file),
  );
  cjsCache.set(file, mod.exports);
  return mod.exports;
}

export async function loadEngine() {
  const tried = [];
  // 去重(不同候选可能解析到同一路径)
  for (const p of [...new Set(engineCandidates().map((x) => resolve(x)))]) {
    if (!existsSync(p)) {
      tried.push({ p, reason: '文件不存在' });
      continue;
    }
    // 策略1: 按 ESM 动态 import
    try {
      const mod = await import(pathToFileURL(p).href);
      return { engine: mod, path: p };
    } catch {
      // 策略2: CJS 兼容垫片
      try {
        const mod = loadCjs(p);
        return { engine: mod, path: p };
      } catch (err) {
        tried.push({ p, reason: `加载失败: ${err.message}` });
      }
    }
  }
  const detail = tried.map((t) => `  - ${t.p}\n      ${t.reason}`).join('\n');
  throw new Error(`引擎不可用(所有候选路径失败):\n${detail}`);
}
