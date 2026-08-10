## 1. 引擎：按给定方案集重算能力

- [ ] 1.1 在 `packages/apple-value-engine/src/types.ts` 新增 `EditedPlanPoint` 类型（`PlanPoint` 全字段 + `editedBuyPrice?` / `source: 'original'|'edited'|'custom'` / `excluded?` / `deferred?` / `channel?` / `useSubsidy?`）与 `RecomputeParams` 接口
- [ ] 1.2 把 `pareto.ts` 内部的 `buildPlanPoint` 与 `parseModelKey` 抽取/暴露为可复用的导出函数 `buildPlanPointFromInputs(constants, { chip, memoryGb, storageGb, categoryKey, buyTiming, buyPrice, holdingYears })`，芯片无法解析时抛 `ConstantsValidationError`
- [ ] 1.3 在 `pareto.ts` 新增纯函数 `recomputeFrontierFromPoints(constants, params, editedPoints)`：过滤 `excluded`/`deferred` → 对 `source:'edited'` 用 `editedBuyPrice` 重算成本、对 `source:'custom'` 用 `buildPlanPointFromInputs` 构建 → 复用 `selectFrontier` 与 `selectRecommendationRange`
- [ ] 1.4 在 `index.ts` 导出 `recomputeFrontierFromPoints`、`buildPlanPointFromInputs`、`EditedPlanPoint` 类型
- [ ] 1.5 引擎单测：覆盖改价重算、新增可解析方案、新增不可解析方案被拒、排除/暂不考虑不参与、未改价重算与 `computeParetoFrontier` 结果一致（误差 ≤ 0.5 元 / ≤ 0.001）
- [ ] 1.6 跑 `pnpm --filter apple-value-engine test` 通过

## 2. 引擎产物同步到小程序

- [ ] 2.1 运行 `node scripts/sync-engine.mjs` 把引擎新函数与类型同步到 `miniapp/wx/vendor/apple-value-engine/`
- [ ] 2.2 在 `miniapp/wx/engine-bridge/index.ts` 新增 `recomputeFromEditedPlans(params, editedPoints): Promise<ParetoFrontierResult>` 桥接，内部注入 constants 与 macroContext（沿用 `compute` 的注入逻辑）
- [ ] 2.3 校验 `tsconfig.check.json` 类型检查通过

## 3. 小程序：编辑态状态管理服务

- [ ] 3.1 新建 `miniapp/wx/services/scheme-editor-state.ts`，定义 `EditorSnapshot`（含 `EditedPlanPoint[]` + 暂不考虑分组 + 排除标记）与 `EditorState` 类/模块
- [ ] 3.2 实现快照式撤销栈：`history: EditorSnapshot[]` + `cursor`，上限 30 步，超出丢弃最旧；`push/undo/canUndo` 接口
- [ ] 3.3 实现自动保存：每次 `push` 后 `wx.setStorageSync('scheme_editor_draft_<resultKey>', snapshot)`；`resultKey` = 参数指纹（与 `buildSharePath` 同款，回看模式额外带 `savedId`），与 `saved-results` key 前缀隔离
- [ ] 3.4 实现 `loadDraft(resultKey)` / `clearDraft(resultKey)` / `initFromPlans(frontier, dominated, params)` 接口

## 4. 小程序：结果页编辑模式入口与视图切换

- [ ] 4.1 在 `pages/result/result.ts` `data` 增加 `editorMode: 'view'|'edit'`、`original: {frontier,dominated,recommendationRange}`、`userModified: {...}|null`、`viewMode: 'original'|'userModified'`
- [ ] 4.2 在 `result.wxml` 方案列表与图表之后新增「手动修改方案」入口，`isEmpty` 时隐藏（满足 spec「空结果页隐藏入口」）
- [ ] 4.3 进入编辑模式：从 `scheme-editor-state.initFromPlans` 或 `loadDraft` 初始化编辑态；退出时保持 draft 不清
- [ ] 4.4 实现 `viewMode` 切换：`pareto-chart` 与方案列表绑定到当前 `viewMode` 的数据副本；顶部「基于用户输入价」标注仅在 `viewMode==='userModified'` 显示
- [ ] 4.5 用户修改版保存：调用 `saved-results.saveResult` 生成独立 id 快照，`headerTitle` 标注「用户修改版」，不覆盖原快照

## 5. 小程序：方案编辑器交互（改价/渠道/排除/暂不考虑/新增）

- [ ] 5.1 在 `result.wxml` 增加编辑模式表格 UI：每行显示机型/买入时机/持有期/买入价（可编辑 input）/渠道 picker/排除 checkbox/移入暂不考虑按钮
- [ ] 5.2 买入价输入校验：> 0 数字，非法时高亮提示「买入价需大于 0」并标记该行不参与重算（满足 spec「非法买入价拦截」）
- [ ] 5.3 渠道 picker：闲鱼/转转/京东国补/官方旗舰店/其他 + 「是否使用国补」勾选；京东国补+国补时渠道标签显示「京东国补(国补)」并携带 `useSubsidy:true`
- [ ] 5.4 排除交互：单行 checkbox + 按属性快捷批量排除（「排除 8G 内存」「排除持有期 > 3 年」按钮，按 `EditedPlanPoint` 属性过滤勾选）
- [ ] 5.5 暂不考虑分组：移入后折叠到分组视图，提供「恢复」按钮回到主列表原位置
- [ ] 5.6 新增自定义方案表单：机型名/芯片（从 constants `chip_benchmarks` 已知芯片下拉 + 自由输入兜底）/内存/存储/买入时机/买入价/持有期；标注「自添加」
- [ ] 5.7 所有编辑动作（改价/渠道/排除/恢复/暂不考虑/恢复/新增/删除）统一走 `scheme-editor-state.push`，确保撤销栈与自动保存覆盖

## 6. 小程序：重算帕累托图与报告切换

- [ ] 6.1 「重新生成」按钮：收集未排除、未暂不考虑的 `EditedPlanPoint[]`，调 `engine-bridge.recomputeFromEditedPlans`
- [ ] 6.2 重算结果写入 `data.userModified`，切换 `viewMode='userModified'`，顶部显示「基于用户输入价」
- [ ] 6.3 全部方案被排除时提示「当前没有可重算的方案，请恢复或新增至少一个方案」，不进入空报告
- [ ] 6.4 `pareto-chart` 接收用户修改版数据源，对 `source:'edited'/'custom'` 的点加视觉标注（不同描边/角标）
- [ ] 6.5 「查看完整报告」入口在 `viewMode==='userModified'` 时把 `userModified` 数据写入 `globalData.reportData`，report 页顶部渲染「基于用户输入价」标注
- [ ] 6.6 原始版/用户修改版可来回切换查看，切换不触发重新跑引擎

## 7. 小程序：撤销与自动保存验证

- [ ] 7.1 验证多步撤销：依次「改价→排除→新增」后连续 undo 3 次回到初始态（满足 spec「多步撤销」）
- [ ] 7.2 验证自动保存与恢复：编辑后退出小程序，再次从同一结果页进入编辑器，恢复上次未提交编辑并提示「已恢复上次编辑」
- [ ] 7.3 验证 draft 与 `saved-results` key 隔离：清理 `saved-results` 不影响 draft，反之亦然

## 8. 小程序：方案表导出长图

- [ ] 8.1 新建 `miniapp/wx/services/long-image-export.ts`，封装 canvas 渲染方案表长图 + 末尾小程序码区域 + `wx.canvasToTempFilePath` + `wx.saveImageToPhotosAlbum`
- [ ] 8.2 长图结构：头部（标题 + 「基于用户输入价 · YYYY-MM-DD」+ 决策参数摘要）→ 方案表（每行含机型/买入时机/持有期/买入价/渠道/月均成本/性能满足度/帕累托状态，用户修改行加标注、已排除行灰显）→ 末尾小程序码 + 引导文案 + 数据更新日期
- [ ] 8.3 canvas 超高度上限（约 4096px）时采用「分段渲染 + `wx.canvasToTempFilePath` 多段导出 + 第二离屏 canvas 纵向拼接」策略
- [ ] 8.4 小程序码复用 `share-result` 云函数的 `qrcode` action（scene=用户修改版保存快照 id 或当前结果云端 id）；无网络时降级为「小程序名 + 引导文案」占位，不阻断长图导出
- [ ] 8.5 「导出长图」入口调 `long-image-export`，成功提示「已保存到相册」并支持 `onShareAppMessage`/转发
- [ ] 8.6 导出失败提示具体错误，编辑态不丢失，可重试
- [ ] 8.7 真机验证：长图分段拼接完整性、小程序码可扫码进入、相册保存与转发

## 9. 云函数：众包影子库写入

- [ ] 9.1 新建 `miniapp/wx/cloudfunctions/price-intake/index.js`，`action:'submit'` 写入 `price_intake_shadow` 集合
- [ ] 9.2 记录结构含 `submittedPlans` / `originalPlans`（原始推荐对照）/ `params` / `createdAt` / `submittedAt` / `anonId`（OPENID 哈希，不存明文）
- [ ] 9.3 从 `wx.cloud.getWXContext()` 取 OPENID 哈希为 `anonId`；端内不感知 OPENID
- [ ] 9.4 集合权限规则设为「仅创建者可读写」，云函数以管理端身份写入；与 `shared_results` 集合隔离
- [ ] 9.5 写入失败返回 `{ok:false,error}` 供端内静默降级 + 手动重试；不做服务端置信度批处理（留待 M2）

## 10. 小程序：众包提交入口与反馈

- [ ] 10.1 在用户重算或导出 PDF 后，弹窗提示「将你的方案上传到云端，帮助修正我们的预测——越多人使用并分享成交价，预测越准」+「同意上传/暂不上传」按钮
- [ ] 10.2 「同意上传」调 `price-intake` 云函数，提交内容 = 用户修改方案集 + 原始推荐方案 + params，不含个人身份信息
- [ ] 10.3 「暂不上传」不上传，提示不再自动弹出，用户可从编辑器手动触发上传
- [ ] 10.4 提交成功显示感谢语（「谢谢你的分享，你的成交价会让下一份预测更准」），无金钱/积分激励与导购字样
- [ ] 10.5 提交失败提示「上传失败，可稍后重试」，本地编辑态与重算结果不受影响，可手动重试

## 11. 端到端验证与合规自检

- [ ] 11.1 用 `wx-miniprogram-autotest` skill 跑结果页 → 编辑器 → 改价 → 重算 → 切换视图 → 保存用户修改版的端到端 smoke
- [ ] 11.2 验证回看模式下编辑器基于保存快照初始化、编辑与重算流程正常
- [ ] 11.3 验证空结果兜底页「手动修改方案」入口不显示
- [ ] 11.4 合规自检：全流程文案无「推荐购买/下单/最低价」等导购字样；感谢语无金钱激励；影子库写入经用户确认不静默上传
- [ ] 11.5 验证影子库与快照隔离：提交后 constants/本地快照不变，其他用户结果页不受影响
- [ ] 11.6 `openspec validate --change manual-scheme-editor --strict` 通过
