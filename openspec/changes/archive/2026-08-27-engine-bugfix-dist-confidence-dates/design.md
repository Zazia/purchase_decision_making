## Context

排障日志（`scripts/debug/engine-troubleshooting-log-2026-08-27.md`）实证了三个真 bug（P0/P1/P2）与一个数据口径问题（P3），且 83 个既有测试全绿——因为 vitest 走 `src/*.ts` 不经 dist、用例未覆盖复合格式置信度与日期兜底命中路径。引擎零运行时依赖、纯函数、数值内核经手工复算可信，这些约束不变。消费方只有 Agent 按 SKILL.md 的 ESM import 路径（小程序用独立快照 constants.js，不经 dist）。

涉及代码点（已逐条核实）：
- `packages/apple-value-engine/tsconfig.json`：`module: CommonJS` + `moduleResolution: Node`，与 `package.json` 的 `type: module` / `exports.import` 矛盾
- `src/release.ts:336-338` `lookupConfidence`：`conf === '高'` 严格等值，数据侧实际值为 `"高(已官宣)"`、`"中(主流媒体爆料,非官宣)"` 等复合文本
- `src/pareto.ts:892-906` `computeAgeMonths` 兜底 3：`releaseDateKey.split('_').pop()` 取末段（`M4_Pro_24G_512G_新品` → 芯片段为 `M4_Pro`，但 key 形如 `Mac_mini_M4_Pro` 末段是 `Pro`），`endsWith('_Pro')` 可命中任意 Pro 型号
- constants `产品发布日期` 缺 `Mac_mini_M4_Pro`（有 M1/M2/M2_Pro/M4/M6/M5_Pro）

## Goals / Non-Goals

**Goals:**
- 恢复 SKILL.md「引擎调用（优先路径）」：ESM import dist 直接可用
- 已官宣/媒体爆料品类正确生成类型 B/C 等待候选（Mac_mini、Mac_studio、Apple_TV、HomePod）
- M4_Pro 候选的机龄、残值、支持期按真实发布日期 2024-10 计算
- M4 二手参考价进入候选；停产 M4 不再以「新品」身份混入
- 三个测试盲区（dist import、复合置信度、兜底命中）补上用例

**Non-Goals:**
- P4 S(0) 封顶口径（另开变更）
- P5 键序脆弱性（记录不动）
- T 工具链修复（pnpm workspace，单独变更）
- 类型 C 三情景加权（v3.8 设计留给 skill 层）
- 残值宏观调整/发布冲击（v3.8 设计留给 skill 层）

## Decisions

### D1 P0：tsconfig 改 NodeNext 而非包降级 CJS

`module: NodeNext` + `moduleResolution: NodeNext`。src 已用 `./types.js` ESM 风格相对导入（带 .js 后缀），天然兼容 NodeNext；dist 产出真实 ESM，与 `exports.import` 契约一致。备选「包降级 CJS」（移除 `type:module` + exports 加 require 条件）被否：与「零依赖跨端」包定位相悖，且小程序端 import 语义依赖 ESM。
重建命令沿用已验证的直调路径：`cd packages/apple-value-engine && node node_modules\typescript\bin\tsc -p tsconfig.json`（不依赖待修的 T 工具链）。

### D2 P1：前缀匹配而非正则/白名单

`lookupConfidence` 改为 `conf?.startsWith('高')` / `startsWith('中')`。与 v4.1 已修复的同源函数 `lookupPriceHike` 的 `includes` 风格保持一致，最小改动、可读。不引入正则（复合格式开放性高：`高(已官宣)`、`高(官宣日官网直采)` 等），不做白名单枚举（数据侧自由文本，枚举必再漏）。`低` 显式不匹配——任何不以 高/中 开头的值按 low 处理，保守方向安全（low 只是不生成等待候选，不会生成错误候选）。

### D3 P2：数据修复为主、引擎兜底收紧为辅

数据侧补 `"Mac_mini_M4_Pro": "2024-10"`（首发 2024-10，多源公开事实），并排查其他品类快照机型与发布日期表的差集。引擎侧兜底 3 收紧：芯片段取「去掉品类前缀与内存/存储段后的完整芯片名」，且要求匹配段长度 > 3（排除 `Pro`/`Max` 裸后缀），使 `M4_Pro` 只能命中 `*_M4_Pro` 形态的 key。兜底仍取不到时返回 -1（现行语义：候选被跳过并计入 warning），比静默取错值好——错配 21 个月的代价远大于丢一个候选。

### D4 P3：纯数据侧拆键，引擎不动

快照新增 `M4_16G_256G_二手` 键（闲鱼中位价 4200，标准二手字段结构），`M4_16G_256G_新品` 键中的 `闲鱼中位价_二手同款_参考` 保留作参考但新品价标注「停产，新品不可购（资讯稿参考价）」。不做引擎侧「新品键下含二手价」的推断兜底——键名约定是快照的显式契约，引擎按契约提取，隐式推断会引入新的口径歧义。

### D5 验证：三层

1. vitest 新增用例（复合置信度 4 例、兜底命中断言）走 src
2. 构建后真实 ESM import 冒烟：`node --input-type=module -e "await import('file:///.../dist/index.js')"`，写进引擎包 `package.json` scripts（`build` 后自动跑）或独立 `scripts/` 冒烟脚本——选后者，避免依赖待修的 T 工具链（pnpm run）也能跑
3. 重跑 `scripts/engine-diagnose-20260827.mjs`：修复前 6 失败，修复后应 0 失败（该脚本含 P4 相关检查项的话除外，逐项核对）
4. 与 8-26 文字路径分析交叉验证 Mac mini 场景的关键数值（类型 B 预测价 6999、等待月数 2、M4_Pro 残值 ≈1923/4年）

## Risks / Trade-offs

- [NodeNext 对 `resolveJsonModule` + JSON 导入的路径解析更严格] → 本包 src 无运行时 JSON import（constants 由调用方注入），风险不落地；构建后以 tsc exit 0 + import 冒烟双确认
- [前缀匹配把 `高(官宣日官网直采)` 等价格置信度文本也判 high] → `lookupConfidence` 只读发布时间校验子表（`_当前校验结果_*`），价格置信度字段走 `lookupPriceHike`，两个查找域不交叉
- [数据补日期写错] → 2024-10 为 M4 Pro Mac mini 首发的公开事实，且补入后用诊断脚本 S6-2 期望值（残值 ≈1923、支持期近尾声）验证
- [dist 重建覆盖手工垫片产物] → 无影响，垫片在诊断脚本内，不落 dist
- [pnpm --filter 仍不可用] → 本变更所有构建/测试命令均用直调路径，不依赖 T 修复

## Migration Plan

1. 修 tsconfig → 重建 dist → ESM import 冒烟（解锁 P0）
2. 修 `lookupConfidence` + 测试（P1）
3. constants 补日期 + 拆二手键（P2 数据侧 + P3），pre-commit 钩子自动同步小程序快照
4. 修兜底 3 + 测试（P2 引擎侧）
5. 重跑诊断脚本 + 交叉验证 → 全绿后本变更可归档
回滚：全部为代码/数据文件改动，git revert 即可；dist 为构建产物不入库。
