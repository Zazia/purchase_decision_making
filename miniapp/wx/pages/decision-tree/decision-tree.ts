// pages/decision-tree/decision-tree.ts
// 5 步决策树表单: 品类 → 预算 → 持有期 → 新品/二手 → 性能地板

interface StepOption {
  label: string;
  value: string | number;
  desc?: string;
}

interface Step {
  key: string;
  title: string;
  options: StepOption[];
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
    options: [
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
      { label: '都看看', value: 'used', desc: '同时对比两类' },
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
const DEFAULT_PARAMS: Record<string, { holdingYears: number[]; buyTiming: 'new' | 'used'; performanceFloor: number }> = {
  'mac-mini': { holdingYears: [2, 3, 4], buyTiming: 'used', performanceFloor: 0.4 },
  'macbook-air': { holdingYears: [2, 3, 4], buyTiming: 'used', performanceFloor: 0.4 },
  'macbook-pro': { holdingYears: [3, 4, 5], buyTiming: 'used', performanceFloor: 0.5 },
  'iphone': { holdingYears: [2, 3], buyTiming: 'used', performanceFloor: 0.5 },
  'ipad': { holdingYears: [2, 3, 4], buyTiming: 'used', performanceFloor: 0.4 },
  'imac': { holdingYears: [3, 4, 5], buyTiming: 'used', performanceFloor: 0.4 },
};

Page({
  data: {
    steps: STEPS,
    currentStep: 0,
    selections: {} as Record<string, string | number>,
    progress: 20,
    showAiHint: false,
    fadeClass: 'fade-in',
  },

  onLoad() {
    this.setData({ fadeClass: 'fade-in' });
  },

  // 选择某个选项
  onSelectOption(e: WechatMiniprogram.TouchEvent) {
    const { step, value } = e.currentTarget.dataset as { step: string; value: string | number };
    const selections = { ...this.data.selections, [step]: value };

    // 埋点: 每步选择上报到本地存储
    this.trackEvent('step_select', { step, value, stepIndex: this.data.currentStep });

    this.setData({ selections });

    // 延迟切换到下一步, 给视觉反馈
    setTimeout(() => {
      this.nextStep();
    }, 250);
  },

  // 选择「不确定/帮我选」
  onSelectUnsure() {
    const step = STEPS[this.data.currentStep];
    const category = String(this.data.selections.category ?? 'mac-mini');
    const defaults = DEFAULT_PARAMS[category] ?? DEFAULT_PARAMS['mac-mini'];

    let value: string | number;
    switch (step.key) {
      case 'holdingYears':
        value = defaults.holdingYears.join(',');
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
    }, 1200);
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
  },

  // 跳转结果页
  goToResult() {
    const s = this.data.selections;
    const category = String(s.category ?? 'mac-mini');
    const budget = Number(s.budget ?? 5000);
    const buyTiming = String(s.buyTiming ?? 'used') as 'new' | 'used';
    const performanceFloor = Number(s.performanceFloor ?? 0.4);

    // 持有期: 可能是单值或逗号分隔
    let holdingYears: number[];
    const hyRaw = String(s.holdingYears ?? '3');
    if (hyRaw.includes(',')) {
      holdingYears = hyRaw.split(',').map(Number);
    } else {
      holdingYears = [Number(hyRaw)];
    }

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
      const log = wx.getStorageSync('decision_tree_events') as unknown[] || [];
      log.push({ event: eventName, data, timestamp: Date.now() });
      wx.setStorageSync('decision_tree_events', log);
    } catch {
      // 存储失败不阻塞主流程
    }
  },
});
