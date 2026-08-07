## ADDED Requirements

### Requirement: 决策树引导式表单

小程序 SHALL 提供 5 步单选决策树：品类 → 预算 → 持有期 → 新品/二手 → 性能地板。每步 MUST 是单选题，每步 MUST 包含「不确定」选项。用户完成 5 步后进入结果页。决策树路径 MUST 可埋点（每步选择可上报）。

#### Scenario: 完整决策路径

- **WHEN** 用户依次选择「Mac mini」「5000」「3 年」「二手」「0.7」
- **THEN** 进入结果页，引擎用上述参数计算帕累托前沿

#### Scenario: 选择「不确定」分支

- **WHEN** 用户在某一步选择「不确定/帮我选」
- **THEN** 显示「AI 顾问功能开发中，已为您使用默认参数」提示，并使用该品类的默认参数继续流程；MUST NOT 阻塞主路径

### Requirement: 引擎调用与结果展示

结果页 SHALL 调用 `apple-value-engine` 计算帕累托前沿，展示结论先行的推荐区间（非劣方案列表 + 月均成本范围），下方展示帕累托图。推荐区间 MUST 按「月均成本从低到高」排序，每个方案 MUST 显示机型、买入时机、持有期、月均成本、性能满足度。

#### Scenario: 展示非劣方案

- **WHEN** 引擎返回 3 个前沿点
- **THEN** 结果页顶部列出 3 个方案，按月均成本升序，每行含机型/买入时机/持有期/月均成本/性能满足度

#### Scenario: 空结果兜底

- **WHEN** 用户约束过严导致前沿为空（如预算 1000 买 Mac Studio）
- **THEN** 显示「当前约束下无非劣方案，建议放宽预算或性能地板」，并给出最近可行方案（去掉一个约束后的前沿）

### Requirement: 帕累托图渲染

结果页 SHALL 用 ec-canvas 渲染静态帕累托散点图，横轴月均成本、纵轴性能满足度。前沿点 MUST 高亮（实心+品牌色），被支配点 MUST 灰显，推荐区间内的点 MUST 加边框。MUST 关闭 tooltip 与缩放交互，点击点位 MUST 跳转该方案详情页。

#### Scenario: 前沿与被支配点区分

- **WHEN** 引擎返回 5 个前沿点 + 8 个被支配点
- **THEN** 帕累托图中 5 个前沿点为实心品牌色，8 个被支配点为浅灰

#### Scenario: 点击跳详情

- **WHEN** 用户点击图中某点
- **THEN** 跳转到方案详情页，展示该方案的完整成本分解（买入价/预期残值/维修成本/持有月数/性能满足度计算）

### Requirement: 分享卡生成与分享

分享卡页 SHALL 用 `<canvas type="2d">` 离屏渲染 1080×1440 竖图，内容包含：用户预算、推荐方案摘要、帕累托前沿缩略图、小程序码。用户点击「生成分享卡」MUST 调用 `wx.canvasToTempFilePath` 导出图片，并支持保存到相册与转发。`onShareAppMessage` MUST 配置 `imageUrl` 为生成的分享卡图片。

#### Scenario: 生成分享卡

- **WHEN** 用户在结果页点击「生成分享卡」
- **THEN** 进入分享卡页，离屏 canvas 已就绪，500ms 内返回 tempFilePath，页面预览生成的竖图

#### Scenario: 转发分享卡

- **WHEN** 用户点击「转发给朋友」
- **THEN** 调用 `onShareAppMessage`，分享卡片使用生成的 1080×1440 图作为 `imageUrl`，分享路径带回用户参数（预算/品类）用于裂变追踪

### Requirement: 个人主体类目与文案约束

小程序 MUST 注册为「工具-效率」类目（个人主体可办），MUST NOT 申请电商、导购类目。所有页面文案 MUST NOT 出现「推荐购买」「立即下单」「下单」「最低价」「性价比之王」字样，MUST 使用「推荐方案」「非劣方案」「查看方案详情」「月均成本最低」「前沿上的方案」替代。

#### Scenario: 文案审核通过

- **WHEN** 提审小程序
- **THEN** 全站文案无导购字样，结果页与分享卡均无外部购买链接，符合个人主体工具类目审核要求

### Requirement: 数据时效提示

结果页底部 SHALL 显示 constants 快照的 `last_updated` 日期。距 `last_updated` 35–60 天 MUST 显示黄色提示「数据已 N 天未更新，下次发版将刷新」；超过 60 天 MUST 显示红色提示「数据较旧，建议查看 GitHub 最新版」并附 GitHub 链接。

#### Scenario: 数据新鲜

- **WHEN** 快照 `last_updated` 距今 20 天
- **THEN** 结果页底部显示「数据更新于 YYYY-MM-DD」，无提示

#### Scenario: 数据较旧

- **WHEN** 快照 `last_updated` 距今 45 天
- **THEN** 结果页底部黄色提示「数据已 45 天未更新，下次发版将刷新」

### Requirement: 引擎与小程序的解耦

小程序 MUST 通过 workspace 协议引用 `apple-value-engine`，MUST NOT 在小程序代码中复制引擎实现。引擎升级时小程序仅更新依赖版本号 + 重测，MUST NOT 改动业务代码。

#### Scenario: 引擎升级

- **WHEN** 引擎发布新版本修复保值率插值 bug
- **THEN** 小程序仅更新 `package.json` 中 `apple-value-engine` 版本号，跑通测试后发版，业务代码无改动
