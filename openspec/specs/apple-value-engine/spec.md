## ADDED Requirements

### Requirement: 引擎以纯函数形式提供帕累托前沿计算

引擎 SHALL 暴露纯函数 API，给定 constants 数据 + 决策参数，返回帕累托前沿与推荐区间。引擎 MUST NOT 内嵌 constants 数据，MUST NOT 发起网络请求，MUST NOT 产生副作用。

#### Scenario: 给定有效参数返回前沿

- **WHEN** 调用 `computeParetoFrontier(constants, { category: 'mac-mini', budget: 5000, holdingYears: [2,3,4], buyTiming: 'used', performanceFloor: 0.7 })`
- **THEN** 返回 `{ frontier: Array<Point>, dominated: Array<Point>, recommendationRange: { lowerCost, upperCost } }`，frontier 中每个点不存在「成本更低且性能更高」的其他点

#### Scenario: 数据注入而非内嵌

- **WHEN** 引擎被加载
- **THEN** 引擎包内 MUST NOT 包含 constants.json 数据文件，调用方 MUST 通过 `loadConstants(jsonText)` 显式注入

### Requirement: Constants 加载与校验

引擎 SHALL 提供 `loadConstants(jsonText: string): Constants` 函数，解析 constants.json 并校验必需字段（`last_updated`、`retention_curves`、`chip_benchmarks`、`market_snapshots`、`release_rhythm`、`maintenance_costs`）。校验失败 MUST 抛出明确错误，错误信息指明缺失字段。

#### Scenario: 加载合法 constants

- **WHEN** 传入符合 v3.8 结构的 constants.json 文本
- **THEN** 返回类型化的 Constants 对象，所有字段可被后续计算函数访问

#### Scenario: 加载缺失字段的 constants

- **WHEN** 传入缺少 `retention_curves` 的 JSON
- **THEN** 抛出 `ConstantsValidationError`，错误信息包含 "Missing required field: retention_curves"

### Requirement: 保值率插值与外推

引擎 SHALL 提供保值率计算函数，支持 0–60+ 月范围内的线性插值；超过数据范围时按最后一区间斜率外推。M 系列与 A 系列代际衰减（CAGR 16%/15%）MUST 作为参数可注入，不硬编码。

#### Scenario: 数据范围内插值

- **WHEN** 查询 iPhone 某机型 18 个月保值率，且数据点有 12 月和 24 月
- **THEN** 返回 12 月与 24 月的线性插值结果

#### Scenario: 数据范围外外推

- **WHEN** 查询 72 个月保值率，数据仅到 60 月
- **THEN** 按 48–60 月区间斜率外推至 72 月

### Requirement: 性能满足度计算

引擎 SHALL 实现 `S(t) = S(0) / (1 + r)^(t/12)` 公式与「持有期平均性能满足度 S̄(N) = [S(0) + S(N)] / 2」公式，含芯片代际跃升识别（节点首发代际下调 r×0.5，跃升代际上调 r×1.5）。性能满足度 MUST 同时考虑芯片性能系数、内存权重、存储权重。

#### Scenario: 普通代际衰减

- **WHEN** 计算 M3 机型持有 3 年的平均性能满足度，M3 相对 M2 为普通代际
- **THEN** 使用 r = 0.16/年衰减，返回 S̄(3)

#### Scenario: 跃升代际上调

- **WHEN** 计算 M5 机型持有 3 年的平均性能满足度，constants 标注 M5 为跃升代际
- **THEN** 该代际衰减系数上调为 r × 1.5 = 0.24/年

### Requirement: 月均成本计算

引擎 SHALL 计算月均成本 = (买入价 − 预期卖出残值 + 持有期预期维修成本) / 持有月数。维修成本 MUST 按品类查表（电池更换 + 年均故障维修），预期残值 MUST 用调整后保值率 × 当前同品类新品价。

#### Scenario: 二手机型月均成本

- **WHEN** 给定 mac-mini 二手买入价 2700、持有 3 年、保值率 0.42、当前新品价 4499、维修成本 200/年
- **THEN** 返回月均成本 = (2700 − 0.42×4499 + 200×3) / 36

### Requirement: 帕累托前沿筛选

引擎 SHALL 在「月均成本 × 持有期平均性能满足度」二维平面上筛选非劣解。前沿点定义为：不存在其他点同时满足成本更低且性能更高。用户偏好（性能地板、预算上限）SHALL 仅用于在前沿上截取推荐区间，MUST NOT 改变前沿本身。

#### Scenario: 剔除被支配点

- **WHEN** 候选点集包含 A(成本 100, 性能 0.8) 和 B(成本 120, 性能 0.7)
- **THEN** B 被 A 支配，frontier 中 MUST NOT 包含 B

#### Scenario: 推荐区间截取

- **WHEN** 用户设置预算上限 5000、性能地板 0.7
- **THEN** recommendationRange 为前沿上同时满足「月均成本对应的买入价 ≤ 5000」且「性能满足度 ≥ 0.7」的连续段

### Requirement: skill 与小程序结果一致性

引擎单测 fixtures SHALL 来自 skill 历史产出的 HTML 报告。相同输入下，引擎计算结果 MUST 与 skill 报告中的帕累托点一致（月均成本误差 ≤ 0.5 元，性能满足度误差 ≤ 0.001）。

#### Scenario: 与历史报告一致

- **WHEN** 用 skill 历史 v3.7 报告的输入参数调用引擎
- **THEN** 引擎返回的前沿点坐标与历史报告中帕累托图的点位一致，误差在阈值内

### Requirement: 引擎零运行时依赖

引擎 npm 包 MUST 仅依赖 TypeScript 类型定义，运行时依赖 MUST 为零（不含 lodash、moment 等）。MUST 支持浏览器、Node、小程序三端运行。

#### Scenario: 小程序端运行

- **WHEN** 在微信小程序中 `import { computeParetoFrontier } from 'apple-value-engine'`
- **THEN** 引擎正常运行，无 `require('fs')` 或 Node 专属 API 调用

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
