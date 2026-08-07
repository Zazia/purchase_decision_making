## Why

当前 MVP 的候选生成与展示存在 6 个互相牵连的问题，单独修补任意一个都不能让候选结果"更全面、更贴近用户使用需求"：

1. **持有期被强制压成单值**。`decision-tree.ts` 持有期步骤只能选 2/3/4/5 中的一个；只有「不确定」分支才会传数组。结果：候选点 = 机型数 × 1，Mac mini 二手+新品合计才 3 个机型点，帕累托前沿最多 3 个非劣解，画面稀疏、用户对比感弱。一般用户不会有明确单值偏向——持有期是决策维度，应由前沿筛选，不是前置输入。

2. **「都看看」实际等于「只看二手」（语义 bug）**。`decision-tree.ts#L55-L57` 把「都看看」的 `value` 写成了 `'used'`，与二手分支完全一致；`pareto.ts#L89` 又用 `buyTiming === 'new' ? '新品' : '二手'` 过滤 modelKey，新品和二手永远不在同一组候选里。结果：用户点「都看看」看到的只有二手，文案承诺"同时对比两类"从未兑现。

3. **性能地板被当硬过滤**。`pareto.ts selectRecommendationRange` 用 `avgPerformance >= performanceFloor` 过滤候选。但 SKILL.md 步骤 6 明确：性能地板"用于在前沿上截取推荐区间，不用于人为设阈值分类"；步骤 1 系统支持期风险也只是标注不排除。低于地板的备选对很多用户是有意义的（如 Mac mini M1 跑轻量任务、二手兜底），硬过滤把它们连同上下文一起抹掉，报告可信度降低。

4. **帕累托图未标出推荐区间位置**。`pareto-chart.ts` 已渲染 frontier + dominated 两类点，但推荐区间只有一圈 markPoint 边框、不画区间带；性能地板线之外的被支配解也只是一片灰，用户看不出"我的预算/性能地板在全景中处于什么位置"。

5. **小程序无详实报告，与 skill 路径产出脱节**。skill 路径产出的是单文件 HTML 报告（结论卡 + KPI + 推荐表 + 全候选表 + 帕累托图 + 月均成本曲线 + 宏观分析 + 置信度 + 更新提示），小程序只有结果页的卡片列表 + 一张散点图。用户在端内看不到支撑证据，分享卡也只带一个推荐点。需要一份"按现有 HTML 报告格式做可行简化"的端内报告。

6. **v3.8 新品发布期机制完全缺失**。SKILL.md 步骤 1/2/5/9.3 定义了类型 B（等新品后买新品）与类型 C（等新品后买降价老款）候选方案、缺货等待期模型、新品价格预测模型、冲击时变曲线、宏观因子调整。引擎 `pareto.ts extractCandidates` 只生成类型 A（现在买），`cost.ts` 注释明确写"v3.8 机制涉及实时宏观扫描，不适合确定性引擎，留给 skill 层处理"。结果：临近新品发布时（如 2026-09 iPhone 18 Pro、2026-10 Mac Studio M5 Ultra），用户无法判断"现在买 vs 等新品"哪个更划算——这正是苹果购买决策最高频的纠结场景。

6 个问题中，1/2 是数据流 bug，3/4 是展示层误解了 SKILL.md 的语义，5 是端内信息密度不足，6 是引擎能力缺口。它们共同导致"候选结果不全面"——只有单一持有期、单一买入时机、被过滤过的候选、无新品发布期视角。本 change 把它们作为一个整体修正，让小程序的候选生成与展示重新对齐 SKILL.md v3.8。

## What Changes

### 持有期：单选 → 多选

- `decision-tree.ts` 持有期步骤改为多选（2/3/4/5 任选 N 个），新增「都看看」快捷项（默认勾选 2/3/4/5 全集）。
- 多选结果以逗号分隔传 URL query（已有 `goToResult` 解析逻辑兼容）。
- 「不确定/帮我选」分支沿用品类默认数组（不变）。

### 「都看看」买入时机：修复语义 bug + 引入 `both`

- `decision-tree.ts` 「都看看」`value` 由 `'used'` 改为 `'both'`。
- `types.ts BuyTiming` 由 `'new' | 'used'` 扩展为 `'new' | 'used' | 'both'`。
- `pareto.ts extractCandidates` 改为：`buyTiming === 'both'` 时同时收集「新品」与「二手」候选；候选对象保留自身 `buyTiming` 字段（已有），不再用全局 `buyTiming` 覆盖。
- `cost.ts getBuyPrice` 不变（按候选自身 `buyTiming` 取价）。
- 结果页/详情页/分享卡展示「新品」「二手」徽章按候选自身 `buyTiming` 渲染。

### 性能地板：硬过滤 → 推荐区间标注

- `pareto.ts selectRecommendationRange` 取消 `avgPerformance >= performanceFloor` 过滤；推荐区间仅保留「买入价 ≤ 预算」一个硬约束。
- 性能地板改为图上的水平参考线 + 推荐区间内的「达标/低于地板」徽章标注，不再剔除候选。
- 空结果兜底逻辑相应简化（不再需要"放宽性能地板至 0"那一轮）。

### 帕累托图：标注推荐区间 + 完整候选可见

- `pareto-chart.ts` 新增：推荐区间用半透明色带（markArea）覆盖 cost ∈ [lowerCost, upperCost] 区间；性能地板水平虚线保留；预算上限垂直虚线（若用户设了预算）。
- 被支配点保留灰色但加细描边，悬停/点击仍可跳详情。
- 推荐区间外的 frontier 点用次级品牌色，区间内用主品牌色 + 边框，让"我的预算在全景中的位置"一眼可见。

### 端内报告页：HTML 报告的可行简化版

- 新增 `pages/report/` 页面（或在 `result` 页底部加「查看完整报告」入口），按现有 HTML 报告格式产出端内简化版：
  - 结论卡（一句话结论 + 推荐方案摘要）
  - KPI 行（最佳月均成本 / 最佳性能 / 预算内买入价 / 当前同品类新品价）
  - 推荐方案表（含推荐理由）
  - 全候选方案表（含被支配点 + 帕累托状态徽章 + 系统支持期标注）
  - 帕累托前沿图（复用 `pareto-chart`）
  - 宏观因素摘要（v3.8 触发的机制清单）
  - 数据置信度表
  - 更新提示
- 简化项：移除月均成本曲线图（次要）、移动端字号统一、不引外部 CSS 框架，复用 `design_tokens`。
- 报告可一键导出为单文件 HTML（`wx.getFileSystemManager().writeFile` + `wx.shareFileMessage`），与 skill 路径产物同构。

### v3.8 新品发布期机制：引擎接入

- `types.ts` 新增 `ReleasePlan` 类型（品类 → 预计发布月、上市到货延迟、宏观产能因子、价格预测涨幅、冲击时变因子）。
- `pareto.ts` 新增 `extractWaitCandidates()`：当某品类距下次预计发布 ≤ 90 天（或用户在决策树勾选「考虑等新品」）时，生成类型 B 与类型 C 候选。
- `cost.ts` 新增：
  - `predictNewProductPrice()`：类型 B 买入价 = 当前同档老款官方价 × (1 + 预测涨幅中位数)，未触发宏观事件时回退"同档同价"。
  - `predictDiscountedOldPrice()`：类型 C 买入价 = 当前市场价 × (1 - 调整后冲击幅度 × 冲击时变因子)。
  - `computeWaitMonths()`：等待月数 = max(0, 预计发布月 - 分析月) + 上市到货延迟 × 宏观产能因子。
- `performance.ts` 类型 B 新品 `S(0) = 100%`（新品为基准），`S̄(N) = [100% + 100%/(1+r)^(N/12)] / 2`。
- `PlanPoint` 新增字段：`candidateType: 'A' | 'B' | 'C'`、`waitMonths?: number`、`predictedPrice?: boolean`。
- 决策树「新品/二手」步骤新增第四个选项「考虑等新品」（生成 B/C 候选），或在「都看看」基础上由引擎自动判断（距发布 ≤ 90 天自动加 B/C 候选，标注"预测值"）。本 change 采用**自动判断 + 用户可见标注**路径，避免增加决策树步骤。
- 报告页与图表用三角形/不同颜色区分类型 B/C 方案，标注"等新品后"与等待月数。
- 触发宏观事件（存储超级周期/全线涨价）时，报告页顶部加橙色 alert，列出激活的 v3.8 机制清单。

### 决策参数扩展

- `DecisionParams` 新增可选字段：`considerWait?: boolean`（默认 true，即自动判断是否生成 B/C 候选）、`macroContext?: MacroContext`（外部注入的宏观状态，避免引擎内嵌网络扫描）。
- 引擎保持纯函数：宏观状态由调用方（小程序快照 / skill 路径）注入，引擎不发起网络请求。

## Capabilities

### Modified Capabilities

- `apple-value-engine`: 扩展 `BuyTiming` 类型、`DecisionParams` 字段；新增 v3.8 新品发布期候选生成与价格预测函数；`selectRecommendationRange` 改为仅按预算过滤；`PlanPoint` 增加 `candidateType/waitMonths/predictedPrice` 字段。
- `wx-miniapp-mvp`: 决策树持有期改多选；「都看看」语义修正；新增端内报告页（HTML 简化版）；帕累托图增加推荐区间标注；结果页/详情页展示候选类型与等待月数。

### New Capabilities

- `v38-release-window`: v3.8 新品发布期机制能力域——类型 B/C 候选生成、缺货等待期模型、新品价格预测模型、冲击时变曲线、宏观因子调整。引擎层为纯函数，宏观状态由外部注入。

## Impact

- **新增代码**：
  - `packages/apple-value-engine/src/release.ts`（v3.8 新品发布期模块：等待月数、价格预测、冲击时变因子查表）
  - `miniapp/wx/pages/report/`（端内报告页）
  - 引擎单测：v3.8 类型 B/C 候选生成、性能地板不过滤、`both` 买入时机、多持有期
- **修改代码**：
  - `packages/apple-value-engine/src/types.ts`（`BuyTiming` 扩展、`DecisionParams` 扩展、`PlanPoint` 扩展、`ReleasePlan`/`MacroContext` 新类型）
  - `packages/apple-value-engine/src/pareto.ts`（`extractCandidates` 支持 `both`、新增 `extractWaitCandidates`、`selectRecommendationRange` 取消性能地板过滤）
  - `packages/apple-value-engine/src/cost.ts`（新增 `predictNewProductPrice`/`predictDiscountedOldPrice`/`computeWaitMonths`）
  - `packages/apple-value-engine/src/performance.ts`（类型 B 新品 `S(0)=100%` 分支）
  - `miniapp/wx/pages/decision-tree/decision-tree.ts`（持有期多选 + 「都看看」value 改 `both`）
  - `miniapp/wx/pages/decision-tree/decision-tree.wxml`（持有期多选 UI）
  - `miniapp/wx/pages/result/result.ts`（接收 `both`、展示候选类型）
  - `miniapp/wx/pages/result/result.wxml`（候选类型徽章、报告页入口）
  - `miniapp/wx/pages/detail/detail.ts` + `detail.wxml`（展示等待月数、预测价标注）
  - `miniapp/wx/components/pareto-chart/pareto-chart.ts`（推荐区间 markArea + 候选类型形状区分）
  - `miniapp/wx/snapshot/constants.js`（同步 v3.8 缺货等待期模型/价格预测表/冲击时变曲线到快照）
- **现有资产复用**：
  - `.agents/skills/apple-value-analysis/constants.json` v3.8 字段（`_缺货等待期模型_v3.8`、`_新品价格预测模型_v3.8`、`_冲击时变曲线_v3.8`、`_宏观因子调整_v3.8`）作为引擎数据源
  - `.agents/skills/apple-value-analysis/2026-08-03-苹果产品购买决策报告.html` 作为端内报告页视觉与结构参考
  - `design_tokens` 作为报告页 CSS 唯一权威源
- **协议与合规**：
  - 端内报告页沿用个人主体 + 无商业化约束，不出现导购字样、不挂外链
  - 类型 B/C 预测价在报告中明确标注"预测值"，不得回写快照（SKILL.md 禁忌 11）
- **依赖与基建**：
  - 不引入新 npm 依赖（端内报告页用原生 wxml + wxss，图表复用 ec-canvas）
  - 引擎保持零运行时依赖
- **不受影响**：
  - skill 路径（`.agents/skills/apple-value-analysis/SKILL.md`）不变，引擎升级后 skill 调用方式不变
  - `METHOD.md` / `METHOD_EN.md` 不变
  - 分享卡生成流程不变（只是 `topPlan` 可能是类型 B/C，分享卡需加"等新品后"标注）
- **后续依赖此决策的里程碑**：M2 云开发的"宏观因子实时扫描"服务可基于本 change 的 `MacroContext` 接口设计；类型 B/C 候选的实际价格回填机制在新品发布后触发。
