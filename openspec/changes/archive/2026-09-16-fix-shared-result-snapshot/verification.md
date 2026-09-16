# 分享快照恢复验收

日期：2026-09-16。状态：本地15组测试及开发者工具真实云请求/两入口验证通过，云函数已部署；测试记录已清理，客户端尚未发布。

## 根因

二维码scene通过get仅取params后调用引擎重算；分享卡片链接仅带params。两条入口均未读取已保存reportData。

## 已修复

- v2 get返回白名单reportData（参数、结果列表、推荐区间、修改版标记），不返回anonId、授权元数据、submittedPlans、originalPlans及sourceId等编辑来源字段。
- scene/shareId统一恢复快照，直接展示保存价格及月成本，不调用compute。继续转发保留同一ID。
- 分享卡开关开启且已上传时链接使用cloudId；保存修改版显式标记isUserModified，本地回看保留该标记与云ID。
- 旧params-only分享继续重算；v2缺失快照报错。旧纯参数卡片无关联ID，不能还原历史修改版，需重新生成。
- 15组测试通过：2500元快照和87元月成本两入口一致，compute调用0次，转发ID保持；公开字段隐私、缺快照失败及旧接口兼容。OpenSpec严格校验及diff检查通过。

## 部署历史（已解决）

wechatide状态versionRelation=equal，loginExpired=true。已提交的增量任务：confirmation_cloud_fn_inc_deploy_41529fe8-4ecb-4759-b17b-fa980d18fe06，share-result/index.js，环境cloud1-d7gb4dzhoaca5534d，appid wx2f00740110e78738。须用户重新登录并确认后查询原任务，不重复提交。

以上为登录过期时的历史状态，后续真实验证和部署结果见下节。


## 登录恢复后的真实验证

登录恢复后旧部署任务返回Task not found；重新提交增量部署confirmation_cloud_fn_inc_deploy_16b771b2-1322-41a4-bced-836fc07b2fb6成功（1文件，2.9KB）。

创建isTest分享b524bce53c5328e90a3d0d2af9e234db：生成图片成功、有二维码，卡片路径携带shareId；公开get字段为ok/params/createdAt/schemaVersion/reportData，价格2500且isUserModified=true。

开发者工具分别按scene与分享卡实际path导航，均loading=false、viewMode=userModified、price=2500；frontier及recommendationRange与公开快照JSON完全一致。扫码落地继续转发路径保留同ID。卡片落地打开完整报告，价格2500、isUserModified=true。此次验证为模拟器真实页面与真实云请求，未进行手机相机实扫。

仅清理上述确切ID+isTest=true的测试记录，清理任务confirmation_cloud_db_write_doc_3d17570e-c1f0-47ae-89db-051071568b34成功，deleted=1。客户端尚未发布。
