## 1. 引擎类型与决策参数扩展（apple-value-engine）

- [x] 1.1 在 `packages/apple-value-engine/src/types.ts` 扩展 `BuyTiming` 为 `'new' | 'used' | 'both'`
- [x] 1.2 在 `types.ts` 新增 `MacroContext` 类型：`storageSuperCycleStage`、`hasGlobalPriceHike`、`analysisMonth`
- [x] 1.3 在 `types.ts` 新增 `ReleasePlan` 类型：`category`、`nextReleaseMonth`、`releaseConfidence`、`baselineDelayDays`、`pessimisticDelayDays`、`macroCapacityFactor`、`predictedPriceHike`、`hasHikeOccurred`
- [x] 1.4 在 `types.ts` 扩展 `DecisionParams`：新增可选字段 `considerWait?: boolean`、`macroContext?: MacroContext`
- [x] 1.5 在 `types.ts` 扩展 `PlanPoint`：新增 `candidateType: 'A' | 'B' | 'C'`、`waitMonths?: number`、`predictedPrice?: boolean`、`systemSupportRisk?: 'normal' | 'near-end' | 'exceeded'`、`systemSupportExceedMonths?: number`
- [x] 1.6 在 `load.ts` 增加 v3.8 字段映射：`_缺货等待期模型_v3.8`、`_新品价格预测模型_v3.8`、`_冲击时变曲线_v3.8`、`_宏观因子调整_v3.8`、`_发布时间预测校验_v3.8` 映射到 `Constants` 英文字段名
- [x] 1.7 在 `Constants` 类型新增字段：`waitPeriodModel`、`pricePredictionModel`、`impactTimeVaryingCurve`、`macroFactorAdjustment`、`releaseTimeValidation`

## 2. v3.8 新品发布期模块（release.ts）

- [x] 2.1 创建 `packages/apple-value-engine/src/release.ts` 模块
- [x] 2.2 实现 `parseReleasePlan(constants, categoryKey, macroContext): ReleasePlan | null`：从 constants 解析某品类的发布节奏、缺货等待期、价格预测涨幅、宏观产能因子
- [x] 2.3 实现 `computeWaitMonths(releasePlan, macroContext): number`：等待月数 = max(0, 预计发布月 - 分析月) + 上市到货延迟(月) × 宏观产能因子
- [x] 2.4 实现 `predictNewProductPrice(constants, categoryKey, releasePlan): number`：类型 B 买入价 = 当前同档老款官方价 × (1 + 预测涨幅中位数)；`hasHikeOccurred` 为 true 时直接用快照官方价
- [x] 2.5 实现 `predictDiscountedOldPrice(constants, oldCand, releasePlan, macroContext): number`：类型 C 买入价 = 当前市场价 × (1 - 调整后冲击幅度 × 冲击时变因子)，调整后冲击幅度按 `_宏观因子调整_v3.8` 修正
- [x] 2.6 实现 `lookupImpactTimeVaryingFactor(constants, monthsSinceRelease): { residualFactor, buyPriceDropFactor }`：查 `_冲击时变曲线_v3.8` 表
- [x] 2.7 实现 `shouldGenerateWaitCandidates(releasePlan, macroContext): boolean`：距下次发布 ≤ 90 天 且 `releaseConfidence !== 'low'` 时返回 true

## 3. 帕累托候选生成扩展（pareto.ts）

- [x] 3.1 修改 `extractCandidates`：`buyTiming === 'both'` 时同时收集「新品」与「二手」候选；候选对象 `buyTiming` 字段始终为 `'new'` 或 `'used'`（具体到机型）
- [x] 3.2 新增 `extractWaitCandidates(constants, categoryKey, releasePlan, macroContext): Candidate[]`：生成类型 B（等新品买新品）与类型 C（等新品后买降价老款）候选
- [x] 3.3 修改 `computeParetoFrontier`：若 `params.considerWait !== false` 且 `shouldGenerateWaitCandidates` 为 true，调用 `extractWaitCandidates` 追加到候选列表
- [x] 3.4 修改 `buildPlanPoint`：根据 `cand.candidateType` 选择性能计算路径（类型 B 用 S(0)=100% 分支）与残值计算路径（类型 C 不施加冲击）
- [x] 3.5 修改 `buildPlanPoint`：填充 `candidateType`、`waitMonths`、`predictedPrice` 字段
- [x] 3.6 新增 `computeSystemSupportRisk(constants, cand, holdingMonths): { risk, exceedMonths }`：计算系统支持期风险标注（normal/near-end/exceeded）
- [x] 3.7 修改 `selectRecommendationRange`：**取消** `avgPerformance >= performanceFloor` 过滤，仅保留 `buyPrice <= budget` 硬约束
- [x] 3.8 简化 `computeRelaxed`（在 `result.ts` 中）：取消"放宽性能地板至 0"那一轮，仅保留"放宽预算 ×2"一轮

## 4. 性能与成本模块适配

- [x] 4.1 在 `performance.ts` 新增 `computePerformanceForNewProduct(constants, category, holdingMonths, mCAGR, aCAGR)`：类型 B 新品 `S(0) = 1.0`，`S(N) = 1.0 / (1 + effectiveR)^(N/12)`，`avgS = (1 + sN) / 2`；`effectiveR` 用 `getEffectiveR` 应用代际跃升调整
- [x] 4.2 在 `cost.ts` 新增 `computeMonthlyCostForWaitCandidate`：类型 B/C 的残值不施加新品冲击调整；类型 C 的卖出时机龄 = 当前机龄 + 等待月数 + 持有月数
- [x] 4.3 在 `cost.ts` 复用现有 `getCurrentNewPrice` 与 `getBuyPrice`，不重复实现

## 5. 引擎单测

- [x] 5.1 在 `packages/apple-value-engine/tests/` 新增 `both-buy-timing.test.ts`：验证 `buyTiming='both'` 同时生成新品+二手候选
- [x] 5.2 新增 `multi-holding-years.test.ts`：验证 `holdingYears=[2,3,4,5]` 生成 4 倍候选点
- [x] 5.3 新增 `performance-floor-no-filter.test.ts`：验证 `performanceFloor=0.7` 时低于 0.7 的候选仍出现在 frontier 中（仅影响 recommendationRange）
- [x] 5.4 新增 `v38-wait-candidates.test.ts`：验证距发布 ≤ 90 天自动生成 B/C 候选；`releaseConfidence='low'` 时跳过
- [x] 5.5 新增 `v38-price-prediction.test.ts`：验证类型 B 预测价公式（含 `hasHikeOccurred` 分支）；验证类型 C 买入价下降公式（含宏观因子调整）
- [x] 5.6 新增 `v38-impact-time-varying.test.ts`：验证冲击时变因子查表（1月内/3月内/6月内/12月内/12月后）
- [x] 5.7 新增 `system-support-risk.test.ts`：验证 macOS 72 月 / iOS 60 月超出标注
- [x] 5.8 跑通现有 `consistency.test.ts`（与 skill 历史报告一致），若因性能地板不过滤导致 frontier 变化，更新 fixture 并在 commit message 说明

## 6. 决策树持有期多选 + 「都看看」语义修正

- [x] 6.1 修改 `miniapp/wx/pages/decision-tree/decision-tree.ts`：持有期步骤改多选（`selections.holdingYears` 为 `number[]`），新增「都看看持有期」快捷项默认勾选 2/3/4/5
- [x] 6.2 修改 `decision-tree.ts`：「都看看」`value` 由 `'used'` 改为 `'both'`
- [x] 6.3 修改 `decision-tree.wxml`：持有期步骤用 chip 多选组件（点击切换选中态，至少选 1 个才能下一步）
- [x] 6.4 修改 `decision-tree.ts goToResult`：多选 holdingYears 以逗号分隔传 URL query（已有解析逻辑兼容）
- [x] 6.5 修改 `decision-tree.wxss`：多选 chip 样式（选中态品牌蓝填充，未选态描边）

## 7. 结果页适配

- [x] 7.1 修改 `miniapp/wx/pages/result/result.ts parseQuery`：接收 `buyTiming='both'`（已有逻辑只识别 `'new'`/`'used'`，需扩展）
- [x] 7.2 修改 `result.ts formatPlans`：根据 `p.candidateType` 渲染不同徽章（A=无标注/B=「等新品后」橙色/C=「等新品降价」橙色）
- [x] 7.3 修改 `result.ts computeRelaxed`：取消"放宽性能地板至 0"那一轮，简化为"放宽预算 ×2"一轮
- [x] 7.4 修改 `result.wxml`：plan-card 增加 `candidate-type` 徽章；底部增加「查看完整报告」入口
- [x] 7.5 修改 `result.wxss`：候选类型徽章样式

## 8. 帕累托图增强

- [x] 8.1 修改 `miniapp/wx/components/pareto-chart/pareto-chart.ts`：新增 `markArea` 绘制推荐区间半透明色带（cost ∈ [lowerCost, upperCost]）
- [x] 8.2 修改 `pareto-chart.ts`：新增预算垂直虚线 markLine（若 `budget > 0`）
- [x] 8.3 修改 `pareto-chart.ts`：候选类型形状区分（A=圆/B=三角形/C=菱形），B/C 用次级品牌色 + 半透明
- [x] 8.4 修改 `pareto-chart.ts`：被支配点加细描边（borderColor + borderWidth: 1）
- [x] 8.5 修改 `pareto-chart.wxml`：图例新增「等新品方案」项（图例由结果页 result.wxml 渲染，已在该页新增）
- [x] 8.6 修改 `pareto-chart.wxss`：图例样式扩展（图例样式在 result.wxss，已新增 legend-wait / legend-budget）

## 9. 详情页适配

- [x] 9.1 修改 `miniapp/wx/pages/detail/detail.ts`：展示 `waitMonths`（"等待 N 个月"）、`predictedPrice`（"预测价"徽章）、`candidateType`
- [x] 9.2 修改 `detail.ts`：展示 `systemSupportRisk` 标注（"⚠ 超出系统支持期 N 月" / "⚠ 接近支持尾声"）
- [x] 9.3 修改 `detail.wxml`：新增等待月数卡片、系统支持期风险卡片
- [x] 9.4 修改 `detail.wxss`：风险卡片样式（warning 橙色边框）

## 10. 端内报告页（pages/report/）

- [x] 10.1 创建 `miniapp/wx/pages/report/report.ts`：从 `app.globalData` 读取引擎结果 + 决策参数，组装报告数据
- [x] 10.2 创建 `report.wxml`：按 `design.md` D9 结构实现（结论卡 + KPI 行 + 预警 alert + 推荐方案表 + 全候选方案表 + 帕累托图 + 宏观因素 + 置信度表 + 更新提示）
- [x] 10.3 创建 `report.wxss`：复用 `design_tokens`，移动端字号统一，关键数字 `font-size:32px;font-weight:600`
- [x] 10.4 创建 `report.json`：注册页面，引入 `pareto-chart` 组件
- [x] 10.5 在 `app.json` pages 数组注册 `pages/report/report`
- [x] 10.6 实现 `onExportHtml`：用 `wx.getFileSystemManager().writeFile` 写入单文件 HTML 到临时目录，文件名 `YYYY-MM-DD-{品类}-决策报告.html`
- [x] 10.7 实现 `onShareFile`：用 `wx.shareFileMessage` 转发 HTML 文件
- [x] 10.8 全候选方案表默认折叠，点击展开；仅渲染前 20 行 + "查看全部 N 个方案"按钮

## 11. 快照同步 v3.8 字段

- [x] 11.1 修改 `scripts/sync-snapshot.mjs`：同步 constants.json 中 `_缺货等待期模型_v3.8`、`_新品价格预测模型_v3.8`、`_冲击时变曲线_v3.8`、`_宏观因子调整_v3.8`、`_发布时间预测校验_v3.8` 字段到 `miniapp/wx/snapshot/constants.js`
- [x] 11.2 在 `miniapp/wx/snapshot/constants.js` 顶部新增 `MACRO_CONTEXT` 字段（维护者人工写入当前宏观状态：`storageSuperCycleStage`、`hasGlobalPriceHike`、`analysisMonth`）
- [x] 11.3 修改 `miniapp/wx/engine-bridge/index.ts`：`compute(params)` 时注入 `macroContext`（从快照读取），传入 `computeParetoFrontier`
- [x] 11.4 修改 `engine-bridge/index.ts`：默认 `considerWait = true`

## 12. 文档与合规

- [x] 12.1 在 `.agents/skills/apple-value-analysis/SKILL.md` 「引擎调用」章节补充 `macroContext` 注入示例（不改正文 SOP）
- [x] 12.2 端内报告页文案扫描：禁用「推荐购买/立即下单/下单/最低价/性价比之王」，替换为「推荐方案/非劣方案/查看方案详情/月均成本最低/前沿上的方案」
- [x] 12.3 端内报告页扫描：确认无外部购买链接、无电商 logo、无京东联盟/多客链接
- [x] 12.4 类型 B/C 预测价在报告中明确标注「预测值」+ 置信度等级
- [x] 12.5 验证引擎零运行时依赖（`npm ls --production` 无任何依赖）

## 13. 验证与测试

- [x] 13.1 跑通引擎全部单测：`cd packages/apple-value-engine && npm test`
- [ ] 13.2 微信开发者工具预览：决策树持有期多选 + 「都看看」分支
- [ ] 13.3 真机测试：Mac mini 品类 + 预算 5000 + 持有期 [2,3,4,5] + 都看看 → 验证新品+二手+B/C 候选同图
- [ ] 13.4 真机测试：iPhone 品类 + 距 2026-09 发布 ≤ 90 天 → 验证类型 B/C 候选自动生成
- [ ] 13.5 真机测试：端内报告页全流程（结论卡 + KPI + 表格 + 图表 + 导出 HTML + 转发文件）
- [ ] 13.6 真机测试：性能地板 0.7 但低于 0.7 的候选仍可见
- [x] 13.7 验证 skill 路径：用引擎升级后的版本跑一次完整分析，与历史报告对比（月均成本误差 ≤ 0.5 元）
