// pages/detail/detail.ts
// 方案详情页: 展示该方案的完整成本分解与性能满足度计算
// v3.8 扩展: 候选类型 / 等待月数 / 预测价标注 / 系统支持期风险

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

Page({
  data: {
    plan: null as null | PlanPoint,
    modelLabel: '',
    buyTimingLabel: '',
    monthlyCost: 0,
    avgPerformancePct: 0,
    s0Pct: 0,
    snPct: 0,
    netCost: 0,
    /** 候选类型说明文案 (空=类型A 不显示) */
    candidateTypeLabel: '',
    /** 等待月数 (0 表示非等待方案, 不显示卡片) */
    waitMonths: 0,
    /** 买入价是否为预测值 */
    predictedPrice: false,
    /** 系统支持期风险文案 (空=normal 不显示) */
    supportRiskLabel: '',
    /** 系统支持期风险等级 (用于样式) */
    supportRiskLevel: '' as '' | 'near-end' | 'exceeded',
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

    // 候选类型说明
    let candidateTypeLabel = '';
    if (plan.candidateType === 'B') {
      candidateTypeLabel = '等新品发布后买入新品';
    } else if (plan.candidateType === 'C') {
      candidateTypeLabel = '等新品发布后买入降价老款';
    }

    // 系统支持期风险标注
    let supportRiskLabel = '';
    let supportRiskLevel: '' | 'near-end' | 'exceeded' = '';
    if (plan.systemSupportRisk === 'exceeded') {
      const m = plan.systemSupportExceedMonths ?? 0;
      supportRiskLabel = `持有期末超出系统支持期 ${m} 月`;
      supportRiskLevel = 'exceeded';
    } else if (plan.systemSupportRisk === 'near-end') {
      supportRiskLabel = '持有期接近系统支持期尾声';
      supportRiskLevel = 'near-end';
    }

    this.setData({
      plan,
      modelLabel,
      buyTimingLabel: plan.buyTiming === 'new' ? '新品' : '二手',
      avgPerformancePct: Math.round(plan.avgPerformance * 1000) / 10,
      s0Pct: Math.round(plan.performanceS0 * 1000) / 10,
      snPct: Math.round(plan.performanceSN * 1000) / 10,
      netCost: Math.round(plan.buyPrice - plan.residual + plan.maintenanceCost),
      monthlyCost: Math.round(plan.monthlyCost * 100) / 100,
      candidateTypeLabel,
      waitMonths: plan.waitMonths ?? 0,
      predictedPrice: !!plan.predictedPrice,
      supportRiskLabel,
      supportRiskLevel,
    });
  },

  /** 点击「价格不对？去修改」: 记录目标方案并返回结果页, 由结果页进入编辑器并定位 */
  onEditPrice() {
    const plan = this.data.plan;
    if (!plan) return;

    const app = getApp();
    // 与 result 页 getGroupKey 同款逻辑: 去掉「 × Ny年」后缀作为分组匹配键
    const baseModel = plan.model.replace(/\s*×\s*[\d.]+年$/, '');
    if (app.globalData) {
      app.globalData.pendingEditorFocus = {
        baseModel,
        buyTiming: plan.buyTiming,
      } as unknown as Record<string, unknown>;
    }
    this.backToResult();
  },

  /** 返回结果页 (detail 可能从 result 或 report 进入, 需定位到栈中的 result 页) */
  backToResult() {
    const pages = getCurrentPages();
    let delta = 1;
    for (let i = pages.length - 2; i >= 0; i--) {
      if (pages[i].route === 'pages/result/result') {
        delta = pages.length - 1 - i;
        break;
      }
    }
    wx.navigateBack({ delta });
  },
});
