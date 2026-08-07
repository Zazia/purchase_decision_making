// components/pareto-chart/pareto-chart.ts
// ec-canvas 帕累托散点图组件: 前沿实心品牌色 + 被支配灰显 + 推荐区间边框, 关闭 tooltip/缩放

import * as echarts from '../ec-canvas/echarts';

/** 与 PlanPoint 对齐的方案点 */
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

Component({
  properties: {
    frontier: { type: Array, value: [] },
    dominated: { type: Array, value: [] },
    recommendationRange: { type: Object, value: null },
    performanceFloor: { type: Number, value: 0 },
  },

  data: {
    ec: { lazyLoad: true } as { lazyLoad: boolean },
    initialized: false,
  },

  // chartInstance 存为组件实例属性 (非 data), 因为 ECharts 对象不可序列化,
  // 放入 data 会导致 setData 部分失败 (initialized 字段不会更新)
  chartInstance: null as echarts.ECharts | null,

  observers: {
    'frontier, dominated, recommendationRange, performanceFloor': function () {
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

    /** 更新图表 option */
    updateChart() {
      const chart = this.chartInstance;
      if (!chart) return;

      const frontier = this.properties.frontier as PlanPoint[];
      const dominated = this.properties.dominated as PlanPoint[];
      const recRange = this.properties.recommendationRange as RecommendationRange | null;
      const perfFloor = this.properties.performanceFloor as number;

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

      // 前沿数据(含原始 plan 用于点击事件)
      const frontierData = frontier.map((p) => ({
        name: this.formatPointName(p),
        value: [
          Math.round(p.monthlyCost * 10) / 10,
          Math.round(p.avgPerformance * 1000) / 10,
          p.buyPrice,
          p, // 原始数据, 用于点击跳转
        ],
      }));

      // 被支配数据
      const dominatedData = dominated.map((p) => ({
        name: this.formatPointName(p),
        value: [
          Math.round(p.monthlyCost * 10) / 10,
          Math.round(p.avgPerformance * 1000) / 10,
          p.buyPrice,
          p,
        ],
      }));

      // 前沿连线(按成本升序)
      const frontierLine = [...frontier]
        .sort((a, b) => a.monthlyCost - b.monthlyCost)
        .map((p) => [
          Math.round(p.monthlyCost * 10) / 10,
          Math.round(p.avgPerformance * 1000) / 10,
        ]);

      // 推荐区间内的点 key 集合
      const recKeys = new Set(
        recRange && recRange.plans
          ? recRange.plans.map((p) => `${p.model}-${p.holdingYears}`)
          : [],
      );

      // 推荐区间高亮点(markPoint)
      const recMarkPoints =
        recRange && recRange.plans && recRange.plans.length > 0
          ? recRange.plans.map((p) => ({
              coord: [
                Math.round(p.monthlyCost * 10) / 10,
                Math.round(p.avgPerformance * 1000) / 10,
              ],
              symbol: 'circle',
              symbolSize: 28,
              itemStyle: {
                color: 'transparent',
                borderColor: C_SUCCESS,
                borderWidth: 2,
              },
              label: { show: false },
            }))
          : [];

      // 性能地板 markLine
      const markLineData =
        perfFloor > 0
          ? [
              {
                yAxis: Math.round(perfFloor * 1000) / 10,
                label: {
                  formatter: `性能地板 ${Math.round(perfFloor * 100)}%`,
                  color: C_SUCCESS,
                  fontSize: 10,
                },
              },
            ]
          : [];

      const option: echarts.EChartOption = {
        backgroundColor: 'transparent',
        // 关闭 tooltip 与缩放交互
        tooltip: { show: false },
        grid: {
          left: 40,
          right: 20,
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
          nameGap: 35,
          nameTextStyle: { color: C_MUTED, fontSize: 11 },
          min: Math.max(0, Math.floor(minPerf - perfPadding)),
          max: Math.min(100, Math.ceil(maxPerf + perfPadding)),
          axisLine: { lineStyle: { color: C_BORDER } },
          axisLabel: { color: C_MUTED, fontSize: 11 },
          splitLine: { lineStyle: { color: C_BORDER, type: 'dashed' } },
          scale: true,
        },
        series: [
          // 1. 前沿连线(虚线)
          {
            type: 'line',
            data: frontierLine,
            symbol: 'none',
            lineStyle: {
              color: C_PRIMARY,
              type: 'dashed',
              width: 1.5,
            },
            silent: true,
          },
          // 2. 前沿点(实心品牌色 + 推荐区间边框 markPoint)
          {
            name: '前沿方案',
            type: 'scatter',
            symbol: 'circle',
            symbolSize: 16,
            itemStyle: { color: C_PRIMARY },
            data: frontierData,
            markPoint: recMarkPoints.length > 0 ? { data: recMarkPoints } : undefined,
            markLine:
              markLineData.length > 0
                ? {
                    symbol: 'none',
                    silent: true,
                    lineStyle: {
                      color: C_SUCCESS,
                      type: 'dashed',
                      width: 1.5,
                    },
                    data: markLineData,
                  }
                : undefined,
          },
          // 3. 被支配点(灰色半透明)
          {
            name: '已排除方案',
            type: 'scatter',
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: { color: C_GRAY, opacity: 0.5 },
            data: dominatedData,
          },
        ],
      };

      chart.setOption(option, true);

      // 绑定点击事件
      chart.off('click');
      chart.on('click', (params: { componentType: string; data?: { value?: unknown[] } }) => {
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
