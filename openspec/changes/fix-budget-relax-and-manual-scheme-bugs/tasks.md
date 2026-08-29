## 1. 分支与基线

- [x] 1.1 新建并切换到 git 分支 `fix/budget-relax-and-manual-scheme-bugs`（基于当前主工作分支）
- [x] 1.2 运行 `node scripts/debug/repro-manual-scheme-bugs.cjs` 确认修复前 Bug 2 性能差异（基线红）

## 2. 引擎修复（Bug 2：自添加方案性能计算）

- [x] 2.1 `packages/apple-value-engine/src/types.ts`：`EditedPlanPoint` 新增可选字段 `memoryGb?: number`、`storageGb?: number`（带注释说明「端内自添加方案显式填写，优先于 model 字符串解析」）
- [x] 2.2 `packages/apple-value-engine/src/pareto.ts`：`rebuildCustomPlanPoint` 的 inputs 构造改为 `memoryGb: ep.memoryGb ?? extractMemoryGb(ep)`、`storageGb: ep.storageGb ?? extractStorageGb(ep)`
- [x] 2.3 `packages/apple-value-engine/src/pareto.ts`：`rebuildEditedPlanPoint` 的 Candidate 构造同样改为显式字段优先（覆盖「复制的自添加方案」场景；model 自由文本解析机龄无效时按「相同型号机龄」兜底，见 design.md D2b）
- [x] 2.4 引擎新增单测：自添加方案（model 不含 GB 段 + 显式 memoryGb/storageGb）与同配置快照方案的性能满足度一致（误差 ≤ 0.001）；月均成本与「现在买」(A) 语义一致（误差 ≤ 0.5 元），与等待类 (B/C) 允许时点折旧差
- [x] 2.5 引擎新增单测：显式字段缺失时从 model（`M2_16G_256G_二手`）回退解析，行为与既有版本一致；另含「复制的自添加方案不被丢弃」场景
- [x] 2.6 运行引擎全量测试通过后，`npm run build --workspace apple-value-engine` + `node scripts/sync-engine.mjs` 同步到 `miniapp/wx/vendor/apple-value-engine/`，确认 vendor 的 pareto.js 含 `ep.memoryGb ??` 修复
- [x] 2.7 再次运行 `node scripts/debug/repro-manual-scheme-bugs.cjs`，确认同配置性能一致（转绿：性能差 0.0000）

## 3. 结果页修复（Bug 1：预算放宽态入口消失）

- [x] 3.1 `miniapp/wx/pages/result/result.wxml`：「查看完整报告」入口 `wx:if` 由 `!isEmpty && plans.length > 0` 改为 `plans.length > 0`
- [x] 3.2 `miniapp/wx/pages/result/result.wxml`：「手动修改方案」入口 `wx:if` 同上改为 `plans.length > 0`
- [x] 3.3 `miniapp/wx/pages/result/result.wxml`：「保存结果」按钮 `wx:if` 去掉 `!isEmpty`（保留 `plans.length > 0 && !isReplay && viewMode === 'original'` 其余条件）
- [x] 3.4 验证放宽态空卡片（`wx:if="{{isEmpty}}"`）与放宽方案卡片（`wx:if="{{isEmpty && plans.length > 0}}"`）渲染不受影响；真空结果（放宽后仍无方案）时三个入口全部隐藏（代码审查级验证：放宽态 plans 由 computeRelaxed 填充，真空态 plans=[] 三入口 wx:if 均不成立）

## 4. 报告页数据流修复（Bug 3：重算报告不含自添加方案）

- [x] 4.1 `miniapp/wx/pages/result/result.ts`：`onOpenReport` 中当 `viewMode === 'userModified'` 时跳转 URL 不携带 `savedId`（直接跳 `/pages/report/report`），确保 report 页走 `loadReport` 读取刚写入 globalData 的重算数据；`viewMode === 'original'` 时保持现状带 `savedId`
- [x] 4.2 验证回看模式闭环：保存结果 → 回看 → 进编辑器加自添加方案 → 重算 → 查看完整报告，自添加方案出现在全候选方案表且顶部标注「基于用户输入价」（代码链路级验证：onEditorRecompute 置 viewMode='userModified' + userModified 含自添加方案 → onOpenReport 写 globalData 且不带 savedId → report 页 loadReport 读取；端到端冒烟归入 5.2）
- [x] 4.3 验证回看模式未编辑时：直接「查看完整报告」仍用保存快照数据（含保存时数据日期），行为不变（代码链路级验证：viewMode='original' 时仍带 savedId → report 页 enterReplayMode 读快照；端到端冒烟归入 5.2）

## 5. 回归与收尾

- [x] 5.1 引擎全量测试（98/98 通过）+ 端内既有相关脚本（engine-esm-smoke PASS）回归通过；repro-manual-scheme-bugs.cjs 转绿
- [x] 5.2 微信开发者工具手动冒烟：低预算触发自动放宽 → 三个入口可见可点；正常路径结果页 → 报告 → 编辑器 → 重算 → 报告闭环（用户确认完成）
- [x] 5.3 `openspec validate fix-budget-relax-and-manual-scheme-bugs` 通过；全部任务勾选后按用户指示提交

## 6. 残留修复（Bug 2 深化：自添加方案品类误判 + 快照芯片名不容错）

> 排查结论（见 design.md D2c/D2d）：`resolveCategoryKeyFromPlanPoint` 对自添加方案按芯片前缀兜底 M 系列 → `Mac_mini`，导致 macbook pro 品类添加 M3 Pro 时性能虚高约 2.5×（旗舰分母/权重表/保值率/维修/残值/机龄全查错品类）；`resolveReleaseDateKeyForCustomPlan` 用 `M3_Pro_` 规范化前缀匹配紧凑写法快照 key（`M3Pro_14寸_...`），带 Pro/Max/Ultra 后缀的芯片机龄错按 0 兜底。

- [x] 6.1 `packages/apple-value-engine/src/pareto.ts`：`rebuildCustomPlanPoint` 与 `rebuildEditedPlanPoint`（自添加副本分支，`isCustomCopy` 为 true 时）的 categoryKey 优先取 `params.category`（经 `normalizeCategory` 对齐），缺失/非法时回退 `resolveCategoryKeyFromPlanPoint`；original/edited 快照方案行为保持不变
- [x] 6.2 `packages/apple-value-engine/src/pareto.ts`：`resolveReleaseDateKeyForCustomPlan` 的 chipPrefix 匹配（精确 + 同芯片退化两步）同时兼容紧凑写法（`M3Pro_`）与规范化写法（`M3_Pro_`）
- [x] 6.3 引擎单测：macbook pro 品类 + M3_Pro + 16G/512G 自添加方案与同配置快照方案（`M3Pro_14寸_16G_512G_二手`）性能满足度一致（误差 ≤ 0.001），机龄按 MacBook_Pro 16 寸 M3Pro 发布月（2023-11）计算（月均成本与「现在买」同价语义一致，误差 ≤ 0.5 元）；补 iphone 父品类自添加方案（A18）用例确认 `getRetentionRate` 父品类键可命中
- [x] 6.4 引擎单测：复制副本（source='edited'）与原自添加方案在 macbook pro 品类下结果一致（误差 ≤ 0.001 / ≤ 0.5 元）
- [x] 6.5 引擎全量测试通过后 `npm run build --workspace apple-value-engine` + `node scripts/sync-engine.mjs`，确认 vendor 的 pareto.js 含 `params.category` 修复
- [x] 6.6 扩展 `scripts/debug/repro-manual-scheme-bugs.cjs`：新增 macbook pro M3 Pro 用例（修复前红：性能虚高；修复后绿：与快照方案一致），跑通确认转绿；微信开发者工具手动冒烟归入 5.2 一并执行（编辑器添加 MacBook Pro M3 Pro → 重算 → 性能与同配置快照方案一致）
