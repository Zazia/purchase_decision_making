# 设计规范入口

> 本文件是项目视觉规范的**唯一入口**。2 分钟读完，知道有什么、何时用、去哪查。

本项目所有视觉产物——小程序界面、HTML 报告、Canvas 分享卡、ECharts 图表——共享同一套设计规范。规范采用**分层披露**：本文件只给概览，需要细节时按指引深入。

---

## 核心速览

| 维度 | 值 |
|------|-----|
| 主色 | `#007AFF`（品牌蓝，唯一行动色） |
| 背景 | `#F5F5F7` / 卡片 `#FFFFFF` |
| 语义色 | 成功 `#2A8A61` / 警告 `#E09500` / 错误 `#F24B4B` |
| 字体 | DM Sans（标题）/ Inter（正文）/ JetBrains Mono（数值） |
| 间距 | 4px 基点，序列 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 |
| 圆角 | 控件 8px → 按钮 12px → 卡片 20px → 药丸 9999px |
| 阴影 | 轻到几乎不可见的分层投影，`rgba(29,29,31,…)` |
| 动效 | 0.15s 过渡，hover 用 `brightness(0.97)` |
| 语调 | 中文优先、专业、克制、不用 emoji |

---

## 分层导航

按任务需要，**只读必要的层**：

```
design.md（你在这里 — Layer 0：入口，2 分钟）
  ↓
.design_library/README.md（Layer 1：总览，5 分钟）
  ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 2：按需深入                                         │
│                                                         │
│  tokens.md              色彩/字体/间距/圆角/阴影的完整定义  │
│  platforms/miniprogram.md  改小程序界面 → 读这个           │
│  platforms/web-report.md   做 HTML 报告 → 读这个           │
│  platforms/canvas.md       画 Canvas / ECharts → 读这个   │
│                                                         │
│  apple-report/            Web Dashboard 参考 UI 套件      │
│    ├── preview/*.html     组件渲染预览                    │
│    ├── components/*.json  组件契约                        │
│    └── colors_and_type.css  Web 运行时 CSS 变量           │
└─────────────────────────────────────────────────────────┘
```

---

## 快速决策

| 我要做… | 读哪个文件 |
|---------|-----------|
| 改小程序某个页面的颜色/间距/圆角 | `tokens.md` → `platforms/miniprogram.md` |
| 做一份 HTML 数据报告 | `tokens.md` → `platforms/web-report.md` |
| 画分享卡或调 ECharts 配色 | `tokens.md` §1.4 → `platforms/canvas.md` |
| 新增一个组件 | `.design_library/README.md` → `tokens.md` → 对应平台指南 |
| 看组件长什么样 | `apple-report/preview/component-*.html` |
| 查 ECharts 完整配置 | `miniapp/wx/snapshot/constants.json` → `design_tokens` |

---

## 一句话原则

> 浅色 Apple 质感：灰白底、品牌蓝点睛、大圆角白卡片、轻阴影。单一主色承担所有行动指向，语义色仅出现在徽章。不堆叠、不渐变、不 emoji。
