// pages/report/report.ts
// 端内完整报告页: 按 design.md D9 结构组装报告 (HTML 报告的端内简化版)
// 从 app.globalData.reportData 读取引擎结果 + 决策参数, 从 engine-bridge 读取常量元信息与宏观状态

import { getConstants, getDataFreshness, getMacroContext } from '../../engine-bridge/index';
import { getSavedResult, sortPreferredPlans, type SavedResult } from '../../services/saved-results';

/** 与 PlanPoint 对齐的方案点(含 v3.8 候选类型字段) */
interface PlanPoint {
  model: string;
  chip: string;
  buyTiming: 'new' | 'used';
  holdingYears: number;
  monthlyCost: number;
  avgPerformance: number;
  buyPrice: number;
  residual: number;
  maintenanceCost: number;
  holdingMonths: number;
  performanceS0: number;
  performanceSN: number;
  candidateType?: 'A' | 'B' | 'C';
  waitMonths?: number;
  predictedPrice?: boolean;
  systemSupportRisk?: 'normal' | 'near-end' | 'exceeded';
  systemSupportExceedMonths?: number;
}

interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used' | 'both';
  performanceFloor: number;
  holdingYears: number[];
}

interface RecommendationRange {
  lowerCost: number;
  upperCost: number;
  plans: PlanPoint[];
}

interface ReportData {
  params: DecisionParams;
  frontier: PlanPoint[];
  dominated: PlanPoint[];
  recommendationRange: RecommendationRange | null;
  performanceFloor: number;
  budget: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  'mac-mini': 'Mac mini',
  'macbook-air': 'MacBook Air',
  'macbook-pro': 'MacBook Pro',
  'iphone': 'iPhone',
  'ipad': 'iPad',
  'imac': 'iMac',
};

const ALL_CANDIDATE_LIMIT = 20;

/** 推荐表行 */
interface RecommendRow {
  planLabel: string;
  config: string;
  buyPrice: number;
  holdingMonths: number;
  monthlyCost: number;
  performancePct: number;
  reason: string;
  candidateBadge: string;
  predictedPrice: boolean;
}

/** 全候选表行 */
interface CandidateRow {
  model: string;
  holdingMonths: number;
  buyPrice: number;
  s0Pct: number;
  avgSPct: number;
  residual: number;
  monthlyCost: number;
  paretoStatus: string; // '前沿' | '被支配'
  paretoLevel: 'frontier' | 'dominated';
  supportLabel: string; // '' | '接近尾声' | '超N月'
  supportLevel: '' | 'near-end' | 'exceeded';
  candidateBadge: string;
  predictedPrice: boolean;
}

interface AlertItem {
  level: 'warning' | 'info' | 'error';
  title: string;
  desc: string;
}

interface MacroItem {
  level: 'warning' | 'info' | 'error';
  title: string;
  desc: string;
}

interface ConfidenceRow {
  item: string;
  level: string; // '高' | '中' | '中-低'
  levelClass: 'success' | 'warning' | 'error';
  desc: string;
}

interface KpiCard {
  label: string;
  value: string;
  unit: string;
}

Page({
  data: {
    loading: true,
    error: '' as string,
    // 报告头部
    headerTitle: '',
    headerMeta: '',
    // 结论卡
    conclusionVerdict: '',
    conclusionDetail: '',
    // KPI 行 (4 卡)
    kpiCards: [] as KpiCard[],
    // 预警 alert
    alerts: [] as AlertItem[],
    // 推荐方案表
    recommendRows: [] as RecommendRow[],
    // 全候选方案表
    allCandidateRows: [] as CandidateRow[],
    allCandidateTotal: 0,
    allCandidateShown: 0,
    allCandidatesExpanded: false,
    // 帕累托图
    frontier: [] as PlanPoint[],
    dominated: [] as PlanPoint[],
    recommendationRange: null as RecommendationRange | null,
    performanceFloor: 0,
    budget: 0,
    // 宏观因素
    macroFactors: [] as MacroItem[],
    macroExpanded: false,
    // 数据置信度表
    confidenceRows: [] as ConfidenceRow[],
    // 更新提示
    updateHints: [] as string[],
    // 元信息
    lastUpdated: '',
    sopVersion: '',
    // 回看模式
    isReplay: false,
    replayLastUpdated: '',
  },

  onLoad(query: Record<string, string>) {
    // 回看模式: 从缓存读取已保存的结果
    if (query.savedId) {
      this.enterReplayMode(query.savedId);
      return;
    }
    this.loadReport();
  },

  /** 回看模式: 从缓存读取已保存的结果, 用 reportData 渲染, 跳过 loadReport */
  enterReplayMode(savedId: string) {
    const saved = getSavedResult(savedId);
    if (!saved) {
      wx.showModal({
        title: '结果不存在',
        content: '该保存结果可能已被删除，请返回列表查看其他结果',
        showCancel: false,
        confirmText: '返回',
        success: () => wx.navigateBack(),
      });
      return;
    }

    // 将缓存的 reportData 写入 globalData, 复用 loadReport 渲染逻辑
    const app = getApp();
    if (app.globalData) {
      app.globalData.reportData = saved.reportData as unknown as Record<string, unknown>;
    }

    // 标记回看模式, 使用保存时的数据日期
    this.setData({ isReplay: true, replayLastUpdated: saved.lastUpdated });
    this.loadReport();
  },

  /** 加载并组装报告数据 */
  async loadReport() {
    const app = getApp();
    const reportData = app.globalData?.reportData as unknown as ReportData | null;

    if (!reportData || !reportData.params) {
      this.setData({ loading: false, error: '报告数据缺失，请从结果页重新进入' });
      return;
    }

    try {
      const [constants, freshness, macroContext] = await Promise.all([
        getConstants(),
        getDataFreshness(),
        getMacroContext(),
      ]);

      const params = reportData.params;
      const frontier = reportData.frontier || [];
      const dominated = reportData.dominated || [];
      const recRange = reportData.recommendationRange;

      const categoryLabel = CATEGORY_LABELS[params.category] || params.category;
      const analysisDate = macroContext.analysisMonth + '-01';

      // ===== 报告头部 =====
      const headerTitle = `${categoryLabel} 购买决策分析报告`;
      const headerMeta = `分析日期: ${analysisDate} | 预算: ${params.budget}元 | 品类: ${categoryLabel} | SOP v${constants.version || '3.8'}`;

      // ===== 结论卡 =====
      const conclusion = this.buildConclusion(params, frontier, recRange, categoryLabel);

      // ===== KPI 行 =====
      const kpiCards = this.buildKpiCards(params, frontier, recRange, constants, categoryLabel);

      // ===== 预警 alert =====
      const alerts = this.buildAlerts(macroContext, frontier, categoryLabel);

      // ===== 推荐方案表 =====
      const recommendRows = this.buildRecommendRows(recRange, frontier, params.performanceFloor);

      // ===== 全候选方案表 =====
      const allCandidateRows = this.buildCandidateRows(frontier, dominated);
      const allCandidateTotal = allCandidateRows.length;

      // ===== 宏观因素 =====
      const macroFactors = this.buildMacroFactors(macroContext, freshness, categoryLabel);

      // ===== 数据置信度表 =====
      const confidenceRows = this.buildConfidenceRows(frontier, params);

      // ===== 更新提示 =====
      const updateHints = this.buildUpdateHints(categoryLabel, freshness, constants.version || '3.8');

      this.setData({
        loading: false,
        headerTitle,
        headerMeta,
        conclusionVerdict: conclusion.verdict,
        conclusionDetail: conclusion.detail,
        kpiCards,
        alerts,
        recommendRows,
        allCandidateRows,
        allCandidateTotal,
        allCandidateShown: Math.min(ALL_CANDIDATE_LIMIT, allCandidateTotal),
        allCandidatesExpanded: allCandidateTotal <= ALL_CANDIDATE_LIMIT,
        frontier,
        dominated,
        recommendationRange: recRange,
        performanceFloor: reportData.performanceFloor,
        budget: reportData.budget,
        macroFactors,
        confidenceRows,
        updateHints,
        lastUpdated: this.data.isReplay ? this.data.replayLastUpdated : freshness.lastUpdated,
        sopVersion: constants.version || '3.8',
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: err instanceof Error ? err.message : '报告加载失败',
      });
    }
  },

  /** 结论卡: 一句话结论 + 推荐方案摘要 */
  buildConclusion(
    params: DecisionParams,
    frontier: PlanPoint[],
    recRange: RecommendationRange | null,
    categoryLabel: string,
  ): { verdict: string; detail: string } {
    if (frontier.length === 0) {
      return {
        verdict: `${params.budget}元预算内无可行方案`,
        detail: '当前约束下未找到非劣方案，建议放宽预算或调整持有期后重新分析。',
      };
    }

    const recPlans = recRange?.plans ?? [];
    const pool = recPlans.length > 0 ? recPlans : frontier;
    const top = sortPreferredPlans(pool, params.performanceFloor)[0] ?? frontier[0];
    const topModel = this.formatModelLabel(top.model);
    const timing = top.buyTiming === 'new' ? '新品' : '二手';
    const holdYears = top.holdingYears;

    // 预算关系: 预算内 / 略超预算(10%以内) / 超出较多(10%以上)
    // verdict 用不同模板体现该关系
    const budget = params.budget;
    const buyPrice = Math.round(top.buyPrice);
    const overRatio = budget > 0 ? (buyPrice - budget) / budget : 0;
    let verdict: string;
    if (overRatio <= 0) {
      verdict = `${budget}元预算内，推荐 ${topModel} ${timing}，持有 ${holdYears} 年`;
    } else if (overRatio <= 0.1) {
      verdict = `略超${budget}元预算，推荐 ${topModel} ${timing}，持有 ${holdYears} 年`;
    } else {
      verdict = `超出${budget}元预算较多，推荐 ${topModel} ${timing}，持有 ${holdYears} 年`;
    }

    // 理由: 首选方案 = 最接近性能地板的方案
    const floorPct = Math.round(params.performanceFloor * 1000) / 10;
    const meetsFloor = top.avgPerformance >= params.performanceFloor;
    const reason = meetsFloor
      ? `该方案最接近你设定的性能地板（${floorPct}%）且满足要求，是达标方案中最经济的选择。`
      : `当前方案均未达到性能地板（${floorPct}%），该方案性能最接近地板。`;

    // 摘要: 买入价 + 月均成本 + 性能 + 系统支持状态
    const monthlyCost = (Math.round(top.monthlyCost * 100) / 100).toFixed(2);
    const perfPct = Math.round(top.avgPerformance * 1000) / 10;
    let detail = `${reason} 买入价 ¥${buyPrice}，月均成本 ¥${monthlyCost}/月，持有期平均性能满足度 ${perfPct}%。`;
    if (top.systemSupportRisk === 'exceeded') {
      detail += ` 持有期末超出系统支持期 ${top.systemSupportExceedMonths ?? 0} 月，需注意安全更新风险。`;
    } else if (top.systemSupportRisk === 'near-end') {
      detail += ` 持有期末接近系统支持期尾声。`;
    }
    // 若有等新品候选
    const waitCount = frontier.filter((p) => p.candidateType === 'B' || p.candidateType === 'C').length;
    if (waitCount > 0) {
      detail += ` 另有 ${waitCount} 个等新品方案(类型 B/C)在前沿上，可对比"现在买 vs 等新品"。`;
    }
    return { verdict, detail };
  },

  /** KPI 行: 4 卡 (最佳月均成本 / 最佳性能 / 预算内买入价 / 当前同品类新品价) */
  buildKpiCards(
    params: DecisionParams,
    frontier: PlanPoint[],
    recRange: RecommendationRange | null,
    constants: { marketSnapshots: Record<string, Record<string, { 官方价?: number | null }>> },
    categoryLabel: string,
  ): KpiCard[] {
    if (frontier.length === 0) return [];

    // 1. 最佳月均成本 (frontier 中最低)
    const bestCost = [...frontier].sort((a, b) => a.monthlyCost - b.monthlyCost)[0];
    const bestCostPlan = `${this.formatModelLabel(bestCost.model)}持${bestCost.holdingYears}年`;

    // 2. 最佳性能满足度 (frontier 中最高)
    const bestPerf = [...frontier].sort((a, b) => b.avgPerformance - a.avgPerformance)[0];
    const bestPerfPlan = `${this.formatModelLabel(bestPerf.model)}持${bestPerf.holdingYears}年`;

    // 3. 预算内买入价 (推荐区间内最低买入价)
    const recPlans = recRange?.plans ?? frontier;
    const inBudget = recPlans.filter((p) => p.buyPrice <= params.budget);
    const buyPricePool = inBudget.length > 0 ? inBudget : recPlans;
    const bestBuyPrice = [...buyPricePool].sort((a, b) => a.buyPrice - b.buyPrice)[0];
    const buyPriceLabel = bestBuyPrice.buyTiming === 'new' ? '新品官方价' : '闲鱼中位价';

    // 4. 当前同品类新品价 (marketSnapshots 中该品类最高官方价, 即最新在售款)
    const snapshotKey = this.resolveSnapshotKey(constants.marketSnapshots, params.category);
    let currentNewPrice = 0;
    if (snapshotKey) {
      const entries = constants.marketSnapshots[snapshotKey];
      for (const key of Object.keys(entries)) {
        const official = entries[key]?.官方价;
        if (typeof official === 'number' && official > currentNewPrice) {
          currentNewPrice = official;
        }
      }
    }

    return [
      {
        label: `最佳月均成本 (${bestCostPlan})`,
        value: `¥${Math.round(bestCost.monthlyCost)}`,
        unit: '/月',
      },
      {
        label: `最佳性能满足度 (${bestPerfPlan})`,
        value: `${Math.round(bestPerf.avgPerformance * 1000) / 10}%`,
        unit: `相对${categoryLabel}旗舰`,
      },
      {
        label: `预算内买入价 (${bestBuyPrice.buyTiming === 'new' ? '新品' : '二手'})`,
        value: `¥${Math.round(bestBuyPrice.buyPrice).toLocaleString()}`,
        unit: buyPriceLabel,
      },
      {
        label: `当前同品类新品价`,
        value: currentNewPrice > 0 ? `¥${currentNewPrice.toLocaleString()}` : '—',
        unit: currentNewPrice > params.budget ? '超出预算' : '在预算内',
      },
    ];
  },

  /** 预警 alert: v3.8 宏观事件 + 发布时间偏差 + 等新品提示 */
  buildAlerts(
    macroContext: { storageSuperCycleStage: string; hasGlobalPriceHike: boolean; analysisMonth: string },
    frontier: PlanPoint[],
    categoryLabel: string,
  ): AlertItem[] {
    const alerts: AlertItem[] = [];

    if (macroContext.storageSuperCycleStage !== 'none') {
      const stageLabel =
        macroContext.storageSuperCycleStage === 'peaking' ? '峰值期' :
        macroContext.storageSuperCycleStage === 'ongoing' ? '进行中' : '缓解中';
      alerts.push({
        level: 'warning',
        title: '⚠️ 存储超级周期' + stageLabel,
        desc: '新品价格预测模型与冲击调整已启用宏观修正，等新品方案(类型 B/C)的预测价已含涨幅因子。',
      });
    }

    if (macroContext.hasGlobalPriceHike) {
      alerts.push({
        level: 'warning',
        title: '⚠️ 苹果全线涨价事件已触发',
        desc: `${categoryLabel} 当前新品官方价已反映涨价，类型 B 候选直接使用快照官方价。`,
      });
    }

    const waitCount = frontier.filter((p) => p.candidateType === 'B' || p.candidateType === 'C').length;
    if (waitCount > 0) {
      alerts.push({
        level: 'info',
        title: 'ℹ️ 已生成等新品方案',
        desc: `距下次发布较近，引擎自动生成 ${waitCount} 个等新品方案(类型 B/C)，预测价已标注"预测值"，请结合置信度判断。`,
      });
    }

    return alerts;
  },

  /** 推荐方案表: 取推荐区间内方案, 首选为最接近性能地板(优先达标)的方案 */
  buildRecommendRows(recRange: RecommendationRange | null, frontier: PlanPoint[], performanceFloor: number): RecommendRow[] {
    const plans = (recRange?.plans ?? frontier).slice();
    if (plans.length === 0) return [];

    // 首选: 最接近性能地板的方案(优先满足地板, 组内按与地板接近度升序; 接近度相同按月均成本升序)
    const sorted = sortPreferredPlans(plans, performanceFloor);
    const minCost = Math.min(...plans.map((p) => p.monthlyCost));
    const maxPerf = Math.max(...plans.map((p) => p.avgPerformance));

    return sorted.map((p, i) => {
      const reasons: string[] = [];
      if (i === 0) reasons.push('最接近性能地板');
      if (p.monthlyCost === minCost) reasons.push('月均成本最低');
      if (p.avgPerformance === maxPerf) reasons.push('性能最高');
      if (p.candidateType === 'B') reasons.push('等新品发布后买入新品');
      if (p.candidateType === 'C') reasons.push('等新品后买降价老款');
      if (p.systemSupportRisk === 'normal') reasons.push('持有期内系统支持正常');
      if (p.systemSupportRisk === 'exceeded') reasons.push(`持有期末超出支持期${p.systemSupportExceedMonths ?? 0}月`);
      if (p.systemSupportRisk === 'near-end') reasons.push('接近系统支持尾声');
      if (reasons.length === 0) reasons.push('非劣方案');

      return {
        planLabel: i === 0 ? '🥇 首选' : `方案 ${i + 1}`,
        config: this.formatModelLabel(p.model),
        buyPrice: Math.round(p.buyPrice),
        holdingMonths: p.holdingMonths,
        monthlyCost: Math.round(p.monthlyCost * 100) / 100,
        performancePct: Math.round(p.avgPerformance * 1000) / 10,
        reason: reasons.join('，'),
        candidateBadge: this.candidateBadge(p.candidateType),
        predictedPrice: !!p.predictedPrice,
      };
    });
  },

  /** 全候选方案表: 前沿 + 被支配, 按月均成本升序 */
  buildCandidateRows(frontier: PlanPoint[], dominated: PlanPoint[]): CandidateRow[] {
    const all = [
      ...frontier.map((p) => ({ p, isFrontier: true })),
      ...dominated.map((p) => ({ p, isFrontier: false })),
    ];
    all.sort((a, b) => a.p.monthlyCost - b.p.monthlyCost);

    return all.map(({ p, isFrontier }) => {
      let supportLabel = '';
      let supportLevel: '' | 'near-end' | 'exceeded' = '';
      if (p.systemSupportRisk === 'exceeded') {
        supportLabel = `超${p.systemSupportExceedMonths ?? 0}月`;
        supportLevel = 'exceeded';
      } else if (p.systemSupportRisk === 'near-end') {
        supportLabel = '接近尾声';
        supportLevel = 'near-end';
      }
      return {
        model: this.formatModelLabel(p.model),
        holdingMonths: p.holdingMonths,
        buyPrice: Math.round(p.buyPrice),
        s0Pct: Math.round(p.performanceS0 * 1000) / 10,
        avgSPct: Math.round(p.avgPerformance * 1000) / 10,
        residual: Math.round(p.residual),
        monthlyCost: Math.round(p.monthlyCost * 100) / 100,
        paretoStatus: isFrontier ? '前沿' : '被支配',
        paretoLevel: isFrontier ? 'frontier' : 'dominated',
        supportLabel,
        supportLevel,
        candidateBadge: this.candidateBadge(p.candidateType),
        predictedPrice: !!p.predictedPrice,
      };
    });
  },

  /** 宏观因素摘要 */
  buildMacroFactors(
    macroContext: { storageSuperCycleStage: string; hasGlobalPriceHike: boolean; analysisMonth: string },
    freshness: { level: string; days: number; lastUpdated: string },
    categoryLabel: string,
  ): MacroItem[] {
    const items: MacroItem[] = [];
    if (macroContext.storageSuperCycleStage !== 'none') {
      items.push({
        level: 'warning',
        title: `存储超级周期 — ${macroContext.storageSuperCycleStage}`,
        desc: '已启用: 新品价格预测模型、冲击幅度向下修正、缺货等待期因子调整。',
      });
    }
    if (macroContext.hasGlobalPriceHike) {
      items.push({
        level: 'warning',
        title: '苹果全线涨价',
        desc: `${categoryLabel} 已涨价，快照官方价已反映涨价后的价格。`,
      });
    }
    items.push({
      level: freshness.level === 'expired' ? 'error' : freshness.level === 'stale' ? 'warning' : 'info',
      title: `常量校验级别: ${freshness.level === 'expired' ? '红色(需更新)' : freshness.level === 'stale' ? '黄色(建议更新)' : '绿色(免检)'}`,
      desc: `constants.json 最后更新于 ${freshness.lastUpdated}（距分析日 ${freshness.days} 天）。`,
    });
    return items;
  },

  /** 数据置信度表 */
  buildConfidenceRows(frontier: PlanPoint[], params: DecisionParams): ConfidenceRow[] {
    const rows: ConfidenceRow[] = [];
    const hasNew = frontier.some((p) => p.buyTiming === 'new' || p.candidateType === 'B');
    const hasUsed = frontier.some((p) => p.buyTiming === 'used' || p.candidateType === 'C');

    if (hasNew) {
      rows.push({
        item: '新品官方价',
        level: '高',
        levelClass: 'success',
        desc: '来自苹果官网/正规授权渠道, 直接采信',
      });
    }
    if (hasUsed) {
      rows.push({
        item: '二手市场价',
        level: '中',
        levelClass: 'warning',
        desc: '闲鱼挂单价(非实付), 实际成交价低 5-10%',
      });
    }
    rows.push({
      item: '保值率曲线',
      level: '中',
      levelClass: 'warning',
      desc: '历史统计均值, ±5-10% 波动; 超 60 月为外推, 置信度降低',
    });
    const maxHold = Math.max(...params.holdingYears, 0);
    if (maxHold >= 4) {
      rows.push({
        item: `长持有期(${maxHold}年)性能预测`,
        level: '中-低',
        levelClass: 'warning',
        desc: '基于 CAGR 假设, 近期代际提升放缓可能导致预测偏高',
      });
    }
    const hasWait = frontier.some((p) => p.candidateType === 'B' || p.candidateType === 'C');
    if (hasWait) {
      rows.push({
        item: '等新品方案(类型 B/C)预测价',
        level: '中-低',
        levelClass: 'warning',
        desc: '基于行业分析师预测与历史均值, 实际发布价可能偏差较大',
      });
    }
    return rows;
  },

  /** 更新提示 */
  buildUpdateHints(categoryLabel: string, freshness: { lastUpdated: string }, sopVersion: string): string[] {
    const nextDate = new Date(freshness.lastUpdated);
    nextDate.setDate(nextDate.getDate() + 30);
    const nextStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    return [
      `当 ${categoryLabel} 新一代新品实际发布后, 应重新分析(等待方案预测价不得回写快照)`,
      '当二手市场价出现显著变化(幅度>15%)时, 建议重新分析',
      `下次建议分析时间: ${nextStr}(快照过期前)或新品发布后(立即)`,
      `数据来源: constants.json v${sopVersion}(${freshness.lastUpdated}更新)`,
    ];
  },

  /** 候选类型徽章文案 */
  candidateBadge(ct: 'A' | 'B' | 'C' | undefined): string {
    if (ct === 'B') return '等新品后';
    if (ct === 'C') return '等新品降价';
    return '';
  },

  /** 简化机型显示: "M2_16G_256G_二手 × 3年" → "M2 16G 256G" */
  formatModelLabel(model: string): string {
    return model.replace(/\s*×\s*\d+年$/, '').replace(/_/g, ' ');
  },

  /** 解析快照品类键(对齐引擎 resolveCategoryKey 逻辑) */
  resolveSnapshotKey(
    snapshots: Record<string, Record<string, unknown>>,
    category: string,
  ): string | null {
    if (snapshots[category]) return category;
    const snake = category.replace(/-/g, '_');
    if (snapshots[snake]) return snake;
    const parts = snake.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    const titleCase = parts.join('_');
    if (snapshots[titleCase]) return titleCase;
    // 模糊匹配: 大小写不敏感
    const lower = category.toLowerCase();
    for (const key of Object.keys(snapshots)) {
      if (key.toLowerCase().replace(/[-_]/g, '') === lower.replace(/[-_]/g, '')) return key;
    }
    return null;
  },

  /** 展开/折叠全候选方案表 */
  onToggleAllCandidates() {
    this.setData({ allCandidatesExpanded: !this.data.allCandidatesExpanded });
  },

  /** 展开/折叠宏观因素 */
  onToggleMacro() {
    this.setData({ macroExpanded: !this.data.macroExpanded });
  },

  /** 点击图表点位 → 跳转详情页 */
  onChartPointTap(e: WechatMiniprogram.CustomEvent) {
    const plan = e.detail.plan as PlanPoint;
    const app = getApp();
    if (app.globalData) {
      app.globalData.detailPlan = plan as unknown as Record<string, unknown>;
    }
    wx.navigateTo({ url: '/pages/detail/detail' });
  },

  /** 保存结果: 组装快照 → 存 globalData.shareCardData → 跳转 share-card 页 */
  onSaveResult() {
    const app = getApp();
    const reportData = app.globalData?.reportData as unknown as ReportData | null;
    if (!reportData || !reportData.params) {
      wx.showToast({ title: '数据缺失，无法保存', icon: 'none' });
      return;
    }

    const headerTitle = this.data.headerTitle || `${reportData.params.category} 购买决策分析`;
    const recPlans = reportData.recommendationRange?.plans ?? [];
    const pool = recPlans.length > 0 ? recPlans : (reportData.frontier ?? []);
    const topPlan = sortPreferredPlans(pool, reportData.performanceFloor)[0] ?? reportData.frontier?.[0] ?? null;

    // 组装 shareCardData 供 share-card 页使用
    if (app.globalData) {
      app.globalData.shareCardData = {
        params: reportData.params,
        reportData,
        headerTitle,
        topPlan,
        frontier: reportData.frontier || [],
      };
    }

    wx.navigateTo({ url: '/pages/share-card/share-card' });
  },

  /** 用户点击右上角分享 */
  onShareAppMessage() {
    return {
      title: `${this.data.headerTitle || '苹果购买决策分析'} — 完整报告`,
      path: '/pages/decision-tree/decision-tree',
    };
  },
});
