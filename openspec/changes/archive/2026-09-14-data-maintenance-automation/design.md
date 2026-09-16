## Context

影子库 `price_intake_shadow` 由云函数 `price-intake` 写入（字段：`submittedPlans`/`originalPlans`/`params`/`anonId`/`createdAt`），当前无任何本地消费端。既有云端访问先例：`scripts/publish-constants.mjs`（stable_token → `tcb/databaseupdate`）与 `scripts/check-cloud-constants.mjs`（`tcb/databasequery`），均为纯 Node 零依赖、凭证走 `WX_SECRET` 环境变量或 `scripts/.wx-publish-credentials.json`。constants.json 维护红线见 `crowdsourced-price-intake` 规范（MUST NOT 自动回写快照）。提交的方案点结构为 `PlanPoint`（model/chip/buyTiming/holdingYears/buyPrice/...），当前不含购买渠道字段。

## Goals / Non-Goals

**Goals:**

- 影子库数据 → 修正建议报告的全程自动化（拉取、聚合、分级、报告、台账）
- constants 维护「校验 → 发布 → 核验」一键化，各环节退出码语义化
- 全部纯 Node 零依赖，复用既有凭证机制，不新增云函数

**Non-Goals:**

- 不自动修改 constants.json / 云端 constants 文档（人工审核后走既有 SOP）
- 不改既有 `publish-constants.mjs` / `check-cloud-constants.mjs` / 小程序端 / 云函数
- 不做渠道可信度自动评估（渠道字段尚未上传，先按参数表常量）

## Decisions

### D1: 云端读取走 HTTP API 直连，不新增云函数

复用 `check-cloud-constants.mjs` 验证过的 `stable_token + tcb/databasequery` 模式。分页用 `orderBy("createdAt","asc").skip(n).limit(100).get()` 翻页；影子库量级小，skip 深分页性能可接受。备选「给 price-intake 云函数加 admin-export action」需要部署与函数维护面，「tcb CLI」需要额外安装登录，均更重。新建 `scripts/lib/wx-cloud-api.mjs` 封装 token + query 供新脚本复用；既有脚本保持不动。

### D2: 增量水位线 = createdAt 上界 + 已处理 _id 集合

台账 `scripts/intake/ledger.json`（入库，审计用）记录 `watermark`（最后处理记录的 `createdAt`）与 `processedIds`（已消费 `_id` 数组，防同秒多记录漏/重）。查询条件 `createdAt > watermark`，命中 `_id` 已在集合中则跳过。`createdAt` 为 ISO 字符串，字典序即时序。失败（拉取中途出错）时不落任何台账变更，保证幂等重跑。

### D3: 原始导出缓存入 `scripts/debug/`，报告入 `scripts/intake/reports/`

- 原始记录含 `anonId`（哈希匿名标识），按 AGENTS.md 约定运行产物放 `scripts/debug/`（已 gitignore），不裸露在库中
- 修正建议报告是维护决策依据（同类先例：skill 目录下的常量更新执行报告入库），放 `scripts/intake/reports/` 并入库，文件名 `YYYY-MM-DD-intake-report.md`

### D4: 聚合分组键按记录实际字段容错

分组键 `category|model|chip|buyTiming`，记录含渠道字段时追加。当前 PlanPoint 无渠道，渠道可信度因子取中性值（不加分不扣分），报告标注「渠道维度待小程序端提交字段补齐后生效」。分级阈值（样本数 ≥20、偏离度 ≤15%、离散度 std/mean ≤0.4、渠道表）集中为脚本顶部常量，对齐 crowdsourced-price-intake 规范既有示例值，后续可调。

### D5: 旧值对照尽力匹配，不保证全命中

可纳入组合对照 constants.json 现值：按 `分品类快照` 节键名做包含式机型匹配（如 `M4`/`Mac_mini`）；匹配不到时报告仅给建议中位价并标注「请用 query-constants 人工查证键路径」。不做强匹配的原因：快照键名中文复合、无稳定映射规则，强匹配会制造假对照。

### D6: 一键流水线用子进程编排既有脚本

`scripts/release-constants.mjs` 用 `child_process.spawn(process.execPath, [脚本绝对路径, ...args])` 依次跑 `lint-constants` → `publish-constants`（透传 `--dry-run`/`--env`）→ `verify-cloud-constants`，靠各脚本退出码决定中止。不 import 函数的原因：`publish-constants.mjs` 是过程式顶层脚本（直接 `process.exit`），改造它违反「不动既有脚本」边界。核验脚本 `scripts/verify-cloud-constants.mjs` 新写（既有 `check-cloud-constants.mjs` 只打印不返回语义化退出码，且写死读凭证文件路径，保留作诊断用）。

### D7: lint 的数值字段清单内置可维护

`scripts/lint-constants.mjs` 内置需「数字开头」检查的数值型键路径规则（保值率曲线值、快照价格、跑分、分品类预测涨幅表等，含对复合键名的最长匹配适配），违规输出键路径+值。清单是启发式而非全量 JSON 校验——constants.json 是研究数据文档，结构允许自由加说明字段，lint 只守已知风险点（`parsePercent` 解析隐患）。

## Risks / Trade-offs

- [databasequery 权限/集合不存在] → 脚本捕获 errcode 分类提示：集合不存在=影子库尚无数据（正常空态，退出码 0 并写空跑报告）；权限错=指明检查 env 与 token 归属
- [影子库当前几乎无数据] → 空跑是设计内路径（spec 已定义空跑场景），管线价值随数据积累显现
- [水位线漏记录（时钟回拨/乱序 createdAt）] → `processedIds` 去重兜底；量级小，全量比对成本可忽略
- [Windows spawn 环境差异] → 用 `process.execPath` + 绝对路径、`stdio: 'inherit'`，不用 shell 字符串拼接
- [报告建议值被误当结论] → 报告模板显著标注「仅供人工审核，禁止直接回写」，合入仍走既有 SOP 与红线检查

## Migration Plan

纯新增脚本与 npm scripts，无存量行为变更。上线=提交代码；回滚=删除新文件。首次运行 `intake:report` 预期空跑（影子库无数据或极少量），用于验证链路。

## Open Questions

- 分级阈值是否需按品类差异化（如小件品类离散度天然更高）——数据积累后再调参数，不影响结构
