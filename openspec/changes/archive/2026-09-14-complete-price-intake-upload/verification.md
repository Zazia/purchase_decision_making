# 价格上传与消费验收记录

> 2026-09-14 后续更正：本记录真实云调用及同ID消费证据有效，但“完整闭环通过”结论过宽。此前以mock确认弹窗，遗漏取消按钮「仅本地保存」超过4字的真实接口限制；首次正常用户流程在上传前就失败并被误报渲染失败。后续变更 fix-share-card-consent-failure 修复并补真实原生确认与有码图片验收，详见其verification.md。不得用此记录单独证明原版本首次确认可用。

日期：2026-09-14。状态：实现、云部署与真实上传/离线消费闭环通过；客户端正式发布未执行。

## 交付行为

- 重算时冻结上传上下文，保存原始版、修改版、完整报告和本地回看均使用对应快照。旧缓存不反推用户价格来源。
- 「展示我的方案」生成时统一确认一次；取消或关闭选项只本地生成。重试复用同意和提交ID，云写成功后二维码失败不重复保存。编辑、重算和直接长图导出不上传。
- share-result 同条 shared_results 记录保存分享快照、用户价格、原始对照和用途版本。身份仅从 getWXContext 获取后哈希，不保存原始身份；客户端禁止直接读写集合，公开 get 只返回参数与时间。
- 离线管线直接消费 shared_results，按配置、渠道、国补分组和记录内价格去重，排除旧分享、普通推荐及测试记录。正式价格须人工审核后接既有 constants 校验、发布及回读流程。

## 本地及开发者工具回归

`node --test scripts/test-share-intake.mjs`：14组通过，覆盖价格冻结、来源筛选、回看、六品类实际引擎结果契约、非法输入零写入、10并发幂等、冲突、旧接口、公开字段、过期保留、消费去重/迁移/失败保护、诊断只读、配置价格口径、维护发布失败中止、页面确认与恢复、报告快照。

wechatide 0.3.10，登录与项目授权正常，模拟器编译及分享页面运行成功。

- 实际结果页构造隔离测试：原价2700，改2500并重算，再改2300但不重算。保存上下文仍为2500，原始对照2700。
- 实际分享页取消确认：确认1次、云调用0次、关闭上传选项、本地图片成功；主动关闭选项：确认0次、云调用0次、图片成功。
- 实际页面失败桩：两次生成仅确认1次、保存尝试2次，本地图片保留且明确提示云端未成功；所有桩均在 finally 恢复。
- 普通推荐空样本、二维码失败、渲染失败、重算和直接导出由实际页面方法配合可控桩回归；真实二维码另见下方。自动化确认弹窗不等于人工点选实测。
- 截图已检查：scripts/debug/share-local-cancel.png。缓存与截图不入库。
- 整体 TypeScript 检查仍有原有 echarts 模块、Component 字段、Picker 类型及 candidateType 可选性错误；已与 HEAD 对照，无本次上传模块新增类型错误。

## 实际云环境与部署

AppID wx2f00740110e78738；唯一确认环境 cloud1-d7gb4dzhoaca5534d。share-result 为 Active / Nodejs16.13 / timeout 3秒。仅复用 constants、shared_results，无第三集合。

用户明确授权部署及测试记录创建/清理。最初“仅创建者可读写”允许客户端写探针，探针立即删除；用户改权限后，客户端直接新增及读取已知记录均返回 -502003 permission denied。新v2记录直读同样拒绝。

完整部署任务 confirmation_cloud_fn_deploy_7e652399-ea02-4dd9-a963-6c4f215b48f6 成功，4文件/4.7KB；最后入口增量任务 confirmation_cloud_fn_inc_deploy_29dd330a-8a0c-4dc1-a458-8e4f311ab9e4 成功，1文件/2.4KB。

真实调用发现平台额外附加 userInfo/tcbContext，严格白名单首次拒绝 invalid_payload。通过只返回未知字段名的诊断确认 tcbContext；入口剥离两字段，身份仍取可信上下文。回归验证伪造字段不改变身份或幂等键、不落库，其他未知字段仍拒绝且诊断不返回值。经验已回填 wx-miniprogram-autotest 技能。

## 同一记录真实闭环

测试记录 ID：4a33fa98ffe4aa1a8cd5869f96eee7cd（验收结束已清理）。

1. 真实分享页 onGenerate，自动化确认用途1次；失败重试确认0次。修复后实际 save 成功，实际 qrcode 成功，图片生成成功，状态“本地已保存；云端已保存”。网络调用未模拟。
2. 管理端通过 `pnpm intake:report --diagnose <ID>` 核验：schemaVersion=2，consentVersion=share-price-analysis-v1，isTest=true，用户价2500，原始对照2700，createdAt=1789385570098。诊断不改正式台账。
3. 三次真实并发相同请求均返回同一ID和expireAt=1791977570098；相同提交ID将价格改2400返回 conflict。公开 get 字段只有 ok/params/createdAt。旧分享 get 也正常。
4. `pnpm intake:report` 拉取45条，新增1条记录、0个价格样本，测试跳过；报告 scripts/intake/reports/2026-09-14-intake-report-1789385682447-7ojm3.md。正式台账累计0分组/0样本。
5. 管理端仅对该ID且isTest=true设置expireAt=1，matched=1/modified=1。真实 get/qrcode 均返回 expired，客户端直读拒绝；管理端同ID诊断仍可读到2500/2700，证明过期不会自动删除分析记录。
6. 精确ID与isTest=true条件清理，deleted=1。再次原命令拉取44条、新增0条、样本0，报告 scripts/intake/reports/2026-09-14-intake-report-1789385855557-xng5v.md。历史真实记录未删除，正式样本未污染。

## constants维护回归及发布边界

- constants:lint 通过；constants:release --dry-run 完成且未写云端；发布编排每阶段失败停止及回读失败行为通过。
- 本地 constants 始终不变，SHA256 6982ec7bc6cdca47bf1f5c8fa1ba81c1d461d697a169c79470aac1fc69d260d3，290835字节，metadata.version=4.6，last_updated=2026-09-09。
- 云端 constants 自身payload/hash自洽，286400字节，哈希前16位bc93a68477f040b9，与本地存在原有差异。verify-cloud-constants 只读检查按预期退出1；干跑退出0不代表云端与本地一致。本次未发布或修正价格。
- 云函数已部署；小程序客户端仅本地代码及开发者工具验证，尚未上传体验版或提审正式发布。

## 规格与归档

两个delta共13项要求已逐段与主规格核对一致，保留原有报告脱敏要求；主规格 Purpose 数据源与 Requirements 标题正确。OpenSpec严格校验通过。按项目流程归档 complete-price-intake-upload；无根目录 apply_instructions.json 残留。
