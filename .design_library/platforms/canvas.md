# Canvas / ECharts 适配指南

> **层级：Layer 2** | Canvas 绘制与 ECharts 图表的色彩与字体适配。
>
> 上游：`design.md` → `.design_library/README.md` → `tokens.md` → **本文件**

---

## 1. Canvas 色彩

Canvas 2D API 使用字符串色值，直接引用 `tokens.md` 中的 HEX。

### 1.1 常量定义

```typescript
// 分享卡 Canvas 绘制时使用的色彩常量
const COLORS = {
  bg:        '#F5F5F7',
  surface:   '#FFFFFF',
  fg:        '#1D1D1F',
  muted:     '#86868F',
  rule:      '#D2D2D8',
  accent:    '#007AFF',
  accentHover: '#0063D4',
  accentSoft:'#E6F2FF',
  success:   '#2A8A61',
  successSoft:'#D9F0E3',
  warning:   '#E09500',
  warningSoft:'#FFF0C2',
  error:     '#F24B4B',
  errorSoft: '#FFD9D9',
};
```

### 1.2 绘制要点

- 背景填充：`ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, w, h);`
- 卡片圆角：使用 `ctx.roundRect(x, y, w, h, radius)` — 圆角值 `20`（对应 `radius-xl`）
- 文字：`ctx.fillStyle = COLORS.fg; ctx.font = '600 32px sans-serif';`
- 次级文字：`ctx.fillStyle = COLORS.muted; ctx.font = '400 24px sans-serif';`
- 分隔线：`ctx.strokeStyle = COLORS.rule; ctx.lineWidth = 1;`

### 1.3 分享卡字体

Canvas 中使用系统字体，不依赖外部加载：

```typescript
ctx.font = '600 36px -apple-system, "PingFang SC", sans-serif';  // 标题
ctx.font = '400 28px -apple-system, "PingFang SC", sans-serif';  // 正文
ctx.font = '400 22px -apple-system, "PingFang SC", sans-serif';  // 注解
```

---

## 2. ECharts 配置

### 2.1 色彩常量

```typescript
const C = {
  PRIMARY:    '#007AFF',
  ACCENT_SOFT:'#E6F2FF',
  MUTED:      '#86868F',
  BORDER:     '#D2D2D8',
  GRAY:       '#C7C7CC',
  SUCCESS:    '#2A8A61',
  WARNING:    '#E09500',
  ERROR:      '#F24B4B',
};

const PALETTE = ['#007AFF', '#8E8E93', '#2A8A61', '#E09500', '#AF52DE', '#5856D6'];
```

### 2.2 baseOption 模板

所有图表 `setOption` 时**必须合并** baseOption，不重写 grid / axis / tooltip / legend / textStyle：

```typescript
const baseOption = {
  color: PALETTE,
  grid: { left: 48, right: 24, top: 40, bottom: 56, containLabel: true },
  textStyle: { fontFamily: 'sans-serif', color: C.MUTED, fontSize: 11 },
  tooltip: {
    trigger: 'item',
    backgroundColor: '#FFFFFF',
    borderColor: C.BORDER,
    textStyle: { color: '#1D1D1F', fontSize: 12 },
    extraCssText: 'box-shadow: 0 2px 8px rgba(29,29,31,0.08); border-radius: 8px;',
  },
  legend: { textStyle: { color: C.MUTED, fontSize: 11 } },
  xAxis: {
    axisLine: { lineStyle: { color: C.BORDER } },
    axisLabel: { color: C.MUTED, fontSize: 11 },
    splitLine: { show: false },
  },
  yAxis: {
    axisLine: { show: false },
    axisLabel: { color: C.MUTED, fontSize: 11 },
    splitLine: { lineStyle: { color: C.BORDER, type: 'dashed' } },
  },
};
```

### 2.3 图表高度

| 图表类型 | 高度 |
|----------|------|
| 核心帕累托图 | 430px |
| 辅助图 | 330px |
| 移动端统一 | 360px |

### 2.4 标注模板

用户偏好标注（性能地板 / 预算上限）：

```typescript
markLine: {
  symbol: 'none', silent: true,
  lineStyle: { color: C.SUCCESS, type: 'dashed', width: 1.5 },
  data: [
    { yAxis: 50, label: { formatter: '性能地板 50%', color: C.SUCCESS } }
  ],
}
```

等待方案标注（三角形标记）：

```typescript
{
  name: '等M5后持24月', value: [100, 55, 4000],
  symbol: 'triangle', symbolSize: 14,
  itemStyle: { color: C.SUCCESS },
  label: { show: true, formatter: '等新品', position: 'top', fontSize: 10, color: C.SUCCESS },
}
```

---

## 3. 色彩语义规则（图表专属）

| 场景 | 颜色 | 说明 |
|------|------|------|
| 前沿点 / 主数据线 | `#007AFF` | 永远是品牌蓝 |
| 被支配点 | `#C7C7CC` 半透明 | 灰色 |
| 性能地板 / 等待方案 | `#2A8A61` | 成功绿 |
| 超支持期边框 | `#E09500` | 警告琥珀，不用红色 |
| 被支配语义 | `#F24B4B` | 错误红（仅此语义） |
| 长持有期（>36 月） | `opacity: 0.6` | 标注预测置信度低 |

---

## 4. 现有代码参照

| 产物 | 路径 | 说明 |
|------|------|------|
| 帕累托图组件 | `miniapp/wx/components/pareto-chart/pareto-chart.ts` | ECharts 帕累托散点图 |
| 分享卡画布 | `miniapp/wx/components/share-card-canvas/share-card-canvas.ts` | Canvas 2D 分享卡绘制 |
| 长图导出 | `miniapp/wx/services/long-image-export.ts` | 长图 Canvas 导出服务 |
| ECharts 引擎 | `miniapp/wx/vendor/apple-value-engine/pareto.js` | 帕累托计算与数据组装 |
| design_tokens | `miniapp/wx/snapshot/constants.json` → `design_tokens.echarts` | ECharts 配置的唯一权威源 |

---

## 5. ECharts 与 Canvas 差异

| 特性 | ECharts | Canvas 2D |
|------|---------|-----------|
| 配置方式 | JSON option 对象 | 命令式 API 调用 |
| 字体 | option.textStyle.fontFamily | `ctx.font` |
| 颜色 | option 内 `color` 字段 | `ctx.fillStyle / strokeStyle` |
| 圆角 | option.itemStyle.borderRadius | `ctx.roundRect()` |
| 阴影 | option.itemStyle.shadowBlur | `ctx.shadowBlur / shadowColor` |
| 动画 | 内置 animation | 手动 requestAnimationFrame |
