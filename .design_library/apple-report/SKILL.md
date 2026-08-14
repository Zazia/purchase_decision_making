---
name: apple-report-design
description: 用于为本项目 purchase-decision-making 制作各类视觉产品，以 Apple 风格生成品牌化界面与素材的 Design Skill。包含浅色 Apple 质感 Dashboard 的颜色、字体、组件与 UI Kit。
user-invocable: true
---

# Apple 风格 Design Skill（参考 UI 套件）

> **本目录现为项目设计库的 Web Dashboard 参考样本。**
> 令牌权威定义在 `../tokens.md`；各平台适配指南在 `../platforms/`。
> 项目视觉规范的总入口是 `../../design.md`。

先阅读 `README.md` 了解品牌背景；创建可视化稿或原型时，导出素材并生成静态 HTML 文件交付用户。

若用户未给出额外指令，询问他们想构建的内容，然后以该品牌专家身份输出 HTML artifacts 或生产代码。

## Quick map

- `README.md` — 品牌背景与视觉基础
- `css.json` — 结构化 Token 理解源
- `colors_and_type.css` — 运行时 CSS 变量，直接链接使用
- `components/index.json` — 组件清单
- `components.css` — 聚合组件样式
- `preview/component-{slug}.html` — 组件预览（优先读取）
- `components/{slug}.json` — 组件意图与变体
- `components/_evidence/{slug}.json` — 证据兜底
- `library-consumption.json` — 推荐读取顺序

## Essentials at a glance

- 主色 `#007AFF`（report-blue-500）：冷静、专业、低饱和 Apple 蓝，用于主要操作与关键指标高亮。
- 圆角体系：控件/小卡片 8px、卡片 12px、大面板 16px，Pill（9999px）仅用于徽章与标签。
- 默认控件高度 40px（按钮中号、输入框），间距以 4px 为基准，常规内边距 16px。
- 字体：标题使用 DM Sans，正文使用 Inter，代码/数值使用 JetBrains Mono。
- 语气：中文优先、专业、友好、克制，产品 UI 不使用 emoji。
- 阴影哲学：轻到几乎不可见的分层投影，卡片静止态使用 shadow-1，不堆叠厚重阴影。
- 签名模式：在 `#F5F5F7` 柔和灰白背景上以白色卡片承载内容，成功绿 `#34A373` 与信息青 `#38C4C8` 仅作点缀。
