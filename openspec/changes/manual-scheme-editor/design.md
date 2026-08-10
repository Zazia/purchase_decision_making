## Context

结果页当前是「引擎快照 → 一次性计算 → 只读展示」的单向流（见 [result.ts](file:///d:/_Projects/1-small-tools/purchase_decision_making/miniapp/wx/pages/result/result.ts)）。引擎 `computeParetoFrontier`（见 [pareto.ts](file:///d:/_Projects/1-small-tools/purchase_decision_making/packages/apple-value-engine/src/pareto.ts)）从 constants 市场快照提取候选并构建方案点，调用方无法注入「改了价的方案」或「用户新增的方案」。本地持久化已有 `saved-results.ts` 通道（`wx.setStorageSync`，单 key 1MB / 总 10MB / 保留 20 条）。云函数 `share-result` 已建立「云函数以小程序身份代写云数据库、用户无需登录」的模式。

本 change 要在这套基础上加三条互不相同的能力：端内交互编辑器、引擎「按给定方案集重算」、众包影子库。约束：引擎必须保持纯函数/零运行时依赖/三端可运行；小程序必须沿用个人主体+无商业化合规；影子库与快照严格隔离。设计动机见 proposal.md「Why」。

## Goals / Non-Goals

**Goals:**
- 让用户在端内把「预测价」改成「真实成交价」并即时看到帕累托图与报告的变化，复用引擎既有计算口径保证前后对比同口径。
- 把用户的真实成交价作为众包数据沉淀到影子库，并定义置信度分级规则，为后续离线数据修正管线预留接口。
- 编辑器交互（撤销/自动保存/排除/暂不考虑/新增/PDF）在端内自洽，不依赖服务端会话状态。

**Non-Goals:**
- 不实现离线数据修正管线本身（影子库 → constants 快照回写）：仅定义分级规则与纳入门槛，管线在 M2 里程碑实现。
- 不做服务端置信度分级定时任务：本 change 的分级是规则定义 + 端内/云函数侧的标记，服务端批处理留待后续。
- 不引入登录授权体系：沿用 `share-result` 的云函数代写模式，用户匿名提交。
- 不改决策树流程：手动修改是结果页的下游动作。
- 不做编辑器的协同/多端同步：编辑态仅本地自动保存。

## Decisions

### D1: 引擎新增 `recomputeFrontierFromPoints`，复用既有筛选/成本函数

**决策**：在 `packages/apple-value-engine/src/pareto.ts` 新增纯函数 `recomputeFrontierFromPoints(constants, params, editedPoints)`。它不重新 `extractCandidates`，而是：
1. 对调用方传入的每个 `EditedPlanPoint`，若 `buyPrice` 被覆盖或为新增方案，用 `buildPlanPoint` 的同款逻辑（抽成可复用的 `buildPlanPointFromCandidate`）重算月均成本/性能满足度/系统支持风险；
2. 过滤掉 `excluded` / `deferred`（暂不考虑）标记的点；
3. 复用既有 `selectFrontier` 与 `selectRecommendationRange`（保证口径一致，满足 spec「重算结果与原始计算口径一致」）。

**为何不直接改 `computeParetoFrontier` 加可选参数**：`computeParetoFrontier` 的契约是「从 constants 提取候选」，加注入参数会让它承担两个职责，且现有调用方（skill 路径、result 页初始计算）不需要这层。新增独立函数更符合引擎既有的「纯函数 + 单一职责」风格，且 `index.ts` 已有按模块导出的惯例。

**EditedPlanPoint 类型**：在引擎 `types.ts` 扩展，含 `PlanPoint` 全部字段 + `{ editedBuyPrice?: number; source: 'original' | 'edited' | 'custom'; excluded?: boolean; deferred?: boolean; channel?: string; useSubsidy?: boolean }`。引擎只关心 `editedBuyPrice`/`source`/`excluded`/`deferred`，`channel`/`useSubsidy` 透传不参与计算（供端内回传影子库用）。

**新增方案的解析**：用户新增自定义方案时，端内先调引擎既有的 `parseModelKey` 同款逻辑解析芯片/内存/存储——但该函数当前是 `pareto.ts` 内部函数。决策：把「按芯片/内存/存储/品类/持有期构建 PlanPoint」的能力暴露为引擎导出函数 `buildPlanPointFromInputs(constants, { chip, memoryGb, storageGb, categoryKey, buyTiming, buyPrice, holdingYears })`，供端内新增方案与重算共用。无法解析芯片时抛 `ConstantsValidationError`（复用既有错误类型），端内据此提示用户。

**备选方案**：在端内重新实现一套计算逻辑——否决，会破坏「口径一致」并违反「引擎与小程序解耦」spec。

### D2: 编辑器作为 result 页的子模式，而非新页面

**决策**：编辑器是 `pages/result/` 内的一个「编辑模式」视图态（`data.editorMode: 'view' | 'edit'`），而非独立的 `pages/scheme-editor/`。理由：
- 编辑器需要访问 result 页已计算的 `frontier`/`dominated`/`params`，独立页面要走 `globalData` 或 `onLoad` query 传完整方案集（query 长度受限、globalData 是现有反模式但够用）；
- 「重算 → 切换视图」需要在同一页面内做「原始版/用户修改版」切换，独立页面会引入页面栈跳转成本；
- 状态管理服务 `services/scheme-editor-state.ts` 仍是独立模块，只持有纯数据与撤销栈，不耦合页面。

**编辑态数据流**：`view` 模式数据 = result 页原始 `frontier`/`dominated`/`recommendationRange`；进入 `edit` 模式时，从 `scheme-editor-state` 加载/初始化 `EditedPlanPoint[]`；「重新生成」调用 `engine-bridge.recomputeFromEditedPlans` → 回写 result 页 `data` 的 `userModified` 副本 + 切到 `userModified` 视图。

**备选方案**：独立 `pages/scheme-editor/` + `globalData` 传方案集——否决，多一层序列化且重算回传要再走一次 `globalData`，徒增复杂度。

### D3: 撤销栈与自动保存用快照式（非命令式）

**决策**：`scheme-editor-state` 维护一个 `history: EditorSnapshot[]` 数组 + `cursor` 指针。每次编辑 push 一个完整 `EditorSnapshot`（含全部 `EditedPlanPoint` + 分组状态）。撤销 = `cursor--` 并恢复该快照。自动保存 = 每次 push 后 `wx.setStorageSync('scheme_editor_draft_<resultKey>', snapshot)`，与 `saved-results` 的 key 前缀隔离。

**为何快照式而非命令式（记录每个操作）**：编辑动作类型多（改价/渠道/排除/暂不考虑/新增/删除/恢复），命令式 undo 需要为每类动作写逆操作，易漏且难测。快照式用空间换正确性，单快照 < 50KB（与 `saved-results` 单条预估一致），20 步撤销 < 1MB，在 `wx.setStorageSync` 单 key 1MB 限制内。若担心超限，可限制 history 上限为 30 步、超出时丢弃最旧。

**draft key 与 result 关联**：`resultKey = ${category}-${budget}-${holdingYears.join(',')}-${buyTiming}-${performanceFloor}`（与 `buildSharePath` 同款参数指纹）。同一组决策参数的编辑草稿复用一个 draft；不同参数互不干扰。回看模式（`savedId`）的 draft key 额外带 `savedId`，避免覆盖实时计算场景的草稿。

**备选方案**：命令式 undo 栈——否决，见上；服务端会话——否决，违反 Non-Goal「不依赖服务端会话」。

### D4: 导出长图（canvas 渲染 + 小程序码 + 保存到相册）

**决策**：用 `<canvas type="2d">` 将方案表渲染为一张长图（高度按行数自适应，宽度固定 1080px），末尾追加小程序码区域。导出流程：`wx.canvasToTempFilePath` 出图 → `wx.saveImageToPhotosAlbum` 保存到相册（主路径）+ `wx.shareFileMessage`/`onShareAppMessage` 转发。

**为何不导出 PDF**：小程序无原生 PDF 生成 API，手写 PDF 结构体易错且不可维护；引入 `jspdf` 等库需构建 npm、增加包体积，违反既有「零额外依赖」基调。长图在移动端的归档/转发/查看体验均优于 PDF，且实现确定性高、真机风险低。

**长图结构**（自上而下）：
1. 头部：标题「{品类} 方案比价表」+ 「基于用户输入价 · YYYY-MM-DD」标注 + 决策参数摘要（预算/持有期/性能地板）。
2. 方案表：每行含机型/买入时机/持有期/买入价/渠道/月均成本/性能满足度/帕累托状态；用户修改行加视觉标注，已排除行灰显。
3. 末尾：小程序码（调用 `share-result` 云函数的 `qrcode` action 复用既有小程序码生成能力，scene 指向当前结果或用户修改版保存快照的云端 id）+ 一句话引导「用这个小程序，自己算一算」+ 数据更新日期。

**canvas 高度自适应**：canvas 单次渲染有高度上限（实测约 4096px），超长方案表采用「分段渲染 + `wx.canvasToTempFilePath` 多段导出 + 上下拼接」策略（用第二个离屏 canvas 把多段图片纵向拼成最终长图）。拼接逻辑封装在 `services/long-image-export.ts`，对调用方透明。

**小程序码获取**：复用 `share-result` 云函数已有的 `getQrcode` action（scene=id, page=pages/result/result）。用户修改版若已保存（有本地 `savedId` 或云端 id），scene 用该 id；未保存时先走 `save` 拿到 id 再生成二维码。无网络时小程序码区域降级为「小程序名 + 文案」占位，不阻断长图导出。

**备选方案**：
- 引入 `jspdf` 小程序版生成 PDF——否决，理由见上。
- 多页图片打包（zip）——否决，小程序端 zip 打包需额外依赖且转发体验差。
- 单页长图不分段——否决，超 canvas 高度上限会截断丢内容。

### D5: 影子库用独立云函数 + 独立集合，置信度分级先做规则定义

**决策**：新增云函数 `cloudfunctions/price-intake/index.js`，`action: 'submit'` 写入 `price_intake_shadow` 集合。集合权限规则设为「仅创建者可读写」（与 `shared_results` 一致），云函数以管理端身份写入。记录结构：

```
{
  submittedPlans: [{ model, chip, memoryGb, storageGb, buyTiming, buyPrice, channel, useSubsidy, holdingYears, source }],
  originalPlans: [...],   // 原始推荐方案快照，供比对
  params: DecisionParams,
  createdAt, submittedAt,
  anonId                  // 匿名标识（wx.cloud.getWXContext 的 OPENID 哈希，不存明文）
}
```

**置信度分级**：本 change 只实现「规则定义 + 单条提交时的轻量标记」（如给每条记录打上 `channelTrust` 与 `deviationPct` 字段），不实现服务端批处理。分级规则在 `crowdsourced-price-intake` spec 中已定义（提交量/渠道可信度/偏离度/离散度）。后续 M2 里程碑实现定时任务扫描影子库、聚合分级、产出「可纳入」清单。

**为何不直接回写快照**：违反 spec「影子库与快照隔离」+ SKILL.md 禁忌 11（众包数据须过分级才纳入）；且单条提交无法判断可信度，必须聚合。

**anonId 处理**：云函数从 `wx.cloud.getWXContext()` 取 OPENID，做一次哈希后存为 `anonId`，不存明文 OPENID，满足「MUST NOT 包含用户个人身份信息」。端内不感知 OPENID。

**备选方案**：直接复用 `share-result` 云函数加 action——否决，职责不同（分享是 params 短期存储，众包是长期累积），混在一起会让过期清理逻辑误删众包数据。

### D6: 「原始版/用户修改版」切换用 result 页双份数据

**决策**：result 页 `data` 增加 `original: { frontier, dominated, recommendationRange }` 与 `userModified: { ... } | null` 两份，加 `viewMode: 'original' | 'userModified'`。`pareto-chart` 与方案列表绑定到 `viewMode` 选中的那份。报告页通过 `globalData.reportData` 接收当前 `viewMode` 的数据，并在顶部根据来源渲染「基于用户输入价」标注。

**为何不替换原数据**：spec 要求「用户 MUST 能在原始版与用户修改版之间切换查看」；替换会丢失原始版，需要重新跑引擎（成本高且可能与快照时效漂移）。

## Risks / Trade-offs

- **[长图超 canvas 高度上限]** → 采用「分段渲染 + 多段拼接」策略（见 D4），封装在 `services/long-image-export.ts`；真机验证拼接后图片完整性。
- **[小程序码获取失败]** → 复用 `share-result.qrcode`，无网络时降级为「小程序名 + 文案」占位，不阻断长图导出。
- **[编辑态草稿超本地存储上限]** → 限制撤销栈 30 步；draft 仅存最新一个 snapshot 而非全历史；超限时清理最旧 draft（复用 `saved-results` 的容量策略）。
- **[新增方案芯片解析失败率高]** → 端内提供芯片名下拉（从 constants `chip_benchmarks` 取已知芯片）而非纯自由输入，降低失败率；自由输入作为兜底。
- **[众包数据被刷量污染]** → 置信度分级本身是第一道防线（少量提交不纳入）；云函数侧可加简单频控（同 OPENID 同机型每小时 N 条），但本 change 不实现服务端频控，留待 M2。
- **[影子库写入失败影响用户体验]** → 静默降级 + 手动重试，不影响本地编辑态与重算（spec 已要求）。
- **[撤销栈快照式内存占用]** → 单 snapshot < 50KB，30 步 < 1.5MB，小程序内存可接受；若实测超限再降为增量式。
- **[重算与原始口径漂移]** → 强制复用 `selectFrontier`/`selectRecommendationRange`/`computeMonthlyCost`，单测断言「未改价重算 == 原始结果」（spec 已要求）。

## Migration Plan

本 change 是纯增量，无破坏性变更，无需迁移：
1. 引擎新增函数 + 导出，既有 `computeParetoFrontier` 不变，skill 路径与现有 result 页初始计算零影响。
2. 小程序 result 页新增编辑模式，默认 `editorMode: 'view'`，不进入编辑则行为与现状完全一致。
3. 云函数 `price-intake` 与集合 `price_intake_shadow` 新增，不影响 `share-result` / `shared_results`。
4. 回滚策略：编辑器入口可通过 result 页 wxml 条件渲染开关一键隐藏；引擎新函数不调用即无副作用；云函数不部署即不可达。

部署顺序：引擎发版 + 单测 → 同步引擎产物到 `miniapp/wx/vendor/apple-value-engine/` → 小程序端编辑器 + 桥接 → 云函数部署 + 集合创建 → 真机验证长图导出与提交流程。

## Open Questions

（无）
