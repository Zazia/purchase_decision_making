#!/usr/bin/env node
/**
 * engine-smoke.mjs — apple-value-engine 可用性冒烟检查(纯 Node 零依赖)
 *
 * 用途: 技能工作流开始时(步骤0)运行,约 5 秒判定本次分析走引擎路径还是文字路径。
 * 检查内容:
 *   1. 引擎可加载(自动处理 dist 产物 CJS/"type":"module" 冲突,见 load-engine.mjs)
 *   2. loadConstants / computeParetoFrontier 导出存在
 *   3. constants.json 存在时,做一次真实微计算(单品类最小参数)端到端验证
 *
 * 输出 PASS(含引擎入口绝对路径)或 FAIL(含各候选路径的失败原因),退出码 0/1。
 *
 * FAIL 不是错误事件: 立即切换文字路径(SKILL.md 步骤 4-6 手动计算),
 * 禁止诊断引擎 / 读引擎源码 / 修引擎 —— 这是技能的信任边界(见 SKILL.md「引擎调用」)。
 *
 * 用法: node engine-smoke.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');

try {
  const { engine, path } = await loadEngine();

  // 导出校验
  const exportsOk =
    typeof engine.loadConstants === 'function' &&
    typeof engine.computeParetoFrontier === 'function';
  if (!exportsOk) {
    console.log(
      `[engine-smoke] FAIL — 引擎入口导出异常: loadConstants=${typeof engine.loadConstants}, computeParetoFrontier=${typeof engine.computeParetoFrontier}`,
    );
    process.exit(1);
  }

  console.log('[engine-smoke] PASS');
  console.log(`  引擎入口: ${path}`);
  console.log('  导出校验: loadConstants ✓  computeParetoFrontier ✓');

  // 端到端微计算(constants.json 已获取时)
  const cPath = join(SKILL_DIR, 'constants.json');
  if (existsSync(cPath)) {
    const constants = engine.loadConstants(readFileSync(cPath, 'utf-8'));
    const r = engine.computeParetoFrontier(constants, {
      category: 'Mac_mini',
      budget: 20000,
      holdingYears: [2, 3],
      buyTiming: 'used',
      performanceFloor: 0,
    });
    console.log(
      `  微计算: Mac_mini 候选 ${r.frontier.length + r.dominated.length} 个(前沿 ${r.frontier.length})✓`,
    );
  } else {
    console.log('  微计算: 跳过(constants.json 尚未获取,获取后可重跑本脚本复核)');
  }

  console.log('  下一步: 走引擎路径。计算脚本用 loadEngine() 加载(见 SKILL.md「引擎调用」),跳过步骤4-6手动计算');
  process.exit(0);
} catch (err) {
  console.log(`[engine-smoke] FAIL — ${err.message}`);
  console.log('  处理: 立即切换文字路径(SKILL.md 步骤4-6),报告中标注"本次走文字路径(引擎冒烟未通过)"。');
  console.log('  禁止: 诊断引擎 / 读源码 / 修引擎(信任边界见 SKILL.md「引擎调用」)。');
  process.exit(1);
}
