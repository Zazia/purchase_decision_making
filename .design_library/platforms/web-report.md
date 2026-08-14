# HTML 报告适配指南

> **层级：Layer 2** | HTML 报告与静态网页的令牌引用与组件使用。
>
> 上游：`design.md` → `.design_library/README.md` → `tokens.md` → **本文件**

---

## 1. 单位

HTML 报告使用 `px`，直接引用 `tokens.md` 中的原始值，无需换算。

---

## 2. CSS 变量

在 `<style>` 顶部定义全部令牌，全文仅使用这些变量，不硬编码色值：

```css
:root {
  /* 中性色 */
  --bg:      #F5F5F7;  --surface: #FFFFFF;  --rule: #D2D2D8;
  --muted:   #86868F;  --fg:      #1D1D1F;
  /* 品牌蓝 */
  --accent:  #007AFF;  --accent-hover: #0063D4;  --accent-soft: #E6F2FF;
  /* 语义色 */
  --success: #2A8A61;  --success-soft: #D9F0E3;
  --warning: #E09500;  --warning-soft: #FFF0C2;
  --error:   #F24B4B;  --error-soft:   #FFD9D9;
}
```

运行时 CSS 变量文件：`.design_library/apple-report/colors_and_type.css`，可直接 `<link>` 引入。

---

## 3. 字体加载

通过 Google Fonts CDN 加载：

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
```

或使用 `@import`：

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
```

降级链：正文 → `PingFang SC` / `Microsoft YaHei`，标题 → 系统无衬线体。

---

## 4. 组件使用

组件样式定义在 `.design_library/apple-report/components.css`，可直接引入或复制需要的部分。

### 4.1 引入方式

```html
<link rel="stylesheet" href="../.design_library/apple-report/colors_and_type.css">
<link rel="stylesheet" href="../.design_library/apple-report/components.css">
```

### 4.2 组件类名速查

| 组件 | 类名 | 变体 |
|------|------|------|
| 按钮 | `.btn .btn-{sm,md,lg} .btn-{primary,soft,ghost,outline}` | 3 尺寸 × 4 变体 |
| 卡片 | `.card` `.card-raised` | default / raised |
| 表格 | `.report-table` `.report-table--compact` | default / compact |
| 徽章 | `.badge .badge-{default,success,warning,error}` | 4 语义 |
| 导航 | `.top-nav` `.side-nav` `.nav-item` | top / side |
| 图表 | `.chart` `.chart-{bar,line,area}` | 3 标记类型 |

### 4.3 卡片示例

```html
<article class="card">
  <div class="card-header">
    <h4 class="card-title">关键指标</h4>
    <span class="card-caption">本月</span>
  </div>
  <div class="card-body">
    <p class="card-metric">12,480</p>
    <span class="card-change">+8.2%</span>
  </div>
  <div class="card-footer">较上月增长</div>
</article>
```

### 4.4 预览参考

各组件的完整预览页面位于 `.design_library/apple-report/preview/`，可直接打开查看渲染效果。

---

## 5. 报告页面结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>报告标题</title>
  <link rel="stylesheet" href="colors_and_type.css">
  <link rel="stylesheet" href="components.css">
</head>
<body>
  <nav class="top-nav">
    <div class="brand">报告标题</div>
    <div class="actions"><button class="btn btn-md btn-primary">导出报告</button></div>
  </nav>
  <main style="max-width: 1200px; margin: 0 auto; padding: 24px;">
    <!-- 卡片区 -->
    <!-- 表格区 -->
    <!-- 图表区 -->
  </main>
</body>
</html>
```

---

## 6. 现有报告参照

| 产物 | 路径 | 说明 |
|------|------|------|
| 苹果产品购买决策报告 | `.agents/skills/apple-value-analysis/2026-08-03-苹果产品购买决策报告.html` | 完整 HTML 报告示例 |
| Dashboard 原型 | `.design_library/apple-report/ui_kits/dashboard/index.html` | 组件组合验证套件 |
| 组件预览 | `.design_library/apple-report/preview/component-*.html` | 单组件渲染预览 |

---

## 7. 暗色模式

`.design_library/apple-report/colors_and_type.css` 已定义 `.dark` 类的暗色覆盖。需要暗色模式时在 `<body>` 添加 `class="dark"`：

```css
/* 已内置的暗色覆盖（摘录） */
.dark { --report-gray-50: #1D1D1F; --surface: var(--report-gray-800); }
.dark { --report-blue-500: #3B8BFF; }
```

> 项目当前以浅色模式为主，暗色模式为预留能力。
