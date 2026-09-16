## ADDED Requirements

### Requirement: iPhone ProMax 芯片解析
引擎 SHALL 将 iPhone 14–18 ProMax 分别映射至 A16、A17_Pro、A18_Pro、A19_Pro、A20_Pro，Duo 映射至 A20_Pro。

#### Scenario: ProMax 不退化为标准版
- WHEN 从市场快照生成 ProMax 候选
- THEN 候选使用对应 Pro 芯片跑分，标准版仍使用其自身芯片。

### Requirement: 发布窗口回归夹具隔离
算法回归测试 SHALL 显式固定所需发布窗口和置信度，不依赖滚动数据维持历史发布状态。

#### Scenario: constants 滚动到下一代
- WHEN 生产发布预测超出 90 天窗口
- THEN 真实数据不生成等待候选，固定临近发布夹具仍覆盖类型 B/C 残值与候选生成。
