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

/** 自动保存弱提示定时器 */
let autoSaveTipTimer: ReturnType<typeof setTimeout> | null = null;

/** 复制动画定时器 */
let animateTipTimer: ReturnType<typeof setTimeout> | null = null;

/** 新增/编辑自定义方案表单数据 */
interface EditorAddFormState {
  model: string;
  chip: string;
  memoryGb: number;
  storageGb: number;
  buyTiming: 'new' | 'used';
  buyPrice: number;
  /** 勾选的持有期 (可多选) */
  holdingYearsList: number[];
}

/** 持有期多选基础选项 (与决策树页持有期选项一致) */
const BASE_HOLDING_OPTIONS = [1, 1.5, 2, 3, 4, 5];

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
    // 编辑器: 主列表方案分组 (按 model+buyTiming 合并, 持有期多选)
    editorDisplayGroups: [] as Array<Record<string, unknown>>,
    // 编辑器: 暂不考虑分组 (整组 deferred)
    editorDeferredGroups: [] as Array<Record<string, unknown>>,
    // 编辑器: 渠道选项
    editorChannels: ['快照价', '官网', '京东', '拼多多', '淘宝', '闲鱼', '拍拍', '爱回收', '转转', '其他'],
    // 编辑器: 已知芯片列表 (新增自定义方案用)
    editorKnownChips: [] as string[],
    // 编辑器: 是否显示新增方案表单
    editorShowAddForm: false,
    // 编辑器: 表单模式 'add'=新增 'edit'=编辑已有自添加方案组
    editorAddFormMode: 'add' as 'add' | 'edit',
    // 编辑器: 编辑模式下的目标分组 key ('' = 非编辑模式)
    editorEditingGroupKey: '',
    // 编辑器: 持有期多选 chips (预计算 active 态, WXML 不支持方法调用)
    editorHoldingChips: [] as Array<{ years: number; label: string; active: boolean }>,
    // 编辑器: 新增/编辑方案表单数据
    editorAddForm: {
      model: '',
      chip: '',
      memoryGb: 8,
      storageGb: 256,
      buyTiming: 'used' as 'new' | 'used',
      buyPrice: 0,
      holdingYearsList: [3] as number[],
    } as EditorAddFormState,
    // 编辑器: 买入价校验错误 (rowId -> 错误消息)
    editorPriceErrors: {} as Record<string, string>,
    // 条件筛选面板
    filterExpanded: false,
    filterChips: [] as Array<{value: string; label: string; active: boolean}>,
    filterMemory: [] as Array<{value: string; label: string; active: boolean}>,
    filterStorage: [] as Array<{value: string; label: string; active: boolean}>,
    filterHolding: [] as Array<{value: string; label: string; state: string; active: boolean}>,
    filterTiming: [] as Array<{value: string; label: string; active: boolean}>,
    filterFrontierState: [] as Array<{value: string; label: string; active: boolean}>,
    // 自动保存弱提示 (task 3.5)
    autoSaveTipVisible: false,
    // 是否有未提交编辑 (task 3.6 拦截退出用)
    hasEdits: false,
    // 当前展开的持有期多选菜单 groupKey ('' = 无)
    openHoldingMenuKey: '',
    // 复制后高亮动画的 groupKey ('' = 无动画)
    animateGroupKey: '',
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

  /** 从详情页「价格不对？去修改」返回时, 消费定位标记并进入编辑器定位到目标方案 */
  onShow() {
    const app = getApp();
    const focus = app.globalData?.pendingEditorFocus as
      | { baseModel: string; buyTiming: 'new' | 'used' }
      | null
      | undefined;
    if (!focus) return;
    if (app.globalData) app.globalData.pendingEditorFocus = null;
    this.focusEditorOnPlan(focus.baseModel, focus.buyTiming);
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
          // 保存原始快照供编辑模式初始化 (详情页「去修改」在放宽结果下也能进入编辑器)
          original: {
            frontier: showFrontier,
            dominated: showDominated,
            recommendationRange: showRecRange,
          },
          userModified: null,
          viewMode: 'original',
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
    const base = model.replace(/\s*×\s*[\d.]+年$/, '');
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
    // 回看模式且未编辑时带 savedId, 让 report 页复用同一份保存快照(含保存时数据日期);
    // 重算后(viewMode='userModified')不带 savedId, 让 report 页读取刚写入 globalData 的重算数据
    const url = this.data.isReplay && this.data.viewMode !== 'userModified'
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
      hasEdits: isRestored,
      openHoldingMenuKey: '',
    });
    this.updateEditorView(snapshot);
  },

  /** 退出编辑模式: 有未提交编辑时弹窗确认是否保留 (task 3.6) */
  onExitEditor() {
    if (this.data.hasEdits) {
      wx.showModal({
        title: '是否保留本次编辑？',
        content: '保留后下次进入仍可恢复，不保留将清空当前编辑',
        confirmText: '保留',
        cancelText: '不保留',
        success: (res) => {
          if (res.confirm) {
            // 保留 draft, 正常退出
            this.doExitEditor();
          } else {
            // 不保留: 清空 draft 后退出
            editorState?.clearDraft();
            this.doExitEditor();
          }
        },
      });
    } else {
      this.doExitEditor();
    }
  },

  /** 实际执行退出编辑模式 */
  doExitEditor() {
    if (autoSaveTipTimer) {
      clearTimeout(autoSaveTipTimer);
      autoSaveTipTimer = null;
    }
    if (animateTipTimer) {
      clearTimeout(animateTipTimer);
      animateTipTimer = null;
    }
    this.setData({
      editorMode: 'view',
      editorSnapshot: null,
      canUndo: false,
      editorDisplayGroups: [],
      editorDeferredGroups: [],
      editorShowAddForm: false,
      editorPriceErrors: {},
      hasEdits: false,
      autoSaveTipVisible: false,
      openHoldingMenuKey: '',
    });
    // 不调用 editorState.reset() 也不 clearDraft, 让 draft 保留供下次恢复
    // editorState 实例丢弃 (模块级变量置 null), draft 已在 storage 中
    editorState = null;
  },

  /** 锚点 id 清洗: 分组键可能含空格等特殊字符, 转为合法 DOM id */
  sanitizeAnchor(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_');
  },

  /** 在编辑器分组中按 (baseModel + buyTiming) 定位目标方案卡片 */
  findEditorGroup(
    baseModel: string,
    buyTiming: 'new' | 'used',
  ): { groupKey: string; anchorId: string } | null {
    for (const section of this.data.editorDisplayGroups) {
      const groups = section.groups as Array<Record<string, unknown>>;
      for (const g of groups) {
        if (g.baseModelRaw === baseModel && g.buyTiming === buyTiming) {
          return { groupKey: String(g.groupKey), anchorId: String(g.groupAnchorId || '') };
        }
      }
    }
    return null;
  },

  /** 从详情页「去修改」跳转: 进入编辑模式并滚动+高亮定位到目标方案卡片 */
  async focusEditorOnPlan(baseModel: string, buyTiming: 'new' | 'used') {
    if (this.data.editorMode !== 'edit') {
      await this.onEnterEditor();
    }
    const target = this.findEditorGroup(baseModel, buyTiming);
    if (!target) return;

    // 高亮动画 (复用复制动画的 animateGroupKey 机制)
    if (animateTipTimer) clearTimeout(animateTipTimer);
    this.setData({ animateGroupKey: target.groupKey });
    animateTipTimer = setTimeout(() => {
      this.setData({ animateGroupKey: '' });
      animateTipTimer = null;
    }, 1500);

    // 等渲染完成后滚动定位, 让目标卡片出现在页面垂直居中位置
    setTimeout(() => {
      this.scrollToCenter(target.anchorId);
    }, 150);
  },

  /** 滚动使目标元素出现在页面垂直居中位置 (而非顶到最上方) */
  scrollToCenter(anchorId: string) {
    try {
      wx.createSelectorQuery()
        .select(`#${anchorId}`)
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec((res) => {
          const rect = res[0] as { top?: number; height?: number } | null;
          const scroll = res[1] as { scrollTop?: number } | null;
          if (!rect || !scroll || typeof scroll.scrollTop !== 'number') {
            wx.pageScrollTo({ selector: `#${anchorId}`, duration: 300 });
            return;
          }
          const windowHeight = wx.getSystemInfoSync().windowHeight;
          const targetTop = scroll.scrollTop + rect.top - (windowHeight - rect.height) / 2;
          wx.pageScrollTo({ scrollTop: Math.max(0, targetTop), duration: 300 });
        });
    } catch {
      wx.pageScrollTo({ selector: `#${anchorId}`, duration: 300 });
    }
  },

  /** 计算方案的分组 key: 去掉持有期后缀的 model + buyTiming + 副本标记 */
  getGroupKey(p: EditedPlanPoint): string {
    const baseModel = p.model.replace(/\s*×\s*[\d.]+年$/, '');
    const copyKey = (p as any)._copyKey || '';
    return `${baseModel}_${p.buyTiming}_${copyKey}`;
  },

  /** 从 snapshot 更新编辑器视图 (分组主列表 + 暂不考虑 + 撤销状态 + 筛选面板) */
  updateEditorView(snapshot: EditorSnapshot) {
    // 按 groupKey 分组所有 points
    const groupMap = new Map<string, EditedPlanPoint[]>();
    for (const p of snapshot.points) {
      const key = this.getGroupKey(p);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(p);
    }

    // 构建展示分组
    const allDisplayGroups: Array<Record<string, unknown>> = [];
    const editorDeferredGroups: Array<Record<string, unknown>> = [];

    for (const [groupKey, points] of groupMap) {
      const first = points[0];
      const baseModel = first.model.replace(/\s*×\s*[\d.]+年$/, '');
      const variants = points.map((p) => ({
        years: p.holdingYears,
        rowId: p.rowId,
        active: !p.deferred,
        monthlyCost: Math.round(p.monthlyCost || 0),
        avgPerformance: p.avgPerformance,
      })).sort((a, b) => a.years - b.years);

      const activeCount = variants.filter((v) => v.active).length;
      const totalCount = variants.length;

      const groupData: Record<string, unknown> = {
        groupKey,
        modelBase: this.formatModelLabel(baseModel),
        // 原始分组键 (与 detail 页「去修改」跳转时的 baseModel 对齐)
        baseModelRaw: baseModel,
        // 滚动定位锚点 id (详情页「去修改」跳转定位用)
        groupAnchorId: `editor-group-${this.sanitizeAnchor(groupKey)}`,
        chip: first.chip,
        buyTiming: first.buyTiming,
        buyPrice: first.buyPrice,
        editedBuyPrice: first.editedBuyPrice,
        channel: first.channel,
        useSubsidy: first.useSubsidy,
        source: first.source,
        excluded: first.excluded,
        _isCustomChannel: (first as any)._isCustomChannel,
        holdingVariants: variants,
        activeCount,
        totalCount,
        frontierState: this.computeFrontierState(first),
      };

      if (activeCount === 0) {
        editorDeferredGroups.push(groupData);
      } else {
        allDisplayGroups.push(groupData);
      }
    }

    // 组内排序: 按 chip → modelBase
    const sortFn = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(a.chip).localeCompare(String(b.chip)) || String(a.modelBase).localeCompare(String(b.modelBase));
    allDisplayGroups.sort(sortFn);
    editorDeferredGroups.sort(sortFn);

    // 按前沿状态分组: 前沿方案 → 靠近前沿方案 → 其他方案
    const frontierOrder = ['前沿方案', '靠近前沿方案', '其他方案'];
    const editorDisplayGroups = frontierOrder
      .filter((fs) => allDisplayGroups.some((g) => g.frontierState === fs))
      .map((fs) => ({
        frontierState: fs,
        groups: allDisplayGroups.filter((g) => g.frontierState === fs),
      }));

    // 构建筛选面板维度
    const chipSet = new Set<string>();
    const memSet = new Set<number>();
    const storSet = new Set<number>();
    const holdSet = new Set<number>();
    const timingSet = new Set<string>();
    for (const p of snapshot.points) {
      chipSet.add(p.chip);
      const mem = p.memoryGb ?? this.extractMemoryGbFromModel(p.model);
      memSet.add(mem);
      const stor = p.storageGb ?? this.extractStorageGbFromModel(p.model);
      storSet.add(stor);
      holdSet.add(p.holdingYears);
      timingSet.add(p.buyTiming);
    }

    // 保持已有的 active 状态 (如果之前已设过筛选)
    const prevChips = new Map(this.data.filterChips.map((c) => [c.value, c.active]));
    const prevMem = new Map(this.data.filterMemory.map((c) => [c.value, c.active]));
    const prevStor = new Map(this.data.filterStorage.map((c) => [c.value, c.active]));
    const prevTiming = new Map(this.data.filterTiming.map((c) => [c.value, c.active]));
    const prevHoldingActive = new Map(this.data.filterHolding.map((c) => [c.value, c.active ?? true]));

    const isIphone = this.data.params?.category === 'iphone';
    let filterChips: Array<{value: string; label: string; active: boolean}>;
    if (isIphone) {
      // iPhone: 按型号名筛选 (如 "12", "12 pro", "12 pro max")
      const modelSet = new Set<string>();
      for (const p of snapshot.points) {
        modelSet.add(this.extractIphoneModelName(p.model));
      }
      filterChips = [...modelSet].sort().map((v) => ({
        value: v, label: v, active: prevChips.has(v) ? !!prevChips.get(v) : true,
      }));
    } else {
      filterChips = [...chipSet].sort().map((v) => ({
        value: v, label: v, active: prevChips.has(v) ? !!prevChips.get(v) : true,
      }));
    }
    const filterMemory = [...memSet].sort((a, b) => a - b).map((v) => ({
      value: String(v), label: `${v}GB`, active: prevMem.has(String(v)) ? prevMem.get(String(v))! : true,
    }));
    const filterStorage = [...storSet].sort((a, b) => a - b).map((v) => ({
      value: String(v), label: v >= 1000 ? `${v / 1000}TB` : `${v}GB`, active: prevStor.has(String(v)) ? prevStor.get(String(v))! : true,
    }));
    // 持有期: 三态 (all / partial / none), 从 snapshot 实时计算
    const filterHolding = [...holdSet].sort((a, b) => a - b).map((v) => {
      const pts = snapshot.points.filter((p) => p.holdingYears === v);
      const activeCnt = pts.filter((p) => !p.deferred).length;
      const state = activeCnt === pts.length ? 'all' : activeCnt === 0 ? 'none' : 'partial';
      return { value: String(v), label: `${v}年`, state, active: prevHoldingActive.has(String(v)) ? prevHoldingActive.get(String(v))! : true };
    });
    const filterTiming = [...timingSet].sort().map((v) => ({
      value: v, label: v === 'new' ? '新品' : '二手', active: prevTiming.has(v) ? prevTiming.get(v)! : true,
    }));

    const prevFrontierState = new Map(this.data.filterFrontierState.map((c) => [c.value, c.active]));
    const filterFrontierState = ['前沿方案', '靠近前沿方案', '其他方案'].map((v) => ({
      value: v, label: v, active: prevFrontierState.has(v) ? prevFrontierState.get(v)! : true,
    }));

    this.setData({
      editorSnapshot: snapshot,
      editorDisplayGroups,
      editorDeferredGroups,
      canUndo: editorState?.canUndo() ?? false,
      filterChips, filterMemory, filterStorage, filterHolding, filterTiming, filterFrontierState,
    });
  },

  /** 自动保存弱提示: 页面底部浅灰色「已自动保存」非模态提示, 2 秒后消失 (task 3.5) */
  showAutoSaveTip() {
    this.setData({ autoSaveTipVisible: true });
    if (autoSaveTipTimer) clearTimeout(autoSaveTipTimer);
    autoSaveTipTimer = setTimeout(() => {
      this.setData({ autoSaveTipVisible: false });
      autoSaveTipTimer = null;
    }, 2000);
  },

  /**
   * 统一编辑提交: push 到撤销栈 + 标记 hasEdits + 触发自动保存弱提示 + 刷新视图
   * 所有编辑动作都调此方法, 替代直接 editorState?.push + updateEditorView
   */
  commitEdit(snap: EditorSnapshot) {
    editorState?.push(snap);
    this.setData({ hasEdits: true });
    this.showAutoSaveTip();
    this.updateEditorView(snap);
  },

  /** 计算方案的前沿状态 (基于原始引擎结果) */
  computeFrontierState(p: EditedPlanPoint): string {
    if (p.source === 'custom') return '其他方案';
    const origFrontier = this.data.original?.frontier || [];
    
    // 是否为前沿方案
    const isFrontier = origFrontier.some(f => 
      f.model === p.model && f.buyTiming === p.buyTiming && f.holdingYears === p.holdingYears
    );
    if (isFrontier) return '前沿方案';

    // 判断是否靠近前沿
    // 在前沿中找到性能大于等于该方案的最便宜方案，看该方案价格是否不超过其 5%
    const pPerf = p.avgPerformance;
    const pCost = p.monthlyCost; // 原始 cost
    
    // 或者找到成本小于等于该方案的最大性能，看该方案性能是否差距在 5 绝对百分点内
    // avgPerformance 在 PlanPoint 中是 0~1 的小数 (例如 0.85)
    
    let isNear = false;
    
    // 条件1: 成本接近 (性能达标的前提下，成本不超出 5%)
    const betterOrEqPerfFrontiers = origFrontier.filter(f => f.avgPerformance >= pPerf);
    if (betterOrEqPerfFrontiers.length > 0) {
      const minCostFrontier = betterOrEqPerfFrontiers.reduce((min, f) => f.monthlyCost < min.monthlyCost ? f : min);
      if (pCost <= minCostFrontier.monthlyCost * 1.05) {
        isNear = true;
      }
    }

    // 条件2: 性能接近 (成本达标的前提下，性能落后不超过 0.05)
    const cheaperOrEqCostFrontiers = origFrontier.filter(f => f.monthlyCost <= pCost);
    if (cheaperOrEqCostFrontiers.length > 0) {
      const maxPerfFrontier = cheaperOrEqCostFrontiers.reduce((max, f) => f.avgPerformance > max.avgPerformance ? f : max);
      if (pPerf >= maxPerfFrontier.avgPerformance - 0.05) {
        isNear = true;
      }
    }

    return isNear ? '靠近前沿方案' : '其他方案';
  },

  /** 从 iPhone model 提取型号名 (如 "iPhone_16_ProMax_256G_二手 × 3年" → "16 pro max") */
  extractIphoneModelName(model: string): string {
    const base = model.replace(/\s*×\s*[\d.]+年$/, '');
    const match = base.match(/iPhone_(\d+)(?:_(ProMax|Pro))?/);
    if (match) {
      const gen = match[1];
      const variant = match[2];
      if (variant === 'ProMax') return `${gen} pro max`;
      if (variant === 'Pro') return `${gen} pro`;
      return gen;
    }
    return base.replace(/_/g, ' ');
  },

  /** 从 model 解析内存 GB (用于批量排除) */
  extractMemoryGbFromModel(model: string): number {
    const m = model.match(/(\d+)G_(\d+)G/);
    if (m) return Number(m[1]);
    return 8;
  },

  /** 从 model 解析存储 GB */
  extractStorageGbFromModel(model: string): number {
    // Mac 格式: "M4_16G_256G_新品" → \d+G_(\d+)G → 256
    const m = model.match(/\d+G_(\d+)G/);
    if (m) return Number(m[1]);
    // iPhone/iPad 格式: "iPhone_16_ProMax_512G_二手" → 查找 (\d+)G 段
    const segs = model.split('_');
    for (let i = segs.length - 1; i >= 0; i--) {
      const gm = segs[i].match(/^(\d+)G$/i);
      if (gm) return Number(gm[1]);
      const tm = segs[i].match(/^(\d+)T$/i);
      if (tm) return Number(tm[1]) * 1024;
    }
    return 256;
  },

  /** 展开/折叠筛选面板 */
  onToggleFilterPanel() {
    this.setData({ filterExpanded: !this.data.filterExpanded });
  },

  /** 筛选 chip 切换: 取消勾选 → 对应方案 deferred=true 移到末尾 */
  onFilterToggle(e: WechatMiniprogram.TouchEvent) {
    const dim = e.currentTarget.dataset.dim as string;
    const val = e.currentTarget.dataset.value as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;

    // 持有期维度: 三态切换 (all → defer all; partial/none → restore)
    if (dim === 'holding') {
      const filterArr = [...this.data.filterHolding];
      const target = filterArr.find((f) => f.value === val);
      if (!target) return;
      const shouldDefer = target.state === 'all'; // all → defer all; partial/none → restore

      // 更新 active 字段: defer 时 active=false, restore 时 active=true
      target.active = !shouldDefer;

      for (const p of snap.points) {
        if (String(p.holdingYears) === val) {
          if (shouldDefer) {
            p.deferred = true;
            if (!snap.deferredRowIds.includes(p.rowId)) snap.deferredRowIds.push(p.rowId);
          } else {
            // 恢复时: 仅当未被其他 inactive 筛选维度匹配时才取消 deferred
            if (!this.isPointDeferredByOtherFilters(p, 'holding')) {
              p.deferred = false;
              snap.deferredRowIds = snap.deferredRowIds.filter((id) => id !== p.rowId);
            }
          }
        }
      }

      this.commitEdit(snap);
      return;
    }

    // 其他维度: 二态切换
    const keyMap: Record<string, string> = {
      chip: 'filterChips', memory: 'filterMemory', storage: 'filterStorage',
      timing: 'filterTiming', frontierState: 'filterFrontierState'
    };
    const dataKey = keyMap[dim];
    if (!dataKey) return;

    const filterArr = [...(this.data as any)[dataKey]] as Array<{value: string; label: string; active: boolean}>;
    const target = filterArr.find((f) => f.value === val);
    if (!target) return;
    target.active = !target.active;
    const nowActive = target.active;

    for (const p of snap.points) {
      const match = this.pointMatchesDim(p, dim, val);
      if (match) {
        if (!nowActive) {
          // 取消勾选: 对应方案 deferred=true
          p.deferred = true;
          if (!snap.deferredRowIds.includes(p.rowId)) snap.deferredRowIds.push(p.rowId);
        } else {
          // 重新勾选: 仅当未被其他 inactive 筛选维度匹配时才取消 deferred
          if (!this.isPointDeferredByOtherFilters(p, dim)) {
            p.deferred = false;
            snap.deferredRowIds = snap.deferredRowIds.filter((id) => id !== p.rowId);
          }
        }
      }
    }

    editorState?.push(snap);
    (this as any).setData({ [dataKey]: filterArr });
    this.showAutoSaveTip();
    this.updateEditorView(snap);
    this.setData({ hasEdits: true });
  },

  /** 判断方案是否匹配筛选维度 */
  pointMatchesDim(p: EditedPlanPoint, dim: string, val: string): boolean {
    if (dim === 'chip') {
      if (this.data.params?.category === 'iphone') {
        return this.extractIphoneModelName(p.model) === val;
      }
      return p.chip === val;
    }
    if (dim === 'memory') return String(p.memoryGb ?? this.extractMemoryGbFromModel(p.model)) === val;
    if (dim === 'storage') return String(p.storageGb ?? this.extractStorageGbFromModel(p.model)) === val;
    if (dim === 'holding') return String(p.holdingYears) === val;
    if (dim === 'timing') return p.buyTiming === val;
    if (dim === 'frontierState') return this.computeFrontierState(p) === val;
    return false;
  },

  /**
   * 检查 point 是否被「其他」inactive 筛选维度匹配 (即应保持 deferred)。
   * 排除当前正在切换的维度 (excludeDim)，仅检查其余维度。
   *
   * 解决多维度筛选交叉问题: 恢复某维度筛选时，被其他 inactive 维度 deferred
   * 的 point 不应被一并恢复。
   */
  isPointDeferredByOtherFilters(p: EditedPlanPoint, excludeDim: string): boolean {
    const isIphone = this.data.params?.category === 'iphone';

    if (excludeDim !== 'chip') {
      if (isIphone) {
        const modelName = this.extractIphoneModelName(p.model);
        const f = this.data.filterChips.find((c) => c.value === modelName);
        if (f && !f.active) return true;
      } else {
        const f = this.data.filterChips.find((c) => c.value === p.chip);
        if (f && !f.active) return true;
      }
    }

    if (excludeDim !== 'memory') {
      const mem = String(p.memoryGb ?? this.extractMemoryGbFromModel(p.model));
      const f = this.data.filterMemory.find((c) => c.value === mem);
      if (f && !f.active) return true;
    }

    if (excludeDim !== 'storage') {
      const stor = String(p.storageGb ?? this.extractStorageGbFromModel(p.model));
      const f = this.data.filterStorage.find((c) => c.value === stor);
      if (f && !f.active) return true;
    }

    if (excludeDim !== 'holding') {
      const f = this.data.filterHolding.find((c) => c.value === String(p.holdingYears));
      if (f && f.active === false) return true;
    }

    if (excludeDim !== 'timing') {
      const f = this.data.filterTiming.find((c) => c.value === p.buyTiming);
      if (f && !f.active) return true;
    }

    if (excludeDim !== 'frontierState') {
      const fs = this.computeFrontierState(p);
      const f = this.data.filterFrontierState.find((c) => c.value === fs);
      if (f && !f.active) return true;
    }

    return false;
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

  /** 按 groupKey 查找组内所有 points */
  findGroupPoints(snap: EditorSnapshot, groupKey: string): EditedPlanPoint[] {
    return snap.points.filter((p) => this.getGroupKey(p) === groupKey);
  },

  /** 展开/折叠持有期多选菜单 */
  onToggleHoldingMenu(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    this.setData({ openHoldingMenuKey: this.data.openHoldingMenuKey === groupKey ? '' : groupKey });
  },

  /** 切换某个持有期变体的 active 状态 (deferred 切换) */
  onToggleHoldingVariant(e: WechatMiniprogram.TouchEvent) {
    const rowId = e.currentTarget.dataset.rowId as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const point = snap.points.find((p) => p.rowId === rowId);
    if (!point) return;

    point.deferred = !point.deferred;
    if (point.deferred) {
      if (!snap.deferredRowIds.includes(rowId)) snap.deferredRowIds.push(rowId);
    } else {
      snap.deferredRowIds = snap.deferredRowIds.filter((id) => id !== rowId);
    }
    this.commitEdit(snap);
  },

  /** 买入价输入: 仅合法时实时应用, 非法时不校验不提示 (等 blur 再判断) */
  onEditorPriceChange(e: WechatMiniprogram.Input) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const raw = e.detail.value;
    const price = Number(raw);

    // 输入过程中不校验合法性, 只在值合法时实时应用价格
    if (raw === '' || isNaN(price) || price <= 0 || price > 999999) {
      // 输入中途不合法 (如清空准备重输): 不校验, 不提示, 不改价, 等 blur 再判断
      return;
    }

    // 合法值: 实时应用价格, 取消排除
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;

    const errors = { ...this.data.editorPriceErrors };
    delete errors[groupKey];
    for (const p of groupPoints) {
      p.editedBuyPrice = price;
      p.excluded = false;
      if (p.source === 'original') p.source = 'edited';
    }

    this.setData({ editorPriceErrors: errors });
    this.commitEdit(snap);
  },

  /** 买入价失焦: 最终校验, 仍不合法则排除 */
  onEditorPriceBlur(e: WechatMiniprogram.Input) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const raw = e.detail.value;
    const price = Number(raw);

    // 合法值无需处理 (input 时已应用)
    if (raw !== '' && !isNaN(price) && price > 0 && price <= 999999) return;

    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;

    const errors = { ...this.data.editorPriceErrors };
    errors[groupKey] = raw === '' ? '请输入价格' : '买入价不合法';
    for (const p of groupPoints) p.excluded = true;

    this.setData({ editorPriceErrors: errors });
    this.commitEdit(snap);
  },

  /** 渠道 picker 变更: 应用到组内所有变体 */
  onEditorChannelChange(e: WechatMiniprogram.CustomEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const idx = Number(e.detail.value);
    const channel = this.data.editorChannels[idx];
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;

    const errors = { ...this.data.editorPriceErrors };

    for (const point of groupPoints) {
      if (channel === '快照价') {
        point.channel = undefined;
        point.editedBuyPrice = undefined;
        point.source = 'original';
        point.excluded = false;
        (point as any)._isCustomChannel = false;
        delete errors[groupKey];
      } else if (channel === '其他') {
        point.channel = '';
        (point as any)._isCustomChannel = true;
      } else {
        point.channel = channel;
        (point as any)._isCustomChannel = false;
      }
    }

    this.setData({ editorPriceErrors: errors });
    this.commitEdit(snap);
  },

  /** 自定义渠道输入: 应用到组内所有变体 */
  onEditorCustomChannelInput(e: WechatMiniprogram.Input) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const value = e.detail.value;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    for (const point of groupPoints) {
      point.channel = value;
    }
    this.commitEdit(snap);
  },

  /** 切换「是否使用国补」: 应用到组内所有变体 */
  onEditorSubsidyToggle(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    for (const point of groupPoints) {
      point.useSubsidy = !point.useSubsidy;
    }
    this.commitEdit(snap);
  },

  /** 整组排除 checkbox 切换 */
  onEditorExcludeToggle(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;
    // 以第一个 point 的 excluded 取反作为目标值
    const newExcluded = !groupPoints[0].excluded;
    for (const point of groupPoints) {
      point.excluded = newExcluded;
    }
    this.commitEdit(snap);
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

    this.commitEdit(snap);
  },

  /** 移入暂不考虑: 整组所有变体 deferred */
  onEditorDefer(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    for (const point of groupPoints) {
      point.deferred = true;
      if (!snap.deferredRowIds.includes(point.rowId)) {
        snap.deferredRowIds.push(point.rowId);
      }
    }
    this.commitEdit(snap);
  },

  /** 从暂不考虑恢复到主列表: 整组所有变体恢复 */
  onEditorRestore(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    const groupRowIds = new Set(groupPoints.map((p) => p.rowId));
    for (const point of groupPoints) {
      point.deferred = false;
    }
    snap.deferredRowIds = snap.deferredRowIds.filter((id) => !groupRowIds.has(id));
    this.commitEdit(snap);
  },

  /** 卡片复制: 深拷贝整组所有变体 + 生成全新唯一 ID, 插入到当前分组下方 */
  onEditorCopyPlan(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;

    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;

    // 方案数量上限防爆栈拦截
    if (snap.points.length + groupPoints.length > 500) {
      wx.showToast({ title: '最多支持同时比价 500 个方案，请先删除一些不需要的方案', icon: 'none' });
      return;
    }

    // 找到组内最后一个 point 的索引
    const lastIdx = Math.max(...groupPoints.map((p) => snap.points.indexOf(p)));

    // 深拷贝所有变体, 每个生成全新 rowId, 共享同一 _copyKey 以形成独立分组
    const copyKey = `copy-${Date.now()}`;
    const copies: EditedPlanPoint[] = groupPoints.map((orig) => ({
      ...orig,
      rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      _copyKey: copyKey,
    }));

    snap.points.splice(lastIdx + 1, 0, ...copies);
    this.commitEdit(snap);

    // 高亮动画提示新复制的选项卡
    const baseModel = copies[0].model.replace(/\s*×\s*[\d.]+年$/, '');
    const newGroupKey = `${baseModel}_${copies[0].buyTiming}_${copyKey}`;
    if (animateTipTimer) clearTimeout(animateTipTimer);
    this.setData({ animateGroupKey: newGroupKey });
    animateTipTimer = setTimeout(() => {
      this.setData({ animateGroupKey: '' });
      animateTipTimer = null;
    }, 1500);
  },

  /** 删除方案: 二次确认后整组彻底移除 */
  onEditorDeletePlan(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    wx.showModal({
      title: '确认永久删除此方案？',
      content: '删除后无法恢复，该方案（含所有持有期）将从列表中彻底移除',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#F24B4B',
      success: (res) => {
        if (!res.confirm) return;
        const snap = this.cloneSnapshot();
        if (!snap) return;
        const groupRowIds = new Set(this.findGroupPoints(snap, groupKey).map((p) => p.rowId));
        snap.points = snap.points.filter((p) => !groupRowIds.has(p.rowId));
        snap.deferredRowIds = snap.deferredRowIds.filter((id) => !groupRowIds.has(id));
        this.commitEdit(snap);
      },
    });
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

  /** 构建/刷新持有期 chips (预计算 active 态) */
  rebuildHoldingChips(options: number[], selected: number[]) {
    const chips = options
      .slice()
      .sort((a, b) => a - b)
      .map((years) => ({
        years,
        label: `${years}年`,
        active: selected.includes(years),
      }));
    this.setData({ editorHoldingChips: chips });
  },

  /** 显示新增自定义方案表单 */
  onEditorShowAddForm() {
    this.setData({
      editorShowAddForm: true,
      editorAddFormMode: 'add',
      editorEditingGroupKey: '',
      editorAddForm: {
        model: '',
        chip: '',
        memoryGb: 8,
        storageGb: 256,
        buyTiming: 'used' as 'new' | 'used',
        buyPrice: 0,
        holdingYearsList: [3] as number[],
      },
    });
    this.rebuildHoldingChips(BASE_HOLDING_OPTIONS, [3]);
  },

  /** 取消新增/编辑表单 (不做任何数据变更) */
  onEditorCancelAddForm() {
    this.setData({ editorShowAddForm: false, editorAddFormMode: 'add', editorEditingGroupKey: '' });
  },

  /** 新增/编辑表单字段变更 */
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

  /** 新增/编辑表单: 持有期 chip 勾选切换 */
  onEditorAddFormHoldingToggle(e: WechatMiniprogram.TouchEvent) {
    const years = Number(e.currentTarget.dataset.years as number);
    const form = { ...this.data.editorAddForm };
    const list = form.holdingYearsList.slice();
    const idx = list.indexOf(years);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(years);
    }
    form.holdingYearsList = list;
    this.setData({ editorAddForm: form });
    this.rebuildHoldingChips(
      this.data.editorHoldingChips.map((c) => c.years),
      list,
    );
  },

  /** 编辑自添加方案: 打开表单并预填该组数据 */
  onEditorEditCustomPlan(e: WechatMiniprogram.TouchEvent) {
    const groupKey = e.currentTarget.dataset.groupKey as string;
    const snap = this.cloneSnapshot();
    if (!snap) return;
    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;

    const first = groupPoints[0];
    // 机型名 = baseModel (剥离 × Ny年 后缀) 再去掉尾部 _新品/_二手
    const baseModel = first.model.replace(/\s*×\s*[\d.]+年$/, '');
    const modelName = baseModel.replace(/_(新品|二手)$/, '');
    const holdingList = groupPoints.map((p) => p.holdingYears);

    this.setData({
      editorShowAddForm: true,
      editorAddFormMode: 'edit',
      editorEditingGroupKey: groupKey,
      editorAddForm: {
        model: modelName,
        chip: first.chip,
        memoryGb: first.memoryGb ?? 8,
        storageGb: first.storageGb ?? 256,
        buyTiming: first.buyTiming,
        buyPrice: first.editedBuyPrice ?? first.buyPrice,
        holdingYearsList: holdingList.slice(),
      },
    });
    // 选项 = 基础选项 ∪ 组内已有持有期 (兼容历史自由输入的非标准持有期)
    const options = [...new Set([...BASE_HOLDING_OPTIONS, ...holdingList])];
    this.rebuildHoldingChips(options, holdingList);
  },

  /** 表单公共校验: 通过返回 null, 否则返回错误消息 */
  validateAddForm(form: EditorAddFormState): string | null {
    if (!form.chip) return '请选择芯片';
    if (!form.model.trim()) return '请输入机型名';
    if (!(form.buyPrice > 0)) return '买入价需大于 0';
    if (form.holdingYearsList.length === 0) return '请至少勾选一个持有期';
    return null;
  },

  /** 确认新增/保存编辑自定义方案 (按 editorAddFormMode 分流) */
  onEditorAddPlan() {
    const form = this.data.editorAddForm;
    const error = this.validateAddForm(form);
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }

    const snap = this.cloneSnapshot();
    if (!snap) return;

    if (this.data.editorAddFormMode === 'edit') {
      this.saveEditCustomPlan(snap, form, this.data.editorEditingGroupKey);
    } else {
      this.addCustomPlan(snap, form);
    }
  },

  /** 新增: 为每个勾选的持有期各生成一个方案点 (同组展示) */
  addCustomPlan(snap: EditorSnapshot, form: EditorAddFormState) {
    // 方案数量上限防爆栈拦截 (按新增点数计算)
    if (snap.points.length + form.holdingYearsList.length > 500) {
      wx.showToast({ title: '最多支持同时比价 500 个方案，请先删除一些不需要的方案', icon: 'none' });
      return;
    }

    const timingLabel = form.buyTiming === 'new' ? '新品' : '二手';
    for (const years of form.holdingYearsList) {
      const newPoint: EditedPlanPoint = {
        model: `${form.model}_${timingLabel} × ${years}年`,
        chip: form.chip,
        buyTiming: form.buyTiming,
        holdingYears: years,
        monthlyCost: 0, // 引擎重算时计算
        avgPerformance: 0,
        buyPrice: form.buyPrice,
        residual: 0,
        maintenanceCost: 0,
        holdingMonths: years * 12,
        performanceS0: 0,
        performanceSN: 0,
        source: 'custom',
        rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        memoryGb: form.memoryGb,
        storageGb: form.storageGb,
        channel: form.buyTiming === 'new' ? '京东' : '闲鱼',
        useSubsidy: form.buyTiming === 'new',
      };
      snap.points.push(newPoint);
    }

    this.setData({ editorShowAddForm: false, editorAddFormMode: 'add', editorEditingGroupKey: '' });
    this.commitEdit(snap);
  },

  /** 保存编辑: 公共字段整组更新 + 持有期按勾选增删变体 */
  saveEditCustomPlan(
    snap: EditorSnapshot,
    form: EditorAddFormState,
    groupKey: string,
  ) {
    const groupPoints = this.findGroupPoints(snap, groupKey);
    if (groupPoints.length === 0) return;

    const first = groupPoints[0];
    const timingLabel = form.buyTiming === 'new' ? '新品' : '二手';
    const timingChanged = first.buyTiming !== form.buyTiming;
    // 买入时机变化时渠道/国补重置默认; 不变则保留组内现值
    const channel = timingChanged ? (form.buyTiming === 'new' ? '京东' : '闲鱼') : first.channel;
    const useSubsidy = timingChanged ? form.buyTiming === 'new' : first.useSubsidy;
    const copyKey = first._copyKey || '';

    // 净增量 = 新勾选中组内尚不存在的持有期数
    const existingYears = new Set(groupPoints.map((p) => p.holdingYears));
    const addedYears = form.holdingYearsList.filter((y) => !existingYears.has(y));
    if (snap.points.length + addedYears.length > 500) {
      wx.showToast({ title: '最多支持同时比价 500 个方案，请先删除一些不需要的方案', icon: 'none' });
      return;
    }

    // 1. 删除取消勾选的持有期变体 (同步清理 deferredRowIds)
    const selectedYears = new Set(form.holdingYearsList);
    const removedRowIds = new Set(
      groupPoints.filter((p) => !selectedYears.has(p.holdingYears)).map((p) => p.rowId),
    );
    if (removedRowIds.size > 0) {
      snap.points = snap.points.filter((p) => !removedRowIds.has(p.rowId));
      snap.deferredRowIds = snap.deferredRowIds.filter((id) => !removedRowIds.has(id));
    }

    // 2. 整组更新公共字段 (保留持有期变体的 deferred/excluded 状态)
    const keptPoints = groupPoints.filter((p) => selectedYears.has(p.holdingYears));
    for (const point of keptPoints) {
      point.model = `${form.model}_${timingLabel} × ${point.holdingYears}年`;
      point.chip = form.chip;
      point.buyTiming = form.buyTiming;
      point.buyPrice = form.buyPrice;
      point.editedBuyPrice = undefined; // 编辑保存直接写 buyPrice, 清空行内改价字段避免并存取错
      point.memoryGb = form.memoryGb;
      point.storageGb = form.storageGb;
      point.holdingMonths = point.holdingYears * 12;
      point.channel = channel;
      point.useSubsidy = useSubsidy;
      point._copyKey = copyKey || undefined; // 保持独立分组 (复制副本)
    }

    // 3. 新勾选的持有期在组尾插入新点 (deferred=false 参与重算)
    const lastIdx = Math.max(...keptPoints.map((p) => snap.points.indexOf(p)));
    const insertIdx = keptPoints.length > 0 ? lastIdx + 1 : snap.points.length;
    const newPoints: EditedPlanPoint[] = addedYears.map((years) => ({
      model: `${form.model}_${timingLabel} × ${years}年`,
      chip: form.chip,
      buyTiming: form.buyTiming,
      holdingYears: years,
      monthlyCost: 0,
      avgPerformance: 0,
      buyPrice: form.buyPrice,
      residual: 0,
      maintenanceCost: 0,
      holdingMonths: years * 12,
      performanceS0: 0,
      performanceSN: 0,
      source: 'custom',
      rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      memoryGb: form.memoryGb,
      storageGb: form.storageGb,
      channel,
      useSubsidy,
      _copyKey: copyKey || undefined,
    }));
    snap.points.splice(insertIdx, 0, ...newPoints);

    this.setData({ editorShowAddForm: false, editorAddFormMode: 'add', editorEditingGroupKey: '' });
    this.commitEdit(snap);
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

  /** 保存用户修改版: 跳转到分享卡页面，在分享卡生成时缓存快照 */
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

    // 组装 shareCardData 并跳转到 share-card 页
    const recPlans = (userModified.recommendationRange?.plans ?? []) as PlanPoint[];
    const pool: PlanPoint[] = recPlans.length > 0 ? recPlans : userModified.frontier;
    const topPlanRaw = sortPreferredPlans(pool, params.performanceFloor)[0] ?? userModified.frontier[0] ?? null;

    const app = getApp();
    if (app.globalData) {
      app.globalData.shareCardData = {
        params,
        reportData,
        headerTitle,
        topPlan: topPlanRaw,
        frontier: userModified.frontier,
      } as unknown as Record<string, unknown>;
    }

    const query = `category=${params.category}&budget=${params.budget}`;
    wx.navigateTo({ url: `/pages/share-card/share-card?${query}` });
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
      data: 'https://github.com/Zazia/apple-value-analysis',
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
