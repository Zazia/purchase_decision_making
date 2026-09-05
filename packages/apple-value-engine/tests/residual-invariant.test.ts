/**
 * v4.3 残值买入价锚定 — 回归测试
 *
 * 覆盖 delta spec「月均成本计算」的四个场景:
 *   1. 全量不变量: 所有品类 × 持有期 × buyTiming 的方案点 residual ≤ buyPrice 且 monthlyCost ≥ 0
 *   2. 比率封顶安全网: 非单调曲线 / 极老机型两端触底时, 残值 = 买入价 (不超)
 *   3. 类型 C 复现用例: iPhone 15 Pro 128G 二手 × 1年 (等待 2 月), 残值按 R(49)/R(37) 锚定
 *   4. 类型 B 等价性: 新公式下类型 B 残值 = 买入价 × R(持有月数)/100 (与旧公式一致)
 *
 * fixtures: 仓库内 constants.json 真实数据 (与 consistency.test.ts 同源)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConstants,
  computeParetoFrontier,
  computeMonthlyCost,
  computeMonthlyCostForWaitCandidate,
  getRetentionRate,
} from '../src/index.js';
import type { Constants } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

// ============================================================================
// 1. 全量不变量: residual ≤ buyPrice 且 monthlyCost ≥ 0
// ============================================================================

describe('残值不超过买入价 (全量不变量, v4.3)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('全部品类 × 持有期 {1,1.5,2,3,4,5} × buyTiming {new,used,both} 的所有方案点满足不变量', () => {
    const categoryKeys = Object.keys(constants.marketSnapshots).filter((k) => !k.startsWith('_'));
    expect(categoryKeys.length).toBeGreaterThan(0);

    const holdingYears = [1, 1.5, 2, 3, 4, 5];
    const timings = ['new', 'used', 'both'] as const;
    let checked = 0;

    for (const category of categoryKeys) {
      for (const buyTiming of timings) {
        const result = computeParetoFrontier(constants, {
          category,
          budget: 999999,
          holdingYears,
          buyTiming,
          performanceFloor: 0,
        });
        for (const p of [...result.frontier, ...result.dominated]) {
          expect(
            p.residual,
            `${p.model} (type ${p.candidateType}) residual ${p.residual} > buyPrice ${p.buyPrice}`,
          ).toBeLessThanOrEqual(p.buyPrice + 1e-9);
          expect(
            p.monthlyCost,
            `${p.model} (type ${p.candidateType}) monthlyCost ${p.monthlyCost} < 0`,
          ).toBeGreaterThanOrEqual(-1e-9);
          checked++;
        }
      }
    }
    // 防御: 确认扫描确实覆盖了大量方案点 (而非空跑)
    expect(checked).toBeGreaterThan(100);
  });

  it('复现用例 iPhone 15 Pro 128G 二手 1 年不再出现残值 > 买入价', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iphone',
      budget: 999999,
      holdingYears: [1],
      buyTiming: 'both',
      performanceFloor: 0,
    });
    const all = [...result.frontier, ...result.dominated];
    const bad = all.filter((p) => p.residual > p.buyPrice + 1e-9);
    expect(bad).toEqual([]);
  });
});

// ============================================================================
// 2. 比率封顶安全网
// ============================================================================

describe('比率封顶安全网 (v4.3)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('非单调曲线: R(卖出) > R(买入) 时比率封顶 1, 残值 = 买入价', () => {
    // 构造非单调 Mac_mini 曲线: 12月=50 → 24月=60 (回升)
    const raw = JSON.parse(constantsJson) as Record<string, unknown>;
    const curves = raw['保值率曲线'] as Record<string, unknown>;
    const original = curves['Mac_mini'];
    curves['Mac_mini'] = { 0: 100, 12: 50, 24: 60, 36: 40 };
    const modified = loadConstants(JSON.stringify(raw));
    // 恢复, 避免影响其他用例 (beforeAll 每 describe 重新 load, 这里双保险)
    curves['Mac_mini'] = original;

    // 买入机龄 12 (R=50), 持有 12 → 卖出机龄 24 (R=60), 未封顶比率 = 60/50 = 1.2
    const cost = computeMonthlyCost(modified, 'Mac_mini', 2000, 12, 12, 5999);
    expect(cost.retentionRate).toBe(60);
    expect(cost.buyRetentionRate).toBe(50);
    expect(cost.residual).toBe(2000); // 封顶后残值 = 买入价
    expect(cost.monthlyCost).toBeGreaterThanOrEqual(0);
  });

  it('极老机型两端同触保底 3%: 比率 = 1, 残值 = 买入价', () => {
    const raw = JSON.parse(constantsJson) as Record<string, unknown>;
    const curves = raw['保值率曲线'] as Record<string, unknown>;
    const original = curves['Mac_mini'];
    curves['Mac_mini'] = { 0: 100, 6: 3, _floor: 3, _half_life_months: 24 };
    const modified = loadConstants(JSON.stringify(raw));
    curves['Mac_mini'] = original;

    // 买入机龄 200 / 卖出机龄 212, 指数外推后两端均为 floor=3
    const cost = computeMonthlyCost(modified, 'Mac_mini', 1500, 200, 12, 5999);
    expect(cost.retentionRate).toBe(3);
    expect(cost.buyRetentionRate).toBe(3);
    expect(cost.residual).toBe(1500);
    expect(cost.monthlyCost).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// 3. 类型 C 复现用例回归 (delta spec 场景「类型 C 残值随冲击折扣买入价同比例下调」)
// ============================================================================

describe('类型 C 残值锚定 (v4.3 复现用例)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('iPhone 15 Pro 128G 二手 × 1年 (等待 2 月): 残值 = 买入价 × R(49)/R(37) < 买入价', () => {
    const result = computeParetoFrontier(constants, {
      category: 'iphone',
      budget: 999999,
      holdingYears: [1],
      buyTiming: 'used',
      performanceFloor: 0,
    });
    const all = [...result.frontier, ...result.dominated];
    const point = all.find(
      (p) => p.model === 'iPhone_15_Pro_128G_二手 × 1年' && p.candidateType === 'C',
    );
    expect(point).toBeDefined();
    expect(point!.waitMonths).toBe(2);

    // 当前机龄 35 + 等待 2 = 买入机龄 37; 卖出机龄 = 37 + 12 = 49
    const r49 = getRetentionRate(constants.retentionCurves, 'iPhone_Pro', 49);
    const r37 = getRetentionRate(constants.retentionCurves, 'iPhone_Pro', 37);
    const expected = point!.buyPrice * Math.min(1, r49 / r37);
    expect(point!.residual).toBeCloseTo(expected, 6);
    expect(point!.residual).toBeLessThan(point!.buyPrice);
    expect(point!.monthlyCost).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// 4. 类型 B 等价性 (design D5)
// ============================================================================

describe('类型 B 残值行为不变 (v4.3 等价性)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('sellAgeMonths = holdingMonths (买入机龄 0) 时, 残值 = 买入价 × R(持有月数)/100, 与旧公式一致', () => {
    const buyPrice = 8999;
    const holdingMonths = 24;
    // 旧公式: residual = R(h)/100 × currentNewPrice, 类型 B 调用方传 currentNewPrice = buyPrice
    const cost = computeMonthlyCostForWaitCandidate(
      constants, 'iPhone_Pro', buyPrice, holdingMonths, buyPrice, holdingMonths,
    );
    const r24 = getRetentionRate(constants.retentionCurves, 'iPhone_Pro', holdingMonths);
    expect(cost.buyRetentionRate).toBe(100); // R(0) = 100
    expect(cost.residual).toBeCloseTo(buyPrice * r24 / 100, 6);
    expect(cost.residual).toBeLessThan(buyPrice);
  });

  it('类型 B 前沿点残值与公式一致 (真实数据抽验)', () => {
    // 用快照直达的品类键 (父品类 'iphone' 解析为 'Iphone' 后无法定价下一代新品, 不生成 B 候选)
    const result = computeParetoFrontier(constants, {
      category: 'iPhone_Pro',
      budget: 999999,
      holdingYears: [2],
      buyTiming: 'new',
      performanceFloor: 0,
    });
    const all = [...result.frontier, ...result.dominated];
    const point = all.find((p) => p.candidateType === 'B');
    expect(point).toBeDefined();
    const rN = getRetentionRate(constants.retentionCurves, 'iPhone_Pro', point!.holdingMonths);
    expect(point!.residual).toBeCloseTo(point!.buyPrice * rN / 100, 4);
  });
});
