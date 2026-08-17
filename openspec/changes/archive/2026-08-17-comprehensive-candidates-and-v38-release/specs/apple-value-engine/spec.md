## MODIFIED Requirements

### Requirement: 引擎以纯函数形式提供帕累托前沿计算

引擎 SHALL 暴露纯函数 API，给定 constants 数据 + 决策参数，返回帕累托前沿与推荐区间。引擎 MUST NOT 内嵌 constants 数据，MUST NOT 发起网络请求，MUST NOT 产生副作用。`BuyTiming` 类型 SHALL 扩展为 `'new' | 'used' | 'both'`：当传入 `'both'` 时，引擎 MUST 同时收集「新品」与「二手」候选，每个候选对象自身的 `buyTiming` 字段 MUST 为 `'new'` 或 `'used'`（具体到机型）。

#### Scenario: 给定有效参数返回前沿

- **WHEN** 调用 `computeParetoFrontier(constants, { category: 'mac-mini', budget: 5000, holdingYears: [2,3,4], buyTiming: 'used', performanceFloor: 0.7 })`
- **THEN** 返回 `{ frontier: Array<Point>, dominated: Array<Point>, recommendationRange: { lowerCost, upperCost } }`，frontier 中每个点不存在「成本更低且性能更高」的其他点

#### Scenario: 数据注入而非内嵌

- **WHEN** 引擎被加载
- **THEN** 引擎包内 MUST NOT 包含 constants.json 数据文件，调用方 MUST 通过 `loadConstants(jsonText)` 显式注入

#### Scenario: buyTiming='both' 同时生成新品与二手候选

- **WHEN** 调用 `computeParetoFrontier(constants, { category: 'mac-mini', budget: 5000, holdingYears: [2,3,4], buyTiming: 'both', performanceFloor: 0.4 })`
- **THEN** 候选列表 MUST 同时包含 `buyTiming='new'` 与 `buyTiming='used'` 的候选点；新品与二手候选 MUST 出现在同一帕累托前沿上比较

#### Scenario: 多持有期生成多倍候选点

- **WHEN** 调用时 `holdingYears=[2,3,4,5]`，品类下有 3 个机型候选
- **THEN** 候选点总数 = 3 × 4 = 12 个（不考虑 B/C 候选），frontier 与 dominated 合并包含全部 12 个点

### Requirement: 帕累托前沿筛选

引擎 SHALL 在「月均成本 × 持有期平均性能满足度」二维平面上筛选非劣解。前沿点定义为：不存在其他点同时满足成本更低且性能更高。用户偏好 SHALL 仅用于在前沿上截取推荐区间，MUST NOT 改变前沿本身。

**性能地板语义变更**：`performanceFloor` SHALL 仅作为图上参考线与推荐区间内的「达标/低于地板」徽章标注，MUST NOT 用于过滤候选点。推荐区间 `recommendationRange` SHALL 仅按 `buyPrice <= budget` 一个硬约束截取，低于性能地板的候选 MUST 保留在 frontier 与 dominated 中可见。

#### Scenario: 剔除被支配点

- **WHEN** 候选点集包含 A(成本 100, 性能 0.8) 和 B(成本 120, 性能 0.7)
- **THEN** B 被 A 支配，frontier 中 MUST NOT 包含 B

#### Scenario: 性能地板不过滤候选

- **WHEN** 用户设置 `performanceFloor=0.7`，frontier 中存在性能 0.5 的候选点 A
- **THEN** A MUST 仍出现在 `frontier` 数组中；`recommendationRange.plans` 仅包含 `buyPrice <= budget` 的候选，A 是否在推荐区间内仅取决于买入价，不取决于性能

#### Scenario: 推荐区间仅按预算截取

- **WHEN** 用户设置 `budget=5000`，frontier 中有 3 个点买入价分别为 3000/4500/6000
- **THEN** `recommendationRange.plans` MUST 仅包含买入价 3000 与 4500 的两个点（按月均成本升序），买入价 6000 的点保留在 frontier 但不在推荐区间

### Requirement: 月均成本计算

引擎 SHALL 计算月均成本 = (买入价 − 预期卖出残值 + 持有期预期维修成本) / 持有月数。维修成本 MUST 按品类查表（电池更换 + 年均故障维修），预期残值 MUST 用调整后保值率 × 当前同品类新品价。

**类型 B/C 候选残值规则**：
- 类型 A（现在买）：若持有期内有新品发布，残值 MUST 施加新品发布冲击调整（按 `_冲击时变曲线_v3.8` 的「残值调整因子」）
- 类型 B（等新品买新品）：残值 MUST NOT 施加新品冲击（买入的就是新品）
- 类型 C（等新品后买降价老款）：残值 MUST NOT 施加新品冲击（冲击已体现在买入价下降中）；卖出时机龄 = 当前机龄 + 等待月数 + 持有月数

#### Scenario: 二手机型月均成本

- **WHEN** 给定 mac-mini 二手买入价 2700、持有 3 年、保值率 0.42、当前新品价 4499、维修成本 200/年
- **THEN** 返回月均成本 = (2700 − 0.42×4499 + 200×3) / 36

#### Scenario: 类型 C 残值不施加冲击

- **WHEN** 类型 C 候选当前机龄 42 月、等待月数 3、持有 24 月，原始保值率查表为 0.30
- **THEN** 残值计算 MUST 用 0.30（不乘以冲击时变因子）；卖出时机龄 = 42 + 3 + 24 = 69 月

### Requirement: 性能满足度计算

引擎 SHALL 实现 `S(t) = S(0) / (1 + r)^(t/12)` 公式与「持有期平均性能满足度 S̄(N) = [S(0) + S(N)] / 2」公式，含芯片代际跃升识别（节点首发代际下调 r×0.5，跃升代际上调 r×1.5）。性能满足度 MUST 同时考虑芯片性能系数、内存权重、存储权重。

**类型 B 新品性能规则**：类型 B 候选（等新品买新品）的 `S(0)` MUST 为 `1.0`（新品为新的基准芯片），`S(N) = 1.0 / (1 + effectiveR)^(N/12)`，`S̄(N) = (1.0 + sN) / 2`。`effectiveR` MUST 通过 `getEffectiveR` 应用代际跃升调整（若 `releasePlan` 对应代际在 `chipGenerationAssumptions.per_generation详表_v3.8` 标注为跃升/节点首发）。

**类型 C 性能规则**：类型 C 候选的 `S(0)` 与 `S̄(N)` 与类型 A（现在买同款）相同。

#### Scenario: 普通代际衰减

- **WHEN** 计算 M3 机型持有 3 年的平均性能满足度，M3 相对 M2 为普通代际
- **THEN** 使用 r = 0.16/年衰减，返回 S̄(3)

#### Scenario: 跃升代际上调

- **WHEN** 计算 M5 机型持有 3 年的平均性能满足度，constants 标注 M5 为跃升代际
- **THEN** 该代际衰减系数上调为 r × 1.5 = 0.24/年

#### Scenario: 类型 B 新品性能 S(0)=100%

- **WHEN** 计算类型 B 候选（下一代新品）持有 24 月的平均性能满足度，r=0.16，无代际跃升
- **THEN** `S(0) = 1.0`，`S(24) = 1.0 / 1.16^2 = 0.743`，`S̄(24) = (1.0 + 0.743) / 2 = 0.872`

## ADDED Requirements

### Requirement: PlanPoint 候选类型与等待月数字段

`PlanPoint` 类型 SHALL 新增字段：
- `candidateType: 'A' | 'B' | 'C'`：A=现在买，B=等新品买新品，C=等新品后买降价老款
- `waitMonths?: number`：等待月数（仅类型 B/C，含缺货延迟）
- `predictedPrice?: boolean`：买入价是否为预测值（类型 B/C 恒为 true）
- `systemSupportRisk?: 'normal' | 'near-end' | 'exceeded'`：系统支持期风险标注
- `systemSupportExceedMonths?: number`：超出系统支持期的月数（仅 exceeded 时有值）

#### Scenario: 类型 A 候选字段填充

- **WHEN** 生成类型 A 候选点（现在买 Mac mini M2 二手，持有 24 月，macOS 支持期 72 月，当前机龄 42 月）
- **THEN** `candidateType='A'`，`waitMonths` 不设置，`predictedPrice=false`，`systemSupportRisk='normal'`（42+24=66 < 72）

#### Scenario: 类型 B 候选字段填充

- **WHEN** 生成类型 B 候选点（等 iPhone 18 Pro 发布后买新品，等待 2 月，持有 24 月）
- **THEN** `candidateType='B'`，`waitMonths=2`，`predictedPrice=true`

#### Scenario: 系统支持期超出标注

- **WHEN** 类型 A 候选 Mac mini M1 当前机龄 60 月，持有 24 月，macOS 支持期 72 月
- **THEN** `systemSupportRisk='exceeded'`，`systemSupportExceedMonths=12`（60+24-72=12）

### Requirement: DecisionParams 扩展 considerWait 与 macroContext

`DecisionParams` SHALL 新增可选字段：
- `considerWait?: boolean`：是否考虑等新品候选，默认 `true`（引擎自动判断是否生成 B/C 候选）
- `macroContext?: MacroContext`：宏观状态，由调用方注入

`MacroContext` 类型 SHALL 包含：
- `storageSuperCycleStage: 'ongoing' | 'peaking' | 'easing' | 'none'`：存储超级周期阶段
- `hasGlobalPriceHike: boolean`：是否检测到苹果全线涨价事件
- `analysisMonth: string`：分析日期（YYYY-MM）

`macroContext` 缺省时引擎 MUST 按 `storageSuperCycleStage: 'none'` + `hasGlobalPriceHike: false` 处理，保证向后兼容。

#### Scenario: macroContext 缺省向后兼容

- **WHEN** 调用 `computeParetoFrontier(constants, { category, budget, holdingYears, buyTiming, performanceFloor })`（未传 `macroContext`）
- **THEN** 引擎按 `storageSuperCycleStage='none'` 处理，不触发宏观修正，结果与上一版本一致

#### Scenario: considerWait=false 关闭 B/C 候选

- **WHEN** 调用时 `considerWait=false`，某品类距下次发布 30 天
- **THEN** 引擎 MUST NOT 生成类型 B/C 候选，仅生成类型 A
