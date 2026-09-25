#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '.agents/skills/apple-value-analysis/constants.json');
const constants = JSON.parse(readFileSync(SOURCE, 'utf8'));
const snapshot = constants['实时市场价快照'];
const releases = constants['产品发布日期'];
const categories = [
  'Mac_mini', 'iPhone_proMax', 'iPhone_Pro', 'iPhone_标准',
  'MacBook_Air', 'MacBook_Pro', 'iPad_Pro', 'iPad_Air', 'iPad_标准', 'iPad_mini',
];

function extractNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const numbers = (value.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((number) => number >= 30);
  if (!numbers.length) return null;
  if (numbers.length >= 2 && /\d+\s*[-~到至]\s*\d+/.test(value)) return Math.round((numbers[0] + numbers[1]) / 2);
  return Math.round(numbers[0]);
}

function usedPrice(record) {
  const fields = [
    '闲鱼中位价_二手同款', '闲鱼中位价', '闲鱼中位价_原值',
    '闲鱼中位价_二手同款_参考', '闲鱼中位价_二手同款_参考_资讯稿',
    '闲鱼中位价_二手同款_参考_资讯稿2', '闲鱼中位价_二手同款_参考_卖家挂单',
    '闲鱼中位价_二手同款_参考_海外',
  ];
  for (const field of fields) {
    const price = extractNumber(record[field]);
    if (price) return { price, field };
  }
  return null;
}

function matchRelease(category, item) {
  const name = item.replace(/_(新品|二手)$/, '');
  if (category.startsWith('iPhone')) {
    const match = name.match(/iPhone_(\d+)/);
    return match ? { date: releases[`iPhone_${match[1]}`], generation: `iPhone_${match[1]}` } : null;
  }
  if (category === 'Mac_mini' || category === 'MacBook_Air') {
    const match = name.match(/^(M\d[A-Za-z0-9]*)/);
    const prefix = category === 'Mac_mini' ? 'Mac_mini_' : 'MacBook_Air_';
    return match ? { date: releases[prefix + match[1]], generation: match[1] } : null;
  }
  if (category === 'MacBook_Pro') {
    const match = name.match(/^(M\d[A-Za-z0-9]*)_(\d+)寸/);
    if (!match) return null;
    const [, chip, rawSize] = match;
    const size = rawSize === '16' ? '16' : '14';
    return {
      date: releases[`MacBook_Pro_${size}_${chip}`]
        ?? releases[`MacBook_Pro_${size}_${chip.replace('Pro', '').replace('Max', '')}`],
      generation: chip,
    };
  }
  if (category.startsWith('iPad')) {
    const match = name.match(/^(M\d[A-Za-z0-9]*|A\d+[A-Za-z_0-9]*?)(?=_\d|\d+寸)/);
    if (!match) return null;
    const prefix = { iPad_Pro: 'iPad_Pro_', iPad_Air: 'iPad_Air_', iPad_mini: 'iPad_mini_' }[category];
    if (!prefix) return null;
    const chip = match[1];
    for (const candidate of [chip, chip.replace('_Pro', 'Pro'), chip.replace('Pro', ''), `${chip}Pro`, chip.replace('_', '')]) {
      if (releases[prefix + candidate]) return { date: releases[prefix + candidate], generation: chip };
    }
  }
  return null;
}

function configuration(category, modelKey) {
  const capacities = modelKey.split('_').flatMap((token) => {
    const match = token.match(/^(\d+)(G|TB)$/i);
    return match ? [match[2].toUpperCase() === 'TB' ? Number(match[1]) * 1024 : Number(match[1])] : [];
  });
  const size = modelKey.match(/(\d+(?:\.\d+)?)(?:寸|英寸)/)?.[1] ?? null;
  let chipTier = 'base';
  if (/Ultra/i.test(modelKey)) chipTier = 'ultra';
  else if (/Max|ProMax/i.test(modelKey) || category === 'iPhone_proMax') chipTier = 'max';
  else if (/Pro/i.test(modelKey) || category === 'iPhone_Pro' || category === 'iPad_Pro') chipTier = 'pro';
  return {
    size,
    chip_tier: chipTier,
    memory_gb: category.startsWith('Mac') && capacities.length >= 2 ? capacities.at(-2) : null,
    storage_gb: capacities.at(-1) ?? null,
  };
}

function confidence(value) {
  if (typeof value !== 'string') return 'low';
  if (value.startsWith('高')) return 'high';
  if (value.startsWith('中')) return 'medium';
  return 'low';
}

const firstOfficial = Object.fromEntries(categories.map((category) => {
  const match = Object.entries(snapshot[category] ?? {}).find(([item, record]) => (
    item.includes('新品') && typeof record?.['官方价'] === 'number'
  ));
  return [category, match?.[1]?.['官方价'] ?? null];
}));

const records = [];
for (const category of categories) {
  for (const [item, record] of Object.entries(snapshot[category] ?? {})) {
    if (!item.includes('二手') || !record || typeof record !== 'object') continue;
    const priceFact = usedPrice(record);
    const release = matchRelease(category, item);
    if (!priceFact || !release?.date) continue;

    const note = record['官方价_说明'] ?? '';
    const explicit = note.match(/(?:残值分母|分母)[^。]*?(\d{2,6})\s*元/);
    let legacyDenominator = null;
    let legacyDenominatorSource = '未确定';
    if (explicit) {
      legacyDenominator = Number(explicit[1]);
      legacyDenominatorSource = '说明明示';
    } else if (note.includes('当前在售同品类新品官方价') && firstOfficial[category]) {
      legacyDenominator = firstOfficial[category];
      legacyDenominatorSource = '同品类在售新品';
    }
    if (!legacyDenominator) continue;

    const sourceUrls = Array.isArray(record['搜索来源URL'])
      ? record['搜索来源URL']
      : (typeof record['搜索来源URL'] === 'string' ? [record['搜索来源URL']] : []);
    const modelKey = item.replace(/_二手$/, '');
    const sampleText = record['闲鱼样本量'] ?? record['样本量'];
    const sampleSize = typeof sampleText === 'number'
      ? Math.max(1, sampleText)
      : Math.max(1, Number(String(sampleText ?? '').match(/\d+/)?.[0] ?? 1));
    const isReference = priceFact.field.includes('参考');

    records.push({
      id: `legacy-${String(records.length + 1).padStart(3, '0')}`,
      category,
      generation: release.generation,
      model_key: modelKey,
      configuration: configuration(category, modelKey),
      region: 'CN',
      currency: 'CNY',
      observed_at: record['搜索日期'] || snapshot.snapshot_date,
      observed_price: priceFact.price,
      price_type: isReference ? 'reference' : 'listing',
      condition: 'unknown',
      sample_size: sampleSize,
      source_url: sourceUrls[0] ?? `legacy://market-snapshot/${category}/${encodeURIComponent(item)}`,
      source_urls: sourceUrls,
      confidence: confidence(record['置信度']),
      event_state: 'normal',
      launch_price_id: null,
      calibration_eligible: false,
      current_new_same_tier_price: legacyDenominatorSource === '同品类在售新品' ? legacyDenominator : null,
      actual_paid_price: null,
      legacy_trace: {
        snapshot_item: item,
        price_field: priceFact.field,
        denominator: legacyDenominator,
        denominator_source: legacyDenominatorSource,
        official_price_note: note,
        original_confidence: record['置信度'] ?? null,
      },
    });
  }
}

if (records.length !== 70) throw new Error(`Expected 70 migrated observations, got ${records.length}`);
const current = constants['二手价格观测']?.records ?? [];
if (current.length > 0 && !process.argv.includes('--replace')) {
  throw new Error('二手价格观测.records is not empty; pass --replace to replace the migration result explicitly');
}
constants['二手价格观测'].records = records;
writeFileSync(SOURCE, JSON.stringify(constants, null, 2) + '\n', 'utf8');
console.log(`[migrate-legacy-residual-observations] migrated=${records.length}`);
console.log(`[migrate-legacy-residual-observations] current-new=${records.filter((record) => record.legacy_trace.denominator_source === '同品类在售新品').length}`);
console.log(`[migrate-legacy-residual-observations] note-derived=${records.filter((record) => record.legacy_trace.denominator_source === '说明明示').length}`);
console.log('[migrate-legacy-residual-observations] all records remain calibration_eligible=false');
