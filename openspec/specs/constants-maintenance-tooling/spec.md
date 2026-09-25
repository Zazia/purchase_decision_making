## Purpose

为 constants.json 的本地例行维护提供自动化工具链：结构校验 lint 与一键「校验 → 发布 → 云端核验」流水线，把原本靠人工记忆按序执行的操作固化为可重复的命令，任一环节失败即中止。

## ADDED Requirements

### Requirement: constants 结构校验 lint

仓库 SHALL 提供 lint 脚本对源 `constants.json` 做结构校验，检查项 MUST 包含：JSON 可解析；`metadata.last_updated` 非空且为合法日期、`metadata.version` 存在；payload 字节数 ≤ 450KB（云端单文档 512KB 的安全余量）；数值型字段值以数字开头（防引擎 `parsePercent` 解析隐患，字段清单可在脚本内维护）。发现违规 MUST 退出非零码，并逐条输出违规的键路径与当前值；全部通过时输出摘要并退出码 0。

#### Scenario: 校验通过

- **WHEN** constants.json 结构完好、数值字段全部数字开头
- **THEN** lint 输出各项检查摘要，退出码 0

#### Scenario: 数值字段非数字开头

- **WHEN** 某数值型字段值为「约748」之类非数字开头的复合文本
- **THEN** lint 退出非零码，输出该字段的键路径与值，指明「数值字段须数字开头」

#### Scenario: metadata 缺失

- **WHEN** `metadata.last_updated` 为空或 `version` 缺失
- **THEN** lint 退出非零码，输出缺失字段名与修复指引

### Requirement: 一键维护流水线

仓库 SHALL 提供一键流水线命令（npm script），按序执行 `lint → publish（既有发布脚本）→ 云端核验`。前序环节失败时 MUST 中止后续环节并以非零码退出，错误输出 MUST 指明失败在哪个环节。流水线 MUST 支持干跑模式（仅 lint + 发布脚本 `--dry-run`，不产生任何网络写入）。全部环节成功时输出各环节摘要与最终云端文档版本。

#### Scenario: 全链路成功

- **WHEN** 数据与凭证均就绪，运行流水线命令
- **THEN** lint、发布、云端核验依次成功，控制台输出各环节摘要与云端文档 version/publishedAt，退出码 0

#### Scenario: lint 失败中止发布

- **WHEN** constants.json 存在结构违规时运行流水线
- **THEN** 流水线在 lint 环节终止，不发起任何发布请求，退出非零码并指明「lint 环节失败」

#### Scenario: 干跑模式

- **WHEN** 以干跑参数运行流水线
- **THEN** 仅执行 lint 与发布脚本 dry-run 校验，不产生网络写入，输出模拟摘要

### Requirement: 发布后云端核验

流水线在发布成功后 SHALL 自动核验云端 `constants.latest` 文档与本地源文件的一致性：比对云端文档 payload 的 sha256 与本地文件哈希、云端 `version` 与本地 `metadata.last_updated`。不一致或云端读取失败 MUST 判定流水线失败并退出非零码，输出本地/云端两侧的实际值。

#### Scenario: 核验一致

- **WHEN** 发布成功后执行云端核验
- **THEN** 云端文档哈希与 version 均与本地一致，核验通过

#### Scenario: 核验不一致报错

- **WHEN** 云端文档内容与本地文件哈希不一致（如发布到了错误环境或被并发覆盖）
- **THEN** 流水线判失败退出非零码，输出本地与云端两侧的哈希与版本对照

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
