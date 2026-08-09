// app.ts - 小程序入口

/**
 * 云开发环境 ID
 *
 * 替换为你的云环境 ID (微信开发者工具 → 云开发 → 设置 → 环境ID)
 * 未配置时云函数调用会失败, share-card 页会自动降级为文字模式 (只显小程序名)
 * result 页扫码入口会弹 modal 提示加载失败
 */
const CLOUD_ENV = 'cloud1-d7gb4dzhoaca5534d';

App({
  onLaunch() {
    // 初始化云开发 (云函数失败时小程序其他功能不受影响)
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: CLOUD_ENV,
          traceUser: true,
        });
      } catch (err) {
        console.warn('[app] wx.cloud.init failed (cloud features disabled):', err);
      }
    }
  },

  globalData: {
    // 决策树参数, 从 decision-tree 页传递到 result 页
    decisionParams: null as null | {
      category: string;
      budget: number;
      holdingYears: number[];
      buyTiming: 'new' | 'used' | 'both';
      performanceFloor: number;
    },
    // 详情页方案数据, 从 result 页传递到 detail 页
    detailPlan: null as unknown as Record<string, unknown> | null,
    // 分享卡数据, 从 result 页传递到 share-card 页
    shareCardData: null as unknown as Record<string, unknown> | null,
    // 端内报告页数据, 从 result 页传递到 report 页
    // 含: params(决策参数) + frontier + dominated + recommendationRange + performanceFloor + budget
    reportData: null as unknown as Record<string, unknown> | null,
    // 小程序名称 (分享卡底部文字显示; 小程序端无 API 自动获取自身名称,
    // 需在微信公众平台审核通过改名后手动同步此常量)
    appName: '帕累托买苹果',
  },
});
