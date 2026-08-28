#!/usr/bin/env node
/**
 * query-constants.mjs — constants.json 机器寻址查询工具(纯 Node 零依赖)
 *
 * 解决的问题: constants.json 为 1900+ 行中文键单文件,整读浪费上下文;
 * rg/grep 在 PowerShell 下搜中文键有引号坑。本脚本按键路径精确取值。
 *
 * 用法(技能目录 = SKILL.md 所在目录):
 *   node scripts/query-constants.mjs                          # 列出顶层键
 *   node scripts/query-constants.mjs --list <键路径>           # 列出该路径下的子键
 *   node scripts/query-constants.mjs --search <关键词>         # 搜索含关键词的键路径
 *   node scripts/query-constants.mjs <键路径>                  # 取该路径的值(JSON)
 *
 * 键路径用 . 分隔,自动适配含点号的键名(最长键名优先匹配),数组用数字下标:
 *   node scripts/query-constants.mjs 芯片性能跑分.Mac芯片.M2
 *   node scripts/query-constants.mjs 苹果产品发布节奏._发布时间预测校验_v3.8
 *   node scripts/query-constants.mjs metadata.v3.8_变更摘要.0
 *
 * constants.json 定位: 脚本所在目录的上一级(技能目录)。找不到则报错退出。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const C_PATH = join(__dirname, '..', 'constants.json');

if (!existsSync(C_PATH)) {
  console.error(`[query-constants] constants.json 未找到: ${C_PATH}`);
  console.error('  请先按 SKILL.md「获取与更新机制」获取后重试。');
  process.exit(1);
}
const data = JSON.parse(readFileSync(C_PATH, 'utf-8'));

// ---- 键路径解析(最长键名优先,兼容含点号的键;数组用数字下标) ----
function resolvePath(root, pathStr) {
  let node = root;
  let rest = String(pathStr).trim();
  const segments = [];
  while (rest !== '') {
    if (Array.isArray(node)) {
      const m = /^(\d+)(?:\.|$)/.exec(rest);
      if (!m) return { err: `此处是数组,期望数字下标,得到 "${rest}"` };
      const i = Number(m[1]);
      if (i >= node.length) return { err: `数组下标越界: ${i}(长度 ${node.length})` };
      segments.push(m[1]);
      node = node[i];
      rest = rest.length === m[1].length ? '' : rest.slice(m[1].length + 1);
      continue;
    }
    if (typeof node !== 'object' || node === null) {
      return { err: `"${segments.join('.')}" 已是叶子(${typeof node}),无法继续下钻 "${rest}"` };
    }
    const keys = Object.keys(node).filter((k) => rest === k || rest.startsWith(k + '.'));
    if (keys.length === 0) {
      return {
        err: `键不存在: "${rest}"。可用 --search <关键词> 查找,或 --list ${segments.join('.')} 查看子键`,
      };
    }
    keys.sort((a, b) => b.length - a.length); // 最长键名优先(兼容含点号的键,如 _发布时间预测校验_v3.8)
    const k = keys[0];
    segments.push(k);
    node = node[k];
    rest = rest === k ? '' : rest.slice(k.length + 1);
  }
  return { node, segments };
}

// ---- 输出 ----
const MAX_OUT = 3000; // 超长截断,防止整段灌入上下文
function printValue(v, path) {
  const json = JSON.stringify(v, null, 2) ?? String(v);
  if (json.length <= MAX_OUT) {
    console.log(json);
    return;
  }
  console.log(json.slice(0, MAX_OUT));
  console.log(`…(已截断,全文 ${json.length} 字符)请下钻更深的键路径,或 --list ${path}`);
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `数组[${v.length}]`;
  if (typeof v === 'object') return `对象{${Object.keys(v).length}键}`;
  const s = JSON.stringify(v);
  return typeof v + ': ' + (s.length > 60 ? s.slice(0, 60) + '…' : s);
}

// ---- 主逻辑 ----
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`# constants.json 顶层键(${C_PATH})`);
  for (const [k, v] of Object.entries(data)) console.log(`  ${k}  —  ${describe(v)}`);
  console.log('\n用法: node query-constants.mjs <键路径> | --list <键路径> | --search <关键词>');
  process.exit(0);
}

const cmd = args[0];
if (cmd === '--search') {
  const kw = args[1];
  if (!kw) {
    console.error('用法: --search <关键词>');
    process.exit(1);
  }
  const hits = [];
  (function walk(node, prefix) {
    if (typeof node !== 'object' || node === null) return;
    for (const [k, v] of Object.entries(node)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (k.toLowerCase().includes(kw.toLowerCase())) hits.push({ p, v });
      if (hits.length < 200) walk(v, p);
    }
  })(data, '');
  if (hits.length === 0) {
    console.log(`无匹配键: "${kw}"`);
    process.exit(1);
  }
  console.log(`匹配 ${hits.length} 个键:`);
  for (const { p, v } of hits.slice(0, 30)) console.log(`  ${p}  —  ${describe(v)}`);
  if (hits.length > 30) console.log(`  …另有 ${hits.length - 30} 个,请用更精确的关键词`);
  process.exit(0);
}

// --list <路径> 列子键;<路径> 取值
const pathArg = cmd === '--list' ? (args[1] ?? '') : args.join('.');
const r = resolvePath(data, pathArg);
if (r.err) {
  console.error(`[query-constants] ${r.err}`);
  process.exit(1);
}
if (cmd === '--list') {
  if (typeof r.node !== 'object' || r.node === null) {
    console.log(`${pathArg} 是叶子: ${JSON.stringify(r.node)}`);
    process.exit(0);
  }
  console.log(`# ${pathArg || '(根)'} 的子键:`);
  for (const [k, v] of Object.entries(r.node)) console.log(`  ${k}  —  ${describe(v)}`);
  process.exit(0);
}
printValue(r.node, r.segments.join('.'));
