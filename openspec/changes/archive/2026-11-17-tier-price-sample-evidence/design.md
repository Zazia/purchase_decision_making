# Design
## Context
云分享具有服务端 anonId/createdAt，旧台账仅价格数组，不能据此推定日期与独立买家。
## Goals / Non-Goals
实现近期证据分级与独立来源去重。保留累计历史、原配置分组及脱敏。此次不修改云上传契约，不自动发布价格。
## Decisions
1. 新增纯函数政策模块；未核验云记录全部按 user_report 处理，不信任上传中的 verified 字段。
2. 每次从完整云导出重建近30天集合；同 anonId+配置组只取最新记录，同一最新记录的多个报价取中位数。身份缺失、日期未来/过期、配置/渠道/补贴缺失或型号芯片冲突不得达标。身份仅在内存及忽略目录原始缓存，报告/台账只存汇总。
3. --reviewed-samples 指向维护者审核的本地JSON数组，字段 region=CN、currency=CNY、dimensions、price、observedAt(毫秒)、kind(official/verified_paid/listing)、sourceKey、evidenceUrl、reviewed=true。官网限 apple.com.cn HTTPS，且官方渠道、新品、无补贴。来源身份由维护者核对，不能把多个链接当独立买家。
4. 分级按证据强度择优，不混合官网/成交/填报中位数。1条官网高、1-2条凭证低、3条凭证中、5条填报仅候选；各组MAD≤15%、CV≤40%。挂牌永远仅线索。eligible 表示可送人工复核，不等于自动纳入。
5. 已消费ID与历史价格数组不清除；grade从近期集合重新计算。报告区分累计数与近期独立数，零近期样本显示待补采。缺少旧原始记录不推定为近期。
## Risks / Trade-offs
用户分享时间仅提交时间，不能证明成交日期；无凭证候选仍须外部核验。独立身份不等于独立交易，审核保留。维护者证据文件属于受信任人工输入，不能接受用户上传自证。
## Migration Plan
无需破坏性台账迁移；全量云读取原本已存在。先测试再真实只读云数据重跑；文档与规格同步归档。
## Open Questions
无。
