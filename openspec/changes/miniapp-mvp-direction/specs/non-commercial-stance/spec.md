## ADDED Requirements

### Requirement: 个人主体注册与类目限制

小程序 SHALL 以个人主体注册，MUST 注册为「工具-效率」类目，MUST NOT 申请电商、导购、生活服务-电商平台等需要企业资质的类目。个人主体的选择 MUST 在仓库文档中明示（README 或独立 `STANCE.md`），说明这是有意识的决策而非临时权宜。

#### Scenario: 类目选择

- **WHEN** 注册小程序时选择类目
- **THEN** 仅选择「工具-效率」，不申请任何电商相关类目

#### Scenario: 文档明示

- **WHEN** 维护者或用户查看仓库文档
- **THEN** 能找到「个人主体 + 无商业化」的明确声明，以及该选择对功能边界的影响说明

### Requirement: 不接入支付能力

小程序 MUST NOT 接入微信支付，MUST NOT 调用 `wx.requestPayment`，MUST NOT 包含任何付费/订阅/会员功能入口。代码库中 MUST NOT 存在支付相关 SDK 依赖。

#### Scenario: 代码审查支付依赖

- **WHEN** 扫描小程序代码与依赖
- **THEN** 不存在 `wx.requestPayment` 调用，不存在支付 SDK 依赖，不存在会员/订阅 UI

### Requirement: 不挂外部购买链接与分销

小程序所有页面 MUST NOT 出现京东、淘宝、拼多多等电商平台的购买链接、分销链接、京东联盟/多客链接。分享卡与结果页 MUST NOT 包含「立即购买」「下单」「去购买」等导购入口。

#### Scenario: 结果页无外链

- **WHEN** 用户在结果页查看推荐方案
- **THEN** 每个方案仅展示机型/持有期/月均成本等分析数据，MUST NOT 出现购买链接或跳转电商按钮

#### Scenario: 分享卡无导购

- **WHEN** 用户生成分享卡
- **THEN** 分享卡内容仅含分析数据与小程序码，MUST NOT 含电商平台 logo、购买按钮或购买链接

### Requirement: 文案禁用与替代清单

全站文案 MUST NOT 出现以下禁用词，MUST 使用对应替代词：
- 「推荐购买」→「推荐方案」
- 「立即下单」「下单」→「查看方案详情」
- 「最低价」→「月均成本最低」
- 「性价比之王」「最值得买」→「前沿上的方案」「非劣方案」

文案审查 MUST 在提审前执行一遍全站扫描。

#### Scenario: 结果页文案

- **WHEN** 结果页展示推荐方案
- **THEN** 文案为「前沿上的 3 个非劣方案」，MUST NOT 为「最值得买的 3 款」

#### Scenario: 分享卡文案

- **WHEN** 分享卡标题生成
- **THEN** 文案为「预算 5000 元的 Mac mini 非劣方案」，MUST NOT 为「预算 5000 元最值得买的 Mac mini」

### Requirement: 商业化软约束的解锁条件

以下能力 MUST NOT 在主体变更前实现，MUST 在主体变更为企业/个体工商户后才解锁：
- 微信支付与付费功能
- 京东联盟/分销链接
- B 端工具订阅
- 数据 API 商业化

主体变更决策 MUST 触发新 OpenSpec change，MUST NOT 在本 change 范围内偷偷实现。

#### Scenario: MVP 阶段不实现付费

- **WHEN** 处于个人主体阶段
- **THEN** 代码库中不存在付费功能、订阅入口、B 端工具相关代码

#### Scenario: 主体变更触发新提案

- **WHEN** 维护者决定迁移至企业/个体工商户主体
- **THEN** 创建新的 OpenSpec change（如 `migrate-to-business-entity`），本 change 不动

### Requirement: 独立性声明与可信度建设

仓库 SHALL 在 README 或 `STANCE.md` 中声明：本工具不接广告、不挂分销、不收付费，分析结论不受任何品牌方影响。该声明 MUST 与 `METHOD.md` 的方法论透明度呼应（公式公开、数据来源标注、可复现）。

#### Scenario: 用户查看独立性声明

- **WHEN** 用户在 GitHub README 或小程序内查看关于页
- **THEN** 能看到「无商业化、无利益相关」的明确声明，链接到 METHOD.md 的方法论透明度说明

### Requirement: 决策框架独立性的技术保障

引擎的帕累托前沿算法 MUST 不接受任何「品牌权重」「商业系数」参数，MUST NOT 在计算链路中存在可被商业方影响的可调因子。所有宏观因子调整 MUST 基于 constants.json 中可追溯的数据来源字段，MUST NOT 支持运行时手动覆盖。

#### Scenario: 算法无商业参数

- **WHEN** 审查引擎 API 签名
- **THEN** `computeParetoFrontier` 的参数仅含决策输入（品类/预算/持有期/买入时机/性能地板），MUST NOT 含品牌权重或商业系数

#### Scenario: 宏观因子可追溯

- **WHEN** 引擎应用宏观因子调整（如存储超级周期产能因子 2.0）
- **THEN** 该因子值 MUST 来自 constants.json，且 constants.json 中该字段 MUST 标注数据来源与更新日期
