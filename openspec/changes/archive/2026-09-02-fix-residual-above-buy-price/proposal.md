# fix-residual-above-buy-price

## Why

部分方案点出现「预期卖出残值 > 买入价」，月均成本为负（如 `iPhone_15_Pro_128G_二手 × 1年`：类型 C 买入 2925 / 残值 3345 / 月均 **-18 元**；类型 A 买入 3250 / 残值 3368）。根因是残值采用「市场价值口径」（残值 = 卖出机龄保值率 × 当前同品类新品价），与买入价脱钩：

1. **类型 C 冲击不对称**：买入价按本场新品发布施加了冲击折扣（× (1+锚涨幅) × (1−冲击×时变因子)），但残值按未受冲击的保值曲线计算——买入价降低而残值不降。v4.2 规定「类型 C 残值不施加冲击」的理由「冲击已体现在买入价中」只覆盖买入时点，未覆盖卖出时点。
2. **数据口径不一致**：买入价取快照市场价（iPhone 15 Pro 128G 闲鱼中位 3250 ≈ 当前新品价 8999 的 36%），而保值曲线隐含值更高（35 月曲线 ≈46% × 8999 ≈ 4162）。买入用市场价、卖出用曲线值，短持有期即出现「低买高卖」套利假象。

残值应与买入价同口径：以买入价为锚，按保值曲线取买入→卖出区间的**相对衰减**，结构性保证残值 ≤ 买入价。

## What Changes

- **残值公式改为买入价锚定（v4.3）**：残值 = 买入价 × R(卖出机龄) / R(买入机龄)，比率封顶 1（安全网，防曲线非单调数据）。适用于类型 A/B/C 全部候选：
  - 类型 A：买入机龄 = 当前机龄（v4.2 发布冲击时变调整仍叠加在锚定残值之上）
  - 类型 B：买入机龄 = 0（R(0)=100%，行为与旧公式等价）
  - 类型 C：买入机龄 = 当前机龄 + 等待月数（冲击折扣自然锚定进残值，消除不对称）
- `computeMonthlyCost` / `computeMonthlyCostForWaitCandidate` 的 `currentNewPrice` 参数与 `CostBreakdown.currentNewPrice` 降级为**信息性字段**（报表展示用），不再作为残值分母。
- **BREAKING**（模型口径）：所有二手/老款新品方案的残值与月均成本数值会变化（市场价低于曲线隐含值时残值下调，反之亦上调）；引擎单测中的具体残值断言需按新公式更新。
- 同步 `.agents/skills/apple-value-analysis/SKILL.md` 步骤 5 残值公式，保证 skill 文字流程与引擎口径一致。
- 新增回归测试：全品类 × 全持有期扫描，断言所有方案点 `residual ≤ buyPrice` 且 `monthlyCost ≥ 0`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `apple-value-engine`：修改「月均成本计算」需求——预期卖出残值的计算公式从「保值率 × 当前同品类新品价」改为「买入价 × R(卖出机龄)/R(买入机龄)」，并新增「残值不得超过买入价」的不变量场景；「残值分母选择规则」条款相应废止/改写。

## Impact

- **引擎源码**：`packages/apple-value-engine/src/cost.ts`（残值公式）、`src/pareto.ts`（buyAge 传递，类型 C 推导买入机龄）
- **引擎测试**：`consistency.test.ts`、`v42-anchor-s0-residual.test.ts`、`v38-*.test.ts`、`recompute-frontier.test.ts` 中具体残值/月均成本断言；新增不变量回归测试
- **SOP 文档**：`.agents/skills/apple-value-analysis/SKILL.md` 步骤 5（公式与调整说明）
- **小程序**：无接口变更（`engine-bridge` 只用 `computeParetoFrontier`/重算函数）；`miniapp/wx/vendor` 引擎产物需重建同步；detail/result 页残值展示数值变化，需人工验证
- **数据不受影响**：constants.json、保值曲线、快照均不改
