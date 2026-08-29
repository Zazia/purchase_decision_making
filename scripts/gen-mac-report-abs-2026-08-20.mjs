// 生成 2026-08-20 苹果电脑购买决策报告·绝对性能视角(结论先行 HTML)
// 用法: node scripts/gen-mac-report-abs-2026-08-20.mjs
// 输入: scripts/debug/mac-pareto-abs-2026-08-20.json + scripts/debug/mac-pareto-2026-08-20.json + constants.json
// 产物: test-results/2026-08-20-苹果电脑购买决策报告-绝对性能视角.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const A = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/debug/mac-pareto-abs-2026-08-20.json'), 'utf8'));
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/debug/mac-pareto-2026-08-20.json'), 'utf8'));

const CAT_LABEL = { Mac_mini: 'Mac mini', MacBook_Air: 'MacBook Air', MacBook_Pro: 'MacBook Pro' };
const TIMING_LABEL = { new: '新品', used: '二手' };
const TYPE_LABEL = { A: '现在买', B: '等新品·买新品', C: '等新品·买降价老款' };

function prettyModel(m) {
  if (m.startsWith('MacBook_Pro_下一代')) return '下代 MacBook Pro(预测)';
  const parts = m.split(' × ')[0].split('_');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^\d+G$/.test(parts[i]) && out.length && /^\d+G$/.test(parts[i - 1])) out[out.length - 1] += '/' + parts[i];
    else out.push(parts[i]);
  }
  return out.join(' ') + (m.includes(' × ') ? ' ×' + m.split(' × ')[1] : '');
}
const f0 = (x) => (x == null ? '—' : Math.round(x).toLocaleString('zh-CN'));
const pct = (x) => Math.round(x * 100) + '%';
const waitBadge = (p) => (p.waitMonths ? `<span class="badge badge-warning">等${p.waitMonths}月·预测价</span>` : '');
const riskBadge = (p) => {
  if (p.systemSupportRisk === 'exceeded') return `<span class="badge badge-warning" title="持有期内超出 macOS 支持周期 ${p.systemSupportExceedMonths} 个月">支持超期${p.systemSupportExceedMonths}月</span>`;
  if (p.systemSupportRisk === 'near-end') return '<span class="badge badge-warning" title="持有期末接近支持周期尽头">临近到期</span>';
  return '';
};

// 相对视角状态查询表(model → 前沿与否 + 满足度)
const relIndex = new Map();
for (const cat of Object.keys(R.categories)) {
  for (const p of R.categories[cat].frontier) relIndex.set(p.model, { onFrontier: true, avgPerformance: p.avgPerformance });
  for (const p of R.categories[cat].dominated) if (!relIndex.has(p.model)) relIndex.set(p.model, { onFrontier: false, avgPerformance: p.avgPerformance });
}

const v1FrontSet = new Set(A.view1.frontier.map((p) => p.model));
const v2FrontSet = new Set(A.view2.frontier.map((p) => p.model));

// ---------- 图表数据 ----------
function chartPt(p) {
  return {
    n: prettyModel(p.model), cat: p.category,
    v: [+p.monthlyCost.toFixed(1), p.chipScore],
    eq: p.eqScore, gpu: p.gpuScore, net: Math.round(p.buyPrice + p.maintenanceCost - p.residual),
    w: p.waitMonths || 0, key: false,
  };
}
const KEY1 = new Set(['M2_8G_256G_二手 × 1年', 'M4_16G_256G_新品 × 5年', 'M3Pro_14寸_16G_512G_二手 × 5年', 'M5_13寸_16G_512G_新品 × 5年', 'M5Pro_14寸_24G_1024G_新品 × 5年', 'M5Max_14寸_36G_2048G_新品 × 5年']);
const KEY2 = new Set([...KEY1, 'M1_16G_256G_二手 × 5年', 'M2_16G_256G_二手 × 5年', 'M2Pro_14寸_16G_512G_二手 × 1年']);
const chart1Front = A.view1.frontier.map((p) => ({ ...chartPt(p), key: KEY1.has(p.model) }));
const chart2Front = A.view2.frontier.map((p) => ({ ...chartPt(p), key: KEY2.has(p.model) }));
const chart1Dom = A.view1.dominated.map((p) => [+p.monthlyCost.toFixed(1), p.chipScore]);
const chart2Dom = A.view2.dominated.map((p) => [+p.monthlyCost.toFixed(1), p.eqScore]);

// 每元跑分(视角1前沿的"性价比斜率")
const perYuan = A.view1.frontier.map((p) => ({ ...p, ratio: p.chipScore / p.monthlyCost })).sort((a, b) => b.ratio - a.ratio);

// ---------- 视角对比表(同一方案在两种视角下的命运) ----------
const compareModels = [
  'M4_16G_256G_新品 × 5年',
  'M4_16G_512G_新品 × 5年',
  'M5_13寸_16G_512G_新品 × 4年',
  'M5_13寸_16G_512G_新品 × 1年',
  'M1Pro_14寸_16G_512G_二手 × 2年',
  'M3Pro_14寸_16G_512G_二手 × 5年',
  'M5Pro_14寸_24G_1024G_新品 × 4年',
  'M5Max_14寸_36G_2048G_新品 × 5年',
  'MacBook_Pro_下一代新品 × 4年',
  'M2Pro_14寸_16G_512G_二手 × 1年',
];
const absIndex = new Map();
for (const p of [...A.view1.frontier, ...A.view1.dominated]) absIndex.set(p.model, p);
const compareRows = compareModels.map((m) => {
  const a = absIndex.get(m); const r = relIndex.get(m);
  if (!a || !r) return '';
  const v1 = v1FrontSet.has(m) ? '<span class="badge badge-default" style="background:var(--accent-soft);color:var(--accent)">前沿</span>' : '<span class="badge badge-default">被支配</span>';
  const v2 = v2FrontSet.has(m) ? '<span class="badge badge-default" style="background:var(--accent-soft);color:var(--accent)">前沿</span>' : '<span class="badge badge-default">被支配</span>';
  const rel = r.onFrontier ? '<span class="badge badge-default" style="background:var(--accent-soft);color:var(--accent)">前沿</span>' : '<span class="badge badge-default">被支配</span>';
  return `<tr>
<td>${prettyModel(m)}</td><td class="num">${f0(a.monthlyCost)}</td>
<td>${rel}<span class="sub-num">${pct(r.avgPerformance)}</span></td>
<td>${v1}<span class="sub-num">${f0(a.chipScore)}分</span></td>
<td>${v2}<span class="sub-num">${f0(a.eqScore)}分</span></td></tr>`;
}).join('');

// ---------- 完整候选表 ----------
function fullRow(p) {
  const v1 = v1FrontSet.has(p.model);
  const v2 = v2FrontSet.has(p.model);
  const rel = relIndex.get(p.model);
  return `<tr${v1 ? ' style="background:var(--accent-soft)"' : ''}>
<td>${CAT_LABEL[p.category]}</td>
<td>${prettyModel(p.model)}</td>
<td>${p.chipLabel}</td>
<td class="num">${f0(p.chipScore)}</td>
<td class="num">${f0(p.gpuScore)}</td>
<td class="num">${f0(p.eqScore)}</td>
<td class="num"><b>${f0(p.monthlyCost)}</b></td>
<td class="num">${rel ? pct(rel.avgPerformance) : '—'}</td>
<td>${v1 ? '<span class="badge badge-default" style="background:var(--accent-soft);color:var(--accent)">v1前沿</span>' : ''}${v2 && !v1 ? '<span class="badge badge-default" style="background:var(--accent-soft);color:var(--accent)">v2前沿</span>' : ''}${!v1 && !v2 ? '<span class="badge badge-default">被支配</span>' : ''}</td>
<td>${p.dominatedBy ? '被「' + prettyModel(p.dominatedBy) + '」支配' : '—'}</td></tr>`;
}
function fullTable(cat) {
  const pts = [...A.view1.frontier, ...A.view1.dominated].filter((p) => p.category === cat)
    .sort((a, b) => a.monthlyCost - b.monthlyCost);
  return `<table class="report-table"><thead><tr>
<th>品类</th><th>方案</th><th>芯片</th><th>多核</th><th>GPU</th><th>等效跑分</th><th>月均</th><th>相对满足度</th><th>状态</th><th>剔除原因(v1口径)</th>
</tr></thead><tbody>${pts.map(fullRow).join('')}</tbody></table>`;
}

// ---------- 推荐场景卡(全部取自计算结果) ----------
const IDX = new Map([...A.view1.frontier, ...A.view1.dominated].map((p) => [p.model, p]));
const IDX2 = new Map([...A.view2.frontier, ...A.view2.dominated].map((p) => [p.model, p]));
const scenarios = [
  {
    tag: '每元算力之王', pick: IDX.get('M4_16G_256G_新品 × 5年'),
    reason: `多核 15000 分只要 ${f0(IDX.get('M4_16G_256G_新品 × 5年').monthlyCost)} 元/月,每元月均买到 ${Math.round(perYuan[0].ratio)} 分(全场最高档)。绝对视角与相对视角的双料共识方案。`,
  },
  {
    tag: '多核算力甜点', pick: IDX.get('M3Pro_14寸_16G_512G_二手 × 5年'),
    reason: 'M3 Pro 多核 16000,等 4 个月后二手降价入手,是 15000→17100 分之间唯一的前沿踏脚石。⚠ 持有 5 年将超出 macOS 支持周期,建议按 2-3 年换手规划。',
  },
  {
    tag: '便携 + 高分芯片', pick: IDX.get('M5_13寸_16G_512G_新品 × 5年'),
    reason: '17100 分是 M5 标准芯片的天花板,也是绝对前沿上唯一"自带屏幕键盘电池"的方案——mini 同分更便宜,但形态溢价在跑分轴上不可见(见口径说明)。',
  },
  {
    tag: '多核算力主力', pick: IDX.get('M5Pro_14寸_24G_1024G_新品 × 5年'),
    reason: '28500 分,等 4 个月后新品渠道降价至预测 14299 元入手。绝对视角下 Pro 芯片重新证明自己:同样的月均,相对视角给 59% 满足度,绝对视角给全场第二高的跑分。',
  },
  {
    tag: 'GPU 极限需求', pick: IDX.get('M5Max_14寸_36G_2048G_新品 × 5年'),
    reason: '多核仅比 M5Pro 多 800 分(+3%),但 GPU 165000 分是 M5Pro 的 2.2 倍。纯 CPU 视角下它"不值",视频剪辑/本地大模型用户看的是 GPU 列——这张卡的算力没有替代品。',
  },
  {
    tag: '最便宜入场', pick: IDX.get('M2_8G_256G_二手 × 1年'),
    reason: '33 元/月拿到 9700 分,一年净支出仅约 400 元。⚠ 8G 内存是硬瓶颈(等效跑分仅 5359),只适合过渡或轻度单任务场景。',
  },
];

const budgetTiers = [
  { range: '月均 ≤60 元', plans: ['M2_8G_256G_二手 × 1年', 'M1_16G_256G_二手 × 5年', 'M2_16G_256G_二手 × 5年'], view: 2, note: '视角2(等效跑分)下的低端前沿全部由 mini 二手包揽;16G 版比 8G 版多 21 元/月换 2900 等效分' },
  { range: '月均 60–130 元', plans: ['M4_16G_256G_新品 × 5年', 'M2Pro_14寸_16G_512G_二手 × 1年'], view: 2, note: 'M4 mini 新品是双视角共识;等 4 个月后的 M2Pro 二手(15000 等效分/88 元)是视角2独有的甜点' },
  { range: '月均 130 元以上', plans: ['M5_13寸_16G_512G_新品 × 5年', 'M5Pro_14寸_24G_1024G_新品 × 5年', 'M5Max_14寸_36G_2048G_新品 × 5年'], view: 1, note: '17100 / 28500 / 29300 三档;后两者均为等 4 个月的预测价方案' },
];
const budgetHTML = budgetTiers.map((t) => {
  const idx = t.view === 2 ? IDX2 : IDX;
  return `<tr><td><b>${t.range}</b></td><td>${t.plans.map((m) => {
    const p = idx.get(m); return `${prettyModel(m)}(${f0(p.monthlyCost)}元/月,${t.view === 2 ? '等效' : ''}${f0(t.view === 2 ? p.eqScore : p.chipScore)}分)`;
  }).join('<br>')}</td><td>${t.note}</td></tr>`;
}).join('');

const scenCardHTML = scenarios.map((s) => `
<article class="card scen">
  <div class="scen-head"><span class="badge badge-default tag">${s.tag}</span>
    <span class="scen-model">${prettyModel(s.pick.model)}</span></div>
  <div class="scen-nums">
    <div><span class="k">月均成本</span><span class="v">${f0(s.pick.monthlyCost)}<i>元/月</i></span></div>
    <div><span class="k">多核跑分</span><span class="v">${f0(s.pick.chipScore)}</span></div>
    <div><span class="k">GPU 跑分</span><span class="v">${f0(s.pick.gpuScore)}</span></div>
  </div>
  <p class="scen-reason">${s.reason}</p>
  <p class="scen-conf">价格口径与主报告一致(国补实付/闲鱼挂单价/等待方案预测价)。${s.pick.waitMonths ? `⚠ 等待方案:需等约 ${s.pick.waitMonths} 个月,买入价为预测值。` : ''}${s.pick.systemSupportRisk !== 'normal' ? `⚠ ${s.pick.systemSupportRisk === 'exceeded' ? '系统支持超期' : '临近支持到期'}。` : ''}</p>
</article>`).join('');

const chartDataJSON = JSON.stringify({
  v1: { front: chart1Front, dom: chart1Dom },
  v2: { front: chart2Front, dom: chart2Dom },
});

const v1FrontRows = A.view1.frontier.map((p) => `<tr>
<td>${CAT_LABEL[p.category]}</td><td>${prettyModel(p.model)}</td><td>${p.chipLabel}</td>
<td class="num"><b>${f0(p.chipScore)}</b></td><td class="num">${f0(p.gpuScore)}</td>
<td class="num"><b>${f0(p.monthlyCost)}</b></td><td class="num">${f0(Math.round(p.chipScore / p.monthlyCost))}</td>
<td>${waitBadge(p)} ${riskBadge(p)}</td></tr>`).join('');

const v2FrontRows = A.view2.frontier.map((p) => `<tr>
<td>${CAT_LABEL[p.category]}</td><td>${prettyModel(p.model)}</td>
<td class="num"><b>${f0(p.eqScore)}</b></td><td class="num">${f0(p.chipScore)}</td>
<td class="num"><b>${f0(p.monthlyCost)}</b></td>
<td>${waitBadge(p)} ${riskBadge(p)}</td></tr>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>苹果电脑购买决策报告 · 绝对性能视角 · 2026-08-20</title>
<style>
:root {
  /* 中性色(9阶)*/
  --bg: #F5F5F7; --surface: #FFFFFF; --rule: #D2D2D8;
  --muted: #86868F; --fg: #1D1D1F;
  /* 品牌蓝(单一主蓝,承担所有"行动指向")*/
  --accent: #007AFF; --accent-hover: #0063D4; --accent-soft: #E6F2FF;
  /* 语义色(仅进徽章,不大面积填充)*/
  --success: #2A8A61; --success-soft: #D9F0E3;
  --warning: #E09500; --warning-soft: #FFF0C2;
  --error: #F24B4B; --error-soft: #FFD9D9;
  --font-display: 'DM Sans', -apple-system, 'SF Pro Display', 'PingFang SC', sans-serif;
  --font-body: 'Inter', -apple-system, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 16px; line-height: 1.65; }
.page { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; display: flex; flex-direction: column; gap: 20px; }
h1 { font-family: var(--font-display); font-size: 32px; font-weight: 600; letter-spacing: -0.02em; }
h2 { font-family: var(--font-display); font-size: 24px; font-weight: 600; margin-bottom: 4px; }
h3 { font-family: var(--font-display); font-size: 20px; font-weight: 600; }
.sub { color: var(--muted); font-size: 14px; }
section { display: flex; flex-direction: column; gap: 14px; }
.card { background: var(--surface); border-radius: 20px; box-shadow: 0 1px 2px rgba(29,29,31,0.06), 0 1px 1px rgba(29,29,31,0.04); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.card:hover { filter: brightness(0.985); }
.meta-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { background: var(--surface); border: 1px solid var(--rule); border-radius: 9999px; padding: 4px 12px; font-size: 12px; color: var(--muted); }
.hero { border-left: 4px solid var(--accent); }
.hero ul { padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.hero li b { color: var(--accent); }
.punchline { font-family: var(--font-display); font-size: 20px; font-weight: 600; line-height: 1.5; }
.punchline b { color: var(--accent); }
.scen-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.scen { gap: 8px; }
.scen-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tag { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.scen-model { font-family: var(--font-display); font-weight: 600; font-size: 17px; }
.scen-nums { display: flex; gap: 24px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.scen-nums .k { display: block; font-size: 12px; color: var(--muted); }
.scen-nums .v { font-family: var(--font-display); font-size: 26px; font-weight: 600; }
.scen-nums .v i { font-style: normal; font-size: 12px; color: var(--muted); margin-left: 2px; }
.scen-reason { font-size: 14px; }
.scen-conf { font-size: 12px; color: var(--muted); }
.report-table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--surface); border: 1px solid var(--rule); border-radius: 16px; overflow: hidden; font-size: 14px; }
.report-table th, .report-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--rule); }
.report-table thead th { color: var(--muted); font-size: 12px; font-weight: 600; white-space: nowrap; }
.report-table tbody tr:last-child td { border-bottom: none; }
.report-table tbody tr:hover { filter: brightness(0.97); }
.report-table .num { font-family: var(--font-mono); font-size: 13px; text-align: right; white-space: nowrap; }
.sub-num { display: block; font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
.table-scroll { overflow-x: auto; border-radius: 16px; }
.badge { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 9999px; font-size: 12px; font-weight: 400; line-height: 1; white-space: nowrap; }
.badge-default { background: var(--bg); color: var(--muted); }
.badge-warning { background: var(--warning-soft); color: var(--warning); }
.note { font-size: 13px; color: var(--muted); }
.chart { width: 100%; height: 430px; }
.chart-sm { width: 100%; height: 330px; }
.callout { border-left: 4px solid var(--warning); background: var(--surface); border-radius: 12px; padding: 14px 16px; font-size: 14px; display: flex; flex-direction: column; gap: 6px; }
.callout.blue { border-left-color: var(--accent); }
.callout b { display: block; }
ul.plain { padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
details { background: var(--surface); border: 1px solid var(--rule); border-radius: 16px; padding: 12px 16px; }
details summary { cursor: pointer; font-weight: 600; font-size: 14px; color: var(--accent); }
details[open] summary { margin-bottom: 12px; }
footer { text-align: center; color: var(--muted); font-size: 12px; padding-top: 12px; }
@media (max-width: 720px) { .chart { height: 360px; } .chart-sm { height: 360px; } h1 { font-size: 26px; } }
</style>
</head>
<body>
<div class="page">

<header>
  <h1>苹果电脑购买决策报告 · 绝对性能视角</h1>
  <p class="sub">纵轴 = 芯片多核跑分(全系同一把尺子) | 分析日期 2026-08-20 | 主报告(相对满足度视角)的姊妹篇</p>
  <div class="meta-chips">
    <span class="chip">候选 234 个 · 复用主报告月均成本</span>
    <span class="chip">视角1:纯多核跑分 · 前沿 6 点</span>
    <span class="chip">视角2:等效跑分(统一权重) · 前沿 9 点</span>
    <span class="chip">常量库 v3.9(2026-08-10)</span>
  </div>
</header>

<!-- ============ 结论 ============ -->
<section class="card hero">
  <h3>核心结论</h3>
  <p class="punchline">换成绝对跑分这把尺子后,<b>MacBook Pro 的 Pro 芯片重新进入前沿</b>(M3Pro 二手/M5Pro/M5Max 三档上榜);但 <b>15000 分以下依然是 Mac mini 的天下</b>——M4 mini 新品 ×5 年(72 元/月)是双视角共识的性价比之王。相对视角的明星方案 <b>M5 Air ×1年 在绝对视角下被 M5Pro 支配</b>(234 元/月买 28500 分 vs 258 元/月买 17100 分)。</p>
  <ul>
    <li><b>前沿大幅变稀:</b>相对视角 17 个前沿点 → 绝对视角 6 个。原因是跑分不随持有期衰减——同一配置只有"月均成本最低的持有期"能活下来,其余全部被自家兄弟支配。</li>
    <li><b>Pro 芯片翻身的代价:</b>M5Pro(28500 分/234 元)与 M5Max(29300 分/403 元)上榜,但两者多核只差 3%——M5Max 贵的 169 元/月买的是 <b>GPU(165000 分,是 M5Pro 的 2.2 倍)</b>,多核跑分轴上看不见这笔钱。</li>
    <li><b>mini 统治中低端:</b>9700 分(33 元)与 15000 分(72 元)两档全部由 mini 拿下;M1Pro 二手(12000 分/85 元)被 M4 mini 直接支配——更便宜还快 3000 分。</li>
    <li><b>基础款 MacBook Pro 全军覆没:</b>M5 14寸基础款与 M5 Air 同芯片(17100)但更贵,绝对视角下被 Air 支配;下代 MBP 按引擎保守口径(=当前旗舰 28500)也被 M5Pro 支配(见口径说明第4条)。</li>
  </ul>
</section>

<!-- ============ 一、推荐 ============ -->
<section>
  <h2>一、绝对视角前沿(结论先行)</h2>

  <div class="card">
    <h3>视角1:纯多核跑分 · 帕累托前沿(6 个非劣解)</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>品类</th><th>方案</th><th>芯片</th><th>多核跑分</th><th>GPU 跑分</th><th>月均成本</th><th>每元跑分</th><th>提示</th></tr></thead>
      <tbody>${v1FrontRows}</tbody>
    </table></div>
    <p class="note">每元跑分 = 多核跑分 ÷ 月均成本,衡量"算力性价比斜率"。注意前沿上 6 点中 4 点为等 4 个月的预测价方案(下代 MBP 2026-10 发布后降价)。</p>
  </div>

  <div class="scen-grid">${scenCardHTML}</div>

  <div class="card">
    <h3>视角2:等效跑分(统一权重) · 帕累托前沿(9 个非劣解)</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>品类</th><th>方案</th><th>等效跑分</th><th>原始跑分</th><th>月均成本</th><th>提示</th></tr></thead>
      <tbody>${v2FrontRows}</tbody>
    </table></div>
    <p class="note">等效跑分 = 多核跑分 × 内存权重 × 存储权重,统一按 Mac_基础表(16GB/512GB 基准)取权重——它惩罚 8G 内存(×0.65)和 256G 存储(×0.85)的配置瓶颈,回答"实际能发挥出来的算力"。比视角1多出 3 个点:M1/M2 mini 16G 二手(内存补齐后重新有效)与等 4 月的 M2Pro 16G/512G 二手(88 元拿到满权重的 15000 分)。</p>
  </div>

  <div class="card">
    <h3>预算速查(按月均成本三档)</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>预算</th><th>该档最优方案</th><th>说明</th></tr></thead>
      <tbody>${budgetHTML}</tbody>
    </table></div>
  </div>
</section>

<!-- ============ 二、图表 ============ -->
<section>
  <h2>二、核心图表</h2>
  <div class="card">
    <h3>2.1 帕累托前沿 · 纵轴 = 多核跑分(核心图)</h3>
    <div id="c1" class="chart"></div>
    <p class="note">蓝点 = 视角1前沿(mini 圆形/Air 菱形/Pro 三角);灰色小点 = 234 个候选中被支配的方案。悬浮查看 GPU 跑分与净支出。与主报告的差别:纵轴不再是"品类内满足度%",而是全系同一把跑分尺子。</p>
  </div>
  <div class="card">
    <h3>2.2 帕累托前沿 · 纵轴 = 等效跑分(统一权重)</h3>
    <div id="c2" class="chart"></div>
    <p class="note">存储/内存瓶颈被计入后,低端前沿变密(16G 二手 mini 复活),高端不变。注意 ≥16GB 的内存差异在此视角不敏感(权重均为 1.0)——重度多任务请回看内存列,不要依赖等效跑分。</p>
  </div>
</section>

<!-- ============ 三、视角对比 ============ -->
<section>
  <h2>三、同一方案在两种视角下的命运对比</h2>
  <div class="card">
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>方案</th><th>月均</th><th>相对视角(主报告)</th><th>视角1 纯跑分</th><th>视角2 等效跑分</th></tr></thead>
      <tbody>${compareRows}</tbody>
    </table></div>
    <ul class="plain">
      <li><b>双料前沿:</b>M4 mini ×5年、M5Pro ×5年——无论怎么量都成立,可信度最高。</li>
      <li><b>相对视角独有:</b>M5 Air ×1年/×4年、M4 mini 512G——它们的价值在"形态、存储、发布时机"上,跑分轴看不见;便携刚需与大存储用户仍应按主报告执行。</li>
      <li><b>绝对视角独有:</b>M3Pro/M5Pro/M5Max 二手与新品、M2Pro 16G 二手——为算力付钱的方案,只在算力尺子下成立。</li>
      <li><b>两头都不靠:</b>M1Pro 二手——相对视角满足度仅 20%(Pro 基准太高),绝对视角又被更便宜的 M4 mini 支配。本快照下最不推荐的 Pro 系方案。</li>
    </ul>
  </div>
  <div class="callout blue">
    <b>怎么用两份报告</b>
    你的需求如果主要是"芯片要快"(编译、推理、渲染)——按本报告选;如果主要是"整机要称手"(便携、屏幕、存储、时机)——按主报告选。两份报告的前沿交集(M4 mini ×5年、M5Pro ×5年)是无歧义方案;只出现在单侧前沿的方案,先确认自己要的到底是哪一边的价值。
  </div>
</section>

<!-- ============ 四、完整候选表 ============ -->
<section>
  <h2>四、完整候选方案表(234 个,含被支配点及剔除原因)</h2>
  <p class="note">月均成本与主报告完全一致(复用同一计算结果);新增多核/GPU/等效跑分列。蓝底行 = 视角1前沿;相对满足度列供与主报告交叉参照。剔除原因按视角1(纯跑分)口径给出。</p>
  <details><summary>Mac mini · 全部 60 个候选</summary>
    <div class="table-scroll">${fullTable('Mac_mini')}</div>
  </details>
  <details><summary>MacBook Air · 全部 60 个候选</summary>
    <div class="table-scroll">${fullTable('MacBook_Air')}</div>
  </details>
  <details><summary>MacBook Pro · 全部 114 个候选</summary>
    <div class="table-scroll">${fullTable('MacBook_Pro')}</div>
  </details>
</section>

<!-- ============ 五、口径与局限 ============ -->
<section>
  <h2>五、口径与局限(必读)</h2>
  <div class="card">
    <ol class="plain" style="padding-left:20px">
      <li><b>跑分是静态的:</b>机器的多核跑分不随持有期下降。原模型的 16% 年衰减度量的是"相对不断进步的旗舰基准",属于相对视角概念。因此在绝对视角下,同一配置的 6 个持有期共享同一纵坐标,只有月均成本最低者留在前沿——这是视角性质,不是数据缺失。</li>
      <li><b>形态溢价不可见:</b>Air 比 mini 贵出的部分买的是屏幕、键盘、电池、便携;Pro 比 Air 贵的部分还含机身材质与散热。这些价值在跑分轴上不存在,本视角会系统性地"低估笔记本、高估台式机"。按本报告选型时,请确认自己不需要这些形态价值。</li>
      <li><b>GPU 未计入主轴:</b>多核跑分是 CPU 视角。M5Max 的核心价值在 GPU(OpenCL 165000,为 M5Pro 的 2.2 倍)与内存带宽——视频剪辑/AI 用户请以 GPU 列为准,不要被"29300 vs 28500 仅差 3%"误导。</li>
      <li><b>下代新品按保守口径:</b>引擎把下代 MacBook Pro 的性能按当前旗舰水平(28500)计算,因此被 M5Pro(234 元)支配。若下代芯片按模型自身的 16% 代际增速外推(约 33000 分),下代 ×4年(360 元)将重回前沿顶端——此为敏感性提示,非计算结果。</li>
      <li><b>等效跑分的权重局限:</b>统一采用 Mac_基础权重表(内存基准 16GB、存储基准 512GB),对 ≥16GB 的内存差异不敏感(16G/24G/32G/36G 权重均为 1.0)。重度多任务/大内存工作流请直接看内存配置列,不要依赖等效跑分排序。</li>
      <li><b>月均成本未变:</b>横轴(月均成本 = (买入价+预期维修−预期残值)/持有月数)与主报告完全一致,含 MacBook Pro 分档修正;差异仅在纵轴口径。</li>
    </ol>
  </div>
</section>

<!-- ============ 六、数据与更新 ============ -->
<section>
  <h2>六、数据来源与更新提示</h2>
  <div class="card">
    <ul class="plain">
      <li>多核/GPU 跑分来自常量库 v3.9 芯片性能跑分表(M5 系列按 2026-03 MacRumors/Notebookcheck 实测)。</li>
      <li>234 个候选点的月均成本、买入价、残值、维修均复用主报告计算结果(引擎 apple-value-engine,含 MacBook Pro 基础/Pro 分档修正),价格来源与置信度见主报告第八节。</li>
      <li>计算脚本:scripts/run-mac-pareto-abs-2026-08-20.mjs;结果数据:scripts/debug/mac-pareto-abs-2026-08-20.json(本地,不入库)。</li>
      <li><b>更新触发条件与主报告一致:</b>M5 Mac mini 发布、MacBook Pro 下代发布(2026-10)、iPhone 18 Pro 发布后的宏观重扫。绝对视角的前沿对"等待方案预测价"同样敏感。</li>
    </ul>
  </div>
</section>

<footer>
  <p>苹果电脑购买决策报告 · 绝对性能视角 · 2026-08-20 · apple-value-analysis 技能 + apple-value-engine</p>
  <p>姊妹篇:2026-08-20-苹果电脑购买决策报告.html(相对满足度视角)</p>
</footer>

</div>
<script src='https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js'></script>
<script>
var DATA = ${chartDataJSON};
var C_PRIMARY = '#007AFF', C_ACCENT_SOFT = '#E6F2FF';
var C_MUTED = '#86868F', C_BORDER = '#D2D2D8', C_GRAY = '#C7C7CC';
var PALETTE = ['#007AFF', '#8E8E93', '#2A8A61', '#E09500', '#AF52DE', '#5856D6'];
var baseOption = {
  backgroundColor: 'transparent',
  color: PALETTE,
  textStyle: { fontFamily: 'Inter, -apple-system, "PingFang SC", sans-serif', color: '#1D1D1F' },
  grid: { left: 60, right: 24, top: 50, bottom: 60, containLabel: true },
  tooltip: {
    trigger: 'item',
    backgroundColor: '#FFFFFF', borderColor: '#D2D2D8', borderWidth: 1,
    textStyle: { color: '#1D1D1F', fontSize: 13 },
    extraCssText: 'box-shadow: 0 4px 8px -2px rgba(29,29,31,0.08); border-radius: 8px;'
  },
  legend: { top: 8, textStyle: { color: C_MUTED, fontSize: 12 }, itemWidth: 14, itemHeight: 10 },
  xAxis: {
    type: 'value', nameLocation: 'middle', nameGap: 32, nameTextStyle: { color: C_MUTED, fontSize: 12 },
    axisLine: { lineStyle: { color: C_BORDER } }, axisLabel: { color: C_MUTED, fontSize: 12 },
    splitLine: { lineStyle: { color: C_BORDER, type: 'solid' } }
  },
  yAxis: {
    type: 'value', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: C_MUTED, fontSize: 12 },
    axisLine: { lineStyle: { color: C_BORDER } }, axisLabel: { color: C_MUTED, fontSize: 12 },
    splitLine: { lineStyle: { color: C_BORDER, type: 'solid' } }
  }
};
var SHAPE = { Mac_mini: 'circle', MacBook_Air: 'diamond', MacBook_Pro: 'triangle' };
function tipAbs(p) {
  var d = p.data;
  return d.name + (d.w ? '<br>⏳ 等' + d.w + '个月(预测价)' : '') +
    '<br>多核:' + d.value[1] + ' 分 · GPU:' + d.gpu + ' 分' +
    '<br>等效跑分:' + d.eq + ' 分<br>月均:' + p.value[0] + '元 · 净支出:' + d.net + '元';
}
function mkSeries(front, dom, yName) {
  var line = front.map(function(p){return p.v;});
  var series = [
    { name: '前沿', type: 'scatter', symbolSize: 16, itemStyle: { color: C_PRIMARY },
      data: front.map(function(p){ return { name: p.n, value: p.v, gpu: p.gpu, eq: p.eq, net: p.net, w: p.w,
        symbol: SHAPE[p.cat], label: { show: !!p.key, formatter: p.n, position: 'top', fontSize: 11, color: C_MUTED } }; }) },
    { name: '被支配', type: 'scatter', symbol: 'circle', symbolSize: 7, itemStyle: { color: C_GRAY, opacity: 0.45 }, data: dom },
    { type: 'line', data: line, symbol: 'none', lineStyle: { color: C_PRIMARY, width: 1.5, opacity: 0.35 }, tooltip: { show: false } }
  ];
  return series;
}
var c1 = echarts.init(document.getElementById('c1'));
c1.setOption(Object.assign({}, baseOption, {
  xAxis: { name: '月均成本(元/月)→ 越低越省', min: 20, max: 450 },
  yAxis: { name: '多核跑分(分)→ 越高越好', min: 6000, max: 31000 },
  tooltip: { trigger: 'item', formatter: tipAbs },
  legend: { data: ['前沿', '被支配'] },
  series: mkSeries(DATA.v1.front, DATA.v1.dom)
}));
var c2 = echarts.init(document.getElementById('c2'));
c2.setOption(Object.assign({}, baseOption, {
  xAxis: { name: '月均成本(元/月)', min: 20, max: 450 },
  yAxis: { name: '等效跑分(分,统一权重)', min: 4000, max: 31000 },
  tooltip: { trigger: 'item', formatter: tipAbs },
  legend: { data: ['前沿', '被支配'] },
  series: mkSeries(DATA.v2.front, DATA.v2.dom)
}));
window.addEventListener('resize', function(){ c1.resize(); c2.resize(); });
</script>
</body>
</html>`;

const outPath = path.join(ROOT, 'test-results', '2026-08-20-苹果电脑购买决策报告-绝对性能视角.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log('OK ->', outPath, Math.round(html.length / 1024) + 'KB');
