# Design: fix-residual-above-buy-price

## Context

见 proposal.md「Why」。现状关键代码路径：

- `packages/apple-value-engine/src/cost.ts`：`computeMonthlyCost`（类型 A）与 `computeMonthlyCostForWaitCandidate`（类型 B/C）均以 `residual = (retentionRate / 100) × currentNewPrice` 计算残值
- `packages/apple-value-engine/src/pareto.ts`：`buildPlanPoint` 按候选类型分流，类型 C 的买入机龄可由 `sellAgeMonths − holdingMonths` 推导（sellAge = 当前机龄 + 等待月数 + 持有月数）；类型 B 的 sellAge = holdingMonths（即买入机龄 = 0）
- v4.2 的 `applyResidualImpact` 在 `computeMonthlyCost` 结果之上对类型 A 残值乘冲击因子，重算路径（`rebuildEditedPlanPoint` / `buildPlanPointFromCandidateWithAgeOverride`）复用同一套函数，口径自动一致
- 小程序 `engine-bridge` 只调用 `computeParetoFrontier` / `recomputeFrontierFromPoints`，不直接依赖 `computeMonthlyCost` 的参数语义

## Goals / Non-Goals

**Goals:**

- 残值与买入价同口径（锚定模型），结构性保证 `residual ≤ buyPrice`、`monthlyCost ≥ 0`
- 类型 C 的发布冲击折扣通过买入价自然传导至残值，消除「买入价降、残值不降」的不对称
- 原始计算与用户编辑重算（edited/custom/copy）口径保持一致（同一代码路径，无需额外工作）

**Non-Goals:**

- 不改 constants.json 数据（保值曲线、市场快照、冲击参数均不动）
- 不改性能满足度、维修成本、系统支持期风险、帕累托筛选逻辑
- 不做保值曲线与快照市场价的数据校准（数据层面的偏差由锚定模型自动吸收，见 Risks）
- 不改小程序 UI/交互（仅数值变化）

## Decisions

### D1: 锚定公式而非事后截断（clamp）

**选择**：`residual = buyPrice × min(1, R(sellAge) / R(buyAge))`。

**理由**：clamp（`residual = min(residual, buyPrice)`）只遮住症状——受影响方案点的月均成本仍趋近 0，且数据每次更新（快照月更、曲线季更）都可能重新触发；锚定公式从源头统一买入/卖出两侧口径，对数据漂移鲁棒。

**替代方案（否决）**：
- *仅修类型 C 冲击不对称*（残值也乘冲击因子）：复现用例中残值仍为 ~3244 > 2925，修不掉市场价低于曲线隐含值的层差，且引入「买入、卖出两头乘冲击」的重复计算争议
- *数据校准*（重标曲线匹配快照市场价）：属于数据维护，无法防止下次快照更新再次失衡，且工作量大、需逐品类重估

### D2: 买入机龄在成本函数内部推导，保持函数签名兼容

- `computeMonthlyCost(constants, category, buyPrice, currentAgeMonths, holdingMonths, currentNewPrice)`：买入机龄 = `currentAgeMonths`（已有参数）
- `computeMonthlyCostForWaitCandidate(..., sellAgeMonths)`：买入机龄 = `sellAgeMonths − holdingMonths`（类型 B 得 0，类型 C 得 当前机龄+等待月数，均正确）
- `currentNewPrice` 参数与 `CostBreakdown.currentNewPrice` **保留**但降级为信息性字段，避免破坏导出 API 与既有调用方；JSDoc 注明「仅信息展示，不参与残值计算」

**理由**：零签名变更 → 端上 vendor 同步与调用方零适配；重算路径（`rebuildEditedPlanPoint` 构造 Candidate 后走 `buildPlanPoint`）自动继承新口径。

### D3: 类型 A 冲击调整叠加在锚定残值之上（语义不变，基数改变）

`applyResidualImpact` 保持现结构，仅残值基数从「曲线×新品价」换为「锚定残值」：`residual' = anchoredResidual × (1 − adjustedImpact × residualFactor)`。锚定公式中 买入机龄→卖出机龄 窗口只含曲线的平均换代贬值，本场发布的超额冲击仍由 v4.2 因子覆盖，无重复计算。类型 B/C 不施加冲击的理由不变（B 买的就是新品；C 的冲击已在买入价中）。

### D4: 比率封顶 1 作为安全网

`getRetentionRate` 输出经 3% 保底与曲线插值，单调数据下 `R(sellAge) ≤ R(buyAge)` 天然成立；封顶 `min(1, ratio)` 防御两类边界：曲线数据非单调（历史维护可能出现）、极老机型两端同触 3% 底（ratio = 1，残值 = 买入价，符合「亮机底价稳定」语义）。

### D5: 类型 B 行为等价性验证

类型 B：buyAge = 0，R(0) = 100% → `residual = buyPrice × R(holding)/100`。旧公式 `currentNewPrice = buyPrice`（调用方如此传参）→ `residual = R(holding)/100 × buyPrice`。二者恒等，v38-wait-candidates 相关断言应全部保持通过——作为回归锚点。

## Risks / Trade-offs

- [全部二手方案的残值/月均成本数值变化] → 属预期行为变更（spec 已 MODIFIED）；引擎具体数值断言（consistency / v42-anchor-s0-residual / v38 部分）按新公式重算更新；结构性与不变量断言（前沿无支配、重算一致性、排序）应保持通过
- [「低价买入的套利空间」被模型抹平]（市场价低于曲线时，旧口径显示负月均成本）→ 这正是要修的 bug；锚定口径代表「按实际成交价折旧」的保守估计，符合产品定位（非套利工具）
- [SKILL.md 步骤 5 与引擎口径漂移] → 同一变更内同步更新 SKILL.md 公式文本与调整说明，保持 skill 文字流程与引擎一致
- [历史 skill 报告 fixtures 与新引擎数值不再一致] → 「skill 与小程序结果一致性」需求的 fixtures 语义随模型版本演进；主规格归档时同步该需求的表述（按模型版本 v4.3 口径），不追改历史报告
- [report.ts 自行展示「当前新品价」作参照] → 展示逻辑独立于残值计算，不受影响，人工验证即可

## Migration Plan

1. 引擎源码 + 单测更新 → `pnpm --filter apple-value-engine test`（或包内 vitest）全绿
2. `pnpm --filter apple-value-engine build`（tsc）→ ESM 冒烟
3. 同步 vendor：`node scripts/sync-engine.mjs`（pre-commit 钩子亦会同步快照）
4. 开发者工具中人工验证 result/detail 页数值（复现路径：iPhone 品类 → 等新品选项 → iPhone 15 Pro 128G 二手 × 1年，确认残值 < 买入价、月均成本 ≥ 0）
5. 回滚策略：revert 提交即可，无数据迁移、无存储格式变更
