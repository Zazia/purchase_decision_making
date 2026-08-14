# Apple Report 设计系统（参考 UI 套件）

> **定位**：本目录是项目设计库（`.design_library/`）中的 **Web Dashboard 参考样本**。
> 令牌的权威定义已上移至 `../tokens.md`；各平台适配指南在 `../platforms/`。
> 本文件保留原始品牌叙事与组件记录，作为 Web 端实现参考。需要查令牌时请从 `../../design.md` 入口进入。

Apple Report 是一个面向中文数据报告与仪表盘场景的轻量界面系统。它的核心用途是呈现销售看板、运营指标、趋势图表等需要「清晰可读、不过度装饰」的内容。整体气质借鉴了 Apple 的浅色质感：柔和的灰白背景、低饱和的蓝与薄荷绿点缀、大圆角卡片、细微阴影与大量留白，既不冷淡，也不过度活泼。

## Source

- **Brand owner:** Apple Report / 苹果报告
- **Product type:** Dashboard / Report
- **Kit type:** dashboard
- **原始素材:** 本次设计系统基于品牌分析阶段的结构化输出重建，未接入原始 Figma 源文件；组件与样式均从零推断并固化。

## What this design system covers

- **Foundations** — 以 `#007AFF` 为主色的 report 调色板、`DM Sans` + `Inter` + `JetBrains Mono` 字体栈、4px 基点的间距系统、8–20px 的圆角层级、5 级阴影。
- **Components** — 6 个记录组件：Button、Card、Table、Chart、Navigation、Badge，覆盖数据报告中最常用的操作、容器、数据展示与状态标识。
- **Sample slides & UI kit** — 一个 dashboard 类型的可点击原型套件，用于在真实报告布局中验证组件组合。

## 2. Content Fundamentals

### Voice & tone

文案以中文为主，语气干净、沉稳、专业且略带友好。标题倾向使用名词短语（如「月度销售报告」「关键指标」），操作按钮则使用动词开头（如「导出报告」「查看详情」），避免完整句式的说明性文案。整体不使用表情符号，数值和状态通过标签与徽章直接表达，减少冗余介词与装饰性形容词。

### Concrete copy examples

- 页面标题：*"月度销售报告"*
- 指标模块标题：*"关键指标"*
- 主要操作：*"导出报告"*
- 次级操作：*"查看详情"*
- 概览模块标题：*"数据概览"*

### When generating copy

- 标题优先使用 2–4 字的名词短语，避免完整句子。
- 操作按钮使用「动词 + 对象」结构，如「导出报告」而非「报告导出」。
- 不使用 emoji 或表情符号。
- 状态标签使用简短两字词，如「进行中」「已完成」「需注意」「已取消」。
- 数字说明保持克制，例如「本月」「较上月」即可，不必展开成长句。

## 3. Visual Foundations

### Color

品牌主色是 `report-blue-500` 的 `#007AFF`，hover 状态下沉到 `#0063D4`。这个蓝色饱和适中、偏冷，用于主要按钮、链接、图表数据线与图例点，承担界面中所有的「行动指向」。中性色从 `#F5F5F7` 到 `#1D1D1F` 共 9 阶，日常工作面主要使用 `#F5F5F7` 作为背景、`#FFFFFF` 作为卡片表面、`#D2D2D8` 作为分隔线、`#6E6E78` 作为次级文字、`#1D1D1F` 作为主要文字。

语义色方面，成功态使用 `report-green-600` 的 `#2A8A61`，警告态使用 `report-amber-600` 的 `#E09500`，错误态使用 `report-red-500` 的 `#F24B4B`，信息态使用 `report-cyan-600` 的 `#2BA3A6`。这些语义色主要用于徽章、表格状态与数据变化标识，不用于大面积填充。整体色彩氛围是浅色 Apple 质感：以灰白为底、品牌蓝点睛、薄荷绿与琥珀色仅作状态提示，保持界面的呼吸感与专业度。

### Typography

显示字体使用 **DM Sans**，负责大标题、数据指标与卡片标题；正文字体使用 **Inter**，负责正文、按钮、表格与导航；等宽字体使用 **JetBrains Mono**，用于数值、代码与小段等宽标注。三者均通过 Google Fonts 引入，若离线环境无法加载，正文可回退至 **PingFang SC** / **Microsoft YaHei**，显示标题可回退至系统无衬线体，等宽内容可回退至系统默认等宽字体。

字号层级从 `display` 到 `caption` 依次递减：`display` 为 56px / 1.1 / -0.02em，`h1` 为 40px / 1.2，`h2` 为 32px / 1.25，`h3` 为 24px / 1.3，`h4` 为 20px / 1.4，`body` 为 16px / 1.6，`lead` 为 18px / 1.7，`caption` 为 12px / 1.5，`mono` 为 14px / 1.6。显示标题与指标数字使用 600–700 的较重字重以建立层级，正文与说明使用 400 保证长文可读性。

### Spacing

间距系统以 4px 为基点，token 序列为 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px。组件内部紧凑间隙多用 8px 与 12px，卡片与模块之间多用 16px 与 24px，页面级分区使用 32px 以上。控件高度上，按钮提供 sm 32px、md 40px、lg 48px 三档，输入框默认 40px，图标提供 16 / 24 / 32px 三档，导航项高度为 32px，顶部导航栏整体高度为 56px。

### Radius

圆角层级与使用场景绑定：`8px` 用于小控件、柱状图柱条与小颗粒元素；`12px` 用于按钮、导航项与中等容器；`16px` 用于表格与标准卡片；`20px` 用于突出的卡片表面；`9999px` 仅用于徽章、状态标签与药丸形元素。整个系统不追求统一圆角，而是让「越大越重要的容器拥有越柔和的圆角」，形成从控件到页面的自然层级。

### Shadow / Elevation

阴影系统共 5 层，全部使用略带蓝调的深灰 `rgba(29,29,31, …)` 作为投影色，避免纯黑带来的生硬感。`shadow-1` 是卡片在静息态的默认阴影，非常轻；`shadow-2` 用于卡片 hover 时抬升；`shadow-3` 用于下拉、浮层等需要与背景分离的元素；`shadow-4` 用于模态框；`shadow-5` 用于覆盖层与全屏遮罩。整体阴影哲学是「几乎感觉不到，但能区分层级」，不制造强烈的拟物深度。

### Borders, backgrounds, animation, iconography

- **Borders:** 统一使用 1px solid，颜色为 `report-gray-200` 的 `#D2D2D8`，用于卡片、表格、导航栏底边与分割线。不采用虚线或双边框。
- **Backgrounds:** 页面背景为 `#F5F5F7`，卡片与浮层表面为 `#FFFFFF`，hover 时通过 `filter: brightness(0.97)` 产生轻微压暗，而不是更换背景色。
- **Animation:** 过渡时间统一为 0.15s，属性集中在 `background` 与 `filter`，交互反馈快速但不过于急促。
- **Iconography:** 图标尺寸分为 sm 16px、md 24px、lg 32px。本系统未提供独立图标库，建议使用内联 SVG 或项目自有图标集，保持与品牌蓝一致的 2px 线宽风格。

## 4. Component Patterns

| Component | Preview | Contract | CSS Source | Key Facts | Key Insight |
|---|---|---|---|---|---|
| Button | `preview/component-button.html` | `components/button.json` | `components.css` section Button | 3 sizes (32 / 40 / 48px), 4 variants (primary / soft / ghost / outline), 0.15s background transition | Primary 使用实心品牌蓝；ghost 与 outline 让卡片上的次要操作保持安静 |
| Card | `preview/component-card.html` | `components/card.json` | `components.css` section Card | 20px 圆角、shadow-1 静息、hover 亮度滤镜，解剖结构含 header / title / caption / body / metric / change / footer | 大圆角 + 暖白表面构成了 Apple-like 的报告面板 |
| Table | `preview/component-table.html` | `components/table.json` | `components.css` section Table | 16px 外圆角、default 与 compact 两种密度、行 hover 亮度滤镜 | 行与行之间以浅色分隔线区分，容器圆角让它看起来像一张卡片 |
| Chart | `preview/component-chart.html` | `components/chart.json` | `components.css` section Chart | 支持 bar / line / area 三种标记，默认高度 160px，网格线 muted，数据色使用品牌蓝 | 极简调色板：单一品牌色承担主要数据叙事 |
| Navigation | `preview/component-navigation.html` | `components/navigation.json` | `components.css` section Navigation | top-nav 高 56px，side-nav 宽 240px，nav-item 高 32px | 激活态使用浅灰背景，而非高饱和主色填充 |
| Badge | `preview/component-badge.html` | `components/badge.json` | `components.css` section Badge | 24px 高度、药丸圆角、4 种语义色（default / success / warning / error） | 柔和背景 + 饱和文字，让状态标签可读但不抢戏 |

## 5. Index

- `README.md` — 本文件，品牌叙事与设计准则
- `colors_and_type.css` — 颜色、字体、圆角、阴影、间距的 CSS 变量
- `components.css` — 从 preview 页面聚合的组件样式
- `css.json` — 结构化 token 数据
- `components/` — 组件契约 JSON 与索引
- `preview/` — 组件预览 HTML
- `ui_kits/dashboard/` — dashboard 类型的可点击原型套件
- `SKILL.md` — 面向 AI Agent 的技能入口

## 6. Caveats / known substitutions

1. **字体依赖 Google Fonts CDN。** `DM Sans`、`Inter`、`JetBrains Mono` 通过 CSS `@import` 从 Google Fonts 加载。若处于离线或内网环境，正文会回退至 `PingFang SC` / `Microsoft YaHei`，标题回退至系统无衬线体，等宽内容回退至系统默认等宽字体；字重与字间距可能略有差异。
2. **色彩标度包含 AI 插值。** CSS 中部分色阶标记为 `/* AI-generated */`，表示它们由主色/中性色插值得到；只有 `#007AFF` 主色与语义别名（success / warning / error / info）是直接指定的品牌色。
3. **Chart 组件置信度为 low。** 当前 chart 仅提供基于 SVG 的简化标记（bar / line / area），用于样式与布局参考；生产环境建议替换为 ECharts、Recharts 等图表库。
4. **无原始 Figma 源文件。** 本设计系统基于品牌分析师输出的结构化 JSON 从零重建，组件解剖、尺寸与变体均为推断结果，可能与真实设计稿存在偏差。
