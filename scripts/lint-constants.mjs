#!/usr/bin/env node
/**
 * lint-constants.mjs — constants.json 结构校验 lint (data-maintenance-automation)
 *
 * 检查项:
 *   L1 JSON 可解析
 *   L2 metadata.last_updated 非空且为 YYYY-MM-DD 合法日期; metadata.version 非空
 *   L3 payload ≤ 450KB (云数据库单文档 512KB 的安全余量, 与 publish-constants 一致)
 *   L4 数值字段数字开头 (防引擎 parsePercent/Number 解析隐患):
 *      - 新品发布对老款冲击.{品类}.{均值,范围}
 *      - _分品类预测涨幅表._当前值_*.{品类}.{中位数} (预测涨幅允许「已发生/已官宣」状态词开头)
 *      - _宏观因子调整_v3.8._价格传导因子表.* (允许 +/− 符号开头)
 *      - 保值率曲线.{品类}.{月数键}、芯片性能跑分 全叶子、
 *        持有期预期维修成本.单次电池更换费用.{品类}、内存/存储体验权重叶子 → 必须是 number
 *      - 实时市场价快照 条目内价格字段: number | null | 数字开头字符串 | 非值标记开头
 *
 * 用法: node scripts/lint-constants.mjs [文件路径]
 *   缺省路径为源 constants.json; 传路径可对 fixture 副本校验。
 * 违规退出码 1 并逐条输出键路径与值; 全部通过退出码 0。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const MAX_PAYLOAD_BYTES = 450 * 1024;

const args = process.argv.slice(2);
const target = args[0] || SOURCE;

/** @type {Array<{rule: string, path: string, value: unknown, hint: string}>} */
const violations = [];

function fail(rule, path, value, hint) {
  violations.push({ rule, path, value, hint });
}

function showValue(v) {
  if (typeof v === 'string') return JSON.stringify(v.length > 60 ? v.slice(0, 60) + '…' : v);
  return JSON.stringify(v);
}

// ---- L1: 读取与解析 ----
let raw;
try {
  raw = readFileSync(target, 'utf-8');
} catch (err) {
  console.error(`[lint-constants] FAIL @ read: ${err.message}`);
  process.exit(1);
}
let constants;
try {
  constants = JSON.parse(raw);
} catch (err) {
  console.error(`[lint-constants] FAIL @ json-parse: ${err.message}`);
  process.exit(1);
}
console.log(`[lint-constants] 文件: ${target}`);
console.log('[lint-constants] ✓ JSON 解析: 通过');

// ---- L2: metadata ----
const metadata = constants.metadata || {};
if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  fail('metadata', 'metadata.version', metadata.version, 'version 缺失或为空, 数据更新时必须递增');
}
const lastUpdated = metadata.last_updated;
if (typeof lastUpdated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lastUpdated)
  || Number.isNaN(Date.parse(lastUpdated))) {
  fail('metadata', 'metadata.last_updated', lastUpdated, '须为 YYYY-MM-DD 合法日期且非空');
}
if (violations.length === 0) {
  console.log(`[lint-constants] ✓ metadata: version=${metadata.version}, last_updated=${lastUpdated}`);
}

// ---- L3: payload 体积 ----
const payloadBytes = Buffer.byteLength(raw, 'utf-8');
if (payloadBytes > MAX_PAYLOAD_BYTES) {
  fail('payload-size', '(payload)', `${payloadBytes} bytes`,
    `超过安全上限 ${MAX_PAYLOAD_BYTES} bytes (云数据库单文档 512KB)`);
} else {
  console.log(`[lint-constants] ✓ payload 体积: ${payloadBytes} bytes (≤ ${MAX_PAYLOAD_BYTES})`);
}

// ---- L4: 数值字段检查 ----
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
/** 数字开头(含正负号), 如 "12%"/"5-10%"/"-25%(...)"/"+0%(...)" */
const isNumericFirstString = (v) => typeof v === 'string' && /^[+-]?\d/.test(v.trim());

const impact = constants['新品发布对老款冲击'] || {};

// L4a: 冲击节 品类级 均值/范围 (引擎 lookupImpactMean 消费面)
for (const [cat, entry] of Object.entries(impact)) {
  if (!isPlainObject(entry) || cat.startsWith('_')) continue;
  for (const field of ['均值', '范围']) {
    const v = entry[field];
    if (v === undefined) continue;
    if (!(isNumber(v) || isNumericFirstString(v))) {
      fail('numeric-first', `新品发布对老款冲击.${cat}.${field}`, v,
        '引擎 parsePercent 消费字段, 数值字段须数字开头 (如 "10%" / "5-15%")');
    }
  }
}

// L4b: 分品类预测涨幅表 (引擎 lookupPriceHike 消费面)
const hikeTable = impact['_新品价格预测模型_v3.8']?.['_分品类预测涨幅表'] || {};
for (const [key, sub] of Object.entries(hikeTable)) {
  if (!key.startsWith('_当前值_') || !isPlainObject(sub)) continue;
  for (const [cat, entry] of Object.entries(sub)) {
    if (!isPlainObject(entry)) continue;
    const median = entry['中位数'];
    if (median !== undefined && !(isNumber(median) || isNumericFirstString(median))) {
      fail('numeric-first', `新品发布对老款冲击._新品价格预测模型_v3.8._分品类预测涨幅表.${key}.${cat}.中位数`,
        median, '引擎 parsePercent 消费字段, 须数字开头 (复合说明移入口径说明字段)');
    }
    const trend = entry['预测涨幅'];
    if (trend !== undefined && typeof trend === 'string'
      && !isNumericFirstString(trend) && !/^(已发生|已官宣|已涨价)/.test(trend.trim())) {
      fail('numeric-first', `新品发布对老款冲击._新品价格预测模型_v3.8._分品类预测涨幅表.${key}.${cat}.预测涨幅`,
        trend, '须数字开头, 或「已发生/已官宣/已涨价」状态词开头 (引擎据此判定 hasHikeOccurred)');
    }
  }
}

// L4c: 价格传导因子表 (引擎 lookupTransmissionFactor 消费面)
const transmission = impact['_宏观因子调整_v3.8']?.['_价格传导因子表'] || {};
for (const [rangeKey, v] of Object.entries(transmission)) {
  if (!(isNumber(v) || isNumericFirstString(v))) {
    fail('numeric-first', `新品发布对老款冲击._宏观因子调整_v3.8._价格传导因子表.${rangeKey}`, v,
      '引擎 parsePercent 消费字段, 须 +/-/数字开头 (如 "-15%(说明)")');
  }
}

// L4d: 保值率曲线 (引擎 Number(k)/Number(v) 消费面)
for (const [cat, curve] of Object.entries(constants['保值率曲线'] || {})) {
  if (!isPlainObject(curve)) continue;
  for (const [monthKey, v] of Object.entries(curve)) {
    if (monthKey.startsWith('_')) continue;
    if (!/^\d+(\.\d+)?$/.test(monthKey)) {
      fail('numeric-key', `保值率曲线.${cat}.${monthKey}`, monthKey, '曲线键须为月数数字键');
    }
    if (!isNumber(v)) {
      fail('numeric-value', `保值率曲线.${cat}.${monthKey}`, v,
        '引擎 Number(v) 消费字段, 须为 number (说明放 _ 开头字段)');
    }
  }
}

// L4e: 芯片性能跑分 (引擎 Number(多核) 消费面)
for (const [group, chips] of Object.entries(constants['芯片性能跑分'] || {})) {
  if (!isPlainObject(chips)) continue;
  for (const [chip, metrics] of Object.entries(chips)) {
    if (!isPlainObject(metrics)) continue;
    for (const [metric, v] of Object.entries(metrics)) {
      if (metric.startsWith('_')) continue;
      if (!isNumber(v)) {
        fail('numeric-value', `芯片性能跑分.${group}.${chip}.${metric}`, v,
          '引擎 Number() 消费字段, 须为 number');
      }
    }
  }
}

// L4f: 持有期预期维修成本.单次电池更换费用 (非 _ 品类键须为 number)
const battery = constants['持有期预期维修成本']?.['单次电池更换费用'] || {};
for (const [cat, v] of Object.entries(battery)) {
  if (cat.startsWith('_')) continue;
  if (!isNumber(v)) {
    fail('numeric-value', `持有期预期维修成本.单次电池更换费用.${cat}`, v,
      '须为 number (口径说明放 _ 开头字段, 如 _iPhone口径_v4.2)');
  }
}

// L4g: 内存/存储体验权重 叶子数值键
for (const section of ['内存体验权重', '存储体验权重']) {
  for (const [group, weights] of Object.entries(constants[section] || {})) {
    if (!isPlainObject(weights) || group.startsWith('_')) continue;
    for (const [sizeKey, v] of Object.entries(weights)) {
      if (sizeKey.startsWith('_')) continue;
      if (!/^\d/.test(sizeKey)) continue; // 只查数值型容量键
      if (!isNumber(v)) {
        fail('numeric-value', `${section}.${group}.${sizeKey}`, v, '权重值须为 number');
      }
    }
  }
}

// L4h: 实时市场价快照 价格字段 (防 T5 式复合文本污染, 如 "约748")
const NON_VALUE_MARKERS = ['无法', '待', '用户', '注', '暂无', '—', '无', '请'];
const snapshot = constants['实时市场价快照'] || {};
let snapshotChecked = 0;
for (const [cat, entries] of Object.entries(snapshot)) {
  if (cat.startsWith('_') || cat === 'snapshot_date' || cat === 'snapshot_sources'
    || cat === '近期重大价格事件') continue;
  if (!isPlainObject(entries)) continue;
  for (const [entryKey, entry] of Object.entries(entries)) {
    if (entryKey.startsWith('_') || !isPlainObject(entry)) continue;
    for (const [field, v] of Object.entries(entry)) {
      if (field.startsWith('_') || !/价$|报价|到手价|中位价/.test(field)) continue;
      // 含 参考/来源/说明 等后缀的字段是注记文本 (引擎仅消费 number 型 _参考 值), 跳过
      if (/来源|说明|样本|参考|口径/.test(field)) continue;
      if (v === null || isNumber(v)) { snapshotChecked++; continue; }
      if (Array.isArray(v)) {
        const bad = v.some((el) => !(el === null || isNumber(el)));
        if (bad) fail('price-field', `实时市场价快照.${cat}.${entryKey}.${field}`, v, '价格区间元素须为 number|null');
        snapshotChecked++;
        continue;
      }
      if (typeof v === 'string') {
        if (isNumericFirstString(v) || NON_VALUE_MARKERS.some((m) => v.trim().startsWith(m))) {
          snapshotChecked++;
        } else {
          fail('price-field', `实时市场价快照.${cat}.${entryKey}.${field}`, v,
            '价格字段须数字开头, 非值须以「无法/待/用户/注」等标记开头 (复合说明移入 _ 开头字段)');
        }
      }
    }
  }
}

// ---- 汇总 ----
if (violations.length > 0) {
  console.log(`[lint-constants] ✗ 数值字段检查: ${violations.length} 项违规`);
  for (const v of violations) {
    console.log(`  ✗ [${v.rule}] ${v.path} = ${showValue(v.value)} — ${v.hint}`);
  }
  console.error(`[lint-constants] FAIL: 共 ${violations.length} 项违规, 修复后重试`);
  process.exit(1);
}
console.log(`[lint-constants] ✓ 数值字段检查: 冲击/涨幅表/传导因子/曲线/跑分/维修成本/权重 通过, 快照价格字段 ${snapshotChecked} 处通过`);
console.log('[lint-constants] PASS: 全部检查通过');
