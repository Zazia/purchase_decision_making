## Context

get仅返回params，loadFromCloud调用loadResult；卡片buildSharePath也仅编码params，两个入口均丢快照。

## Decisions

get按根字段及方案字段双层白名单返回reportData；不返回anonId、consentAt、submittedPlans、originalPlans、sourceId等分析信息。新修改版显式isUserModified，旧v2缺标记时可由非空submittedPlans判断。v2缺快照报错，不静默重算；旧params-only保持兼容。

结果页接受scene/shareId，直接格式化快照的frontier/dominated/recommendationRange，不请求引擎；显示修改版标注，不把并不存在的原始结果作为切换标签。接收者转发保留同一shareId。分享页仅在开关开启且云保存成功时用ID链接；未上传只分享通用入口，不声称分享修改结果。

## Risks / Trade-offs

已有v2二维码可在云函数更新和客户端更新后恢复历史快照；已经发出的纯参数卡片没有记录ID，无法可靠关联历史结果，须重新生成分享。

## Validation

覆盖2500输入快照与2700原始对照、两入口不重算、字段脱敏、旧记录兼容、缺快照/过期失败、转发ID及修改标记。部署后验证同一测试ID两入口并清理测试记录。
