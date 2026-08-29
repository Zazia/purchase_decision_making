// 苹果电脑购买决策分析:Mac mini / MacBook Air / MacBook Pro 跨品类帕累托前沿
// 用法: node scripts/run-mac-pareto-2026-08-20.mjs
// 产物: scripts/debug/mac-pareto-2026-08-20.json (不入库)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// 引擎 dist 为 CJS 语法但所在包声明 type:module,直接 require 会按 ESM 解析报错。
// 复制 dist 到带 {"type":"commonjs"} 声明的调试目录后加载(产物不入库)
const engineDir = path.join(ROOT, 'scripts/debug/engine-cjs');
fs.mkdirSync(engineDir, { recursive: true });
fs.writeFileSync(path.join(engineDir, 'package.json'), '{"type":"commonjs"}');
for (const f of fs.readdirSync(path.join(ROOT, 'packages/apple-value-engine/dist'))) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'packages/apple-value-engine/dist', f), path.join(engineDir, f));
}
const { loadConstants, computeParetoFrontier, recomputeFrontierFromPoints } = require(path.join(engineDir, 'index.js'));

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));

// ============================================================================
// 内存中数据修正(不回写 constants.json),依据与说明都会写入报告数据附注
// ============================================================================
// 修正1: MacBook Pro 14寸 M5 基础款/M5 Max 发布日期缺失。
//   依据 metadata.data_provenance_v3.8:"M5 2026-03 发布于 MacBook Air/Pro" +
//   Apple Newsroom 2026-03 (M5 Pro/Max MacBook Pro 介绍文)
raw['产品发布日期']['MacBook_Pro_14_M5'] = '2026-03';
raw['产品发布日期']['MacBook_Pro_14_M5Max'] = '2026-03';

// 修正2: 快照机型键缺配置标注/存储单位不兼容,按官方配置修正键名:
//   - Apple Newsroom 2026-03: M5 Pro 版 1TB 起步、M5 Max 版 2TB 起步、M5 14寸 1TB 起步
//   - MacRumors: M5 起步 16GB、M5 Pro 起步 24GB、M5 Max 起步 36GB
//   - ZOL: M5 Pro 14寸 24GB/1TB (涨价前 17999)
//   存储单位统一改为 G 计数(引擎 parseModelKey 仅识别 NG 段),1T=1024G、2T=2048G
function renameKeys(obj, mapping) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[mapping[k] ?? k] = v;
  return out;
}
raw['实时市场价快照']['MacBook_Pro'] = renameKeys(raw['实时市场价快照']['MacBook_Pro'], {
  'M5_14寸_16G_512G_新品_基础款': 'M5_14寸_16G_1024G_新品',
  'M5Pro_14寸_新品_升级款': 'M5Pro_14寸_24G_1024G_新品',
  'M5Max_14寸_新品_升级款': 'M5Max_14寸_36G_2048G_新品',
  'M5Pro_Max_16寸_新品': 'M5Pro_16寸_24G_1024G_新品',
});
raw['实时市场价快照']['Mac_mini'] = renameKeys(raw['实时市场价快照']['Mac_mini'], {
  'M4_16G_1T_新品': 'M4_16G_1024G_新品',
});

// 修正3: 存储体验权重表仅有 "1TB"/"2TB" 字符串键,引擎按数字查找时 1024/2048 会
//   错误落到 512GB 档权重。补充数字键(1TB+ 权重均为 1.0,与原表语义一致)
for (const table of [raw['存储体验权重']['Mac_基础'], raw['存储体验权重']['Mac_Pro']]) {
  table['1024GB'] = 1; table['2048GB'] = 1; table['4096GB'] = 1; table['8192GB'] = 1;
}

const constants = loadConstants(JSON.stringify(raw));

// ============================================================================
// 决策参数:用户未指定预算/持有期/场景 → 全价位、1-5年持有期、新品+二手、通用场景
// ============================================================================
const PARAMS = {
  budget: 40000,                 // 无预算约束,传高值不截断推荐区间(报告内自给三档参考)
  holdingYears: [1, 1.5, 2, 3, 4, 5],
  buyTiming: 'both',
  performanceFloor: 0.5,         // 仅作图上参考线
  considerWait: true,
  macroContext: {
    storageSuperCycleStage: 'ongoing',  // L1/L2 扫描:存储超级周期进行中(2026Q3 合约价续涨、涨幅收窄)
    hasGlobalPriceHike: true,           // 2026-06-25 苹果中国全线调价
    analysisMonth: '2026-08',
  },
};

const CATEGORIES = ['Mac_mini', 'MacBook_Air', 'MacBook_Pro'];
const result = { params: PARAMS, categories: {} };

for (const category of CATEGORIES) {
  let r;
  if (category === 'MacBook_Pro') {
    // MacBook Pro 含基础/M5Pro/M5Max 三个芯片档,快照约定残值分母分档(基础15999/Pro档19999)。
    // 引擎 getCurrentNewPrice 只取快照首个"新品"官方价作单一分母,会把 Pro 档残值低估 ~20%,
    // 且类型 B(等新品买新品)会用基础款价格配旗舰基准性能。故按档位拆两次计算再合并:
    //   基础档:M5 14寸新品(分母/类型B价=15999);类型B按SOP应为基准档新品,基础档的B点剔除后重算前沿
    //   Pro档 :M5Pro/M5Max/二手Pro机型(分母/类型B价=19999,与品类基准芯片M5Pro一致)
    const mbpFull = raw['实时市场价快照']['MacBook_Pro'];
    const baseTierKeys = ['M5_14寸_16G_1024G_新品'];
    const isProTier = (k) => !baseTierKeys.includes(k);

    const runTier = (keys, dropTypeB) => {
      const snap = { _说明: mbpFull._说明 };
      for (const k of keys) snap[k] = mbpFull[k];
      const c = loadConstants(JSON.stringify({ ...raw, 实时市场价快照: { ...raw['实时市场价快照'], MacBook_Pro: snap } }));
      const rr = computeParetoFrontier(c, { ...PARAMS, category: 'MacBook_Pro' });
      if (!dropTypeB) return rr;
      // 基础档类型B(同价基础款配 S(0)=1.0)口径失真,剔除后用其余方案重算前沿
      const pts = [...rr.frontier, ...rr.dominated]
        .filter((p) => p.candidateType !== 'B')
        .map((p) => ({ ...p, source: 'original' }));
      return recomputeFrontierFromPoints(c, { ...PARAMS, category: 'MacBook_Pro' }, pts);
    };

    const baseRun = runTier(['_说明', ...baseTierKeys], true);
    const proRun = runTier(Object.keys(mbpFull).filter(isProTier), false);

    // 两档合并 → MacBook Pro 品类前沿
    const merged = [...baseRun.frontier, ...baseRun.dominated, ...proRun.frontier, ...proRun.dominated]
      .map((p) => ({ ...p, source: 'original' }));
    const mergedRes = recomputeFrontierFromPoints(constants, { ...PARAMS, category: 'MacBook_Pro' }, merged);
    result.categories[category] = {
      frontier: mergedRes.frontier,
      dominated: mergedRes.dominated,
      recommendationRange: mergedRes.recommendationRange,
    };
    r = { frontier: mergedRes.frontier, dominated: mergedRes.dominated };
  } else {
    r = computeParetoFrontier(constants, { ...PARAMS, category });
    result.categories[category] = {
      frontier: r.frontier,
      dominated: r.dominated,
      recommendationRange: r.recommendationRange,
    };
  }
  console.log(`\n===== ${category} =====`);
  console.log(`候选方案 ${r.frontier.length + r.dominated.length} 个,前沿 ${r.frontier.length} 个`);
  for (const p of r.frontier) {
    console.log(
      `  [前沿] ${p.model} | ${p.candidateType} | 月均 ${p.monthlyCost.toFixed(0)} 元 | 性能 ${(p.avgPerformance * 100).toFixed(0)}% | 买入 ${p.buyPrice} | 残值 ${p.residual.toFixed(0)} | 维修 ${p.maintenanceCost.toFixed(0)}${p.waitMonths ? ` | 等${p.waitMonths}月` : ''}${p.systemSupportRisk !== 'normal' ? ` | ⚠${p.systemSupportRisk}` : ''}`
    );
  }
}

// ============================================================================
// 跨品类帕累托前沿:各品类前沿方案合并后再筛一次(SOP 9.1)
// ============================================================================
const allFrontierPoints = CATEGORIES.flatMap((c) =>
  result.categories[c].frontier.map((p) => ({ ...p, source: 'original' }))
);
const cross = recomputeFrontierFromPoints(constants, { ...PARAMS, category: 'Mac_mini' }, allFrontierPoints);
result.crossCategory = { frontier: cross.frontier, dominated: cross.dominated };

console.log(`\n===== 跨品类前沿 =====`);
for (const p of cross.frontier) {
  console.log(
    `  [前沿] ${p.model} | 月均 ${p.monthlyCost.toFixed(0)} 元 | 性能 ${(p.avgPerformance * 100).toFixed(0)}%`
  );
}

const outDir = path.join(ROOT, 'scripts/debug');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'mac-pareto-2026-08-20.json'), JSON.stringify(result, null, 1), 'utf8');
console.log(`\n结果已写入 scripts/debug/mac-pareto-2026-08-20.json`);
