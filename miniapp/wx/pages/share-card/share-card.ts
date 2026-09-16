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
  getSavedResult,
  type DecisionParams,
  type ReportData,
} from '../../services/saved-results';

import { buildUploadContent, prepareUpload, uploadRequest, CONSENT_VERSION, clone, type UploadContext, type UploadState } from '../../services/share-upload';

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
    uploadContext: null as UploadContext | null,
    uploadState: null as UploadState | null,
    isTest: false,
    generating: false,
    generationStatus: '',
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
      uploadContext?: UploadContext;
      savedId?: string;
      isTest?: boolean;
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
        uploadContext: clone(shareData.uploadContext ?? null),
        savedId: shareData.savedId || '',
        uploadState: shareData.savedId ? getSavedResult(shareData.savedId)?.uploadState ?? null : null,
        isTest: shareData.isTest === true || (!!shareData.savedId && getSavedResult(shareData.savedId)?.isTest === true),
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

  /** 根据展示开关保存云记录并生成图片，用途由协议和开关说明告知。 */
  async onGenerate() {
    if (this.data.generating) return;
    const comp = this.selectComponent('#card') as unknown as ShareCardCanvasComp | null;
    if (!comp || !this.data.reportData) {
      wx.showToast({ title: '组件或结果未就绪', icon: 'none' });
      return;
    }
    this.setData({ generating: true, generationStatus: '', renderFailed: false });
    let localSaved = false;
    let cloudStatus = '';
    let stage: 'prepare' | 'render' = 'prepare';
    try {
      const content = buildUploadContent(this.data.reportData, this.data.uploadContext, this.data.isTest);
      const state = prepareUpload(content, this.data.uploadState);
      this.setData({ uploadState: state });
      localSaved = !!this.trySaveResult();
      let qrcodeBase64 = '';
      if (this.data.showMyPlan) {
        if (state.consentVersion !== CONSENT_VERSION) {
          state.consentVersion = CONSENT_VERSION;
          this.setData({ uploadState: state });
          this.trySaveResult();
        }
        if (this.data.showMyPlan) {
          wx.showLoading({ title: '上传并生成中...', mask: true });
          try {
            if (!state.cloudId) {
              const response = await wx.cloud.callFunction({ name: 'share-result', data: uploadRequest(content, state) });
              const result = response.result as { ok?: boolean; id?: string; expireAt?: number; error?: string };
              if (!result?.ok || !result.id) {
                if (result?.error === 'expired') this.setData({ uploadState: null });
                throw new Error(result?.error === 'payload_too_large' ? '方案超过上传上限，仅本地保存' : '云端未成功，可重新生成重试');
              }
              state.cloudId = result.id;
              state.expireAt = result.expireAt;
              this.setData({ uploadState: state });
              this.trySaveResult();
            }
            const qr = await wx.cloud.callFunction({ name: 'share-result', data: { action: 'qrcode', id: state.cloudId } });
            const result = qr.result as { ok?: boolean; buffer?: string };
            if (!result?.ok || !result.buffer) throw new Error('二维码未生成');
            qrcodeBase64 = result.buffer;
            cloudStatus = '云端已保存';
          } catch (error) {
            cloudStatus = state.cloudId ? '云端已保存，二维码失败，可重新生成'
              : (error instanceof Error && error.message.includes('仅本地保存') ? error.message : '云端未成功，可重新生成重试');
          }
        }
      }
      stage = 'render';
      wx.showLoading({ title: '生成图片中...', mask: true });
      // 属性传到组件后再读取其加载Promise，避免等待旧的无码状态。
      await new Promise<void>(resolve => this.setData({ qrcodeBase64 }, resolve));
      await comp.whenQrcodeReady();
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      const tempFilePath = await comp.exportImage();
      const status = `${localSaved ? '本地已保存' : '本地缓存失败'}${cloudStatus ? '；' + cloudStatus : '；仅生成本地图片'}`;
      this.setData({ tempFilePath, generated: true, renderFailed: false, generationStatus: status });
      wx.hideLoading();
      wx.showModal({ title: '分享卡已生成', content: status, showCancel: false, confirmText: '知道了' });
    } catch (error) {
      const message = stage === 'render' ? '图片生成失败，可重试' : '生成准备失败，本次未上传，请重试';
      const uploadStatus = cloudStatus || (this.data.uploadState?.cloudId ? '云端已保存' : '');
      this.setData({ renderFailed: stage === 'render', generationStatus:
        `${localSaved ? '本地已保存' : '本地尚未保存'}；${uploadStatus ? uploadStatus + '；' : ''}${message}` });
      console.warn('[share-card] Generation failed:', stage,
        error instanceof Error ? error.message : (error as { errMsg?: string })?.errMsg || 'unknown');
      wx.showToast({ title: message, icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ generating: false });
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
      const payload = { params, reportData, headerTitle, lastUpdated,
        cloudId: this.data.uploadState?.cloudId ?? null, uploadContext: this.data.uploadContext, uploadState: this.data.uploadState, isTest: this.data.isTest };
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
      ? buildSharePath(this.data.params, this.data.showMyPlan ? this.data.uploadState?.cloudId : undefined)
      : `/pages/decision-tree/decision-tree?category=${this.data.category}&budget=${this.data.budget}`;
    return {
      title: '苹果购买决策分析 — 用数据帮你选',
      path,
      imageUrl: this.data.tempFilePath || undefined,
    };
  },
});
