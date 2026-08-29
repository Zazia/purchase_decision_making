## MODIFIED Requirements

### Requirement: 数据时效提示

结果页底部 SHALL 显示「当前生效数据源」的 `last_updated` 日期（云端文档或本地打包快照，取 `getConstants()` 加载链实际采用者）。距 `last_updated` 35–60 天 MUST 显示黄色提示「数据已 N 天未更新，重启小程序可刷新」；超过 60 天 MUST 显示红色提示「数据较旧，建议查看 GitHub 最新版」并附 GitHub 链接。

#### Scenario: 数据新鲜

- **WHEN** 当前生效数据源的 `last_updated` 距今 20 天
- **THEN** 结果页底部显示「数据更新于 YYYY-MM-DD」，无提示

#### Scenario: 数据较旧

- **WHEN** 当前生效数据源的 `last_updated` 距今 45 天
- **THEN** 结果页底部黄色提示「数据已 45 天未更新，重启小程序可刷新」
