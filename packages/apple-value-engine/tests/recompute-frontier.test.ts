/**
 * recomputeFrontierFromPoints 单测
 *
 * 覆盖 spec 场景:
 * 1. 改价重算: source='edited' 用 editedBuyPrice 重算月均成本, 性能满足度不变
 * 2. 新增可解析方案: source='custom' 参与前沿筛选
 * 3. 新增不可解析方案被拒: 芯片无法匹配 → 不参与重算
 * 4. 排除/暂不考虑不参与重算
 * 5. 未改价重算与 computeParetoFrontier 结果一致 (误差 ≤ 0.5 元 / ≤ 0.001)
 * 6. 推荐区间仅按预算截取 (性能地板不参与过滤)
 * 7. buildPlanPointFromInputs 芯片无法解析时抛 ConstantsValidationError
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConstants,
  computeParetoFrontier,
  recomputeFrontierFromPoints,
  buildPlanPointFromInputs,
  ConstantsValidationError,
} from '../src/index.js';
import type { Constants, DecisionParams, EditedPlanPoint, ParetoFrontierResult } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = join(__dirname, '../../../.agents/skills/apple-value-analysis/constants.json');
const constantsJson = readFileSync(CONSTANTS_PATH, 'utf-8');

/** 把 PlanPoint[] 转为 source='original' 的 EditedPlanPoint[] */
function toOriginalEditedPoints(frontier: ParetoFrontierResult['frontier'], dominated: ParetoFrontierResult['dominated']): EditedPlanPoint[] {
  return [...frontier, ...dominated].map((p) => ({ ...p, source: 'original' as const }));
}

describe('recomputeFrontierFromPoints', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  const baseParams: DecisionParams = {
    category: 'mac-mini',
    budget: 10000,
    holdingYears: [2, 3, 4],
    buyTiming: 'used',
    performanceFloor: 0.3,
  };

  it('未改价重算与 computeParetoFrontier 结果一致 (误差 ≤ 0.5 元 / ≤ 0.001)', () => {
    const original = computeParetoFrontier(constants, baseParams);
    const edited = toOriginalEditedPoints(original.frontier, original.dominated);
    const recomputed = recomputeFrontierFromPoints(constants, baseParams, edited);

    // 前沿数量一致
    expect(recomputed.frontier.length).toBe(original.frontier.length);
    expect(recomputed.dominated.length).toBe(original.dominated.length);

    // 逐点比对月均成本与性能满足度
    const sortKey = (p: { model: string; holdingYears: number }) => `${p.model}|${p.holdingYears}`;
    const origMap = new Map(original.frontier.map((p) => [sortKey(p), p]));
    for (const p of recomputed.frontier) {
      const o = origMap.get(sortKey(p));
      expect(o).toBeDefined();
      expect(Math.abs(p.monthlyCost - o!.monthlyCost)).toBeLessThan(0.5);
      expect(Math.abs(p.avgPerformance - o!.avgPerformance)).toBeLessThan(0.001);
    }
  });

  it('改价重算: source="edited" 用 editedBuyPrice 重算月均成本, 性能满足度不变', () => {
    const original = computeParetoFrontier(constants, baseParams);
    expect(original.frontier.length).toBeGreaterThan(0);

    // 取第一个前沿方案, 改买入价
    const target = original.frontier[0];
    const originalBuyPrice = target.buyPrice;
    const editedBuyPrice = Math.round(originalBuyPrice * 0.9); // 打 9 折
    const edited: EditedPlanPoint = {
      ...target,
      source: 'edited',
      editedBuyPrice,
    };
    // 其余方案保持 original
    const rest = original.frontier.slice(1).concat(original.dominated).map((p) => ({ ...p, source: 'original' as const }));
    const recomputed = recomputeFrontierFromPoints(constants, baseParams, [edited, ...rest]);

    // 找到改价方案的重算结果 (按 model + holdingYears 匹配)
    const recomputedTarget = recomputed.frontier.find(
      (p) => p.model === target.model && p.holdingYears === target.holdingYears,
    ) ?? recomputed.dominated.find(
      (p) => p.model === target.model && p.holdingYears === target.holdingYears,
    );
    expect(recomputedTarget).toBeDefined();

    // 性能满足度不变
    expect(Math.abs(recomputedTarget!.avgPerformance - target.avgPerformance)).toBeLessThan(0.001);

    // 月均成本基于新买入价重算 (与新买入价的差值方向一致)
    // 月均成本 = (buyPrice - residual + maintenance) / holdingMonths
    // 改价后 buyPrice 变小, monthlyCost 也应变小 (因 residual/maintenance 不变)
    expect(recomputedTarget!.monthlyCost).toBeLessThan(target.monthlyCost);
    expect(recomputedTarget!.buyPrice).toBe(editedBuyPrice);
  });

  it('新增可解析方案参与前沿: source="custom" 用 buildPlanPointFromInputs 构建', () => {
    const original = computeParetoFrontier(constants, baseParams);
    const originalEdited = toOriginalEditedPoints(original.frontier, original.dominated);

    // 新增一个 M2 16G 256G Mac mini 二手方案
    const customPlan: EditedPlanPoint = {
      ...({
        model: 'M2_16G_256G_二手 × 3年',
        chip: 'M2',
        buyTiming: 'used',
        holdingYears: 3,
        monthlyCost: 0, // 占位, 重算会覆盖
        avgPerformance: 0,
        buyPrice: 2600,
        residual: 0,
        maintenanceCost: 0,
        holdingMonths: 36,
        performanceS0: 0,
        performanceSN: 0,
        candidateType: 'A',
      } as EditedPlanPoint),
      source: 'custom',
      channel: '闲鱼',
    };

    const recomputed = recomputeFrontierFromPoints(constants, baseParams, [
      ...originalEdited,
      customPlan,
    ]);

    // 自定义方案出现在 frontier 或 dominated
    const allPlans = [...recomputed.frontier, ...recomputed.dominated];
    const found = allPlans.find(
      (p) => p.model.startsWith('M2_16G_256G_二手') && p.holdingYears === 3,
    );
    expect(found).toBeDefined();
    // 月均成本与性能满足度已被引擎重算 (非 0 占位值)
    // 注: 买入价极低时月均成本可能为负 (残值 > 买入价 + 维修), 这是引擎公式正确行为
    expect(found!.monthlyCost).not.toBe(0);
    expect(found!.avgPerformance).toBeGreaterThan(0);
    // 买入价已被引擎写入
    expect(found!.buyPrice).toBe(2600);
  });

  it('新增不可解析方案被拒: 芯片无法匹配 → 不参与重算', () => {
    const original = computeParetoFrontier(constants, baseParams);
    const originalEdited = toOriginalEditedPoints(original.frontier, original.dominated);

    const invalidCustom: EditedPlanPoint = {
      ...({
        model: 'FakeChip_16G_256G_二手 × 3年',
        chip: 'FakeChip_XYZ',
        buyTiming: 'used',
        holdingYears: 3,
        monthlyCost: 0,
        avgPerformance: 0,
        buyPrice: 2600,
        residual: 0,
        maintenanceCost: 0,
        holdingMonths: 36,
        performanceS0: 0,
        performanceSN: 0,
        candidateType: 'A',
      } as EditedPlanPoint),
      source: 'custom',
    };

    const recomputed = recomputeFrontierFromPoints(constants, baseParams, [
      ...originalEdited,
      invalidCustom,
    ]);

    // 不可解析方案不出现在结果中
    const allPlans = [...recomputed.frontier, ...recomputed.dominated];
    const found = allPlans.find((p) => p.chip === 'FakeChip_XYZ');
    expect(found).toBeUndefined();

    // 结果与原始计算一致 (无效方案被静默丢弃)
    expect(recomputed.frontier.length).toBe(original.frontier.length);
  });

  it('排除/暂不考虑方案不参与重算', () => {
    const original = computeParetoFrontier(constants, baseParams);
    expect(original.frontier.length).toBeGreaterThanOrEqual(2);

    // 把第一个前沿方案排除, 第二个移入暂不考虑
    const [first, ...restFrontier] = original.frontier;
    const [second, ...restRest] = restFrontier;
    const edited: EditedPlanPoint[] = [
      { ...first, source: 'original', excluded: true },
      { ...second, source: 'original', deferred: true },
      ...restRest.map((p) => ({ ...p, source: 'original' as const })),
      ...original.dominated.map((p) => ({ ...p, source: 'original' as const })),
    ];

    const recomputed = recomputeFrontierFromPoints(constants, baseParams, edited);

    // 排除/暂不考虑方案不出现在 frontier 与 dominated
    const allPlans = [...recomputed.frontier, ...recomputed.dominated];
    expect(allPlans.find((p) => p.model === first.model && p.holdingYears === first.holdingYears)).toBeUndefined();
    expect(allPlans.find((p) => p.model === second.model && p.holdingYears === second.holdingYears)).toBeUndefined();
  });

  it('推荐区间仅按预算截取: 买入价 > 预算 的方案不进入推荐区间', () => {
    const original = computeParetoFrontier(constants, baseParams);
    const edited = toOriginalEditedPoints(original.frontier, original.dominated);

    // 用极小预算重算
    const tightParams: DecisionParams = { ...baseParams, budget: 2000 };
    const recomputed = recomputeFrontierFromPoints(constants, tightParams, edited);

    for (const p of recomputed.recommendationRange.plans) {
      expect(p.buyPrice).toBeLessThanOrEqual(2000);
    }
  });

  it('全部方案被排除时返回空前沿', () => {
    const original = computeParetoFrontier(constants, baseParams);
    const edited: EditedPlanPoint[] = [
      ...original.frontier,
      ...original.dominated,
    ].map((p) => ({ ...p, source: 'original' as const, excluded: true }));

    const recomputed = recomputeFrontierFromPoints(constants, baseParams, edited);
    expect(recomputed.frontier.length).toBe(0);
    expect(recomputed.dominated.length).toBe(0);
    expect(recomputed.recommendationRange.plans.length).toBe(0);
  });
});

describe('buildPlanPointFromInputs', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  it('可解析芯片 (M2) 返回有效 PlanPoint', () => {
    const point = buildPlanPointFromInputs(constants, {
      model: 'M2_16G_256G_二手',
      chip: 'M2',
      memoryGb: 16,
      storageGb: 256,
      categoryKey: 'Mac_mini',
      buyTiming: 'used',
      buyPrice: 2600,
      holdingYears: 3,
    });
    expect(point).not.toBeNull();
    expect(point!.chip).toBe('M2');
    expect(point!.buyPrice).toBe(2600);
    expect(point!.holdingYears).toBe(3);
    // 月均成本可能为负 (买入价低于残值时), 这里只验证已被引擎计算 (非 0)
    expect(point!.monthlyCost).not.toBe(0);
    expect(point!.avgPerformance).toBeGreaterThan(0);
  });

  it('规范化芯片名 (M1Pro → M1_Pro) 也能解析', () => {
    const point = buildPlanPointFromInputs(constants, {
      model: 'M1Pro_16G_512G_二手',
      chip: 'M1Pro',
      memoryGb: 16,
      storageGb: 512,
      categoryKey: 'Mac_mini',
      buyTiming: 'used',
      buyPrice: 3000,
      holdingYears: 2,
    });
    expect(point).not.toBeNull();
    expect(point!.chip).toBe('M1_Pro');
  });

  it('不可解析芯片抛 ConstantsValidationError', () => {
    expect(() =>
      buildPlanPointFromInputs(constants, {
        model: 'FakeChip_16G_256G_二手',
        chip: 'FakeChip_XYZ',
        memoryGb: 16,
        storageGb: 256,
        categoryKey: 'Mac_mini',
        buyTiming: 'used',
        buyPrice: 2600,
        holdingYears: 3,
      }),
    ).toThrow(ConstantsValidationError);
  });
});
