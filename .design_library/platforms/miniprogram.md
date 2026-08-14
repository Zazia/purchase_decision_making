# 小程序适配指南

> **层级：Layer 2** | 微信小程序（WXSS / WXML / TS）平台的令牌换算与组件模式。
>
> 上游：`design.md` → `.design_library/README.md` → `tokens.md` → **本文件**

---

## 1. 单位换算

小程序使用 `rpx`（responsive pixel），屏幕宽度固定为 750rpx。以 375px 设计稿为基准：

```
rpx = px × 2
```

| 令牌（px） | 小程序（rpx） | 说明 |
|------------|--------------|------|
| 4px | 8rpx | 最小间距 |
| 8px | 16rpx | 组件内间距 |
| 12px | 24rpx | 卡片间距 |
| 16px | 32rpx | 常规内边距 |
| 24px | 48rpx | 模块间距 |
| 32px | 64rpx | 页面分区 |
| 40px | 80rpx | 按钮高度 |
| 20px | 40rpx | 卡片圆角 |
| 12px | 24rpx | 按钮圆角 |

> 实际项目中页面内边距常用 `24rpx`（≈12px），卡片内边距 `28-32rpx`（≈14-16px）。

---

## 2. 色彩使用

WXSS 中直接使用 HEX 值（不使用 CSS 变量），确保兼容性。

### 2.1 常用色值速查

| 用途 | HEX | 备注 |
|------|-----|------|
| 页面背景 | `#F5F5F7` | `.container { background: #F5F5F7; }` |
| 卡片表面 | `#FFFFFF` | `background: #FFFFFF;` |
| 次级卡片背景 | `#F5F5F7` | 方案卡片 `.plan-card` |
| 主文字 | `#1D1D1F` | |
| 次级文字 | `#86868F` | 说明、状态文字 |
| 分隔线 / 边框 | `#D2D2D8` | |
| 品牌蓝 | `#007AFF` | 按钮、链接、选中态 |
| 品牌蓝 hover | `#0063D4` | `:active` 态 |
| 浅蓝背景 | `#E6F2FF` | 选中态背景 |
| 成功绿 | `#2A8A61` | 徽章文字 |
| 成功绿背景 | `#D9F0E3` | 徽章背景 |
| 警告琥珀 | `#E09500` | 徽章文字 |
| 警告背景 | `#FFF0C2` | 空态卡片背景 |
| 错误红 | `#F24B4B` | 错误提示文字 |
| 错误红背景 | `#FFD9D9` | 徽章背景 |

### 2.2 项目专属徽章色

| 徽章类型 | 背景 | 文字 | 用途 |
|----------|------|------|------|
| 新机 | `#D9F0E3` | `#2A8A61` | badge-new |
| 二手 | `#FFD9D9` | `#9F1239` | badge-used |
| 持有期 | `#F5F5F7` | `#86868F` | badge-hold（灰色，不用品牌蓝） |
| 等待候选 | `#FFE9D1` | `#C25E00` | badge-wait |
| 预测值标 | — | `#86868F` | 小字标注，字号 18rpx |

### 2.3 持有期按钮

持有期筛选按钮**必须使用灰色**，不使用品牌蓝：

- 未选中：文字 `#86868F`，背景 `#F5F5F7`，边框 `#D1D1D6`
- 选中：文字 `#FFFFFF`，背景 `#86868F`
- 禁用：`#D1D1D6`

---

## 3. 字体

小程序无法引入外部字体 CDN，使用系统字体栈：

```css
/* WXSS 中直接使用系统字体，无需 @import */
font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
```

### 字号映射

| 令牌 | 设计 px | 小程序 rpx | 字重 |
|------|---------|-----------|------|
| h2 | 32 | 64rpx | 600 |
| h3 | 24 | 48rpx | 600 |
| h4 | 20 | 40rpx | 600 |
| body | 16 | 32rpx | 400 |
| caption | 12 | 24rpx | 400 |

> 实际项目中页面标题常用 `36rpx`（≈18px），正文 `30rpx`（≈15px），注解 `24-26rpx`。

---

## 4. 阴影

rpx 偏移量按比例换算：

```css
/* shadow-1 卡片静息态 */
box-shadow: 0 1rpx 4rpx rgba(29, 29, 31, 0.06);

/* shadow-2 卡片 hover（小程序用 :active） */
box-shadow: 0 2rpx 8rpx rgba(29, 29, 31, 0.08);

/* 模态框 */
box-shadow: 0 8rpx 20rpx rgba(29, 29, 31, 0.14);
```

---

## 5. 组件模式

### 5.1 卡片

```css
/* 标准卡片 — 对应 tokens.md radius-xl + shadow-1 */
.card {
  background: #FFFFFF;
  border-radius: 20rpx;        /* radius-xl: 20px → 40rpx，实际用 20rpx */
  padding: 32rpx 28rpx;       /* space-4: 16px → 32rpx */
  margin-bottom: 24rpx;
  box-shadow: 0 1rpx 4rpx rgba(29, 29, 31, 0.06);
}

/* 次级卡片（方案列表项） */
.plan-card {
  background: #F5F5F7;
  border-radius: 16rpx;        /* radius-lg */
  padding: 24rpx 20rpx;
  border: 2rpx solid transparent;
  transition: all 0.15s ease;
}
.plan-card:active {
  background: #E6F2FF;         /* blue-50 */
  border-color: #007AFF;
}
```

### 5.2 徽章

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;       /* radius-full */
  font-size: 24rpx;            /* caption: 12px */
  line-height: 1.4;
}
```

### 5.3 按钮

```css
/* 主按钮 */
.btn-primary {
  background: #007AFF;
  color: #FFFFFF;
  font-size: 30rpx;
  border-radius: 999rpx;       /* 药丸形 */
  padding: 20rpx 64rpx;
}
.btn-primary:active {
  background: #0063D4;
}

/* 次级按钮（ghost） */
.btn-ghost {
  background: transparent;
  color: #007AFF;
  border: 2rpx solid #D2D2D8;
  border-radius: 16rpx;
}
```

### 5.4 加载动画

```css
.loading-spinner {
  width: 64rpx;
  height: 64rpx;
  border: 6rpx solid #D2D2D8;
  border-top-color: #007AFF;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### 5.5 复制高亮动画

复制方案时的新增方案组必须播放 1.2s 高亮动画：

```css
@keyframes copy-highlight {
  0%   { background: #E6F2FF; transform: scale(1); }
  30%  { background: #E6F2FF; transform: scale(1.02); }
  100% { background: #F5F5F7; transform: scale(1); }
}
.copy-highlight {
  animation: copy-highlight 1.2s ease forwards;
}
```

---

## 6. 页面结构约定

### 6.1 通用页面骨架

```
.container          → min-height: 100vh, background: #F5F5F7, padding: 24rpx 24rpx 80rpx
  .state-wrap       → 加载/错误/空态容器（flex 居中）
  .header-card      → 白色卡片，承载标题与徽章
  .conclusion-card  → 白色卡片，承载结论
  .plan-list        → 方案列表（flex column, gap: 20rpx）
```

### 6.2 导航

小程序使用原生 `tabBar`，不自定义导航栏。页面内导航通过页面跳转实现，激活态使用浅灰背景 `#F5F5F7` 而非高饱和主色填充。

### 6.3 空态卡片

```css
.empty-card {
  background: #FFF0C2;        /* warning-soft */
  border-radius: 20rpx;
  padding: 40rpx 32rpx;
  text-align: center;
}
```

---

## 7. 现有代码参照

小程序中已实现对齐本规范的页面：

| 页面 | 路径 | 关键模式 |
|------|------|----------|
| 结果页 | `miniapp/wx/pages/result/result.wxss` | 方案卡片、筛选按钮、结论卡片、复制高亮 |
| 详情页 | `miniapp/wx/pages/detail/detail.wxss` | 标题卡片、徽章组、预测值标注 |
| 报告页 | `miniapp/wx/pages/report/report.wxss` | 报告容器、数据表格 |
| 分享卡 | `miniapp/wx/pages/share-card/share-card.wxss` | Canvas 分享卡布局 |
| 帕累托图 | `miniapp/wx/components/pareto-chart/` | ECharts 图表组件 |
| 分享卡画布 | `miniapp/wx/components/share-card-canvas/` | Canvas 绘制组件 |

> 新增页面或组件时，先参照上述已有实现的模式，保持视觉一致。

---

## 8. WXSS 与 CSS 差异速查

| 特性 | CSS（Web） | WXSS（小程序） |
|------|-----------|----------------|
| 单位 | `px`, `rem` | `rpx`, `px` |
| CSS 变量 | `var(--token)` | 支持但项目用硬编码值 |
| 字体引入 | `@import` Google Fonts | 不支持外部 `@import` |
| 伪类 | `:hover` | `:active`（移动端无 hover） |
| 全局样式 | `*` 选择器 | `page` 选择器 |
| 尺寸 | `100vh` | `100vh`（部分机型需适配） |
