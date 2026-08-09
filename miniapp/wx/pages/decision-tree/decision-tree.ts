// pages/decision-tree/decision-tree.ts
// 5 步决策树表单: 品类 → 预算 → 持有期 → 新品/二手 → 性能地板
// 持有期步骤为多选 (2/3/4/5 任选 N 个), 其余为单选

import { getSavedCount } from '../../services/saved-results';

interface StepOption {
  label: string;
  value: string | number;
  desc?: string;
}

interface Step {
  key: string;
  title: string;
  options: StepOption[];
  /** 多选步骤: 点击选项切换选中态, 不自动进入下一步 */
  multi?: boolean;
  /** 多选步骤的「都看看」快捷项文案, 点击后默认勾选全部 */
  quickAll?: string;
  /** 多选步骤至少选 N 个才能下一步 */
  minSelect?: number;
}

const STEPS: Step[] = [
  {
    key: 'category',
    title: '你想买哪类苹果设备?',
    options: [
      { label: 'Mac mini', value: 'mac-mini', desc: '台式机, 性价比之选' },
      { label: 'MacBook Air', value: 'macbook-air', desc: '轻薄笔记本' },
      { label: 'MacBook Pro', value: 'macbook-pro', desc: '专业笔记本' },
      { label: 'iPhone', value: 'iphone', desc: '手机' },
      { label: 'iPad', value: 'ipad', desc: '平板' },
      { label: 'iMac', value: 'imac', desc: '一体机' },
    ],
  },
  {
    key: 'budget',
    title: '你的预算大概多少?',
    options: [
      { label: '3000 元以内', value: 3000 },
      { label: '5000 元以内', value: 5000 },
      { label: '8000 元以内', value: 8000 },
      { label: '12000 元以内', value: 12000 },
      { label: '20000 元以内', value: 20000 },
    ],
  },
  {
    key: 'holdingYears',
    title: '打算用几年?',
    multi: true,
    quickAll: '都看看持有期 (推荐)',
    minSelect: 1,
    options: [
      { label: '1 年', value: 1, desc: '短期持有' },
      { label: '1.5 年', value: 1.5, desc: '一年半' },
      { label: '2 年', value: 2 },
      { label: '3 年', value: 3 },
      { label: '4 年', value: 4 },
      { label: '5 年', value: 5 },
    ],
  },
  {
    key: 'buyTiming',
    title: '买新品还是二手?',
    options: [
      { label: '新品', value: 'new', desc: '官方/京东自营' },
      { label: '二手', value: 'used', desc: '闲鱼/转转' },
      { label: '都看看 (推荐)', value: 'both', desc: '同时对比新品与二手' },
    ],
  },
  {
    key: 'performanceFloor',
    title: '最低性能要求?',
    options: [
      { label: '够用就行 (30%)', value: 0.3, desc: '轻度办公/上网' },
      { label: '主流水平 (50%)', value: 0.5, desc: '日常开发/轻度剪辑' },
      { label: '较高要求 (70%)', value: 0.7, desc: '专业工作流' },
    ],
  },
];

// 品类默认参数(选择「不确定」时使用)
const DEFAULT_PARAMS: Record<
  string,
  { holdingYears: number[]; buyTiming: 'new' | 'used' | 'both'; performanceFloor: number }
> = {
  'mac-mini': { holdingYears: [2, 3, 4], buyTiming: 'both', performanceFloor: 0.4 },
  'macbook-air': { holdingYears: [2, 3, 4], buyTiming: 'both', performanceFloor: 0.4 },
  'macbook-pro': { holdingYears: [3, 4, 5], buyTiming: 'both', performanceFloor: 0.5 },
  'iphone': { holdingYears: [2, 3], buyTiming: 'both', performanceFloor: 0.5 },
  'ipad': { holdingYears: [2, 3, 4], buyTiming: 'both', performanceFloor: 0.4 },
  'imac': { holdingYears: [3, 4, 5], buyTiming: 'both', performanceFloor: 0.4 },
};

type SelectionValue = string | number | number[];

Page({
  data: {
    steps: STEPS,
    currentStep: 0,
    selections: {} as Record<string, SelectionValue>,
    progress: 20,
    showAiHint: false,
    fadeClass: 'fade-in',
    /** 当前多选步骤已选中的 value 数组(用于 wxml 高亮) */
    multiSelected: [] as number[],
    /** 当前多选步骤是否满足最少选择数 */
    canProceedMulti: false,
    /** 已保存结果数量 (第一页入口展示) */
    savedCount: 0,
  },

  onLoad() {
    this.setData({ fadeClass: 'fade-in', savedCount: getSavedCount() });
  },

  /** 每次显示时刷新保存数量 (从 saved-list 返回时可能已变化) */
  onShow() {
    this.setData({ savedCount: getSavedCount() });
  },

  /** 跳转已保存结果列表 */
  onViewSavedResults() {
    wx.navigateTo({ url: '/pages/saved-list/saved-list' });
  },

  /** 进入某一步时同步多选状态到 data (供 wxml 渲染选中态) */
  syncMultiState(stepKey: string) {
    const step = STEPS.find((s) => s.key === stepKey);
    if (!step || !step.multi) {
      this.setData({ multiSelected: [], canProceedMulti: false });
      return;
    }
    const sel = this.data.selections[stepKey];
    const arr = Array.isArray(sel) ? (sel as number[]) : [];
    const min = step.minSelect ?? 1;
    this.setData({
      multiSelected: arr,
      canProceedMulti: arr.length >= min,
    });
  },

  // 选择某个选项(单选步骤)
  onSelectOption(e: WechatMiniprogram.TouchEvent) {
    const { step, value } = e.currentTarget.dataset as { step: string; value: string | number };
    const selections = { ...this.data.selections, [step]: value };

    this.trackEvent('step_select', { step, value, stepIndex: this.data.currentStep });

    this.setData({ selections });

    // 延迟切换到下一步, 给视觉反馈
    setTimeout(() => {
      this.nextStep();
    }, 250);
  },

  /** 多选步骤: 切换某个选项的选中态 */
  onToggleMulti(e: WechatMiniprogram.TouchEvent) {
    const { step, value } = e.currentTarget.dataset as { step: string; value: number };
    const stepDef = STEPS.find((s) => s.key === step);
    const min = stepDef?.minSelect ?? 1;

    const current = Array.isArray(this.data.selections[step])
      ? (this.data.selections[step] as number[])
      : [];
    const numValue = Number(value);
    let next: number[];
    if (current.includes(numValue)) {
      next = current.filter((v) => v !== numValue);
    } else {
      next = [...current, numValue];
    }

    const selections = { ...this.data.selections, [step]: next };
    this.trackEvent('step_select_multi', { step, value: numValue, stepIndex: this.data.currentStep });
    this.setData({
      selections,
      multiSelected: next,
      canProceedMulti: next.length >= min,
    });
  },

  /** 多选步骤「都看看」快捷项: 勾选全部选项 */
  onQuickAll(e: WechatMiniprogram.TouchEvent) {
    const { step } = e.currentTarget.dataset as { step: string };
    const stepDef = STEPS.find((s) => s.key === step);
    if (!stepDef) return;
    const allValues = stepDef.options.map((o) => Number(o.value));
    const min = stepDef.minSelect ?? 1;
    const selections = { ...this.data.selections, [step]: allValues };
    this.trackEvent('step_select_quick_all', { step, stepIndex: this.data.currentStep });
    this.setData({
      selections,
      multiSelected: allValues,
      canProceedMulti: allValues.length >= min,
    });
  },

  /** 多选步骤「下一步」按钮 */
  onMultiNext() {
    const step = STEPS[this.data.currentStep];
    if (!step.multi) return;
    const min = step.minSelect ?? 1;
    const sel = this.data.selections[step.key];
    const arr = Array.isArray(sel) ? (sel as number[]) : [];
    if (arr.length < min) {
      wx.showToast({ title: `至少选 ${min} 个`, icon: 'none' });
      return;
    }
    this.nextStep();
  },

  // 选择「不确定/帮我选」
  onSelectUnsure() {
    const step = STEPS[this.data.currentStep];
    const category = String(this.data.selections.category ?? 'mac-mini');
    const defaults = DEFAULT_PARAMS[category] ?? DEFAULT_PARAMS['mac-mini'];

    let value: SelectionValue;
    switch (step.key) {
      case 'holdingYears':
        value = defaults.holdingYears;
        break;
      case 'buyTiming':
        value = defaults.buyTiming;
        break;
      case 'performanceFloor':
        value = defaults.performanceFloor;
        break;
      default:
        value = '';
    }

    const selections = { ...this.data.selections, [step.key]: value };
    this.trackEvent('step_select_unsure', { step: step.key, stepIndex: this.data.currentStep });

    this.setData({
      selections,
      showAiHint: true,
    });

    setTimeout(() => {
      this.setData({ showAiHint: false });
      this.nextStep();
    }, 2600);
  },

  // 下一步
  nextStep() {
    const next = this.data.currentStep + 1;
    if (next >= STEPS.length) {
      this.goToResult();
      return;
    }

    // 切换动画
    this.setData({ fadeClass: 'fade-out' });
    setTimeout(() => {
      this.setData({
        currentStep: next,
        progress: Math.round(((next + 1) / STEPS.length) * 100),
        fadeClass: 'fade-in',
      });
      this.syncMultiState(STEPS[next].key);
    }, 150);
  },

  // 上一步
  prevStep() {
    if (this.data.currentStep === 0) return;
    const prev = this.data.currentStep - 1;
    this.setData({
      currentStep: prev,
      progress: Math.round(((prev + 1) / STEPS.length) * 100),
      fadeClass: 'fade-in',
    });
    this.syncMultiState(STEPS[prev].key);
  },

  // 跳转结果页
  goToResult() {
    const s = this.data.selections;
    const category = String(s.category ?? 'mac-mini');
    const budget = Number(s.budget ?? 5000);
    const buyTiming = String(s.buyTiming ?? 'used') as 'new' | 'used' | 'both';
    const performanceFloor = Number(s.performanceFloor ?? 0.4);

    // 持有期: 多选存为 number[], 不确定分支存为 number[], 兼容历史逗号字符串
    let holdingYears: number[] = [];
    const hy = s.holdingYears;
    if (Array.isArray(hy)) {
      holdingYears = (hy as number[]).map(Number).filter((n) => !isNaN(n) && n > 0);
    } else if (typeof hy === 'string') {
      holdingYears = hy
        .split(',')
        .map((x) => Number(x))
        .filter((n) => !isNaN(n) && n > 0);
    } else if (hy !== undefined) {
      const n = Number(hy);
      if (!isNaN(n) && n > 0) holdingYears = [n];
    }
    if (holdingYears.length === 0) holdingYears = [3];

    // 传递给全局 + URL query
    const app = getApp();
    if (app.globalData) {
      app.globalData.decisionParams = { category, budget, holdingYears, buyTiming, performanceFloor };
    }

    const query = `category=${category}&budget=${budget}&buyTiming=${buyTiming}&performanceFloor=${performanceFloor}&holdingYears=${holdingYears.join(',')}`;
    wx.navigateTo({ url: `/pages/result/result?${query}` });
  },

  // 埋点: 上报到本地存储
  trackEvent(eventName: string, data: Record<string, unknown>) {
    try {
      const log = (wx.getStorageSync('decision_tree_events') as unknown[]) || [];
      log.push({ event: eventName, data, timestamp: Date.now() });
      wx.setStorageSync('decision_tree_events', log);
    } catch {
      // 存储失败不阻塞主流程
    }
  },
});
