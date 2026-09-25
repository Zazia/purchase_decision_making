## ADDED Requirements

### Requirement: 保值率校准数据 lint
constants lint SHALL 校验首发价目录、二手观测和校准 manifest 的引用完整性。可校准观测 MUST 精确引用同地区同配置首发价，MUST NOT 使用当前新品价、后续调价、实际购入价或说明文本解析值作为曲线分母；违规时 lint MUST 退出非零码并输出完整键路径或观测 ID。

#### Scenario: 当前新品价被标为曲线分母
- **WHEN** 可校准观测引用的价格记录属于当前替代新品而非该型号同配置首发价
- **THEN** lint 退出非零码，输出观测 ID、错误价格记录和预期型号/配置

#### Scenario: 不可校准观测保留展示
- **WHEN** 某观测没有可核验首发价但明确标记 `calibration_eligible=false`
- **THEN** lint 允许其保留在市场展示数据中，但 MUST 确认它未出现在任何校准 manifest 输入列表

### Requirement: 曲线变更发布门禁
维护流水线 SHALL 检测 constants 中发生变化的保值率品类，并要求这些品类具有通过审计的校准 manifest、可重建拟合指标和对应测试。门禁 MUST 在同步快照或云端写入之前执行，普通市场价格更新未改变曲线时 MAY 跳过完整拟合但仍须通过结构引用校验。

#### Scenario: 曲线改变但 manifest 缺失
- **WHEN** 某品类节点相对已发布版本发生变化，而 constants 中没有匹配版本的校准 manifest
- **THEN** 流水线在网络写入前失败，指出缺失的品类与版本

#### Scenario: 仅更新市场快照
- **WHEN** constants 只更新二手市场价且没有改变曲线或校准资格
- **THEN** 流水线执行结构 lint 与常规发布核验，可跳过耗时的全量拟合交叉验证

### Requirement: 报告口径一致性校验
维护工具 SHALL 验证残值报告中与理论曲线比较的实测点全部来自曲线观测保值率；替代价值率和个体投资保值率 MUST 使用不同字段、标签和图层，且不得进入曲线 MAE、MAPE 或节点拟合。

#### Scenario: 报告把替代价值率计入 MAE
- **WHEN** 报告 payload 中某拟合点的分母类型为当前在售新品价
- **THEN** 报告校验失败并输出该点，生成脚本不得产生“拟合改善”结论

#### Scenario: 三类比率并列展示
- **WHEN** 同一观测同时具备首发价、当前同档新品价和用户实付价
- **THEN** 报告 MAY 展示三个指标，但曲线偏差列只使用曲线观测保值率

### Requirement: 全品类审计产物可追溯
全品类审计工具 SHALL 输出机器可读 JSON 与人类可读摘要，覆盖 constants 中每个保值率品类，记录曲线来源、观测数量、分母来源分布、校准历史、状态分类和建议动作。中间产物 MUST 位于 `scripts/debug/`。

#### Scenario: 审计覆盖完整
- **WHEN** constants 中存在 18 个保值率品类
- **THEN** 审计 JSON 恰好包含 18 个品类记录，任何遗漏使审计退出非零码
