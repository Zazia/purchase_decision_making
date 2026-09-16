#!/usr/bin/env node
/**
 * run-pipeline.mjs — 共享方案用户提交价离线管线 (data-maintenance-automation)
 *
 * 流程: 加载台账 → 增量拉取 shared_results (版本/用途筛选 + processedIds 去重)
 *   → 按 机型+买入时机(+渠道) 聚合 → 置信度分级 → 生成 Markdown 修正建议报告 → 回写台账
 *
 * 产物:
 *   - 报告:   scripts/intake/reports/YYYY-MM-DD-intake-report.md (入库, 人工审核依据)
 *   - 台账:   scripts/intake/ledger.json (入库, 水位线与累计分组样本)
 *   - 原始缓存: scripts/debug/intake-export-<date>.json (gitignore, 含原始记录)
 *
 * 用法: node scripts/intake/run-pipeline.mjs [--env <envId>]
 *
 * 失败语义: 凭证缺失/接口失败 → 退出非零码且台账不变 (幂等重跑);
 *   集合不存在 → 非零失败；集合已建但无新数据 → 正常空跑。
 * 红线: 本管线 MUST NOT 修改 constants.json 或云端 constants 文档 (修正建议仅供人工审核)。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createCloudClient, CloudApiError } from '../lib/wx-cloud-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTAKE_DIR = resolve(__dirname);
const ROOT = resolve(INTAKE_DIR, '..', '..');
const REPORTS_DIR = join(INTAKE_DIR, 'reports');
const LEDGER_FILE = join(INTAKE_DIR, 'ledger.json');
const DEBUG_DIR = join(ROOT, 'scripts', 'debug');
const CONSTANTS_FILE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const COLLECTION = 'shared_results';
const CONSENT_VERSION = 'share-price-analysis-v1';

// ---- 置信度分级阈值 (对齐 openspec/specs/crowdsourced-price-intake 规范示例值) ----
const MIN_SAMPLES = 20;      // 同组累计提交数门槛
const MAX_MAD_RATIO = 0.15;  // 中位绝对偏差/中位价 (提交价与历史中位价的偏离度)
const MAX_CV = 0.4;           // 标准差/均值 (价格离散度)
// 渠道可信度: 当前小程序 PlanPoint 无渠道字段, 取中性因子 1.0 (待端上补齐后生效)
const CHANNEL_CREDIBILITY = 1.0;

function fail(step, message) {
  console.error(`[intake-pipeline] FAIL @ ${step}: ${message}`);
  process.exit(1);
}

// ---------- 统计工具 ----------
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const std = (arr) => {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
};
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const round1 = (x) => Math.round(x * 10) / 10;
/** 去掉 model 末尾 " × Ny年" 后缀, 得到 modelKey */
const stripHoldingYearsSuffix = (model) =>
  typeof model === 'string' ? model.replace(/\s*×\s*\d+(\.\d+)?\s*年\s*$/, '') : model;
/** 归一化键名: 小写去分隔符但保留中文 (否则「新品/二手」后缀会被抹掉导致误匹配), 用于品类/机型宽松匹配 */
const normalizeKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

// ---------- 台账 ----------
function loadLedger(ledgerFile) {
  const empty = { schemaVersion: 2, sourceCollection: COLLECTION, watermark: null, processedIds: [], groups: {}, runs: [] };
  if (!existsSync(ledgerFile)) return empty;
  const old = JSON.parse(readFileSync(ledgerFile, 'utf-8'));
  if (old.schemaVersion !== 2 || old.sourceCollection !== COLLECTION) {
    if (old.processedIds?.length || Object.keys(old.groups ?? {}).length || old.watermark) {
      throw new Error('旧台账非空，请用 --ledger <独立路径> 重建 shared_results 台账；原文件未修改');
    }
    return { ...empty, runs: old.runs ?? [] };
  }
  if (!Array.isArray(old.processedIds) || !old.groups || !Array.isArray(old.runs)
    || (old.watermark !== null && !Number.isFinite(old.watermark))
    || Object.values(old.groups).some(g => !g.dimensions || !Array.isArray(g.prices))) {
    throw new Error('台账格式无效，原文件未修改');
  }
  return old;
}

export function dimensionsOf(p, category) {
  return { category, model: stripHoldingYearsSuffix(p.model), chip: p.chip,
    memoryGb: p.memoryGb ?? null, storageGb: p.storageGb ?? null, buyTiming: p.buyTiming,
    channel: p.channel ?? null, useSubsidy: p.useSubsidy ?? null };
}
const groupKeyOf = (p, category) => JSON.stringify(dimensionsOf(p, category));
export function skipReason(rec, includeTest = false) {
  if (rec.schemaVersion !== 2) return 'legacy';
  if (rec.consentVersion !== CONSENT_VERSION) return 'consent';
  if (rec.isTest === true && !includeTest) return 'test';
  if (!Array.isArray(rec.submittedPlans) || rec.submittedPlans.length === 0) return 'ordinary';
  if (!Number.isFinite(rec.createdAt) || rec.createdAt <= 0 || !rec.params?.category) return 'invalid';
  if (rec.submittedPlans.some(p => !p || !Number.isFinite(p.buyPrice) || p.buyPrice <= 0
    || !Number.isFinite(p.holdingYears) || p.holdingYears <= 0 || !['edited', 'custom'].includes(p.source)
    || p.predictedPrice !== false || !p.sourceId || typeof p.model !== 'string' || !p.model
    || typeof p.chip !== 'string' || !['new', 'used'].includes(p.buyTiming))) return 'invalid';
  return null;
}

/** 累计分组后统一分级; prices 为该组全部历史提交价 */
function gradeGroup(group) {
  const prices = group.prices;
  if (prices.length === 0) return { eligible: false, reason: '无样本' };
  const med = median(prices);
  const mad = median(prices.map((p) => Math.abs(p - med)));
  const madRatio = med > 0 ? mad / med : Infinity;
  const cv = mean(prices) > 0 ? std(prices) / mean(prices) : Infinity;
  const factors = [];
  if (prices.length < MIN_SAMPLES) factors.push(`样本不足(${prices.length}/${MIN_SAMPLES})`);
  if (madRatio > MAX_MAD_RATIO) factors.push(`偏离度过大(MAD比${round1(madRatio * 100)}%>${MAX_MAD_RATIO * 100}%)`);
  if (cv > MAX_CV) factors.push(`离散度过大(CV${round1(cv * 100)}%>${MAX_CV * 100}%)`);
  return {
    eligible: factors.length === 0,
    reason: factors.length === 0 ? '达标' : factors.join('; '),
    count: prices.length,
    median: med,
    madRatio,
    cv,
  };
}

// ---------- constants 现值对照 (尽力匹配, D5) ----------
function loadSnapshotIndex(constants) {
  const snap = constants['实时市场价快照'] || {};
  const byCat = {};
  for (const [cat, entries] of Object.entries(snap)) {
    if (cat.startsWith('_') || cat === 'snapshot_date' || cat === 'snapshot_sources'
      || cat === '近期重大价格事件') continue;
    if (entries && typeof entries === 'object') byCat[cat] = entries;
  }
  return byCat;
}

/** 按 品类前缀 + modelKey 尽力匹配快照条目, 返回 { category, entryKey, field, value } 或 null */
export function matchSnapshotValue(snapshotIndex, dimensions) {
  const { category, model, chip, memoryGb, storageGb, buyTiming, channel, useSubsidy } = dimensions;
  // 渠道和补贴口径未知时不猜测；严格同配置、唯一候选。
  let field;
  if (buyTiming === 'used' && channel === '闲鱼' && useSubsidy === false) field = '闲鱼中位价_二手同款';
  else if (buyTiming === 'new' && channel === '京东' && useSubsidy === true) field = '京东国补到手价';
  else if (buyTiming === 'new' && channel === '官方' && useSubsidy === false) field = '官方价';
  else return null;
  const matches = [];
  for (const [cat, entries] of Object.entries(snapshotIndex)) {
    if (!normalizeKey(cat).startsWith(normalizeKey(category))) continue;
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object' || normalizeKey(key) !== normalizeKey(model)) continue;
      if (chip && !normalizeKey(key).includes(normalizeKey(chip))) continue;
      if (memoryGb !== null && !new RegExp(`(^|_)${memoryGb}G(B)?(_|$)`, 'i').test(key)) continue;
      if (storageGb !== null && !new RegExp(`(^|_)${storageGb}G(B)?(_|$)`, 'i').test(key)) continue;
      const actualField = field === '闲鱼中位价_二手同款' && !(field in entry) ? '闲鱼中位价' : field;
      if (Number.isFinite(entry[actualField]) && entry[actualField] > 0) matches.push({ category: cat, entryKey: key, field: actualField, value: entry[actualField] });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

// ---------- 主流程 (可注入, 供测试) ----------
/**
 * @param {object} [options]
 * @param {() => Promise<{envLabel: string, records: any[]}>} [options.fetchRecords]
 *   记录源: 缺省从云端拉取; 测试可注入 stub。集合不存在报错。
 * @param {object} [options.files] 覆盖产物路径 (测试注入临时目录)
 */
export async function runPipeline(options = {}) {
  const { fetchRecords, files = {} } = options;
  const ledgerFile = files.ledgerFile ?? LEDGER_FILE;
  const reportsDir = files.reportsDir ?? REPORTS_DIR;
  const debugDir = files.debugDir ?? DEBUG_DIR;
  const constantsFile = files.constantsFile ?? CONSTANTS_FILE;

  const ledger = loadLedger(ledgerFile);
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[intake-pipeline] 共享方案离线管线启动 (${today})`);
  console.log(`[intake-pipeline] 台账: watermark=${ledger.watermark || '(无, 将全量消费)'}, `
    + `已处理 ${ledger.processedIds.length} 条, 累计分组 ${Object.keys(ledger.groups).length} 个`);

  // 1. 拉取共享方案 (失败不改台账)
  const source = await (fetchRecords ?? fetchFromCloud)();
  const { envLabel, records } = source;
  console.log(`[intake-pipeline] 记录源环境: ${envLabel}`);
  const fetchedCount = records.length;

  // 2. processedIds 增量过滤 (水位线作审计展示, 去重以 _id 为准, 抗乱序 createdAt)
  const seen = new Set(ledger.processedIds);
  const newRecords = records.filter(r => {
    if (typeof r._id !== 'string' || !r._id) throw new Error('记录缺少 ID');
    const key = COLLECTION + ':' + r._id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  console.log(`[intake-pipeline] 拉取 ${fetchedCount} 条, 其中新增 ${newRecords.length} 条`);

  // 3. 原始缓存 (含原始记录, 落 gitignore 目录)
  if (newRecords.length > 0) {
    if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
    const cachePath = join(debugDir, `intake-export-${today}-${Date.now()}.json`);
    writeFileSync(cachePath, JSON.stringify(newRecords, null, 2));
    console.log(`[intake-pipeline] 原始缓存: ${cachePath}`);
  }

  // 4. 聚合新增样本点
  let constants = null;
  try {
    constants = JSON.parse(readFileSync(constantsFile, 'utf-8'));
  } catch (err) {
    fail('constants-parse', `读取 constants.json 失败: ${err.message}`);
  }
  const snapshotIndex = loadSnapshotIndex(constants);

  const newGroups = {};      // 本次新增的组内样本
  const deviationPairs = []; // 推荐 vs 用户提交价偏差
  let newPoints = 0;
  const skipped = { legacy: 0, consent: 0, test: 0, ordinary: 0, invalid: 0 };
  for (const rec of newRecords) {
    const reason = skipReason(rec);
    if (reason) { skipped[reason]++; continue; }
    const observations = new Set();
    const category = rec.params?.category || 'unknown';
    const plans = Array.isArray(rec.submittedPlans) ? rec.submittedPlans : [];
    const originals = Array.isArray(rec.originalPlans) ? rec.originalPlans : [];
    for (const p of plans) {
      if (typeof p?.buyPrice !== 'number' || !(p.buyPrice > 0)) continue;
      const key = groupKeyOf(p, category);
      const observation = key + ':' + p.buyPrice;
      if (observations.has(observation)) continue;
      observations.add(observation);
      (newGroups[key] ??= { dimensions: dimensionsOf(p, category), prices: [] }).prices.push(p.buyPrice);
      newPoints++;
      // 推荐 vs 用户提交: 同 modelKey+chip+buyTiming 的原始方案对照
      const mk = stripHoldingYearsSuffix(p.model);
      const orig = originals.find(o => o.sourceId === p.sourceId && o.buyPrice > 0
        && stripHoldingYearsSuffix(o.model) === mk && o.chip === p.chip && o.buyTiming === p.buyTiming
        && (o.memoryGb ?? null) === (p.memoryGb ?? null) && (o.storageGb ?? null) === (p.storageGb ?? null));
      if (orig) {
        deviationPairs.push({
          category,
          modelKey: mk,
          channel: p.channel ?? '未知', useSubsidy: p.useSubsidy ?? '未知',
          memoryGb: p.memoryGb ?? '未知', storageGb: p.storageGb ?? '未知',
          submitted: p.buyPrice,
          original: orig.buyPrice,
          deviation: (p.buyPrice - orig.buyPrice) / orig.buyPrice,
        });
      }
    }
  }

  // 5. 合并台账累计分组
  const mergedGroups = JSON.parse(JSON.stringify(ledger.groups));
  for (const [key, g] of Object.entries(newGroups)) {
    (mergedGroups[key] ??= { dimensions: g.dimensions, prices: [] });
    mergedGroups[key].prices.push(...g.prices);
  }

  // 6. 分级
  const graded = [];
  for (const [key, g] of Object.entries(mergedGroups)) {
    const dimensions = g.dimensions;
    const grade = gradeGroup(g);
    g.grade = grade;
    graded.push({ key, ...dimensions, ...grade });
  }
  graded.sort((a, b) => b.count - a.count);
  const eligibleGroups = graded.filter((g) => g.eligible);

  // 7. 报告 (先写报告, 报告成功后再落台账)
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  let reportPath = join(reportsDir, `${today}-intake-report.md`);
  if (existsSync(reportPath)) {
    reportPath = join(reportsDir,
      `${today}-intake-report-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.md`);
  }

  const byCategoryCount = {};
  for (const g of graded) byCategoryCount[g.category] = (byCategoryCount[g.category] || 0) + g.count;

  const devByCategory = {};
  for (const d of deviationPairs) {
    (devByCategory[d.category] ??= []).push(d.deviation);
  }

  const lines = [];
  lines.push(`# 用户提交价修正建议报告 (${today})`);
  lines.push('');
  lines.push('> ⚠️ **仅供人工审核，禁止直接回写**——本报告由离线管线自动生成，'
    + '「可纳入」组合须经人工复核后按既有 SOP 合入 constants.json，并走 constants:release 发布。');
  lines.push('');
  lines.push('## 1. 运行概览');
  lines.push('');
  lines.push(`- 云环境: \`${envLabel}\``);
  lines.push(`- 来源: ${COLLECTION} / schemaVersion=2；用途版本: ${CONSENT_VERSION}`);
  lines.push(`- 跳过: ${JSON.stringify(skipped)} (legacy=旧分享、consent=无有效同意、test=测试、ordinary=普通分享、invalid=无效)`);
  lines.push(`- 拉取记录: ${fetchedCount} 条, 其中新增: ${newRecords.length} 条, 新增样本点: ${newPoints} 个`);
  lines.push(`- 水位线: ${ledger.watermark || '(无)'} → ${newRecords.length > 0
    ? newRecords.reduce((m, r) => (Number.isFinite(r.createdAt) && r.createdAt > m ? r.createdAt : m), ledger.watermark || 0) : ledger.watermark || '(无)'}`);
  lines.push(`- 台账累计: 分组 ${graded.length} 个, 累计样本 ${graded.reduce((s, g) => s + g.count, 0)} 个`);
  lines.push(`- 分级阈值: 样本 ≥${MIN_SAMPLES}, MAD/中位价 ≤${MAX_MAD_RATIO * 100}%, CV ≤${MAX_CV * 100}%`
    + `, 渠道因子 ${CHANNEL_CREDIBILITY} (中性, 未核实渠道，按中性处理)`);
  if (newPoints === 0) {
    lines.push('');
    lines.push('**本次无新增价格样本**。以下为既有台账累计汇总。');
  }
  lines.push('');
  lines.push('## 2. 累计样本概览 (按品类)');
  lines.push('');
  lines.push('| 品类 | 累计样本 |');
  lines.push('|------|---------|');
  for (const [cat, n] of Object.entries(byCategoryCount).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cat} | ${n} |`);
  }
  if (Object.keys(byCategoryCount).length === 0) lines.push('| (无) | 0 |');
  lines.push('');
  lines.push('## 3. 分组置信度分级');
  lines.push('');
  if (graded.length === 0) {
    lines.push('(尚无任何累计样本。)');
  } else {
    lines.push('| 品类 | 机型 | 芯片 | 内存/存储 | 渠道/国补 | 买卖 | 累计样本 | 中位价 | MAD偏离度 | 离散度CV | 结论 |');
    lines.push('|------|------|------|------|------|------|---------|--------|----------|----------|------|');
    for (const g of graded) {
      lines.push(`| ${g.category} | ${g.model} | ${g.chip} | ${g.memoryGb ?? '未知'}/${g.storageGb ?? '未知'} | ${g.channel ?? '未知'}/${g.useSubsidy ?? '未知'} | ${g.buyTiming} | ${g.count} | `
        + `${Math.round(g.median)} | ${pct(g.madRatio)} | ${pct(g.cv)} | ${g.eligible ? '**可纳入**' : `样本不足/置信度低 (${g.reason})`} |`);
    }
  }
  lines.push('');
  lines.push('## 4. 可纳入组合修正建议 (人工审核)');
  lines.push('');
  if (eligibleGroups.length === 0) {
    lines.push('(无可纳入组合——未达标分组保留共享方案继续累积, 不丢弃。)');
  } else {
    lines.push('| 品类 | 机型 | 配置/渠道/国补 | 买卖 | 共享方案中位价 | constants 现值 | 现值键路径 | 建议动作 |');
    lines.push('|------|------|------|------|-------------|---------------|-----------|----------|');
    for (const g of eligibleGroups) {
      const matched = matchSnapshotValue(snapshotIndex, g);
      const current = matched ? (matched.value ?? '字段非数值') : '待核对（配置或价格口径不可比）';
      const path = matched ? `实时市场价快照.${matched.category}.${matched.entryKey}.${matched.field}` : '—';
      const action = matched && typeof matched.value === 'number'
        ? `复核后将现值改为 ${Math.round(g.median)} (依据: ${g.count} 样本, MAD ${pct(g.madRatio)}, CV ${pct(g.cv)})`
        : '人工用 query-constants 查证键路径后评估';
      lines.push(`| ${g.category} | ${g.model} | ${g.chip || '未知'}/${g.memoryGb ?? '未知'}/${g.storageGb ?? '未知'}/${g.channel ?? '未知'}/${g.useSubsidy ?? '未知'} | ${g.buyTiming} | ${Math.round(g.median)} | ${current} | ${path} | ${action} |`);
    }
  }
  lines.push('');
  lines.push('## 5. 推荐 vs 用户提交价系统性偏差 (本次新增)');
  lines.push('');
  if (deviationPairs.length === 0) {
    lines.push('(本次新增样本无可配对的原始推荐方案, 或无新增样本。)');
  } else {
    lines.push('| 品类 | 配对数 | 平均偏差 | 中位偏差 | 解读 |');
    lines.push('|------|--------|----------|----------|------|');
    for (const [cat, devs] of Object.entries(devByCategory).sort((a, b) => b[1].length - a[1].length)) {
      const avg = mean(devs);
      const med = median(devs);
      const hint = avg < -0.1 ? '用户提交价普遍低于推荐价, 推荐价偏乐观'
        : avg > 0.1 ? '用户提交价普遍高于推荐价, 推荐价偏保守' : '推荐价与用户提交价基本一致';
      lines.push(`| ${cat} | ${devs.length} | ${pct(avg)} | ${pct(med)} | ${hint} |`);
    }
    lines.push('');
    lines.push('明细 (本次新增, 仅机型/价格维度):');
    for (const d of deviationPairs) {
      lines.push(`- ${d.category} ${d.modelKey} (${d.memoryGb}/${d.storageGb}, ${d.channel}/国补${d.useSubsidy}): 推荐 ${Math.round(d.original)} → 提交 ${Math.round(d.submitted)} (${pct(d.deviation)})`);
    }
  }
  lines.push('');
  lines.push('## 6. 声明');
  lines.push('');
  lines.push('- 本报告与台账不含匿名标识 (anonId) 等可关联个人的字段。');
  lines.push('- 渠道维度: 已按渠道与国补口径分别聚合；未知值保留为未知，渠道可信度因子暂按中性处理。');
  lines.push('- **红线**: 共享方案数据不自动回写快照; 合入须人工审核 + lint + 云端发布走 `pnpm constants:release`。');
  lines.push('');
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`[intake-pipeline] 报告已生成: ${reportPath}`);

  // 8. 台账回写 (报告成功之后)
  const newWatermark = newRecords.length > 0
    ? newRecords.reduce((m, r) => (Number.isFinite(r.createdAt) && r.createdAt > m ? r.createdAt : m), ledger.watermark || 0)
    : ledger.watermark;
  ledger.watermark = newWatermark;
  ledger.processedIds.push(...newRecords.map(r => COLLECTION + ':' + r._id));
  ledger.groups = mergedGroups;
  ledger.runs.push({
    date: new Date().toISOString(),
    fetched: fetchedCount,
    newRecords: newRecords.length,
    newPoints,
    skipped,
    sourceCollection: COLLECTION,
    groups: graded.length,
    eligibleGroups: eligibleGroups.length,
    watermark: newWatermark,
  });
  mkdirSync(dirname(ledgerFile), { recursive: true });
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
  console.log(`[intake-pipeline] 台账已更新: ${ledgerFile} (新增 ${newRecords.length} 条记录, ${newPoints} 个样本点)`);

  console.log(`[intake-pipeline] 完成: 分组 ${graded.length} 个 (可纳入 ${eligibleGroups.length}), `
    + `累计样本 ${graded.reduce((s, g) => s + g.count, 0)} 个`);
  return { reportPath, newRecords: newRecords.length, newPoints, eligibleGroups: eligibleGroups.length, skipped };
}

/** 诊断只读，不触碰缓存、台账、报告或 constants；输出仅分析白名单。 */
export async function diagnoseRecord(id, options = {}) {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new Error('invalid share id');
  const client = options.client ?? await createCloudClient({ envId: options.envId });
  const rec = await client.getDoc(COLLECTION, id);
  if (!rec) throw new Error('shared_results 记录不存在');
  const fields = p => Object.fromEntries(['sourceId', 'model', 'chip', 'memoryGb', 'storageGb', 'buyTiming', 'holdingYears',
    'channel', 'useSubsidy', 'buyPrice', 'source', 'predictedPrice'].filter(k => p[k] !== undefined).map(k => [k, p[k]]));
  return { id, sourceCollection: COLLECTION, schemaVersion: rec.schemaVersion, consentVersion: rec.consentVersion,
    isTest: rec.isTest === true, skipReason: skipReason(rec), createdAt: rec.createdAt,
    submittedPlans: (rec.submittedPlans ?? []).map(fields), originalPlans: (rec.originalPlans ?? []).map(fields) };
}
async function fetchFromCloud(envId) {
  const client = await createCloudClient({ envId });
  return { envLabel: client.envId, records: await client.listCollection(COLLECTION) };
}
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) {
  const args = process.argv.slice(2);
  const value = flag => {
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('缺少参数: ' + flag);
    return args[index + 1];
  };
  try {
    const envId = value('--env');
    const id = value('--diagnose');
    const ledgerPath = value('--ledger');
    const task = id ? diagnoseRecord(id, { envId }).then(result => console.log(JSON.stringify(result, null, 2)))
      : runPipeline({ fetchRecords: () => fetchFromCloud(envId), files: ledgerPath ? { ledgerFile: resolve(ledgerPath) } : {} });
    task.catch(error => fail('run', error.message));
  } catch (error) { fail('arguments', error.message); }
}
