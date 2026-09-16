# 数据维护使用说明

小程序数据维护的三条命令，覆盖「constants 发布」与「用户提交价分析」两条日常链路。

## 前置：配置凭证（仅一次）

云端脚本需要微信小程序 AppSecret，二选一：

```powershell
# 方式一：环境变量（推荐）
[Environment]::SetEnvironmentVariable("WX_SECRET", "你的AppSecret", "User")
# 重开终端后生效
```

```json
// 方式二：创建 scripts/.wx-publish-credentials.json（已 gitignore，不会入库）
{ "secret": "你的AppSecret" }
```

> appid 自动从 `miniapp/wx/project.config.json` 读取，无需额外配置。

## 命令总览

| 命令 | 作用 |
|------|------|
| `pnpm constants:lint` | 校验 constants.json 结构（JSON / metadata / 体积 / 数值字段格式） |
| `pnpm constants:release` | 一键发布：lint → 云端发布 → 回读核验，任一环节失败即中止 |
| `pnpm intake:report` | 消费 shared_results 用户提交价，生成修正建议报告 |

## 日常使用

### 修改 constants.json 后发布

```powershell
pnpm constants:release              # 全链路: lint → publish → verify
pnpm constants:release --dry-run # 干跑: 只校验, 不写云端
```

- 发布成功后小程序**无需提审发版**，用户下次会话自动使用新数据
- 任一环节失败会指明环节（如 `FAIL @ lint`），后续环节不执行
- 回读核验会比对云端/本地的 payload sha256 与版本，不一致即判失败

### 定期分析用户提交价

```powershell
pnpm intake:report
```

产物（控制台会输出路径）：

| 产物 | 位置 | 说明 |
|------|------|------|
| 修正建议报告 | `scripts/intake/reports/YYYY-MM-DD-intake-report.md` | 人工审核依据，已入库 |
| 消费台账 | `scripts/intake/ledger.json` | 来源+记录 ID 去重，毫秒水位线用于审计 |
| 原始缓存 | `scripts/debug/intake-export-<date>.json` | gitignore，不入库 |

报告要点：

- 按「品类 + 机型/芯片/内存/存储 + 买入时机 + 渠道 + 国补」分组，达标组合（样本 ≥20 / 偏离度 ≤15% / 离散度 ≤40%）标记为**可纳入**
- 可纳入组合附「用户提交价中位数 vs constants 现值」对照与推荐 vs 用户提交价偏差分析
- **shared_results 已建但为空时正常空跑**（退出码 0），报告标注「无新增样本」

## 红线

- 用户提交数据**不自动回写** constants.json：报告仅供人工审核，确认后手动改值，再走 `pnpm constants:release` 发布
- 报告与台账不含 `anonId` 等个人标识；原始缓存只在 gitignore 目录
- 失败重跑安全：台账只在全流程成功后更新，失败不影响下次运行

## 故障排查

分享页反馈应区分阶段：

- 「云端已保存；图片生成失败」：记录已写入，可用本地保存结果中的 `uploadState.cloudId` 执行下方 `--diagnose`，图片失败不影响服务端消费。
- 「云端未成功」：不能据此断定没有写入（可能响应丢失）；重试同一保存内容会复用submissionId，不重复创建。

2026-09-15按产品约定移除上传前二次确认。开启「展示我的方案」并点击生成即上传，关闭只生成本地图片；开关旁说明数据用途，另有协议约定。

| 症状 | 处理 |
|------|------|
| `FAIL @ stable_token: invalid appsecret` | 检查 WX_SECRET 与 appid 是否匹配、IP 是否在白名单 |
| `未找到 AppSecret` | 按上文「前置」配置凭证 |
| `集合 constants 不存在` | 云开发控制台 → 数据库 → 创建集合 `constants`，权限设为「所有用户可读，仅管理端可写」 |
| `FAIL @ verify: payload 不一致` | 云端与本地不同步，重新执行 `pnpm constants:release` 即可 |

## 保存上传与消费契约（v2）

只使用 `constants` 和 `shared_results` 两个集合。开启「展示我的方案」并点击生成直接上传，无二次确认；关闭只本地生成。开关说明为“上传本次方案供二维码访问。您提供的匿名价格数据将用于为所有用户改进预测”。仅切换开关、编辑、重算及直接导出长图不新增云记录，关闭开关不删除已上传记录。

同一保存内容复用submissionId和cloudId；用途版本表明适用的数据使用约定，不是弹窗确认记录。超时重试不重复写入，二维码/绘图失败恢复后续步骤。保存与回看使用各自冻结上下文。旧缓存没有价格来源时只分享，不推断输入价。

分析只取 `schemaVersion=2` 且 `consentVersion=share-price-analysis-v1` 的有效 `submittedPlans`：明确用户价优先使用 editedBuyPrice，不再次扣国补。纯推荐、仍为预测且未明确改价、仅改持有期的方案不作为新样本。普通分享允许空数组。记录内同价格的多个持有期/副本只计一次，配置、渠道、国补口径分别分组。报告称「用户提交价」，不代表核实成交；不确定的 constants 对照标记待核对。

跳过统计：legacy=旧分享，consent=不支持的同意版本，ordinary=普通推荐分享，test=测试记录，invalid=非法样本。默认不读取历史 `price_intake_shadow`，不调用独立 price-intake。旧云端资源不删除。

## 台账迁移与只读诊断

空旧台账自动升级到 schemaVersion=2/sourceCollection=shared_results；非空旧台账拒绝覆盖，保留旧文件并用独立路径重建：

```powershell
pnpm intake:report --ledger scripts/intake/ledger-shared-v2.json --env cloud1-d7gb4dzhoaca5534d
pnpm intake:report --diagnose <共享记录ID> --env cloud1-d7gb4dzhoaca5534d
```

重建后人工核对来源、跳过数和分组，再选择今后使用的台账路径。每个来源 ID 只处理一次，乱序时间不会漏掉新 ID。诊断只输出同意版本、用户价格和原始推荐白名单，不更新台账、缓存或 constants。isTest 记录可诊断但不进入正式统计。原命令仍使用 WX_SECRET/本地凭证；读云失败、集合不存在均非零退出，台账不变。报告使用独立文件名保留历史，原始缓存位于 scripts/debug/，不得提交。

## 云端权限、保留和发布状态

`shared_results` 必须设为仅管理端读写（自定义规则 read=false、write=false），客户端只经 share-result 的受限 save/get/qrcode 使用；公开 get 对v2返回params/createdAt/schemaVersion及白名单reportData快照，不返回身份或分析元数据；旧记录仍仅返回参数与时间。旧客户端 params-only save 仍兼容，不补分析授权。

v2 分享 30 天到期后不可访问，但过期扫码不删除分析记录；本次无自动清理任务。维护者确认原始导出和消费台账可追溯后另行安排清理。回滚云函数也必须保留 v2 不懒删除行为。

部署顺序：核对权限 → 部署兼容旧客户端的 share-result → 真实页面上传 isTest 样本并按同一 ID 诊断 → 客户端正式发布。2026-09-14 已完成权限、云函数部署、真实上传与同ID离线诊断，测试记录已清理；客户端尚未正式发布。详细证据及既存 constants 差异见 `openspec/changes/archive/2026-09-14-complete-price-intake-upload/verification.md`。

报告经人工审核后，按既有规范修改 constants metadata/version/变更摘要，再执行 `pnpm constants:lint`、`pnpm constants:release --dry-run` 和正式发布命令。本次验收不发布真实价格。dry-run 的 verify 差异仅提示，退出 0 不代表云端与本地一致；正式 verify 才会据此非零拦截。

回归命令：`node --test scripts/test-share-intake.mjs`（上传契约、分享页、消费管线和发布编排）。

2026-09-15无二次确认版本已通过真实有码图片、同ID诊断及测试隔离消费验证，测试记录已清理。证据见 `openspec/changes/archive/2026-09-15-fix-share-card-consent-failure/verification.md`。

分享落地修复（2026-09-16）：二维码scene及卡片shareId均读取保存时快照，不按当前价格重算。已发出的纯参数卡片无法恢复修改版，须重新生成；已有v2二维码待云函数与客户端更新后可读原快照。

2026-09-16分享快照修复云函数已部署；模拟器scene/shareId两入口及完整报告均验证保持用户修改版。客户端尚未发布。验收见 `openspec/changes/archive/2026-09-16-fix-shared-result-snapshot/verification.md`。
