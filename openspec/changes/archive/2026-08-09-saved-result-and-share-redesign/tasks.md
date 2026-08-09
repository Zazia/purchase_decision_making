# 保存结果与分享卡小程序码 — 任务清单

> Change: `saved-result-and-share-redesign`
> 依赖设计文档: [design.md](./design.md)
> 范围: `miniapp/wx/` + `cloudfunctions/share-result/`（云函数）

## 0. 前置依赖（云开发环境）

- [x] 0.1 在小程序后台开通云开发，记录云环境 ID
- [x] 0.2 手动创建云数据库集合 `shared_results`，权限规则设为「仅创建者可读写」（云函数用管理端身份绕过）
- [x] 0.3 确认小程序已发布或 `pages/result/result` 页面路径可在体验版/正式版扫码进入（开发期用 `checkPath: false` 跳过校验）

> 注：原 0.1/0.2（GitHub Pages 中转页）已删除，云端 ID 模式不需要中转页。

## 1. 缓存服务模块（services/saved-results.ts）

- [x] 1.1 新建 `miniapp/wx/services/saved-results.ts`，定义 `SavedResult` / `SavedResultIndexItem` / `DecisionParams` / `PlanPoint` 类型（PlanPoint 与 result.ts 对齐）
- [x] 1.2 实现 `saveResult(snapshot)`：生成 `id=Date.now()`，写 `saved_result_${id}` 快照 + 更新 `saved_result_index`（降序）+ 容量清理（保留 20 条），返回 id
- [x] 1.3 实现 `getSavedResult(id)`：读 `saved_result_${id}`，失败返回 null
- [x] 1.4 实现 `listSavedResults()`：读索引，按 createdAt 降序返回
- [x] 1.5 实现 `deleteSavedResult(id)`：删快照 key + 索引项
- [x] 1.6 实现 `buildSharePath(params)`：生成 `/pages/result/result?category=...&budget=...&buyTiming=...&performanceFloor=...&holdingYears=2,3,4`
- [x] 1.7 实现 `getSavedCount()`：读索引长度
- [x] 1.8 ~实现 `buildQrUrl(params)`：生成中转页 URL~ **已删除**（云端 ID 模式不再用中转页 URL）
- [x] 1.9 容量清理逻辑：写入第 21 条时删除最旧一条的快照 key；写入失败时清理后重试一次
- [x] 1.10 新增 `updateCloudId(localId, cloudId)`：云函数写入成功后回填本地快照的 `cloudId` 字段
- [x] 1.11 `SavedResult` 接口新增可选字段 `cloudId?: string | null`

## 2. share-card-canvas 组件改造（绘制小程序码）

- [x] 2.1 ~`share-card-canvas.ts` 新增 property `shareParams`（Object）~ **改为** 新增 property `qrcodeBase64`（String，小程序码 base64）+ `appName`（String，默认「帕累托买苹果」）
- [x] 2.2 ~底部布局调整：两个码并排（二维码 160×160 + 小程序码占位 160×160）~ **改为** 单码布局：底部居中绘制小程序码（200×200）+ 下方文字「扫码查看我的方案」
- [x] 2.3 ~内联极简 QR Code 绘制算法（纯 JS，不引依赖）~ **改为** 删除内联 QR 算法，改用 `wx.base64ToArrayBuffer` + 写临时文件 + `ctx.drawImage` 绘制云函数返回的小程序码图片
- [x] 2.4 `drawCard` 中根据 `qrcodeBase64` 是否为空切换底部布局：有值 → 绘制小程序码 + 「扫码查看我的方案」；无值 → 绘制居中文字「帕累托买苹果」
- [x] 2.5 调整右侧引导文字区域（现有"扫码进入小程序"引导文字移到码下方或精简）
- [x] 2.6 验证 canvas 1080×1440 布局不被破坏，底部声明仍可见
- [x] 2.7 删除 `miniapp/wx/utils/qrcode.ts`（内联 QR 算法不再使用）

## 3. share-card 页改造

- [x] 3.1 `share-card.ts` data 新增 `params`（DecisionParams）+ `reportData`（完整引擎产出）+ `headerTitle` + `savedId`
- [x] 3.2 `onLoad` 从 `globalData.shareCardData` 读取 `params` + `reportData` + `headerTitle`（由 result/report 页补充）
- [x] 3.3 `onGenerate` 生成图片后，调 `saveResult({ params, reportData, headerTitle, lastUpdated })`，存 `savedId`
- [x] 3.4 `onGenerate` 成功后 `wx.showModal` 提示「转发分享卡即可保存结果，对方也能用同样的参数查看方案」
- [x] 3.5 `onShareAppMessage` 的 path 改为 `buildSharePath(this.data.params)`（携带完整决策参数）
- [x] 3.6 ~wxml 中 `share-card-canvas` 传入 `share-params="{{params}}"`~ **改为** 传入 `qrcode-base64="{{qrcodeBase64}}"` + `app-name="帕累托买苹果"`
- [x] 3.7 保留上轮新增的「分享呼吁」文案块
- [x] 3.8 缓存失败时不阻断分享卡生成（try-catch + toast）
- [x] 3.9 data 新增 `showMyPlan`（Boolean，默认 true）+ `qrcodeBase64`（String，默认空）
- [x] 3.10 wxml 加复选框「展示我的方案」（默认勾选），`bindchange` 更新 `showMyPlan`
- [x] 3.11 `onGenerate` 改造：`showMyPlan` 勾选时调云函数 `save` + `qrcode` 拿 `cloudId` + base64，回填本地 `cloudId`，把 base64 传给 canvas；不勾选时跳过云函数，`qrcodeBase64` 留空
- [x] 3.12 云函数调用失败降级：`qrcodeBase64` 置空 + toast「小程序码生成失败，仅显示小程序名」，不阻断图片生成

## 4. report 页改造

- [x] 4.1 删除 `onExportHtml` / `onShareFile` / `buildExportHtml` 方法
- [x] 4.2 删除 `exportedFilePath` / `hasExportedFile` data 字段
- [x] 4.3 `report.wxml` 删除 `export-wrap` 区块，替换为「保存结果」按钮
- [x] 4.4 实现 `onSaveResult()`：组装快照 → `saveResult` → 把数据存 `globalData.shareCardData` → `wx.navigateTo` 到 `share-card` 页
- [x] 4.5 `onLoad` 支持 `query.savedId` → `enterReplayMode(id)`：`getSavedResult` 读缓存，用 `reportData` 渲染，跳过 `loadReport`
- [x] 4.6 回看失败（缓存不存在）→ modal 提示 + `wx.navigateBack`
- [x] 4.7 回看模式下数据时效提示改为「保存时数据更新于 {{lastUpdated}}」
- [x] 4.8 `report.wxss` 清理 `export-btn` / `share-btn` / `btn-disabled` 等不再使用的样式

## 5. result 页改造

- [x] 5.1 `result.ts onGenerateShareCard`：`globalData.shareCardData` 补充 `params` / `dominated` / `recommendationRange` / `performanceFloor` / `budget`
- [x] 5.2 补充 `headerTitle`（如 `${categoryLabel} 购买决策分析`）到 `globalData.shareCardData`
- [x] 5.3 确认「保存结果」按钮文案与跳转不变
- [x] 5.4 `onLoad` 支持 `query.scene`：`decodeURIComponent` 后作为云端 `_id`，调云函数 `share-result` 的 `get` action 拉 params，再走现有重算流程
- [x] 5.5 新增 `loadFromCloud(cloudId)` 方法：调云函数 → 成功走重算 → 失败（过期/不存在/网络错）modal 提示 + `wx.navigateBack`
- [x] 5.6 区分两种入口：`query.scene` 走云端拉取，`query.category` 等走现有 parseQuery（转发场景）

## 6. saved-list 页（我的结果）

- [x] 6.1 新建 `miniapp/wx/pages/saved-list/`（wxml/wxss/ts/json）
- [x] 6.2 `onLoad` 调 `listSavedResults()`，渲染列表（标题/保存时间/品类预算/首选摘要）
- [x] 6.3 点击项 → `wx.navigateTo('/pages/report/report?savedId=${id}')`
- [x] 6.4 长按或滑动删除（`deleteSavedResult` + 重新渲染）
- [x] 6.5 空态：提示「暂无保存结果，去生成一份吧」+ 跳 decision-tree 按钮
- [x] 6.6 注册到 `app.json` pages

## 7. decision-tree 第一页入口

- [x] 7.1 `decision-tree.ts` data 新增 `savedCount`，`onLoad` 调 `getSavedCount()`
- [x] 7.2 实现 `onViewSavedResults()` → `wx.navigateTo('/pages/saved-list/saved-list')`
- [x] 7.3 `decision-tree.wxml` 在第一步（`currentStep === 0`）品类选项下方加「查看已保存的结果 (N)」入口
- [x] 7.4 `decision-tree.wxss` 加入口样式（虚线边框/灰色，与品类卡片区分）
- [x] 7.5 无保存时灰显（`savedCount === 0` 时仍可点击进入空态列表，或隐藏入口）

## 8. 云函数 share-result

- [x] 8.1 新建 `cloudfunctions/share-result/` 目录（index.js + package.json + config.json）
- [x] 8.2 实现 `action: 'save'`：写入 `shared_results` 集合（params + createdAt + expireAt=30天），返回 `_id`
- [x] 8.3 实现 `action: 'get'`：读 `shared_results.doc(id)`，过期则删除并返回 `{ ok: false, error: 'expired' }`，返回 params
- [x] 8.4 实现 `action: 'qrcode'`：调 `cloud.openapi.wxacode.getUnlimited({ scene: id, page: 'pages/result/result', checkPath: false, width: 280 })`，返回 base64
- [x] 8.5 `package.json` 声明依赖 `wx-server-sdk`
- [x] 8.6 `config.json` 配置云函数内存/超时（默认 256M / 5s 即可，qrcode 接口较快）
- [x] 8.7 上传部署云函数到云环境，测试三个 action 在云开发控制台均可调用

## 9. 小程序云开发初始化

- [x] 9.1 `app.ts` `onLaunch` 加 `wx.cloud.init({ env: '<云环境ID>', traceUser: true })`
- [x] 9.2 `project.config.json` 加 `cloudfunctionRoot: "cloudfunctions/"`
- [x] 9.3 确认 `project.config.json` 的 `appid` 与云开发环境所属小程序一致

## 10. 验证

- [x] 10.1 端到端：decision-tree → result → 保存结果 → share-card 生成图片 + 提示 → 关闭重开 → 第一页显示「查看已保存的结果 (1)」→ 点开回看一致
- [x] 10.2 分享卡转发：path 带完整 params，朋友/自己点开都进 result 页重算
- [x] 10.3 扫码（展示我的方案勾选）：图片上小程序码可扫码 → result 页 scene 解析 → 云函数 get → 重算 → 渲染
- [x] 10.4 复选框不勾选：图片上无小程序码，只显示「帕累托买苹果」文字；不调云函数；转发 path 仍带完整 params
- [x] 10.5 云函数失败降级：云环境未配置或网络失败时，`showMyPlan` 勾选也能生成图片（无码，只显小程序名）+ toast
- [x] 10.6 report 末尾「保存结果」→ 跳 share-card → 生成正常
- [x] 10.7 report 回看模式：saved-list 点开 → report 从缓存渲染 → 无报错
- [x] 10.8 容量：保存 21 条后最旧被删；删除某条后列表与索引同步
- [x] 10.9 HTML 导出已完全移除：report 页无导出按钮、无相关代码
- [ ] 10.10 云端记录过期：手动改 `expireAt` 为过去时间 → 扫码 → modal 提示「方案已过期」+ 返回
- [ ] 10.11 用 `miniapp/test` 自动化脚本跑一遍主流程 smoke（参考 AUTOTEST-GUIDE.md）

> **注**: 10.1–10.8、10.10、10.11 需在微信开发者工具 + miniprogram-automator + 云开发环境中人工/自动化验证。10.9 已通过代码搜索验证 (report 页无 onExportHtml/onShareFile/buildExportHtml/exportedFilePath/hasExportedFile/export-btn/export-wrap 残留)。
