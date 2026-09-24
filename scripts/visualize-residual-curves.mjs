import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));
const flat = JSON.parse(fs.readFileSync(path.join(__dirname, 'debug', 'market-snapshot-flat.json'), 'utf8'));
const CURVES = data['保值率曲线'];
const RELEASE = data['产品发布日期'];

const GROUPS = [
  { key: 'Mac_mini', title: 'Mac mini', cats: ['Mac_mini'] },
  { key: 'iPhone', title: 'iPhone', cats: ['iPhone_proMax', 'iPhone_Pro', 'iPhone_标准'] },
  { key: 'MacBook_Air', title: 'MacBook Air', cats: ['MacBook_Air'] },
  { key: 'MacBook_Pro', title: 'MacBook Pro', cats: ['MacBook_Pro'] },
  { key: 'iPad', title: 'iPad', cats: ['iPad_Pro', 'iPad_Air', 'iPad_标准', 'iPad_mini'] }
];

// Mac mini v4.5 基线：用于在报告中直接展示校准前后差异。
const MAC_MINI_V45 = { 0: 100, 3: 90, 6: 82, 12: 80, 18: 72, 24: 65, 36: 52, 48: 46, 60: 35 };

function rateFromKnots(curve, t, floor = 5, halfLife = 45) {
  const knots = Object.keys(curve).filter(key => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b);
  const last = knots[knots.length - 1];
  if (t > last) return floor + (curve[last] - floor) * Math.pow(0.5, (t - last) / halfLife);
  for (let i = 0; i < knots.length - 1; i++) {
    if (t >= knots[i] && t <= knots[i + 1]) {
      const [t0, t1] = [knots[i], knots[i + 1]];
      return curve[t0] + (curve[t1] - curve[t0]) * (t - t0) / (t1 - t0);
    }
  }
  return curve[last];
}

const CURVE_META = {
  Mac_mini: { color: '#007AFF', label: 'Mac mini' },
  iPhone_proMax: { color: '#5856D6', label: 'iPhone Pro Max' },
  iPhone_Pro: { color: '#007AFF', label: 'iPhone Pro' },
  iPhone_标准: { color: '#5AC8FA', label: 'iPhone 标准' },
  MacBook_Air: { color: '#2A8A61', label: 'MacBook Air' },
  MacBook_Pro: { color: '#E09500', label: 'MacBook Pro' },
  iPad_Pro: { color: '#F24B4B', label: 'iPad Pro' },
  iPad_Air: { color: '#C87F0A', label: 'iPad Air' },
  iPad_mini: { color: '#AF52DE', label: 'iPad mini' },
  iPad_标准: { color: '#8E8E93', label: 'iPad 标准' }
};

function matchRelease(cat, item) {
  const name = item.replace(/_(新品|二手)$/, '');
  if (cat.startsWith('iPhone')) {
    const m = name.match(/iPhone_(\d+)/);
    return m ? RELEASE['iPhone_' + m[1]] : null;
  }
  if (cat === 'Mac_mini' || cat === 'MacBook_Air') {
    const m = name.match(/^(M\d[A-Za-z0-9]*)/);
    const prefix = cat === 'Mac_mini' ? 'Mac_mini_' : 'MacBook_Air_';
    return m ? RELEASE[prefix + m[1]] : null;
  }
  if (cat === 'MacBook_Pro') {
    const m = name.match(/^(M\d[A-Za-z0-9]*)_(\d+)寸/);
    if (!m) return null;
    const chip = m[1], size = m[2] === '16' ? '16' : '14';
    if (RELEASE['MacBook_Pro_' + size + '_' + chip]) return RELEASE['MacBook_Pro_' + size + '_' + chip];
    return RELEASE['MacBook_Pro_' + size + '_' + chip.replace('Pro', '').replace('Max', '')] || null;
  }
  if (cat.startsWith('iPad')) {
    const m = name.match(/^(M\d[A-Za-z0-9]*|A\d+[A-Za-z_0-9]*?)(?=_\d|\d+寸)/);
    if (!m) return null;
    const chip = m[1];
    const prefix = { iPad_Pro: 'iPad_Pro_', iPad_Air: 'iPad_Air_', iPad_mini: 'iPad_mini_' }[cat];
    if (prefix) {
      for (const c of [chip, chip.replace('_Pro', 'Pro'), chip.replace('Pro', ''), chip + 'Pro', chip.replace('_', '')]) {
        if (RELEASE[prefix + c]) return RELEASE[prefix + c];
      }
    }
    return null;
  }
  return null;
}

// 曲线：键值 + floor/halfLife → 采样 0..84
function curvePoints(cat) {
  const c = CURVES[cat === 'iPhone_proMax' ? 'iPhone_ProMax' : cat];
  const knots = Object.keys(c).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  const floor = c._floor ?? 3;
  const hl = c._half_life_months ?? 24;
  const R = t => {
    if (t <= 0) return 100;
    if (t <= 60) {
      for (let i = 0; i < knots.length - 1; i++) {
        if (t >= knots[i] && t <= knots[i + 1]) {
          const [t0, t1] = [knots[i], knots[i + 1]];
          return c[String(t0)] + (c[String(t1)] - c[String(t0)]) * (t - t0) / (t1 - t0);
        }
      }
      return c[String(knots[knots.length - 1])];
    }
    return floor + (c['60'] - floor) * Math.pow(0.5, (t - 60) / hl);
  };
  const solid = [], dashed = [];
  for (let t = 0; t <= 60; t += 3) solid.push([t, Math.round(R(t) * 10) / 10]);
  solid.push([60, c['60']]);
  for (let t = 63; t <= 84; t += 3) dashed.push([t, Math.round(R(t) * 10) / 10]);
  return { solid, dashed, R, floor, halfLife: hl };
}

// 机龄（月）：采集日期 - 发布月
function ageMonths(dateStr, releaseStr) {
  const [dy, dm] = dateStr.split('-').map(Number);
  const [ry, rm] = releaseStr.split('-').map(Number);
  return (dy - ry) * 12 + (dm - rm);
}

const SNAP = flat.meta.snapshot_date;
const groups = GROUPS.map(g => {
  const curves = [];
  const dots = [];
  for (const cat of g.cats) {
    const meta = CURVE_META[cat];
    const cp = curvePoints(cat);
    curves.push({ cat, label: meta.label, color: meta.color, solid: cp.solid, dashed: cp.dashed, floor: cp.floor });
    for (const r of flat.rows.filter(x => x.cat === cat && x.type === '二手')) {
      const rel = matchRelease(cat, r.item);
      if (!rel) continue;
      const xy = r.ch['闲鱼中位'], ref = r.ch['闲鱼参考'];
      const price = xy && xy.s === 'num' ? xy.v : (ref && ref.s === 'ref' ? ref.v : null);
      if (!price || !r.denom) continue;
      const date = r.date && r.date !== '—' ? r.date : SNAP;
      const age = ageMonths(date, rel);
      const rate = Math.round(price / r.denom * 1000) / 10;
      const theory = Math.round(cp.R(age) * 10) / 10;
      dots.push({
        cat, item: r.item, label: r.item.replace(/_二手$/, '').replace(/_/g, ' '),
        age, price, denom: r.denom, dsrc: r.dsrc, rate, theory,
        dev: Math.round((rate - theory) * 10) / 10,
        conf: r.confLevel, confText: r.conf, date, release: rel,
        isRef: !(xy && xy.s === 'num'), color: meta.color
      });
    }
  }
  dots.sort((a, b) => a.age - b.age || b.rate - a.rate);
  return { key: g.key, title: g.title, curves, dots };
});

// 汇总
const allDots = groups.flatMap(g => g.dots);
const devStats = groups.map(g => {
  const real = g.dots.filter(d => !d.isRef);
  const devs = real.map(d => d.dev);
  return { key: g.key, title: g.title, n: real.length, refN: g.dots.length - real.length,
    mean: Math.round(devs.reduce((a, b) => a + b, 0) / devs.length * 10) / 10,
    min: Math.min(...devs), max: Math.max(...devs) };
});

const macMiniDots = groups.find(g => g.key === 'Mac_mini').dots.filter(d => !d.isRef);
const macMiniV45Mae = macMiniDots.reduce((sum, d) => sum + Math.abs(d.price / d.denom * 100 - rateFromKnots(MAC_MINI_V45, d.age)), 0) / macMiniDots.length;
const macMiniV48Mae = macMiniDots.reduce((sum, d) => sum + Math.abs(d.price / d.denom * 100 - rateFromKnots(CURVES.Mac_mini, d.age, 5, 45)), 0) / macMiniDots.length;
const legacyMacMiniPoints = [];
for (let t = 0; t <= 84; t += 3) legacyMacMiniPoints.push([t, Math.round(rateFromKnots(MAC_MINI_V45, t) * 10) / 10]);
const macMiniCalibration = {
  v45Mae: Math.round(macMiniV45Mae * 100) / 100,
  v48Mae: Math.round(macMiniV48Mae * 100) / 100,
  legacyPoints: legacyMacMiniPoints,
  month23: { v45: 66.17, v48: 57.17, observed: 55.01 },
  month44: { v45: 48, v48: 43, observedMedian: 42.86 }
};

const payload = {
  meta: { snapshot_date: SNAP, version: flat.meta.version, dots: allDots.length,
    refDots: allDots.filter(d => d.isRef).length,
    ageMin: Math.min(...allDots.map(d => d.age)), ageMax: Math.max(...allDots.map(d => d.age)) },
  groups, devStats, macMiniCalibration,
  dots: allDots
};

fs.writeFileSync(path.join(__dirname, 'debug', 'residual-curves-payload.json'), JSON.stringify(payload, null, 1), 'utf8');

// ---------- HTML ----------
const TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>苹果产品残值曲线 · __VERSION__ 快照 __SNAP__</title>
<style>
:root{
  --bg:#F5F5F7; --surface:#FFFFFF; --rule:#D2D2D8; --muted:#86868F; --fg:#1D1D1F;
  --accent:#007AFF; --accent-soft:#E6F2FF;
  --success:#2A8A61; --success-soft:#D9F0E3;
  --warning:#E09500; --warning-soft:#FFF0C2;
  --error:#F24B4B; --error-soft:#FFD9D9;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:'Inter','PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6}
h1,h2,h3,h4{font-family:'DM Sans','Inter','PingFang SC','Microsoft YaHei',sans-serif}
.num{font-family:'JetBrains Mono',monospace}
.top-nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.88);backdrop-filter:saturate(1.8) blur(20px);border-bottom:1px solid var(--rule);padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:56px}
.top-nav .brand{font-family:'DM Sans','PingFang SC',sans-serif;font-weight:600;font-size:16px}
.top-nav .meta{color:var(--muted);font-size:12px}
main{max-width:1280px;margin:0 auto;padding:24px 24px 64px}
section{margin-top:40px}
.sec-title{font-size:20px;font-weight:600;margin-bottom:4px}
.sec-sub{color:var(--muted);font-size:13px;margin-bottom:16px}
.card{background:var(--surface);border-radius:20px;box-shadow:0 1px 2px rgba(29,29,31,.04),0 4px 16px rgba(29,29,31,.04);padding:24px}
.grid-kpi{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.kpi{background:var(--surface);border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(29,29,31,.04)}
.kpi .k-label{font-size:12px;color:var(--muted)}
.kpi .k-value{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:600;margin-top:2px}
.kpi .k-note{font-size:11px;color:var(--muted);margin-top:2px}
.findings{margin-top:16px;display:grid;gap:12px}
.finding{display:grid;grid-template-columns:64px 1fr;gap:16px;background:var(--surface);border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(29,29,31,.04)}
.badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;white-space:nowrap}
.badge-warn{background:var(--warning-soft);color:#8A6400}
.badge-info{background:var(--accent-soft);color:var(--accent)}
.badge-error{background:var(--error-soft);color:var(--error)}
.badge-default{background:#EDEDF0;color:var(--muted)}
.finding .f-title{font-weight:600;font-size:14px;margin-bottom:4px}
.finding .f-detail{color:#48484D;font-size:13px}
.panel-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px}
.panel-title{font-weight:600;font-size:16px}
.panel-note{color:var(--muted);font-size:12px;margin-bottom:8px}
.picker{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.picker select{border:1px solid var(--rule);border-radius:8px;padding:6px 10px;font-size:13px;background:var(--surface);color:var(--fg);max-width:280px}
.legend-note{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:8px}
.legend-note .sw{display:inline-block;width:18px;height:3px;border-radius:2px;vertical-align:middle;margin-right:4px}
.legend-note .dt{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle;margin-right:4px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.table-wrap{overflow:auto;border:1px solid var(--rule);border-radius:12px;max-height:520px}
table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}
thead th{position:sticky;top:0;background:#FAFAFC;z-index:2;font-weight:600;font-size:11px;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--rule);text-align:left;cursor:pointer}
tbody td{padding:6px 10px;border-bottom:1px solid #EDEDF0}
tbody tr:hover{background:#F7F9FC}
.cell-num{font-family:'JetBrains Mono',monospace}
.dev-pos{color:var(--error);font-weight:600}
.dev-neg{color:var(--success);font-weight:600}
.conf-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
footer{margin-top:48px;color:var(--muted);font-size:12px;border-top:1px solid var(--rule);padding-top:16px;line-height:1.8}
@media (max-width:900px){.grid-kpi{grid-template-columns:repeat(2,1fr)}.two-col{grid-template-columns:1fr}.finding{grid-template-columns:1fr}}
</style>
</head>
<body>
<nav class="top-nav">
  <div class="brand">苹果产品残值曲线</div>
  <div class="meta">constants v__VERSION__ · 快照 __SNAP__ · 生成 __GENERATED__</div>
</nav>
<main>

<section>
  <h2 class="sec-title">一 · 总览</h2>
  <p class="sec-sub">五大品类（Mac mini / iPhone / MacBook Air / MacBook Pro / iPad）共 10 条子品类残值曲线，叠加 __NDOT__ 个具体机型的实测点位（快照闲鱼价 ÷ 当前在售新品官价，机龄按各机型发布月计算）。</p>
  <div class="grid-kpi">
    <div class="kpi"><div class="k-label">理论曲线</div><div class="k-value" style="color:var(--accent)">10</div><div class="k-note">子品类 · 0-84 月</div></div>
    <div class="kpi"><div class="k-label">实测点位</div><div class="k-value" style="color:var(--accent)">__NDOT__</div><div class="k-note">实价 __NREAL__ / 参考价 __NREF__</div></div>
    <div class="kpi"><div class="k-label">机龄跨度</div><div class="k-value">__AGEMIN__-__AGEMAX__</div><div class="k-note">月 · 覆盖曲线实测段与外推段</div></div>
    <div class="kpi"><div class="k-label">平均偏差</div><div class="k-value" style="color:var(--error)">__AVGDEV__pp</div><div class="k-note">实测 − 理论（5 品类组均值）</div></div>
    <div class="kpi"><div class="k-label">|偏差|>15pp</div><div class="k-value" style="color:var(--warning)">__NDEV__</div><div class="k-note">大容量 / 涨价环境溢价点</div></div>
  </div>
  <div class="findings">
    <div class="finding"><div><span class="badge badge-warn">校准</span></div><div><div class="f-title">Mac mini 中期曲线已对齐耐久价格中枢，MAE __MAC_MAE_OLD__pp → __MAC_MAE_NEW__pp</div><div class="f-detail">用户于 2026-09-24 确认五个 M4/M2 同配置价格经较长时间多次观察稳定。v4.8 将 18/24/36/48 月节点由 72/65/52/46 调整为 68/55/47/41；23 月 M4 理论值 66.17%→57.17%（实测 55.01%），44 月理论值 48%→43%（M2 四配置中位 42.86%）。</div></div></div>
    <div class="finding"><div><span class="badge badge-error">异常</span></div><div><div class="f-title">大容量机型偏差最大：iPhone 14 512G 达 +52.6pp</div><div class="f-detail">偏差前五（iPhone 14 512G +52.6、iPad Air M2 256G +34.1、iPhone 16 Pro 512G +28.5、MacBook Pro M3Pro 36G +27.6、iPhone 13 512G +27.3pp）中四席为大容量机型。存储超级周期对大容量二手的溢价远超曲线假设，512G 档实测残值 50-83%，曲线理论仅 22-45%。</div></div></div>
    <div class="finding"><div><span class="badge badge-info">提示</span></div><div><div class="f-title">60 月外推区实测全部超曲线：floor 偏保守</div><div class="f-detail">机龄 60-70 月的 8 个实测点全部为正偏差（+1.0 ～ +18.9pp）：Mac mini M1 四档（v4.5 半衰期校准 24→45 月后，该段理论值已由约 27.7% 上修至 31.1%，缺口收窄但大内存档仍 +18.9）、iPhone 12 两档（+1.4 / +17.7）、MacBook Air M1 两档（+15.4 / +17.0）。外推渐近线（floor 3-5%）基于 Intel/老款锚点，未反映当前涨价环境下的老设备底价抬升。</div></div></div>
    <div class="finding"><div><span class="badge badge-info">背景</span></div><div><div class="f-title">Mac mini 曲线完成三轮校准，长期段保持稳定</div><div class="f-detail">v3.9.1 将海外曲线校准为中国市场口径；v4.5 将 60 月后半衰期校准为 45 月；v4.8 只下调 18–48 月中期节点。0–12 月与 60 月节点保持不变，因此 M1 69 月理论值仍为 31.12%，不会用本次 M4/M2 中期样本污染长期外推。</div></div></div>
  </div>
</section>

<section>
  <h2 class="sec-title">二 · 全品类曲线对比</h2>
  <p class="sec-sub">0-60 月为曲线实测段（实线），60-84 月为指数衰减外推（虚线，R(t)=floor+(R(60)-floor)×0.5^((t-60)/h)，h 为品类专属半衰期——v4.5 起由统一 24 月按双指数拟合校准为 17～45 月，如 Mac mini 45 / iPhone ProMax 40 / MacBook Air 22）。</p>
  <div class="card"><div id="chart-overview" style="width:100%;height:500px"></div>
    <div class="legend-note"><span>实线 = 曲线实测段</span><span>虚线 = 60 月后外推</span><span>点击图例可切换品类</span></div>
  </div>
</section>

__PANELS__

<section>
  <h2 class="sec-title">八 · 实测 vs 理论偏差分析</h2>
  <p class="sec-sub">偏差 = 实测残值率 − 理论 R(机龄)，单位 pp。正值表示市场价强于曲线（涨价环境 + 口径差异 + 大容量溢价）。</p>
  <div class="two-col">
    <div class="card"><div class="panel-title" style="margin-bottom:12px">品类平均偏差</div><div id="chart-dev" style="width:100%;height:320px"></div></div>
    <div class="card"><div class="panel-title" style="margin-bottom:12px">偏差分布（每点一条）</div><div id="chart-dev-dist" style="width:100%;height:320px"></div></div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="panel-title" style="margin-bottom:12px">全部实测点明细（点击表头排序）</div>
    <div class="table-wrap"><table id="dev-table"><thead><tr>
      <th>品类</th><th>机型</th><th>发布</th><th>机龄(月)</th><th>闲鱼价</th><th>分母</th><th>实测%</th><th>理论%</th><th>偏差pp</th><th>置信</th><th>口径</th>
    </tr></thead><tbody></tbody></table></div>
  </div>
</section>

<footer>
  <b>口径说明</b>：①理论曲线来自 constants「保值率曲线」，残值率相对<b>发布价</b>，基于历史均值；②实测点 = 快照闲鱼中位价（挂价口径，通常高于实付 5-10%）÷ 残值分母（优先本条官方价 / 说明明示 / 同品类在售新品官价），机龄 = 价格采集日期 − 机型发布月；③两者口径存在系统偏差（当前新品价普遍高于原发布价 + 挂价溢价），实测点用于观察曲线形态拟合与相对异常，不宜直接对标曲线绝对值；④「未来轨迹」为交互演示：以当前实测价为锚，按品类曲线相对衰减推算（v4.3 买入价锚定口径 残值=买入价×R(t卖出)/R(t买入) 的可视化）。<br>
  数据源：.agents/skills/apple-value-analysis/constants.json（v__VERSION__，快照 __SNAP__）· 产品发布日期 × 实时市场价快照 · 生成脚本 scripts/visualize-residual-curves.mjs
</footer>
</main>

<script id="payload" type="application/json">__PAYLOAD__</script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<script>
var D = JSON.parse(document.getElementById('payload').textContent);
var charts = [];
function mkChart(id, opt){ var c = echarts.init(document.getElementById(id)); c.setOption(opt); charts.push(c); return c; }
window.addEventListener('resize', function(){ charts.forEach(function(c){ c.resize(); }); });
var AXIS = { axisLine:{lineStyle:{color:'#D2D2D8'}}, axisLabel:{color:'#86868F', fontSize:11}, splitLine:{lineStyle:{color:'#EDEDF0'}} };
var CONF_COLOR = { '高':'#2A8A61','中':'#007AFF','中低':'#E09500','低':'#E09500','无':'#86868F' };

// 曲线插值（前端）
function interp(points, t){
  if (t <= points[0][0]) return points[0][1];
  for (var i = 0; i < points.length - 1; i++){
    if (t >= points[i][0] && t <= points[i+1][0]){
      var f = (t - points[i][0]) / (points[i+1][0] - points[i][0]);
      return points[i][1] + (points[i+1][1] - points[i][1]) * f;
    }
  }
  return points[points.length-1][1];
}
function curveAll(c){ return c.solid.concat(c.dashed); }
function fmt(n){ return (n===null||n===undefined) ? '—' : Number(n).toLocaleString('zh-CN'); }

function markLine60(){
  return { symbol:'none', silent:true, lineStyle:{ color:'#C7C7CC', type:'dashed' },
    label:{ color:'#86868F', fontSize:10, formatter:'60月 · 外推起点' }, data:[{ xAxis:60 }] };
}

// ===== 总览 =====
(function(){
  var series = [];
  D.groups.forEach(function(g){
    g.curves.forEach(function(c){
      series.push({ name:c.label, type:'line', data:c.solid, showSymbol:false, smooth:0.15,
        lineStyle:{ color:c.color, width:2.5 }, itemStyle:{ color:c.color },
        endLabel:{ show:true, formatter:c.label, color:c.color, fontSize:11, fontWeight:600, distance:6 } });
      series.push({ name:c.label+'·外推', type:'line', data:c.dashed, showSymbol:false, smooth:0.15,
        lineStyle:{ color:c.color, width:1.5, type:'dashed', opacity:0.55 }, itemStyle:{ color:c.color }, tooltip:{show:false} });
    });
  });
  var names = [];
  D.groups.forEach(function(g){ g.curves.forEach(function(c){ names.push(c.label); names.push(c.label+'·外推'); }); });
  mkChart('chart-overview', {
    tooltip:{ trigger:'axis', ...{ backgroundColor:'#fff', borderColor:'#D2D2D8', textStyle:{color:'#1D1D1F',fontSize:12}, extraCssText:'box-shadow:0 4px 16px rgba(29,29,31,.12);border-radius:12px;' },
      valueFormatter:function(v){ return v + '%'; } },
    legend:{ type:'scroll', top:0, textStyle:{color:'#48484D',fontSize:11}, itemWidth:16, itemHeight:8, data: names },
    grid:{ left:44, right:96, top:42, bottom:32 },
    xAxis:{ type:'value', name:'发布后月数', min:0, max:84, ...AXIS },
    yAxis:{ type:'value', name:'残值率 %', min:0, max:100, ...AXIS },
    series: series
  });
})();

// ===== 品类面板 =====
D.groups.forEach(function(g, gi){
  var el = document.getElementById('panel-' + gi);
  if (!el) return;
  var chart = echarts.init(el.querySelector('.panel-chart'));
  charts.push(chart);
  var sel = el.querySelector('select');
  var dots = g.dots;

  function optionFor(selIdx){
    var series = [];
    if (g.key === 'Mac_mini') {
      series.push({ name:'Mac mini v4.5 基线', type:'line', data:D.macMiniCalibration.legacyPoints,
        showSymbol:false, smooth:0.15, lineStyle:{ color:'#86868F', width:1.5, type:'dashed' },
        itemStyle:{ color:'#86868F' }, z:1 });
    }
    g.curves.forEach(function(c, ci){
      var s = { name:c.label + ' 曲线', type:'line', data:c.solid, showSymbol:false, smooth:0.15,
        lineStyle:{ color:c.color, width:2.5 }, itemStyle:{ color:c.color }, z:2 };
      if (ci === 0) s.markLine = markLine60();
      series.push(s);
      series.push({ name:'_', type:'line', data:c.dashed, showSymbol:false, smooth:0.15,
        lineStyle:{ color:c.color, width:1.5, type:'dashed', opacity:0.5 }, itemStyle:{ color:c.color }, tooltip:{show:false}, z:2 });
    });
    // 实测点（按曲线色分组）
    var byCurve = {};
    dots.forEach(function(d, i){
      var key = d.cat;
      byCurve[key] = byCurve[key] || [];
      var pt = { value:[d.age, d.rate], dot:d, idx:i,
        itemStyle: d.isRef ? { color:'transparent', borderColor:d.color, borderWidth:2, borderType:'dashed' }
                           : { color:d.color, borderColor:'#fff', borderWidth:1.5 },
        symbolSize: d.isRef ? 9 : (Math.abs(d.dev) > 15 ? 11 : 9) };
      if (Math.abs(d.dev) > 15 && !d.isRef) pt.itemStyle.borderColor = '#F24B4B', pt.itemStyle.borderWidth = 2;
      byCurve[key].push(pt);
    });
    Object.keys(byCurve).forEach(function(key){
      var color = (g.curves.find(function(c){ return c.cat === key; }) || {}).color || '#86868F';
      series.push({ name:(CURVE_LABEL(key)), type:'scatter', data:byCurve[key],
        itemStyle:{ color:color }, symbolSize:9, z:4,
        emphasis:{ scale:1.5 },
        labelLayout:{ hideOverlap:true } });
    });
    // 选中轨迹
    if (selIdx !== null && selIdx >= 0 && dots[selIdx]){
      var d = dots[selIdx];
      var curve = g.curves.find(function(c){ return c.cat === d.cat; }) || g.curves[0];
      var all = curveAll(curve);
      var Rnow = interp(all, d.age);
      var track = [];
      for (var t = d.age; t <= 84; t += 3){
        var r = d.price * interp(all, t) / Rnow;
        track.push([t, Math.round(r / d.denom * 1000) / 10, r]);
      }
      series.push({ name:'未来轨迹', type:'line', data:track.map(function(p){ return [p[0], p[1]]; }),
        showSymbol:false, smooth:0.15, lineStyle:{ color:'#1D1D1F', width:2, type:[6,4] }, z:5,
        endLabel:{ show:true, formatter:function(p){ return Math.round(p.value) + '%'; }, color:'#1D1D1F', fontSize:11, fontWeight:600 } });
      series.push({ name:'当前', type:'scatter', data:[{ value:[d.age, d.rate],
        itemStyle:{ color:'#1D1D1F', borderColor:'#fff', borderWidth:2 }, symbolSize:16 }],
        symbol:'circle', z:6,
        label:{ show:true, formatter:d.label, position:'top', color:'#1D1D1F', fontSize:11, fontWeight:600 } });
    }
    return {
      tooltip:{ trigger:'item', confine:true, backgroundColor:'#fff', borderColor:'#D2D2D8',
        textStyle:{color:'#1D1D1F',fontSize:12}, extraCssText:'box-shadow:0 4px 16px rgba(29,29,31,.12);border-radius:12px;',
        formatter:function(p){
          if (p.seriesName === '未来轨迹') return '机龄 ' + p.value[0] + ' 月<br>预期残值率 ≈ ' + p.value[1] + '%';
          if (p.seriesName === '当前') return '<b>选中</b>';
          if (p.data && p.data.dot){
            var d = p.data.dot;
            return '<b>' + d.label + '</b><br>发布 ' + d.release + ' · 机龄 ' + d.age + ' 月<br>'
              + '闲鱼价 ¥' + fmt(d.price) + ' ÷ 分母 ¥' + fmt(d.denom) + '<br>'
              + '实测 <b>' + d.rate + '%</b> · 理论 ' + d.theory + '% · 偏差 ' + (d.dev > 0 ? '+' : '') + d.dev + 'pp<br>'
              + '置信 ' + d.conf + (d.isRef ? ' · 参考价口径' : '') + '<br>采集 ' + d.date;
          }
          return p.seriesName + ' · ' + p.value[0] + '月 = ' + p.value[1] + '%';
        } },
      legend:{ top:0, textStyle:{color:'#48484D',fontSize:11}, itemWidth:16, itemHeight:8,
        data: (g.key === 'Mac_mini' ? ['Mac mini v4.5 基线'] : []).concat(g.curves.map(function(c){ return c.label + ' 曲线'; })) },
      grid:{ left:44, right:60, top:40, bottom:30 },
      xAxis:{ type:'value', name:'机龄(月)', min:0, max:84, ...AXIS },
      yAxis:{ type:'value', name:'残值率 %', min:0, max:100, ...AXIS },
      series: series
    };
  }
  function CURVE_LABEL(cat){
    var c = g.curves.find(function(x){ return x.cat === cat; });
    return c ? c.label + ' 实测' : '实测';
  }

  dots.forEach(function(d, i){
    var o = document.createElement('option');
    o.value = i; o.textContent = d.label + '（' + d.age + '月 · ' + d.rate + '%）';
    sel.appendChild(o);
  });
  var noneO = document.createElement('option');
  noneO.value = '-1'; noneO.textContent = '— 选择产品查看未来残值轨迹 —';
  sel.insertBefore(noneO, sel.firstChild);
  sel.value = '-1';

  function update(){
    var v = parseInt(sel.value, 10);
    chart.setOption(optionFor(isNaN(v) || v < 0 ? null : v), true);
  }
  sel.addEventListener('change', update);
  chart.on('click', function(p){
    if (p.data && p.data.dot) { sel.value = String(p.data.idx); update(); }
  });
  chart.setOption(optionFor(null));
});

// ===== 偏差分析 =====
(function(){
  mkChart('chart-dev', {
    tooltip:{ trigger:'axis', axisPointer:{type:'shadow'} },
    grid:{ left:110, right:30, top:16, bottom:26 },
    xAxis:{ type:'value', name:'平均偏差 pp', ...AXIS },
    yAxis:{ type:'category', data: D.devStats.map(function(s){ return s.title; }), axisLabel:{color:'#1D1D1F',fontSize:12}, axisLine:{show:false}, axisTick:{show:false} },
    series:[{ type:'bar', barMaxWidth:22,
      data: D.devStats.map(function(s){ return { value:s.mean, itemStyle:{ color: s.mean > 0 ? '#F24B4B' : '#2A8A61', borderRadius:[0,4,4,0] } }; }),
      label:{ show:true, position:'right', fontSize:11, color:'#48484D', formatter:function(p){ return (p.value>0?'+':'') + p.value; } } }]
  });
  var gColors = { Mac_mini:'#007AFF', iPhone:'#5856D6', MacBook_Air:'#2A8A61', MacBook_Pro:'#E09500', iPad:'#F24B4B' };
  var gNames = { Mac_mini:'Mac mini', iPhone:'iPhone', MacBook_Air:'MacBook Air', MacBook_Pro:'MacBook Pro', iPad:'iPad' };
  function catGroup(cat){
    if (cat === 'Mac_mini') return 'Mac_mini';
    if (cat.indexOf('iPhone') === 0) return 'iPhone';
    if (cat === 'MacBook_Air') return 'MacBook_Air';
    if (cat === 'MacBook_Pro') return 'MacBook_Pro';
    return 'iPad';
  }
  var bins = [];
  for (var b = -20; b <= 50; b += 10) bins.push(b);
  var binLabels = bins.map(function(b){ return (b > 0 ? '+' : '') + b + '~' + (b + 10 > 0 ? '+' : '') + (b + 10); });
  var dist = D.dots.filter(function(d){ return !d.isRef; });
  var groupKeys = ['Mac_mini','iPhone','MacBook_Air','MacBook_Pro','iPad'];
  var distSeries = groupKeys.map(function(gk){
    return { name:gNames[gk], type:'bar', stack:'d', barMaxWidth:30, color:gColors[gk],
      emphasis:{ focus:'series' },
      data: bins.map(function(b){
        return dist.filter(function(d){ return catGroup(d.cat) === gk && d.dev >= b && d.dev < b + 10; }).length;
      }) };
  });
  mkChart('chart-dev-dist', {
    tooltip:{ trigger:'axis', axisPointer:{type:'shadow'} },
    legend:{ top:0, textStyle:{color:'#48484D',fontSize:11}, itemWidth:12, itemHeight:8 },
    grid:{ left:36, right:16, top:40, bottom:30 },
    xAxis:{ type:'category', data:binLabels, name:'偏差 pp', ...AXIS, axisLabel:{color:'#48484D',fontSize:10} },
    yAxis:{ type:'value', name:'点数', ...AXIS },
    series: distSeries
  });
})();

// ===== 明细表 =====
(function(){
  var gmap = {}; D.groups.forEach(function(g){ g.dots.forEach(function(d){ gmap[d.cat + '/' + d.item] = g.title; }); });
  var rows = D.dots.map(function(d){
    return { cat: gmap[d.cat + '/' + d.item], item: d.label, rel: d.release, age: d.age, price: d.price,
      denom: d.denom, rate: d.rate, theory: d.theory, dev: d.dev, conf: d.conf, ref: d.isRef };
  });
  var tbody = document.querySelector('#dev-table tbody');
  var sortKey = null, asc = false;
  function render(){
    var rs = rows.slice().sort(function(a, b){
      if (!sortKey) return b.dev - a.dev;
      var va = a[sortKey], vb = b[sortKey];
      return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
    });
    tbody.innerHTML = rs.map(function(r){
      return '<tr><td>' + r.cat + '</td><td><b>' + r.item + '</b></td><td class="cell-num">' + r.rel + '</td><td class="cell-num">' + r.age + '</td>'
        + '<td class="cell-num">¥' + fmt(r.price) + '</td><td class="cell-num">¥' + fmt(r.denom) + '</td>'
        + '<td class="cell-num">' + r.rate + '</td><td class="cell-num">' + r.theory + '</td>'
        + '<td class="cell-num ' + (r.dev > 0 ? 'dev-pos' : 'dev-neg') + '">' + (r.dev > 0 ? '+' : '') + r.dev + '</td>'
        + '<td><span class="conf-dot" style="background:' + CONF_COLOR[r.conf] + '"></span>' + r.conf + '</td>'
        + '<td>' + (r.ref ? '<span class="badge badge-warn">参考价</span>' : '实价') + '</td></tr>';
    }).join('');
  }
  document.querySelectorAll('#dev-table th').forEach(function(th, i){
    var keys = ['cat','item','rel','age','price','denom','rate','theory','dev','conf','ref'];
    th.addEventListener('click', function(){
      if (sortKey === keys[i]) asc = !asc; else { sortKey = keys[i]; asc = true; }
      render();
    });
  });
  render();
})();
</script>
</body>
</html>`;

// 面板 HTML
const panelHtml = groups.map((g, gi) => {
  const legends = g.curves.map(c =>
    `<span><span class="sw" style="background:${c.color}"></span>${c.label} 曲线</span><span><span class="dt" style="background:${c.color}"></span>${c.label} 实测</span>`).join('');
  const titleN = ['三', '四', '五', '六', '七'][gi];
  const calibrationLegend = g.key === 'Mac_mini' ? '<span><span class="sw" style="background:#86868F"></span>v4.5 基线（灰色虚线）</span>' : '';
  const calibrationNote = g.key === 'Mac_mini' ? '灰色虚线为 v4.5，蓝色实线为 v4.8，可直接比较中期下修。' : '';
  return `<section id="panel-${gi}">
  <h2 class="sec-title">${titleN} · ${g.title}</h2>
  <p class="sec-sub">${g.curves.length} 条曲线 × ${g.dots.length} 个实测点。${calibrationNote}选择具体产品后显示其未来残值轨迹（以当前价为锚，按曲线相对衰减）。</p>
  <div class="card">
    <div class="panel-head">
      <div class="panel-title">${g.title} 残值曲线</div>
      <div class="picker">产品轨迹 <select data-g="${gi}"></select></div>
    </div>
    <div class="panel-chart" style="width:100%;height:420px"></div>
    <div class="legend-note">${calibrationLegend}${legends}<span>空心虚框 = 参考价口径</span><span>红描边 = |偏差|>15pp</span></div>
  </div>
</section>`;
}).join('\n');

let html = TEMPLATE
  .replace(/__VERSION__/g, () => payload.meta.version)
  .replace(/__SNAP__/g, () => payload.meta.snapshot_date)
  .replace(/__GENERATED__/g, () => '2026-09-24')
  .replace(/__NDOT__/g, () => payload.meta.dots)
  .replace(/__NREAL__/g, () => payload.meta.dots - payload.meta.refDots)
  .replace(/__NREF__/g, () => payload.meta.refDots)
  .replace(/__AVGDEV__/g, () => { const m = devStats.reduce((a, b) => a + b.mean, 0) / devStats.length; return (m >= 0 ? '+' : '') + m.toFixed(1); })
  .replace(/__AGEMIN__/g, () => payload.meta.ageMin)
  .replace(/__AGEMAX__/g, () => payload.meta.ageMax)
  .replace(/__NDEV__/g, () => allDots.filter(d => Math.abs(d.dev) > 15 && !d.isRef).length)
  .replace(/__MAC_MAE_OLD__/g, () => payload.macMiniCalibration.v45Mae.toFixed(2))
  .replace(/__MAC_MAE_NEW__/g, () => payload.macMiniCalibration.v48Mae.toFixed(2))
  .replace('__PANELS__', () => panelHtml)
  .replace('__PAYLOAD__', () => JSON.stringify(payload).replace(/</g, '\\u003c'));

const outPath = path.join(ROOT, `${SNAP}-产品残值曲线可视化.html`);
fs.writeFileSync(outPath, html, 'utf8');

console.log('=== 数据汇总 ===');
console.log('实测点:', allDots.length, '（实价', allDots.filter(d => !d.isRef).length, '/ 参考价', allDots.filter(d => d.isRef).length, '）');
console.log('机龄范围:', payload.meta.ageMin, '-', payload.meta.ageMax, '月');
groups.forEach(g => console.log(g.title + ': 曲线' + g.curves.length + '条, 实测点' + g.dots.length + '个'));
console.log('|dev|>15pp:', allDots.filter(d => Math.abs(d.dev) > 15 && !d.isRef).length);
console.log('Mac mini MAE: v4.5', payload.macMiniCalibration.v45Mae, '→ v4.8', payload.macMiniCalibration.v48Mae, 'pp');
console.log('报告:', outPath);
