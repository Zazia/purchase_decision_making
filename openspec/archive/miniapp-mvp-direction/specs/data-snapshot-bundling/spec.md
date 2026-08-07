## ADDED Requirements

### Requirement: 快照打包进小程序版本

小程序工程内 SHALL 维护一份 constants.json 快照副本（`miniapp/wx/snapshot/constants.json`），该副本 MUST 是 `.agents/skills/apple-value-analysis/constants.json` 的逐字拷贝。快照 MUST 随小程序版本号一起发布，MUST NOT 在运行时从远程拉取。

#### Scenario: 发版前同步快照

- **WHEN** 维护者执行小程序发版流程
- **THEN** 同步脚本将源 constants.json 拷贝到快照目录，快照内容与源文件 hash 一致

#### Scenario: 运行时不联网

- **WHEN** 用户在小程序中触发计算
- **THEN** 引擎读取本地打包快照，MUST NOT 发起任何网络请求获取 constants

### Requirement: 月更节奏与版本号绑定

快照更新节奏 SHALL 为每月 1 次，与 constants.json 月更同步。每次快照更新 MUST 递增小程序的 `minor` 版本号（如 1.0 → 1.1）。快照的 `last_updated` 字段 MUST 反映源 constants.json 的 `last_updated`，MUST NOT 用发版日期覆盖。

#### Scenario: 月更发版

- **WHEN** 8 月 constants.json 更新 `last_updated` 至 2026-08-05
- **THEN** 同步快照后小程序版本号从 1.0 递增至 1.1，快照内 `last_updated` 为 2026-08-05

#### Scenario: 非月更窗口不发版

- **WHEN** constants.json 在月中临时更新一次跑分数据
- **THEN** 快照不必同步，等下一个月更窗口统一同步，避免频繁发版打扰用户

### Requirement: 数据时效分级提示

结果页 SHALL 根据 `last_updated` 与当前日期的差值显示分级提示：≤ 35 天无提示；35–60 天黄色提示「数据已 N 天未更新，下次发版将刷新」；> 60 天红色提示「数据较旧，建议查看 GitHub 最新版」+ GitHub 链接。

#### Scenario: 35 天阈值切换

- **WHEN** `last_updated` 距今从 34 天变为 35 天
- **THEN** 提示从「无」切换为「黄色：数据已 35 天未更新，下次发版将刷新」

#### Scenario: 60 天阈值切换

- **WHEN** `last_updated` 距今从 60 天变为 61 天
- **THEN** 提示从「黄色」切换为「红色：数据较旧，建议查看 GitHub 最新版」+ GitHub 链接

### Requirement: 快照同步脚本

仓库 SHALL 提供同步脚本 `scripts/sync-snapshot.{js,mjs}`，将源 constants.json 拷贝到小程序快照目录，并校验：源文件存在、目标目录可写、拷贝后 hash 一致、`last_updated` 字段非空。脚本失败 MUST 退出非零码并指明失败步骤。

#### Scenario: 同步成功

- **WHEN** 维护者运行 `node scripts/sync-snapshot.mjs`
- **THEN** 控制台输出「Snapshot synced: <hash>」，退出码 0

#### Scenario: 源文件缺失

- **WHEN** 源 constants.json 不存在
- **THEN** 脚本输出「Source constants.json not found」，退出码 1

### Requirement: 云开发升级接口预留

快照访问层 SHALL 封装为 `getConstants()` 函数，当前实现返回本地打包快照。函数签名 MUST 兼容未来云开发实现（异步返回 Promise<Constants>），M2 升级时仅替换函数内部实现，MUST NOT 改动调用方代码。

#### Scenario: MVP 阶段本地读取

- **WHEN** 小程序调用 `getConstants()`
- **THEN** 返回 `Promise.resolve(localSnapshot)`，无网络请求

#### Scenario: M2 升级路径

- **WHEN** M2 引入云函数周更
- **THEN** `getConstants()` 内部改为先查云数据库缓存、失败回退本地快照，调用方代码零改动
