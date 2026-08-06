// pages/share-card/share-card.ts
// 分享卡页: canvas 离屏渲染, 生成图片, 保存相册, 转发分享

import { getDataFreshness } from '../../engine-bridge/index';

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

const CATEGORY_LABELS: Record<string, string> = {
  'mac-mini': 'Mac mini',
  'macbook-air': 'MacBook Air',
  'macbook-pro': 'MacBook Pro',
  'iphone': 'iPhone',
  'ipad': 'iPad',
  'imac': 'iMac',
};

Page({
  data: {
    budget: 0,
    category: '',
    categoryLabel: '',
    topPlan: null as null | PlanPoint,
    frontier: [] as PlanPoint[],
    lastUpdated: '',
    tempFilePath: '',
    generated: false,
    renderFailed: false,
  },

  onLoad(query: Record<string, string>) {
    // 从 globalData 获取分享卡数据
    const app = getApp();
    const shareData = app.globalData?.shareCardData as unknown as {
      params: { category: string; budget: number };
      topPlan: PlanPoint;
      frontier: PlanPoint[];
    } | null;

    if (shareData) {
      const category = query.category || shareData.params.category || 'mac-mini';
      this.setData({
        budget: Number(query.budget) || shareData.params.budget || 0,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category,
        topPlan: shareData.topPlan,
        frontier: shareData.frontier || [],
      });
    } else {
      // 无数据兜底(直接打开此页)
      const category = query.category || 'mac-mini';
      const budget = Number(query.budget) || 5000;
      this.setData({
        budget,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category,
      });
    }

    this.loadFreshness();
  },

  /** 加载数据时效 */
  async loadFreshness() {
    try {
      const f = await getDataFreshness();
      this.setData({ lastUpdated: f.lastUpdated });
    } catch {
      // 忽略
    }
  },

  /** 生成分享卡: 调用组件导出图片 */
  async onGenerate() {
    const comp = this.selectComponent('#card') as unknown as {
      exportImage: () => Promise<string>;
      data: { renderFailed: boolean };
    } | null;

    if (!comp) {
      wx.showToast({ title: '组件未就绪', icon: 'none' });
      return;
    }

    // 检查组件是否渲染失败
    if (comp.data && comp.data.renderFailed) {
      this.setData({ renderFailed: true });
      wx.showToast({ title: '渲染失败，请截图', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '生成中...' });

    try {
      const tempFilePath = await comp.exportImage();
      this.setData({ tempFilePath, generated: true, renderFailed: false });
      wx.hideLoading();
      wx.showToast({ title: '生成成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('[share-card] Export failed:', err);
      this.setData({ renderFailed: true });
      wx.showToast({ title: '生成失败，请截图分享', icon: 'none' });
    }
  },

  /** 保存到相册 */
  onSaveToAlbum() {
    if (!this.data.tempFilePath) {
      wx.showToast({ title: '请先生成分享卡', icon: 'none' });
      return;
    }

    wx.saveImageToPhotosAlbum({
      filePath: this.data.tempFilePath,
      success: () => {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (err) => {
        // 用户拒绝授权
        if (err.errMsg.includes('auth deny') || err.errMsg.includes('authorize')) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存到相册需要授权，是否前往设置？',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting();
              }
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  /** 转发分享卡 */
  onShareAppMessage() {
    const params = this.data;
    const path = `/pages/decision-tree/decision-tree?category=${params.category}&budget=${params.budget}`;
    return {
      title: '苹果购买决策分析 — 用数据帮你选',
      path,
      imageUrl: this.data.tempFilePath || undefined,
    };
  },
});
