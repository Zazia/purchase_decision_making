## 1. 共享云 API 封装

- [x] 1.1 新建 `scripts/lib/wx-cloud-api.mjs`：封装 stable_token 获取、`tcb/databasequery` 调用、凭证解析（WX_SECRET 环境变量 > `scripts/.wx-publish-credentials.json` > project.config.json appid），导出 `getCloudDoc(collection, docId)` 与 `queryCollection(collection, { where, skip, limit })`
- [x] 1.2 用本地 Node 直接调用验证：读取 `constants.latest` 文档成功（对照 check-cloud-constants.mjs 输出）

## 2. constants 结构校验 lint

- [x] 2.1 新建 `scripts/lint-constants.mjs`：JSON 解析、`metadata.last_updated`（非空且合法日期）与 `metadata.version` 存在性、payload ≤ 450KB 检查
- [x] 2.2 实现数值字段「数字开头」检查：内置数值型键路径规则（保值率曲线/快照价格/跑分/分品类预测涨幅表），违规输出键路径+值，规则含复合键名最长匹配
- [x] 2.3 验证退出码语义：构造违规 fixture（临时副本）确认非零码与逐条输出；当前真实 constants.json 跑通退出码 0

## 3. 影子库离线管线

- [x] 3.1 新建 `scripts/intake/run-pipeline.mjs` 主流程骨架：加载台账 → 水位线增量查询（`createdAt > watermark` + processedIds 去重）→ 分页拉取 `price_intake_shadow`
- [x] 3.2 实现聚合与置信度分级：分组键 `category|model|chip|buyTiming(+渠道若有)`；阈值常量（≥20 条/偏离 ≤15%/std÷mean ≤0.4/渠道中性）；产出「可纳入/样本不足」两档结论
- [x] 3.3 实现修正建议报告生成：写 `scripts/intake/reports/YYYY-MM-DD-intake-report.md`，含新增样本概览、分级证据表、可纳入组合「影子库中位价 vs constants 现值」对照（D5 尽力匹配）、推荐 vs 成交价偏差小结、显著的「仅供人工审核」声明；全文无 anonId
- [x] 3.4 原始导出缓存写 `scripts/debug/intake-export-<date>.json`（确认 .gitignore 覆盖）
- [x] 3.5 实现台账写入：`scripts/intake/ledger.json` 记录运行时间/样本数/watermark/processedIds/分级摘要；失败路径不改台账（幂等重跑）
- [x] 3.6 空态与错误路径验证：影子库空/集合不存在时退出码 0 输出空跑报告；凭证缺失时非零码且台账不变

## 4. 一键维护流水线

- [x] 4.1 新建 `scripts/verify-cloud-constants.mjs`：读云端 `constants.latest`，比对 payload sha256 与本地文件哈希、`doc.version` 与 `metadata.last_updated`，不一致/读取失败非零码并输出两侧对照
- [x] 4.2 新建 `scripts/release-constants.mjs`：spawn 编排 lint → publish（透传 `--dry-run`/`--env`）→ verify，失败中止并指明环节，成功输出各环节摘要
- [x] 4.3 根 `package.json` 增加 npm scripts：`constants:lint`、`constants:release`、`intake:report`
- [x] 4.4 端到端验证：`npm run constants:release -- --dry-run` 全链路干跑成功；lint 故意失败时流水线中止且不发起网络请求

## 5. 文档与收尾

- [x] 5.1 在根 `package.json` scripts 附近或 README 运行指南中补一行数据维护命令说明（含凭证配置指引）
- [x] 5.2 首次真实运行 `npm run intake:report`，确认空跑/正常路径产物（报告+台账+缓存）符合 spec 场景
- [x] 5.3 运行 `openspec validate data-maintenance-automation --strict` 通过，按流程归档变更并同步 delta 到主规格
