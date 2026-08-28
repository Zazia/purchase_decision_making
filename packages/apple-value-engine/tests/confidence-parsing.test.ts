/**
 * P1 修复测试: 发布置信度解析容忍复合格式
 *
 * 背景 (2026-08-27 排障 P1): lookupConfidence 原用严格等值匹配,
 * constants v4.0 回填的 "高(已官宣)"、"中(主流媒体爆料,非官宣)" 等复合文本
 * 全部落入 low, 导致已官宣品类的类型 B/C 等待候选整体缺失。
 * 修复后改为前缀匹配 (startsWith)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, parseReleasePlan } from '../src/index.js';
import type { Constants, MacroContext } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

const defaultMacro: MacroContext = {
  storageSuperCycleStage: 'none',
  hasGlobalPriceHike: false,
  analysisMonth: '2026-08',
};

/** 深拷贝 constants 并把指定品类的置信度改为指定文本 */
function withConfidence(constants: Constants, category: string, conf: string): Constants {
  const cloned = structuredClone(constants) as Constants;
  const validation = cloned.releaseTimeValidation as Record<string, unknown>;
  for (const [k, v] of Object.entries(validation)) {
    if (k.startsWith('_当前校验结果_') && v && typeof v === 'object') {
      (v as Record<string, Record<string, string>>)[category]['置信度'] = conf;
      break;
    }
  }
  return cloned;
}

describe('置信度解析: 复合格式前缀匹配', () => {
  let base: Constants;
  beforeAll(() => {
    base = loadConstants(constantsJson);
  });

  it('"高(已官宣)" → high (真实数据: Mac_mini v4.0 回填)', () => {
    const plan = parseReleasePlan(base, 'Mac_mini', defaultMacro);
    expect(plan).not.toBeNull();
    expect(plan!.releaseConfidence).toBe('high');
  });

  it('"中(主流媒体爆料,非官宣)" → medium (真实数据: Apple_TV)', () => {
    const plan = parseReleasePlan(base, 'Apple_TV', defaultMacro);
    expect(plan).not.toBeNull();
    expect(plan!.releaseConfidence).toBe('medium');
  });

  it('纯 "高" 向后兼容 (真实数据: iPhone_Pro)', () => {
    const iPhonePro = parseReleasePlan(base, 'iPhone_Pro', defaultMacro);
    expect(iPhonePro!.releaseConfidence).toBe('high');
  });

  it('"高(已官宣)" (Mac_studio) 与 "中(媒体爆料)" (HomePod) 真实数据对照', () => {
    expect(parseReleasePlan(base, 'Mac_studio', defaultMacro)!.releaseConfidence).toBe('high');
    expect(parseReleasePlan(base, 'HomePod', defaultMacro)!.releaseConfidence).toBe('medium');
  });

  it('无法识别文本 → low (保守降级, 不生成错误候选)', () => {
    const mutated = withConfidence(base, 'Mac_mini', '完全无法解析的文本');
    const plan = parseReleasePlan(mutated, 'Mac_mini', defaultMacro);
    expect(plan!.releaseConfidence).toBe('low');
  });

  it('"低" → low', () => {
    const mutated = withConfidence(base, 'Mac_mini', '低');
    const plan = parseReleasePlan(mutated, 'Mac_mini', defaultMacro);
    expect(plan!.releaseConfidence).toBe('low');
  });
});
