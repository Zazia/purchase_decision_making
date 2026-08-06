// pages/detail/detail.ts
// 方案详情页: 展示该方案的完整成本分解与性能满足度计算

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

Page({
  data: {
    plan: null as null | PlanPoint,
    modelLabel: '',
    buyTimingLabel: '',
    avgPerformancePct: 0,
    s0Pct: 0,
    snPct: 0,
    netCost: 0,
  },

  onLoad() {
    const app = getApp();
    const plan = app.globalData?.detailPlan as unknown as PlanPoint | null;

    if (!plan) {
      wx.showToast({ title: '方案数据缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const modelLabel = plan.model
      .replace(/\s*×\s*\d+年$/, '')
      .replace(/_/g, ' ');

    this.setData({
      plan,
      modelLabel,
      buyTimingLabel: plan.buyTiming === 'new' ? '新品' : '二手',
      avgPerformancePct: Math.round(plan.avgPerformance * 1000) / 10,
      s0Pct: Math.round(plan.performanceS0 * 1000) / 10,
      snPct: Math.round(plan.performanceSN * 1000) / 10,
      netCost: Math.round(plan.buyPrice - plan.residual + plan.maintenanceCost),
    });
  },
});
