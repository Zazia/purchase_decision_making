#!/usr/bin/env node
/**
 * release-constants.mjs — constants 一键发布流水线 (data-maintenance-automation)
 *
 * 编排: lint → curve-audit → publish → verify
 *   - lint:    结构校验 (无参数; lint 的位置参数是文件路径, 故不透传旗标)
 *   - publish: 云端发布 (透传 --dry-run / --env)
 *   - verify:  云端回读校验 (透传 --dry-run / --env; dry-run 下差异不阻断)
 *
 * 任一环节失败即中止并指明环节; 后续环节不执行 (lint 失败时不发起任何网络请求)。
 *
 * 用法: node scripts/release-constants.mjs [--dry-run] [--env <envId>]
 *   推荐: npm run constants:release [-- --dry-run]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const envFlagIdx = args.indexOf('--env');
const envId = envFlagIdx !== -1 && args[envFlagIdx + 1] ? args[envFlagIdx + 1] : null;
const passThrough = [
  ...(DRY_RUN ? ['--dry-run'] : []),
  ...(envId ? ['--env', envId] : []),
];

const stages = [
  { name: 'lint', script: 'lint-constants.mjs', pass: [] },
  { name: 'curve-audit', script: 'audit-curve-release.mjs', pass: [] },
  { name: 'publish', script: 'publish-constants.mjs', pass: passThrough },
  { name: 'verify', script: 'verify-cloud-constants.mjs', pass: passThrough },
];

console.log(`[release-constants] === constants 一键发布流水线 (${DRY_RUN ? 'DRY-RUN 干跑' : '正式发布'}) ===`);
console.log(`[release-constants] env: ${envId || '(默认)'}, 环节: ${stages.map((s) => s.name).join(' → ')}`);

const done = [];
for (const stage of stages) {
  const cmd = [join(SCRIPTS_DIR, stage.script), ...stage.pass];
  console.log(`\n[release-constants] ---- 环节 ${stage.name}: node ${cmd.map((p) => p.replace(/\\/g, '/')).join(' ')} ----`);
  const res = spawnSync(process.execPath, cmd, { stdio: 'inherit' });
  if (res.error) {
    console.error(`[release-constants] FAIL @ ${stage.name}: 无法启动 (${res.error.message})`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`\n[release-constants] FAIL @ ${stage.name} (exit ${res.status}) — 流水线中止, 后续环节 (${stages.slice(done.length + 1).map((s) => s.name).join(' → ') || '无'})未执行。`);
    process.exit(res.status ?? 1);
  }
  done.push(stage.name);
}

console.log(`\n[release-constants] === 流水线完成: ${done.join(' → ')} 全部通过 ===`);
if (DRY_RUN) {
  console.log('[release-constants] 干跑结束: 未发起任何写入请求。去掉 --dry-run 即正式发布。');
} else {
  console.log('[release-constants] 正式发布完成: 云端 constants.latest 已更新并通过回读校验。');
}
