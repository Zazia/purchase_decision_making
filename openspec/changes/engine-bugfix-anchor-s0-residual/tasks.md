## 1. 锚定品识别与类型C排除

- [ ] 1.1 在 `release.ts` 新增 `isAnchorCandidate`（或等价 helper）：候选发布月 ≥ `releasePlan.nextReleaseMonth` 判定为锚定品；发布月经既有 `computeAgeMonths`/productReleaseDates 路径解析，无法解析返回 false（保守保留）
- [ ] 1.2 `pareto.ts` `extractWaitCandidates` 类型C循环中跳过锚定品；导出该 helper 供 buildPlanPoint 复用
- [ ] 1.3 测试：镜像 2026-08 真实常量形态的夹具（M6/M5_Pro 发布月 2026-08 = nextReleaseMonth，M4=2024-10）断言 M6 不出现在类型C候选集、M4 正常出现、M6 仍为类型A候选

## 2. S(0) 去除截断

- [ ] 2.1 `performance.ts` `computePerformance` 删除 `Math.min(1, …)`，直接用 `chipCoeff × memWeight × storageWeight`
- [ ] 2.2 测试：推算跑分 21000 ÷ 实测基准 17100 场景断言 `s0 ≈ 1.044`；同时断言既有老款用例数值不变（回归）

## 3. 类型A残值冲击

- [ ] 3.1 `release.ts` 新增 `computeAdjustedImpact(constants, releasePlan, macroContext)`：冲击均值 × (1 + 传导因子)，逻辑从 `predictDiscountedOldPrice` 抽出并让原函数改为调用它（行为不变）
- [ ] 3.2 `pareto.ts` `buildPlanPoint` 类型A分支：分析月/发布月/持有期推导「持有期内有新品发布」且候选非锚定品时，残值 × (1 − 调整后冲击 × 残值调整时变因子(卖出点距发布整月数))；月度推导复用 `resolveAnalysisMonth`/`diffMonths`
- [ ] 3.3 测试：M4 二手持有 12 月（距发布 12 月 → 因子 0.30，调整后冲击 26.25%）断言冲击后保值率 = 原保值率 × 0.92125；持有 18 月（「12月后」→ 因子 0.10）断言 × 0.97375；锚定品 M6 断言不施加；持有期短于发布窗口断言不施加

## 4. 残值分母显式选择

- [ ] 4.1 `cost.ts` `getCurrentNewPrice`：新品条目中取发布月最晚者，同月优先基础款（芯片名不含 Pro/Max/Ultra）；无法解析时兜底旧行为
- [ ] 4.2 测试：M6（2026-08 基础 6999）与 M5 Pro（2026-08 Pro 12999）以两种键顺序注入，断言均返回 6999；仅含老款时返回老款官方价（兼容场景）

## 5. 回归与验收

- [ ] 5.1 更新受影响既有测试（`v38-wait-candidates.test.ts`、`recompute-frontier.test.ts`），跑全量 `pnpm test` 通过
- [ ] 5.2 重建引擎 `dist`（含 ESM 冒烟 `scripts/engine-esm-smoke.mjs`）
- [ ] 5.3 验收：用当前真实 constants.json 重跑 `scripts/mac-mini-analysis-20260828.mjs`，比对 `scripts/debug/mac-mini-corrected-20260828.json`——类型A各行月均成本一致（整月口径，容差按保值率因子档位判）、M6 `avgS` 与基准一致、候选集不含 M6 类型C；类型C行**预期不一致**（引擎为情景A口径，人工基准已按三情景失效剔除），在比对说明中注明
- [ ] 5.4 检查小程序展示层对 `avgS > 1` 的渲染（快照/图表是否有 0-100% 硬编码），有问题则同步修
- [ ] 5.5 在 SKILL.md 引擎调用章节补一句：官宣未发售场景引擎已直出正确口径，人工后处理脚本 `mac-mini-postprocess-20260828.mjs` 降级为历史参考

## 6. 文档与归档

- [ ] 6.1 按 agents.md 约定提交（commit message 注明引擎口径修正与验收基准）；确认未引入根目录 `package-lock.json`（根 workspace 用 pnpm）
- [ ] 6.2 归档变更（openspec archive），delta 同步回 `openspec/specs/apple-value-engine/spec.md`，删除 apply 阶段残留进度文件（如 `apply_instructions.json`）
