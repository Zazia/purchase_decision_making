## 1. 引擎实现（残值锚定公式）

- [x] 1.1 `packages/apple-value-engine/src/cost.ts`：`computeMonthlyCost` 残值改为 `buyPrice × min(1, R(currentAgeMonths + holdingMonths) / R(currentAgeMonths))`；`CostBreakdown.currentNewPrice` 与参数 `currentNewPrice` 的 JSDoc 注明降级为信息性字段
- [x] 1.2 `cost.ts`：`computeMonthlyCostForWaitCandidate` 残值改为 `buyPrice × min(1, R(sellAgeMonths) / R(sellAgeMonths − holdingMonths))`（类型 B 得 buyAge=0、类型 C 得 当前机龄+等待月数）
- [x] 1.3 `cost.ts` 模块头注释与公式说明更新为 v4.3 锚定口径（含类型 A/B/C 买入机龄取值表）
- [x] 1.4 `packages/apple-value-engine/src/pareto.ts`：确认 `applyResidualImpact` 在锚定残值基数上生效（类型 A 冲击叠加语义不变）；全文件无其他残值公式残留

## 2. 引擎测试

- [x] 2.1 新增不变量回归测试（如 `tests/residual-invariant.test.ts`）：用仓库 constants.json 全品类 × 持有期 {1, 1.5, 2, 3, 4, 5} × buyTiming {new, used, both} 扫描，断言所有方案点 `residual ≤ buyPrice` 且 `monthlyCost ≥ 0`（含类型 B/C 候选）
- [x] 2.2 新增比率封顶测试：构造非单调曲线 / 极老机型（买入卖出两端同触 3% 底）的 constants，断言残值 = 买入价（不超）
- [x] 2.3 新增类型 C 复现用例回归：iPhone 15 Pro 128G 二手 1 年（等待 2 月），断言残值 ≈ 买入价 × R(49)/R(37) ≈ 2447 < 2925（对应 delta spec 场景）
- [x] 2.4 新增类型 B 等价性测试：断言新公式下类型 B 残值与旧公式（R(holding) × currentNewPrice=买入价）数值一致
- [x] 2.5 更新 `consistency.test.ts`、`v42-anchor-s0-residual.test.ts`、`v38-*.test.ts`、`recompute-frontier.test.ts` 中的具体残值/月均成本断言为新公式值；结构性断言（前沿无支配、重算一致性 ≤ 0.5 元、排序、推荐区间）保持不变
- [x] 2.6 跑 `pnpm --filter apple-value-engine test`（或包内 `npx vitest run`）全绿

## 3. 构建与同步

- [x] 3.1 `pnpm --filter apple-value-engine build`（tsc）+ ESM import 冒烟通过
- [x] 3.2 `node scripts/sync-engine.mjs` 同步 `miniapp/wx/vendor/apple-value-engine` 产物

## 4. 文档同步

- [x] 4.1 更新 `.agents/skills/apple-value-analysis/SKILL.md` 步骤 5：残值公式改为买入价锚定（`残值 = 买入价 × R(卖出机龄)/R(买入机龄)`），调整步骤 5.4 冲击说明（类型 A 叠加在锚定残值上）与「残值分母」相关表述（降级为信息展示）
- [x] 4.2 检查 SKILL.md 引用的 `reference/pricing-scenarios.md` §6（类型 B/C 残值分母情形）与 `market-sampling.md` §2（残值分母定义），按新口径改写或标注仅作信息展示

## 5. 人工验证（微信开发者工具）

- [x] 5.1 复现路径验证：iPhone 品类 → 含「等新品发布老款降价」选项 → iPhone 15 Pro 128G 二手 × 1 年，确认残值 < 买入价、月均成本 ≥ 0、报告页展示正常
- [x] 5.2 抽查 Mac 品类 result/detail 页残值与月均成本展示无异常（无 NaN、无负值、格式正常）
