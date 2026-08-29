## Why

constants 数据（市场快照/保值率/跑分）目前打包进小程序代码包，任何数据补充（如 iMac 新机型）都必须重新上传代码、提审、发版，数据更新链路太重。`data-snapshot-bundling` 规格中预留的「M2 云开发升级」正是为解决此问题而设计，`engine-bridge` 也已按「仅替换 `getConstants()` 内部实现、调用方零改动」的约定预埋了升级路径。

## What Changes

- **云端分发 constants**：云数据库 `constants` 集合新增 `latest` 文档，payload 为源 constants.json 全文（JSON 字符串）+ 版本/就绪标记/宏观上下文字段；小程序运行时优先读云端文档，数据修复无需发版提审。
- **客户端加载链**：`getConstants()` 内部改为「内存缓存 → 本地存储缓存（负缓存防弱网反复等待）→ 云端文档 → 本地打包快照兜底」；会话内数据版本固定，后台静默刷新只写存储供下次会话使用。
- **版本仲裁**：云端/存储/本地三源按 `metadata.last_updated` 比较，仅当云端版本 ≥ 本地打包版本才采用云端，防止发版后云端数据旧于代码包时发生数据回退。
- **发布脚本**：新增 `scripts/publish-constants.mjs`，用小程序 AppID+AppSecret（stable_token）走微信云开发 HTTP API（`tcb/databaseupdate`/`databaseadd`）原子更新 `latest` 文档；支持 `--dry-run`；凭证走环境变量或 gitignore 的本地文件，严禁入库。
- **保留本地快照兜底**：`sync-snapshot.mjs` 流程与月更发版节奏不变，打包快照降级为兜底基线。
- **时效提示文案**：黄色提示由「下次发版将刷新」改为「重启小程序可刷新」（数据现已可不依赖发版更新）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `data-snapshot-bundling`：①「快照打包进小程序版本」由「MUST NOT 运行时联网拉取」改为「云端优先、本地快照兜底」；②「云开发升级接口预留」由预留描述改为实际实现的加载链契约（含版本仲裁、会话一致性、负缓存）；③新增云端文档契约与发布脚本两条 Requirement；④「月更节奏与版本号绑定」补充云端发布可绕过发版的场景；⑤时效提示文案更新。
- `wx-miniapp-mvp`：「数据时效提示」Requirement 的黄色提示文案随数据分发方式调整。

## Impact

- **代码**：`miniapp/wx/engine-bridge/index.ts`（加载链重写，对外 API 签名不变）、`miniapp/wx/pages/result/result.wxml`（一行文案）、新增 `scripts/publish-constants.mjs`、根 `package.json` 增加 `publish:constants` 脚本、`.gitignore` 增加凭证文件忽略。
- **一次性运维**：云开发控制台创建 `constants` 集合并设为「所有用户可读、仅管理端可写」；本地配置 AppSecret。
- **不受影响**：引擎 `apple-value-engine` 零改动（仍通过 `loadConstants` 注入）；页面调用方零改动；`sync-snapshot.mjs` 与 pre-commit 快照同步钩子不变。
- **约束**：云数据库单文档上限 512KB，当前 payload 约 269KB，脚本在 >450KB 时拒绝发布并提示拆分方案。
