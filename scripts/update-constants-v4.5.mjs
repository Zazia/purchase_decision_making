// v4.5 更新：①保值率曲线外推半衰期按品类双指数拟合校准 ②Mac mini M6官宣后5条二手价回填(用户实采)
// 用法: node scripts/update-constants-v4.5.mjs [--preview]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFILE = path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const PREVIEW = process.argv.includes('--preview');

const data = JSON.parse(fs.readFileSync(CFILE, 'utf8'));
const CURVES = data['保值率曲线'];
const SNAP = data['实时市场价快照'];

// ---------- M4 双指数拟合(确定性,与 fit-residual-functions.mjs 同模型) ----------
function nelderMead(obj, x0, step = 1, maxIter = 8000) {
  const n = x0.length;
  let simp = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step; simp.push(p); }
  let f = simp.map(obj);
  for (let it = 0; it < maxIter; it++) {
    const order = f.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    simp = order.map(o => simp[o[1]]); f = order.map(o => o[0]);
    if (Math.abs(f[n] - f[0]) < 1e-12) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simp[i][j] / n;
    const xr = c.map((v, i) => v + (v - simp[n][i]));
    const fr = obj(xr);
    if (fr < f[0]) {
      const xe = c.map((v, i) => v + 2 * (v - simp[n][i]));
      const fe = obj(xe);
      if (fe < fr) { simp[n] = xe; f[n] = fe; } else { simp[n] = xr; f[n] = fr; }
    } else if (fr < f[n - 1]) { simp[n] = xr; f[n] = fr; }
    else {
      const xc = c.map((v, i) => v + 0.5 * (simp[n][i] - v));
      const fc = obj(xc);
      if (fc < f[n]) { simp[n] = xc; f[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          simp[i] = simp[0].map((v, j) => v + 0.5 * (simp[i][j] - v));
          f[i] = obj(simp[i]);
        }
      }
    }
  }
  const bi = f.indexOf(Math.min(...f));
  return { x: simp[bi], fx: f[bi] };
}

const CATS = Object.keys(CURVES).filter(k => !k.startsWith('_'));

function fitH2(cat) {
  const e = CURVES[cat];
  const knots = Object.keys(e).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  const ts = knots, vs = knots.map(t => e[String(t)]);
  const BIG = 1e9;
  const sse = p => {
    if (p[0] < 0 || p[0] > 1 || p[1] < 1 || p[1] > 60 || p[2] < 10 || p[2] > 400) return BIG;
    let s = 0;
    for (let i = 0; i < ts.length; i++) {
      const v = 100 * (p[0] * Math.pow(2, -ts[i] / p[1]) + (1 - p[0]) * Math.pow(2, -ts[i] / p[2]));
      s += (v - vs[i]) ** 2;
    }
    return s;
  };
  let best = null;
  for (const st of [[0.2, 3, 30], [0.05, 1, 40], [0.3, 8, 25], [0.1, 2, 35]]) {
    const r = nelderMead(sse, st.slice(), 0.5);
    if (!best || r.fx < best.fx) best = r;
  }
  const [w, h1, h2] = best.x;
  return { w, h1, h2 };
}

// ---------- ① 半衰期校准 ----------
const hlChanges = [];
for (const cat of CATS) {
  const { w, h1, h2 } = fitH2(cat);
  const old = CURVES[cat]._half_life_months;
  const neu = Math.round(h2);
  const e = CURVES[cat];
  const floor = e._floor ?? 3, R60 = e['60'];
  const ext84old = floor + (R60 - floor) * Math.pow(0.5, 24 / 24);
  const ext84new = floor + (R60 - floor) * Math.pow(0.5, 24 / neu);
  hlChanges.push({ cat, old, neu, w, h1, h2, R60, ext84old, ext84new });
  if (!PREVIEW) CURVES[cat]._half_life_months = neu;
}

// ---------- ② Mac mini 二手价回填(用户实采 2026-09-08, M6官宣后/发售前) ----------
const MM = SNAP['Mac_mini'];
const DATE = '2026-09-08';
const updates = [
  {
    key: 'M4_16G_256G_二手', price: 3850, old: 4200,
    refFrom: '叫价/挂价口径(v4.2拆分整理,搜索日期2026-08-26):smzdm 4000+/V2EX明盘4500/时间序列3月3500→8月4200-4500,综合取4200',
    refRange: [3500, 4600],
    remark: '用户提供实采价3850元(2026-09-08,M6官宣8-25后/发售9-22前)。官宣前叫价4200元(2026-08-26)→现3850,回落8.3%:M6涨价发布(6999较M4末期5999涨16.7%)未抵消老款折价。相对M6分母6999隐含保值率55.0%'
  },
  {
    key: 'M2_16G_256G_二手', price: 3200, old: 3566,
    refFrom: '闲鱼挂价口径(2026-07-27采集,4样本,3480-3650元,中位3566元);更早V2EX论坛参考2700元(2026-04)',
    refRange: [3480, 3650],
    remark: '用户提供实采价3200元(2026-09-08,M6官宣后)。轨迹:V2EX参考2700(2026-04)→闲鱼挂价3566(2026-07-27)→现3200,口径混合仅供参考。相对M6分母6999隐含保值率45.7%(16G内存配置溢价推高,曲线口径基于8G基础款)'
  },
  {
    key: 'M2_16G_512G_二手', price: 3500, old: 4799,
    refFrom: '闲鱼挂价口径(2026-08-07采集,7样本,3180-4880元,中位4799元,Playwright CDP)',
    refRange: [3180, 4880],
    remark: '用户提供实采价3500元(2026-09-08,M6官宣后)。官宣前闲鱼挂价4799元(2026-08-07,7样本)→现3500,回落27%,M6官宣冲击显著(含512G溢价泡沫挤出)。相对M6分母6999隐含保值率50.0%(512G配置溢价未在分母体现,保值率偏高)'
  },
  {
    key: 'M2_8G_256G_二手', price: 2300, old: 2675,
    refFrom: '闲鱼挂价口径(2026-08-07采集,仅2样本,2600-2750元,中位2675元,Playwright CDP)',
    refRange: [2600, 2750],
    remark: '用户提供实采价2300元(2026-09-08,M6官宣后)。官宣前闲鱼挂价2675元(2026-08-07,仅2样本)→现2300,回落14%。相对M6分母6999隐含保值率32.9%'
  }
];

for (const u of updates) {
  const it = MM[u.key];
  if (!it) throw new Error(`条目不存在: ${u.key}`);
  if (!PREVIEW) {
    it['闲鱼中位价_二手同款'] = u.price;
    it['闲鱼中位价_二手同款_参考'] = u.old;
    it['闲鱼中位价_二手同款_参考区间'] = u.refRange;
    it['闲鱼中位价_二手同款_参考来源'] = u.refFrom;
    it['闲鱼中位价_来源'] = `用户提供实采数据(${DATE},M6官宣8-25后/发售9-22前观察价)`;
    it['搜索来源URL'] = [];
    it['搜索日期'] = DATE;
    it['样本量'] = '用户提供实采数据1条';
    it['置信度'] = '高(用户提供实采数据)';
    it['备注'] = u.remark;
    // 旧挂价附属字段与主值矛盾,信息已浓缩进 _参考 系列与备注
    delete it['闲鱼价格区间'];
    delete it['闲鱼样本量'];
    delete it['闲鱼价格明细'];
  }
}

// 新建 M2_8G_512G_二手
if (!MM['M2_8G_512G_二手']) {
  const neu = {
    官方价: null,
    官方价_说明: '已停产。残值分母使用当前同品类新品价=Mac mini M6官方价6999元(基础款)。注:512G版本配置溢价未在分母中体现,实测保值率会偏高',
    闲鱼中位价_二手同款: 2800,
    闲鱼中位价_二手同款_参考: null,
    京东拍拍价_二手: '无法搜索',
    爱回收售价_二手: '无法搜索',
    爱回收回收报价_下限: '无法搜索',
    样本量: '用户提供实采数据1条',
    搜索来源URL: [],
    搜索日期: DATE,
    置信度: '高(用户提供实采数据)',
    备注: `用户提供实采价2800元(${DATE},M6官宣后)。相对M6分母6999隐含保值率40.0%(512G配置溢价未在分母体现,保值率偏高)。M2 8G+512G为非标准配置组合,闲鱼流通少,此前无采集记录,本条为首条数据`,
    闲鱼中位价_来源: `用户提供实采数据(${DATE},M6官宣8-25后/发售9-22前观察价)`
  };
  if (!PREVIEW) MM['M2_8G_512G_二手'] = neu;
}

// ---------- ③ 近期重大价格事件追加 ----------
const EVENT = {
  事件: `${DATE} Mac mini M6官宣后二手价回落(用户实采)`,
  影响: 'M6官宣(8-25,6999元)+9-22发售临近,M4 16G/256G二手价4200→3850(-8.3%),M2 16G/512G 4799→3500(-27%),M2 16G/256G 3566→3200(-10%),M2 8G/256G 2675→2300(-14%):M6涨价发布形态未抵消老款折价,512G/16G高配溢价泡沫挤出更显著',
  处理: '5条实采价已回填快照(M4_16G_256G/M2_16G_256G/M2_16G_512G/M2_8G_256G更新,M2_8G_512G新建);旧挂价转参考价口径(_参考字段);9-22发售后需复采验证涨价发布冲击消退形态(参照_涨价发布实证参考_v4.1)',
  来源: `用户提供实采数据(${DATE})`
};
if (!PREVIEW) SNAP['近期重大价格事件'].push(EVENT);

// ---------- ④ 快照说明与日期 ----------
if (!PREVIEW) {
  SNAP['_快照更新说明_v4.5'] = `${DATE}刷新:Mac_mini 5条二手价(用户实采,M6官宣后,含新建M2_8G_512G条目)+保值率曲线外推半衰期按品类拟合校准;其余条目沿用2026-08-26快照值`;
  SNAP.snapshot_date = DATE;
}

// ---------- ⑤ 外推参数说明 ----------
if (!PREVIEW) {
  CURVES['_外推参数_v3.9']['_v4.5_更新'] = 'half_life_months由统一24改为按品类双指数拟合慢分量半衰期(2026-09-08拟合,模型R(t)=100×(w·2^(-t/h1)+(1-w)·2^(-t/h2)),h2为慢分量半衰期)。Mac_mini等换代慢品类长期残值此前被系统性低估(如Mac mini 84月外推20.0→25.4pp),AirPods等快消品类半衰期更短(~17月)。floor与公式形式不变,60月处仍锚定R(60)。拟合脚本:scripts/fit-residual-functions.mjs(0-60月knots平均RMSE 0.72pp)';
}

// ---------- ⑥ metadata ----------
if (!PREVIEW) {
  const m = data.metadata;
  m.version = '4.5';
  m.last_updated = DATE;
  m.data_sources.push(`用户提供实采数据(${DATE}):Mac mini M6官宣后M4/M2二手价5条(v4.5快照刷新);双指数拟合半衰期校准(scripts/fit-residual-functions.mjs)`);
  m['v4.5_变更摘要'] = [
    '保值率曲线外推半衰期按品类校准:60月后外推公式R(t)=floor+(R(60)-floor)×0.5^((t-60)/h)中h由统一24月改为按品类双指数拟合慢分量(2026-09-08,scripts/fit-residual-functions.mjs,18品类全量拟合)。Mac_mini 45月/iPhone_Pro 36月/MacBook_Air 22月等;修正Mac mini等换代慢品类长期残值系统性低估(84月外推20.0→25.4pp),AirPods等快消品类更短(~17月);floor与公式形式不变',
    `Mac mini M6官宣(8-25)后二手价回落,5条用户实采价回填(${DATE}):M4_16G_256G 4200→3850(-8.3%),M2_16G_256G 3566→3200,M2_16G_512G 4799→3500(-27%),M2_8G_256G 2675→2300,新建M2_8G_512G条目2800(此前无采集记录);旧挂价转参考价口径(_参考字段),置信度升级为高(用户实采)`,
    `近期重大价格事件追加M6官宣后回落条目;snapshot_date更新至${DATE}(仅Mac_mini品类与曲线参数刷新,其余沿用2026-08-26及更早采集值,见_快照更新说明_v4.5);残值分母沿用Mac mini M6基础款6999元`,
    '9-22 M6发售后待办:复采M4/M2二手价验证涨价发布冲击消退形态;10月iPhone 18系列发布后触发全量校验(v4.4摘要遗留)'
  ];
}

// ---------- 输出 ----------
console.log('=== ① 半衰期校准(18品类) ===');
console.log('品类'.padEnd(14) + 'h旧'.padStart(4) + 'h新'.padStart(5) + '  R60  84月外推(旧→新)  M4参数 w/h1/h2');
for (const c of hlChanges) {
  console.log(c.cat.padEnd(14) + String(c.old).padStart(4) + String(c.neu).padStart(5) + String(c.R60).padStart(5) + '   ' + c.ext84old.toFixed(1).padStart(5) + '→' + c.ext84new.toFixed(1) + 'pp    ' + `${(c.w * 100).toFixed(0)}%/${c.h1.toFixed(1)}/${c.h2.toFixed(1)}`);
}
console.log('\n=== ② Mac mini 二手价(用户实采) ===');
for (const u of updates) console.log(`${u.key}: ${u.old} → ${u.price} (${(((u.price - u.old) / u.old) * 100).toFixed(1)}%)`);
console.log('M2_8G_512G_二手: 新建 2800');
console.log('\n=== 隐含保值率(分母6999) ===');
for (const p of [3850, 3200, 3500, 2300, 2800]) console.log(`  ${p}元 → ${(p / 6999 * 100).toFixed(1)}%`);

if (PREVIEW) {
  console.log('\n[预览模式] 未写盘。去掉 --preview 执行实际更新。');
} else {
  fs.writeFileSync(CFILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const size = fs.statSync(CFILE).size;
  console.log(`\n已写入 ${CFILE} (${(size / 1024).toFixed(0)}KB, 云数据库安全上限450KB)`);
}
