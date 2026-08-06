// pages/result/result.ts
// 结果页: 调用引擎计算帕累托前沿, 结论先行展示方案列表 + 图表 + 数据时效

import { compute, getDataFreshness } from '../../engine-bridge/index';

/** 引擎返回的方案点(与 PlanPoint 对齐) */
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
  raw: PlanPoint;
}

interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used';
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
    lastUpdated: '',
    freshnessLevel: 'fresh' as 'fresh' | 'stale' | 'expired',
    days: 0,
    params: null as null | DecisionParams,
  },

  onLoad(query: Record<string, string>) {
    const params = this.parseQuery(query);
    this.setData({ params, performanceFloor: params.performanceFloor });
    this.loadResult(params);
    this.loadFreshness();
  },

  /** 解析 URL query → DecisionParams */
  parseQuery(query: Record<string, string>): DecisionParams {
    const holdingYears = (query.holdingYears || '3')
      .split(',')
      .map((s) => Number(s))
      .filter((n) => !isNaN(n) && n > 0);

    return {
      category: query.category || 'mac-mini',
      budget: Number(query.budget) || 5000,
      buyTiming: (query.buyTiming === 'new' ? 'new' : 'used'),
      performanceFloor: Number(query.performanceFloor) || 0.4,
      holdingYears: holdingYears.length > 0 ? holdingYears : [3],
    };
  },

  /** 调用引擎计算并渲染 */
  async loadResult(params: DecisionParams) {
    try {
      this.setData({ loading: true, error: '' });
      const result = await compute(params);

      if (result.frontier.length === 0) {
        // 空结果兜底: 逐步放宽约束
        const relaxed = await this.computeRelaxed(params);
        this.setData({
          loading: false,
          isEmpty: true,
          relaxedHint: relaxed.hint,
          plans: relaxed.plans,
          frontier: relaxed.frontier,
          dominated: relaxed.dominated,
        });
        return;
      }

      // 正常结果
      const recRange = result.recommendationRange;
      const recKeys = new Set(
        recRange && recRange.plans
          ? recRange.plans.map((p) => `${p.model}-${p.holdingYears}`)
          : [],
      );

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

  /** 空结果兜底: 逐步放宽约束寻找最近可行方案 */
  async computeRelaxed(
    params: DecisionParams,
  ): Promise<{
    hint: string;
    plans: PlanDisplayItem[];
    frontier: PlanPoint[];
    dominated: PlanPoint[];
  }> {
    // 第一轮: 放宽性能地板至 0
    try {
      const noFloor = await compute({ ...params, performanceFloor: 0 });
      if (noFloor.frontier.length > 0) {
        return {
          hint: '已放宽性能地板至 0%',
          plans: this.formatPlans(noFloor.frontier, new Set()),
          frontier: noFloor.frontier,
          dominated: noFloor.dominated,
        };
      }
    } catch {
      // 继续下一轮
    }

    // 第二轮: 放宽性能地板 + 预算翻倍
    try {
      const relaxedBudget = await compute({
        ...params,
        performanceFloor: 0,
        budget: params.budget * 2,
      });
      if (relaxedBudget.frontier.length > 0) {
        return {
          hint: '已放宽性能地板与预算上限',
          plans: this.formatPlans(relaxedBudget.frontier, new Set()),
          frontier: relaxedBudget.frontier,
          dominated: relaxedBudget.dominated,
        };
      }
    } catch {
      // 继续下一轮
    }

    // 第三轮: 放宽全部约束(新品+二手都看, 预算 5 倍)
    try {
      const allRelaxed = await compute({
        ...params,
        performanceFloor: 0,
        budget: params.budget * 5,
        buyTiming: 'used',
      });
      if (allRelaxed.frontier.length > 0) {
        return {
          hint: '已放宽全部约束',
          plans: this.formatPlans(allRelaxed.frontier, new Set()),
          frontier: allRelaxed.frontier,
          dominated: allRelaxed.dominated,
        };
      }
    } catch {
      // 全部失败
    }

    return { hint: '无法找到可行方案', plans: [], frontier: [], dominated: [] };
  },

  /** 将引擎 PlanPoint 转为展示用 PlanDisplayItem */
  formatPlans(frontier: PlanPoint[], recKeys: Set<string>): PlanDisplayItem[] {
    return frontier.map((p, i) => ({
      key: `${p.model}-${p.holdingYears}-${i}`,
      modelLabel: this.formatModelLabel(p.model),
      chip: p.chip,
      buyTiming: p.buyTiming,
      buyTimingLabel: p.buyTiming === 'new' ? '新品' : '二手',
      holdingYears: p.holdingYears,
      monthlyCost: Math.round(p.monthlyCost * 10) / 10,
      avgPerformancePct: Math.round(p.avgPerformance * 1000) / 10,
      buyPrice: Math.round(p.buyPrice),
      inRange: recKeys.has(`${p.model}-${p.holdingYears}`),
      raw: p,
    }));
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
