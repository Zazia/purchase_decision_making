## Context

`miniapp-mvp-direction` change 已交付 MVP：决策树表单（5 步单选）→ 引擎计算 → 帕累托图 → 分享卡。引擎 `apple-value-engine` 抽离完成，零运行时依赖，单测与 skill 历史报告一致。

但 MVP 上线后在真实使用场景中暴露 6 个问题（见 `proposal.md` Why），核心矛盾是：**候选生成过于稀疏、展示层误解了 SKILL.md 语义、v3.8 新品发布期机制完全缺失**。本 change 不引入新形态（不做云开发、不做多品类对比、不做 LLM 顾问），只把现有 MVP 的候选生成与展示对齐 SKILL.md v3.8。

约束：
- 维护者时间 5–10h/周
- 引擎保持纯函数 + 零运行时依赖（不内嵌网络扫描）
- 现有 skill 路径对外行为不变
- 个人主体 + 无商业化约束不变
- 端内不引外部 CSS/JS 框架

利益相关：
- 小程序用户：希望看到更全面的候选、能判断"现在买 vs 等新品"
- skill 用户：依赖远程 constants.json 不变，引擎升级后调用方式不变
- 维护者：希望 v3.8 机制有单一事实来源（引擎），不在 skill 与小程序两套逻辑里漂移

## Goals / Non-Goals

**Goals:**
- 修正「都看看」语义 bug，让新品与二手真正同图对比
- 持有期改多选，候选点从「机型数 × 1」扩展到「机型数 × 持有年数」
- 性能地板从硬过滤改为图上参考线，低性能备选保留可见
- 帕累托图标出推荐区间与预算/性能地板在全景中的位置
- 新增端内报告页，按 HTML 报告格式做可行简化
- 引擎接入 v3.8 新品发布期机制（类型 B/C 候选、缺货等待期、价格预测、冲击时变曲线）
- 引擎保持纯函数，宏观状态外部注入

**Non-Goals:**
- 不做实时宏观扫描服务（M2 云开发范围）
- 不做用户上传真实成交价（M3 范围）
- 不做多品类跨品类帕累托（M4 范围）
- 不重写 `METHOD.md` / `METHOD_EN.md`
- 不引入新 npm 依赖
- 不改 skill 路径的 SOP 文字（skill 自动从引擎升级中受益）
- 不改分享卡核心流程（仅展示层加"等新品后"标注）

## Decisions

### D1. `BuyTiming` 扩展为 `'new' | 'used' | 'both'`，候选自带 `buyTiming` 字段

**决策**：`types.ts BuyTiming` 由 `'new' | 'used'` 扩展为 `'new' | 'used' | 'both'`。`pareto.ts extractCandidates` 接收的 `buyTiming` 是「用户偏好」，可能为 `both`；但每个 `Candidate` 对象的 `buyTiming` 字段始终是 `'new'` 或 `'used'`（具体到某台机型的买入时机）。

**为什么这样分层**：
- 现有 `Candidate.buyTiming` 字段已存在（`pareto.ts#L54`），只是被全局 `buyTiming` 覆盖了语义
- `cost.ts getBuyPrice` 已经按候选自身 `buyTiming` 取价，无需改
- 这样 `both` 只是「同时收集两类候选」，不引入新的取价逻辑

**备选**：把 `both` 拆成两次调用 `extractCandidates(buyTiming='new') + extractCandidates(buyTiming='used')` 合并。否决理由：调用方需自己合并去重，且 `computeParetoFrontier` 入参语义变模糊。

### D2. 性能地板：硬过滤 → 推荐区间标注

**决策**：`selectRecommendationRange` 取消 `avgPerformance >= performanceFloor` 过滤，推荐区间仅保留 `buyPrice <= budget` 一个硬约束。性能地板降级为图上水平参考线 + 推荐区间内的「达标/低于地板」徽章。

**为什么**：
- SKILL.md 步骤 6 原文："性能地板用于在前沿上截取推荐区间，不用于人为设阈值分类"
- SKILL.md 步骤 1.6："系统支持期超出不排除，仅标注"——同理，性能低于地板也不应排除
- 用户实际场景：Mac mini M1 性能 28% 低于 50% 地板，但跑轻量办公完全够用；硬过滤会让用户看不到这个选项
- 前沿本身已保证非劣，性能地板只是用户偏好的可视化锚点

**边界**：若推荐区间为空（预算内无任何 frontier 点），仍触发空结果兜底，但兜底逻辑简化为「放宽预算 ×2」一轮即可（不再需要"放宽性能地板至 0"那一轮，因为性能地板已不过滤）。

### D3. 持有期：单选 → 多选，URL query 兼容

**决策**：`decision-tree.ts` 持有期步骤改多选，UI 用 chip 多选组件。多选结果以逗号分隔传 URL query（如 `holdingYears=2,3,4`）。`result.ts parseQuery` 已有逗号分隔解析逻辑（`result.ts#L71-L74`），无需改。

**默认值**：
- 用户主动多选：传所选值
- 「不确定/帮我选」：仍传 `DEFAULT_PARAMS[category].holdingYears` 数组（不变）
- 新增「都看看持有期」快捷项：默认勾选 2/3/4/5 全集

**备选**：把持有期步骤改成滑块或区间选择。否决理由：决策树风格统一为单选/多选 chip，滑块破坏一致性；区间选择语义模糊（"2-4 年"是 [2,4] 还是 {2,3,4}?）。

### D4. v3.8 新品发布期机制：引擎层纯函数 + 宏观状态外部注入

**决策**：新增 `release.ts` 模块，所有 v3.8 机制（缺货等待期、价格预测、冲击时变曲线、宏观因子调整）均为纯函数，数据来自 `constants.releaseRhythm._缺货等待期模型_v3.8` / `_新品价格预测模型_v3.8` / `新品发布对老款冲击._冲击时变曲线_v3.8` / `_宏观因子调整_v3.8`。宏观状态（存储超级周期阶段、是否检测到全线涨价）由调用方通过 `DecisionParams.macroContext` 注入。

**为什么**：
- 引擎保持纯函数 + 零网络依赖的核心约束不能破
- 宏观状态本质是「外部世界的事实」，应由调用方负责扫描与注入
- 小程序快照层可在 `sync-snapshot.mjs` 时附带写入当前宏观状态（维护者人工判断后写入）
- skill 路径仍由 Agent 执行步骤 2 宏观扫描，结果通过 `macroContext` 传入引擎

**`MacroContext` 类型设计**：

```ts
interface MacroContext {
  /** 存储超级周期阶段，未触发为 'none' */
  storageSuperCycleStage: 'ongoing' | 'peaking' | 'easing' | 'none';
  /** 是否检测到苹果全线涨价事件 */
  hasGlobalPriceHike: boolean;
  /** 分析日期 (YYYY-MM)，用于计算距下次发布的月数 */
  analysisMonth: string;
}
```

**`ReleasePlan` 类型设计**（从 constants 解析）：

```ts
interface ReleasePlan {
  category: string;
  nextReleaseMonth: string | null;  // "2026-09" 或 null（无预测）
  releaseConfidence: 'high' | 'medium' | 'low';  // 来自 _发布时间预测校验_v3.8
  baselineDelayDays: number;        // 上市到货延迟基线
  pessimisticDelayDays: number;
  macroCapacityFactor: number;      // 1.0 / 1.5 / 2.0
  predictedPriceHike?: number;      // 中位数，如 0.12 表示 12%
  hasHikeOccurred: boolean;         // 该品类是否已涨价（直接用快照价）
}
```

### D5. 类型 B/C 候选自动触发，不增加决策树步骤

**决策**：决策树「新品/二手」步骤不新增「考虑等新品」选项。引擎在 `computeParetoFrontier` 内自动判断：当某品类距下次预计发布 ≤ 90 天（且 `ReleasePlan.releaseConfidence !== 'low'`）时，自动生成类型 B/C 候选；用户用 `DecisionParams.considerWait = false` 显式关闭。

**为什么**：
- 增加决策树步骤会破坏 5 步表单的简洁性
- "考虑等新品"本质是引擎根据当前日期与发布节奏自动判断的事实，不需要用户决策
- 当发布时间预测置信度为 low（如 Mac mini M5 偏差已超 1 季度），引擎自动跳过 B/C 候选，避免误导

**类型 B/C 候选生成逻辑**：

```ts
function extractWaitCandidates(constants, categoryKey, releasePlan, macroContext): Candidate[] {
  // 仅对「等新品」有意义的品类生成
  if (!releasePlan.nextReleaseMonth) return [];
  if (releasePlan.releaseConfidence === 'low') return [];

  const waitMonths = computeWaitMonths(releasePlan, macroContext);
  if (waitMonths <= 0 || waitMonths > 12) return [];  // 超过 1 年不生成

  const candidates: Candidate[] = [];

  // 类型 B: 等新品买新品 — 用预测价
  const newProductPrice = predictNewProductPrice(constants, categoryKey, releasePlan);
  candidates.push({
    modelKey: `${categoryKey}_下一代新品`,
    chip: 'NEXT_GEN',  // 占位，性能计算时用基准芯片
    buyTiming: 'new',
    buyPrice: newProductPrice,
    candidateType: 'B',
    waitMonths,
    predictedPrice: true,
    // ...
  });

  // 类型 C: 等新品后买降价老款 — 对每个现有老款候选生成
  for (const oldCand of extractCandidates(constants, categoryKey, 'used')) {
    const discountedPrice = predictDiscountedOldPrice(constants, oldCand, releasePlan, macroContext);
    candidates.push({
      ...oldCand,
      buyPrice: discountedPrice,
      candidateType: 'C',
      waitMonths,
      predictedPrice: true,
    });
  }

  return candidates;
}
```

### D6. 类型 B 性能：`S(0) = 100%`，用代际跃升调整 r

**决策**：类型 B 新品买入时是新的基准芯片，`S(0) = 100%`。`S̄(N) = [100% + 100%/(1+r)^(N/12)] / 2`。若 `releasePlan` 对应的代际在 `chipGenerationAssumptions.per_generation详表_v3.8` 标注为「跃升代际」，r 上调至 `r × 1.5`；「节点首发代际」下调至 `r × 0.5`。

**为什么**：
- SKILL.md 步骤 4.6 原文："类型B新品性能预测：新品为新的基准芯片，S(0)=100%"
- 现有 `performance.ts getEffectiveR()` 已实现代际跃升识别，直接复用

### D7. 类型 C 性能与残值：买入价下降，残值不施加冲击

**决策**：
- 类型 C 的 `S(0)` 和 `S̄(N)` 与类型 A（现在买同款）相同——性能衰减已通过 r 因子覆盖
- 类型 C 的残值计算**不施加**新品发布冲击调整（冲击已体现在买入价下降中）
- 类型 C 的「卖出时机龄」= 当前机龄 + 等待月数 + 持有月数

**为什么**：SKILL.md 步骤 5.4 原文："此调整仅适用于类型A。类型C的冲击已体现在买入价下降中"。

### D8. `PlanPoint` 字段扩展

```ts
interface PlanPoint {
  // 现有字段不变...
  /** 候选类型: A=现在买, B=等新品买新品, C=等新品后买降价老款 */
  candidateType: 'A' | 'B' | 'C';
  /** 等待月数（仅类型 B/C），含缺货延迟 */
  waitMonths?: number;
  /** 买入价是否为预测值（类型 B/C 恒为 true） */
  predictedPrice?: boolean;
  /** 系统支持期风险标注（来自步骤 1.6） */
  systemSupportRisk?: 'normal' | 'near-end' | 'exceeded';
  /** 系统支持期超出月数（仅 exceeded 时有值） */
  systemSupportExceedMonths?: number;
}
```

### D9. 端内报告页：HTML 简化版结构

**决策**：新增 `pages/report/`，从 `result` 页底部「查看完整报告」入口进入。结构对齐 `.agents/skills/apple-value-analysis/2026-08-03-苹果产品购买决策报告.html`，做以下简化：

| HTML 报告区块 | 端内简化版 | 简化理由 |
|---|---|---|
| 报告头部 | ✅ 保留 | 标题 + 元信息（品类/预算/分析日期/SOP 版本） |
| 结论卡 | ✅ 保留 | 一句话结论 + 推荐方案摘要 |
| KPI 行 | ✅ 保留 4 卡 | 最佳月均成本 / 最佳性能 / 预算内买入价 / 当前同品类新品价 |
| 预警 alert | ✅ 保留 | v3.8 宏观事件 + 发布时间偏差提示 |
| 推荐方案表 | ✅ 保留 | 含推荐理由列 |
| 全候选方案表 | ✅ 保留 | 含被支配点 + 帕累托徽章 + 系统支持期标注 |
| 帕累托前沿图 | ✅ 保留 | 复用 `pareto-chart` 组件 |
| 月均成本曲线图 | ❌ 移除 | 次要，移动端空间紧张 |
| 宏观因素分析 | ✅ 简化 | 单列表，展开/收起 |
| 数据置信度表 | ✅ 保留 | 价格来源 + 置信度等级 |
| 图表说明 | ✅ 简化 | 折叠为 chart-note |
| 更新提示 | ✅ 保留 | 触发重新分析的条件 |

**视觉**：
- 复用 `design_tokens`：品牌蓝 `#007AFF` / 强调浅蓝 `#E8F0FE` / 成功绿 `#34C759` / 警告橙 `#FF9500` / 错误红 `#FF3B30` / 灰阶
- 字体栈：`-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`
- 关键数字（月均成本等）用 `font-size: 32px; font-weight: 600; font-family: var(--font-display)`
- 推荐行高亮用 `--accent-soft`，不用 `success-soft`
- 类型 B/C 方案用三角形图标 + "等新品后" 标签

**导出**：
- 用 `wx.getFileSystemManager().writeFile` 写入 HTML 文件到小程序临时目录
- `wx.shareFileMessage` 转发文件给好友（仅文件传输，不含导购）
- 文件名格式：`YYYY-MM-DD-{品类}-决策报告.html`

**备选**：直接复用 `result` 页底部展开报告内容，不新增页面。否决理由：报告内容较长（全候选表 + 置信度表），塞进 `result` 页会让首屏加载变重；独立页面支持单独分享与导出。

### D10. 帕累托图：推荐区间 markArea + 候选类型形状

**决策**：`pareto-chart.ts` 增强：

1. **推荐区间色带**：用 `markArea` 绘制 cost ∈ [lowerCost, upperCost] 的半透明色带（`--accent-soft` 30% 透明度），让"我的预算在全景中的位置"一眼可见。
2. **预算垂直虚线**：若用户设了预算，画一条垂直 markLine 在 `budget` 对应的月均成本位置（粗略换算：`budget / holdingMonths`，取所有候选的中位持有期）。
3. **性能地板水平虚线**：保留现有 markLine。
4. **候选类型形状区分**：
   - 类型 A：实心圆（现有）
   - 类型 B：三角形（向上）
   - 类型 C：菱形
   - 颜色：类型 A 用品牌蓝，B/C 用次级品牌色（如 `#5AC8FA` 浅蓝）+ 半透明（预测置信度低）
5. **被支配点**：保留灰色 + 加细描边（让位置可见但不抢眼）。

### D11. 决策参数扩展

```ts
interface DecisionParams {
  // 现有字段不变...
  /** 是否考虑等新品候选（默认 true，引擎自动判断） */
  considerWait?: boolean;
  /** 宏观状态（由调用方注入，引擎不发起网络请求） */
  macroContext?: MacroContext;
}
```

`macroContext` 缺省时引擎按 `storageSuperCycleStage: 'none'` 处理（不触发宏观修正），保证向后兼容。

## Risks / Trade-offs

### R1. 类型 B/C 预测价的置信度

**风险**：预测价基于行业分析师预测与历史均值，可能与实际发布价偏差较大（如 Mac mini M5 至今无发布迹象）。

**缓解**：
- `ReleasePlan.releaseConfidence === 'low'` 时自动跳过 B/C 候选
- 报告中明确标注"预测值" + 置信度等级
- SKILL.md 禁忌 11：等待方案价格不得回写快照，新品发布后必须重新分析

### R2. 端内报告页加载性能

**风险**：全候选方案表可能很长（如 Mac mini 12 个机型 × 4 个持有期 = 48 行），移动端渲染慢。

**缓解**：
- 表格默认折叠，点击展开
- 仅渲染前 20 行 + "查看全部 N 个方案"按钮
- 报告页独立于 `result` 页，首屏不受影响

### R3. 多持有期 + both + B/C 候选的组合爆炸

**风险**：Mac mini 6 机型 × 4 持有期 × 2 买入时机 × 3 候选类型 = 144 个点，帕累托图密集。

**缓解**：
- 帕累托前沿本身会过滤被支配点，前沿点通常 ≤ 10 个
- 被支配点用小尺寸 + 半透明，不抢眼
- 报告页全候选表分页/折叠

### R4. `considerWait` 默认 true 可能干扰用户

**风险**：用户只想看"现在买什么"，引擎却生成了 B/C 候选，增加噪音。

**缓解**：
- 决策树「新品/二手」步骤的「都看看」选项语义扩展为"现在买新品/二手 + 考虑等新品"（自动触发 B/C）
- 选「新品」或「二手」单选时，`considerWait` 隐式设为 false
- 报告页可一键切换"仅看现在买" / "包含等新品"视图

## Open Questions

- Q1: 端内报告页导出 HTML 是否需要在小程序后台配置 `wx.shareFileMessage` 的合法域名？（待提审前确认）
- Q2: `MacroContext` 是否需要持久化到快照？当前设计是每次 `sync-snapshot.mjs` 时由维护者人工写入，是否足够？（M2 云开发后会改为服务端注入）
- Q3: 类型 B 候选的 `chip: 'NEXT_GEN'` 占位是否需要在 `chipBenchmarks` 表里加一个虚拟条目？当前方案是用 `getCategoryFlagshipScore` 直接取基准芯片跑分（S(0)=100%），不查表。
