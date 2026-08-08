// pages/report/report.ts
// 端内完整报告页: 按 design.md D9 结构组装报告 (HTML 报告的端内简化版)
// 从 app.globalData.reportData 读取引擎结果 + 决策参数, 从 engine-bridge 读取常量元信息与宏观状态

import { getConstants, getDataFreshness, getMacroContext } from '../../engine-bridge/index';

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
    // 导出
    exportedFilePath: '',
    hasExportedFile: false,
  },

  onLoad() {
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
      const recommendRows = this.buildRecommendRows(recRange, frontier);

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
        lastUpdated: freshness.lastUpdated,
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
    const top = recPlans[0] ?? frontier[0];
    const topModel = this.formatModelLabel(top.model);
    const verdict = `${params.budget}元预算内，推荐方案为 ${topModel} ${top.buyTiming === 'new' ? '新品' : '二手'}，持有 ${top.holdingYears} 年`;

    // 摘要: 月均成本 + 性能 + 系统支持状态
    const monthlyCost = (Math.round(top.monthlyCost * 100) / 100).toFixed(2);
    const perfPct = Math.round(top.avgPerformance * 1000) / 10;
    let detail = `月均成本 ¥${monthlyCost}/月，持有期平均性能满足度 ${perfPct}%。`;
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

  /** 推荐方案表: 取推荐区间内方案, 按月均成本升序 */
  buildRecommendRows(recRange: RecommendationRange | null, frontier: PlanPoint[]): RecommendRow[] {
    const plans = (recRange?.plans ?? frontier).slice();
    if (plans.length === 0) return [];

    const sorted = [...plans].sort((a, b) => a.monthlyCost - b.monthlyCost);
    const minCost = sorted[0].monthlyCost;
    const maxPerf = Math.max(...plans.map((p) => p.avgPerformance));

    return sorted.map((p, i) => {
      const reasons: string[] = [];
      if (p.monthlyCost === minCost) reasons.push('月均成本最低');
      if (p.avgPerformance === maxPerf) reasons.push('性能最高');
      if (p.candidateType === 'B') reasons.push('等新品发布后买入新品');
      if (p.candidateType === 'C') reasons.push('等新品后买降价老款');
      if (p.systemSupportRisk === 'normal') reasons.push('持有期内系统支持正常');
      if (p.systemSupportRisk === 'exceeded') reasons.push(`持有期末超出支持期${p.systemSupportExceedMonths ?? 0}月`);
      if (p.systemSupportRisk === 'near-end') reasons.push('接近系统支持尾声');
      if (reasons.length === 0) reasons.push(i === 0 ? '前沿上的方案' : '非劣方案');

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

  /** 导出为单文件 HTML */
  onExportHtml() {
    wx.showLoading({ title: '生成报告中...' });
    try {
      const html = this.buildExportHtml();
      const dateStr = this.data.lastUpdated.replace(/-/g, '-');
      const categorySlug = (this.data.headerTitle || 'report').split(' ')[0].toLowerCase();
      const filename = `${dateStr}-${categorySlug}-决策报告.html`;
      const filePath = `${wx.env.USER_DATA_PATH}/${filename}`;
      const fs = wx.getFileSystemManager();
      fs.writeFile({
        filePath,
        data: html,
        encoding: 'utf8',
        success: () => {
          wx.hideLoading();
          this.setData({ exportedFilePath: filePath, hasExportedFile: true });
          wx.showModal({
            title: '报告已保存',
            content: `文件已保存到: ${filename}\n可点击"转发文件"分享给好友。`,
            showCancel: false,
            confirmText: '好的',
          });
        },
        fail: (err) => {
          wx.hideLoading();
          wx.showToast({ title: `保存失败: ${err.errMsg || '未知错误'}`, icon: 'none' });
        },
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err instanceof Error ? err.message : '生成失败', icon: 'none' });
    }
  },

  /** 转发 HTML 文件 */
  onShareFile() {
    if (!this.data.exportedFilePath) {
      wx.showToast({ title: '请先导出报告', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath: this.data.exportedFilePath,
      success: () => {
        wx.showToast({ title: '已唤起转发', icon: 'success' });
      },
      fail: (err) => {
        // 用户取消分享不算错误
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: `转发失败: ${err.errMsg || '未知错误'}`, icon: 'none' });
      },
    });
  },

  /** 组装单文件 HTML(便携摘要版, 不依赖外部资源) */
  buildExportHtml(): string {
    const rows = this.data.allCandidateRows.map((r) => {
      const paretoBadge = r.paretoLevel === 'frontier'
        ? '<span class="badge success">前沿</span>'
        : '<span class="badge error">被支配</span>';
      const supportBadge = r.supportLevel === 'exceeded'
        ? `<span class="badge error">${r.supportLabel}</span>`
        : r.supportLevel === 'near-end'
          ? `<span class="badge warning">${r.supportLabel}</span>`
          : '<span class="badge success">正常</span>';
      const waitBadge = r.candidateBadge
        ? `<span class="badge warning">${r.candidateBadge}</span>`
        : '';
      const predictTag = r.predictedPrice ? ' <em>(预测值)</em>' : '';
      return `<tr><td>${r.model}</td><td>${r.holdingMonths}月</td><td>¥${r.buyPrice.toLocaleString()}${predictTag}</td><td>${r.s0Pct}</td><td>${r.avgSPct}</td><td>¥${r.residual.toLocaleString()}</td><td>¥${r.monthlyCost}/月</td><td>${paretoBadge}${waitBadge ? ' ' + waitBadge : ''}</td><td>${supportBadge}</td></tr>`;
    }).join('\n');

    const kpiHtml = this.data.kpiCards.map((k) =>
      `<div class="kpi"><div class="label">${k.label}</div><div class="value">${k.value}</div><div class="unit">${k.unit}</div></div>`,
    ).join('');

    const alertHtml = this.data.alerts.map((a) =>
      `<div class="alert alert-${a.level}"><strong>${a.title}</strong><br>${a.desc}</div>`,
    ).join('');

    const recommendHtml = this.data.recommendRows.map((r) =>
      `<tr><td>${r.planLabel}</td><td>${r.config}</td><td>¥${r.buyPrice.toLocaleString()}${r.predictedPrice ? ' <em>(预测值)</em>' : ''}</td><td>${r.holdingMonths}月</td><td>¥${r.monthlyCost}/月</td><td>${r.performancePct}%</td><td>${r.reason}</td></tr>`,
    ).join('');

    const macroHtml = this.data.macroFactors.map((m) =>
      `<div class="macro"><span class="dot dot-${m.level}"></span><div><strong>${m.title}</strong><br>${m.desc}</div></div>`,
    ).join('');

    const confHtml = this.data.confidenceRows.map((c) =>
      `<tr><td>${c.item}</td><td><span class="badge ${c.levelClass}">${c.level}</span></td><td>${c.desc}</td></tr>`,
    ).join('');

    const hintsHtml = this.data.updateHints.map((h) => `<p>• ${h}</p>`).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this.data.headerTitle}</title>
<style>
:root { --brand:#007AFF; --accent:#E8F0FE; --success:#34C759; --warning:#FF9500; --error:#FF3B30; --gray:#6B7280; --dark:#1F2937; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; background:#F9FAFB; color:var(--dark); line-height:1.6; padding:24px; }
.container { max-width:960px; margin:0 auto; }
.header { background:#fff; border-radius:16px; padding:32px; margin-bottom:24px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.header h1 { font-size:28px; margin-bottom:8px; }
.header .meta { color:var(--gray); font-size:14px; }
.conclusion { background:linear-gradient(135deg,var(--brand),#0056CC); color:#fff; border-radius:16px; padding:32px; margin-bottom:24px; }
.conclusion h2 { font-size:18px; margin-bottom:16px; opacity:.9; }
.conclusion .verdict { font-size:24px; font-weight:700; margin-bottom:12px; }
.conclusion .detail { font-size:15px; opacity:.9; }
.kpi-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; margin-bottom:24px; }
.kpi { background:#fff; border-radius:12px; padding:20px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.kpi .label { font-size:12px; color:var(--gray); margin-bottom:8px; }
.kpi .value { font-size:32px; font-weight:600; color:var(--brand); }
.kpi .unit { font-size:14px; color:var(--gray); margin-top:4px; }
.alert { padding:16px; border-radius:12px; margin-bottom:16px; font-size:14px; }
.alert-warning { background:#FEF3C7; color:#92400E; }
.alert-info { background:var(--accent); color:#1A56DB; }
.alert-error { background:#FEE2E2; color:#991B1B; }
.section { background:#fff; border-radius:16px; padding:32px; margin-bottom:24px; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.section h2 { font-size:20px; margin-bottom:20px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th { background:#F3F4F6; padding:12px 16px; text-align:left; font-size:13px; color:var(--gray); border-bottom:2px solid #E5E7EB; }
td { padding:12px 16px; border-bottom:1px solid #E5E7EB; }
tr:last-child td { border-bottom:none; }
.badge { display:inline-block; padding:2px 10px; border-radius:12px; font-size:12px; font-weight:600; }
.badge.success { background:#D1FAE5; color:#065F46; }
.badge.warning { background:#FEF3C7; color:#92400E; }
.badge.error { background:#FEE2E2; color:#991B1B; }
em { color:var(--warning); font-style:normal; font-size:12px; }
.macro { display:flex; gap:12px; padding:12px 0; border-bottom:1px solid #F3F4F6; }
.macro:last-child { border-bottom:none; }
.dot { width:8px; height:8px; border-radius:50%; margin-top:8px; flex-shrink:0; }
.dot-warning { background:var(--warning); }
.dot-info { background:var(--brand); }
.dot-error { background:var(--error); }
@media (max-width:640px) { body{padding:12px;} .header{padding:20px;} .header h1{font-size:22px;} .conclusion{padding:24px;} .kpi-row{grid-template-columns:repeat(2,1fr);} table{font-size:12px;} th,td{padding:8px 10px;} }
</style>
</head>
<body>
<div class="container">
<div class="header"><h1>${this.data.headerTitle}</h1><div class="meta">${this.data.headerMeta}</div></div>
<div class="conclusion"><h2>结论与推荐方案</h2><div class="verdict">${this.data.conclusionVerdict}</div><div class="detail">${this.data.conclusionDetail}</div></div>
<div class="kpi-row">${kpiHtml}</div>
${alertHtml}
<div class="section"><h2>推荐方案</h2><table><thead><tr><th>方案</th><th>配置</th><th>买入价</th><th>持有期</th><th>月均成本</th><th>性能满足度</th><th>推荐理由</th></tr></thead><tbody>${recommendHtml}</tbody></table></div>
<div class="section"><h2>全部候选方案 (${this.data.allCandidateTotal})</h2><table><thead><tr><th>型号</th><th>持有期</th><th>买入价</th><th>S₀(%)</th><th>S̄(%)</th><th>期末残值</th><th>月均成本</th><th>帕累托</th><th>系统支持</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="section"><h2>宏观因素与常量校验</h2>${macroHtml}</div>
<div class="section"><h2>数据置信度与不确定性</h2><table><thead><tr><th>数据项</th><th>置信度</th><th>说明</th></tr></thead><tbody>${confHtml}</tbody></table></div>
<div class="section"><h2>更新提示</h2><div style="font-size:14px;color:var(--gray);line-height:1.8;">${hintsHtml}</div></div>
</div>
</body>
</html>`;
  },

  /** 用户点击右上角分享 */
  onShareAppMessage() {
    return {
      title: `${this.data.headerTitle || '苹果购买决策分析'} — 完整报告`,
      path: '/pages/decision-tree/decision-tree',
    };
  },
});
