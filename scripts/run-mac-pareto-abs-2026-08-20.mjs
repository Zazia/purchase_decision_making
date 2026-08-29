// 苹果电脑购买决策:绝对性能视角帕累托重算(纵轴 = 芯片多核跑分)
// 与相对满足度视角(2026-08-20 主报告)的区别:纵轴不再除以品类基准,全系同一把尺子。
// 用法: node scripts/run-mac-pareto-abs-2026-08-20.mjs
// 输入: scripts/debug/mac-pareto-2026-08-20.json(主报告计算结果,含分档修正后的 234 个候选点)
// 产物: scripts/debug/mac-pareto-abs-2026-08-20.json(不入库)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/debug/mac-pareto-2026-08-20.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));

const CATS = ['Mac_mini', 'MacBook_Air', 'MacBook_Pro'];

// ---------- 芯片跑分(全系同一张表) ----------
const macChips = C['芯片性能跑分']['Mac芯片'];
const chipScore = (name) => macChips[name]['多核'];
const chipGpu = (name) => macChips[name]['GPU_OpenCL'];

// ---------- 统一权重表(绝对视角) ----------
// 绝对视角下所有机器按同一张"通用场景"表取权重(Mac_基础:内存基准16GB/存储基准512GB),
// 不再按品类切换 Pro 表——否则又回到了"品类各自基准"的口径
const ramTable = { ...C['内存体验权重']['Mac_基础'] };
const stoTable = { ...C['存储体验权重']['Mac_基础'] };
const ramW = (gb) => {
  if (ramTable[`${gb}GB`] != null) return ramTable[`${gb}GB`];
  return gb >= 16 ? 1 : 0.65; // 高于基准的配置按 1.0(与表内 24GB→1 的语义一致)
};
const stoW = (gb) => {
  if (stoTable[`${gb}GB`] != null) return stoTable[`${gb}GB`];
  if (gb >= 1024) return stoTable['1TB'] ?? 1;
  return gb >= 512 ? 1 : 0.6;
};

// ---------- 机型键解析 ----------
// 形如 M4_16G_256G_新品 / M5Pro_14寸_24G_1024G_新品 / MacBook_Pro_下一代新品
function parseModel(modelWithYears) {
  const model = modelWithYears.split(' × ')[0];
  if (model.startsWith('MacBook_Pro_下一代')) {
    // 引擎口径:下代新品 S(0)=1.0(=当前旗舰水平,保守假设),配置按 Pro 档基准 32G/1T
    return { chip: 'M5_Pro', chipLabel: '下代(保守=当前旗舰)', ram: 32, sto: 1024, nextGen: true };
  }
  const m = model.match(/^(M\d+?(?:Pro|Max)?)_(?:(\d+)寸_)?(\d+)G_(\d+)G_(?:新品|二手)$/);
  if (!m) throw new Error(`无法解析机型键: ${model}`);
  const norm = m[1].replace(/(Pro|Max)$/, '_$1'); // M1Pro → M1_Pro
  return { chip: norm, chipLabel: norm.replace('_', ' '), ram: +m[3], sto: +m[4], nextGen: false };
}

// ---------- 展开全部候选点 ----------
const all = [];
for (const cat of CATS) {
  for (const p of [...R.categories[cat].frontier, ...R.categories[cat].dominated]) {
    const parsed = parseModel(p.model);
    const score = chipScore(parsed.chip);
    const gpu = chipGpu(parsed.chip);
    all.push({
      category: cat,
      model: p.model,
      chip: parsed.chip,
      chipLabel: parsed.chipLabel,
      nextGen: parsed.nextGen,
      ram: parsed.ram,
      sto: parsed.sto,
      buyTiming: p.buyTiming,
      candidateType: p.candidateType,
      waitMonths: p.waitMonths || 0,
      holdingYears: p.holdingYears,
      holdingMonths: p.holdingMonths,
      monthlyCost: p.monthlyCost,
      buyPrice: p.buyPrice,
      residual: p.residual,
      maintenanceCost: p.maintenanceCost,
      systemSupportRisk: p.systemSupportRisk,
      systemSupportExceedMonths: p.systemSupportExceedMonths || 0,
      chipScore: score,
      gpuScore: gpu,
      ramWeight: ramW(parsed.ram),
      stoWeight: stoW(parsed.sto),
      // 视角1:纯芯片多核跑分(静态绝对值,不随持有期衰减)
      absScore: score,
      // 视角2:等效跑分 = 跑分 × 统一内存权重 × 统一存储权重(体现配置瓶颈)
      eqScore: Math.round(score * ramW(parsed.ram) * stoW(parsed.sto)),
    });
  }
}

// ---------- 帕累托前沿(纵轴取 yKey,越大越好;横轴月均成本,越小越好) ----------
function frontierOf(points, yKey) {
  const sorted = points.slice().sort((a, b) => a.monthlyCost - b.monthlyCost || b[yKey] - a[yKey]);
  const front = [];
  let maxY = -Infinity;
  for (const p of sorted) {
    if (p[yKey] > maxY) { front.push(p); maxY = p[yKey]; }
  }
  const frontSet = new Set(front);
  const dominated = points.filter((p) => !frontSet.has(p));
  // 给每个被支配点找支配者(前沿中 月均≤且跑分≥ 的最便宜点)
  for (const p of dominated) {
    const doms = front.filter((q) => q.monthlyCost <= p.monthlyCost && q[yKey] >= p[yKey]);
    doms.sort((a, b) => a.monthlyCost - b.monthlyCost);
    p.dominatedBy = doms[0] ? doms[0].model : '';
  }
  for (const p of front) p.dominatedBy = '';
  return { frontier: front, dominated };
}

const view1 = frontierOf(all, 'absScore');
const view2 = frontierOf(all, 'eqScore');

// ---------- 输出 ----------
const out = {
  meta: {
    generatedAt: '2026-08-20',
    source: 'scripts/debug/mac-pareto-2026-08-20.json(相对满足度视角计算结果)',
    pointsTotal: all.length,
    yAxisView1: '芯片多核跑分(静态绝对值,不衰减)',
    yAxisView2: '等效跑分 = 多核跑分 × 内存权重 × 存储权重(统一 Mac_基础表:16GB/512GB 基准)',
    nextGenConvention: '下代 MacBook Pro 按引擎保守口径 = 当前旗舰 M5 Pro 水平(28500),实际下代芯片大概率更快',
    weightTables: { 内存: 'Mac_基础(8G:0.65/12G:0.8/16G+:1)', 存储: 'Mac_基础(128G:0.6/256G:0.85/512G+:1)' },
  },
  view1,
  view2,
};
fs.writeFileSync(path.join(ROOT, 'scripts/debug/mac-pareto-abs-2026-08-20.json'), JSON.stringify(out, null, 1), 'utf8');

// ---------- 控制台摘要 ----------
console.log(`候选点总数: ${all.length}`);
for (const [name, v] of [['视角1:纯多核跑分', view1], ['视角2:等效跑分(统一权重)', view2]]) {
  console.log(`\n===== ${name} · 前沿 ${v.frontier.length} 点 =====`);
  for (const p of v.frontier) {
    console.log(
      `  ${p.model} | 月均 ${p.monthlyCost.toFixed(0)} | 跑分 ${p.chipScore} | GPU ${p.gpuScore} | 等效 ${p.eqScore}${p.waitMonths ? ` | 等${p.waitMonths}月` : ''}${p.systemSupportRisk !== 'normal' ? ` | ⚠${p.systemSupportRisk}` : ''}`
    );
  }
}
console.log('\n结果已写入 scripts/debug/mac-pareto-abs-2026-08-20.json');
