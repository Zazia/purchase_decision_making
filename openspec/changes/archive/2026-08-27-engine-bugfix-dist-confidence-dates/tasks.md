## 1. P0：dist 模块格式修复（阻断项，最先做）

- [x] 1.1 修改 `packages/apple-value-engine/tsconfig.json`：`module` → `NodeNext`，`moduleResolution` → `NodeNext`
- [x] 1.2 直调编译重建 dist：`cd packages/apple-value-engine && node node_modules\typescript\bin\tsc -p tsconfig.json`，确认 exit 0
- [x] 1.3 编写 ESM import 冒烟脚本（`scripts/engine-esm-smoke.mjs`：await import dist/index.js，断言 `computeParetoFrontier`/`loadConstants` 为函数），运行通过
- [x] 1.4 用排障日志 §八 的 P0 快速验证命令复核：`node --input-type=module -e "await import('file:///.../dist/index.js')"` 成功

## 2. P1：置信度解析修复

- [x] 2.1 修改 `src/release.ts` `lookupConfidence`：`conf === '高'` → `conf?.startsWith('高')`，`中` 同理（保留 low 兜底）
- [x] 2.2 新增测试用例 4 个：`"高(已官宣)"` → high、`"中(主流媒体爆料,非官宣)"` → medium、纯 `"高"`/`"中"` 向后兼容、无法识别文本 → low
- [x] 2.3 补集成级用例：用 Mac_mini 真实 constants 断言 `shouldGenerateWaitCandidates` 为 true、`computeParetoFrontier` 候选类型分布含 B/C
- [x] 2.4 运行既有 83 测试确认无回归：`node node_modules\vitest\vitest.mjs run`

## 3. P2：发布日期修复（数据侧 + 引擎侧）

- [x] 3.1 数据：`.agents/skills/apple-value-analysis/constants.json` `产品发布日期` 补 `"Mac_mini_M4_Pro": "2024-10"`
- [x] 3.2 数据排查：对照市场快照全部机型 key 与发布日期表，列出其他缺口并逐条补齐（各品类 Pro/Max 子型号）
- [x] 3.3 引擎：收紧 `src/pareto.ts` 兜底 3——芯片段取完整芯片名（排除品类前缀与内存/存储/新旧段），禁止裸 `Pro`/`Max` 后缀命中（实现用「裸后缀段合并」替代 design 原定的「长度 > 3」检查，后者会误伤 M5/A16 类合法短芯片名）
- [x] 3.4 测试：断言 `Mac_mini_M4_Pro` 缺失时兜底 MUST NOT 命中 `Mac_mini_M2_Pro`；`MacBook_Pro_14_M3Pro` 仍可正当兜底到 `MacBook_Pro_16_M3Pro`
- [x] 3.5 验证：垫片路径下 M4_Pro_24G_512G_新品 × 4年 残值 ≈ 1923（对比修复前错值 1208）、支持期风险为近尾声（release-date-fallback.test.ts 断言残值 1850-2000 + 非 exceeded，已通过）

## 4. P3：M4 二手键拆分（纯数据）

- [x] 4.1 快照新增 `M4_16G_256G_二手` 键：闲鱼中位价 4200，字段用标准二手口径（样本量/来源/置信度照抄原参考字段）
- [x] 4.2 `M4_16G_256G_新品` 键：新品价字段标注「停产，新品不可购（资讯稿参考价）」（实现偏差：`闲鱼中位价_二手同款_参考` 未保留而是整体迁入二手键——保留会让 getBuyPrice 的 used 兜底路径继续从新品键读出 4200 幽灵价，诊断 S4-2 验证迁出后 used 取价为 null）
- [x] 4.3 提交时确认 pre-commit 钩子已同步 `miniapp/wx/snapshot/`（禁止 --no-verify）——已手动执行 `node scripts\sync-snapshot.mjs` 同步并校验 hash 一致

## 5. 回归验证与收尾

- [x] 5.1 全量测试：vitest run 全绿（94 = 原 83 + 新增 11）
- [x] 5.2 重跑 `node scripts\engine-diagnose-20260827.mjs`：22 项检查全部通过（修复前 7 项失败；期间发现 dist 未随 src 重建，已重新 build 后全过；脚本 CJS 垫片已随 P0 模块格式切换改为 ESM 动态 import）
- [x] 5.3 与 8-26 文字路径分析交叉验证：类型 B 预测价 6999 ✓（S5-1）、类型 C 情景 A 公式与手工复算一致 ✓（S5-2）、等待候选生成 ✓（S3-1/S6-1）
- [x] 5.4 更新 SKILL.md 如有调用方式变化（无变化则跳过）；按仓库约定归档变更并同步 delta 回主规格（SKILL.md 已更新加载陷阱说明与测试数 94；调用方式 loadEngine() 无变化，加载器策略1天然兼容纯 ESM dist，冒烟 PASS 验证）
