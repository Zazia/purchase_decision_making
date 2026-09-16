## Why

众包成交价数据已持续写入云端影子库 `price_intake_shadow`，但规范（`crowdsourced-price-intake`）中「后续里程碑」的离线修正管线至今未实现——数据只有进没有出，数据飞轮断在本地消费端。同时 constants.json 例行维护（结构校验、发布、云端核验）目前靠人工记忆按序执行多个脚本，操作步骤未固化、易漏易错（2026-08-26 执行报告 §8 已暴露校验靠手抄的问题）。

## What Changes

- 新增影子库离线管线脚本：从云数据库导出 `price_intake_shadow` → 本地聚合（机型+渠道+持有期分组）→ 置信度分级（样本数/偏离度/离散度/渠道可信度）→ 产出 Markdown 修正建议报告（含「可纳入/样本不足」分级与 旧值→建议值 对照）
- 新增 constants.json 结构校验 lint 脚本：JSON 合法性、`metadata.last_updated`/`version` 完整性、payload 体积、数值字段数字开头（防 `parsePercent` 解析隐患）、新增字段红线检查
- 新增一键维护流水线命令：`lint → publish → 云端核验` 串联既有脚本，任一环节失败即中止
- 新增影子库消费台账：记录每次管线运行的水位线（已处理记录 `_id` 范围）与纳入结论，避免重复统计；未达标记录保留影子库继续累积（符合既有规范）
- 修正建议报告经人工审核后按既有 SOP 合入 constants.json 并走既有发布链，**不做全自动回写**（既有规范红线：影子库数据 MUST NOT 自动回写快照）

## Capabilities

### New Capabilities

- `shadow-intake-pipeline`: 影子库众包数据的本地离线消费管线——导出、聚合、置信度分级、修正建议报告、消费台账水位线管理
- `constants-maintenance-tooling`: constants.json 本地维护工具链——结构校验 lint 与一键「校验→发布→核验」流水线

### Modified Capabilities

（无——发布脚本 `publish-constants.mjs` 本身不变，由新流水线命令编排调用；`crowdsourced-price-intake` 规范中的分级规则本变更仅落地实现，不修改需求）

## Impact

- 新增代码：`scripts/` 下新增管线脚本与 lint 脚本（纯 Node 零依赖，复用 `publish-constants.mjs` 的凭证与 HTTP API 模式）；根 `package.json` 新增 npm scripts
- 新增本地状态/产物：影子库消费台账（入库，审计用）、原始导出缓存与报告产物（不入库）
- 不改动：小程序端代码、云函数（`price-intake`/`share-result`）、引擎（`apple-value-engine`）、`constants.json` 数据本身（由人工审核后按既有流程更新）
- 依赖既有设施：`scripts/.wx-publish-credentials.json` / `WX_SECRET` 凭证、云开发 HTTP API（`tcb/databasequery`）、pre-commit 快照同步钩子
