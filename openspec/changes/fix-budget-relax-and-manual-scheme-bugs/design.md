## Context

三个 bug 的根因（见 proposal.md - Why）：

1. **预算放宽态入口消失**：`result.ts` 的 `computeRelaxed` 分支把 `isEmpty` 置 `true`（同时 `plans` 填入放宽方案），而 `result.wxml` 中「查看完整报告 / 手动修改方案 / 保存结果」入口的 `wx:if` 均为 `!isEmpty && plans.length > 0`，导致放宽有方案时入口被误隐藏。
2. **自添加方案性能算错**：引擎 `packages/apple-value-engine/src/pareto.ts` 的 `rebuildCustomPlanPoint` 用 `extractMemoryGb/extractStorageGb` 从 model 字符串解析内存/存储；用户输入的 model 名（如「M4 Mac mini」）不含 `16G_256G` 段，解析失败后回退默认 8G/256G，而用户显式填写的 `EditedPlanPoint.memoryGb/storageGb` 被忽略。引擎类型 `EditedPlanPoint` 本身未声明这两个字段。
3. **重算报告不含自添加方案**：回看模式下 `result.ts` 的 `onOpenReport` 先把重算的用户修改版数据写入 `globalData.reportData`，但随后 URL 携带 `savedId` 跳转；`report.ts` 的 `onLoad` 见到 `query.savedId` 就调 `enterReplayMode`，用保存快照的旧 `reportData` 覆盖 globalData，重算结果被丢弃。

引擎产物通过 `scripts/sync-engine.mjs` 从 `packages/apple-value-engine/dist` 同步到 `miniapp/wx/vendor/apple-value-engine/`，端内修复必须走「改源码 → build → sync」链路（遵守「引擎与小程序解耦」约束，MUST NOT 直接改 vendor）。复现脚本 `scripts/debug/repro-manual-scheme-bugs.cjs` 已存在，可作回归验证。

## Goals / Non-Goals

**Goals:**

- 预算放宽后有方案时，三个入口（查看完整报告 / 保存结果 / 手动修改方案）在正常模式与回看模式下都可见可点。
- 自添加方案的内存/存储优先取显式字段，同配置下与快照方案性能/月均成本一致。
- 回看模式下重算后进报告页，使用重算数据而非缓存快照。

**Non-Goals:**

- 不改动预算放宽算法本身（放宽倍数、提示文案逻辑）。
- 不改编辑器 UI/交互、撤销栈、自动保存等既有行为。
- 不为「复制后的自定义方案」增加新的标识逻辑（复制走既有 `_copyKey` 机制）。
- 不处理保存快照的升级迁移（旧快照回看行为不变）。

## Decisions

### D1：入口可见性用 `plans.length` 驱动，而非新增状态位

把 `result.wxml` 三处入口的 `wx:if` 从 `!isEmpty && plans.length > 0` 改为 `plans.length > 0`（保存按钮保留既有的 `!isReplay && viewMode === 'original'` 条件）。`isEmpty` 语义收窄为「空结果兜底卡片是否显示」的 UI 状态，不再兼任「是否有入口」的开关。

- 备选方案：新增 `hasAnyPlans` 状态位。弃用——`plans.length` 已是单一事实源，再加状态位会引入两处同步负担。
- 真空结果（放宽后仍无方案）时 `plans.length === 0`，入口自然隐藏，与规格「空结果兜底页 MUST 隐藏入口」一致，无需额外处理。

### D2：`EditedPlanPoint` 显式字段优先，model 解析仅作回退

引擎 `types.ts` 给 `EditedPlanPoint` 增加可选字段 `memoryGb?: number; storageGb?: number`；`pareto.ts` 的 `rebuildCustomPlanPoint` 与 `rebuildEditedPlanPoint` 构造 inputs/Candidate 时改为 `ep.memoryGb ?? extractMemoryGb(ep)`、`ep.storageGb ?? extractStorageGb(ep)`。

- 为什么连 `rebuildEditedPlanPoint` 也改：用户在编辑器里「复制」一条自添加方案后，副本 `source='edited'`，但副本的 model 名同样不含 GB 段，若只改 custom 分支，复制后的方案会退回错误性能。
- 为什么保留 model 解析回退：`original` 方案点（来自快照）没有显式字段，`rebuildEditedPlanPoint` 对它们仍需从 model 解析，保持向后兼容（规格场景「显式字段缺失时从 model 回退解析」）。
- 备选方案：给所有 original 点在端内注入显式字段。弃用——侵入 `initFromPlans` 的数据流，且引擎侧回退逻辑本就存在、已测。

### D2b：自添加方案机龄取「相同型号」的真实机龄（用户口径确认）

自添加方案按类型 A「现在买」+ 用户输入价 + 相同型号机龄计算（用户明确确认的产品语义）。实现：引擎新增 `resolveReleaseDateKeyForCustomPlan`，按 芯片+内存+存储 在 marketSnapshots 匹配同配置机型（如「M4 Mac mini 16G/256G」→ `M4_16G_256G_二手/新品` → releaseDateKey `Mac_mini_M4` → 真实机龄）；精确配置匹配不到时按同芯片任意配置退化，仍匹配不到按机龄 0 兜底（原行为）。

- `buildPlanPointFromInputs` 类型 A 分支改用真实机龄（原为机龄 0 兜底）。
- `rebuildEditedPlanPoint`（复制的自添加方案）：附带修复——model 自由文本经 `resolveReleaseDateKeyFromModel` 会解析出垃圾 key（非空但查表失败），导致方案被静默丢弃；现按 `computeAgeMonths` 有效性判断，无效时走同配置机型兜底，仍无效时机龄 0 兜底不丢弃。
- 成本口径说明（用户确认拆分断言）：自添加方案（A 现在买）与等待类（B/C）快照方案存在等待月数的时点折旧差（实测约 1-2 元/36 个月持有期），源于买入时点不同（等待后买入 → 卖出时机龄多等待月数），非计算口径不一致；性能满足度与同配置快照方案完全一致（误差 0）。与「现在买」（A）语义的方案对比则完全一致（两路径等价单测验证）。
- 引擎同步（tasks 2.6）后端内行为变化（用户已确认接受）：vendor 旧引擎无 B/C 候选（快照方案全是 A「现在买」），src 新引擎 v3.8 在距新品发布 ≤90 天时生成 B/C「等新品」候选（当前 Mac_mini 因 M6 于 2026-08 刚发布），端内快照方案会从「现在买」变为「等 1 个月买降价」，结果页已有 B/C 橙色徽章支持。

### D2c：自添加方案品类取 `params.category`，芯片前缀推断降级为回退（残留修复）

`resolveCategoryKeyFromPlanPoint` 对自添加方案（model 为自由文本，快照中查不到）按芯片前缀兜底：M 系列 → `Mac_mini`、A 系列 → `iPhone_Pro`。导致 macbook pro 品类添加 M3 Pro 时旗舰基准分母（17100 vs 28500）、内存权重表（Mac_基础 vs Mac_Pro）、保值率曲线、维修成本、残值分母、机龄匹配全部查错品类，性能虚高约 2.5×；此前 Mac mini M4 复现用例转绿纯属兜底值恰好等于正确品类。

- 修复：`rebuildCustomPlanPoint` 与 `rebuildEditedPlanPoint`（自添加副本分支）的 categoryKey 优先取 `params.category`（端内值为 `macbook-pro` 等，经 `normalizeCategory` 转小写下划线后与 `getCategoryBenchmarkKey` / `getWeightTable` / `getRetentionRate` 查表键对齐）；`resolveCategoryKeyFromPlanPoint` 仅在 `params.category` 缺失/非法时作回退（保持 original/edited 快照方案现有行为不变——它们的 model 在快照中可精确命中第一分支，不走兜底）。
- 备选方案：给 `EditedPlanPoint` 增加 `categoryKey` 字段由端内显式携带。弃用——`recomputeFrontierFromPoints` 已持有 `params.category`（编辑器入口与结果页共用同一 DecisionParams），再加字段引入两处同步负担且旧 draft 快照无此字段还需迁移。
- 顺带记录（不修）：编辑器芯片下拉 `getKnownChips` 把 Mac 与 iPhone/iPad 芯片混在一个列表，用户在 Mac 品类下可选 A 系列芯片且不报错；修复品类解析后该场景已能算出合理结果（按所选品类查表），过滤属体验优化，超出本变更范围。

### D2d：自添加方案机龄匹配的芯片前缀双写法容错（残留修复）

`resolveReleaseDateKeyForCustomPlan` 用规范化芯片名构造前缀（`M3_Pro_`）匹配 marketSnapshots key，但快照 key 用紧凑写法（`M3Pro_14寸_16G_512G_二手`）——所有带 Pro/Max/Ultra 后缀的芯片即使品类正确（D2c 修复后）也匹配失败，机龄错按 0 兜底，残值（保值率按卖龄算）与系统支持风险全错。Mac mini M4（无后缀）不受影响，这是此前复现用例未暴露的原因。

- 修复：前缀匹配同时尝试紧凑与规范化两种写法（与 `resolveProductReleaseDate` 兜底2「芯片名紧凑/展开互试」同款思路），即 `chipPrefix ∈ {${chip}_, ${compact(chip)}_}`，精确匹配与同芯片退化匹配两步均用双前缀。
- 匹配成功后机龄链路不变：`resolveReleaseDateKeyFromModel` 从快照 key 推导 releaseDateKey（如 `MacBook_Pro_14_M3Pro`），`resolveProductReleaseDate` 已有跨尺寸同芯片模糊兜底（14 寸 M3Pro → 16 寸 M3Pro 的 2023-11），无需重复实现。

### D3：`onOpenReport` 在用户修改版视图下不带 `savedId`

`result.ts` 的 `onOpenReport` 中，跳转 URL 仅在「非用户修改版」时携带 `savedId`：`viewMode === 'userModified'` 时写完 globalData 后直接跳 `/pages/report/report`（无 query），`report.ts` 的 `onLoad` 走既有 `loadReport` 路径读取 globalData 刚写入的重算数据。

- 备选方案 A：给 report 页加 `forceFresh=1` query 参数。弃用——与「无 query 即读 globalData」的既有语义重复。
- 备选方案 B：`enterReplayMode` 里判断 globalData.reportData 是否为用户修改版再决定是否覆盖。弃用——把决策逻辑藏进被调用方，调用方（result 页）才知道当前视图态，职责错位。
- 未编辑直接回看报告（`viewMode='original'`）仍带 `savedId`，行为不变（规格场景「回看模式未编辑时报告用快照」）。

### D4：回归验证以 Node 复现脚本 + 引擎单测为主，端内手动冒烟为辅

引擎侧（Bug 2）在 `packages/apple-value-engine` 既有测试框架下加单测：构造快照方案 + 同配置自添加方案，断言两者性能/月均成本一致；显式字段缺失 + model 含 GB 段时回退解析不变。端侧（Bug 1/3）属 UI 数据流，用 `scripts/debug/repro-manual-scheme-bugs.cjs` 扩展断言 + 微信开发者工具手动冒烟（放宽预算路径、回看重算路径）。

## Risks / Trade-offs

- [引擎字段透传链路断裂] 端内 `scheme-editor-state.ts` 的 `EditedPlanPoint` 已有 `memoryGb?/storageGb?`，但 editor 页把点传给 engine-bridge 重算时若中途构造新对象丢字段，Bug 2 仍会复现 → 实现后跑复现脚本验证端到端链路；单测覆盖引擎纯函数层。
- [放宽态保存快照语义] 预算放宽态点「保存结果」会保存放宽方案集（原预算参数）——保存的快照回看时引擎按原参数重算可能再次为空 → 保存快照时连带存储当时的 `frontier/dominated` 数据（既有快照机制已存渲染数据，回看优先用缓存数据），验证保存→回看闭环。
- [vendor 同步遗漏] 直接改 vendor 不生效或被下次 sync 覆盖 → tasks 中明确「改 src → `npm run build` → `node scripts/sync-engine.mjs`」顺序，并以 vendor 文件内容包含修复为验收点。
- [isEmpty 语义收窄的回归] 其他 `wx:if` 分支（如空卡片 `wx:if="{{isEmpty}}"`、放宽方案卡片 `wx:if="{{isEmpty && plans.length > 0}}"`）依赖现有 `isEmpty` 组合 → 只改三处入口的 `wx:if`，不动 `isEmpty` 赋值逻辑，空卡片与放宽卡片渲染不变。
- [品类改为 params.category 优先的回归] original/edited 快照方案的 model 可精确命中快照第一分支，品类解析行为不变；但 `params.category` 为父品类（如 `iphone`）时与快照子品类键（`iPhone_Pro`）不同名——性能/权重查表走 normalizeCategory 映射本就支持父品类，保值率曲线 `getRetentionRate` 需以单测确认父品类键可命中（任务 6.3 覆盖 iPhone 用例）。
- [残留修复的 vendor 同步] 修复只改引擎 src，若遗漏 build + sync 则端内仍跑旧逻辑（M3 Pro 性能依旧虚高）→ 任务 6.5 以「vendor pareto.js 含 params.category 修复」为验收点。

## Migration Plan

纯 bug 修复，无数据迁移。发布顺序：引擎源码修复 → build + sync → 端内两处修复 → 全量回归（单测 + 复现脚本 + 冒烟）。回滚 = revert 整个分支，无持久化数据需要处理。
