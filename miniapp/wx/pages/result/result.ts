// pages/result/result.ts
// 结果页: 调用引擎计算帕累托前沿, 结论先行展示方案列表 + 图表 + 数据时效

import { compute, getDataFreshness, getKnownChips, recomputeFromEditedPlans } from '../../engine-bridge/index';
import { exportLongImage } from '../../services/long-image-export';
import { getSavedResult, saveResult, sortPreferredPlans } from '../../services/saved-results';
import { EditorState } from '../../services/scheme-editor-state';
import type { EditedPlanPoint, EditorSnapshot } from '../../services/scheme-editor-state';

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

interface DecisionParams {
  category: string;
  budget: number;
  buyTiming: 'new' | 'used' | 'both';
  performanceFloor: number;
  holdingYears: number[];
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

const CATEGORY_LABELS: Record<string, string> = {
  'mac-mini': 'Mac mini',
  'macbook-air': 'MacBook Air',
  'macbook-pro': 'MacBook Pro',
  'iphone': 'iPhone',
  'ipad': 'iPad',
  'imac': 'iMac',
};

/** 编辑器状态实例 (进入编辑模式时创建, 退出时丢弃; draft 持久化在 storage) */
let editorState: EditorState | null = null;

Page({
  data: {
    loading: true,
    loadingHint: '正在计算帕累托前沿...',
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
    // 回看模式: 从保存结果进入时直接渲染快照, 不重算
    isReplay: false,
    savedId: '',
    // 编辑模式状态 (manual-scheme-editor)
    // editorMode: 'view'=查看模式, 'edit'=编辑模式
    editorMode: 'view' as 'view' | 'edit',
    // 原始引擎结果快照 (用于 viewMode='original' 切换查看)
    original: null as null | {
      frontier: PlanPoint[];
      dominated: PlanPoint[];
      recommendationRange: { lowerCost: number; upperCost: number; plans: PlanPoint[] } | null;
    },
    // 用户修改版结果 (重算后写入, viewMode='userModified' 时使用)
    userModified: null as null | {
      frontier: PlanPoint[];
      dominated: PlanPoint[];
      recommendationRange: { lowerCost: number; upperCost: number; plans: PlanPoint[] } | null;
    },
    // 当前视图模式: 'original'=原始版, 'userModified'=用户修改版
    viewMode: 'original' as 'original' | 'userModified',
    // 编辑器当前快照 (编辑模式表格渲染用)
    editorSnapshot: null as null | EditorSnapshot,
    // 是否可撤销
    canUndo: false,
    // 编辑器: 主列表方案 (非暂不考虑的, 含已排除)
    editorMainPoints: [] as EditedPlanPoint[],
    // 编辑器: 暂不考虑分组方案
    editorDeferredPoints: [] as EditedPlanPoint[],
    // 编辑器: 渠道选项
    editorChannels: ['快照价', '闲鱼', '转转', '京东国补', '官方旗舰店', '其他'],
    // 编辑器: 已知芯片列表 (新增自定义方案用)
    editorKnownChips: [] as string[],
    // 编辑器: 是否显示新增方案表单
    editorShowAddForm: false,
    // 编辑器: 新增方案表单数据
    editorAddForm: {
      model: '',
      chip: '',
      memoryGb: 8,
      storageGb: 256,
      buyTiming: 'used' as 'new' | 'used',
      buyPrice: 0,
      holdingYears: 3,
    },
    // 编辑器: 买入价校验错误 (rowId -> 错误消息)
    editorPriceErrors: {} as Record<string, string>,
  },

  onLoad(query: Record<string, string>) {
    // 回看模式: 从本地缓存读取已保存结果, 直接渲染不重算(用户可从结果页进入完整报告)
    if (query.savedId) {
      this.enterReplayMode(query.savedId);
      return;
    }
    // 扫码场景: query.scene 是云端 _id (URL encoded), 走云函数拉 params
    if (query.scene) {
      const cloudId = decodeURIComponent(query.scene);
      this.loadFromCloud(cloudId);
      this.loadFreshness();
      return;
    }
    // 转发场景: query 直接带 category/budget/..., 走 parseQuery 重算
    const params = this.parseQuery(query);
    this.setData({ params, performanceFloor: params.performanceFloor, budget: params.budget });
    this.loadResult(params);
    this.loadFreshness();
  },

  /**
   * 扫码场景: 调云函数 share-result 的 get action 拉 params, 再走重算流程
   * 失败 (过期/不存在/网络错) → modal 提示 + 返回上一页或首页
   */
  async loadFromCloud(cloudId: string) {
    this.setData({ loading: true, loadingHint: '正在加载方案...', error: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'share-result',
        data: { action: 'get', id: cloudId },
      });
      const result = res.result as
        | { ok?: boolean; error?: string; params?: DecisionParams }
        | undefined;

      // 过期或不存在
      if (!result || !result.ok || !result.params) {
        const isExpired = result?.error === 'expired';
        wx.showModal({
          title: isExpired ? '方案已过期' : '方案不存在',
          content: isExpired
            ? '该分享已超过 30 天, 无法查看'
            : '该分享记录可能已被清理, 请让对方重新生成分享',
          showCancel: false,
        });
        this.navigateOut();
        return;
      }

      // 成功 → 用 params 走现有重算流程
      const params = result.params;
      this.setData({
        params,
        performanceFloor: params.performanceFloor,
        budget: params.budget,
        loadingHint: '正在计算帕累托前沿...',
      });
      this.loadResult(params);
    } catch (err) {
      console.error('[result] loadFromCloud failed:', err);
      wx.showModal({
        title: '加载失败',
        content: '请检查网络后重试',
        showCancel: false,
      });
      this.navigateOut();
    }
  },

  /** 返回上一页; 无上一页时 reLaunch 到首页 (decision-tree) */
  navigateOut() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/decision-tree/decision-tree' });
    }
  },

  /** 回看模式: 从本地缓存读取已保存结果快照, 直接渲染不重算 */
  enterReplayMode(savedId: string) {
    const saved = getSavedResult(savedId);
    if (!saved) {
      wx.showModal({
        title: '结果不存在',
        content: '该保存结果可能已被删除，请返回列表查看其他结果',
        showCancel: false,
        confirmText: '返回',
        success: () => this.navigateOut(),
      });
      return;
    }

    const { params, reportData, lastUpdated } = saved;
    const frontier = reportData.frontier || [];
    const dominated = reportData.dominated || [];
    const recRange = reportData.recommendationRange;
    const recKeys = new Set(
      (recRange?.plans ?? []).map((p) => `${p.model}-${p.holdingYears}`),
    );

    this.setData({
      loading: false,
      isEmpty: frontier.length === 0,
      relaxedHint: frontier.length === 0 ? '保存时无可行方案' : '',
      plans: this.formatPlans(frontier, recKeys),
      frontier,
      dominated,
      recommendationRange: recRange,
      params,
      performanceFloor: params.performanceFloor,
      budget: params.budget,
      isReplay: true,
      savedId,
      lastUpdated,
      freshnessLevel: 'fresh',
      // 保存原始快照供 viewMode 切换 (manual-scheme-editor)
      original: { frontier, dominated, recommendationRange: recRange },
      userModified: null,
      viewMode: 'original',
    });
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
        // 保存原始快照供 viewMode 切换 (manual-scheme-editor)
        original: {
          frontier: result.frontier,
          dominated: result.dominated,
          recommendationRange: recRange,
        },
        userModified: null,
        viewMode: 'original',
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
            frontier: relaxed.frontier as PlanPoint[],
            dominated: relaxed.dominated as PlanPoint[],
            recommendationRange: recRange as { lowerCost: number; upperCost: number; plans: PlanPoint[] },
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
        frontier: lastRelaxed.frontier as PlanPoint[],
        dominated: lastRelaxed.dominated as PlanPoint[],
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
    // viewMode='userModified' 时把用户修改版数据写入 reportData, 并标注「基于用户输入价」
    const source = this.data.viewMode === 'userModified' && this.data.userModified
      ? this.data.userModified
      : { frontier: this.data.frontier, dominated: this.data.dominated, recommendationRange: this.data.recommendationRange };
    const app = getApp();
    if (app.globalData) {
      app.globalData.reportData = {
        params,
        frontier: source.frontier,
        dominated: source.dominated,
        recommendationRange: source.recommendationRange,
        performanceFloor: params.performanceFloor,
        budget: params.budget,
        // 标注来源: 用户修改版时 report 页顶部渲染「基于用户输入价」
        isUserModified: this.data.viewMode === 'userModified',
      } as unknown as Record<string, unknown>;
    }
    // 回看模式带 savedId, 让 report 页复用同一份保存快照(含保存时数据日期)
    const url = this.data.isReplay
      ? `/pages/report/report?savedId=${this.data.savedId}`
      : '/pages/report/report';
    wx.navigateTo({ url });
  },

  // ==========================================================================
  // 编辑模式 (manual-scheme-editor)
  // ==========================================================================

  /** 进入编辑模式: 从 scheme-editor-state 初始化编辑态 (优先加载已有 draft) */
  async onEnterEditor() {
    const params = this.data.params;
    const original = this.data.original;
    if (!params || !original) return;

    // 创建 EditorState 实例
    editorState = new EditorState();
    const snapshot = editorState.initFromPlans(
      original.frontier as Array<Omit<EditedPlanPoint, 'source' | 'rowId'>>,
      original.dominated as Array<Omit<EditedPlanPoint, 'source' | 'rowId'>>,
      params,
      this.data.isReplay ? this.data.savedId : undefined,
    );

    // 若来自 draft (非新建), 提示用户已恢复
    const isRestored = snapshot.points.some(
      (p) => p.source !== 'original' || p.excluded || p.deferred,
    );
    if (isRestored) {
      wx.showToast({ title: '已恢复上次编辑', icon: 'none', duration: 2000 });
    }

    // 加载已知芯片列表 (新增自定义方案用)
    let knownChips: string[] = [];
    try {
      knownChips = await getKnownChips();
    } catch {
      // 加载失败不阻断编辑
    }

    this.setData({
      editorMode: 'edit',
      editorSnapshot: snapshot,
      editorKnownChips: knownChips,
      editorShowAddForm: false,
      editorPriceErrors: {},
    });
    this.updateEditorView(snapshot);
  },

  /** 退出编辑模式: 保持 draft 不清 (用户下次进入仍可恢复) */
  onExitEditor() {
    this.setData({
      editorMode: 'view',
      editorSnapshot: null,
      canUndo: false,
      editorMainPoints: [],
      editorDeferredPoints: [],
      editorShowAddForm: false,
      editorPriceErrors: {},
    });
    // 不调用 editorState.reset() 也不 clearDraft, 让 draft 保留供下次恢复
    // editorState 实例丢弃 (模块级变量置 null), draft 已在 storage 中
    editorState = null;
  },

  /** 从 snapshot 更新编辑器视图 (主列表 + 暂不考虑分组 + 撤销状态) */
  updateEditorView(snapshot: EditorSnapshot) {
    const mainPoints = snapshot.points.filter((p) => !p.deferred);
    const deferredPoints = snapshot.points.filter((p) => p.deferred);
    this.setData({
      editorSnapshot: snapshot,
      editorMainPoints: mainPoints,
      editorDeferredPoints: deferredPoints,
      canUndo: editorState?.canUndo() ?? false,
    });
  },

  /** 从 model 解析内存 GB (用于批量排除) */
  extractMemoryGbFromModel(model: string): number {
    const m = model.match(/(\d+)G_(\d+)G/);
    if (m) return Number(m[1]);
    return 8;
  },

  /** 创建当前快照的深拷贝 (用于编辑后 push) */
  cloneSnapshot(): EditorSnapshot | null {
    const snap = editorState?.current;
    if (!snap) return null;
    return {
      points: snap.points.map((p) => ({ ...p })),
      deferredRowIds: [...snap.deferredRowIds],
      updatedAt: Date.now(),
    };
  },

  /** 买入价输入: 校验 > 0, 标记 source='edited' */
  onEditorPriceChange(e: WechatMiniprogram.Input) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const raw = e.detail.value;
    const price = Number(raw);
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    const errors = { ...this.data.editorPriceErrors };

    // 校验: 必须是 > 0 的数字
    if (raw === '' || isNaN(price) || price <= 0) {
      errors[rowId] = '买入价需大于 0';
      // 标记为不参与重算 (excluded)
      point.excluded = true;
    } else {
      delete errors[rowId];
      point.editedBuyPrice = price;
      point.excluded = false;
      if (point.source === 'original') point.source = 'edited';
    }

    editorState?.push(snap);
    this.setData({ editorPriceErrors: errors });
    this.updateEditorView(snap);
  },

  /** 渠道 picker 变更 */
  onEditorChannelChange(e: WechatMiniprogram.CustomEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const idx = Number(e.detail.value);
    const channel = this.data.editorChannels[idx];
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    // 「快照价」表示未修改渠道
    if (channel === '快照价') {
      point.channel = undefined;
    } else {
      point.channel = channel;
    }
    // 京东国补 + 国补 → useSubsidy=true (默认勾选)
    if (channel === '京东国补') {
      point.useSubsidy = true;
    }

    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 切换「是否使用国补」 */
  onEditorSubsidyToggle(e: WechatMiniprogram.TouchEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    point.useSubsidy = !point.useSubsidy;
    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 单行排除 checkbox 切换 */
  onEditorExcludeToggle(e: WechatMiniprogram.TouchEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    point.excluded = !point.excluded;
    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 批量排除: 按 8G 内存 / 持有期 > 3 年 */
  onEditorBatchExclude(e: WechatMiniprogram.TouchEvent) {
    const action = e.currentTarget.dataset.action as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;

    for (const p of snap.points) {
      if (p.deferred) continue;
      if (action === 'exclude8G') {
        const memGb = p.memoryGb ?? this.extractMemoryGbFromModel(p.model);
        if (memGb === 8) p.excluded = true;
      } else if (action === 'excludeLongHold') {
        if (p.holdingYears > 3) p.excluded = true;
      }
    }

    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 移入暂不考虑 */
  onEditorDefer(e: WechatMiniprogram.TouchEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    point.deferred = true;
    if (!snap.deferredRowIds.includes(rowId)) {
      snap.deferredRowIds.push(rowId);
    }
    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 从暂不考虑恢复到主列表 */
  onEditorRestore(e: WechatMiniprogram.TouchEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    point.deferred = false;
    snap.deferredRowIds = snap.deferredRowIds.filter((id) => id !== rowId);
    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 删除自定义方案 (仅 source='custom' 可删除) */
  onEditorDeletePlan(e: WechatMiniprogram.TouchEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;

    snap.points = snap.points.filter((p) => p.rowId !== rowId);
    snap.deferredRowIds = snap.deferredRowIds.filter((id) => id !== rowId);
    editorState?.push(snap);
    this.updateEditorView(snap);
  },

  /** 撤销 */
  onEditorUndo() {
    if (!editorState?.canUndo()) return;
    const snap = editorState.undo();
    if (snap) {
      this.setData({ editorPriceErrors: {} });
      this.updateEditorView(snap);
    }
  },

  /** 显示新增自定义方案表单 */
  onEditorShowAddForm() {
    this.setData({
      editorShowAddForm: true,
      editorAddForm: {
        model: '',
        chip: '',
        memoryGb: 8,
        storageGb: 256,
        buyTiming: 'used' as 'new' | 'used',
        buyPrice: 0,
        holdingYears: 3,
      },
    });
  },

  /** 取消新增表单 */
  onEditorCancelAddForm() {
    this.setData({ editorShowAddForm: false });
  },

  /** 新增表单字段变更 */
  onEditorAddFormField(e: WechatMiniprogram.Input | WechatMiniprogram.Picker) {
    const field = e.currentTarget.dataset.field as string;
    const form = { ...this.data.editorAddForm };
    if (field === 'buyTiming') {
      form.buyTiming = Number(e.detail.value) === 0 ? 'new' : 'used';
    } else if (field === 'chip') {
      form.chip = this.data.editorKnownChips[Number((e as WechatMiniprogram.Picker).detail.value)] || '';
    } else if (field === 'model') {
      form.model = (e as WechatMiniprogram.Input).detail.value;
    } else {
      (form as Record<string, unknown>)[field] = Number((e as WechatMiniprogram.Input).detail.value);
    }
    this.setData({ editorAddForm: form });
  },

  /** 确认新增自定义方案 */
  onEditorAddPlan() {
    const form = this.data.editorAddForm;
    if (!form.chip) {
      wx.showToast({ title: '请选择芯片', icon: 'none' });
      return;
    }
    if (!form.model.trim()) {
      wx.showToast({ title: '请输入机型名', icon: 'none' });
      return;
    }
    if (!(form.buyPrice > 0)) {
      wx.showToast({ title: '买入价需大于 0', icon: 'none' });
      return;
    }

    const snap = this.cloneSnapshot();
    if (!snap) return;

    const newPoint: EditedPlanPoint = {
      model: `${form.model}_${form.buyTiming === 'new' ? '新品' : '二手'} × ${form.holdingYears}年`,
      chip: form.chip,
      buyTiming: form.buyTiming,
      holdingYears: form.holdingYears,
      monthlyCost: 0, // 引擎重算时计算
      avgPerformance: 0,
      buyPrice: form.buyPrice,
      residual: 0,
      maintenanceCost: 0,
      holdingMonths: form.holdingYears * 12,
      performanceS0: 0,
      performanceSN: 0,
      source: 'custom',
      rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      memoryGb: form.memoryGb,
      storageGb: form.storageGb,
      channel: form.buyTiming === 'new' ? '官方旗舰店' : '闲鱼',
    };

    snap.points.push(newPoint);
    editorState?.push(snap);
    this.setData({ editorShowAddForm: false });
    this.updateEditorView(snap);
  },

  /** 导出长图 */
  async onEditorExport() {
    const params = this.data.params;
    const snap = editorState?.current;
    if (!params || !snap) return;

    let qrcodeBase64 = '';
    try {
      const saveRes = await wx.cloud.callFunction({
        name: 'share-result',
        data: { action: 'save', params },
      });
      const cloudId = (saveRes.result as any)?.id;
      if (cloudId) {
        const qrRes = await wx.cloud.callFunction({
          name: 'share-result',
          data: { action: 'qrcode', id: cloudId },
        });
        qrcodeBase64 = (qrRes.result as any)?.buffer || '';
      }
    } catch (e) {
      console.warn('Failed to get qrcode', e);
    }

    const categoryLabel = CATEGORY_LABELS[params.category] || params.category;
    
    try {
      const app = getApp();
      const tempPath = await exportLongImage({
        title: `${categoryLabel} 购买决策分析`,
        subtitle: `基于用户输入价 · ${new Date().toISOString().split('T')[0]}`,
        paramsSummary: `预算 ${params.budget}元 · 性能地板 ${Math.round(params.performanceFloor * 100)}%`,
        points: snap.points,
        qrcodeBase64,
        appName: (app.globalData?.appName as string) || '帕累托买苹果',
        lastUpdated: this.data.lastUpdated
      });
      
      this.setData({ tempFilePath: tempPath });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
      this.checkPriceIntakePrompt();
    } catch (e) {
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },

  /** 重新生成: 按用户修改的数据重算帕累托前沿 */
  async onEditorRecompute() {
    const params = this.data.params;
    const snap = editorState?.current;
    if (!params || !snap) return;

    // 收集未排除、未暂不考虑的点
    const validPoints = snap.points.filter((p) => !p.excluded && !p.deferred);
    if (validPoints.length === 0) {
      wx.showToast({ title: '当前没有可重算的方案，请恢复或新增至少一个方案', icon: 'none' });
      return;
    }

    try {
      wx.showLoading({ title: '正在计算...' });
      const result = await recomputeFromEditedPlans(params, validPoints);
      
      const userModified = {
        frontier: result.frontier as PlanPoint[],
        dominated: result.dominated as PlanPoint[],
        recommendationRange: result.recommendationRange as { lowerCost: number; upperCost: number; plans: PlanPoint[] } | null,
      };

      const recRange = userModified.recommendationRange;
      const recKeys = new Set(
        (recRange?.plans ?? []).map((p) => `${p.model}-${p.holdingYears}`),
      );

      this.setData({
        userModified,
        viewMode: 'userModified',
        frontier: userModified.frontier,
        dominated: userModified.dominated,
        recommendationRange: userModified.recommendationRange,
        plans: this.formatPlans(userModified.frontier, recKeys),
        editorMode: 'view',
      });
      
      this.checkPriceIntakePrompt();
    } catch (err) {
      wx.showToast({
        title: err instanceof Error ? err.message : '计算失败',
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  /** 弹窗提示上传方案 */
  async checkPriceIntakePrompt() {
    if (wx.getStorageSync('skip_price_intake')) return;

    const res = await wx.showModal({
      title: '帮助修正预测',
      content: '将你的方案上传到云端，帮助修正我们的预测——越多人使用并分享成交价，预测越准',
      confirmText: '同意上传',
      cancelText: '暂不上传'
    });

    if (res.confirm) {
      await this.uploadPriceIntake();
    } else {
      wx.setStorageSync('skip_price_intake', true);
      wx.showToast({ title: '不再自动弹出，可从编辑器手动触发上传', icon: 'none' });
    }
  },

  /** 上传用户修改方案 */
  async uploadPriceIntake() {
    const params = this.data.params;
    const snap = editorState?.current;
    if (!params || !snap) return;

    const validPoints = snap.points.filter((p) => !p.excluded && !p.deferred);
    if (validPoints.length === 0) {
      wx.showToast({ title: '没有可上传的方案', icon: 'none' });
      return;
    }
    const originalPlans = this.data.original?.frontier || [];

    wx.showLoading({ title: '上传中...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'price-intake',
        data: {
          action: 'submit',
          submittedPlans: validPoints,
          originalPlans,
          params
        }
      });
      
      wx.hideLoading();
      const result = res.result as any;
      
      if (result && result.ok) {
        wx.showModal({
          title: '上传成功',
          content: '谢谢你的分享，你的成交价会让下一份预测更准',
          showCancel: false,
          confirmText: '不客气'
        });
      } else {
        throw new Error(result?.error || '上传失败');
      }
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '上传失败',
        content: '上传失败，可稍后重试',
        showCancel: false
      });
    }
  },

  /** 切换视图模式: 'original' ↔ 'userModified' */
  onSwitchViewMode(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as 'original' | 'userModified';
    if (mode === this.data.viewMode) return;
    if (mode === 'userModified' && !this.data.userModified) return;

    const source = mode === 'userModified' && this.data.userModified
      ? this.data.userModified
      : this.data.original;
    if (!source) return;

    const recRange = source.recommendationRange;
    const recKeys = new Set(
      (recRange?.plans ?? []).map((p) => `${p.model}-${p.holdingYears}`),
    );
    this.setData({
      viewMode: mode,
      frontier: source.frontier,
      dominated: source.dominated,
      recommendationRange: recRange,
      plans: this.formatPlans(source.frontier, recKeys),
    });
  },

  /** 保存用户修改版: 生成独立 id 快照, headerTitle 标注「用户修改版」, 不覆盖原快照 */
  onSaveUserModified() {
    const params = this.data.params;
    const userModified = this.data.userModified;
    if (!params || !userModified) {
      wx.showToast({ title: '请先重新生成方案', icon: 'none' });
      return;
    }

    const categoryLabel = CATEGORY_LABELS[params.category] || params.category;
    const headerTitle = `${categoryLabel} 购买决策分析 · 用户修改版`;
    const reportData = {
      params,
      frontier: userModified.frontier,
      dominated: userModified.dominated,
      recommendationRange: userModified.recommendationRange,
      performanceFloor: params.performanceFloor,
      budget: params.budget,
    };

    try {
      const id = saveResult({
        params,
        reportData,
        headerTitle,
        lastUpdated: this.data.lastUpdated,
        cloudId: null,
      });
      wx.showToast({ title: '已保存用户修改版', icon: 'success' });
      // 不覆盖原快照: 不更新当前 savedId, 用户修改版作为独立条目出现在列表
      console.log('[result] user-modified snapshot saved:', id);
    } catch (err) {
      wx.showModal({
        title: '保存失败',
        content: err instanceof Error ? err.message : '请清理存储后重试',
        showCancel: false,
      });
    }
  },

  /** 重试 */
  onRetry() {
    if (this.data.params) {
      this.loadResult(this.data.params);
    }
  },

  /** 生成分享卡 → 跳转分享卡页, 组装完整 reportData 存 globalData */
  onGenerateShareCard() {
    const params = this.data.params;
    if (!params || this.data.plans.length === 0) return;

    // 取最接近性能地板的方案作为分享卡主推(与完整报告 🥇 首选一致)
    const recPlans = (this.data.recommendationRange?.plans ?? []) as PlanPoint[];
    const pool: PlanPoint[] = recPlans.length > 0 ? recPlans : (this.data.frontier as PlanPoint[]);
    const topPlanRaw = sortPreferredPlans(pool, params.performanceFloor)[0] ?? this.data.plans[0]?.raw ?? null;
    const categoryLabel = CATEGORY_LABELS[params.category] || params.category;
    const headerTitle = `${categoryLabel} 购买决策分析`;

    // 组装完整 reportData (供 share-card 页缓存 + report 页回看)
    const reportData = {
      params,
      frontier: this.data.frontier,
      dominated: this.data.dominated,
      recommendationRange: this.data.recommendationRange,
      performanceFloor: params.performanceFloor,
      budget: params.budget,
    };

    const app = getApp();
    if (app.globalData) {
      app.globalData.shareCardData = {
        params,
        reportData,
        headerTitle,
        topPlan: topPlanRaw,
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
