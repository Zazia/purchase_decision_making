import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));
const snap = data['实时市场价快照'];

const CATEGORIES = ['Mac_mini','MacBook_Air','MacBook_Pro','iMac','Mac_Studio','Mac_Pro',
  'iPhone_proMax','iPhone_Pro','iPhone_标准','iPad_mini','Apple_Watch','AirPods',
  'Vision_Pro','Apple_TV','HomePod','iPad_Pro','iPad_Air','iPad_标准'];

const CHANNEL_FIELDS = {
  '官方价': '官方价',
  '京东自营价': '京东自营', '京东自营价_参考': '京东自营',
  '京东国补到手价': '国补到手', '京东国补到手价_参考': '国补到手',
  '京东国补到手价_PLUS版': '国补PLUS', '京东教育优惠_国补到手价_参考': '国补到手',
  '京东以旧换新到手价': '以旧换新',
  '闲鱼中位价': '闲鱼中位', '闲鱼中位价_二手同款': '闲鱼中位', '闲鱼中位价_原值': '闲鱼中位',
  '闲鱼中位价_二手同款_参考': '闲鱼参考',
  '闲鱼中位价_二手同款_参考_资讯稿': '闲鱼参考', '闲鱼中位价_二手同款_参考_资讯稿2': '闲鱼参考',
  '闲鱼中位价_二手同款_参考_卖家挂单': '闲鱼参考', '闲鱼中位价_二手同款_参考_海外': '闲鱼参考',
  '京东拍拍价': '京东拍拍', '京东拍拍价_二手': '京东拍拍', '转转_拍拍参考价': '京东拍拍',
  '爱回收售价': '爱回收售价', '爱回收售价_二手': '爱回收售价', '爱回收售价_多抓鱼参考': '爱回收售价',
  '爱回收回收报价': '爱回收回收', '爱回收回收报价_下限': '爱回收回收',
  '爱回收回收报价_线上': '爱回收回收', '爱回收回收报价_线下': '爱回收回收',
  '爱回收回收报价_线下95新': '爱回收回收', '爱回收回收报价_实测': '爱回收回收',
  '爱回收回收报价_估算': '爱回收回收',
  '苹果官方TradeIn折抵': '官方TradeIn', '苹果官方TradeIn折抵_128G参考': '官方TradeIn',
  '线下数码城95新': '线下渠道'
};
const CANONICAL = { '闲鱼中位价_二手同款': ['闲鱼中位价','闲鱼中位价_原值'], '京东拍拍价_二手': ['京东拍拍价','转转_拍拍参考价'], '爱回收售价_二手': ['爱回收售价'], '爱回收回收报价_下限': ['爱回收回收报价','爱回收回收报价_线上','爱回收回收报价_线下','爱回收回收报价_线下95新','爱回收回收报价_实测','爱回收回收报价_估算'] };
const NEW_CHANNELS = ['官方价','京东自营','国补到手','国补PLUS','以旧换新'];
const USED_CHANNELS = ['闲鱼中位','京东拍拍','爱回收售价','爱回收回收','官方TradeIn','线下渠道'];
const TABLE_CHANNELS = ['官方价','京东自营','国补到手','以旧换新','闲鱼中位','闲鱼参考','京东拍拍','爱回收售价','爱回收回收','官方TradeIn'];
const ALL_CHANNELS = TABLE_CHANNELS;
const REF_PREFIXES = [
  [/^苹果官网官翻机参考/, '官翻参考'], [/^苹果美国官翻机参考/, '美版官翻'],
  [/^参考价_美版官方价/, '美版参考'], [/^京东拍拍价区间/, '拍拍区间']
];

function classifyValue(f, v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') {
    if (v.includes('无法搜索') || v.includes('无数据') || v.includes('无结果') || v.includes('不支持')) return 'unavailable';
    if (/^-?[\d,.\s~±+万元()（）]+$/.test(v)) return 'numeric_string';
    if (/\d/.test(v) && (f.includes('参考') || v.includes('参考') || v.includes('资讯'))) return 'ref_text';
    return 'text';
  }
  return 'other';
}
function extractNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const nums = (v.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n >= 30);
    if (!nums.length) return null;
    if (nums.length >= 2 && /\d+\s*[-~到至]\s*\d+/.test(v)) return Math.round((nums[0] + nums[1]) / 2);
    return Math.round(nums[0]);
  }
  return null;
}

const records = [];
const issues = [];
const STRUCTURAL = { 'Apple_TV': '国行未销售', 'Mac_Pro': '已停产无在售款' };

for (const cat of CATEGORIES) {
  const catObj = snap[cat];
  if (!catObj) { issues.push({cat, item:'', type:'MISSING_CATEGORY', severity:'error', detail:'品类在快照中不存在'}); continue; }
  for (const [itemName, rec] of Object.entries(catObj)) {
    if (itemName.startsWith('_') || typeof rec !== 'object' || rec === null) continue;
    const row = {
      category: cat, item: itemName,
      isNew: itemName.includes('新品'), isUsed: itemName.includes('二手'),
      channels: {}, chStatus: {}, refClues: [], 闲鱼价格区间: null, 闲鱼样本量: null,
      样本量: null, 置信度: '', confLevel: '无', 搜索日期: '', sourceCount: 0,
      说明: rec['官方价_说明'] || '', 备注: (rec['备注'] || '').slice(0, 260), 分母: null, 分母来源: '',
      usedVariantFields: []
    };
    for (const c of ALL_CHANNELS) row.chStatus[c] = 'absent';

    for (const [f, v] of Object.entries(rec)) {
      const ch = CHANNEL_FIELDS[f];
      if (ch) {
        const st = classifyValue(f, v);
        if (row.chStatus[ch] === 'absent' || row.chStatus[ch] === 'unavailable') row.chStatus[ch] = st;
        if (st === 'number' || st === 'numeric_string') {
          if (typeof row.channels[ch] !== 'number') row.channels[ch] = extractNumber(v);
        } else if (st === 'ref_text') {
          const num = extractNumber(v);
          if (num && ch === '闲鱼中位') { if (typeof row.channels['闲鱼参考'] !== 'number') row.channels['闲鱼参考'] = num; }
          else if (num) row.refClues.push({ channel: ch, price: num, text: String(v).slice(0, 90) });
        }
      } else {
        for (const [re, label] of REF_PREFIXES) {
          if (re.test(f)) {
            const num = extractNumber(typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v));
            if (num) row.refClues.push({ channel: label, price: num, text: (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 90) });
          }
        }
      }
      for (const [canon, variants] of Object.entries(CANONICAL)) {
        if (variants.includes(f)) row.usedVariantFields.push({ used: f, canonical: canon });
      }
      if (f === '闲鱼价格区间' && Array.isArray(v)) row.闲鱼价格区间 = v;
      else if ((f === '闲鱼价格区间_95新' || f === '闲鱼价格区间_99新') && Array.isArray(v)) { row[f] = v; if (!row.闲鱼价格区间 && !row.闲鱼价格区间_95新 && !row.闲鱼价格区间_99新) row.闲鱼价格区间 = v; }
      else if (f === '闲鱼样本量') row.闲鱼样本量 = typeof v === 'number' ? v : extractNumber(v);
      else if (f === '样本量') row.样本量 = typeof v === 'number' ? String(v) : (typeof v === 'string' ? v : null);
      else if (f === '置信度') { row.置信度 = String(v).slice(0, 70); row.confLevel = v.startsWith('高') ? '高' : v.startsWith('中低') ? '中低' : v.startsWith('中') ? '中' : v.startsWith('低') ? '低' : '无'; }
      else if (f === '搜索日期') row.搜索日期 = String(v);
      else if (f === '搜索来源URL') row.sourceCount = Array.isArray(v) ? v.length : 0;
    }
    records.push(row);
  }
}

// 残值分母
const catFirstOfficial = {};
for (const cat of CATEGORIES) {
  const first = records.find(r => r.category === cat && r.isNew && typeof r.channels['官方价'] === 'number');
  if (first) catFirstOfficial[cat] = first.channels['官方价'];
}
for (const r of records) {
  if (typeof r.channels['官方价'] === 'number') { r.分母 = r.channels['官方价']; r.分母来源 = '本条官方价'; continue; }
  const m1 = r.说明.match(/(?:残值分母|分母)[^。]*?(\d{2,6})\s*元/);
  if (m1) { r.分母 = parseFloat(m1[1]); r.分母来源 = '说明明示'; continue; }
  if (r.说明.includes('当前在售同品类新品官方价') && catFirstOfficial[r.category]) { r.分母 = catFirstOfficial[r.category]; r.分母来源 = '同品类在售新品'; continue; }
  r.分母来源 = '未确定';
}

const SEV = { error: 0, warn: 0, info: 0 };
const addIssue = (cat, item, type, severity, detail) => { issues.push({cat, item, type, severity, detail}); SEV[severity]++; };
const hasNum = v => typeof v === 'number' && v > 0;

for (const r of records) {
  const directUsed = USED_CHANNELS.filter(c => hasNum(r.channels[c]));
  const directNew = NEW_CHANNELS.filter(c => hasNum(r.channels[c]));
  const structural = !!STRUCTURAL[r.category];

  if (r.isUsed && !directUsed.length) {
    const hasRef = r.refClues.length || typeof r.channels['闲鱼参考'] === 'number';
    if (structural) addIssue(r.category, r.item, 'USED_NO_PRICE', 'info', `二手条目无任何二手渠道价格(${STRUCTURAL[r.category]}，结构性缺失)`);
    else if (hasRef) addIssue(r.category, r.item, 'USED_ONLY_REF_PRICE', 'warn', '二手条目仅有低置信参考价(资讯稿/挂价/回收报价)，无实付口径价格');
    else addIssue(r.category, r.item, 'USED_NO_PRICE', 'error', '二手条目无任何二手渠道价格');
  }
  if (r.isNew && !directNew.length) {
    if (structural) addIssue(r.category, r.item, 'NEW_NO_PRICE', 'info', `新品无国行渠道价格(${STRUCTURAL[r.category]}，结构性缺失)`);
    else addIssue(r.category, r.item, 'NEW_NO_PRICE', 'error', '新品条目无任何新购渠道价格');
  }
  if (!r.置信度) addIssue(r.category, r.item, 'NO_CONFIDENCE', 'warn', '缺少置信度字段');
  if (!r.搜索日期) addIssue(r.category, r.item, 'NO_DATE', 'warn', '缺少搜索日期');
  else {
    const days = (new Date(snap.snapshot_date) - new Date(r.搜索日期)) / 86400000;
    if (days < -1) addIssue(r.category, r.item, 'FUTURE_DATE', 'info', `搜索日期 ${r.搜索日期} 晚于快照日 ${snap.snapshot_date} ${Math.round(-days)} 天，快照日应更新`);
    else if (days > 45) addIssue(r.category, r.item, 'STALE_DATE_45D', 'warn', `搜索日期 ${r.搜索日期} 早于快照日 ${Math.round(days)} 天`);
    else if (days > 30) addIssue(r.category, r.item, 'STALE_DATE_30D', 'info', `搜索日期 ${r.搜索日期} 早于快照日 ${Math.round(days)} 天`);
  }
  if (r.sourceCount === 0) addIssue(r.category, r.item, 'NO_SOURCE', 'warn', '无搜索来源URL');
  if (r.confLevel === '低' || r.confLevel === '中低') addIssue(r.category, r.item, 'LOW_CONFIDENCE', 'info', '置信度低: ' + r.置信度);

  const xy = r.channels['闲鱼中位'];
  if (hasNum(xy) && Array.isArray(r.闲鱼价格区间) && r.闲鱼价格区间.length === 2) {
    const [lo, hi] = r.闲鱼价格区间;
    if (lo > hi) addIssue(r.category, r.item, 'RANGE_INVERTED', 'error', `价格区间颠倒 [${lo}, ${hi}]`);
    else if (xy < lo || xy > hi) addIssue(r.category, r.item, 'MEDIAN_OUT_OF_RANGE', 'error', `闲鱼中位价 ${xy} 不在区间 [${lo}, ${hi}] 内`);
  }
  if (Array.isArray(r.闲鱼价格区间) && Array.isArray(r.闲鱼价格区间_95新) && r.闲鱼价格区间[1] < r.闲鱼价格区间_95新[0]) {
    const gap = (r.闲鱼价格区间_95新[0] - r.闲鱼价格区间[1]) / r.闲鱼价格区间[1];
    if (gap > 0.15) addIssue(r.category, r.item, 'GRADE_RANGE_GAP', 'info', `普通档上限 ${r.闲鱼价格区间[1]} 与95新档下限 ${r.闲鱼价格区间_95新[0]} 之间断层 ${(gap * 100).toFixed(0)}%（备注称采集时点不同）`);
  }
  if (hasNum(xy) && hasNum(r.channels['官方价']) && xy > r.channels['官方价']) addIssue(r.category, r.item, 'USED_GT_OFFICIAL', 'error', `闲鱼价 ${xy} > 官方价 ${r.channels['官方价']}`);
  if (hasNum(r.channels['京东自营']) && hasNum(r.channels['官方价'])) {
    const dev = (r.channels['京东自营'] - r.channels['官方价']) / r.channels['官方价'];
    if (Math.abs(dev) > 0.15) addIssue(r.category, r.item, 'JD_DEVIATION_15', 'error', `京东自营价偏离官方价 ${(dev * 100).toFixed(1)}%`);
  }
  if (hasNum(r.channels['国补到手']) && hasNum(r.channels['京东自营']) && r.channels['国补到手'] >= r.channels['京东自营'])
    addIssue(r.category, r.item, 'SUBSIDY_NOT_CHEAPER', 'warn', `国补到手 ${r.channels['国补到手']} ≥ 京东自营 ${r.channels['京东自营']}`);
  if (hasNum(xy) && r.闲鱼样本量 === 0 && !r.样本量) addIssue(r.category, r.item, 'PRICE_NO_SAMPLE', 'warn', '有闲鱼价但样本量为0');

  if (hasNum(xy) && hasNum(r.分母)) {
    const rate = xy / r.分母;
    r.隐含保值率 = Math.round(rate * 1000) / 10;
    if (rate > 1.0) addIssue(r.category, r.item, 'RETENTION_OVER_100', 'error', `闲鱼价/分母 = ${(rate * 100).toFixed(0)}% > 100%`);
    else if (rate > 0.80) addIssue(r.category, r.item, 'RETENTION_HIGH_80', 'info', `隐含保值率 ${(rate * 100).toFixed(0)}% 处于异常高位（2026涨价环境+大容量溢价可部分解释，建议复核）`);
    else if (rate < 0.15) addIssue(r.category, r.item, 'RETENTION_LOW_15', 'warn', `隐含保值率 ${(rate * 100).toFixed(0)}% < 15%，疑似偏低`);
  }
}

// 记录级问题索引
const recIssues = new Map();
issues.forEach(i => {
  const key = i.cat + '/' + i.item;
  if (!recIssues.has(key)) recIssues.set(key, []);
  recIssues.get(key).push(i);
});

// 品类汇总
const catStats = {};
for (const r of records) {
  const s = catStats[r.category] = catStats[r.category] || {total:0, new:0, used:0, conf:{'高':0,'中':0,'中低':0,'低':0,'无':0}, dates:{}, chCover:{}};
  s.total++; if (r.isNew) s.new++; else if (r.isUsed) s.used++;
  s.conf[r.confLevel] = (s.conf[r.confLevel]||0)+1;
  if (r.搜索日期) { s.dates[r.搜索日期] = (s.dates[r.搜索日期]||0)+1; if (!s.minDate || r.搜索日期 < s.minDate) s.minDate = r.搜索日期; if (!s.maxDate || r.搜索日期 > s.maxDate) s.maxDate = r.搜索日期; }
  else s.dates['(缺失)'] = (s.dates['(缺失)']||0)+1;
  for (const c of TABLE_CHANNELS) if (hasNum(r.channels[c])) s.chCover[c] = (s.chCover[c]||0)+1;
}

// schema 变体汇总
const schemaSummary = {};
for (const r of records) {
  for (const v of r.usedVariantFields) {
    const key = v.canonical + '|' + v.used;
    schemaSummary[key] = schemaSummary[key] || { canonical: v.canonical, used: v.used, count: 0, cats: new Set() };
    schemaSummary[key].count++; schemaSummary[key].cats.add(r.category);
  }
}

// 日期分布
const dateDist = {};
for (const r of records) { const d = r.搜索日期 || '(缺失)'; dateDist[d] = (dateDist[d] || 0) + 1; }

// 主要发现
const cnt = t => issues.filter(i => i.type === t).length;
const metaRecords = new Set(issues.filter(i => ['NO_SOURCE','NO_DATE','NO_CONFIDENCE'].includes(i.type)).map(i => i.cat + '/' + i.item));
const retentionHigh = issues.filter(i => i.type === 'RETENTION_HIGH_80');
const jdCats = CATEGORIES.filter(c => (catStats[c].chCover['京东自营'] || 0) + (catStats[c].chCover['国补到手'] || 0) > 0);
const b2cTotal = CATEGORIES.reduce((a, c) => a + (catStats[c].chCover['京东拍拍'] || 0) + (catStats[c].chCover['爱回收售价'] || 0), 0);
const findings = [
  { sev: 'warn', title: cnt('USED_NO_PRICE') + cnt('USED_ONLY_REF_PRICE') + ' 个二手条目缺可用价格（最高优先级）',
    detail: cnt('USED_NO_PRICE') + ' 条完全无二手渠道价（' + issues.filter(i => i.type === 'USED_NO_PRICE').map(i => i.cat + '/' + i.item).join('、') + '，其中 Apple TV 为国行结构性缺失）；' + cnt('USED_ONLY_REF_PRICE') + ' 条仅有资讯稿/挂价等低置信参考价（iPad 系 5 条 + Apple Watch S10），引擎按此计算残值会引入口径风险。其中 iPad_Pro M4_11 的参考价是「美版全新原封」、iPad_Air M3_11 的参考价是 2025-09 京东常卖价，口径错位。' },
  { sev: 'warn', title: '元数据缺失 ' + (cnt('NO_SOURCE') + cnt('NO_DATE') + cnt('NO_CONFIDENCE')) + ' 处，集中在 8-25 官宣回填条目',
    detail: '无来源URL ' + cnt('NO_SOURCE') + ' 条、无搜索日期 ' + cnt('NO_DATE') + ' 条、无置信度 ' + cnt('NO_CONFIDENCE') + ' 条，共涉及 ' + metaRecords.size + ' 条记录。 MacBook_Pro 升级款、Mac_Studio 旗舰款、Apple_Watch SE3/Ultra3、AirPods 新品、HomePod mini 等为 2026-08-25 官宣后回填，官方口径入库时未同步采集规范元数据。' },
  { sev: 'info', title: cnt('STALE_DATE_30D') + ' 条数据超 30 天未随快照刷新，' + cnt('FUTURE_DATE') + ' 条晚于快照日',
    detail: '2026-07-26 批次采集的 ' + cnt('STALE_DATE_30D') + ' 条记录未随 8-26 快照更新，集中在 MacBook_Air、iMac、iPad 系与 iPhone 老款二手；Mac_mini M6 新品搜索日期为 8-28，晚于快照日 8-26，建议将 snapshot_date 同步为最新采集日。' },
  { sev: 'info', title: cnt('LOW_CONFIDENCE') + ' 条低/中低置信度记录',
    detail: '多为闲鱼挂价口径（非实付）、样本量 1-2 个，集中在 Mac_mini M1/M2 老款、MacBook_Pro M2Pro/M3Pro、iPad_mini A15、Apple_Watch S10。挂价口径本身通常比成交价高 5-10%，叠加低样本，估值不确定性大。' },
  { sev: 'info', title: '保值率异常高位 ' + retentionHigh.length + ' 条，涨价环境下需持续复核',
    detail: retentionHigh.map(i => i.cat + '/' + i.item + ' ' + i.detail.split(' ')[0] + '').join('；') + '。2026-07 事件记录「Pro系列残值率达75%」可部分解释，且大容量机型在存储超级周期中有溢价，但 iPhone 16 Pro 512G 达 89.8%（分母为 iPhone 17 Pro 256G 官方价）仍属极端值，建议下个刷新窗口复核。' },
  { sev: 'info', title: '成色分档区间断层 1 条',
    detail: 'iPhone_标准/iPhone_15_256G_二手：普通档区间 [2798, 3399] 与 95新档 [4000, 4800] 之间断层 18%（99新档 [4500,5500]），备注解释为采集时点不同，但普通档上限与 95 新下限不衔接会让「成色溢价」估算失真。' },
  { sev: 'warn', title: '字段命名不一致：' + records.filter(r => r.usedVariantFields.length).length + '/128 条记录使用非规范字段名',
    detail: Object.values(schemaSummary).map(s => s.canonical + ' ↔ ' + s.used + '（' + s.count + '条）').join('；') + '。同一渠道多套命名会增加引擎解析分支，建议统一到规范名（闲鱼中位价_二手同款 / 京东拍拍价_二手 / 爱回收售价_二手 / 爱回收回收报价_下限）。' },
  { sev: 'info', title: '结构性缺失品类 2 个 + 渠道覆盖严重不均',
    detail: 'Apple TV（国行未销售）与 Mac Pro（已停产无在售款）无常规定价渠道，引擎需特殊分支。渠道层面：京东渠道价仅 ' + jdCats.length + ' 个品类有覆盖（' + jdCats.join('、') + '）；B2C 二手渠道（拍拍/爱回收）实价仅 ' + b2cTotal + ' 条，几乎全部「无法搜索」——二手定价高度依赖闲鱼单一 C2C 渠道，渠道间交叉验证能力弱。' }
];

const typeMeta = {
  USED_NO_PRICE: { label: '二手条目无价', desc: '无任何二手渠道价格，残值无法计算' },
  USED_ONLY_REF_PRICE: { label: '仅有低置信参考价', desc: '只有资讯稿/挂价/回收报价参考，无实付口径' },
  NEW_NO_PRICE: { label: '新品无渠道价', desc: '新品条目无任何新购渠道价格' },
  NO_SOURCE: { label: '无来源URL', desc: '缺少搜索来源URL，无法追溯' },
  NO_DATE: { label: '无搜索日期', desc: '缺少搜索日期，时效性未知' },
  NO_CONFIDENCE: { label: '无置信度', desc: '缺少置信度评级字段' },
  STALE_DATE_30D: { label: '数据超30天', desc: '搜索日期早于快照日 31-45 天' },
  STALE_DATE_45D: { label: '数据超45天', desc: '搜索日期早于快照日 45 天以上' },
  FUTURE_DATE: { label: '晚于快照日', desc: '搜索日期晚于快照日，snapshot_date 需更新' },
  LOW_CONFIDENCE: { label: '低置信度', desc: '置信度为低/中低（挂价口径、样本不足）' },
  RETENTION_HIGH_80: { label: '保值率异常高位', desc: '闲鱼价/残值分母 > 80%' },
  RETENTION_LOW_15: { label: '保值率异常低位', desc: '闲鱼价/残值分母 < 15%' },
  RETENTION_OVER_100: { label: '保值率超100%', desc: '闲鱼价高于残值分母' },
  GRADE_RANGE_GAP: { label: '成色区间断层', desc: '普通档与95新档价格区间断层 > 15%' },
  MEDIAN_OUT_OF_RANGE: { label: '中位价超区间', desc: '闲鱼中位价不在自报价格区间内' },
  RANGE_INVERTED: { label: '价格区间颠倒', desc: '区间下限大于上限' },
  USED_GT_OFFICIAL: { label: '二手价高于官方价', desc: '同条目闲鱼价超过官方价' },
  JD_DEVIATION_15: { label: '京东价偏离官方>15%', desc: '京东自营价与官方价偏差超 ±15%' },
  SUBSIDY_NOT_CHEAPER: { label: '国补价未更低', desc: '国补到手价不低于京东自营价' },
  PRICE_NO_SAMPLE: { label: '有价无样本', desc: '有闲鱼价但样本量为 0' },
  MISSING_CATEGORY: { label: '品类缺失', desc: '品类在快照中不存在' }
};

// 表格行
const rows = records.map(r => {
  const ch = {};
  for (const c of TABLE_CHANNELS) {
    let v = null, s = 'absent';
    if (typeof r.channels[c] === 'number') { v = r.channels[c]; s = c === '闲鱼参考' ? 'ref' : 'num'; }
    else {
      const st = r.chStatus[c];
      if (st === 'ref_text') { const clue = r.refClues.find(x => x.channel === c); if (clue) { v = clue.price; s = 'ref'; } else s = 'text'; }
      else if (st === 'unavailable') s = 'unavail';
      else if (st === 'null') s = 'null';
      else if (st === 'text' || st === 'other') s = 'text';
    }
    ch[c] = { v, s };
  }
  const rl = recIssues.get(r.category + '/' + r.item) || [];
  const sevRank = { error: 3, warn: 2, info: 1, ok: 0 };
  const maxSev = rl.reduce((a, i) => sevRank[i.severity] > sevRank[a] ? i.severity : a, 'ok');
  return {
    cat: r.category, item: r.item, type: r.isNew ? '新品' : (r.isUsed ? '二手' : '其他'),
    ch, ret: r.隐含保值率 || null, denom: r.分母, dsrc: r.分母来源,
    conf: r.置信度, confLevel: r.confLevel, date: r.搜索日期 || '—', src: r.sourceCount,
    sev: maxSev, issueN: rl.length, note: r.备注, refClues: r.refClues
  };
});

const payload = {
  meta: {
    snapshot_date: snap.snapshot_date, version: data.metadata.version,
    totalRecords: records.length, totalCategories: CATEGORIES.length,
    issueCount: { ...SEV }, schemaVariantRecords: records.filter(r => r.usedVariantFields.length).length,
    retentionCount: records.filter(r => r.隐含保值率).length,
    metaAffected: metaRecords.size
  },
  cats: CATEGORIES.map(c => ({
    name: c, structural: STRUCTURAL[c] || null,
    newTotal: catStats[c].new, usedTotal: catStats[c].used,
    cover: catStats[c].chCover, conf: catStats[c].conf,
    minDate: catStats[c].minDate || null, maxDate: catStats[c].maxDate || null,
    missingDates: catStats[c].dates['(缺失)'] || 0
  })),
  dates: Object.entries(dateDist).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  retention: records.filter(r => r.隐含保值率).sort((a, b) => b.隐含保值率 - a.隐含保值率)
    .map(r => ({ item: r.item, cat: r.category, rate: r.隐含保值率, conf: r.confLevel, denom: r.分母, dsrc: r.分母来源 })),
  ladder: records.filter(r => ['官方价','京东自营','国补到手','以旧换新'].filter(c => hasNum(r.channels[c])).length >= 3)
    .sort((a, b) => (b.channels['官方价'] || 0) - (a.channels['官方价'] || 0))
    .map(r => ({ item: r.item, cat: r.category, 官方价: r.channels['官方价'] || null, 京东自营: r.channels['京东自营'] || null, 国补到手: r.channels['国补到手'] || null, 以旧换新: r.channels['以旧换新'] || null })),
  rows, issues, typeMeta, findings,
  schema: Object.values(schemaSummary).map(s => ({ canonical: s.canonical, used: s.used, count: s.count, cats: [...s.cats] })),
  events: snap['近期重大价格事件'] || []
};

fs.mkdirSync(path.join(__dirname, 'debug'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'debug', 'market-snapshot-flat.json'), JSON.stringify(payload, null, 1), 'utf8');

// ---------- 生成 HTML ----------
const TEMPLATE = String.raw`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>苹果市场快照数据质量审查 · 2026-09-08</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root{
  --bg:#F5F5F7; --surface:#FFFFFF; --rule:#D2D2D8; --muted:#86868F; --fg:#1D1D1F;
  --accent:#007AFF; --accent-hover:#0063D4; --accent-soft:#E6F2FF;
  --success:#2A8A61; --success-soft:#D9F0E3;
  --warning:#E09500; --warning-soft:#FFF0C2;
  --error:#F24B4B; --error-soft:#FFD9D9;
  --radius-s:8px; --radius-m:12px; --radius-l:20px;
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
.card{background:var(--surface);border-radius:var(--radius-l);box-shadow:0 1px 2px rgba(29,29,31,.04),0 4px 16px rgba(29,29,31,.04);padding:24px}
.grid-kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
.kpi{background:var(--surface);border-radius:var(--radius-m);padding:16px;box-shadow:0 1px 2px rgba(29,29,31,.04)}
.kpi .k-label{font-size:12px;color:var(--muted)}
.kpi .k-value{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:600;margin-top:2px}
.kpi .k-note{font-size:11px;color:var(--muted);margin-top:2px}
.k-value.err{color:var(--error)} .k-value.warn{color:var(--warning)} .k-value.ok{color:var(--success)} .k-value.acc{color:var(--accent)}
.findings{margin-top:16px;display:grid;gap:12px}
.finding{display:grid;grid-template-columns:64px 1fr;gap:16px;background:var(--surface);border-radius:var(--radius-m);padding:16px;box-shadow:0 1px 2px rgba(29,29,31,.04)}
.badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 10px;border-radius:9999px;white-space:nowrap}
.badge-error{background:var(--error-soft);color:var(--error)}
.badge-warn{background:var(--warning-soft);color:#8A6400}
.badge-info{background:var(--accent-soft);color:var(--accent)}
.badge-default{background:#EDEDF0;color:var(--muted)}
.finding .f-title{font-weight:600;font-size:14px;margin-bottom:4px}
.finding .f-detail{color:#48484D;font-size:13px}
.chart-box{width:100%}
.chart-title{font-weight:600;font-size:15px;margin-bottom:2px}
.chart-note{color:var(--muted);font-size:12px;margin-bottom:12px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center}
.filters select,.filters input{border:1px solid var(--rule);border-radius:var(--radius-s);padding:6px 10px;font-size:13px;background:var(--surface);color:var(--fg)}
.filters input{min-width:180px}
.table-wrap{overflow:auto;border:1px solid var(--rule);border-radius:var(--radius-m)}
table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}
thead th{position:sticky;top:0;background:#FAFAFC;z-index:2;font-weight:600;font-size:11px;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--rule);text-align:left}
tbody td{padding:6px 10px;border-bottom:1px solid #EDEDF0;vertical-align:middle}
tbody tr:hover{background:#F7F9FC}
tbody tr.sev-error{box-shadow:inset 3px 0 0 var(--error)}
tbody tr.sev-warn{box-shadow:inset 3px 0 0 var(--warning)}
tbody tr.sev-info{box-shadow:inset 3px 0 0 var(--accent)}
.cell-num{font-family:'JetBrains Mono',monospace;font-weight:500}
.chip{display:inline-block;font-size:10px;padding:1px 6px;border-radius:9999px;vertical-align:middle}
.chip-unavail{background:#EDEDF0;color:var(--muted)}
.chip-null{background:transparent;color:#C7C7CC;border:1px dashed #D9D9DE}
.chip-ref{background:var(--warning-soft);color:#8A6400}
.chip-text{background:#EDEDF0;color:var(--muted)}
.conf-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.issue-group{border:1px solid var(--rule);border-radius:var(--radius-m);margin-bottom:12px;overflow:hidden}
.issue-head{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#FAFAFC;cursor:pointer}
.issue-head .t{font-weight:600}
.issue-head .d{color:var(--muted);font-size:12px}
.issue-head .n{margin-left:auto;font-family:'JetBrains Mono',monospace;color:var(--muted)}
.issue-list{display:none;padding:4px 16px 12px}
.issue-group.open .issue-list{display:block}
.issue-item{display:flex;gap:10px;padding:6px 0;border-bottom:1px dashed #EDEDF0;font-size:12px}
.issue-item:last-child{border-bottom:none}
.issue-item .w{font-family:'JetBrains Mono',monospace;color:var(--muted);min-width:270px}
.events{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.event{background:var(--surface);border-radius:var(--radius-m);padding:16px;box-shadow:0 1px 2px rgba(29,29,31,.04)}
.event .e-title{font-weight:600;font-size:13px;margin-bottom:6px}
.event .e-row{font-size:12px;margin-top:4px}
.event .e-k{color:var(--muted);margin-right:6px}
.schema-table td,.schema-table th{padding:8px 12px}
footer{margin-top:48px;color:var(--muted);font-size:12px;border-top:1px solid var(--rule);padding-top:16px}
.legend-note{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:8px}
@media (max-width:900px){
  .grid-kpi{grid-template-columns:repeat(3,1fr)}
  .two-col{grid-template-columns:1fr}
  .events{grid-template-columns:1fr}
  .finding{grid-template-columns:1fr}
}
</style>
</head>
<body>
<nav class="top-nav">
  <div class="brand">苹果市场快照数据质量审查</div>
  <div class="meta">constants v__VERSION__ · 快照 __SNAP__ · 生成 2026-09-08</div>
</nav>
<main>

<section id="s1">
  <h2 class="sec-title">一 · 审查结论</h2>
  <p class="sec-sub">对「实时市场价快照」全部 __NCAT__ 个品类 __NREC__ 条记录做完整性（缺漏）与合理性（数值矛盾）审查。规则详见页脚。</p>
  <div class="grid-kpi">
    <div class="kpi"><div class="k-label">品类 / 条目</div><div class="k-value acc" id="k-cats"></div><div class="k-note" id="k-recs"></div></div>
    <div class="kpi"><div class="k-label">硬错误</div><div class="k-value err" id="k-err"></div><div class="k-note">残值不可计算 / 数值矛盾</div></div>
    <div class="kpi"><div class="k-label">警告</div><div class="k-value warn" id="k-warn"></div><div class="k-note">元数据缺失 / 口径风险</div></div>
    <div class="kpi"><div class="k-label">提示</div><div class="k-value" id="k-info" style="color:var(--accent)"></div><div class="k-note">时效 / 置信 / 异常高位</div></div>
    <div class="kpi"><div class="k-label">低置信记录</div><div class="k-value warn" id="k-low"></div><div class="k-note">低/中低置信度</div></div>
    <div class="kpi"><div class="k-label">字段命名不一致</div><div class="k-value warn" id="k-schema"></div><div class="k-note">使用非规范字段名的记录</div></div>
  </div>
  <div class="findings" id="findings"></div>
</section>

<section id="s2">
  <h2 class="sec-title">二 · 品类 × 渠道覆盖矩阵</h2>
  <p class="sec-sub">每个格子 = 该品类对应条目（新品渠道对新品条目、二手渠道对二手条目）中有实价的比例。红色为覆盖缺口。</p>
  <div class="card">
    <div class="chart-box" id="chart-heatmap" style="height:720px"></div>
    <div class="legend-note">
      <span>新品渠道列（前 4 列）分母 = 品类新品条目数</span>
      <span>二手渠道列（后 6 列）分母 = 品类二手条目数</span>
      <span>「—」= 该品类无此类条目</span>
      <span>Apple_TV*、Mac_Pro* 为结构性缺失品类</span>
    </div>
  </div>
</section>

<section id="s3">
  <h2 class="sec-title">三 · 置信度与数据新鲜度</h2>
  <p class="sec-sub">左：各品类置信度分布；右：全部条目按搜索日期的分布（以快照日 __SNAP__ 为基准）。</p>
  <div class="two-col">
    <div class="card"><div class="chart-title">置信度分布</div><div class="chart-note">高=实付多源 · 中=单源/挂价 · 低=样本不足或口径存疑 · 无=字段缺失</div><div class="chart-box" id="chart-conf" style="height:420px"></div></div>
    <div class="card"><div class="chart-title">搜索日期分布</div><div class="chart-note">蓝=30天内 · 黄=31-45天 · 红=超45天 · 灰=日期缺失</div><div class="chart-box" id="chart-dates" style="height:420px"></div></div>
  </div>
</section>

<section id="s4">
  <h2 class="sec-title">四 · 隐含保值率全景（闲鱼中位价 ÷ 残值分母）</h2>
  <p class="sec-sub">__NRET__ 条可计算的二手条目，按保值率降序。颜色 = 置信度。虚线 = 2026-07 事件记录的「Pro系列残值率75%」参考位。</p>
  <div class="card"><div class="chart-box" id="chart-retention" style="height:560px"></div></div>
</section>

<section id="s5">
  <h2 class="sec-title">五 · 渠道价格梯度（官方 / 京东自营 / 国补 / 以旧换新）</h2>
  <p class="sec-sub">拥有 3 个以上新购渠道实价的条目。健康形态：官方价 ≥ 京东自营 > 国补到手 > 以旧换新。</p>
  <div class="card"><div class="chart-box" id="chart-ladder" style="height:420px"></div></div>
</section>

<section id="s6">
  <h2 class="sec-title">六 · 条目明细（__NREC__ 条）</h2>
  <p class="sec-sub">单元格：数字 = 实价；「参考」= 资讯稿/挂价等低置信参考；「无」= 无法搜索；「—」= 字段为空。行首色条 = 该条目最高问题级别。</p>
  <div class="card">
    <div class="filters">
      <select id="f-cat"><option value="">全部品类</option></select>
      <select id="f-type"><option value="">全部类型</option><option value="新品">新品</option><option value="二手">二手</option></select>
      <select id="f-sev"><option value="">全部记录</option><option value="error">有硬错误</option><option value="warn">有警告</option><option value="info">有提示</option><option value="ok">无问题</option></select>
      <input id="f-q" type="text" placeholder="搜索条目名…">
      <span style="color:var(--muted);font-size:12px" id="f-count"></span>
    </div>
    <div class="table-wrap" style="max-height:640px">
      <table id="detail-table"><thead><tr>
        <th>品类</th><th>条目</th><th>类型</th><th>官方价</th><th>京东自营</th><th>国补</th><th>换新</th><th>闲鱼中位</th><th>闲鱼参考</th><th>拍拍</th><th>爱回收售价</th><th>爱回收回收</th><th>TradeIn</th><th>保值率</th><th>置信度</th><th>日期</th><th>来源</th><th>问题</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </div>
</section>

<section id="s7">
  <h2 class="sec-title">七 · 问题清单</h2>
  <p class="sec-sub">按类型分组，点击组头展开。共 __NISS__ 条。</p>
  <div class="filters">
    <button class="badge badge-default" data-sev="" style="cursor:pointer;border:0">全部</button>
    <button class="badge badge-error" data-sev="error" style="cursor:pointer;border:0">硬错误</button>
    <button class="badge badge-warn" data-sev="warn" style="cursor:pointer;border:0">警告</button>
    <button class="badge badge-info" data-sev="info" style="cursor:pointer;border:0">提示</button>
  </div>
  <div id="issues"></div>
</section>

<section id="s8">
  <h2 class="sec-title">八 · 字段一致性 · 结构性缺失 · 重大价格事件</h2>
  <p class="sec-sub">影响引擎解析与可比性的结构性背景。</p>
  <div class="card" style="margin-bottom:16px">
    <div class="chart-title">字段命名变体（应统一为规范名）</div>
    <div class="table-wrap" style="max-height:300px;margin-top:10px">
      <table class="schema-table"><thead><tr><th>规范字段名</th><th>实际出现的变体</th><th>使用记录数</th><th>涉及品类</th></tr></thead><tbody id="schema-body"></tbody></table>
    </div>
  </div>
  <div class="events" id="events"></div>
</section>

<footer>
  数据源：.agents/skills/apple-value-analysis/constants.json（v__VERSION__）·「实时市场价快照」snapshot_date=__SNAP__ · 共 __NREC__ 条 / __NCAT__ 品类。<br>
  审查规则：完整性（新品无渠道价 / 二手无渠道价 / 无来源URL / 无日期 / 无置信度 / 仅参考价）与合理性（中位价 vs 区间、二手 vs 官方、京东 vs 官方偏差>15%、国补 vs 自营、保值率>80%或<15%、成色区间断层>15%、日期时效与倒挂）。保值率 = 闲鱼中位价 ÷ 残值分母（分母优先取本条官方价，其次说明明示，再次同品类在售新品官价）。生成脚本：scripts/analyze-market-snapshot.mjs。
</footer>
</main>

<script id="payload" type="application/json">__PAYLOAD__</script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<script>
var D = JSON.parse(document.getElementById('payload').textContent);
var charts = [];
function el(id){ return document.getElementById(id); }
function fmt(n){ return (n===null||n===undefined) ? '—' : Number(n).toLocaleString('zh-CN'); }
function mkChart(id, opt){ var c = echarts.init(el(id)); c.setOption(opt); charts.push(c); return c; }
window.addEventListener('resize', function(){ charts.forEach(function(c){ c.resize(); }); });
var CONF_COLOR = { '高': '#2A8A61', '中': '#007AFF', '中低': '#E09500', '低': '#E09500', '无': '#86868F' };
var AXIS = { axisLine:{lineStyle:{color:'#D2D2D8'}}, axisLabel:{color:'#86868F', fontSize:11}, splitLine:{lineStyle:{color:'#EDEDF0'}} };
var TIP = { backgroundColor:'#FFFFFF', borderColor:'#D2D2D8', textStyle:{color:'#1D1D1F', fontSize:12}, extraCssText:'box-shadow:0 4px 16px rgba(29,29,31,.12);border-radius:12px;' };

// ===== KPI =====
el('k-cats').textContent = D.meta.totalCategories;
el('k-recs').textContent = D.meta.totalRecords + ' 条（' + D.cats.reduce(function(a,c){return a+c.newTotal;},0) + ' 新品 / ' + D.cats.reduce(function(a,c){return a+c.usedTotal;},0) + ' 二手）';
el('k-err').textContent = D.meta.issueCount.error;
el('k-warn').textContent = D.meta.issueCount.warn;
el('k-info').textContent = D.meta.issueCount.info;
el('k-low').textContent = D.issues.filter(function(i){return i.type==='LOW_CONFIDENCE';}).length;
el('k-schema').textContent = D.meta.schemaVariantRecords + ' / ' + D.meta.totalRecords;

// ===== 发现 =====
var fHtml = '';
D.findings.forEach(function(f, i){
  fHtml += '<div class="finding"><div><span class="badge badge-' + f.sev + '">' + (f.sev==='error'?'硬错误':(f.sev==='warn'?'警告':'提示')) + '</span></div><div><div class="f-title">' + (i+1) + '. ' + f.title + '</div><div class="f-detail">' + f.detail + '</div></div></div>';
});
el('findings').innerHTML = fHtml;

// ===== 覆盖热力图 =====
(function(){
  var cats = D.cats;
  var cols = ['官方价','京东自营','国补到手','以旧换新','闲鱼中位','闲鱼参考','京东拍拍','爱回收售价','爱回收回收','官方TradeIn'];
  var yLabels = cats.map(function(c){ return c.name + (c.structural ? '*' : ''); });
  var data = [];
  cats.forEach(function(c, yi){
    cols.forEach(function(col, xi){
      var isNewCol = xi < 4;
      var total = isNewCol ? c.newTotal : c.usedTotal;
      var cov = c.cover[col] || 0;
      var v = total > 0 ? Math.round(cov * 100 / total) : -1;
      data.push({ value: v, cov: cov, total: total, cat: c.name, col: col });
    });
  });
  mkChart('chart-heatmap', {
    tooltip: { trigger:'item', confine:true, formatter: function(p){
      var d = p.data;
      return '<b>' + d.cat + '</b> · ' + d.col + '<br>覆盖: ' + d.cov + ' / ' + d.total + (d.total>0 ? '（' + d.value + '%）' : '（无此类条目）');
    }},
    grid: { left: 110, right: 90, top: 10, bottom: 60 },
    xAxis: { type:'category', data: cols, splitArea:{show:true}, axisLabel:{color:'#48484D',fontSize:11,fontWeight:600}, axisLine:{show:false}, axisTick:{show:false} },
    yAxis: { type:'category', data: yLabels, axisLabel:{color:'#1D1D1F',fontSize:11}, axisLine:{show:false}, axisTick:{show:false} },
    visualMap: { min:0, max:100, calculable:false, orient:'vertical', right:0, top:'center', itemHeight:140,
      inRange:{ color:['#F24B4B','#E09500','#2A8A61'] }, outOfRange:{ color:'#E8E8ED' }, textStyle:{color:'#86868F',fontSize:10} },
    series: [{ type:'heatmap', data:data, label:{ show:true, fontSize:10, color:'#fff', fontWeight:600,
      formatter: function(p){ return p.value < 0 ? '—' : p.value + '%'; } },
      itemStyle:{ borderColor:'#FFFFFF', borderWidth:2, borderRadius:4 },
      emphasis:{ itemStyle:{ shadowBlur:6, shadowColor:'rgba(29,29,31,.3)' } } }]
  });
})();

// ===== 置信度 =====
(function(){
  var cats = D.cats.map(function(c){ return c.name + (c.structural ? '*' : ''); });
  var levels = ['高','中','中低','低','无'];
  var colors = ['#2A8A61','#007AFF','#E09500','#C87F0A','#86868F'];
  var series = levels.map(function(lv, i){
    return { name:lv, type:'bar', stack:'conf', barMaxWidth:26, color:colors[i],
      emphasis:{ focus:'series' },
      label:{ show: lv==='高', position:'inside', color:'#fff', fontSize:10, formatter:function(p){ return p.value>0?p.value:''; } },
      data: D.cats.map(function(c){ return c.conf[lv] || 0; }) };
  });
  mkChart('chart-conf', {
    tooltip:{ trigger:'axis', axisPointer:{type:'shadow'} },
    legend:{ top:0, textStyle:{color:'#48484D',fontSize:11}, itemWidth:12, itemHeight:8 },
    grid:{ left:110, right:20, top:36, bottom:10, containLabel:false },
    xAxis:{ type:'value', ...AXIS },
    yAxis:{ type:'category', data:cats, axisLabel:{color:'#1D1D1F',fontSize:11}, axisLine:{show:false}, axisTick:{show:false} },
    series: series
  });
})();

// ===== 日期分布 =====
(function(){
  var snap = new Date(D.meta.snapshot_date);
  var entries = D.dates.filter(function(e){ return e[0] !== '(缺失)'; });
  var missing = 0;
  D.dates.forEach(function(e){ if (e[0]==='(缺失)') missing = e[1]; });
  var labels = entries.map(function(e){ return e[0]; });
  var vals = entries.map(function(e){ return e[1]; });
  var colors = entries.map(function(e){
    var days = (snap - new Date(e[0])) / 86400000;
    if (days < 0 || days <= 30) return '#007AFF';
    if (days <= 45) return '#E09500';
    return '#F24B4B';
  });
  if (missing > 0) { labels.push('(缺失)'); vals.push(missing); colors.push('#86868F'); }
  mkChart('chart-dates', {
    tooltip:{ trigger:'axis', axisPointer:{type:'shadow'}, formatter:function(ps){
      var p = ps[0]; return p.name + ' · ' + p.value + ' 条';
    }},
    grid:{ left:40, right:20, top:30, bottom:56 },
    xAxis:{ type:'category', data:labels, ...AXIS, axisLabel:{color:'#48484D',fontSize:10,rotate:38} },
    yAxis:{ type:'value', name:'条目数', ...AXIS },
    series:[{ type:'bar', barMaxWidth:30, data: vals.map(function(v,i){ return { value:v, itemStyle:{ color:colors[i], borderRadius:[4,4,0,0] } }; }),
      label:{ show:true, position:'top', color:'#86868F', fontSize:10 } }]
  });
})();

// ===== 保值率 =====
(function(){
  var data = D.retention.map(function(r){
    return { value: r.rate, item: r.item, cat: r.cat, conf: r.conf, denom: r.denom, dsrc: r.dsrc,
      itemStyle:{ color: CONF_COLOR[r.conf] || '#86868F', borderRadius:[0,4,4,0] } };
  });
  var names = D.retention.map(function(r){ return r.item; });
  mkChart('chart-retention', {
    tooltip:{ trigger:'item', confine:true, formatter:function(p){
      var d = p.data;
      return '<b>' + d.cat + ' / ' + d.item + '</b><br>隐含保值率: ' + d.value + '%<br>置信度: ' + d.conf + '<br>分母: ¥' + fmt(d.denom) + '（' + d.dsrc + '）';
    }},
    grid:{ left:10, right:70, top:16, bottom:16, containLabel:true },
    xAxis:{ type:'value', max:100, name:'%', ...AXIS },
    yAxis:{ type:'category', data:names, axisLabel:{color:'#48484D',fontSize:10}, axisLine:{show:false}, axisTick:{show:false} },
    dataZoom:[ { type:'inside', yAxisIndex:0, start:0, end:30 }, { type:'slider', yAxisIndex:0, right:8, width:16, start:0, end:30, textStyle:{fontSize:9} } ],
    series:[{ type:'bar', barMaxWidth:16, data:data,
      label:{ show:true, position:'right', fontSize:10, color:'#48484D', formatter:'{c}%' },
      markLine:{ symbol:'none', silent:true, lineStyle:{ color:'#E09500', type:'dashed' },
        label:{ color:'#8A6400', fontSize:10, position:'insideEndTop', formatter:'75% · 2026-07事件参考' },
        data:[{ xAxis:75 }] } }]
  });
})();

// ===== 渠道价格梯度 =====
(function(){
  var names = D.ladder.map(function(r){ return r.item; });
  function col(key, color){ return { name:key, type:'bar', barMaxWidth:14, color:color, data: D.ladder.map(function(r){ return r[key]; }) }; }
  mkChart('chart-ladder', {
    tooltip:{ trigger:'axis', axisPointer:{type:'shadow'}, valueFormatter:function(v){ return '¥' + fmt(v); } },
    legend:{ top:0, textStyle:{color:'#48484D',fontSize:11}, itemWidth:12, itemHeight:8 },
    grid:{ left:10, right:30, top:36, bottom:10, containLabel:true },
    xAxis:{ type:'value', name:'元', ...AXIS },
    yAxis:{ type:'category', data:names, axisLabel:{color:'#1D1D1F',fontSize:11}, axisLine:{show:false}, axisTick:{show:false} },
    series:[ col('官方价','#1D1D1F'), col('京东自营','#007AFF'), col('国补到手','#2A8A61'), col('以旧换新','#E09500') ]
  });
})();

// ===== 明细表 =====
(function(){
  var catSel = el('f-cat'), typeSel = el('f-type'), sevSel = el('f-sev'), qInput = el('f-q');
  D.cats.forEach(function(c){ var o = document.createElement('option'); o.value = c.name; o.textContent = c.name; catSel.appendChild(o); });
  var TB = ['官方价','京东自营','国补到手','以旧换新','闲鱼中位','闲鱼参考','京东拍拍','爱回收售价','爱回收回收','官方TradeIn'];
  function cell(ch, key){
    var c = ch[key];
    if (c.s === 'num') return '<td class="cell-num">' + fmt(c.v) + '</td>';
    if (c.s === 'ref') return '<td><span class="chip chip-ref" title="低置信参考">' + fmt(c.v) + ' 参考</span></td>';
    if (c.s === 'unavail') return '<td><span class="chip chip-unavail">无</span></td>';
    if (c.s === 'null') return '<td><span class="chip chip-null">—</span></td>';
    if (c.s === 'text') return '<td><span class="chip chip-text">文本</span></td>';
    return '<td></td>';
  }
  function render(){
    var cat = catSel.value, type = typeSel.value, sev = sevSel.value, q = qInput.value.trim().toLowerCase();
    var rows = D.rows.filter(function(r){
      if (cat && r.cat !== cat) return false;
      if (type && r.type !== type) return false;
      if (sev === 'ok' && r.issueN > 0) return false;
      if (sev && sev !== 'ok') { var rank = {error:3,warn:2,info:1}; if ((rank[r.sev]||0) < rank[sev]) return false; }
      if (q && r.item.toLowerCase().indexOf(q) < 0 && r.cat.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var html = '';
    rows.forEach(function(r){
      html += '<tr class="sev-' + r.sev + '" title="' + (r.note||'').replace(/"/g,'') + '">'
        + '<td>' + r.cat + '</td><td><b>' + r.item + '</b></td><td>' + r.type + '</td>';
      TB.forEach(function(k){ html += cell(r.ch, k); });
      html += '<td class="cell-num">' + (r.ret===null ? '—' : r.ret + '%') + '</td>'
        + '<td><span class="conf-dot" style="background:' + CONF_COLOR[r.confLevel] + '"></span>' + r.confLevel + '</td>'
        + '<td class="cell-num">' + r.date + '</td><td class="cell-num">' + (r.src || '—') + '</td>'
        + '<td>' + (r.issueN === 0 ? '<span style="color:#2A8A61">0</span>' : '<span class="badge badge-' + (r.sev==='ok'?'default':r.sev) + '">' + r.issueN + '</span>') + '</td>'
        + '</tr>';
    });
    el('detail-table').querySelector('tbody').innerHTML = html;
    el('f-count').textContent = '显示 ' + rows.length + ' / ' + D.rows.length + ' 条';
  }
  [catSel, typeSel, sevSel].forEach(function(s){ s.addEventListener('change', render); });
  qInput.addEventListener('input', render);
  render();
})();

// ===== 问题清单 =====
(function(){
  var sevFilter = '';
  var groups = {};
  D.issues.forEach(function(i){ (groups[i.type] = groups[i.type] || []).push(i); });
  var order = Object.keys(groups).sort(function(a,b){ return groups[b].length - groups[a].length; });
  function render(){
    var html = '';
    order.forEach(function(t){
      var list = groups[t].filter(function(i){ return !sevFilter || i.severity === sevFilter; });
      if (!list.length) return;
      var meta = D.typeMeta[t] || { label: t, desc: '' };
      var sev = list[0].severity;
      html += '<div class="issue-group open" data-type="' + t + '">'
        + '<div class="issue-head"><span class="badge badge-' + sev + '">' + (sev==='error'?'硬错误':(sev==='warn'?'警告':'提示')) + '</span>'
        + '<span class="t">' + meta.label + '</span><span class="d">' + meta.desc + '</span>'
        + '<span class="n">× ' + list.length + '</span></div><div class="issue-list">';
      list.forEach(function(i){
        html += '<div class="issue-item"><span class="w">' + i.cat + ' / ' + i.item + '</span><span>' + i.detail + '</span></div>';
      });
      html += '</div></div>';
    });
    el('issues').innerHTML = html;
    document.querySelectorAll('.issue-head').forEach(function(h){
      h.addEventListener('click', function(){ h.parentElement.classList.toggle('open'); });
    });
  }
  document.querySelectorAll('.filters .badge').forEach(function(b){
    b.addEventListener('click', function(){
      sevFilter = b.getAttribute('data-sev');
      document.querySelectorAll('.filters .badge').forEach(function(x){ x.style.outline = ''; });
      b.style.outline = '2px solid #007AFF';
      render();
    });
  });
  render();
})();

// ===== Schema 表 =====
(function(){
  var html = '';
  D.schema.forEach(function(s){
    html += '<tr><td class="cell-num">' + s.canonical + '</td><td>' + s.used + '</td><td class="cell-num">' + s.count + '</td><td>' + s.cats.join('、') + '</td></tr>';
  });
  el('schema-body').innerHTML = html;
})();

// ===== 事件卡片 =====
(function(){
  var html = '';
  D.events.forEach(function(e){
    html += '<div class="event"><div class="e-title">' + e['事件'] + '</div>'
      + '<div class="e-row"><span class="e-k">影响</span>' + e['影响'] + '</div>'
      + '<div class="e-row"><span class="e-k">处理</span>' + e['处理'] + '</div>'
      + (e['来源'] ? '<div class="e-row"><span class="e-k">来源</span>' + e['来源'] + '</div>' : '')
      + '</div>';
  });
  el('events').innerHTML = html;
})();
</script>
</body>
</html>`;

// ---------- 注入与写出 ----------
let html = TEMPLATE
  .replace(/__VERSION__/g, () => payload.meta.version)
  .replace(/__SNAP__/g, () => payload.meta.snapshot_date)
  .replace(/__NCAT__/g, () => payload.meta.totalCategories)
  .replace(/__NREC__/g, () => payload.meta.totalRecords)
  .replace(/__NRET__/g, () => payload.meta.retentionCount)
  .replace(/__NISS__/g, () => issues.length)
  .replace('__PAYLOAD__', () => JSON.stringify(payload).replace(/</g, '\\u003c'));

const outPath = path.join(ROOT, '2026-09-08-市场快照数据质量审查报告.html');
fs.writeFileSync(outPath, html, 'utf8');

console.log('=== 完成 ===');
console.log('条目', records.length, '| 问题 err/warn/info =', SEV.error + '/' + SEV.warn + '/' + SEV.info, '| schema变体', payload.meta.schemaVariantRecords, '| 保值率样本', payload.meta.retentionCount);
console.log('报告:', outPath);
const byType2 = {};
issues.forEach(i => { byType2[i.type] = (byType2[i.type] || 0) + 1; });
console.log('问题分布:', JSON.stringify(byType2));