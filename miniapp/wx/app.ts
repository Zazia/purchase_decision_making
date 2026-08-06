// app.ts - 小程序入口
App({
  globalData: {
    // 决策树参数, 从 decision-tree 页传递到 result 页
    decisionParams: null as null | {
      category: string;
      budget: number;
      holdingYears: number[];
      buyTiming: 'new' | 'used';
      performanceFloor: number;
    },
    // 详情页方案数据, 从 result 页传递到 detail 页
    detailPlan: null as unknown as Record<string, unknown> | null,
    // 分享卡数据, 从 result 页传递到 share-card 页
    shareCardData: null as unknown as Record<string, unknown> | null,
  },
});
