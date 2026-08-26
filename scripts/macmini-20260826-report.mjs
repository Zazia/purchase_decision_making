// 从 scripts/debug/macmini-20260826-result.json 生成 HTML 决策报告(design_tokens 取自 constants.json v4.1)
import { readFileSync, writeFileSync } from 'node:fs';

const R = JSON.parse(readFileSync('i:/_Devolopment/1-small-tools/purchase_decision_making/scripts/debug/macmini-20260826-result.json', 'utf8'));
const pts = R.points;

const inPts = pts.filter(p => !p.overBudget);
const inFr = inPts.filter(a => !inPts.some(b => b !== a && b.cost <= a.cost && b.sBar >= a.sBar && (b.cost < a.cost || b.sBar > a.sBar)));
const frIds = new Set(R.frontier.map(p => p.id));
const inFrIds = new Set(inFr.map(p => p.id));

// 为被支配点找一个代表支配者(优先预算内前沿点)
function dominator(p) {
  const doms = pts.filter(b => b !== p && b.cost <= p.cost && b.sBar >= p.sBar && (b.cost < p.cost || b.sBar > p.sBar));
  if (!doms.length) return null;
  doms.sort((a, b) => (inFrIds.has(a.id) ? 0 : 1) - (inFrIds.has(b.id) ? 0 : 1) || a.cost - b.cost);
  return doms[0];
}

const badge = (txt, cls) => `<span class="badge badge-${cls}">${txt}</span>`;

function statusCell(p) {
  const s = [];
  if (inFrIds.has(p.id)) s.push(badge('预算内前沿', 'success'));
  else if (frIds.has(p.id)) s.push(badge('前沿·超预算', 'warning'));
  else s.push(badge('被支配', 'default'));
  if (p.overBudget) s.push(badge('超预算', 'warning'));
  if (p.predicted) s.push(badge('预测值', 'default'));
  return s.join(' ');
}
function noteCell(p) {
  const n = [];
  if (p.overSupport !== null) n.push(typeof p.overSupport === 'number' ? `⚠ 超出macOS支持期${p.overSupport}月` : '⚠ 接近系统支持尾声');
  if (p.n > 36) n.push('长持有期预测置信度低');
  if (p.machine.includes('M6')) n.push('跑分为推算值(20500-21700),待实测回填');
  if (!frIds.has(p.id)) { const d = dominator(p); if (d) n.push(`被 ${d.id} 支配`); }
  return n.join(';<br>') || '—';
}

const fmtRows = pts.map(p => `<tr${inFrIds.has(p.id) ? ' style="background:var(--accent-soft)"' : ''}>
<td class="mono">${p.id}</td><td>${p.machine}</td><td>${p.type === 'A' ? '现在买' : '等~2月买新品'}</td>
<td class="num mono">${p.price}</td><td class="num mono">${p.n}</td><td class="num mono">${p.sellAge}</td>
<td class="num mono"><b>${p.cost}</b></td><td class="num mono">${p.sBar}%</td><td class="num mono">${p.residual}</td><td class="num mono">${p.repair}</td>
<td>${statusCell(p)}</td><td class="note">${noteCell(p)}</td></tr>`).join('\n');

const frRows = [...R.frontier].sort((a, b) => a.cost - b.cost).map(p => `<tr${inFrIds.has(p.id) ? ' style="background:var(--accent-soft)"' : ''}>
<td class="mono">${p.id}</td><td>${p.machine}</td><td class="num mono"><b>${p.cost}</b></td><td class="num mono">${p.sBar}%</td>
<td class="num mono">${p.price}</td><td class="num mono">${p.n}月</td><td class="num mono">${p.residual}</td>
<td>${inFrIds.has(p.id) ? badge('预算内', 'success') : badge('超预算参考', 'warning')}</td></tr>`).join('\n');

const tcRows = R.typeC.map(c => `<tr><td>${c.machine}</td><td class="num mono">${c.current}</td><td class="num mono">${c.sA}</td><td class="num mono">${c.sB}</td><td class="num mono">${c.sC}</td><td class="num mono"><b>${c.weighted}</b></td><td>${c.fail ? badge('失效·等待无收益', 'error') : badge('可考虑', 'success')}</td></tr>`).join('\n');

// ---------- ECharts 数据 ----------
const net = p => p.price - p.residual + p.repair;
const mk = (p, extra = {}) => ({ name: p.id + ' ' + p.machine, value: [p.cost, p.sBar, net(p)], ...extra });
const overSupportStyle = p => (typeof p.overSupport === 'number' ? { borderColor: '#E09500', borderWidth: 2 } : {});
const longHoldStyle = p => (p.n > 36 ? { opacity: 0.6 } : {});

const dataInFr = inFr.map(p => mk(p, { itemStyle: { color: '#007AFF', ...overSupportStyle(p), ...longHoldStyle(p) } }));
const dataFrOverUsed = R.frontier.filter(p => p.overBudget && p.type === 'A').map(p => mk(p, { itemStyle: { color: 'rgba(0,122,255,0.12)', borderColor: '#007AFF', borderWidth: 2, ...longHoldStyle(p) } }));
const dataFrOverNew = R.frontier.filter(p => p.type === 'B').map(p => mk(p, { symbol: 'triangle', symbolSize: 16, itemStyle: { color: '#007AFF', ...longHoldStyle(p) }, label: { show: true, formatter: '等新品', position: 'top', fontSize: 10, color: '#007AFF' } }));
const dataDom = pts.filter(p => !frIds.has(p.id)).map(p => mk(p, { symbolSize: 8, itemStyle: { color: '#C7C7CC', opacity: 0.5 } }));
const frontLine = [...inFr].sort((a, b) => a.cost - b.cost).map(p => [p.cost, p.sBar]);

// 成本曲线(6机型)
const curveMachines = ['M1 16G/256G', 'M1 16G/512G', 'M2 8G/256G', 'M2 16G/256G', 'M4 16G/256G', 'M6 16G/256G 新品'];
const curveSeries = curveMachines.map((m, i) => ({
  name: m + (m.includes('M4') ? '(超预算)' : m.includes('M6') ? '(超预算·预测)' : ''),
  type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
  data: [12, 18, 24, 36, 48, 60].map(n => { const p = pts.find(x => x.machine === m && x.n === n); return [n, p.cost]; }),
  lineStyle: { width: 2, color: null }, itemStyle: { color: null }
}));

// 保值率曲线 0-60 实测校准 + 60-108 指数外推
const ret = t => { const C = { 0: 100, 3: 90, 6: 82, 12: 80, 18: 72, 24: 65, 36: 52, 48: 46, 60: 35 };
  const ks = Object.keys(C).map(Number);
  if (t <= 60) { for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i] && t <= ks[i + 1]) return C[ks[i]] + (C[ks[i + 1]] - C[ks[i]]) * (t - ks[i]) / (ks[i + 1] - ks[i]); }
  return Math.max(5, 5 + 30 * Math.pow(0.5, (t - 60) / 24)); };
const retCal = []; for (let t = 0; t <= 60; t += 3) retCal.push([t, +ret(t).toFixed(1)]);
const retExt = []; for (let t = 60; t <= 108; t += 3) retExt.push([t, +ret(t).toFixed(1)]);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>2026-08-26 Mac mini 购买决策报告</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
:root {
  --bg: #F5F5F7; --surface: #FFFFFF; --rule: #D2D2D8;
  --muted: #86868F; --fg: #1D1D1F;
  --accent: #007AFF; --accent-hover: #0063D4; --accent-soft: #E6F2FF;
  --success: #2A8A61; --success-soft: #D9F0E3;
  --warning: #E09500; --warning-soft: #FFF0C2;
  --error: #F24B4B; --error-soft: #FFD9D9;
  --font-display: 'DM Sans', -apple-system, 'SF Pro Display', 'PingFang SC', sans-serif;
  --font-body: 'Inter', -apple-system, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 16px; line-height: 1.6; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
.card { background: var(--surface); border-radius: 20px; box-shadow: 0 1px 2px rgba(29,29,31,.06), 0 1px 1px rgba(29,29,31,.04); padding: 20px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.card-title { font-family: var(--font-display); font-size: 20px; font-weight: 600; }
h1 { font-family: var(--font-display); font-size: 32px; font-weight: 600; }
h2 { font-family: var(--font-display); font-size: 24px; font-weight: 600; margin: 24px 0 4px; }
.kicker { color: var(--muted); font-size: 14px; }
.mono { font-family: var(--font-mono); }
.num { text-align: right; }
.badge { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 9999px; font-size: 12px; font-weight: 400; line-height: 1; white-space: nowrap; margin: 1px 2px 1px 0; }
.badge-default { background: var(--bg); color: var(--muted); }
.badge-success { background: var(--success-soft); color: var(--success); }
.badge-warning { background: var(--warning-soft); color: var(--warning); }
.badge-error { background: var(--error-soft); color: var(--error); }
.report-table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--surface); border: 1px solid var(--rule); border-radius: 16px; overflow: hidden; }
.report-table th, .report-table td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--rule); font-size: 14px; vertical-align: top; }
.report-table thead th { color: var(--muted); font-size: 12px; font-weight: 600; white-space: nowrap; }
.report-table tbody tr:last-child td { border-bottom: none; }
.report-table tbody tr:hover { filter: brightness(.97); }
.note { color: var(--muted); font-size: 12px; }
.tbl-scroll { overflow-x: auto; border-radius: 16px; }
.concl { font-size: 20px; font-weight: 600; font-family: var(--font-display); }
.big-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.big-num { background: var(--bg); border-radius: 16px; padding: 16px; }
.big-num .v { font-family: var(--font-display); font-size: 32px; font-weight: 600; color: var(--accent); }
.big-num .k { color: var(--muted); font-size: 13px; }
.chart { width: 100%; height: 430px; }
.chart-aux { width: 100%; height: 330px; }
p { margin: 4px 0; }
ul { padding-left: 20px; }
li { margin: 4px 0; }
.src { color: var(--muted); font-size: 12px; }
@media (max-width: 720px) {
  h1 { font-size: 24px; } .concl { font-size: 17px; }
  .report-table th, .report-table td { font-size: 13px; padding: 10px 8px; white-space: nowrap; }
  .chart { height: 360px; } .chart-aux { height: 360px; }
}
</style>
</head>
<body>
<div class="wrap">

<h1>Mac mini 购买决策报告</h1>
<p class="kicker">分析时点 2026-08-26 · 预算 ≤4000 元 · 场景:开发/中度生产 · 持有期由帕累托前沿筛选 · 数据:constants.json v4.1(2026-08-26)· 方法:SKILL.md v4.1 文字路径(锚定-冲击双因子模型)</p>

<h2>一、结论与推荐</h2>
<div class="card">
  <div class="concl">预算 4000 以内:<b>现在买二手 M2 16G/256G(约 3566 元),持有 4-5 年,月均 53-59 元</b>是均衡主推;想更省就持 1 年短周转,想更强需把预算上浮到 4500(二手 M4)。<b>不要等</b>——明日预购的 M6 是涨价发布(+16.7%),二手老款不降反升,「等发售后捡漏」已失效。</div>
  <div class="big-nums">
    <div class="big-num"><div class="v">53-59<small>元/月</small></div><div class="k">主推方案月均成本(M2 16G · 持有48-60月)</div></div>
    <div class="big-num"><div class="v">3566<small>元</small></div><div class="k">主推买入价(闲鱼挂牌中位,成交可谈低5-10%)</div></div>
    <div class="big-num"><div class="v">3769<small>元</small></div><div class="k">M2 16G 等M6发售后加权预估价 > 现价3566(类型C失效)</div></div>
    <div class="big-num"><div class="v">+75%<small></small></div><div class="k">M6 新品 6999 元超预算幅度(等待方案出局)</div></div>
  </div>
</div>

<div class="card">
  <div class="card-title">推荐方案(预算内前沿三档,均按「现在买入」)</div>
  <div class="tbl-scroll"><table class="report-table">
    <thead><tr><th>档位</th><th>方案</th><th>买入价</th><th>持有期</th><th>月均成本</th><th>平均性能 S̄</th><th>推荐理由与注意</th></tr></thead>
    <tbody>
      <tr><td>经济档</td><td class="mono">M2 8G/256G 二手</td><td class="num mono">2675</td><td class="num mono">12月</td><td class="num mono"><b>20元</b></td><td class="num mono">29.2%</td><td class="note">总持有成本最低(净支出仅241元);但 8G 内存对开发场景偏弱,卖出机龄55月仍在支持期内</td></tr>
      <tr style="background:var(--accent-soft)"><td>均衡档(主推)</td><td class="mono">M2 16G/256G 二手</td><td class="num mono">3566</td><td class="num mono">48-60月</td><td class="num mono"><b>53-59元</b></td><td class="num mono">35.6-37.4%</td><td class="note">预算内性价比中枢;S(0)=48%满足中度开发;⚠持有48月以上卖出已超 macOS 支持期(91月/超19月),残值按指数外推估算</td></tr>
      <tr><td>性能档</td><td class="mono">M2 16G/256G 二手</td><td class="num mono">3566</td><td class="num mono">12月</td><td class="num mono"><b>94元</b></td><td class="num mono">44.9%</td><td class="note">短持有拿更高平均性能(持有期内基准芯片更新少);一年后卖出换 M6 二手是可行路径</td></tr>
    </tbody>
  </table></div>
</div>

<div class="card">
  <div class="card-title">前沿备选(超预算参考——若预算可上浮)</div>
  <div class="tbl-scroll"><table class="report-table">
    <thead><tr><th>方案</th><th>买入价</th><th>持有期</th><th>月均成本</th><th>平均性能 S̄</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td class="mono">M4 16G/256G 二手</td><td class="num mono">4500(叫价)</td><td class="num mono">18月</td><td class="num mono"><b>69元</b></td><td class="num mono">67.1%</td><td class="note">预算+500 的断层性价比:支配预算内全部短持有方案。停产稀缺+涨价锚定使其叫价坚挺;买入需验机,实际成交或可谈至 4200-4300</td></tr>
      <tr><td class="mono">M6 16G/256G 新品</td><td class="num mono">6999(官宣)</td><td class="num mono">60月</td><td class="num mono"><b>88元</b></td><td class="num mono">77%</td><td class="note">预算+75%;明日 9:00 预购/9-22 发售,基线到货约 10 月下旬(存储超级周期×2.0 延迟)。跑分为推算值(区间 S(0) 101.9-107.9%),S̄ 为预测口径</td></tr>
    </tbody>
  </table></div>
  <p class="note">注:M5 Pro 款(12999)全系被 M6(6999)支配——Pro 档锚涨幅仅 +4%,无对冲优势,不构成备选。</p>
</div>

<div class="card">
  <div class="card-title">等待方案判定(类型 B/C)——本报告核心结论之一</div>
  <ul>
    <li><b>类型 C(等 M6 发售后买降价老款):全线失效。</b>M6 定价 6999 较 M4 现行 5999 上涨 16.7%,属「涨价发布」:新品官方价把二手市场锚点上移,代际冲击被涨价对冲(38%→28.5%)。三情景加权(30%/45%/25%)后,M2 16G 预估价 3769 > 现价 3566,M4 预估价 4756 > 现价 4500——<b>等待的期望收益为负</b>。实证参照:iPhone 17 涨价发布后老款一周仅跌 2-4%、两月后归零。</li>
    <li><b>类型 B(等 M6 买新品):超预算 75%,出局。</b>若未来预算上浮,M6 持有 60 月月均 88 元、S̄77%,是全场性能上限(预测口径)。</li>
    <li><b>当前时点含义:想买老款二手,现在就是合理时点</b>;官宣至发售后首月是二手高位窗口(利于卖方)。唯一反转风险是情景 A(30% 概率):若冲击全额传导,M2 16G 或下探 3034、M4 或至 3829(唯一可能落入预算的 M4 路径)。</li>
  </ul>
</div>

<h2>二、支撑证据</h2>

<div class="card">
  <div class="card-title">帕累托前沿图(核心图表)</div>
  <div id="pareto" class="chart"></div>
  <p class="src">每个点 = (机型 × 持有期 × 买入时机) 方案;横轴月均成本越低越省,纵轴持有期平均性能满足度越高越好;气泡大小 ≈ 持有期净支出。</p>
</div>

<div class="card">
  <div class="card-title">前沿方案表(全局帕累托前沿,按月均成本升序)</div>
  <div class="tbl-scroll"><table class="report-table">
    <thead><tr><th>方案</th><th>机型</th><th>月均成本</th><th>S̄</th><th>买入价</th><th>持有期</th><th>预期残值</th><th>状态</th></tr></thead>
    <tbody>${frRows}</tbody>
  </table></div>
  <p class="note">预算语义:用户预算 4000 为购入价口径,图中以实心蓝(预算内)与空心蓝(超预算参考)区分;被支配点已剔除,完整清单见下方计算表。</p>
</div>

<div class="card">
  <div class="card-title">类型 C 三情景预估(等 M6 发售后 1-3 月买老款,§9.4 锚定-冲击双因子)</div>
  <div class="tbl-scroll"><table class="report-table">
    <thead><tr><th>机型</th><th>现价</th><th>情景A 全额传导(30%)</th><th>情景B 实证口径(45%)</th><th>情景C 零冲击(25%)</th><th>加权预估</th><th>判定</th></tr></thead>
    <tbody>${tcRows}</tbody>
  </table></div>
  <p class="note">公式:预估价 = 现价 × (1+16.7%锚涨幅) × (1−冲击×0.95时变)。情景A冲击=28.5%(38%均值×涨价对冲-25%);情景B取 iPhone 17 涨价发布实测冲击≈3%;情景C=0(缺货+惜售)。概率赋值四问:①M4 已停产稀缺 ✓ ②M6 缺货概率高(2nm 首发+存储周期+限购2台+Mac mini 此前长期售罄)✓ ③本地 AI 需求增量 ✓ ④涨价前二手已透支一轮(M4 较国补期低点+50%)✓——四问全部指向锚定占优,故 B/C 情景权重高。</p>
</div>

<div class="card">
  <div class="card-title">宏观因素分析</div>
  <ul>
    <li><b>存储超级周期·进行中</b>(TrendForce 2026-01/07 报告,预计 2027 见顶):HBM 挤压消费级产能,2026-06-25 苹果中国全线调价(Mac mini 老款 4499→5999),二手水涨船高——M4 丐版二手从国补期约 3000 涨至 4500(+50%,超官方涨幅)。8-26 交叉验证:Bloomberg 报道 Mac mini 在美长期处于售罄状态。</li>
    <li><b>M6 涨价发布(2026-08-25 官宣)</b>:基础档 6999(+16.7% vs M4 现行 5999;较 2024 首发价 4499 累计 +55.6%);Pro 档 M5 Pro 12999(较 M4 Pro 调价后 12499 仅 +4%)——分档分化:基础档二手利多(锚定强),Pro 档二手利空(无对冲)。</li>
    <li><b>触发机制清单(v3.8)</b>:①新品价格预测停用(M6 已官宣,直接用官宣价);②Mac_mini 冲击均值 38%→28.5%(价格传导因子-25%);③缺货等待期 = 基线14天×2.0 宏观因子(类型B基线等待约2月,悲观4月)。</li>
    <li><b>M8 风险(低置信度)</b>:按 M4→M6 实测 22 月周期外推,下次发布约 2028 年中。持有 ≥24 月方案卖出时点临近 M8,已按平价换代冲击(38%×时变因子)计入残值;敏感性检验:剔除 M8 后预算内主推不变,仅超预算段 M4·24月 回到前沿。</li>
  </ul>
</div>

<div class="card">
  <div class="card-title">常量校验与数据置信度</div>
  <ul>
    <li><b>常量级别:绿色免检</b>(constants.json v4.1 于 2026-08-26 更新,M6 官宣数据已入库)。</li>
    <li><b>快照校验</b>:M6/M5 Pro/M4 条目为 8-25 官宣日苹果官网直采(高置信度);M1/M2 闲鱼挂牌中位采集于 7-27(中置信度),8-26 交叉验证偏差 &lt;5%(香港 DCFever M2 8G/256G 挂牌 HK$2900≈¥2650 vs 快照 2675),继续使用。M2 16G 3566 为挂牌口径,成交通常可谈低 5-10%;涨价潮中该值可能略偏保守(实际或更高)。</li>
    <li><b>方向性提示</b>:本库 2026-07 实测校验显示 Mac 老款实测保值率可能高于曲线——本报告残值估计偏保守,实际月均成本或更低。</li>
    <li><b>维修成本</b>:Mac mini 无电池(更换费 0),年均故障维修 100 元已按持有年数计入;口径为不含 AC+ 裸机。</li>
  </ul>
</div>

<div class="card">
  <div class="card-title">完整候选方案计算表(含被支配点)</div>
  <div class="tbl-scroll"><table class="report-table">
    <thead><tr><th>方案</th><th>机型</th><th>买入时机</th><th>买入价</th><th>持有月</th><th>卖出机龄</th><th>月均成本</th><th>S̄</th><th>残值</th><th>维修</th><th>状态</th><th>备注</th></tr></thead>
    <tbody>${fmtRows}</tbody>
  </table></div>
  <p class="note">残值 = 调整后保值率 × 残值分母 6999(M6 基础款官宣价;Pro 档为 12999)。调整链 = 曲线保值率 × M6 冲击修正(28.5%×时变) × M8 冲击修正(38%×时变,仅 N≥24)。S̄ = 持有期平均性能满足度,基准 = 实测 M5(17100,§9.5 实测口径)。</p>
</div>

<h2>三、图表说明</h2>

<div class="card">
  <div class="card-title">阅读方法</div>
  <ul>
    <li><b>帕累托前沿图</b>:左上方向更优。前沿(连线)上的点不存在「更便宜且更强」的替代,均为合理选择,取舍取决于你的偏好;灰色半透明点为被支配方案(右下方),已排除。三角形为「等新品」方案(买入价为预测/官宣口径)。橙色描边 = 卖出时超出 macOS 支持期;半透明大点 = 持有 &gt;36 月,预测置信度低。</li>
    <li><b>各机型多持有期成本曲线</b>:展示「持有越久月均越低但边际递减」,并可见 M8 冲击使 24 月持有段出现小凸起。</li>
    <li><b>保值率曲线</b>:实线为 0-60 月实测校准段(2026-08 中国市场修订),虚线为 60 月后指数外推(置信度低);竖线为 macOS 支持期 72 月。</li>
    <li><b>不确定性</b>:12-36 月持有区间置信度最高;&gt;36 月残值为外推;M6 跑分为推算值(发售后需实测回填);M8 发布时间为周期外推(低置信度)。</li>
  </ul>
</div>

<div class="card">
  <div class="card-title">各机型多持有期成本曲线</div>
  <div id="costcurve" class="chart-aux"></div>
</div>

<div class="card">
  <div class="card-title">Mac mini 保值率曲线(v3.9.1 中国市场口径)</div>
  <div id="valuecurve" class="chart-aux"></div>
</div>

<h2>四、更新提示</h2>
<div class="card">
  <ul>
    <li><b>2026-08-27 9:00 M6 预购开启</b>:观察到货周期数据(基线 10 月下旬/悲观 12 月),用于修正 §9.4 概率四问。</li>
    <li><b>2026-09-22 M6 发售</b>:Geekbench 实测回填后触发性能基准切换(Mac_mini_基础→M6),全系 S(0) 重算;发售后 2 周实测 M4 二手价若偏离加权中枢 4756 超过 ±10%,触发重分析。</li>
    <li><b>存储周期见顶信号</b>(TrendForce 口径 2027 见顶):一旦缓解,二手锚定支撑弱化,届时「等回调」重新成为可行策略。</li>
    <li><b>持有老款的卖出时机</b>:官宣至发售后首月为二手高位窗口;若计划出手 M1/M2,勿拖过该窗口。</li>
    <li><b>下次建议分析时间</b>:2026-09 下旬(M6 发售+实测回填后),或上述任一触发条件出现时。</li>
  </ul>
</div>

<p class="src">数据来源:constants.json v4.1(保值率曲线 v3.9.1 中国市场修订 / 芯片跑分 GB6 / 苹果官网 2026-08-25 直采 / 闲鱼挂牌 2026-07-27~08-25 / smzdm·V2EX·东方财富涨价传导报道)· 交叉验证:DCFever(2026-08-26)· Bloomberg Línea 存储稀缺报道(2026-08-25)· 方法论:apple-value-analysis SKILL.md v4.1 §9.4/§9.5 · 引擎提示:apple-value-engine 尚未同步 v4.1 锚定项,本报告按 SOP 文字路径计算 · 生成时间 2026-08-26</p>
</div>

<script>
var C_PRIMARY = '#007AFF', C_ACCENT_SOFT = '#E6F2FF';
var C_MUTED = '#86868F', C_BORDER = '#D2D2D8', C_GRAY = '#C7C7CC';
var C_SUCCESS = '#2A8A61', C_WARNING = '#E09500', C_ERROR = '#F24B4B';
var PALETTE = ['#007AFF', '#8E8E93', '#2A8A61', '#E09500', '#AF52DE', '#5856D6'];
var baseOption = {
  backgroundColor: 'transparent', color: PALETTE,
  textStyle: { fontFamily: 'Inter, -apple-system, "PingFang SC", sans-serif', color: '#1D1D1F' },
  grid: { left: 60, right: 24, top: 50, bottom: 60, containLabel: true },
  tooltip: { trigger: 'item', backgroundColor: '#FFFFFF', borderColor: '#D2D2D8', borderWidth: 1,
    textStyle: { color: '#1D1D1F', fontSize: 13 }, extraCssText: 'box-shadow: 0 4px 8px -2px rgba(29,29,31,0.08); border-radius: 8px;' },
  legend: { top: 8, textStyle: { color: C_MUTED, fontSize: 12 }, itemWidth: 14, itemHeight: 10 },
  xAxis: { type: 'value', nameLocation: 'middle', nameGap: 32, nameTextStyle: { color: C_MUTED, fontSize: 12 },
    axisLine: { lineStyle: { color: C_BORDER } }, axisLabel: { color: C_MUTED, fontSize: 12 },
    splitLine: { lineStyle: { color: C_BORDER, type: 'solid' } } },
  yAxis: { type: 'value', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: C_MUTED, fontSize: 12 },
    axisLine: { lineStyle: { color: C_BORDER } }, axisLabel: { color: C_MUTED, fontSize: 12 },
    splitLine: { lineStyle: { color: C_BORDER, type: 'solid' } } }
};
function size(d) { return Math.min(28, Math.sqrt(d[2]) / 3 + 6); }

var paretoOption = Object.assign({}, baseOption, {
  xAxis: { name: '月均成本(元/月)→ 越低越省', min: 0, max: 160 },
  yAxis: { name: '持有期平均性能满足度%→ 越高越好', min: 20, max: 105 },
  tooltip: { trigger: 'item', formatter: function (p) {
    return p.name + '<br>月均:' + p.value[0] + '元 · 性能:' + p.value[1] + '%<br>持有期净支出:' + p.value[2] + '元'; } },
  legend: { data: ['预算内前沿', '前沿·超预算(二手)', '前沿·超预算(等M6新品·预测)', '被支配点'] },
  series: [
    { name: '预算内前沿', type: 'scatter', symbol: 'circle', symbolSize: size, itemStyle: { color: C_PRIMARY },
      data: ${JSON.stringify(dataInFr)} },
    { name: '前沿·超预算(二手)', type: 'scatter', symbol: 'circle', symbolSize: size,
      itemStyle: { color: 'rgba(0,122,255,0.12)', borderColor: C_PRIMARY, borderWidth: 2 },
      data: ${JSON.stringify(dataFrOverUsed)} },
    { name: '前沿·超预算(等M6新品·预测)', type: 'scatter', symbol: 'triangle', symbolSize: 16, itemStyle: { color: C_PRIMARY },
      data: ${JSON.stringify(dataFrOverNew)} },
    { name: '被支配点', type: 'scatter', symbol: 'circle', symbolSize: 8, itemStyle: { color: C_GRAY, opacity: 0.5 },
      data: ${JSON.stringify(dataDom)} },
    { type: 'line', data: ${JSON.stringify(frontLine)}, symbol: 'none',
      lineStyle: { color: C_PRIMARY, type: 'dashed', width: 1.5 }, tooltip: { show: false } }
  ]
});

var machineData = ${JSON.stringify(curveSeries.map((s, i) => ({ name: s.name, data: s.data })))};
var costCurveOption = Object.assign({}, baseOption, {
  xAxis: { name: '持有月数', min: 12 },
  yAxis: { name: '月均成本(元)' },
  tooltip: { trigger: 'axis', formatter: function (pts) { var s = ''; pts.forEach(function (i) { s += i.seriesName + ':' + i.data[0] + '月 ' + i.data[1] + '元/月<br>'; }); return s; } },
  legend: { type: 'scroll', top: 0, textStyle: { color: C_MUTED, fontSize: 10 }, height: 30 },
  series: machineData.map(function (s, i) {
    return { name: s.name, type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, data: s.data,
      lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] }, itemStyle: { color: PALETTE[i % PALETTE.length] } };
  })
});

var valueCurveOption = Object.assign({}, baseOption, {
  xAxis: { name: '机龄(发布后月数)', min: 0, max: 108 },
  yAxis: { name: '保值率%', min: 0, max: 100 },
  tooltip: { trigger: 'axis' },
  series: [
    { name: '实测校准段(0-60月)', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: ${JSON.stringify(retCal)},
      lineStyle: { color: C_PRIMARY, width: 2.5 }, itemStyle: { color: C_PRIMARY } },
    { name: '指数外推段(60月后,低置信度)', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: ${JSON.stringify(retExt)},
      lineStyle: { color: C_PRIMARY, width: 2, type: 'dashed', opacity: 0.6 }, itemStyle: { color: C_PRIMARY, opacity: 0.6 } },
    { type: 'line', data: [], symbol: 'none',
      markLine: { symbol: 'none', silent: true, lineStyle: { color: C_WARNING, type: 'dashed' },
        data: [{ xAxis: 72, label: { formatter: 'macOS支持期 72月', color: C_WARNING } },
               { xAxis: 43, label: { formatter: 'M2 现机龄43月', color: C_MUTED } },
               { xAxis: 69, label: { formatter: 'M1 现机龄69月', color: C_MUTED } }] } }
  ]
});

function render(id, opt) { var c = echarts.init(document.getElementById(id)); c.setOption(opt); window.addEventListener('resize', function () { c.resize(); }); }
render('pareto', paretoOption); render('costcurve', costCurveOption); render('valuecurve', valueCurveOption);
</script>
</body>
</html>`;

const out = 'i:/_Devolopment/1-small-tools/purchase_decision_making/.agents/skills/apple-value-analysis/2026-08-26-苹果产品购买决策报告.html';
writeFileSync(out, html, 'utf8');
console.log('written:', out, (html.length / 1024).toFixed(1) + 'KB');
