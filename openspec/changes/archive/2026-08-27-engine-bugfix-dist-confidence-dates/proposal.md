## Why

2026-08-27 排障（`scripts/debug/engine-troubleshooting-log-2026-08-27.md`，22 项检查 6 项失败，代码已逐条核实）发现引擎存在三个真 bug：P0 dist 产物为 CJS 语法而包声明 `type:module`，ESM import 直接抛错（SKILL.md「引擎调用优先路径」整条不可用）；P1 置信度字段用严格等值解析，`"高(已官宣)"` 被判为 low，已官宣品类的类型 B/C 等待候选整体静默缺失；P2 快照缺 `Mac_mini_M4_Pro` 发布日期且引擎兜底用末段 `"Pro"` 匹配到 M2_Pro，机龄虚增 21 个月导致残值/支持期连锁算错。核心数值内核经手工复算确认可信，问题集中在候选提取与发布窗口集成层。Mac mini 选购分析已因这些问题中止，待修复后重跑。

## What Changes

- **P0（阻断）**：引擎 tsconfig `module`/`moduleResolution` 由 `CommonJS`/`Node` 改为 `NodeNext`/`NodeNext`，重建 dist 为 ESM 产物，使包的构建输出与 `package.json` 的 ESM 契约一致；补一个真实 ESM import 冒烟检查防止回归
- **P1（高）**：`release.ts` `lookupConfidence` 由严格等值改为前缀匹配（`高`/`中`开头即命中），使 `"高(已官宣)"`、`"中(媒体爆料)"` 等复合文本正确解析；补 4 个复合格式测试用例
- **P2（高）**：数据侧为 constants `产品发布日期` 补 `Mac_mini_M4_Pro: "2024-10"` 并排查其他品类同类缺口；引擎侧收紧 `computeAgeMonths` 兜底 3 的芯片段匹配（不得以 `Pro` 这类后缀段跨代际命中任意 Pro 型号）
- **P3（中，纯数据）**：快照为 M4 拆出独立 `M4_16G_256G_二手` 键（二手价 4200，正常闲鱼口径字段），并把停产 M4 条目的新品参考价标注为不可购；引擎代码不动
- **测试盲区补齐**：新增「dist 真实 ESM import」冒烟、「置信度复合格式」用例、「日期兜底命中哪条」断言，堵住「83 测试全绿但运行时出错」的三个盲区

**明确不修（本次范围外）**：
- P4 `Math.min(1,·)` 截断 S(0)：口径差异、方向保守、影响 ~4pp，另开小变更与 §9.5 对齐
- P5 `getCurrentNewPrice` 键序依赖：当前正确，属脆弱性记录，迁移结构化存储时改显式锚定字段
- T 工具链（pnpm workspace 混乱）：直调 tsc 绕行可靠，涉及 node_modules 变更，单独变更处理
- 报告 §六 四项「非缺陷」均为 v3.8 有意设计，不动

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `apple-value-engine`: 新增三条行为要求——①发布置信度解析 MUST 前缀匹配复合格式；②发布日期兜底匹配 MUST NOT 以芯片名末段（如 `Pro`）跨代际错配，缺日期的候选 MUST 显式暴露而非静默取错值；③构建产物 MUST 与包声明的模块格式（ESM）一致，import 冒烟纳入验证

## Impact

- **代码**：`packages/apple-value-engine/tsconfig.json`、`src/release.ts`（lookupConfidence）、`src/pareto.ts`（computeAgeMonths 兜底 3）、`packages/apple-value-engine/tests/`（新增用例）
- **数据**：`.agents/skills/apple-value-analysis/constants.json`（补发布日期、拆二手键）；`miniapp/wx/snapshot/` 由 pre-commit 钩子自动同步，禁止 `--no-verify` 跳过
- **消费方**：Agent 按 SKILL.md 调用引擎的路径恢复可用；小程序走独立快照不受影响；dist 重建后 vitest（走 src）不受影响
- **验证基准**：8-26 文字路径分析（`scripts/macmini-20260826-analysis.mjs`）结论可作修复后引擎结果的交叉验证基准；修复后须重跑 `scripts/engine-diagnose-20260827.mjs`，6 项失败应降至 0（P4 相关检查除外）
