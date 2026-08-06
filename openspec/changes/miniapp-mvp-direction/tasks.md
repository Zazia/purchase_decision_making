## 1. 引擎抽离（apple-value-engine）

- [x] 1.1 在 `packages/apple-value-engine/` 初始化 TS 包：`package.json`（name=apple-value-engine, type=module, zero runtime deps）、`tsconfig.json`、Vitest 配置
- [x] 1.2 定义 `Constants` 类型（基于 v3.8 constants.json 结构），覆盖 retention_curves、chip_benchmarks、market_snapshots、release_rhythm、maintenance_costs、macro_factors、design_tokens
- [x] 1.3 实现 `loadConstants(jsonText)`：JSON 解析 + 必需字段校验，缺失字段抛 `ConstantsValidationError` 含字段名
- [x] 1.4 实现保值率模块：范围内线性插值 + 范围外按末段斜率外推，M/A 系列 CAGR 作为参数注入不硬编码
- [x] 1.5 实现性能满足度模块：`S(t) = S(0)/(1+r)^(t/12)` + `S̄(N) = [S(0)+S(N)]/2`，含代际跃升识别（节点首发 r×0.5，跃升 r×1.5）
- [x] 1.6 实现月均成本模块：(买入价 − 预期残值 + 维修成本) / 持有月数，维修成本按品类查表
- [x] 1.7 实现帕累托前沿筛选：二维非劣解筛选 + 用户偏好截取推荐区间
- [x] 1.8 实现 `computeParetoFrontier(constants, params)` 主入口，返回 `{ frontier, dominated, recommendationRange }`
- [x] 1.9 收集 skill 历史 HTML 报告作为 fixtures，写一致性单测（月均成本误差 ≤ 0.5 元，性能满足度误差 ≤ 0.001）
- [x] 1.10 验证引擎在 Node + 浏览器 + 小程序三端运行（无 fs/Node API 依赖），`npm test` 全绿

## 2. skill 切换到引用引擎

- [x] 2.1 在 `SKILL.md` 增加「引擎调用」章节，说明 Agent 环境支持 npm 时优先调用 `apple-value-engine`
- [x] 2.2 保留现有 SOP 文字描述作为回退路径，标注「不支持 npm 时走此路径」
- [x] 2.3 用 TRAE/QoderWork 跑一次完整分析，对比引擎路径与文字路径输出一致
- [x] 2.4 验证 skill 现有远程获取 constants.json 逻辑不变，引擎接收的 constants 与远程获取结果兼容

## 3. 小程序工程搭建

- [x] 3.1 在 `miniapp/wx/` 初始化微信原生小程序工程（`project.config.json`、`app.json`、`app.ts`）
- [x] 3.2 配置 workspace 协议：根 `package.json` 加 workspaces 字段，小程序通过 `workspace:*` 引用 apple-value-engine
- [x] 3.3 引入 ec-canvas 组件（钉死版本号，避免上游 breaking）
- [x] 3.4 搭建 `engine-bridge/` 适配层：`getConstants()` 返回本地快照 Promise，`compute(params)` 调用引擎

## 4. 决策树表单页

- [x] 4.1 创建 `pages/decision-tree/` 页面，5 步单选表单（品类 → 预算 → 持有期 → 新品/二手 → 性能地板）
- [x] 4.2 每步加「不确定/帮我选」选项，选中后用品类默认参数继续，显示「AI 顾问功能开发中」提示
- [x] 4.3 步骤切换动画 + 进度条（5 步中的第 N 步）
- [x] 4.4 完成第 5 步后跳转结果页，参数通过 URL query 传递
- [x] 4.5 接入埋点（每步选择上报到本地存储，M2 接云开发时改上报）

## 5. 结果页与帕累托图

- [x] 5.1 创建 `pages/result/` 页面，调用 `engine-bridge.compute(params)` 获取前沿
- [x] 5.2 结论先行：顶部展示非劣方案列表（按月均成本升序，含机型/买入时机/持有期/月均成本/性能满足度）
- [x] 5.3 空结果兜底：前沿为空时提示「当前约束下无非劣方案」+ 给出去掉一个约束后的最近可行方案
- [x] 5.4 用 ec-canvas 渲染静态帕累托散点图：前沿点实心品牌色 + 被支配点灰显 + 推荐区间边框，关闭 tooltip/缩放
- [x] 5.5 点击图中点位跳转 `pages/detail/` 详情页，展示该方案完整成本分解
- [x] 5.6 底部展示数据时效提示（35/60 天分级）+ GitHub 链接

## 6. 分享卡模块

- [x] 6.1 创建 `pages/share-card/` 与 `components/share-card-canvas/`（`<canvas type="2d">` 1080×1440）
- [x] 6.2 离屏渲染：用户预算 + 推荐方案摘要 + 帕累托前沿缩略图 + 小程序码
- [x] 6.3 用户进入页面时 canvas 已就绪，点击「生成分享卡」仅调用 `wx.canvasToTempFilePath` 导出
- [x] 6.4 配置 `onShareAppMessage`，`imageUrl` 用生成的分享卡，path 带回用户参数用于裂变追踪
- [x] 6.5 提供「保存到相册」按钮（`wx.saveImageToPhotosAlbum`）
- [x] 6.6 最差情况降级：canvas 渲染失败时引导用户截图

## 7. 数据快照与同步脚本

- [x] 7.1 在 `miniapp/wx/snapshot/` 创建 constants.json 快照（首次为当前 v3.8 副本）
- [x] 7.2 实现 `scripts/sync-snapshot.mjs`：源文件存在校验 + hash 比对 + 拷贝 + `last_updated` 非空校验，失败退出非零码
- [x] 7.3 同步脚本接入 `package.json` scripts：`npm run sync:snapshot`
- [x] 7.4 在小程序版本号策略文档中写明：月更递增 minor 版本，月中临时更新不发版

## 8. 个人主体注册与合规

- [x] 8.1 注册个人主体微信小程序，选择「工具-效率」类目，获取 AppID
- [x] 8.2 在 `project.config.json` 填入 AppID
- [x] 8.3 全站文案扫描：禁用「推荐购买/立即下单/下单/最低价/性价比之王」，替换为对应替代词
- [x] 8.4 结果页与分享卡扫描：确认无任何外部购买链接、电商 logo、京东联盟/多客链接
- [x] 8.5 代码审查：确认无 `wx.requestPayment` 调用、无支付 SDK 依赖、无会员/订阅 UI

## 9. 独立性声明与文档

- [x] 9.1 创建 `STANCE.md`（或并入 README）：声明个人主体 + 无商业化 + 决策框架独立性
- [x] 9.2 在 README 增加「小程序入口」章节，含小程序码与使用说明
- [x] 9.3 在 STANCE.md 中列出商业化软约束的解锁条件（主体变更后才解锁的能力清单）
- [x] 9.4 在 STANCE.md 中说明引擎算法无可被商业方影响的可调因子，宏观因子均来自 constants.json 可追溯字段

## 10. 提审与上线

- [ ] 10.1 微信开发者工具预览，全机型真机测试（决策树表单 + 帕累托图 + 分享卡生成）
- [ ] 10.2 提交审核，类目「工具-效率」，确认无导购字样与外链
- [ ] 10.3 审核通过后发布 v1.0.0
- [ ] 10.4 第一篇内容（小红书/公众号）带小程序卡，验证分享卡裂变路径
- [ ] 10.5 观察首周数据：DAU、分享卡生成数、裂变新增占比，对照 design D8 的跨端触发条件
