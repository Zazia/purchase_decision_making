import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeObservationData } from './lib/residual-observations.mjs';
import { buildResidualCurveAudit } from './lib/residual-curve-audit.mjs';
import { prepareCalibrationSamples, rateAt } from './lib/residual-curve-fit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const constants = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/apple-value-analysis/constants.json'), 'utf8'));
const curves = constants['保值率曲线'];
const rawObservations = constants['二手价格观测']?.records ?? [];
const launchCatalog = constants['首发价目录']?.records ?? {};
const normalized = normalizeObservationData(constants).rows;
const audit = buildResidualCurveAudit(constants);
const manifests = constants['保值率校准清单']?.records ?? [];
const rawById = new Map(rawObservations.map((item) => [item.id, item]));
const auditByCategory = new Map(audit.records.map((item) => [item.category, item]));

const STATUS_LABELS = {
  invalid_calibration_applied: '错误校准已撤销',
  invalid_evaluation_only: '旧评估作废',
  provenance_missing: '来源待补',
  verified: '已验证',
};
const PRICE_TYPE_LABELS = {
  transaction: '成交价',
  verified_paid: '实付价',
  listing: '挂牌价',
  trade_in: '回收报价',
  reference: '参考价',
};
const RATIO_LABELS = {
  retention_observed: '曲线观测保值率',
  replacement_value_ratio: '替代价值率',
  owner_value_ratio: '个体投资保值率',
};

function ageMonths(releaseDate, observedAt) {
  if (!releaseDate || !observedAt) return null;
  return (Date.parse(observedAt) - Date.parse(releaseDate)) / 86400000 / 30.4375;
}

function round(value, digits = 2) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function curvePoints(curve) {
  return Object.entries(curve).filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'number')
    .map(([month, value]) => [Number(month), value]).sort((left, right) => left[0] - right[0]);
}

function latestManifest(category) {
  return manifests.filter((item) => item.category === category).at(-1) ?? null;
}

const observations = normalized.map((row) => {
  const raw = rawById.get(row.observation_id);
  const launch = row.launch_price_id ? launchCatalog[row.launch_price_id] : null;
  const age = ageMonths(launch?.release_date, row.observed_at);
  const theoretical = age == null || !curves[row.category] ? null : rateAt(curves[row.category], age) / 100;
  return {
    ...row,
    generation: raw?.generation ?? row.generation,
    age_months: round(age),
    denominator_kind: row.launch_msrp == null ? null : 'launch_msrp',
    curve_theoretical: round(theoretical, 4),
    curve_deviation_pp: row.retention_observed == null || theoretical == null
      ? null : round((row.retention_observed - theoretical) * 100),
  };
});

const categories = Object.keys(curves).filter((key) => !key.startsWith('_')).sort().map((category) => {
  const categoryObservations = observations.filter((item) => item.category === category);
  const prepared = prepareCalibrationSamples(constants, category);
  const manifest = latestManifest(category);
  const eligible = categoryObservations.filter((item) => item.calibration_eligible);
  const mae = eligible.length
    ? eligible.reduce((sum, item) => sum + Math.abs(item.curve_deviation_pp), 0) / eligible.length
    : null;
  return {
    category,
    curve_points: curvePoints(curves[category]),
    audit: auditByCategory.get(category),
    observation_count: categoryObservations.length,
    launch_linked_count: categoryObservations.filter((item) => item.launch_msrp != null).length,
    eligible_count: eligible.length,
    train_count: manifest?.input_observation_ids?.length ?? 0,
    validation_count: prepared.validationOnly.length,
    excluded_count: prepared.excluded.length,
    calibration_status: manifest?.status ?? 'no_manifest',
    training_weighted_mae: manifest?.metrics?.training_weighted_mae ?? null,
    validation_weighted_mae: manifest?.metrics?.validation_weighted_mae ?? null,
    read_only_retention_mae: round(mae),
  };
});

const statusCounts = audit.records.reduce((result, item) => {
  result[item.status] = (result[item.status] ?? 0) + 1;
  return result;
}, {});
const payload = {
  schema_version: '2.0',
  generated_at: new Date().toISOString(),
  constants_version: constants.metadata.version,
  data_date: constants.metadata.last_updated,
  metric_semantics: {
    retention_observed: 'observed_price / exact same-region same-configuration verified launch MSRP',
    replacement_value_ratio: 'observed_price / current new same-tier price; never used for curve fitting',
    owner_value_ratio: 'observed_price / actual paid price; never used for curve fitting',
  },
  summary: {
    observations: observations.length,
    launch_linked: observations.filter((item) => item.launch_msrp != null).length,
    calibration_eligible: observations.filter((item) => item.calibration_eligible).length,
    categories: categories.length,
    status_counts: statusCounts,
  },
  categories,
  comparison_points: observations,
};

const width = 600;
const height = 240;
const margin = { left: 42, right: 18, top: 18, bottom: 34 };
const x = (month) => margin.left + Math.max(0, Math.min(84, month)) / 84 * (width - margin.left - margin.right);
const y = (ratio) => margin.top + (100 - Math.max(0, Math.min(100, ratio))) / 100 * (height - margin.top - margin.bottom);

function linePath(points) {
  return points.map(([month, value], index) => `${index ? 'L' : 'M'}${x(month).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
}

function marker(item, key, color, shape) {
  const ratio = item[key];
  if (ratio == null || item.age_months == null) return '';
  const cx = x(item.age_months);
  const cy = y(ratio * 100);
  const title = `${item.model_key} · ${RATIO_LABELS[key]} ${(ratio * 100).toFixed(1)}% · ${PRICE_TYPE_LABELS[item.price_type] ?? item.price_type}`;
  if (shape === 'square') return `<rect x="${(cx - 3.5).toFixed(1)}" y="${(cy - 3.5).toFixed(1)}" width="7" height="7" fill="${color}"><title>${escapeHtml(title)}</title></rect>`;
  if (shape === 'diamond') return `<path d="M${cx.toFixed(1)},${(cy - 5).toFixed(1)} L${(cx + 5).toFixed(1)},${cy.toFixed(1)} L${cx.toFixed(1)},${(cy + 5).toFixed(1)} L${(cx - 5).toFixed(1)},${cy.toFixed(1)} Z" fill="${color}"><title>${escapeHtml(title)}</title></path>`;
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${escapeHtml(title)}</title></circle>`;
}

function chart(category) {
  const points = observations.filter((item) => item.category === category.category);
  const grid = [0, 25, 50, 75, 100].map((value) => `<line x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}" stroke="#E5E5EA"/><text x="${margin.left - 8}" y="${y(value) + 4}" text-anchor="end">${value}%</text>`).join('');
  const ticks = [0, 12, 24, 36, 48, 60, 72, 84].map((value) => `<text x="${x(value)}" y="${height - 10}" text-anchor="middle">${value}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(category.category)} 残值曲线">
    ${grid}<path d="${linePath(category.curve_points)}" fill="none" stroke="#007AFF" stroke-width="3"/>
    ${points.map((item) => marker(item, 'retention_observed', '#248A3D', 'circle')).join('')}
    ${points.map((item) => marker(item, 'replacement_value_ratio', '#D97706', 'square')).join('')}
    ${points.map((item) => marker(item, 'owner_value_ratio', '#7C3AED', 'diamond')).join('')}
    ${ticks}<text x="${width - margin.right}" y="${height - 10}" text-anchor="end">机龄（月）</text>
  </svg>`;
}

function percent(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function categoryCard(item) {
  const status = STATUS_LABELS[item.audit.status] ?? item.audit.status;
  return `<article class="panel">
    <div class="panel-head"><div><h3>${escapeHtml(item.category)}</h3><span class="pill ${escapeHtml(item.audit.status)}">${escapeHtml(status)}</span></div><div class="confidence">校准状态：${escapeHtml(item.calibration_status)}</div></div>
    ${chart(item)}
    <div class="legend"><span class="line"></span>理论曲线 <span class="dot green"></span>曲线观测保值率 <span class="square amber"></span>替代价值率 <span class="diamond purple"></span>个体投资保值率</div>
    <dl class="metrics"><div><dt>观测 / 首发价链接</dt><dd>${item.observation_count} / ${item.launch_linked_count}</dd></div><div><dt>训练 / 验证 / 排除</dt><dd>${item.train_count} / ${item.validation_count} / ${item.excluded_count}</dd></div><div><dt>可校准</dt><dd>${item.eligible_count}</dd></div><div><dt>只读保值率 MAE</dt><dd>${item.read_only_retention_mae == null ? '—' : `${item.read_only_retention_mae} pp`}</dd></div></dl>
    <p class="note">${escapeHtml(item.audit.recommended_action)}</p>
  </article>`;
}

function ratioCell(value) {
  return value == null ? '<span class="muted">—</span>' : percent(value);
}

const rowsHtml = observations.map((item) => `<tr>
  <td><strong>${escapeHtml(item.category)}</strong><br><span class="muted">${escapeHtml(item.model_key)}</span></td>
  <td>${escapeHtml(item.observed_at)}</td><td>${escapeHtml(PRICE_TYPE_LABELS[item.price_type] ?? item.price_type)}</td>
  <td class="num">¥${Number(item.observed_price).toLocaleString('zh-CN')}</td><td class="num">${item.launch_msrp == null ? '—' : `¥${Number(item.launch_msrp).toLocaleString('zh-CN')}`}</td>
  <td class="num">${ratioCell(item.retention_observed)}</td><td class="num">${ratioCell(item.replacement_value_ratio)}</td><td class="num">${ratioCell(item.owner_value_ratio)}</td>
  <td>${item.calibration_eligible ? '<span class="ok">可校准</span>' : `<span class="muted">排除：${escapeHtml(item.exclusion_reasons.join('、'))}</span>`}</td>
</tr>`).join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>产品残值曲线审计 · v${escapeHtml(payload.constants_version)}</title><style>
:root{--bg:#F5F5F7;--surface:#fff;--text:#1D1D1F;--muted:#6E6E73;--line:#D2D2D7;--blue:#007AFF;--green:#248A3D;--amber:#D97706;--purple:#7C3AED;--red:#D70015}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;line-height:1.55}.wrap{max-width:1280px;margin:auto;padding:48px 28px 80px}.hero{padding:44px;border-radius:28px;color:white;background:linear-gradient(135deg,#111827,#253B73)}h1{font-size:42px;line-height:1.12;margin:0 0 12px}.hero p{max-width:800px;color:#DCE6FF}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:28px}.kpi{background:rgba(255,255,255,.1);padding:16px;border-radius:16px}.kpi b{display:block;font-size:28px}.section{margin-top:42px}.section h2{font-size:28px;margin:0 0 8px}.lead{color:var(--muted);max-width:960px}.notice{background:#FFF7E6;border-left:4px solid var(--amber);padding:18px 20px;border-radius:4px 14px 14px 4px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.panel{background:var(--surface);border:1px solid #E5E5EA;border-radius:22px;padding:22px;box-shadow:0 8px 28px rgba(0,0,0,.04)}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.panel h3{font-size:21px;margin:0 0 8px}.pill{display:inline-block;padding:3px 9px;border-radius:999px;background:#EEE;color:#555;font-size:12px}.invalid_calibration_applied{background:#FFE8E8;color:#9B000E}.invalid_evaluation_only{background:#FFF2D6;color:#8A4B00}.provenance_missing{background:#ECECF1;color:#555}.verified{background:#E3F5E8;color:#176B2C}.confidence{font-size:12px;color:var(--muted);text-align:right}.chart{display:block;width:100%;margin-top:14px;font-size:10px;fill:var(--muted)}.legend{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:12px;align-items:center}.line{width:20px;border-top:3px solid var(--blue)}.dot,.square,.diamond{width:9px;height:9px;display:inline-block}.dot{border-radius:50%}.green{background:var(--green)}.amber{background:var(--amber)}.purple{background:var(--purple);transform:rotate(45deg)}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0 0}.metrics div{background:var(--bg);padding:10px;border-radius:10px}.metrics dt{font-size:11px;color:var(--muted)}.metrics dd{margin:2px 0 0;font-weight:700}.note{font-size:13px;color:var(--muted);border-top:1px solid #EEE;padding-top:14px}.table-wrap{overflow:auto;background:white;border-radius:18px;border:1px solid #E5E5EA}table{border-collapse:collapse;width:100%;min-width:1100px;font-size:13px}th,td{text-align:left;padding:11px 13px;border-bottom:1px solid #EEE;vertical-align:top}th{position:sticky;top:0;background:#F8F8FA;z-index:1}.num{text-align:right;white-space:nowrap}.muted{color:var(--muted);font-size:12px}.ok{color:var(--green);font-weight:700}.method{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.method div{background:white;border-radius:16px;padding:18px}.method b{display:block;margin-bottom:6px}footer{margin-top:36px;color:var(--muted);font-size:12px}@media(max-width:850px){.cards{grid-template-columns:1fr}.kpis,.metrics,.method{grid-template-columns:repeat(2,1fr)}.hero{padding:28px}h1{font-size:32px}}@media(max-width:520px){.wrap{padding:20px 14px 50px}.kpis,.metrics,.method{grid-template-columns:1fr}}
</style></head><body><main class="wrap">
<header class="hero"><p>统一首发价口径 · 审计报告</p><h1>产品残值曲线</h1><p>曲线只与“同地区、同型号、同配置的已核验首发官方价”计算出的保值率比较。挂牌、成交、回收报价明确分开；替代价值率和个体投资保值率仅作独立观察，不参与曲线拟合或 MAE。</p><div class="kpis"><div class="kpi"><b>${payload.summary.observations}</b>结构化观测</div><div class="kpi"><b>${payload.summary.launch_linked}</b>首发价链接</div><div class="kpi"><b>${payload.summary.calibration_eligible}</b>可校准观测</div><div class="kpi"><b>${payload.summary.categories}</b>审计品类</div></div></header>
<section class="section"><h2>结论先行</h2><p class="notice">Mac mini v4.8 使用当前新品价作为历史产品分母，相关 MAE 与“拟合改善”结论已判定无效。v4.9 已撤销 18–48 月错误节点并恢复临时基线；由于当前数据仍未达到跨代际、年龄带和成交/实付覆盖门槛，本次不进行正式重拟合。</p></section>
<section class="section"><h2>三种比率，三种用途</h2><div class="method"><div><b>曲线观测保值率</b>二手观测价 ÷ 同配置首发官方价。只有它能和理论曲线比较；仍须通过事件、置信度与样本门槛。</div><div><b>替代价值率</b>二手观测价 ÷ 当前同档新品价。用于“现在换一台要多少钱”的决策，不参与曲线拟合。</div><div><b>个体投资保值率</b>二手观测价 ÷ 用户实际买入价。用于个人持有收益复盘，不参与通用曲线拟合。</div></div></section>
<section class="section"><h2>全品类曲线与观测层</h2><p class="lead">蓝线为 constants 中的理论曲线。绿点才是可比口径；橙色方块、紫色菱形是另外两种决策比率。MAE 仅在存在合格绿色观测时显示为只读指标，绝不用于为本次节点变更背书。</p><div class="cards">${categories.map(categoryCard).join('')}</div></section>
<section class="section"><h2>全部观测与排除原因</h2><p class="lead">价格类型按原始证据标示：listing 为“挂牌价”，不会显示成“成交价”。空值表示缺少可核验分母，系统不会从备注或当前新品价猜测。</p><div class="table-wrap"><table><thead><tr><th>品类 / 型号</th><th>观测日</th><th>价格类型</th><th class="num">观测价</th><th class="num">首发价</th><th class="num">曲线观测保值率</th><th class="num">替代价值率</th><th class="num">个体投资保值率</th><th>校准资格</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></section>
<footer>数据：.agents/skills/apple-value-analysis/constants.json v${escapeHtml(payload.constants_version)}（${escapeHtml(payload.data_date)}） · 报告为单文件、无外部脚本与字体依赖 · 详细机器可读负载：scripts/debug/residual-curves-payload.json</footer>
<script id="payload" type="application/json">${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script></main></body></html>`;

const debugDir = path.join(ROOT, 'scripts/debug');
fs.mkdirSync(debugDir, { recursive: true });
const payloadPath = path.join(debugDir, 'residual-curves-payload.json');
const reportPath = path.join(ROOT, `${constants.metadata.last_updated}-产品残值曲线可视化.html`);
fs.writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, html, 'utf8');
console.log(`观测 ${payload.summary.observations} 条；首发价链接 ${payload.summary.launch_linked}；可校准 ${payload.summary.calibration_eligible}`);
console.log(`报告: ${reportPath}`);
console.log(`负载: ${payloadPath}`);
