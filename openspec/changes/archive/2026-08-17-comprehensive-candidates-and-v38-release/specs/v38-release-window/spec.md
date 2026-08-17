## ADDED Requirements

### Requirement: v3.8 新品发布期候选生成

引擎 SHALL 在 `computeParetoFrontier` 内自动判断是否生成类型 B（等新品买新品）与类型 C（等新品后买降价老款）候选。当某品类距下次预计发布 ≤ 90 天，且 `ReleasePlan.releaseConfidence !== 'low'`，且 `DecisionParams.considerWait !== false` 时，引擎 MUST 生成类型 B/C 候选并追加到候选列表。

`ReleasePlan.releaseConfidence` SHALL 来自 constants 的 `_发布时间预测校验_v3.8` 字段：已官宣=high、搜索结果指向同季度=medium、偏离 ≥ 1 季度或无信息=low。当置信度为 low 时，引擎 MUST 跳过 B/C 候选生成并在报告中标注「⚠️ 发布时间预测偏差，等待方案置信度降级」。

#### Scenario: 距发布 ≤ 90 天自动生成 B/C 候选

- **WHEN** 分析日期 2026-08-07，iPhone_Pro 下次预计发布 2026-09（距 30 天），releaseConfidence='high'
- **THEN** 引擎 MUST 生成类型 B（iPhone 18 Pro 新品）与类型 C（iPhone 17 Pro 降价老款）候选

#### Scenario: 发布置信度低时跳过

- **WHEN** 分析日期 2026-08-07，Mac_mini 下次预计发布 2026-Q3 M5，但 `_发布时间预测校验_v3.8` 标注偏差已超 1 季度，releaseConfidence='low'
- **THEN** 引擎 MUST NOT 生成 Mac mini 的类型 B/C 候选；报告页 MUST 标注「⚠️ Mac mini M5 发布时间预测偏差，等待方案置信度降级」

#### Scenario: considerWait=false 关闭

- **WHEN** `DecisionParams.considerWait=false`，某品类距下次发布 30 天
- **THEN** 引擎 MUST NOT 生成任何类型 B/C 候选

### Requirement: 等待月数计算（缺货等待期模型）

引擎 SHALL 实现 `computeWaitMonths(releasePlan, macroContext): number`，公式为：等待月数 = max(0, 预计发布月 - 分析月) + 上市到货延迟(月) × 宏观产能因子。

`上市到货延迟` SHALL 来自 constants `_缺货等待期模型_v3.8._分品类上市到货延迟_基线` 的「中位」值（天），转换为月时按 30 天/月 向上取整。`宏观产能因子` SHALL 来自 `_宏观产能延迟_v3.8._宏观产能因子表`，按 `macroContext.storageSuperCycleStage` 查表：ongoing=2.0、peaking=1.5、easing=1.0、none=1.0。

#### Scenario: 存储超级周期进行中延迟翻倍

- **WHEN** Mac Studio M5 Ultra 预计 2026-10 发布（距 2 月），基线延迟 30 天（=1 月），`storageSuperCycleStage='ongoing'`（因子 2.0）
- **THEN** 等待月数 = 2 + 1 × 2.0 = 4 月；报告 MUST 标注「基线等待 3 月，悲观 7 月」

#### Scenario: 无宏观事件使用基线

- **WHEN** iPhone 18 Pro 预计 2026-09 发布（距 1 月），基线延迟 10 天（≈1 月），`storageSuperCycleStage='none'`
- **THEN** 等待月数 = 1 + 1 × 1.0 = 2 月

### Requirement: 类型 B 买入价预测（新品价格预测模型）

引擎 SHALL 实现 `predictNewProductPrice(constants, categoryKey, releasePlan): number`，公式为：
- 若 `releasePlan.hasHikeOccurred=true`（该品类已涨价）：直接返回快照中当前同档老款官方价
- 否则：类型 B 买入价 = 当前同档老款官方价 × (1 + 预测涨幅中位数)

`预测涨幅中位数` SHALL 来自 constants `_新品价格预测模型_v3.8._分品类预测涨幅表._当前值_{当前年月}` 的「中位数」字段。`_新品价格预测模型_v3.8` 的触发条件（苹果全线涨价 / 存储超级周期 / BOM 成本上升 ≥ 10%）由 `macroContext` 判断：当 `hasGlobalPriceHike=true` 或 `storageSuperCycleStage !== 'none'` 时视为触发。

未触发宏观事件时，引擎 MUST 回退到「同档同价假设」（涨幅 0%，即买入价 = 当前同档老款官方价）。

#### Scenario: 已涨价品类直接用快照价

- **WHEN** Mac_mini 已于 2026-06 涨价 33.3%（4499→5999），`hasHikeOccurred=true`
- **THEN** 类型 B 候选（Mac mini M5 新品）买入价 = 5999（当前 M4 官方价），MUST NOT 再外推涨幅

#### Scenario: 未涨价品类用预测涨幅

- **WHEN** iPhone_Pro 未涨价，预测涨幅中位数 12%，当前 iPhone 17 Pro 官方价 9999
- **THEN** 类型 B 候选（iPhone 18 Pro 新品）买入价 = 9999 × 1.12 = 11199

#### Scenario: 未触发宏观事件回退同档同价

- **WHEN** `macroContext.storageSuperCycleStage='none'` 且 `hasGlobalPriceHike=false`，某品类未涨价
- **THEN** 类型 B 买入价 = 当前同档老款官方价（涨幅 0%）

### Requirement: 类型 C 买入价预测（冲击时变曲线 + 宏观因子调整）

引擎 SHALL 实现 `predictDiscountedOldPrice(constants, oldCand, releasePlan, macroContext): number`，公式为：类型 C 买入价 = 当前市场价 × (1 - 调整后冲击幅度 × 冲击时变因子)。

`调整后冲击幅度` SHALL 按公式：历史均值 × (1 + 价格传导因子)。`历史均值` 来自 constants `新品发布对老款冲击.{品类}.均值`。`价格传导因子` 来自 `_宏观因子调整_v3.8._价格传导因子表`，按新品涨幅查表：涨幅 ≤ 0% → +0%、0-5% → -5%、5-15% → -15%、15-30% → -25%、>30% → -35%。

`冲击时变因子` SHALL 来自 `_冲击时变曲线_v3.8`，按「新品发布后到买入的月数」查「买入价下降因子」：1 月内=1.0、3 月内=0.95、6 月内=0.80、12 月内=0.50、12 月后=0.20。

#### Scenario: 存储超级周期下冲击幅度减小

- **WHEN** Mac_mini 历史均值 38%，新品已涨价 33.3%（价格传导因子 -35%），调整后冲击幅度 = 38% × (1-0.35) = 24.7%
- **THEN** 类型 C 候选买入价下降用 24.7% × 冲击时变因子

#### Scenario: 冲击时变因子查表

- **WHEN** 类型 C 候选在新品发布后 2 月买入（3 月内）
- **THEN** 冲击时变因子（买入价下降因子）= 0.95

#### Scenario: 类型 C 残值不施加冲击

- **WHEN** 类型 C 候选的残值计算
- **THEN** 残值 MUST 用原始保值率查表（不乘以冲击时变因子的「残值调整因子」）；冲击已体现在买入价下降中

### Requirement: 类型 B 性能 S(0)=100%

引擎 SHALL 在 `computePerformanceForNewProduct(constants, category, holdingMonths, mCAGR, aCAGR)` 中实现类型 B 新品的性能满足度计算：
- `S(0) = 1.0`（新品为新的基准芯片）
- `effectiveR` MUST 通过 `getEffectiveR` 应用代际跃升调整（若下一代芯片在 `chipGenerationAssumptions.per_generation详表_v3.8` 标注为跃升/节点首发）
- `S(N) = 1.0 / (1 + effectiveR)^(N/12)`
- `S̄(N) = (1.0 + sN) / 2`

#### Scenario: 类型 B 普通代际

- **WHEN** 类型 B 候选持有 24 月，r=0.16，无代际跃升
- **THEN** `S(0)=1.0`，`S(24)=1.0/1.16^2=0.743`，`S̄(24)=0.872`

#### Scenario: 类型 B 跃升代际上调 r

- **WHEN** 类型 B 候选下一代芯片在 `per_generation详表_v3.8` 标注为「跃升代际」
- **THEN** `effectiveR = 0.16 × 1.5 = 0.24`，`S(24) = 1.0 / 1.24^2 = 0.650`，`S̄(24) = 0.825`

### Requirement: 宏观状态外部注入

引擎 MUST 保持纯函数，MUST NOT 发起网络请求扫描宏观因素。宏观状态 SHALL 由调用方通过 `DecisionParams.macroContext` 注入。

小程序快照层（`miniapp/wx/snapshot/constants.js`）SHALL 在文件顶部新增 `MACRO_CONTEXT` 字段，由维护者在 `sync-snapshot.mjs` 时人工写入当前宏观状态（`storageSuperCycleStage`、`hasGlobalPriceHike`、`analysisMonth`）。`engine-bridge/index.ts` 的 `compute(params)` MUST 从快照读取 `MACRO_CONTEXT` 并注入 `DecisionParams.macroContext`。

skill 路径 SHALL 由 Agent 执行 SKILL.md 步骤 2 宏观扫描，结果通过 `macroContext` 传入引擎。

#### Scenario: 小程序注入 macroContext

- **WHEN** 小程序调用 `engine-bridge.compute(params)`
- **THEN** `engine-bridge` 从 `snapshot/constants.js` 读取 `MACRO_CONTEXT`，注入到 `params.macroContext`，调用 `computeParetoFrontier`

#### Scenario: 引擎不发起网络请求

- **WHEN** 引擎 `computeParetoFrontier` 被调用，`macroContext` 缺省
- **THEN** 引擎按 `storageSuperCycleStage='none'` + `hasGlobalPriceHike=false` 处理，MUST NOT 发起任何网络请求或文件 IO

### Requirement: 预测价不回写快照

类型 B/C 候选的买入价均为预测值，MUST NOT 回写至 constants `实时市场价快照`（快照仅记录实际搜索到的真实价格）。新品实际发布后，调用方 MUST 重新分析，用真实价格替换预测值。

#### Scenario: 预测价不污染快照

- **WHEN** 引擎生成类型 B 候选，预测买入价 11199
- **THEN** 该价格 MUST NOT 出现在 `constants.marketSnapshots` 中；`PlanPoint.predictedPrice` MUST 为 `true`

#### Scenario: 新品发布后重新分析

- **WHEN** iPhone 18 Pro 实际发布，官方价 10999（与预测 11199 偏差 -1.8%）
- **THEN** 调用方 MUST 触发快照红色全更新，用 10999 替换预测值，重新调用引擎分析
