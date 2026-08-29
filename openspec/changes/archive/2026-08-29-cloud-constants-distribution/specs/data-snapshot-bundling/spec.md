## MODIFIED Requirements

### Requirement: 快照打包进小程序版本

小程序工程内 SHALL 维护一份 constants.json 快照副本（`miniapp/wx/snapshot/constants.json`），该副本 MUST 是 `.agents/skills/apple-value-analysis/constants.json` 的逐字拷贝。快照 MUST 随小程序版本号一起发布，作为云端数据不可用（未配置/拉取失败/校验失败/版本回退）时的兜底基线。运行时数据加载顺序 MUST 遵循「云端优先、本地快照兜底」（详见「云端 constants 文档契约」与「云端优先的 constants 加载链」）。

#### Scenario: 发版前同步快照

- **WHEN** 维护者执行小程序发版流程
- **THEN** 同步脚本将源 constants.json 拷贝到快照目录，快照内容与源文件 hash 一致

#### Scenario: 云端不可用时回退本地快照

- **WHEN** 云端文档拉取失败（网络不可用、集合不存在、超时、`_ready` 为 false）或云端版本旧于本地打包快照
- **THEN** 引擎使用本地打包快照完成计算，页面功能完整可用，MUST NOT 向用户抛出错误中断

### Requirement: 月更节奏与版本号绑定

快照更新主节奏 SHALL 保持每月 1 次，与 constants.json 月更同步；每次快照更新 MUST 递增小程序的 `minor` 版本号（如 1.0 → 1.1）。快照的 `last_updated` 字段 MUST 反映源 constants.json 的 `last_updated`，MUST NOT 用发版日期覆盖。紧急数据修正（如错误价格勘误、新机型补录）SHALL 优先通过「constants 云端发布脚本」直接发布云端文档，MUST NOT 为数据修正单独提审发版。

#### Scenario: 月更发版

- **WHEN** 8 月 constants.json 更新 `last_updated` 至 2026-08-05
- **THEN** 同步快照后小程序版本号从 1.0 递增至 1.1，快照内 `last_updated` 为 2026-08-05

#### Scenario: 非月更窗口不发版

- **WHEN** constants.json 在月中临时更新一次跑分数据
- **THEN** 快照不必同步发版，维护者通过发布脚本更新云端 `latest` 文档，用户端下次会话即用新数据

### Requirement: 数据时效分级提示

结果页 SHALL 根据「当前生效数据源」的 `last_updated` 与当前日期的差值显示分级提示：≤ 35 天无提示；35–60 天黄色提示「数据已 N 天未更新，重启小程序可刷新」；> 60 天红色提示「数据较旧，建议查看 GitHub 最新版」+ GitHub 链接。当前生效数据源指 `getConstants()` 加载链实际选用的数据（云端文档或本地快照）。

#### Scenario: 35 天阈值切换

- **WHEN** 当前生效数据源的 `last_updated` 距今从 34 天变为 35 天
- **THEN** 提示从「无」切换为「黄色：数据已 35 天未更新，重启小程序可刷新」

#### Scenario: 60 天阈值切换

- **WHEN** 当前生效数据源的 `last_updated` 距今从 60 天变为 61 天
- **THEN** 提示从「黄色」切换为「红色：数据较旧，建议查看 GitHub 最新版」+ GitHub 链接

### Requirement: 云端优先的 constants 加载链

`getConstants()` SHALL 按以下顺序解析 constants 数据，且对外 API 签名（`Promise<Constants>`）与调用方代码 MUST 保持不变：

1. 内存缓存（会话内固定，MUST NOT 被后台刷新改写，保证同一次会话数据版本一致）
2. 本地存储缓存：存在有效正缓存时立即采用并触发后台静默刷新（只写存储、不改内存）
3. 无任何缓存（首次启动）：等待云端文档拉取（有超时上限，超时按失败处理）；成功且版本不低于本地打包快照时采用云端并写正缓存；失败写负缓存（带失效时间）
4. 云端所有路径失败时：使用本地打包快照兜底

版本仲裁规则 SHALL 为：仅当云端文档 `version` ≥ 本地打包快照 `metadata.last_updated` 时采用云端数据；否则使用本地快照，MUST NOT 发生数据版本回退。云端与本地存储缓存的数据 MUST 通过 `loadConstants()` 完整校验，校验失败按该来源不可用处理。负缓存 SHALL 带失效时间（默认 24 小时），未过期时跳过「等待云端」路径直接用本地快照 + 后台刷新，避免弱网用户每次冷启动都等待超时。

#### Scenario: 首次启动云端成功

- **WHEN** 用户首次打开小程序触发计算，云端 `latest` 文档存在且 `_ready=true`、版本 ≥ 本地快照
- **THEN** 采用云端数据，写入正缓存，后台无需再次拉取

#### Scenario: 云端版本旧于本地快照

- **WHEN** 小程序发版携带 `last_updated=2026-09-01` 的新快照，云端文档仍为 `2026-08-26`
- **THEN** 采用本地打包快照，MUST NOT 使用云端旧数据

#### Scenario: 弱网冷启动不反复等待

- **WHEN** 用户设备网络不可用且存在未过期负缓存
- **THEN** 冷启动直接用本地打包快照完成计算，不等待云端超时；后台刷新失败后刷新负缓存失效时间

#### Scenario: 会话内数据版本一致

- **WHEN** 会话启动后后台刷新拉到更新的云端数据
- **THEN** 本次会话内存缓存保持不变，新数据仅写入本地存储，下次会话生效

## ADDED Requirements

### Requirement: 云端 constants 文档契约

云端数据库 SHALL 使用集合 `constants`、文档 ID `latest` 承载分发数据，字段 MUST 包含：`_ready`（boolean，发布完成标记）、`version`（string，等于 payload 的 `metadata.last_updated`）、`payload`（string，源 constants.json 全文）、`macroContext`（object 或 null，对应 `miniapp/wx/snapshot/macro-context.json`）、`hash`（string，payload 的 sha256，供维护者核对）、`publishedAt`（string，发布时间 ISO 格式）。客户端 MUST 仅在文档 `_ready=true` 且 `payload` 可解析、可校验时采用。集合权限 MUST 配置为「所有用户可读、仅管理端可写」。发布操作 MUST 以单次文档更新原子写入全部字段（或先建 `_ready=false` 骨架再最终置 `_ready=true`），保证客户端不会读到半更新数据。

#### Scenario: 文档原子发布

- **WHEN** 发布脚本更新 `latest` 文档
- **THEN** 客户端任一时刻读取该文档，得到的是完整旧版或完整新版数据，不存在字段撕裂的中间态

#### Scenario: 客户端权限读取

- **WHEN** 任意小程序用户（未登录）触发计算
- **THEN** 客户端可直接读取 `constants.latest` 文档成功，无权限错误

### Requirement: constants 云端发布脚本

仓库 SHALL 提供发布脚本 `scripts/publish-constants.mjs`，将源 `.agents/skills/apple-value-analysis/constants.json` 与 `miniapp/wx/snapshot/macro-context.json` 发布为云端 `constants.latest` 文档。脚本 MUST：从 `miniapp/wx/project.config.json` 读取 appid；从环境变量 `WX_SECRET`（或 gitignore 的本地凭证文件）读取 AppSecret，凭证 MUST NOT 入库；通过 stable_token 接口获取 access_token 后调用云开发 HTTP API（`tcb/databaseupdate`，文档不存在时 `tcb/databaseadd`）；发布前校验 `metadata.last_updated` 非空、payload ≤ 450KB（云数据库单文档 512KB 上限的安全余量）；支持 `--dry-run` 仅校验与打印摘要不联网。脚本失败 MUST 退出非零码并指明失败步骤。

#### Scenario: 发布成功

- **WHEN** 维护者配置凭证后运行 `node scripts/publish-constants.mjs`
- **THEN** 控制台输出版本号、hash、payload 大小与目标文档 ID，退出码 0，云端文档更新为本次内容

#### Scenario: 凭证缺失

- **WHEN** 未配置 `WX_SECRET` 环境变量且无本地凭证文件
- **THEN** 脚本在发起任何网络请求前退出非零码，提示凭证配置方法

#### Scenario: dry-run 校验

- **WHEN** 运行 `node scripts/publish-constants.mjs --dry-run`
- **THEN** 不发起网络请求，输出 payload 大小、版本、hash 摘要，校验通过退出码 0
