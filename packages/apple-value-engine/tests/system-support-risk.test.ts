/**
 * v3.8 测试: 系统支持期风险标注
 *
 * 验证 PlanPoint.systemSupportRisk 字段:
 * - macOS 72 月 / iOS 60 月
 * - normal: 卖出时机龄 < threshold - 12
 * - near-end: 卖出时机龄 ∈ [threshold - 12, threshold)
 * - exceeded: 卖出时机龄 ≥ threshold
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConstants, computeParetoFrontier } from '../src/index.js';
import type { Constants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

describe('system-support-risk', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('Mac_mini 短持有期 (2年) → 多数方案未超出支持期', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    // Mac_mini 二手候选机龄较大, 2年持有后部分可能进入 near-end
    // 但不应全部 exceeded (2年远小于 macOS 72 月支持期)
    const notExceeded = allPoints.filter((p) => p.systemSupportRisk !== 'exceeded');
    expect(notExceeded.length).toBeGreaterThan(0);
  });

  it('Mac_mini 长持有期 (5年=60月) → 部分方案 near-end 或 exceeded', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [5],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    // Mac_mini M2 发布 2023-01, 机龄 ~43 月
    // 持有 60 月 → 卖出 ~103 月 ≥ 72 → exceeded
    // M4 发布 2024-10, 机龄 ~22 月, 持有 60 → 卖出 ~82 月 ≥ 72 → exceeded
    // 所有点都应至少是 near-end 或 exceeded
    const riskPoints = allPoints.filter(
      (p) => p.systemSupportRisk === 'near-end' || p.systemSupportRisk === 'exceeded',
    );
    expect(riskPoints.length).toBeGreaterThan(0);
  });

  it('exceeded 时 systemSupportExceedMonths > 0', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [5],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const exceeded = allPoints.filter((p) => p.systemSupportRisk === 'exceeded');
    for (const p of exceeded) {
      expect(p.systemSupportExceedMonths).toBeGreaterThan(0);
    }
  });

  it('iPhone (iOS 60月) 比 Mac (macOS 72月) 更早进入 exceeded', () => {
    // 同样持有 4 年 (48 月), iPhone 更可能 exceeded
    const macResult = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [4],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const iphoneResult = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 100000,
      holdingYears: [4],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const macAll = [...macResult.frontier, ...macResult.dominated];
    const iphoneAll = [...iphoneResult.frontier, ...iphoneResult.dominated];
    const macExceeded = macAll.filter((p) => p.systemSupportRisk === 'exceeded').length;
    const iphoneExceeded = iphoneAll.filter((p) => p.systemSupportRisk === 'exceeded').length;
    // iPhone 阈值更低 (60 vs 72), exceeded 数量应 ≥ Mac
    expect(iphoneExceeded).toBeGreaterThanOrEqual(macExceeded);
  });

  it('normal 时 systemSupportExceedMonths 为 undefined', () => {
    const result = computeParetoFrontier(constants, {
      category: 'mac-mini',
      budget: 100000,
      holdingYears: [2],
      buyTiming: 'used',
      performanceFloor: 0,
      considerWait: false,
    });
    const allPoints = [...result.frontier, ...result.dominated];
    const normal = allPoints.filter((p) => p.systemSupportRisk === 'normal');
    for (const p of normal) {
      expect(p.systemSupportExceedMonths).toBeUndefined();
    }
  });
});
