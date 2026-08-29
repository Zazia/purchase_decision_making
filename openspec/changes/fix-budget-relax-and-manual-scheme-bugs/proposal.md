## Why

用户在两条主路径上遇到三个阻断性 bug：① 预算内无可行方案触发自动放宽后，结果页只显示放宽方案卡片，但「查看完整报告 / 保存结果 / 手动修改方案」入口全部消失，用户无法继续任何操作；② 编辑器新增与快照同配置的方案（如 M4 16G/256G Mac mini）后，重算性能满足度与原方案不一致——引擎从 model 字符串解析内存/存储失败时回退默认 8G/256G，忽略了用户显式填写的 memoryGb/storageGb；③ 回看模式下编辑重算后，报告页仍用保存快照的旧 reportData 渲染，用户自添加方案不出现在完整报告中。

Bug 2 修复后仍有残留：macbook pro 品类添加 M3 Pro 自定义方案，性能满足度虚高约 2.5 倍。根因是引擎 `resolveCategoryKeyFromPlanPoint` 对自添加方案（model 为自由文本，快照中查不到）按芯片前缀兜底，M 系列一律返回 `Mac_mini`——旗舰基准分母、内存/存储权重表、保值率曲线、维修成本、残值分母、机龄匹配全部查错品类（此前 Mac mini M4 复现用例转绿纯属兜底值恰好等于正确品类）。另有同类问题：① `resolveReleaseDateKeyForCustomPlan` 用规范化芯片名（`M3_Pro_`）匹配快照 key，而快照 key 用紧凑写法（`M3Pro_14寸_...`），所有带 Pro/Max/Ultra 后缀的芯片即使品类正确也匹配失败，机龄错按 0 兜底；② A 系列芯片同样武断兜底为 `iPhone_Pro`，父品类 `iphone` 下添加标准版 iPhone 查错保值率/维修表。

## What Changes

- 结果页（normal 与 replay 两种模式）在「预算放宽后已有放宽方案」时 MUST 显示「查看完整报告 / 手动修改方案」入口与保存入口；仅当放宽后仍无方案（真·空结果）时才隐藏。
- 引擎重算自定义方案时 MUST 优先使用 `EditedPlanPoint.memoryGb` / `storageGb` 显式字段，仅当字段缺失时才从 model 字符串解析回退。`EditedPlanPoint` 类型新增这两个可选字段。
- 回看模式下编辑器重算后，从结果页进入报告页 MUST 使用刚重算的「用户修改版」数据（globalData.reportData），MUST NOT 被保存快照的旧 reportData 覆盖；报告页顶部标注「基于用户输入价」。
- 自添加方案（含其复制副本）重算时的品类 MUST 优先取决策参数的品类（`params.category`，如 `macbook-pro`，经 normalizeCategory 对齐查表键），MUST NOT 按芯片名前缀武断推断品类；`resolveCategoryKeyFromPlanPoint` 仅作回退。
- 自添加方案在 marketSnapshots 匹配同配置机型时（机龄推导），芯片前缀 MUST 同时兼容紧凑写法（`M3Pro_`）与规范化写法（`M3_Pro_`），带 Pro/Max/Ultra 后缀的芯片 MUST NOT 因写法差异匹配失败。

## Capabilities

### New Capabilities

（无——三个 bug 均为既有能力的实现缺陷修复）

### Modified Capabilities

- `wx-miniapp-mvp`: 「空结果兜底（简化）」需求明确预算放宽有方案时各入口的可见性；「基于用户修改版重算帕累托图与报告」需求明确回看模式下报告页必须使用重算后的用户修改版数据而非缓存快照。
- `apple-value-engine`: 「按给定方案集重算帕累托前沿」需求明确自定义方案的内存/存储 MUST 取自显式字段（EditedPlanPoint.memoryGb/storageGb），仅缺失时从 model 字符串回退解析；品类 MUST 优先取决策参数品类，机龄匹配的芯片前缀 MUST 兼容紧凑/规范化双写法。

## Impact

- `packages/apple-value-engine/src/types.ts`：`EditedPlanPoint` 新增 `memoryGb?` / `storageGb?` 字段。
- `packages/apple-value-engine/src/pareto.ts`：`rebuildCustomPlanPoint`（及 `rebuildEditedPlanPoint` 中复制的自定义方案）改用显式字段优先。
- 引擎单测：新增「同配置自添加方案与原始方案性能一致」用例。
- `miniapp/wx/pages/result/result.wxml`：入口按钮的 `wx:if` 条件由 `!isEmpty && plans.length > 0` 改为 `plans.length > 0`（含保存按钮）。
- `miniapp/wx/pages/result/result.ts`：`onOpenReport` 在 `viewMode='userModified'` 时不再附带 `savedId`（或等效机制），确保报告页读取刚写入 globalData 的重算数据。
- `miniapp/wx/vendor/apple-value-engine/`：引擎修复后需重新 build + `node scripts/sync-engine.mjs` 同步。
- 复现脚本 `scripts/debug/repro-manual-scheme-bugs.cjs` 转为回归验证，并扩展 MacBook Pro M3 Pro 品类用例。
- 残留修复（引擎）：`packages/apple-value-engine/src/pareto.ts` 的 `rebuildCustomPlanPoint` / `rebuildEditedPlanPoint` 品类取值改为 `params.category` 优先；`resolveReleaseDateKeyForCustomPlan` 前缀匹配双写法容错。
