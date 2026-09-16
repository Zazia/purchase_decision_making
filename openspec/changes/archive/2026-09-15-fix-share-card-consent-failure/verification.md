# 分享上传修复验收

日期：2026-09-15。用户明确变更：取消上传前二次确认，数据使用另有协议约定，开关文案按指定原文替换。

## 根因及修复

原按钮“仅本地保存”超过微信showModal四字限制，真实接口拒绝，在上传前被误报为渲染失败。此前mock确认遗漏此问题，已更正原归档验收结论。

最终方案按用户要求直接移除上传前弹窗：开启开关且点击生成才设置当前用途版本并上传，关闭仅生成本地图片。协议版本不再被描述为弹窗确认记录。保留阶段错误反馈及二维码setData完成后等待加载的时序修复。完成通知保持原有行为。

开关说明：上传本次方案供二维码访问。您提供的匿名价格数据将用于为所有用户改进预测

## 验证证据

- 14组自动回归全部通过，覆盖关闭零上传、开启直接上传、无二次确认、二维码/图片失败恢复及幂等。
- 真实页面新建isTest方案，无旧授权或cloudId；不mock弹窗和云接口，直接onGenerate成功。generated=true、renderFailed=false、hasQr=true，状态本地已保存/云端已保存。
- 直接读取导出PNG并查看：1080×1440内容完整，底部真实小程序码可见。
- 测试ID cc946c23abea8fb63d3f43f2ebbdf20b。第二次生成sameId=true、save调用0次、generated=true。
- pnpm intake:report --diagnose cc946c23abea8fb63d3f43f2ebbdf20b 成功读取schemaVersion2、用途版本share-price-analysis-v1、isTest=true、用户价2500/原始对照2700。
- pnpm intake:report 实际拉取47条，新增3条，test跳过2、ordinary跳过1，新增价格样本0。报告scripts/intake/reports/2026-09-15-intake-report.md。同期其他新增记录不作删除。
- 本次仅清理上述确切ID且isTest=true的记录；工具任务confirmation_cloud_db_write_doc_1b531022-96c2-4b98-ab57-717c651a087e成功，deleted=1。

## 发布边界

仅修改客户端与文档，无云函数部署、无constants发布。客户端尚未上传体验版或正式发布。测试清理已完成，主规格已同步并通过严格验证。
