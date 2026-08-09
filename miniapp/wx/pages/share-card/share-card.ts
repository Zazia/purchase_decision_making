// pages/share-card/share-card.ts
// 分享卡页: canvas 离屏渲染, 生成图片, 保存相册, 转发分享
// 生成图片后自动缓存结果快照, 分享 path 携带完整决策参数
// 「展示我的方案」勾选时调云函数 share-result 拿云端 _id + 小程序码 base64,
// 回填本地快照 cloudId, 把 base64 传给 canvas 绘制小程序码
// 不勾选或云函数失败时降级为文字模式 (canvas 只显小程序名), 不阻断图片生成

import { getDataFreshness } from '../../engine-bridge/index';
import {
  saveResult,
  updateResult,
  buildSharePath,
  updateCloudId,
  type DecisionParams,
  type ReportData,
} from '../../services/saved-results';

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

interface ShareCardCanvasComp {
  exportImage: () => Promise<string>;
  whenQrcodeReady: () => Promise<void>;
  data: { renderFailed: boolean };
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
    params: null as null | DecisionParams,
    reportData: null as null | ReportData,
    headerTitle: '',
    savedId: '',
    /** 「展示我的方案」复选框 (默认勾选 → 调云函数生成小程序码) */
    showMyPlan: true,
    /** 小程序码 base64 (云函数返回; 空 → canvas 走文字模式) */
    qrcodeBase64: '',
    /** 小程序名称 (从 globalData 读取, 传给 canvas 组件) */
    appName: '帕累托买苹果',
  },

  onLoad(query: Record<string, string>) {
    // 从 globalData 获取分享卡数据
    const app = getApp();
    const appName = (app.globalData?.appName as string) || '帕累托买苹果';
    const shareData = app.globalData?.shareCardData as unknown as {
      params: DecisionParams;
      reportData: ReportData;
      headerTitle: string;
      topPlan: PlanPoint;
      frontier: PlanPoint[];
    } | null;

    if (shareData) {
      const category = query.category || shareData.params.category || 'mac-mini';
      this.setData({
        appName,
        budget: Number(query.budget) || shareData.params.budget || 0,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category,
        topPlan: shareData.topPlan,
        frontier: shareData.frontier || [],
        params: shareData.params,
        reportData: shareData.reportData || null,
        headerTitle: shareData.headerTitle || '',
      });
    } else {
      // 无数据兜底(直接打开此页)
      const category = query.category || 'mac-mini';
      const budget = Number(query.budget) || 5000;
      this.setData({
        appName,
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

  /** 「展示我的方案」复选框切换 */
  onToggleShowMyPlan(e: WechatMiniprogram.SwitchChange) {
    this.setData({ showMyPlan: !!e.detail.value });
  },

  /** 生成分享卡: 缓存 → (展示我的方案时) 调云函数拿小程序码 → 等图片加载 → 导出图片 → 提示 */
  async onGenerate() {
    const comp = this.selectComponent('#card') as unknown as ShareCardCanvasComp | null;

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

    wx.showLoading({ title: '生成中...', mask: true });

    try {
      // 1. 本地缓存 (无论 showMyPlan 与否)
      const localId = this.trySaveResult();

      // 2. showMyPlan 勾选 → 调云函数 save + qrcode 拿 cloudId + base64
      let qrcodeBase64 = '';
      if (this.data.showMyPlan && this.data.params) {
        try {
          const saveRes = await wx.cloud.callFunction({
            name: 'share-result',
            data: { action: 'save', params: this.data.params },
          });
          const cloudId = (saveRes.result as { id?: string } | undefined)?.id;
          if (cloudId && localId) {
            updateCloudId(localId, cloudId);
          }
          if (cloudId) {
            const qrRes = await wx.cloud.callFunction({
              name: 'share-result',
              data: { action: 'qrcode', id: cloudId },
            });
            qrcodeBase64 = (qrRes.result as { buffer?: string } | undefined)?.buffer || '';
          }
        } catch (err) {
          // 云函数失败降级: qrcodeBase64 留空 + toast, 不阻断图片生成
          console.warn('[share-card] Cloud function failed, fallback to text mode:', err);
          wx.showToast({ title: '小程序码生成失败, 仅显示小程序名', icon: 'none' });
          qrcodeBase64 = '';
        }
      }

      // 3. 把 qrcodeBase64 传给 canvas, 等待图片加载完成 (失败时 whenQrcodeReady 立即 resolve)
      this.setData({ qrcodeBase64 });
      await comp.whenQrcodeReady();
      // 给 canvas redraw 留一个 tick, 确保图片绘制完成后再导出
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // 4. 导出图片
      const tempFilePath = await comp.exportImage();
      this.setData({ tempFilePath, generated: true, renderFailed: false });
      wx.hideLoading();
      wx.showToast({ title: '生成成功', icon: 'success' });

      // 5. 提示用户转发可保存结果
      wx.showModal({
        title: '分享卡已生成',
        content: '转发分享卡即可保存结果，对方也能用同样的参数查看方案',
        showCancel: false,
        confirmText: '知道了',
      });
    } catch (err) {
      wx.hideLoading();
      console.error('[share-card] Export failed:', err);
      this.setData({ renderFailed: true });
      wx.showToast({ title: '生成失败，请截图分享', icon: 'none' });
    }
  },

  /**
   * 缓存结果快照 (失败不阻断, 仅 toast), 返回 localId 或空字符串
   * 重新生成时: 已有 savedId → 原地覆盖更新 (避免重复保存); 否则新建
   */
  trySaveResult(): string {
    const { params, reportData, headerTitle, lastUpdated, savedId } = this.data;
    if (!params || !reportData) return '';

    try {
      const payload = { params, reportData, headerTitle, lastUpdated, cloudId: null };
      const id = savedId ? updateResult(savedId, payload) : saveResult(payload);
      this.setData({ savedId: id });
      return id;
    } catch (err) {
      console.warn('[share-card] Save result failed:', err);
      wx.showToast({ title: '结果缓存失败, 不影响分享', icon: 'none' });
      return '';
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

  /** 转发分享卡 (path 携带完整决策参数) */
  onShareAppMessage() {
    const path = this.data.params
      ? buildSharePath(this.data.params)
      : `/pages/decision-tree/decision-tree?category=${this.data.category}&budget=${this.data.budget}`;
    return {
      title: '苹果购买决策分析 — 用数据帮你选',
      path,
      imageUrl: this.data.tempFilePath || undefined,
    };
  },
});
