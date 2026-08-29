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
 * 8. 自添加方案小数持有期 (1.5 年): " × 1.5年" 后缀正确剥离, model 不出现双重后缀
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

  it('自添加方案小数持有期 (1.5 年): " × 1.5年" 后缀正确剥离, model 不出现双重后缀', () => {
    const original = computeParetoFrontier(constants, baseParams);
    const originalEdited = toOriginalEditedPoints(original.frontier, original.dominated);

    // 端内多持有期表单勾选 1.5 年时生成的方案点
    const customPlan: EditedPlanPoint = {
      ...({
        model: 'M2_16G_256G_二手 × 1.5年',
        chip: 'M2',
        buyTiming: 'used',
        holdingYears: 1.5,
        monthlyCost: 0,
        avgPerformance: 0,
        buyPrice: 2600,
        residual: 0,
        maintenanceCost: 0,
        holdingMonths: 18,
        performanceS0: 0,
        performanceSN: 0,
        candidateType: 'A',
        memoryGb: 16,
        storageGb: 256,
      } as EditedPlanPoint),
      source: 'custom',
      channel: '闲鱼',
    };

    const recomputed = recomputeFrontierFromPoints(constants, baseParams, [
      ...originalEdited,
      customPlan,
    ]);

    const allPlans = [...recomputed.frontier, ...recomputed.dominated];
    const found = allPlans.find((p) => p.holdingYears === 1.5 && p.chip === 'M2');
    expect(found).toBeDefined();
    // 后缀剥离正确: model 不含双重 " × 1.5年" 尾巴
    expect(found!.model).toBe('M2_16G_256G_二手 × 1.5年');
    expect((found!.model.match(/×\s*[\d.]+年/g) || []).length).toBe(1);
    // 月均成本按 18 个月口径计算 (非 0 占位)
    expect(found!.monthlyCost).not.toBe(0);
    expect(found!.holdingMonths).toBe(18);
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
    // 注: P1 修复后 mac-mini 生成类型 B/C 候选, 类型 C 复用老款型号名,
    // model+holdingYears 不再唯一标识一个方案, 需加 candidateType 区分
    const allPlans = [...recomputed.frontier, ...recomputed.dominated];
    expect(allPlans.find((p) => p.model === first.model && p.holdingYears === first.holdingYears && p.candidateType === first.candidateType)).toBeUndefined();
    expect(allPlans.find((p) => p.model === second.model && p.holdingYears === second.holdingYears && p.candidateType === second.candidateType)).toBeUndefined();
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

describe('自添加方案显式 memoryGb/storageGb 字段 (Bug 2 修复)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  // 与端内复现脚本 scripts/debug/repro-manual-scheme-bugs.cjs 同款参数
  const params: DecisionParams = {
    category: 'mac-mini',
    budget: 10000,
    buyTiming: 'both',
    performanceFloor: 0.4,
    holdingYears: [3],
  };

  it('同配置自添加方案 (model 不含 GB 段 + 显式字段) 与快照方案性能一致', () => {
    const original = computeParetoFrontier(constants, params);
    const allOrig = [...original.frontier, ...original.dominated];
    const m4Orig = allOrig.find((p) => p.model.startsWith('M4_16G_256G_新品'));
    expect(m4Orig).toBeDefined();

    // 端内新增表单同款: 机型名不含 16G_256G 段, 显式填写 memoryGb/storageGb
    const customPoint = {
      ...m4Orig!,
      candidateType: undefined,
      model: 'M4 Mac mini_新品 × 3年',
      source: 'custom' as const,
      memoryGb: 16,
      storageGb: 256,
      buyPrice: m4Orig!.buyPrice,
      monthlyCost: 0,
      avgPerformance: 0,
      performanceS0: 0,
      performanceSN: 0,
      residual: 0,
      maintenanceCost: 0,
    };
    const originalEdited = allOrig.map((p) => ({ ...p, source: 'original' as const }));
    const recomputed = recomputeFrontierFromPoints(constants, params, [...originalEdited, customPoint]);
    const allRec = [...recomputed.frontier, ...recomputed.dominated];
    const customOut = allRec.find((p) => p.model === 'M4 Mac mini_新品 × 3年');
    expect(customOut).toBeDefined();

    // 性能满足度与快照同配置方案完全一致 (误差 ≤ 0.001) — Bug 2 核心
    expect(Math.abs(customOut!.avgPerformance - m4Orig!.avgPerformance)).toBeLessThanOrEqual(0.001);
    // 自添加方案按类型 A「现在买」参与计算
    expect(customOut!.candidateType).toBe('A');
    // 月均成本已被引擎按真实机龄重算 (非 bug 态的机龄 0 口径);
    // 与等待类 (B/C) 快照方案存在等待月数的时点折旧差 (约 1-2 元), 属买入时点语义差
    expect(Math.abs(customOut!.monthlyCost - m4Orig!.monthlyCost)).toBeLessThanOrEqual(2);
    expect(Math.abs(customOut!.monthlyCost - m4Orig!.monthlyCost)).toBeGreaterThan(0);
  });

  it('自添加方案月均成本与「现在买」(A) 语义一致: 显式字段与 model 回退两路径等价', () => {
    // 同一配置 (M4 16G/256G 新品 同价), 一条 model 为自由文本 + 显式字段,
    // 一条 model 含 GB 段走回退解析 — 两条路径应得到完全一致的结果
    // (证明 mem/storage 取值正确 + 机龄均按相同型号真实机龄对齐)
    const explicitPoint = {
      ...({
        model: 'M4 Mac mini_新品 × 3年',
        chip: 'M4',
        buyTiming: 'new',
        holdingYears: 3,
        monthlyCost: 0,
        avgPerformance: 0,
        buyPrice: 4388,
        residual: 0,
        maintenanceCost: 0,
        holdingMonths: 36,
        performanceS0: 0,
        performanceSN: 0,
      } as EditedPlanPoint),
      source: 'custom' as const,
      memoryGb: 16,
      storageGb: 256,
    };
    const fallbackPoint = {
      ...explicitPoint,
      model: 'M4_16G_256G_新品 × 3年',
      memoryGb: undefined,
      storageGb: undefined,
    };

    const r1 = recomputeFrontierFromPoints(constants, params, [explicitPoint]);
    const r2 = recomputeFrontierFromPoints(constants, params, [fallbackPoint]);
    const p1 = [...r1.frontier, ...r1.dominated][0];
    const p2 = [...r2.frontier, ...r2.dominated][0];
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();

    expect(Math.abs(p1!.avgPerformance - p2!.avgPerformance)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(p1!.monthlyCost - p2!.monthlyCost)).toBeLessThanOrEqual(0.5);
  });

  it('复制的自添加方案 (source="edited") 不被丢弃且与原自添加方案结果一致', () => {
    const original = computeParetoFrontier(constants, params);
    const allOrig = [...original.frontier, ...original.dominated];
    const m4Orig = allOrig.find((p) => p.model.startsWith('M4_16G_256G_新品'));
    expect(m4Orig).toBeDefined();

    const base = {
      candidateType: undefined,
      model: 'M4 Mac mini_新品 × 3年',
      chip: 'M4',
      memoryGb: 16,
      storageGb: 256,
      buyPrice: m4Orig!.buyPrice,
      monthlyCost: 0,
      avgPerformance: 0,
      performanceS0: 0,
      performanceSN: 0,
    };
    const customPoint = { ...base, ...m4Orig!, candidateType: undefined, source: 'custom' as const, model: 'M4 Mac mini_新品 × 3年', memoryGb: 16, storageGb: 256 };
    // 编辑器「复制」自添加方案后副本 source='edited', model 同样不含 GB 段
    const copiedPoint = { ...customPoint, source: 'edited' as const, editedBuyPrice: customPoint.buyPrice };

    const originalEdited = allOrig.map((p) => ({ ...p, source: 'original' as const }));
    const rCustom = recomputeFrontierFromPoints(constants, params, [...originalEdited, customPoint]);
    const rCopied = recomputeFrontierFromPoints(constants, params, [...originalEdited, copiedPoint]);
    const customOut = [...rCustom.frontier, ...rCustom.dominated].find((p) => p.model === 'M4 Mac mini_新品 × 3年');
    const copiedOut = [...rCopied.frontier, ...rCopied.dominated].find((p) => p.model === 'M4 Mac mini_新品 × 3年');

    // 副本不被丢弃 (修复前 model 自由文本导致 releaseDateKey 解析垃圾值 → 被静默丢弃)
    expect(copiedOut).toBeDefined();
    expect(customOut).toBeDefined();

    // 副本与原自添加方案性能/月均成本完全一致
    expect(Math.abs(copiedOut!.avgPerformance - customOut!.avgPerformance)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(copiedOut!.monthlyCost - customOut!.monthlyCost)).toBeLessThanOrEqual(0.5);
  });

  it('显式字段缺失时从 model (M2_16G_256G_二手) 回退解析, 行为与既有版本一致', () => {
    const fallbackPoint = {
      ...({
        model: 'M2_16G_256G_二手 × 3年',
        chip: 'M2',
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
      source: 'custom' as const,
    };
    // 显式字段版本: 与回退解析应得到相同配置 (16G/256G)
    const explicitPoint = { ...fallbackPoint, memoryGb: 16, storageGb: 256 };

    const r1 = recomputeFrontierFromPoints(constants, params, [fallbackPoint]);
    const r2 = recomputeFrontierFromPoints(constants, params, [explicitPoint]);
    const p1 = [...r1.frontier, ...r1.dominated][0];
    const p2 = [...r2.frontier, ...r2.dominated][0];
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();

    // 回退解析 (model 含 16G_256G 段) 与显式 16G/256G 完全一致
    expect(Math.abs(p1!.avgPerformance - p2!.avgPerformance)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(p1!.monthlyCost - p2!.monthlyCost)).toBeLessThanOrEqual(0.5);
  });
});

describe('自添加方案品类取 params.category + 芯片前缀双写法 (残留修复 D2c/D2d)', () => {
  let constants: Constants;
  beforeAll(() => {
    constants = loadConstants(constantsJson);
  });

  const mbpParams: DecisionParams = {
    category: 'macbook-pro',
    budget: 30000,
    buyTiming: 'used',
    performanceFloor: 0.3,
    holdingYears: [3],
  };

  it('macbook pro 品类 M3_Pro 自添加方案与同配置快照方案一致 (按 MacBook_Pro 品类查表)', () => {
    const original = computeParetoFrontier(constants, mbpParams);
    const allOrig = [...original.frontier, ...original.dominated];
    const m3Orig = allOrig.find(
      (p) => p.model.startsWith('M3Pro_14寸_16G_512G_二手') && p.candidateType === 'A',
    );
    expect(m3Orig).toBeDefined();

    // 端内新增表单同款: model 自由文本 + 芯片下拉规范化写法 M3_Pro + 显式字段
    const customPoint = {
      ...m3Orig!,
      candidateType: undefined,
      waitMonths: undefined,
      predictedPrice: undefined,
      model: 'M3 Pro MacBook Pro_二手 × 3年',
      chip: 'M3_Pro',
      source: 'custom' as const,
      memoryGb: 16,
      storageGb: 512,
      buyPrice: m3Orig!.buyPrice,
      monthlyCost: 0,
      avgPerformance: 0,
      performanceS0: 0,
      performanceSN: 0,
      residual: 0,
      maintenanceCost: 0,
    };
    const originalEdited = allOrig.map((p) => ({ ...p, source: 'original' as const }));
    const recomputed = recomputeFrontierFromPoints(constants, mbpParams, [...originalEdited, customPoint]);
    const allRec = [...recomputed.frontier, ...recomputed.dominated];
    const customOut = allRec.find((p) => p.model === 'M3 Pro MacBook Pro_二手 × 3年');
    expect(customOut).toBeDefined();

    // 性能满足度与同配置快照方案一致 — 旗舰基准分母按 MacBook_Pro (M5 Pro) 查表,
    // 修复前按芯片前缀误判 Mac_mini 导致性能虚高约 2.5×
    expect(Math.abs(customOut!.avgPerformance - m3Orig!.avgPerformance)).toBeLessThanOrEqual(0.001);
    expect(customOut!.candidateType).toBe('A');
    // 机龄按 MacBook Pro M3Pro 发布月 (2023-11, 14寸 key 经跨尺寸兜底命中 16寸条目)
    // 计算 → 月均成本与「现在买」(A) 同价语义一致 (修复前芯片前缀 M3_Pro_ 匹配不到
    // 紧凑写法快照 key M3Pro_14寸_..., 机龄错按 0 兜底)
    expect(Math.abs(customOut!.monthlyCost - m3Orig!.monthlyCost)).toBeLessThanOrEqual(0.5);
  });

  it('iphone 父品类自添加方案 (A18) 不被丢弃, 保值率查表键可命中', () => {
    const iphoneParams: DecisionParams = {
      category: 'iphone',
      budget: 20000,
      buyTiming: 'both',
      performanceFloor: 0.3,
      holdingYears: [2],
    };
    // 父品类 'iphone' 解析不到同名快照键 → 回退芯片前缀品类 (iPhone_Pro),
    // 保值率曲线 iPhone_Pro 可命中, 方案不被静默丢弃
    const customPoint = {
      ...({
        model: 'iPhone 18_二手 × 2年',
        chip: 'A18',
        buyTiming: 'used',
        holdingYears: 2,
        monthlyCost: 0,
        avgPerformance: 0,
        buyPrice: 5000,
        residual: 0,
        maintenanceCost: 0,
        holdingMonths: 24,
        performanceS0: 0,
        performanceSN: 0,
      } as EditedPlanPoint),
      source: 'custom' as const,
      memoryGb: 8,
      storageGb: 256,
    };

    const recomputed = recomputeFrontierFromPoints(constants, iphoneParams, [customPoint]);
    const allRec = [...recomputed.frontier, ...recomputed.dominated];
    const customOut = allRec.find((p) => p.model === 'iPhone 18_二手 × 2年');
    expect(customOut).toBeDefined();
    expect(customOut!.avgPerformance).toBeGreaterThan(0);
    expect(customOut!.monthlyCost).not.toBe(0);
    // 保值率查表成功 (残值 = 保值率 × 同品类新品价 > 0, 若查表失败会抛错/被丢弃)
    expect(customOut!.residual).toBeGreaterThan(0);
  });

  it('复制副本 (source="edited") 与原自添加方案在 macbook pro 品类下结果一致', () => {
    const original = computeParetoFrontier(constants, mbpParams);
    const allOrig = [...original.frontier, ...original.dominated];
    const m3Orig = allOrig.find(
      (p) => p.model.startsWith('M3Pro_14寸_16G_512G_二手') && p.candidateType === 'A',
    );
    expect(m3Orig).toBeDefined();

    const base = {
      ...m3Orig!,
      candidateType: undefined,
      waitMonths: undefined,
      predictedPrice: undefined,
      model: 'M3 Pro MacBook Pro_二手 × 3年',
      chip: 'M3_Pro',
      memoryGb: 16,
      storageGb: 512,
      buyPrice: m3Orig!.buyPrice,
      monthlyCost: 0,
      avgPerformance: 0,
      performanceS0: 0,
      performanceSN: 0,
    };
    const customPoint = { ...base, source: 'custom' as const };
    // 编辑器「复制」自添加方案后副本 source='edited', model 同为自由文本
    const copiedPoint = { ...base, source: 'edited' as const, editedBuyPrice: base.buyPrice };

    const originalEdited = allOrig.map((p) => ({ ...p, source: 'original' as const }));
    const rCustom = recomputeFrontierFromPoints(constants, mbpParams, [...originalEdited, customPoint]);
    const rCopied = recomputeFrontierFromPoints(constants, mbpParams, [...originalEdited, copiedPoint]);
    const customOut = [...rCustom.frontier, ...rCustom.dominated].find(
      (p) => p.model === 'M3 Pro MacBook Pro_二手 × 3年',
    );
    const copiedOut = [...rCopied.frontier, ...rCopied.dominated].find(
      (p) => p.model === 'M3 Pro MacBook Pro_二手 × 3年',
    );

    // 副本不被丢弃, 且与原自添加方案性能/月均成本完全一致
    expect(customOut).toBeDefined();
    expect(copiedOut).toBeDefined();
    expect(Math.abs(copiedOut!.avgPerformance - customOut!.avgPerformance)).toBeLessThanOrEqual(0.001);
    expect(Math.abs(copiedOut!.monthlyCost - customOut!.monthlyCost)).toBeLessThanOrEqual(0.5);
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
