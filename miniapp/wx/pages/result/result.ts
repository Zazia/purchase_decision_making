// pages/result/result.ts
// 结果页: 调用引擎计算帕累托前沿, 结论先行展示方案列表 + 图表 + 数据时效

import { compute, getDataFreshness } from '../../engine-bridge/index';

/** 引擎返回的方案点(与 PlanPoint 对齐, 含 v3.8 候选类型字段) */
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
  /** v3.8 候选类型: A=现在买, B=等新品买新品, C=等新品后买降价老款 */
  candidateType?: 'A' | 'B' | 'C';
  /** 等待月数(仅类型 B/C) */
  waitMonths?: number;
  /** 买入价是否为预测值 */
  predictedPrice?: boolean;
  /** 系统支持期风险标注 */
  systemSupportRisk?: 'normal' | 'near-end' | 'exceeded';
  /** 超出系统支持期月数 */
  systemSupportExceedMonths?: number;
}

/** 用于页面展示的方案项 */
interface PlanDisplayItem {
  key: string;
  modelLabel: string;
  chip: string;
  buyTiming: 'new' | 'used';
  buyTimingLabel: string;
  holdingYears: number;
  monthlyCost: number;
  avgPerformancePct: number;
  buyPrice: number;
  inRange: boolean;
  /** 候选类型徽章文案 (A=空, B=等新品后, C=等新品降价) */
  candidateBadge: string;
  /** 买入价是否为预测值 */
  predictedPrice: boolean;
  raw: PlanPoint;
}

interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used' | 'both';
  performanceFloor: number;
  holdingYears: number[];
}

Page({
  data: {
    loading: true,
    error: '' as string,
    isEmpty: false,
    relaxedHint: '',
    plans: [] as PlanDisplayItem[],
    frontier: [] as PlanPoint[],
    dominated: [] as PlanPoint[],
    recommendationRange: null as null | { lowerCost: number; upperCost: number; plans: PlanPoint[] },
    performanceFloor: 0,
    budget: 0,
    lastUpdated: '',
    freshnessLevel: 'fresh' as 'fresh' | 'stale' | 'expired',
    days: 0,
    params: null as null | DecisionParams,
  },

  onLoad(query: Record<string, string>) {
    const params = this.parseQuery(query);
    this.setData({ params, performanceFloor: params.performanceFloor, budget: params.budget });
    this.loadResult(params);
    this.loadFreshness();
  },

  /** 解析 URL query → DecisionParams (支持 buyTiming='both') */
  parseQuery(query: Record<string, string>): DecisionParams {
    const holdingYears = (query.holdingYears || '3')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => !isNaN(n) && n > 0);

    const rawBT = query.buyTiming || 'used';
    const buyTiming: 'new' | 'used' | 'both' =
      rawBT === 'new' ? 'new' : rawBT === 'both' ? 'both' : 'used';

    return {
      category: query.category || 'mac-mini',
      budget: Number(query.budget) || 5000,
      buyTiming,
      performanceFloor: Number(query.performanceFloor) || 0.4,
      holdingYears: holdingYears.length > 0 ? holdingYears : [3],
    };
  },

  /** 调用引擎计算并渲染 */
  async loadResult(params: DecisionParams) {
    try {
      this.setData({ loading: true, error: '' });
      const result = await compute(params);

      const frontierEmpty = result.frontier.length === 0;
      const recRange = result.recommendationRange;
      const recRangeEmpty = !recRange || !recRange.plans || recRange.plans.length === 0;

      // 推荐区间为空(预算内无方案)或完全无候选 → 放宽预算兜底
      if (frontierEmpty || recRangeEmpty) {
        const relaxed = await this.computeRelaxed(params);
        // 优先展示原结果的前沿图(让用户看到全景), 仅完全无候选时用放宽结果
        const showFrontier = frontierEmpty ? relaxed.frontier : result.frontier;
        const showDominated = frontierEmpty ? relaxed.dominated : result.dominated;
        // 优先使用放宽后的推荐区间, 兜底原始推荐区间
        const showRecRange = relaxed.recommendationRange ?? recRange ?? null;
        this.setData({
          loading: false,
          isEmpty: true,
          relaxedHint: relaxed.hint,
          plans: relaxed.plans,
          frontier: showFrontier,
          dominated: showDominated,
          recommendationRange: showRecRange,
        });
        return;
      }

      // 正常结果
      const recKeys = new Set(recRange.plans.map((p) => `${p.model}-${p.holdingYears}`));
      const plans = this.formatPlans(result.frontier, recKeys);
      this.setData({
        loading: false,
        plans,
        frontier: result.frontier,
        dominated: result.dominated,
        recommendationRange: recRange,
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: err instanceof Error ? err.message : '计算失败，请返回重试',
      });
    }
  },

  /** 空结果兜底: 逐级放宽预算(×2→×3→×5)寻找最近可行方案 (性能地板已不过滤, 不再放宽地板) */
  async computeRelaxed(
    params: DecisionParams,
  ): Promise<{
    hint: string;
    plans: PlanDisplayItem[];
    frontier: PlanPoint[];
    dominated: PlanPoint[];
    recommendationRange: { lowerCost: number; upperCost: number; plans: PlanPoint[] } | null;
  }> {
    const multipliers = [2, 3, 5];
    for (const mult of multipliers) {
      try {
        const relaxed = await compute({ ...params, budget: params.budget * mult });
        const recRange = relaxed.recommendationRange;
        const hasRecPlans = recRange && recRange.plans && recRange.plans.length > 0;
        if (hasRecPlans) {
          const recKeys = new Set(
            recRange.plans.map((p) => `${p.model}-${p.holdingYears}`),
          );
          return {
            hint: `已放宽预算至 ${params.budget * mult} 元`,
            plans: this.formatPlans(relaxed.frontier, recKeys),
            frontier: relaxed.frontier,
            dominated: relaxed.dominated,
            recommendationRange: recRange,
          };
        }
      } catch {
        // 放宽失败, 尝试下一级
      }
    }

    // 所有级别都无预算内方案, 兜底展示最后一级放宽后的前沿
    const lastMult = multipliers[multipliers.length - 1];
    try {
      const lastRelaxed = await compute({ ...params, budget: params.budget * lastMult });
      return {
        hint: `已放宽预算至 ${params.budget * lastMult} 元，仍未找到预算内方案`,
        plans: this.formatPlans(lastRelaxed.frontier, new Set()),
        frontier: lastRelaxed.frontier,
        dominated: lastRelaxed.dominated,
        recommendationRange: null,
      };
    } catch {
      return { hint: '无法找到可行方案', plans: [], frontier: [], dominated: [], recommendationRange: null };
    }
  },

  /** 将引擎 PlanPoint 转为展示用 PlanDisplayItem (含候选类型徽章) */
  formatPlans(frontier: PlanPoint[], recKeys: Set<string>): PlanDisplayItem[] {
    return frontier.map((p, i) => ({
      key: `${p.model}-${p.holdingYears}-${i}`,
      modelLabel: this.formatModelLabel(p.model),
      chip: p.chip,
      buyTiming: p.buyTiming,
      buyTimingLabel: p.buyTiming === 'new' ? '新品' : '二手',
      holdingYears: p.holdingYears,
      monthlyCost: Math.round(p.monthlyCost * 100) / 100,
      avgPerformancePct: Math.round(p.avgPerformance * 1000) / 10,
      buyPrice: Math.round(p.buyPrice),
      inRange: recKeys.has(`${p.model}-${p.holdingYears}`),
      candidateBadge: this.candidateBadge(p.candidateType),
      predictedPrice: !!p.predictedPrice,
      raw: p,
    }));
  },

  /** 候选类型徽章文案: A=无标注, B=等新品后, C=等新品降价 */
  candidateBadge(ct: 'A' | 'B' | 'C' | undefined): string {
    if (ct === 'B') return '等新品后';
    if (ct === 'C') return '等新品降价';
    return '';
  },

  /** 简化机型显示: "M2_16G_256G_二手 × 3年" → "M2 16G 256G · 持有3年" */
  formatModelLabel(model: string): string {
    // 去掉 " × Ny年" 后缀
    const base = model.replace(/\s*×\s*\d+年$/, '');
    // 下划线转空格
    return base.replace(/_/g, ' ');
  },

  /** 加载数据时效信息 */
  async loadFreshness() {
    try {
      const f = await getDataFreshness();
      this.setData({
        lastUpdated: f.lastUpdated,
        freshnessLevel: f.level,
        days: f.days,
      });
    } catch {
      // 时效加载失败不阻塞主流程
    }
  },

  /** 点击方案卡片 → 跳转详情页 */
  onPlanTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const plan = this.data.plans[index];
    if (!plan) return;

    const app = getApp();
    if (app.globalData) {
      app.globalData.detailPlan = plan.raw as Record<string, unknown>;
    }
    wx.navigateTo({ url: '/pages/detail/detail' });
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

  /** 跳转端内完整报告页: 存 reportData 到 globalData 供 report 页读取 */
  onOpenReport() {
    const params = this.data.params;
    if (!params) return;
    const app = getApp();
    if (app.globalData) {
      app.globalData.reportData = {
        params,
        frontier: this.data.frontier,
        dominated: this.data.dominated,
        recommendationRange: this.data.recommendationRange,
        performanceFloor: params.performanceFloor,
        budget: params.budget,
      } as unknown as Record<string, unknown>;
    }
    wx.navigateTo({ url: '/pages/report/report' });
  },

  /** 重试 */
  onRetry() {
    if (this.data.params) {
      this.loadResult(this.data.params);
    }
  },

  /** 生成分享卡 → 跳转分享卡页, 推荐方案存 globalData */
  onGenerateShareCard() {
    const params = this.data.params;
    if (!params || this.data.plans.length === 0) return;

    // 取推荐区间第一个方案作为分享卡主推
    const topPlan = this.data.plans[0];
    const app = getApp();
    if (app.globalData) {
      app.globalData.shareCardData = {
        params,
        topPlan: topPlan.raw,
        frontier: this.data.frontier,
      } as unknown as Record<string, unknown>;
    }

    const query = `category=${params.category}&budget=${params.budget}`;
    wx.navigateTo({ url: `/pages/share-card/share-card?${query}` });
  },

  /** 打开 GitHub 链接(复制到剪贴板) */
  onOpenGitHub() {
    wx.setClipboardData({
      data: 'https://github.com/Zazia/purchase_decision_making',
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      },
    });
  },

  /** 用户点击右上角分享 */
  onShareAppMessage() {
    const params = this.data.params;
    if (!params) return { title: '苹果购买决策分析' };
    const path = `/pages/decision-tree/decision-tree?category=${params.category}&budget=${params.budget}`;
    return {
      title: '苹果购买决策分析 — 用数据帮你选',
      path,
    };
  },
});
