// 生成 2026-08-20 苹果电脑购买决策报告(结论先行 HTML)
// 用法: node scripts/gen-mac-report-2026-08-20.mjs
// 输入: scripts/debug/mac-pareto-2026-08-20.json + .agents/skills/apple-value-analysis/constants.json
// 产物: test-results/2026-08-20-苹果电脑购买决策报告.html
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/debug/mac-pareto-2026-08-20.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));

const CATS = ['Mac_mini', 'MacBook_Air', 'MacBook_Pro'];
const CAT_LABEL = { Mac_mini: 'Mac mini', MacBook_Air: 'MacBook Air', MacBook_Pro: 'MacBook Pro' };
const TIMING_LABEL = { new: '新品', used: '二手' };
const TYPE_LABEL = { A: '现在买', B: '等新品·买新品', C: '等新品·买降价老款' };
const RISK_LABEL = { normal: '正常', 'near-end': '临近到期', exceeded: '系统支持超期' };

// ---------- 数据整形 ----------
function prettyModel(m) {
  if (m.startsWith('MacBook_Pro_下一代')) return '下代 MacBook Pro(预测)';
  if (m.startsWith('MacBook_Pro_')) return m.replace('MacBook_Pro_', '下代 ').replace('_新品', ' 新品(预测)');
  const parts = m.split('_');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^\d+G$/.test(parts[i]) && out.length && /^\d+G$/.test(parts[i - 1])) out[out.length - 1] += '/' + parts[i];
    else out.push(parts[i]);
  }
  return out.join(' ');
}
const allPoints = (cat) => [...R.categories[cat].frontier, ...R.categories[cat].dominated];

// 跨品类点 → 品类归属(按 模型+持有期+月均成本 匹配各品类前沿)
const catKeyIndex = new Map();
for (const cat of CATS) for (const p of R.categories[cat].frontier) catKeyIndex.set(`${p.model}|${p.holdingYears}|${p.monthlyCost.toFixed(2)}`, cat);
for (const cat of CATS) for (const p of R.categories[cat].dominated) catKeyIndex.set(`${p.model}|${p.holdingYears}|${p.monthlyCost.toFixed(2)}`, cat);
const catOf = (p) => catKeyIndex.get(`${p.model}|${p.holdingYears}|${p.monthlyCost.toFixed(2)}`) || 'Mac_mini';

// 支配者:在给定前沿中找 月均成本更低且满足度更高 的点(取月均最低者)
function dominatorOf(p, frontier) {
  const doms = frontier.filter((q) => q.monthlyCost <= p.monthlyCost && q.avgPerformance >= p.avgPerformance &&
    (q.monthlyCost < p.monthlyCost || q.avgPerformance > p.avgPerformance));
  if (!doms.length) return null;
  doms.sort((a, b) => a.monthlyCost - b.monthlyCost || b.avgPerformance - a.avgPerformance);
  return doms[0];
}

// 持有期-月均成本曲线数据(指定机型在各持有期的全部候选点)
function holdingSeries(cat, base) {
  return allPoints(cat).filter((p) => p.model === base)
    .sort((a, b) => a.holdingYears - b.holdingYears)
    .map((p) => [p.holdingYears, +p.monthlyCost.toFixed(1)]);
}

const f0 = (x) => (x == null ? '—' : Math.round(x).toLocaleString('zh-CN'));
const pct = (x) => Math.round(x * 100) + '%';
const riskBadge = (p) => {
  if (p.systemSupportRisk === 'exceeded') return `<span class="badge badge-warning" title="持有期内超出 macOS 支持周期 ${p.systemSupportExceedMonths} 个月">支持超期${p.systemSupportExceedMonths}月</span>`;
  if (p.systemSupportRisk === 'near-end') return '<span class="badge badge-warning" title="持有期末接近支持周期尽头">临近到期</span>';
  return '<span class="badge badge-default">正常</span>';
};
const waitBadge = (p) => (p.waitMonths ? `<span class="badge badge-warning" title="等待 ${p.waitMonths} 个月后按预测价买入">等${p.waitMonths}月·预测价</span>` : '');

// ---------- 图表数据 ----------
const crossFrontier = R.crossCategory.frontier.map((p) => ({ ...p, category: catOf(p) }));
const crossDominated = R.crossCategory.dominated.map((p) => ({ ...p, category: catOf(p) }));
const KEY_CROSS = new Set(['M2_8G_256G_二手 × 1年', 'M4_16G_256G_新品 × 5年', 'M4_16G_512G_新品 × 5年', 'M5_13寸_16G_512G_新品 × 4年', 'M5_13寸_16G_512G_新品 × 1年']);
const chartCross = {
  miniFront: crossFrontier.filter((p) => p.category === 'Mac_mini'),
  airFront: crossFrontier.filter((p) => p.category === 'MacBook_Air'),
  proFront: crossFrontier.filter((p) => p.category === 'MacBook_Pro'),
  proCatFront: [...R.categories.MacBook_Pro.frontier],
  dominated: CATS.flatMap((cat) => R.categories[cat].dominated),
};
const KEY_PRO = new Set(['M5Pro_14寸_24G_1024G_新品 × 4年', 'M2Pro_14寸_32G_512G_二手 × 5年', 'MacBook_Pro_下一代新品 × 4年', 'M1Pro_14寸_16G_512G_二手 × 2年']);
const holdingSeriesData = [
  { name: 'Mac mini M4 16G/256G 新品', data: holdingSeries('Mac_mini', 'M4_16G_256G_新品') },
  { name: 'Mac mini M4 16G/512G 新品', data: holdingSeries('Mac_mini', 'M4_16G_512G_新品') },
  { name: 'Mac mini M2 16G/256G 二手', data: holdingSeries('Mac_mini', 'M2_16G_256G_二手') },
  { name: 'MacBook Air M5 16G/512G 新品', data: holdingSeries('MacBook_Air', 'M5_13寸_16G_512G_新品') },
  { name: 'MacBook Air M4 16G/256G 二手', data: holdingSeries('MacBook_Air', 'M4_16G_256G_二手') },
  { name: 'MacBook Pro M5Pro 24G/1T 新品(等4月)', data: holdingSeries('MacBook_Pro', 'M5Pro_14寸_24G_1024G_新品') },
  { name: 'MacBook Pro M2Pro 32G/512G 二手(等4月)', data: holdingSeries('MacBook_Pro', 'M2Pro_14寸_32G_512G_二手') },
];
const monthsAxis = [0, 3, 6, 12, 18, 24, 36, 48, 60];
const retentionSeries = CATS.map((cat) => ({
  name: CAT_LABEL[cat],
  data: monthsAxis.map((m) => [m, C['保值率曲线'][cat][String(m)]]),
}));

// ---------- 表格 ----------
function planRow(p, extra = '') {
  const front = extra === 'front';
  return `<tr${front ? ' style="background:var(--accent-soft)"' : ''}>
<td>${prettyModel(p.model)}</td>
<td>${TYPE_LABEL[p.candidateType]}${p.candidateType !== 'A' ? `(${p.waitMonths}月)` : ''}</td>
<td class="num">${f0(p.buyPrice)}</td>
<td class="num">${f0(p.monthlyCost)}</td>
<td class="num">${pct(p.avgPerformance)}</td>
<td class="num">${f0(p.residual)}</td>
<td class="num">${f0(p.maintenanceCost)}</td>
<td>${riskBadge(p)}</td></tr>`;
}
function fullRow(p, dominator, cat) {
  const dom = dominator ? `被「${prettyModel(dominator.model)}」支配` : '前沿';
  return `<tr${dominator ? '' : ' style="background:var(--accent-soft)"'}>
<td>${CAT_LABEL[cat]}</td>
<td>${prettyModel(p.model)}</td>
<td>${TIMING_LABEL[p.buyTiming]}·${TYPE_LABEL[p.candidateType]}</td>
<td class="num">${f0(p.buyPrice)}</td>
<td class="num">${f0(p.monthlyCost)}</td>
<td class="num">${pct(p.avgPerformance)}</td>
<td class="num">${f0(p.residual)}</td>
<td class="num">${f0(p.maintenanceCost)}</td>
<td>${dominator ? '被支配' : '<span class="badge badge-default" style="background:var(--accent-soft);color:var(--accent)">前沿</span>'}</td>
<td>${dom}</td></tr>`;
}
function fullTable(cat) {
  const front = R.categories[cat].frontier;
  const rows = allPoints(cat)
    .slice()
    .sort((a, b) => a.monthlyCost - b.monthlyCost)
    .map((p) => fullRow(p, dominatorOf(p, front), cat))
    .join('');
  return `<table class="report-table"><thead><tr>
<th>品类</th><th>方案</th><th>时机</th><th>买入价</th><th>月均成本</th><th>满足度</th><th>预期残值</th><th>预期维修</th><th>状态</th><th>剔除原因 / 前沿</th>
</tr></thead><tbody>${rows}</tbody></table>`;
}

// 推荐方案(场景卡) —— 全部取自计算结果
const P = {
  miniCheap: R.categories.Mac_mini.frontier.find((p) => p.model === 'M2_8G_256G_二手 × 1年'),
  mini256: R.categories.Mac_mini.frontier.find((p) => p.model === 'M4_16G_256G_新品 × 5年'),
  mini512: R.categories.Mac_mini.frontier.find((p) => p.model === 'M4_16G_512G_新品 × 5年'),
  air5: R.categories.MacBook_Air.frontier.find((p) => p.model === 'M5_13寸_16G_512G_新品 × 4年'),
  air5y5: R.categories.MacBook_Air.frontier.find((p) => p.model === 'M5_13寸_16G_512G_新品 × 5年'),
  air4used: R.categories.MacBook_Air.frontier.find((p) => p.model === 'M4_16G_256G_二手 × 5年'),
  proUsed: R.categories.MacBook_Pro.frontier.find((p) => p.model === 'M2Pro_14寸_32G_512G_二手 × 5年'),
  proNew: R.categories.MacBook_Pro.frontier.find((p) => p.model === 'M5Pro_14寸_24G_1024G_新品 × 4年'),
  proNext: R.categories.MacBook_Pro.frontier.find((p) => p.model === 'MacBook_Pro_下一代新品 × 4年'),
  air1: R.categories.MacBook_Air.frontier.find((p) => p.model === 'M5_13寸_16G_512G_新品 × 1年'),
};

const scenarioCards = [
  {
    tag: '性价比首选', pick: P.mini256, conf: '买入价为京东国补参考价(资讯稿,低置信),官方价 5999 计算时月均约 89 元',
    reason: '满足度过半(55%)的最低月均成本方案。M4 多核 15000 已超过上代 Air M2(9700);mini 无电池,5 年预期维修仅 500 元,长持成本结构性占优。',
  },
  {
    tag: '大存储甜点', pick: P.mini512, conf: '国补参考价 6400(用户提供实采,与官网定价一致)',
    reason: '512G 存储权重 1.0,5 年月均 94 元换来 65% 满足度,比 256G 版每月只多 22 元,是前沿上"每元满足度"最高的升级。',
  },
  {
    tag: '便携刚需', pick: P.air5, conf: '买入价 8457 为京东国补实付(smzdm 实付晒单,符合 5 项标准,中置信);官方价 9999 计算时月均约 213 元',
    reason: 'M5 于 2026-03 刚发布,下代预计 2027 年,现在买不踩换代坑。4 年月均 188 元拿到 78% 满足度;若预算敏感,M4 Air 二手 ×5 年(121 元/月,55%)是次优。',
  },
  {
    tag: 'Pro 级性能·预算紧', pick: P.proUsed, conf: '预测价:等 4 个月(下代发布+到货延迟)后二手降价,现价约 8200(闲鱼挂单价,样本 2,低置信)',
    reason: '相对 M5 Pro 基准仅 33%,但绝对多核 15000 已高于 M4 mini(15000 持平)/M5 Air(17100 之下)。⚠ 持有 5 年将超出 macOS 支持周期 35 个月,建议按 3 年内换手规划(×3 年月均 151 元)。',
  },
  {
    tag: 'Pro 级性能·旗舰', pick: P.proNew, conf: '预测价:等 4 个月后新品渠道降价(现官方价 19999)',
    reason: '24G/1T 是当前 Pro 档均衡配置,等降价后 4 年月均 258 元。同样的月均支出在 Air 上能买到 93%(×1 年),只有当你的工作流需要 M5 Pro 的绝对算力(多核 28500/GPU 75000)时才值得。',
  },
  {
    tag: '极限省钱·过渡机', pick: P.miniCheap, conf: '闲鱼挂单价 2675(样本 2,低置信)',
    reason: '2675 元买入持有一年净支出仅约 400 元,适合"先有个 Mac 用着"的过渡场景。⚠ 8G 内存对多任务明显吃紧,满足度仅 29%,不适合作为主力机。',
  },
];

const budgetTiers = [
  { range: '≤4000 元', plans: [P.miniCheap, R.categories.Mac_mini.frontier.find((p) => p.model === 'M2_16G_256G_二手 × 3年')], note: 'M2 mini 二手是唯一过半预算内"能用"方案;⚠ 16G 版持有 3 年起将超出支持周期' },
  { range: '4000–9000 元', plans: [P.mini512, P.air4used, P.proUsed], note: '这一档选择最丰富:台式选 M4 mini 新品,便携选 M4 Air 二手,Pro 性能选等 4 个月的 M2Pro 二手' },
  { range: '9000 元以上', plans: [P.air5, P.proNew, P.proNext], note: 'M5 Air 新品是便携最优;Pro 档等 4 个月下代发布后入手' },
];

// ---------- HTML ----------
const chartDataJSON = JSON.stringify({
  cross: {
    miniFront: chartCross.miniFront.map((p) => ({ n: `${prettyModel(p.model)}`, v: [+p.monthlyCost.toFixed(1), Math.round(p.avgPerformance * 1000) / 10, Math.round(p.buyPrice + p.maintenanceCost - p.residual)], key: KEY_CROSS.has(p.model), w: p.waitMonths || 0 })),
    airFront: chartCross.airFront.map((p) => ({ n: `${prettyModel(p.model)}`, v: [+p.monthlyCost.toFixed(1), Math.round(p.avgPerformance * 1000) / 10, Math.round(p.buyPrice + p.maintenanceCost - p.residual)], key: KEY_CROSS.has(p.model), w: p.waitMonths || 0 })),
    proCatFront: chartCross.proCatFront.map((p) => ({ n: `${prettyModel(p.model)}`, v: [+p.monthlyCost.toFixed(1), Math.round(p.avgPerformance * 1000) / 10, Math.round(p.buyPrice + p.maintenanceCost - p.residual)], key: false })),
    dominated: chartCross.dominated.map((p) => [+p.monthlyCost.toFixed(1), Math.round(p.avgPerformance * 1000) / 10]),
  },
  pro: {
    front: R.categories.MacBook_Pro.frontier.map((p) => ({ n: `${prettyModel(p.model)}`, v: [+p.monthlyCost.toFixed(1), Math.round(p.avgPerformance * 1000) / 10, Math.round(p.buyPrice + p.maintenanceCost - p.residual)], key: KEY_PRO.has(p.model), t: p.candidateType })),
    dominated: R.categories.MacBook_Pro.dominated.map((p) => [+p.monthlyCost.toFixed(1), Math.round(p.avgPerformance * 1000) / 10]),
  },
  holding: holdingSeriesData,
  retention: retentionSeries,
});

const scenCardHTML = scenarioCards.map((s) => `
<article class="card scen">
  <div class="scen-head"><span class="badge badge-default tag">${s.tag}</span>
    <span class="scen-model">${prettyModel(s.pick.model)}</span></div>
  <div class="scen-nums">
    <div><span class="k">月均成本</span><span class="v">${f0(s.pick.monthlyCost)}<i>元/月</i></span></div>
    <div><span class="k">平均满足度</span><span class="v">${pct(s.pick.avgPerformance)}</span></div>
    <div><span class="k">买入价</span><span class="v">${f0(s.pick.buyPrice)}<i>元</i></span></div>
  </div>
  <p class="scen-reason">${s.reason}</p>
  <p class="scen-conf">价格口径:${s.conf}。${s.pick.waitMonths ? `⚠ 等待方案:需等约 ${s.pick.waitMonths} 个月,买入价为预测值。` : ''}${s.pick.systemSupportRisk !== 'normal' ? `⚠ ${RISK_LABEL[s.pick.systemSupportRisk]}。` : ''}</p>
</article>`).join('');

const budgetHTML = budgetTiers.map((t) => `<tr><td><b>${t.range}</b></td><td>${t.plans.map((p) => `${prettyModel(p.model)}(${f0(p.monthlyCost)}元/月,${pct(p.avgPerformance)})`).join('<br>')}</td><td>${t.note}</td></tr>`).join('');

const frontierListHTML = crossFrontier
  .slice()
  .sort((a, b) => a.monthlyCost - b.monthlyCost)
  .map((p) => `<tr><td>${CAT_LABEL[p.category]}</td><td>${prettyModel(p.model)}</td><td>${TIMING_LABEL[p.buyTiming]}·${TYPE_LABEL[p.candidateType]}</td><td class="num">${f0(p.buyPrice)}</td><td class="num"><b>${f0(p.monthlyCost)}</b></td><td class="num">${pct(p.avgPerformance)}</td><td>${riskBadge(p)} ${waitBadge(p)}</td></tr>`)
  .join('');

const proFrontHTML = R.categories.MacBook_Pro.frontier
  .slice()
  .sort((a, b) => a.monthlyCost - b.monthlyCost)
  .map((p) => planRow(p, 'front'))
  .join('');

const catFrontTables = {};
for (const cat of ['Mac_mini', 'MacBook_Air']) {
  catFrontTables[cat] = R.categories[cat].frontier.slice().sort((a, b) => a.monthlyCost - b.monthlyCost).map((p) => planRow(p, 'front')).join('');
}

const maintenanceRows = [
  ['Mac mini', '无电池', '100', '500', '无电池更换,台式机故障率低——mini 长持月均低的结构性原因'],
  ['MacBook Air', '1299', '300', '2799', '5 年含 1 次电池更换(寿命周期 36 个月)+ 故障维修'],
  ['MacBook Pro', '1299', '400', '3299', 'Pro 档维修基数更高,长持成本被维修显著抬高'],
].map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td><td>${r[4]}</td></tr>`).join('');

const retentionRows = CATS.map((cat) => {
  const cur = C['保值率曲线'][cat];
  return `<tr><td>${CAT_LABEL[cat]}</td>${monthsAxis.map((m) => `<td class="num">${cur[String(m)]}%</td>`).join('')}<td>${cat === 'Mac_mini' ? '2026-08-10 按中国市场实测修订(8 样本,修订后 MAE 8.7pp)' : 'SellMacBook 海外市场曲线'}</td></tr>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>苹果电脑购买决策报告 · 2026-08-20</title>
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
.hero h3 { font-size: 20px; }
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
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; }
details { background: var(--surface); border: 1px solid var(--rule); border-radius: 16px; padding: 12px 16px; }
details summary { cursor: pointer; font-weight: 600; font-size: 14px; color: var(--accent); }
details[open] summary { margin-bottom: 12px; }
ul.plain { padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
ol.plain { padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.formula { font-family: var(--font-mono); font-size: 13px; background: var(--bg); border-radius: 8px; padding: 8px 12px; }
footer { text-align: center; color: var(--muted); font-size: 12px; padding-top: 12px; }
@media (max-width: 720px) { .chart { height: 360px; } .chart-sm { height: 360px; } h1 { font-size: 26px; } }
</style>
</head>
<body>
<div class="page">

<header>
  <h1>苹果电脑购买决策报告</h1>
  <p class="sub">Mac mini · MacBook Air · MacBook Pro 跨品类帕累托分析 | 分析日期 2026-08-20</p>
  <div class="meta-chips">
    <span class="chip">常量库 v3.9(2026-08-10)</span>
    <span class="chip">市场价快照 2026-07-26/27 与 2026-08-07/10</span>
    <span class="chip">引擎 apple-value-engine</span>
    <span class="chip">候选 234 个 · 跨品类前沿 17 个</span>
    <span class="chip">持有期 1–5 年 · 新品+二手+等待方案</span>
  </div>
</header>

<!-- ============ 第一部分:结论与推荐 ============ -->
<section class="card hero">
  <h3>核心结论</h3>
  <p class="punchline">没有便携或 Pro 级性能刚需 → <b>Mac mini M4 新品 ×5 年</b>(72–94 元/月)是全场性价比最优;要便携 → <b>MacBook Air M5 新品 ×4 年</b>(188 元/月);要 Pro 级性能 → <b>MacBook Pro 等约 4 个月</b>下代发布后买降价款。<b>MacBook Pro 的全部方案在跨品类前沿上被支配</b>——除非你的工作流必须用 M5 Pro 级绝对算力。</p>
  <ul>
    <li><b>性价比之王是 Mac mini M4 新品:</b>16G/256G ×5 年月均 72 元(满足度 55%),16G/512G ×5 年月均 94 元(65%)。无电池免更换、年故障维修仅 100 元,长持成本结构性低于笔记本。</li>
    <li><b>便携选 M5 Air,现在买不踩坑:</b>2026-03 刚发布、下代 2027 年,国补实付 8457 元 ×4 年月均 188 元(78%)。</li>
    <li><b>MacBook Pro 是全场景"最差时机":</b>下代预计 2026-10 发布(距今 2 个月+到货延迟),品类内 18 个前沿点中 17 个是"等 4 个月"方案——现在原价买入是唯一被所有等待方案支配的选择。</li>
    <li><b>买 Mac mini 前盯一眼 M5 mini:</b>M5 Mac mini 预计 2026 年三季度(本月!)发布,届时 M4 新品面临约 29%(宏观修正后)的老款冲击降价。</li>
  </ul>
</section>

<section>
  <h2>一、推荐方案(结论先行)</h2>

  <div class="scen-grid">${scenCardHTML}</div>

  <div class="card">
    <h3>预算三档速查</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>预算</th><th>该档最优方案</th><th>说明</th></tr></thead>
      <tbody>${budgetHTML}</tbody>
    </table></div>
    <p class="note">说明:本分析未限定预算,三档仅作导航;满足度均为"品类内相对值"(见第三节口径警告)。</p>
  </div>

  <div class="card">
    <h3>前沿备选清单(跨品类帕累托前沿全部 17 个非劣解)</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>品类</th><th>方案</th><th>时机</th><th>买入价</th><th>月均成本</th><th>满足度</th><th>支持风险</th></tr></thead>
      <tbody>${frontierListHTML}</tbody>
    </table></div>
    <p class="note">全部 17 个前沿点均来自 Mac mini 与 MacBook Air;MacBook Pro 无一入选(原因见第三节)。</p>
  </div>

  <div class="callout">
    <b>⏳ 等待方案提示(涉及类型 B/C 共 3 个推荐场景)</b>
    MacBook Pro 下代预计 2026-10 发布,叠加存储超级周期下的到货延迟,等待方案按约 4 个月后(2026-12 前后)可入手计算,买入价均为<b>预测值</b>(老款冲击幅度按宏观传导因子修正)。等待期机会成本请自行评估:等待期间若无设备可用,租用/借用成本或生产力损失应折算进对比;若现有设备还能撑 4 个月,等待方案在数学上全面占优。
  </div>
</section>

<!-- ============ 第二部分:支撑证据·图表 ============ -->
<section>
  <h2>二、核心图表</h2>

  <div class="card">
    <h3>2.1 跨品类帕累托前沿(核心图)</h3>
    <div id="c1" class="chart"></div>
    <p class="note">蓝点 = 跨品类前沿(Mac mini 圆形 / MacBook Air 菱形);灰三角 = MacBook Pro 品类内前沿(在跨品类平面上全部被支配);浅灰小点 = 被支配方案。虚线 = 50% 性能下限参考线。悬浮可查看净支出(买入价+维修−残值)。</p>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>2.2 MacBook Pro 品类内前沿</h3>
      <div id="c2" class="chart-sm"></div>
      <p class="note">Pro 用户请看这张:品类内 18 个前沿点(蓝)中 17 个是"等 4 个月"方案(类型 B/C,预测价),仅 M1Pro 二手 ×2 年为立即买入。灰点 = 品类内被支配方案。</p>
    </div>
    <div class="card">
      <h3>2.3 持有期 – 月均成本曲线(用几年划算)</h3>
      <div id="c3" class="chart-sm"></div>
      <p class="note">每条曲线的最低点即该机型的最优持有年限:mini 新品与 Air 新品均在 5 年触底(残值摊薄+维修线性增长的临界点),二手方案拐点更早。</p>
    </div>
  </div>

  <div class="card">
    <h3>2.4 三品类保值率曲线(残值分母口径)</h3>
    <div id="c4" class="chart-sm"></div>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>品类</th>${monthsAxis.map((m) => `<th>${m === 0 ? '0' : m + '月'}</th>`).join('')}<th>数据来源</th></tr></thead>
      <tbody>${retentionRows}</tbody>
    </table></div>
    <p class="note">Mac mini 曲线 2026-08-10 已按中国市场实测修订(原 SellMacBook 海外曲线系统性低估 +22.3pp);这是 mini 长持月均显著占优的另一原因。MacBook Air/Pro 仍为海外曲线,中国市场实际保值率普遍更高,对应月均成本估算偏保守。</p>
  </div>
</section>

<!-- ============ 第三部分:跨品类解读 ============ -->
<section>
  <h2>三、跨品类解读:MacBook Pro 为什么全部被支配</h2>

  <div class="card">
    <h3>数学上的原因</h3>
    <ul class="plain">
      <li><b>买入价高:</b>Pro 档前沿主力是 M5Pro 24G/1T(等 4 个月后预测 14299 元)与下代新品(预测 19999 元),是 M4 mini 新品(5074–6400 元)的 2–4 倍。</li>
      <li><b>满足度门槛更高:</b>Pro 品类基准是 M5 Pro(多核 28500)+ 32GB 内存/1TB 存储的 Pro 级权重表。M5Pro 24G/1T 的 S(0) 仅 0.80(24GB 内存权重 0.8),而 Air M5 16G/512G 对自己的基准(多核 17100/16GB/512GB)是满配 S(0)=1.0。</li>
      <li><b>同价对比:</b>同样是 258 元/月 —— M5 Air ×1 年满足度 93%,M5Pro 新品(等 4 月)×4 年只有 62%;下代 MBP ×4 年(360 元/月)与 M5 Air ×4 年(188 元/月)满足度同为 78%,但月均成本相差 92%。</li>
    </ul>
  </div>

  <div class="callout">
    <b>⚠ 口径警告:满足度是"品类内相对值",不是绝对性能</b>
    Air 的 93% 是相对 M5 基准(多核 17100/GPU 52000);Pro 的 62% 是相对 M5 Pro 基准(多核 28500/GPU 75000)。<b>若你的工作流需要 Pro 级绝对算力(4K/8K 视频剪辑、本地大模型推理、大型工程编译),M5 Air 的 93% 无法替代 M5 Pro 的 62%</b>——此时请直接参考 2.2 图与下表的 MacBook Pro 品类内前沿,跨品类"被支配"结论不适用于这类刚需场景。
  </div>

  <div class="card">
    <h3>MacBook Pro 品类内前沿(按月均成本升序)</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>方案</th><th>时机</th><th>买入价</th><th>月均成本</th><th>满足度</th><th>预期残值</th><th>预期维修</th><th>支持风险</th></tr></thead>
      <tbody>${proFrontHTML}</tbody>
    </table></div>
    <p class="note">满足度均相对 M5 Pro 基准。除 M1Pro ×2 年外全部为等待方案(等 4 个月,预测价);M1Pro/M2Pro 长持方案存在系统支持超期风险(M2Pro ×5 年超期 35 个月)。</p>
  </div>
</section>

<!-- ============ 第四部分:时机分析 ============ -->
<section>
  <h2>四、新品 vs 二手、现在买 vs 等</h2>

  <div class="card">
    <h3>Mac mini:新品长持是甜点,但 M5 发布在即</h3>
    <ul class="plain">
      <li>M2 二手 16G(3566 元)月均 54–70 元,但持有 3 年起超出 macOS 支持周期(M2 mini 2023-01 发布 + 72 月支持 → 2029-01 到期);M2 8G 版满足度仅 29%,只配当过渡机。</li>
      <li>M4 新品 ×5 年是全场甜点;但 M5 mini 预计 2026 年三季度发布,发布后 M4 新品渠道价面临约 29%(38% 历史均值 × 宏观传导修正)的下调。<b>若不急,等 M5 mini 发布后一周再做决定:M5 同价则买新,涨价则 M4 降价更香。</b></li>
      <li>注:快照中 mini 的发布预测为季度粒度("2026 年第三季度"),引擎未生成 mini 的等待方案,上表 mini 前沿均为立即买入口径;M4 新品方案的残值已按冲击时变模型下调。</li>
    </ul>
  </div>

  <div class="card">
    <h3>MacBook Air:现在买正当时</h3>
    <ul class="plain">
      <li>M5 2026-03 发布,下代预计 2027 年——当前处于发布周期最舒服的窗口,新品 ×4–5 年(188/165 元/月)与 M4 二手 ×5 年(121 元/月,55%)同在前沿。</li>
      <li>二手老款(M1/M2)被 5 年 2799 元的预期维修(含一次 1299 元电池更换)显著拖累:M1 二手 ×5 年月均 83–86 元,满足度只有 18–27%,已被全面支配。</li>
      <li>买入价优先用国补实付(8457 元,smzdm 实付晒单);教育资质人群可到 7420 元,月均成本再降约 25 元。</li>
    </ul>
  </div>

  <div class="card">
    <h3>MacBook Pro:等,这是数学结论不是风格偏好</h3>
    <ul class="plain">
      <li>品类内前沿 18 点中 17 点是"等 4 个月"方案:下代 2026-10 发布后,当期 M5/M5Pro 新品降价(类型 C)或直接买下代(类型 B)都严格优于现在原价买入。</li>
      <li>预算紧的 Pro 用户:M2Pro 32G 二手等 4 个月后预测 5863 元 ×5 年 118 元/月;但注意 5 年持有超支持期 35 个月,建议按 2–3 年换手规划。</li>
      <li>旗舰用户:M5Pro 24G/1T 等 4 个月预测 14299 元 ×4 年 258 元/月;下代新品(预测 19999 元)×4 年 360 元/月满足度 78%,仅在"必须最新代"时选择。</li>
    </ul>
  </div>
</section>

<!-- ============ 第五部分:完整候选表 ============ -->
<section>
  <h2>五、完整候选方案计算表(含被支配点及剔除原因)</h2>
  <p class="note">候选 = 快照机型 × 6 种持有期(mini/Air 各 60 个;Pro 含等待方案展开共 114 个)。蓝底行 = 品类内前沿;其余行为被支配方案,剔除原因列给出支配它的前沿方案。MacBook Pro 品类已按基础/Pro 两档修正口径合并计算(见第六节)。</p>

  <details>
    <summary>Mac mini · 全部 60 个候选(前沿 ${R.categories.Mac_mini.frontier.length} 个)</summary>
    <div class="table-scroll"><table class="report-table"><thead><tr>
    <th>品类</th><th>方案</th><th>时机</th><th>买入价</th><th>月均</th><th>满足度</th><th>残值</th><th>维修</th><th>状态</th><th>剔除原因 / 前沿</th>
    </tr></thead><tbody>${fullTable('Mac_mini')}</tbody></table></div>
  </details>

  <details>
    <summary>MacBook Air · 全部 60 个候选(前沿 ${R.categories.MacBook_Air.frontier.length} 个)</summary>
    <div class="table-scroll"><table class="report-table"><thead><tr>
    <th>品类</th><th>方案</th><th>时机</th><th>买入价</th><th>月均</th><th>满足度</th><th>残值</th><th>维修</th><th>状态</th><th>剔除原因 / 前沿</th>
    </tr></thead><tbody>${fullTable('MacBook_Air')}</tbody></table></div>
  </details>

  <details>
    <summary>MacBook Pro · 全部 ${allPoints('MacBook_Pro').length} 个候选(前沿 ${R.categories.MacBook_Pro.frontier.length} 个)</summary>
    <div class="table-scroll"><table class="report-table"><thead><tr>
    <th>品类</th><th>方案</th><th>时机</th><th>买入价</th><th>月均</th><th>满足度</th><th>残值</th><th>维修</th><th>状态</th><th>剔除原因 / 前沿</th>
    </tr></thead><tbody>${fullTable('MacBook_Pro')}</tbody></table></div>
  </details>
</section>

<!-- ============ 第六部分:方法与口径 ============ -->
<section>
  <h2>六、方法与口径说明</h2>

  <div class="card">
    <h3>计算公式(引擎 apple-value-engine,常量库 v3.9)</h3>
    <div class="formula">性能满足度 S(0) = min(1, 芯片多核/品类基准多核 × 内存权重 × 存储权重)</div>
    <div class="formula">持有期末满足度 S(N) = S(0) / (1 + 16%)^持有年数 &nbsp;← M 系列基准跑分年增速(v3.8 按 M5 实测重算)</div>
    <div class="formula">平均满足度 S̄ = (S(0) + S(N)) / 2</div>
    <div class="formula">月均成本 = (买入价 + 预期维修 − 预期卖出残值) / 持有月数</div>
    <div class="formula">预期维修 = floor(持有月数/36) × 电池更换费 + 持有年数 × 年均故障维修费</div>
    <div class="formula">残值 = 持有期末保值率 × 品类当前新品价(残值分母),距新品发布近时叠加冲击时变下调</div>
    <ul class="plain">
      <li><b>品类基准芯片:</b>Mac mini 基础档与 MacBook Air 基准为 M5(多核 17100);MacBook Pro 基准为 M5 Pro(多核 28500)。内存/存储权重:基础档基准 16GB,Pro 档基准 32GB/1TB。</li>
      <li><b>残值分母:</b>mini=M4 基础款 5999 元;Air=M5 13寸 16G/512G 9999 元;Pro 按芯片分档(基础 15999 / Pro 档 19999 元)。</li>
      <li><b>等待方案(类型 B/C):</b>下代发布月 − 分析月 + 到货延迟 × 产能因子 = 等待月数(MacBook Pro 为 4 个月);类型 B 买下代新品、类型 C 买降价老款,价格均为预测值,不回写快照。</li>
    </ul>
  </div>

  <div class="card">
    <h3>MacBook Pro 分档修正(本次分析的数据附注)</h3>
    <p class="note">快照约定 Pro 品类残值分母按芯片分档(基础 15999 / Pro 档 19999),但引擎默认取首个新品价作单一分母,会把 Pro 档残值低估约 20%,并使类型 B 候选"用基础款价格配旗舰基准性能"。本次分析将 MacBook Pro 拆为基础档(M5 14寸)与 Pro 档(M5Pro/M5Max/二手 Pro)两次计算后合并,并剔除基础档失真的类型 B 点后重算前沿。另对快照做了三处内存级修正(未回写):补全 M5/M5Max MacBook Pro 发布日期(2026-03)、修正机型键名与存储单位(1T→1024G 等)、为存储权重表补充数字键。计算脚本:scripts/run-mac-pareto-2026-08-20.mjs。</p>
  </div>

  <div class="card">
    <h3>维修成本估算明细</h3>
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>品类</th><th>单次电池更换(元)</th><th>年均故障维修(元)</th><th>5 年持有预期维修(元)</th><th>说明</th></tr></thead>
      <tbody>${maintenanceRows}</tbody>
    </table></div>
    <p class="note">电池寿命周期按 36 个月(1000 次完整充放衰减至 80%);价格为官方售后价,不含 AC+。若购 AC+,订阅费需另行平摊。</p>
  </div>
</section>

<!-- ============ 第七部分:宏观与校验 ============ -->
<section>
  <h2>七、宏观因素与常量校验</h2>
  <div class="card">
    <ul class="plain">
      <li><b>L1 扫描:</b>2026-06-25 苹果中国全线调价 + 存储超级周期进行中(2026 年三季度合约价续涨、涨幅收窄)+ MacBook Pro 下代预计 2026-10 发布。</li>
      <li><b>L2 判定:</b>存储超级周期_进行中;对本次分析生效的机制:① 未发布新品(下代 MacBook Pro)按价格预测涨幅外推而非"同档同价";② 老款冲击幅度按传导因子下调(Mac mini 38%→约 29%);③ 到货延迟按产能因子放大(等待月数 4 = 2 个月到发布 + 延迟)。</li>
      <li><b>常量校验:</b>常量库 v3.9(2026-08-10,距今 10 天)——保值率曲线绿(无需年度更新,mini 曲线刚按中国市场修订)、芯片跑分红(M5/M5Pro/M5Max 已按 2026-03 实测更新)、市场价快照黄(主力价格 2026-07-26/27 采集,距今 24–25 天,处于 15–30 天轻校验区间,建议成交前复核)。</li>
      <li><b>分析参数:</b>未限定预算(全价位)、持有期 1/1.5/2/3/4/5 年、新品+二手+等待方案全开、通用场景(轻度使用可对满足度 ×1.2 修正,专业工作流 ×0.9)。</li>
    </ul>
  </div>
</section>

<!-- ============ 第八部分:数据来源与置信度 ============ -->
<section>
  <h2>八、数据来源与置信度</h2>
  <div class="card">
    <div class="table-scroll"><table class="report-table">
      <thead><tr><th>数据项</th><th>来源</th><th>日期</th><th>置信度</th></tr></thead>
      <tbody>
        <tr><td>三品类官方价</td><td>apple.com.cn(WebFetch 直采)</td><td>2026-07-26</td><td><span class="badge badge-default">高</span></td></tr>
        <tr><td>Air M5 国补实付 8457 元</td><td>smzdm 用户实付晒单(京东自营,符合 5 项标准)</td><td>2026-07-24</td><td><span class="badge badge-default">中</span></td></tr>
        <tr><td>mini M4 国补参考 5074/6400 元</td><td>smzdm 资讯稿(非实付晒单)/ 用户提供实采</td><td>2026-07-22 / 08-10</td><td><span class="badge badge-warning">低/高</span></td></tr>
        <tr><td>各品类二手价</td><td>闲鱼搜索列表页挂单价中位(mini M1/M2 共 8 样本 + 用户提供 3 台实采交叉验证)</td><td>2026-07-27 / 08-07 / 08-10</td><td><span class="badge badge-default">中</span> <span class="badge badge-warning">M2Pro 32G、M3Pro 36G 样本≤2 低</span></td></tr>
        <tr><td>保值率曲线</td><td>mini:中国市场实测修订(8 样本,MAE 8.7pp);Air/Pro:SellMacBook 海外市场</td><td>2026-08-10</td><td><span class="badge badge-default">中</span></td></tr>
        <tr><td>芯片跑分</td><td>MacRumors/Notebookcheck 实测(M5 系列按 2026-03 首测)</td><td>2026-03</td><td><span class="badge badge-default">高</span></td></tr>
        <tr><td>等待方案价格</td><td>冲击模型 × 时变因子 × 宏观传导因子 预测</td><td>—</td><td><span class="badge badge-warning">预测值</span></td></tr>
      </tbody>
    </table></div>
    <p class="note">共性风险:闲鱼价为挂单价而非实付,实际成交通常再低 5–10%;快照主力价格距今 24–25 天,接近 30 天时效边界,下单前建议按同关键词复核当日行情。</p>
  </div>
</section>

<!-- ============ 第九部分:风险与更新 ============ -->
<section>
  <h2>九、风险、不确定性与更新提示</h2>
  <div class="card">
    <h3>结论的置信度边界</h3>
    <ul class="plain">
      <li><b>长持有期(>36 月)方案:</b>保值率为外推、性能衰减(16% CAGR)为假设——mini 新品 ×5 年等前沿右段置信度中等偏低(图表中该段满足度已含衰减,月均成本对残值假设敏感)。</li>
      <li><b>等待方案:</b>下代发布时间(2026-10)与发布后价格均为预测;若跳票或存储涨价致新品再提价,类型 B/C 的优势会收窄。发布后必须用真实价格重算。</li>
      <li><b>跨品类对比:</b>满足度为品类内相对值(见第三节口径警告),只对"通用场景"有效;专业工作流请乘 0.9 修正并优先看绝对跑分。</li>
      <li><b>系统支持风险:</b>所有"支持超期"方案在持有后期将失去 macOS 安全更新,残值与可用性同步恶化,表中已标注超期月数。</li>
    </ul>
  </div>
  <div class="card">
    <h3>何时重新分析</h3>
    <ol class="plain">
      <li><b>M5 Mac mini 正式发布(预计 2026 年三季度内):</b>用真实价替换预测,M4 新品方案全部重算——这是对当前结论影响最大的单一事件。</li>
      <li><b>MacBook Pro 下代发布(预计 2026-10):</b>类型 B/C 预测价换成真实价,Pro 品类前沿重算。</li>
      <li><b>2026-09-10 iPhone 18 Pro 发布后:</b>建议重做宏观 L1–L4 扫描(存储超级周期阶段可能更新)。</li>
      <li>实际下单前:复核当日闲鱼/京东价格(快照已 24 天);二手成交价按挂单价 ×0.9–0.95 谈判。</li>
    </ol>
  </div>
</section>

<footer>
  <p>苹果电脑购买决策报告 · 2026-08-20 · 由 apple-value-analysis 技能(SOP v3.7)+ apple-value-engine 生成 · 常量库 v3.9(CC BY-NC 4.0)</p>
  <p>数据快照与计算明细:scripts/debug/mac-pareto-2026-08-20.json(本地,不入库)</p>
</footer>

</div>
<script src='https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js'></script>
<script>
var DATA = ${chartDataJSON};
var C_PRIMARY = '#007AFF', C_ACCENT_SOFT = '#E6F2FF';
var C_MUTED = '#86868F', C_BORDER = '#D2D2D8', C_GRAY = '#C7C7CC';
var C_SUCCESS = '#2A8A61', C_WARNING = '#E09500', C_ERROR = '#F24B4B';
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
function mk(d) { return d.map(function(p){ return { name: p.n, value: p.v, key: p.key, w: p.w||0, label: { show: !!p.key, formatter: p.n, position: 'top', fontSize: 11, color: C_MUTED } }; }); }
function mkPro(d) { return d.map(function(p){ return { name: p.n, value: p.v, key: p.key, t: p.t, label: { show: !!p.key, formatter: p.n, position: 'top', fontSize: 11, color: C_MUTED } }; }); }
function tipPareto(p) {
  var d = p.data;
  return d.name + (d.w ? '<br>⏳ 等' + d.w + '个月(预测价)' : '') + '<br>月均:' + p.value[0] + '元 · 满足度:' + p.value[1] + '%<br>净支出:' + p.value[2] + '元';
}

// 图1:跨品类帕累托
var c1 = echarts.init(document.getElementById('c1'));
var crossLine = DATA.cross.miniFront.concat(DATA.cross.airFront).map(function(p){return p.v;}).sort(function(a,b){return a[0]-b[0];});
c1.setOption(Object.assign({}, baseOption, {
  xAxis: { name: '月均成本(元/月)→ 越低越省', min: 20, max: 620 },
  yAxis: { name: '平均性能满足度%→ 越高越好', min: 10, max: 105 },
  tooltip: { trigger: 'item', formatter: tipPareto },
  legend: { data: ['Mac mini 前沿', 'MacBook Air 前沿', 'MacBook Pro 品类内前沿*', '被支配方案'] },
  series: [
    { name: 'Mac mini 前沿', type: 'scatter', symbol: 'circle', symbolSize: 16, itemStyle: { color: C_PRIMARY }, data: mk(DATA.cross.miniFront) },
    { name: 'MacBook Air 前沿', type: 'scatter', symbol: 'diamond', symbolSize: 16, itemStyle: { color: C_PRIMARY }, data: mk(DATA.cross.airFront) },
    { name: 'MacBook Pro 品类内前沿*', type: 'scatter', symbol: 'triangle', symbolSize: 13, itemStyle: { color: '#8E8E93', opacity: 0.9 }, data: mk(DATA.cross.proCatFront) },
    { name: '被支配方案', type: 'scatter', symbol: 'circle', symbolSize: 7, itemStyle: { color: C_GRAY, opacity: 0.45 }, data: DATA.cross.dominated },
    { type: 'line', data: crossLine, symbol: 'none', lineStyle: { color: C_PRIMARY, width: 1.5, opacity: 0.35 }, tooltip: { show: false } },
    { type: 'line', markLine: { silent: true, symbol: 'none', label: { formatter: '性能下限参考 50%', position: 'insideEndTop', color: C_MUTED, fontSize: 11 }, lineStyle: { color: C_MUTED, type: 'dashed' } }, data: [] }
  ]
}));

// 图2:MacBook Pro 品类内
var c2 = echarts.init(document.getElementById('c2'));
var proLine = DATA.pro.front.map(function(p){return p.v;}).sort(function(a,b){return a[0]-b[0];});
c2.setOption(Object.assign({}, baseOption, {
  xAxis: { name: '月均成本(元/月)', min: 70, max: 620 },
  yAxis: { name: '平均性能满足度%(相对 M5 Pro)', min: 10, max: 100 },
  tooltip: { trigger: 'item', formatter: tipPareto },
  legend: { data: ['品类内前沿', '被支配'] },
  series: [
    { name: '品类内前沿', type: 'scatter', symbol: 'circle', symbolSize: 14, itemStyle: { color: C_PRIMARY }, data: mkPro(DATA.pro.front) },
    { name: '被支配', type: 'scatter', symbol: 'circle', symbolSize: 6, itemStyle: { color: C_GRAY, opacity: 0.45 }, data: DATA.pro.dominated },
    { type: 'line', data: proLine, symbol: 'none', lineStyle: { color: C_PRIMARY, width: 1.5, opacity: 0.35 }, tooltip: { show: false } },
    { type: 'line', markLine: { silent: true, symbol: 'none', label: { formatter: '50%', position: 'insideEndTop', color: C_MUTED, fontSize: 11 }, lineStyle: { color: C_MUTED, type: 'dashed' } }, data: [] }
  ]
}));

// 图3:持有期-月均成本
var c3 = echarts.init(document.getElementById('c3'));
c3.setOption(Object.assign({}, baseOption, {
  xAxis: { type: 'category', name: '持有年限(年)', data: ['1', '1.5', '2', '3', '4', '5'] },
  yAxis: { name: '月均成本(元/月)', min: 0 },
  tooltip: { trigger: 'axis' },
  series: DATA.holding.map(function(s, i) {
    return { name: s.name, type: 'line', symbol: 'circle', symbolSize: 8,
      lineStyle: { width: 2, opacity: i >= 5 ? 0.85 : 1 }, itemStyle: { opacity: i >= 5 ? 0.85 : 1 },
      data: s.data.map(function(d){ return [String(d[0]).replace('.5', '.5'), d[1]]; }) };
  })
}));

// 图4:保值率曲线
var c4 = echarts.init(document.getElementById('c4'));
c4.setOption(Object.assign({}, baseOption, {
  xAxis: { type: 'category', name: '机龄(月)', data: ['0', '3', '6', '12', '18', '24', '36', '48', '60'] },
  yAxis: { name: '保值率(%)', min: 0, max: 100 },
  tooltip: { trigger: 'axis' },
  series: DATA.retention.map(function(s) {
    return { name: s.name, type: 'line', symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
      data: s.data.map(function(d){ return d[1]; }) };
  })
}));

window.addEventListener('resize', function(){ c1.resize(); c2.resize(); c3.resize(); c4.resize(); });
</script>
</body>
</html>`;

const outPath = path.join(ROOT, 'test-results', '2026-08-20-苹果电脑购买决策报告.html');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log('OK ->', outPath, Math.round(html.length / 1024) + 'KB');
