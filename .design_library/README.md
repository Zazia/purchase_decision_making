# 设计库总览

> **层级：Layer 1** | 项目视觉规范的入口与文件索引。
>
> 上游：`design.md` → **本文件** → `tokens.md` / `platforms/*.md`

本设计库是项目所有视觉产物的统一规范源。它从一份 Apple 风格 Dashboard 设计套件演化而来，现已泛化为覆盖**小程序界面、HTML 报告、Canvas 分享卡、ECharts 图表**四大场景的项目级视觉规范。

---

## 设计哲学

**浅色 Apple 质感**：柔和灰白背景、低饱和品牌蓝点睛、大圆角卡片、细微阴影、大量留白。既不冷淡，也不过度活泼。专业、克制、可读。

三条核心原则：

1. **单一主色承担行动指向** — `#007AFF` 是唯一的品牌蓝，用于按钮、链接、图表主数据线。不引入第二个主色争抢注意力。
2. **语义色仅作点缀** — 成功绿、警告琥珀、错误红只出现在徽章和状态标签中，不大面积填充。
3. **几乎感觉不到的分层** — 阴影轻到能区分层级但不制造拟物深度。hover 通过亮度滤镜而非更换背景色实现。

---

## 设计 DNA 速览

| 维度 | 核心值 | 详见 |
|------|--------|------|
| 主色 | `#007AFF`（品牌蓝） | `tokens.md` §1.2 |
| 背景 | `#F5F5F7` / 卡片 `#FFFFFF` | `tokens.md` §1.1 |
| 字体 | DM Sans（标题）/ Inter（正文）/ JetBrains Mono（数值） | `tokens.md` §2 |
| 间距 | 4px 基点，序列 4/8/12/16/24/32/48/64 | `tokens.md` §3 |
| 圆角 | 控件 8px → 按钮 12px → 卡片 20px → 药丸 9999px | `tokens.md` §4 |
| 阴影 | 5 层，`rgba(29,29,31,…)` 蓝调深灰 | `tokens.md` §5 |
| 动效 | 0.15s 过渡，`background` / `filter` 属性 | `tokens.md` §7 |
| 语调 | 中文优先、专业、克制、不用 emoji | `tokens.md` §8 |

---

## 组件清单

6 个核心组件，覆盖数据报告与小程序中最常用的操作、容器、数据展示与状态标识。

| 组件 | 类别 | 变体数 | 核心特征 | 契约文件 |
|------|------|--------|----------|----------|
| Button | action | 12（3 尺寸 × 4 变体） | 实心蓝主按钮 / ghost 次级 / outline 边框 | `apple-report/components/button.json` |
| Card | surface | 2（default / raised） | 20px 圆角、shadow-1、hover 亮度滤镜 | `apple-report/components/card.json` |
| Table | data | 2（default / compact） | 16px 外圆角、行 hover、浅色分隔线 | `apple-report/components/table.json` |
| Chart | data | 3（bar / line / area） | 极简调色板、单一品牌色 | `apple-report/components/chart.json` |
| Navigation | navigation | 2（top / side） | 激活态浅灰背景 | `apple-report/components/navigation.json` |
| Badge | status | 4（default / success / warning / error） | 24px 高、药丸圆角、柔和背景 | `apple-report/components/badge.json` |

> 小程序中额外使用 4 种项目专属徽章（新机 / 二手 / 持有期 / 等待候选），见 `platforms/miniprogram.md` §2.2。

---

## 平台适配

同一套令牌，三种平台各有适配指南：

| 平台 | 单位 | 字体 | 适配指南 |
|------|------|------|----------|
| 微信小程序 | `rpx` | 系统字体 | `platforms/miniprogram.md` |
| HTML 报告 | `px` | Google Fonts CDN | `platforms/web-report.md` |
| Canvas / ECharts | 字符串色值 | 系统 / option | `platforms/canvas.md` |

---

## 文件结构

```
.design_library/
├── README.md                    ← 本文件（Layer 1：总览）
├── tokens.md                   ← 规范化令牌源（Layer 2：色彩/字体/间距/圆角/阴影）
├── platforms/
│   ├── miniprogram.md          ← 小程序适配（rpx、WXSS、系统字体）
│   ├── web-report.md           ← HTML 报告适配（px、CSS 变量、CDN 字体）
│   └── canvas.md               ← Canvas / ECharts 适配（色值常量、baseOption）
├── apple-report/               ← 参考 UI 套件（Web Dashboard 样本）
│   ├── README.md               ← 品牌叙事与视觉基础（原始记录）
│   ├── SKILL.md                ← AI Agent 技能入口
│   ├── css.json                ← 结构化 Token 数据
│   ├── colors_and_type.css     ← 运行时 CSS 变量（Web 直接引入）
│   ├── components.css           ← 聚合组件样式
│   ├── components/              ← 组件契约 JSON
│   ├── preview/                ← 组件预览 HTML
│   └── ui_kits/dashboard/      ← Dashboard 可点击原型
```

---

## 消费方式（分层披露）

**不要一次性读完所有文件。** 按任务需要逐层深入：

### 场景 A：修改小程序界面样式

1. 读 `tokens.md` 确认要用的色值 / 间距 / 圆角
2. 读 `platforms/miniprogram.md` 查看 rpx 换算与 WXSS 模式
3. 参照 `platforms/miniprogram.md` §7 中的现有代码路径

### 场景 B：制作 HTML 报告

1. 读 `tokens.md` 确认设计 DNA
2. 读 `platforms/web-report.md` 查看 CSS 变量引入与组件类名
3. 可选：打开 `apple-report/preview/component-*.html` 查看组件渲染效果

### 场景 C：绘制 Canvas 分享卡 / ECharts 图表

1. 读 `tokens.md` §1.4 确认 ECharts 调色板
2. 读 `platforms/canvas.md` 查看色彩常量、baseOption 模板与标注模板

### 场景 D：新增组件或调整设计系统

1. 读本文件了解组件清单与文件结构
2. 读 `tokens.md` 确认令牌一致性
3. 读对应平台的适配指南确认实现可行性
4. 更新 `tokens.md`（令牌源）+ 对应平台指南 + `apple-report/components/` 契约

---

## 与 constants.json 的关系

`miniapp/wx/snapshot/constants.json` 的 `design_tokens` 字段是**报告视觉与图表实现细节的唯一权威源**（CSS 代码块、组件伪代码、ECharts baseOption、图表模板）。本设计库与 `design_tokens` 保持一致：

- 令牌值（色彩、字体、间距）以 `tokens.md` 为准
- 可复制代码块以 `constants.json` → `design_tokens` 为准
- 两者冲突时，以 `constants.json` → `design_tokens` 为准并回写修正本库
