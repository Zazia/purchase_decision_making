## ADDED Requirements

### Requirement: 按给定方案集重算帕累托前沿

引擎 SHALL 暴露纯函数，给定 constants 数据 + 一组用户方案点（含可覆盖的买入价、可新增的自定义机型属性）+ 决策参数，返回重算后的 `{ frontier, dominated, recommendationRange }`。该函数 MUST NOT 重新从 constants 市场快照提取候选，MUST 在调用方传入的方案集上做帕累托筛选与推荐区间截取。对用户覆盖了买入价的方案，MUST 用引擎既有月均成本公式（`computeMonthlyCost` 语义）按新买入价重算月均成本；对用户新增的自定义方案，MUST 用其芯片/内存/存储/品类/持有期通过既有性能与成本公式计算。函数 MUST 保持纯函数、零运行时依赖、三端可运行。

#### Scenario: 覆盖买入价后重算

- **WHEN** 调用方传入 1 个方案点（机型 M2 Mac mini、二手、持有 3 年、原始买入价 2700）并将其买入价覆盖为 2500
- **THEN** 返回结果中该方案的月均成本基于 2500 重算，性能满足度不变，前沿筛选基于重算后的月均成本

#### Scenario: 新增自定义方案参与前沿

- **WHEN** 调用方在方案集中新增一个自定义方案（芯片 M2、内存 16G、存储 256G、品类 Mac_mini、二手、买入价 2600、持有 3 年）并调用重算
- **THEN** 引擎按该配置计算月均成本与性能满足度，并将其纳入帕累托前沿筛选；若该点非劣则出现在 frontier，否则出现在 dominated

#### Scenario: 排除与暂不考虑方案不参与重算

- **WHEN** 调用方传入 5 个方案点，但其中 2 个标记为「已排除/暂不考虑」
- **THEN** 重算结果仅基于未排除的 3 个方案点，frontier 与 dominated 中 MUST NOT 出现被排除的点

#### Scenario: 不可解析自定义方案被拒

- **WHEN** 调用方传入一个自定义方案，其芯片名无法在 constants 的 chip_benchmarks 中匹配
- **THEN** 引擎返回明确错误（指明无法识别的芯片），该方案不参与重算，调用方可据此向用户提示

### Requirement: 重算结果与原始计算口径一致

重算函数使用的月均成本、性能满足度、保值率插值、维修成本、系统支持期风险标注口径 MUST 与 `computeParetoFrontier` 完全一致，确保「用户改价前后」的对比在同一口径下进行。推荐区间截取规则 MUST 与 `computeParetoFrontier` 一致（仅按预算硬约束截取，性能地板仅作参考线）。

#### Scenario: 改价前后口径一致

- **WHEN** 用户未修改任何买入价，直接用原始方案集调用重算函数
- **THEN** 重算返回的 frontier/dominated/recommendationRange 与 `computeParetoFrontier` 原始结果在月均成本与性能满足度上一致（误差 ≤ 0.5 元 / ≤ 0.001）

#### Scenario: 推荐区间仅按预算截取

- **WHEN** 用户修改若干买入价后重算，部分方案买入价超过预算
- **THEN** recommendationRange 仅包含买入价 ≤ 预算的前沿方案，性能地板不参与过滤
