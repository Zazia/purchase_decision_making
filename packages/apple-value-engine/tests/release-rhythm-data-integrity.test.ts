/**
 * v4.6 数据体检测试: 「苹果产品发布节奏.下一次预计」数据契约
 *
 * 背景 (2026-09-09 修复 P1, openspec change: fix-release-rhythm-next-expected):
 * Mac_mini/Mac_Studio 的「下一次预计」曾把已发生的历史发布(2026-08-25 官宣 M6/M5)
 * 写在「下一次」预测之前, parseReleaseMonth 按约定取文本首个 YYYY-MM, 解析出过去月
 * (2026-08 < 分析月 2026-09), computeResidualImpactFactor 中 monthsToRelease < 0
 * 恒返回 1 —— 持有期换代冲击被完全忽略, M4 Mac mini 二手持有 2 年残值明显偏高。
 *
 * 守护的数据契约 (specs/release-rhythm-data-integrity/spec.md):
 * 1. 非下划线品类 nextReleaseMonth === null (有意留空, 记录清单) 或 ≥ 分析月
 *    (分析月 = metadata.last_updated 的 YYYY-MM 前缀)
 * 2. 有「下一次预计」的品类在 _当前校验结果_<date> 快照中必有对应条目,
 *    置信度以 高/中/低 开头 (兼容引擎 lookupConfidence 首字解析)
 * 3. 已滚动代 (节奏表含 _最近发布_v* 注记, 即上一代已官宣/发售):
 *    涨幅表不得保留「已官宣」标记 (引擎 anchorHike 必须为 0, 已发售代锚涨幅
 *    不得错挂下一代), 快照置信度不得为「高」(下一代外推应为 中/低)
 *
 * 污染数据时本文件 MUST 红; 变异数据用例验证各检出路径本身有效。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, parseReleasePlan } from '../src/index.js';
import type { Constants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

// ============================================================================
// 体检逻辑 (纯函数: 干净/污染两态共用, 变异用例验证检出能力)
// ============================================================================

interface RhythmAuditReport {
  analysisMonth: string;
  /** 解析月 < 分析月 (历史发布日期污染预测字段) —— MUST 为空 */
  polluted: { category: string; nextReleaseMonth: string; text: string }[];
  /** 有意留空 / 文本无法解析 —— 可接受, 但列出供人工确认 */
  missing: { category: string; reason: string }[];
  /** 有「下一次预计」但置信度快照缺条目 —— MUST 为空 */
  missingConfidence: { category: string }[];
  /** 快照置信度不以 高/中/低 开头 —— MUST 为空 */
  badConfidence: { category: string; confidence: string }[];
  /** 已滚动代仍标「已官宣」(anchorHike 错挂下一代) —— MUST 为空 */
  staleAnnounced: { category: string; anchorHike: number }[];
  /** 已滚动代快照置信度仍为「高」(外推预测应为 中/低) —— MUST 为空 */
  staleHighConfidence: { category: string; confidence: string }[];
  /** 全品类解析结果 (console 输出用) */
  parsed: { category: string; nextReleaseMonth: string | null; confidence: string }[];
}

function toMonthKey(s: string): string {
  const m = s.match(/^(\d{4})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : '';
}

/** 两位补零后字典序 = 时间序 (2026-08 < 2026-09 < 2027-03) */
function monthLt(a: string, b: string): boolean {
  return toMonthKey(a) < toMonthKey(b);
}

/** 与引擎 lookupConfidence 同规则: 取首个 _当前校验结果_ 前缀子表 */
function currentValidationSnapshot(
  constants: Constants,
): Record<string, { 置信度?: string }> | undefined {
  const validation = constants.releaseTimeValidation as Record<string, unknown> | undefined;
  if (!validation) return undefined;
  for (const [k, v] of Object.entries(validation)) {
    if (k.startsWith('_当前校验结果_') && v && typeof v === 'object') {
      return v as Record<string, { 置信度?: string }>;
    }
  }
  return undefined;
}

/** 大小写不敏感精确查找 (节奏表 Mac_Studio vs 快照 Mac_studio 等键名差异) */
function findEntryCaseInsensitive<T>(table: Record<string, T>, key: string): T | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(table)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** 品类是否已滚动代 (含 _最近发布_v* 注记: 上一代已官宣/发售, 下一次已指向再下一代) */
function hasRecentReleaseNote(entry: Record<string, unknown>): boolean {
  return Object.keys(entry).some((k) => /^_最近发布_v/.test(k));
}

function auditReleaseRhythm(constants: Constants): RhythmAuditReport {
  const analysisMonth = toMonthKey(constants.lastUpdated);
  const rhythm = constants.releaseRhythm ?? {};
  const categories = Object.keys(rhythm).filter((k) => !k.startsWith('_'));
  const snapshot = currentValidationSnapshot(constants);

  const report: RhythmAuditReport = {
    analysisMonth,
    polluted: [],
    missing: [],
    missingConfidence: [],
    badConfidence: [],
    staleAnnounced: [],
    staleHighConfidence: [],
    parsed: [],
  };

  for (const category of categories) {
    const entry = rhythm[category] as Record<string, unknown>;
    const text = entry['下一次预计'];
    const hasText = typeof text === 'string' && text.length > 0;
    const plan = parseReleasePlan(constants, category);
    const next = plan?.nextReleaseMonth ?? null;

    // 契约 1: 解析月 === null (记录) 或 ≥ 分析月
    if (!hasText) {
      report.missing.push({ category, reason: '字段缺失(若有意留空请核对)' });
    } else if (next === null) {
      report.missing.push({ category, reason: `文本无法解析: ${String(text).slice(0, 40)}` });
    } else if (monthLt(next, analysisMonth)) {
      report.polluted.push({ category, nextReleaseMonth: next, text: String(text) });
    }

    // 契约 2: 有「下一次预计」的品类必有快照条目, 置信度以 高/中/低 开头
    if (hasText) {
      const snapEntry = snapshot ? findEntryCaseInsensitive(snapshot, category) : undefined;
      if (!snapEntry) {
        report.missingConfidence.push({ category });
      } else {
        const conf = snapEntry.置信度 ?? '';
        if (!/^(高|中|低)/.test(conf)) {
          report.badConfidence.push({ category, confidence: conf || '(空)' });
        }
        // 契约 3b: 已滚动代置信度不得为「高」
        if (hasRecentReleaseNote(entry) && conf.startsWith('高')) {
          report.staleHighConfidence.push({ category, confidence: conf });
        }
      }
    }

    // 契约 3a: 已滚动代涨幅表不得保留「已官宣」→ 引擎 anchorHike 必须为 0
    if (hasRecentReleaseNote(entry) && plan && plan.anchorHike !== 0) {
      report.staleAnnounced.push({ category, anchorHike: plan.anchorHike });
    }

    report.parsed.push({
      category,
      nextReleaseMonth: next,
      confidence: snapshot
        ? (findEntryCaseInsensitive(snapshot, category)?.置信度 ?? '(无条目)')
        : '(无快照)',
    });
  }
  return report;
}

function printReport(report: RhythmAuditReport): void {
  const lines = report.parsed.map(
    (p) => `  ${p.category.padEnd(14)} 下一次: ${p.nextReleaseMonth ?? '(缺失)'}  置信度: ${p.confidence}`,
  );
  console.log(
    `[发布节奏体检] 分析月 ${report.analysisMonth} | 品类 ${report.parsed.length} 个\n${lines.join('\n')}`,
  );
  if (report.missing.length > 0) {
    console.log(
      `[缺失清单] (可接受, 供人工确认)\n${report.missing.map((m) => `  ${m.category}: ${m.reason}`).join('\n')}`,
    );
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('v4.6 发布节奏数据体检: 下一次预计数据契约', () => {
  it('真实常量库: 所有品类解析月 ≥ 分析月, 无历史发布文本污染 (P1 防复发)', () => {
    const report = auditReleaseRhythm(loadConstants(constantsJson));
    printReport(report);
    expect(report.polluted).toEqual([]);
  });

  it('真实常量库: 置信度快照与预测字段联动 (P5 防复发)', () => {
    const report = auditReleaseRhythm(loadConstants(constantsJson));
    expect(report.missingConfidence).toEqual([]);
    expect(report.badConfidence).toEqual([]);
  });

  it('真实常量库: 已滚动代 (Mac_mini/Mac_Studio) 涨幅表无「已官宣」标记, anchorHike=0 (P4 防复发)', () => {
    const constants = loadConstants(constantsJson);
    const report = auditReleaseRhythm(constants);
    expect(report.staleAnnounced).toEqual([]);
    expect(report.staleHighConfidence).toEqual([]);
    // 引擎口径直接复核: 已发售 M6/M5 的锚涨幅不得错挂 M7/M8 下一代
    expect(parseReleasePlan(constants, 'Mac_mini')!.anchorHike).toBe(0);
    expect(parseReleasePlan(constants, 'Mac_Studio')!.anchorHike).toBe(0);
  });

  it('污染检出路径 1: 历史发布写在下一次之前 → 解析月早于分析月 (v4.5 及以前的 Mac_mini 病灶)', () => {
    const cloned = structuredClone(loadConstants(constantsJson)) as Constants;
    (cloned.releaseRhythm.Mac_mini as Record<string, unknown>)['下一次预计'] =
      '已发生:2026-08-25官宣M6+M5 Pro,9-22发售(M6基础款6999元起)。下一次:约2027-09 M7世代(MacRumors报道)';
    const report = auditReleaseRhythm(cloned);
    const hit = report.polluted.find((p) => p.category === 'Mac_mini');
    expect(hit).toBeDefined();
    expect(hit!.nextReleaseMonth).toBe('2026-08'); // 首个 YYYY-MM 解析出过去月
  });

  it('污染检出路径 2: 涨幅表「已官宣」未随代际滚动 → anchorHike 错挂下一代', () => {
    const cloned = structuredClone(loadConstants(constantsJson)) as Constants;
    const hikeTable = cloned.pricePredictionModel?._分品类预测涨幅表 as Record<string, unknown>;
    let current: Record<string, { 预测涨幅?: string }> | undefined;
    for (const [k, v] of Object.entries(hikeTable ?? {})) {
      if (k.startsWith('_当前值_') && v && typeof v === 'object') {
        current = v as Record<string, { 预测涨幅?: string }>;
        break;
      }
    }
    expect(current).toBeDefined();
    current!.Mac_mini.预测涨幅 = '已官宣(M6实测16.7%)'; // 模拟 v4.5 遗留标记
    const report = auditReleaseRhythm(cloned);
    expect(report.staleAnnounced.map((s) => s.category)).toContain('Mac_mini');
    expect(parseReleasePlan(cloned, 'Mac_mini')!.anchorHike).toBeGreaterThan(0); // 引擎确实会错挂
  });

  it('污染检出路径 3: 快照缺条目 / 置信度非法开头 / 已滚动代仍「高」', () => {
    // a) 删除 iPad_标准 快照条目 → missingConfidence
    const a = structuredClone(loadConstants(constantsJson)) as Constants;
    const snapA = currentValidationSnapshot(a)!;
    delete snapA.iPad_标准;
    expect(auditReleaseRhythm(a).missingConfidence.map((m) => m.category)).toContain('iPad_标准');

    // b) Mac_mini 快照置信度改回「高(已官宣)」→ staleHighConfidence
    const b = structuredClone(loadConstants(constantsJson)) as Constants;
    currentValidationSnapshot(b)!.Mac_mini.置信度 = '高(已官宣)';
    expect(auditReleaseRhythm(b).staleHighConfidence.map((s) => s.category)).toContain('Mac_mini');

    // c) 置信度不以 高/中/低 开头 → badConfidence
    const c = structuredClone(loadConstants(constantsJson)) as Constants;
    currentValidationSnapshot(c)!.iMac.置信度 = '媒体爆料';
    expect(auditReleaseRhythm(c).badConfidence.map((s) => s.category)).toContain('iMac');
  });
});
