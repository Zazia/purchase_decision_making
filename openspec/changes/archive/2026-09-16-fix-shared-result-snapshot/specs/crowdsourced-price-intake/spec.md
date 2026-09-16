## ADDED Requirements

### Requirement: 分享结果快照恢复

二维码与已上传方案卡片 SHALL 通过同一云ID展示分享时保存的结果快照，包括用户修改后的价格、成本、前沿及推荐列表，MUST NOT 重新计算覆盖快照。修改版 SHALL 标注基于用户输入价。公开响应 SHALL 只包含分享展示所需字段，MUST NOT 返回身份、授权元数据、用户价格子集或原始分析对照。旧params-only记录 SHALL 保持兼容；v2缺失快照 MUST 明确报错。

#### Scenario: 扫码或卡片打开修改版

- **WHEN** 分享者保存2500元修改版并通过二维码或卡片分享
- **THEN** 接收者看到保存的2500元与对应结果，不恢复成2700元推荐价

#### Scenario: 接收者继续转发

- **WHEN** 接收者转发已加载的共享结果
- **THEN** 链接保留原云ID并展示同一快照

#### Scenario: 私有字段隔离

- **WHEN** 公开get返回v2结果
- **THEN** 只返回白名单结果字段，不包含匿名身份及分析元数据

## MODIFIED Requirements

### Requirement: 影子数据库与快照隔离

分析数据 SHALL 与分享数据一起写入 shared_results，作为单次保存记录的一部分；本功能 MUST NOT 再写 price_intake_shadow 或要求客户端调用独立价格上传接口。管线 SHALL 直接消费已确认分析用途的分享记录，并保持与 constants 的数据隔离。用户价格 MUST NOT 直接回写 constants、影响其他用户计算或作为已核实成交展示。原始推荐对照 SHALL 保留，无原始推荐的自定义方案 SHALL 明确缺省。公开分享读取 MUST NOT 返回匿名身份及私有分析元数据。

#### Scenario: 一次写入用于分享和分析

- **WHEN** 已确认的一次分享上传成功
- **THEN** shared_results 新增或复用一条记录，分析直接读取该记录，constants 和其他用户结果均不变化

#### Scenario: 记录含原始推荐对照

- **WHEN** 用户将原始推荐价 2700 改为 2500 后保存
- **THEN** 同条分享记录保留用户价格 2500 与原始对照 2700，并记录对应机型字段

#### Scenario: 公开接口最小返回

- **WHEN** 他人扫码读取分享
- **THEN** v2返回分享所需参数和白名单结果快照，不暴露匿名标识、分析同意元数据、用户提交价子集或原始分析对照；旧记录返回参数
