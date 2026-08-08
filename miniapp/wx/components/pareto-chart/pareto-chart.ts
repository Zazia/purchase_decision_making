// components/pareto-chart/pareto-chart.ts
// ec-canvas 帕累托散点图组件:
//   - 前沿连线(虚线) + 类型A实心圆(品牌蓝) + 类型B三角形/类型C菱形(浅蓝半透明)
//   - 被支配点灰显 + 细描边
//   - 推荐区间 markArea 色带 + 性能地板水平虚线 + 预算垂直虚线
//   - 关闭 tooltip/缩放, 点击点位跳转详情

import * as echarts from '../ec-canvas/echarts';

/** 与 PlanPoint 对齐的方案点(含 v3.8 候选类型字段) */
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

interface RecommendationRange {
  lowerCost: number;
  upperCost: number;
  plans: PlanPoint[];
}

// 设计 token 对齐 constants.json design_tokens
const C_PRIMARY = '#007AFF';
const C_MUTED = '#86868F';
const C_BORDER = '#D2D2D8';
const C_GRAY = '#C7C7CC';
const C_SUCCESS = '#2A8A61';
const C_WAIT = '#5AC8FA'; // 次级品牌色: 等新品方案 (类型 B/C)
const C_WARN = '#FF9500'; // 预算线
const C_REC_BAND = '#007AFF'; // 推荐区间色带(主品牌色, 半透明)

Component({
  properties: {
    frontier: { type: Array, value: [] },
    dominated: { type: Array, value: [] },
    recommendationRange: { type: Object, value: null },
    performanceFloor: { type: Number, value: 0 },
    budget: { type: Number, value: 0 },
  },

  data: {
    ec: { lazyLoad: true } as { lazyLoad: boolean },
    initialized: false,
  },

  // chartInstance 存为组件实例属性 (非 data), 因为 ECharts 对象不可序列化,
  // 放入 data 会导致 setData 部分失败 (initialized 字段不会更新)
  chartInstance: null as echarts.ECharts | null,

  observers: {
    'frontier, dominated, recommendationRange, performanceFloor, budget': function () {
      if (this.data.initialized && this.chartInstance) {
        this.updateChart();
      }
    },
  },

  lifetimes: {
    attached() {
      // 延迟初始化, 确保 ec-canvas 已挂载
      setTimeout(() => this.initChart(), 200);
    },
    detached() {
      if (this.chartInstance) {
        this.chartInstance.dispose();
      }
    },
  },

  methods: {
    /** 初始化 ec-canvas */
    initChart() {
      const ecComp = this.selectComponent('#ec-canvas') as unknown as {
        init: (
          callback: (
            canvas: unknown,
            width: number,
            height: number,
            dpr: number,
          ) => echarts.ECharts,
        ) => void;
      } | null;

      if (!ecComp) {
        // ec-canvas 尚未就绪, 延迟重试
        setTimeout(() => this.initChart(), 300);
        return;
      }

      ecComp.init((canvas, width, height, dpr) => {
        const chart = echarts.init(canvas as unknown as HTMLElement, null, {
          width,
          height,
          dpr,
        });
        // chart 实例不可序列化, 存为实例属性而非 data
        this.chartInstance = chart;
        this.setData({ initialized: true });
        this.updateChart();
        return chart;
      });
    },

    /** 中位持有月数 (用于 budget 元 → 月均成本 换算) */
    medianHoldingMonths(points: PlanPoint[]): number {
      if (points.length === 0) return 36;
      const months = points.map((p) => p.holdingMonths).sort((a, b) => a - b);
      const mid = Math.floor(months.length / 2);
      return months.length % 2 === 0 ? (months[mid - 1] + months[mid]) / 2 : months[mid];
    },

    /** 更新图表 option */
    updateChart() {
      const chart = this.chartInstance;
      if (!chart) return;

      const frontier = this.properties.frontier as PlanPoint[];
      const dominated = this.properties.dominated as PlanPoint[];
      const recRange = this.properties.recommendationRange as RecommendationRange | null;
      const perfFloor = this.properties.performanceFloor as number;
      const budget = this.properties.budget as number;

      const allPoints = [...frontier, ...dominated];
      if (allPoints.length === 0) return;

      // 计算坐标轴范围
      const costs = allPoints.map((p) => p.monthlyCost);
      const perfs = allPoints.map((p) => p.avgPerformance * 100);

      const minCost = Math.min(...costs);
      const maxCost = Math.max(...costs);
      const minPerf = Math.min(...perfs);
      const maxPerf = Math.max(...perfs);

      const costPadding = Math.max((maxCost - minCost) * 0.15, 10);
      const perfPadding = Math.max((maxPerf - minPerf) * 0.15, 5);

      const round1 = (n: number) => Math.round(n * 10) / 10;

      // 前沿连线(按成本升序, 用全部前沿点)
      const frontierLine = [...frontier]
        .sort((a, b) => a.monthlyCost - b.monthlyCost)
        .map((p) => [p.monthlyCost, p.avgPerformance * 100]);

      // 按 candidateType 拆分前沿点 (不 round 坐标, 避免点位重叠导致点击失效)
      const typeAData = frontier
        .filter((p) => p.candidateType !== 'B' && p.candidateType !== 'C')
        .map((p) => ({
          name: this.formatPointName(p),
          value: [p.monthlyCost, p.avgPerformance * 100, p.buyPrice, p],
        }));
      const typeBCData = frontier
        .filter((p) => p.candidateType === 'B' || p.candidateType === 'C')
        .map((p) => ({
          name: this.formatPointName(p),
          value: [p.monthlyCost, p.avgPerformance * 100, p.buyPrice, p],
          // 类型 B 三角形, 类型 C 菱形
          symbol: p.candidateType === 'B' ? 'triangle' : 'diamond',
        }));

      // 被支配数据(灰显 + 细描边让位置可见)
      const dominatedData = dominated.map((p) => ({
        name: this.formatPointName(p),
        value: [p.monthlyCost, p.avgPerformance * 100, p.buyPrice, p],
      }));

      // 推荐区间 markArea (cost ∈ [lowerCost, upperCost])
      const markArea =
        recRange && recRange.lowerCost !== undefined && recRange.upperCost !== undefined
          ? {
              silent: true,
              itemStyle: {
                color: C_REC_BAND,
                opacity: 0.12,
              },
              data: [[{ xAxis: round1(recRange.lowerCost) }, { xAxis: round1(recRange.upperCost) }]],
            }
          : undefined;

      // 推荐区间高亮点 markPoint (画在 typeA series 上, 描边圈出, 携带 plan 引用供点击)
      const recMarkPoints =
        recRange && recRange.plans && recRange.plans.length > 0
          ? recRange.plans.map((p) => ({
              coord: [p.monthlyCost, p.avgPerformance * 100],
              symbol: 'circle',
              symbolSize: 28,
              itemStyle: { color: 'transparent', borderColor: C_SUCCESS, borderWidth: 2 },
              label: { show: false },
              plan: p,
            }))
          : [];

      // markLine: 性能地板(水平) + 预算(垂直, 换算为月均成本)
      const markLineData: unknown[] = [];
      if (perfFloor > 0) {
        markLineData.push({
          yAxis: round1(perfFloor * 100),
          label: {
            formatter: `性能地板 ${Math.round(perfFloor * 100)}%`,
            position: 'insideEnd',
            color: C_SUCCESS,
            fontSize: 10,
          },
        });
      }
      if (budget > 0) {
        const medianMonths = this.medianHoldingMonths(allPoints);
        const budgetMonthly = round1(budget / medianMonths);
        markLineData.push({
          xAxis: budgetMonthly,
          label: {
            formatter: `预算 ${budgetMonthly}/月`,
            position: 'insideEnd',
            color: C_WARN,
            fontSize: 10,
          },
        });
      }

      const markLine =
        markLineData.length > 0
          ? {
              symbol: 'none',
              silent: true,
              lineStyle: { type: 'dashed', width: 1.5 },
              data: markLineData,
            }
          : undefined;

      const option: echarts.EChartOption = {
        backgroundColor: 'transparent',
        // 关闭 tooltip 与缩放交互
        tooltip: { show: false },
        grid: {
          left: 38,
          right: 40,
          top: 20,
          bottom: 50,
          containLabel: true,
        },
        xAxis: {
          type: 'value',
          name: '月均成本(元/月)',
          nameLocation: 'middle',
          nameGap: 30,
          nameTextStyle: { color: C_MUTED, fontSize: 11 },
          min: Math.max(0, Math.floor((minCost - costPadding) / 10) * 10),
          max: Math.ceil((maxCost + costPadding) / 10) * 10,
          axisLine: { lineStyle: { color: C_BORDER } },
          axisLabel: { color: C_MUTED, fontSize: 11 },
          splitLine: { lineStyle: { color: C_BORDER, type: 'dashed' } },
          scale: true,
        },
        yAxis: {
          type: 'value',
          name: '性能(%)',
          nameLocation: 'middle',
          nameGap: 28,
          nameTextStyle: { color: C_MUTED, fontSize: 11 },
          min: Math.max(0, Math.floor(minPerf - perfPadding)),
          max: Math.min(100, Math.ceil(maxPerf + perfPadding)),
          axisLine: { lineStyle: { color: C_BORDER } },
          axisLabel: { color: C_MUTED, fontSize: 11 },
          splitLine: { lineStyle: { color: C_BORDER, type: 'dashed' } },
          scale: true,
        },
        series: [
          // 0. 前沿连线(虚线) + 推荐区间色带 markArea + markLine
          {
            type: 'line',
            data: frontierLine,
            symbol: 'none',
            lineStyle: { color: C_PRIMARY, type: 'dashed', width: 1.5 },
            silent: true,
            markArea: markArea,
            markLine: markLine,
          },
          // 1. 类型 A 前沿点(实心圆 品牌蓝) + 推荐区间 markPoint
          {
            name: '前沿方案',
            type: 'scatter',
            symbol: 'circle',
            symbolSize: 22,
            itemStyle: { color: C_PRIMARY },
            data: typeAData,
            markPoint: recMarkPoints.length > 0 ? { data: recMarkPoints } : undefined,
          },
          // 2. 类型 B/C 前沿点(三角形/菱形 浅蓝半透明)
          {
            name: '等新品方案',
            type: 'scatter',
            symbolSize: 18,
            itemStyle: { color: C_WAIT, opacity: 0.7 },
            data: typeBCData,
          },
          // 3. 被支配点(灰色半透明 + 细描边)
          {
            name: '已排除方案',
            type: 'scatter',
            symbol: 'circle',
            symbolSize: 12,
            itemStyle: { color: C_GRAY, opacity: 0.5, borderColor: C_BORDER, borderWidth: 1 },
            data: dominatedData,
          },
        ],
      };

      chart.setOption(option, true);

      // 绑定点击事件 (覆盖前沿 A / 等新品 B/C / 被支配 / markPoint 四类)
      chart.off('click');
      chart.on('click', (params: { componentType: string; data?: { value?: unknown[]; plan?: PlanPoint } }) => {
        // markPoint 点击 (绿色推荐圈)
        if (params.componentType === 'markPoint' && params.data && params.data.plan) {
          this.triggerEvent('pointtap', { plan: params.data.plan });
          return;
        }
        // 散点系列点击
        if (
          params.componentType === 'series' &&
          params.data &&
          params.data.value &&
          params.data.value[3]
        ) {
          this.triggerEvent('pointtap', { plan: params.data.value[3] });
        }
      });
    },

    /** 格式化点位名称 */
    formatPointName(p: PlanPoint): string {
      const base = p.model.replace(/\s*×\s*\d+年$/, '').replace(/_/g, ' ');
      return `${base} · ${p.holdingYears}年`;
    },
  },
});
