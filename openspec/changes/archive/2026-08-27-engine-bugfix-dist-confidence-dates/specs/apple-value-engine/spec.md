## ADDED Requirements

### Requirement: 发布置信度解析容忍复合格式

`lookupConfidence` SHALL 以首字符前缀匹配解析发布时间预测置信度：以 `高` 开头的复合文本（如 `高(已官宣)`）MUST 解析为 `high`，以 `中` 开头的复合文本（如 `中(主流媒体爆料,非官宣)`、`中(媒体爆料)`）MUST 解析为 `medium`；其余（含 `低` 及任何无法识别的文本）MUST 解析为 `low`。该解析 MUST 仅作用于发布时间校验子表（`_当前校验结果_*` 的 `置信度` 字段），MUST NOT 影响价格置信度等其他字段的查找。

#### Scenario: 复合高置信度解析为 high

- **WHEN** 某品类在 `_当前校验结果_*` 子表中的 `置信度` 为 `"高(已官宣)"`
- **THEN** `parseReleasePlan` 返回的 `releaseConfidence` 为 `'high'`，`shouldGenerateWaitCandidates` 返回 `true`，类型 B/C 候选正常生成

#### Scenario: 复合中置信度解析为 medium

- **WHEN** 某品类的 `置信度` 为 `"中(主流媒体爆料,非官宣)"`
- **THEN** `releaseConfidence` 解析为 `'medium'`

#### Scenario: 纯文本仍正确解析

- **WHEN** 某品类的 `置信度` 为纯 `"高"` 或纯 `"中"`
- **THEN** 分别解析为 `'high'` 与 `'medium'`（向后兼容）

#### Scenario: 无法识别文本保守降级为 low

- **WHEN** 某品类的 `置信度` 为不以 `高`/`中` 开头的任意文本
- **THEN** 解析为 `'low'`（不生成等待候选，宁可保守不可错配）

### Requirement: 发布日期兜底不得跨芯片代际错配

`computeAgeMonths` 的模糊兜底匹配 SHALL 仅在候选 key 与日期表 key 的**完整芯片名**（如 `M4_Pro`）一致时命中，MUST NOT 以芯片名末段（如 `Pro`、`Max`）作为匹配条件。数据侧 `产品发布日期` 表 SHALL 覆盖市场快照中出现的全部机型代际（含 Pro/Max 子型号）；缺口 MUST 在数据维护时补齐。当且仅当所有兜底均未命中时，该候选的机龄解析 SHALL 失败（返回 -1、候选被跳过并计入 warning），MUST NOT 静默取错误日期。

#### Scenario: 缺失日期不再错配旧型号

- **WHEN** 候选 `M4_Pro_24G_512G_新品` 的 releaseDateKey 为 `Mac_mini_M4_Pro`，日期表无该 key 但存在 `Mac_mini_M2_Pro`
- **THEN** 兜底匹配 MUST NOT 命中 `Mac_mini_M2_Pro`（芯片名 `M4_Pro` ≠ `M2_Pro`），该候选被跳过并计入 warning

#### Scenario: 数据补齐后按真实日期计算

- **WHEN** 日期表已补 `"Mac_mini_M4_Pro": "2024-10"`，计算该机型在 2026-08 的机龄
- **THEN** 机龄 ≈ 22 个月（而非兜底错配 M2_Pro 的 43 个月），残值与系统支持期按真实日期计算

#### Scenario: 同芯片不同尺寸的正当兜底仍可用

- **WHEN** 候选 releaseDateKey 为 `MacBook_Pro_14_M3Pro`（日期表无此 key），日期表存在 `MacBook_Pro_16_M3Pro`
- **THEN** 兜底按完整芯片名 `M3Pro` 命中 `MacBook_Pro_16_M3Pro` 的日期

### Requirement: 构建产物模块格式与包声明一致

引擎包的构建产物 SHALL 为 ESM 格式，与 `package.json` 的 `"type": "module"` 及 `exports.import` 契约一致。每次构建后 SHALL 有真实 ESM import 冒烟检查（`await import('.../dist/index.js')` 加载成功且导出可访问）防止模块格式回归。构建命令 MUST NOT 依赖根 workspace 的 pnpm filter（当前工具链故障已绕行），MUST 可通过包内直调编译器完成。

#### Scenario: ESM import dist 直接可用

- **WHEN** 在 ESM 环境（如 `node --input-type=module`）中 `await import('file:///.../apple-value-engine/dist/index.js')`
- **THEN** 加载成功，`computeParetoFrontier`、`loadConstants` 等导出可访问，不抛 `exports is not defined in ES module scope`

#### Scenario: 构建后冒烟防回归

- **WHEN** 运行构建流程（tsc 直调 + 冒烟脚本）
- **THEN** tsc 退出码 0，且 ESM import 冒烟通过；任一失败则构建流程判定失败
