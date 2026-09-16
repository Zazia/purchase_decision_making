## Why

用户在「保存结果 → 展示我的方案」已有明确的云端上传场景，但当前 shared_results 只保存决策参数，没有保存可供价格分析消费的方案数据。沿用这一次上传确认并补齐数据，可以完成分享与分析的链路，无需再让用户到编辑器单独上传。

## What Changes

- 唯一上传确认放在保存结果后的分享卡页：勾选「展示我的方案」并生成时，确认一次分享与价格分析用途；同一次保存的重试、重新生成复用确认与云记录。
- 未勾选或取消确认时只本地保存和生成图片；普通重算、编辑、直接导出长图不发起新的方案上传，也不弹价格上传提示。
- 扩展 share-result/save，一次将决策参数、所保存的结果快照、可消费的用户价格及原始对照写入 shared_results；复用这条记录生成小程序码。
- 离线管线直接消费 shared_results，无需创建 price_intake_shadow，也无需第二次调用 price-intake；保留现有 constants 与 shared_results 两个集合。
- 将分享快照与价格样本明确区分：原始推荐结果可上传分享，但只有有效用户输入价进入分析，editedBuyPrice 正确归一到提交 buyPrice，持有期变体不重复计数。
- 统一加入校验、幂等、失败重试及真实页面写入/离线消费验收；历史仅含参数的分享不补造样本，分析不自动回写 constants。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `crowdsourced-price-intake`：合并到保存分享的单次确认与单次写入，更新隔离位置、提交契约、幂等和验收要求。
- `shadow-intake-pipeline`：沿用既有能力名，数据源改为 shared_results，补齐版本/用途筛选、价格观测去重、测试隔离和台账迁移。

## Impact

- 小程序：miniapp/wx/pages/result/result.ts、pages/share-card/share-card.ts / .wxml、保存结果服务与提交数据构造；保持结果和对应编辑快照一致。
- 云端：扩展 miniapp/wx/cloudfunctions/share-result/ 与 shared_results 文档，保留 save/get/qrcode action 和旧分享可读性；退出新客户端的独立 price-intake 路径，不删除可能已有的云端历史资源。
- 维护：scripts/intake/run-pipeline.mjs、相关测试、docs/data-maintenance.md、README.md；数值时间戳与台账来源迁移。
- 文档：本变更完成后同步两个主规格并归档；修正相关主规格的 Requirements 标题，使 OpenSpec CLI 可读取（当前误用 ADDED Requirements）。
- 与进行中的 fix-manual-price-residual-anchor 在 result 编辑数据上有概念关联，但本变更不修改残值引擎公式；保持 editedBuyPrice 与原始市场价分离。
- 本提案不包含自动回写 constants、账号同步或修改分享扫码重算语义；云端分析数据不由公开扫码接口返回。
