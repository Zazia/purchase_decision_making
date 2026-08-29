# Design: 自添加方案多持有期 + 编辑入口

## D1 持有期多选（表单改造）

### D1a 数据结构

`editorAddForm` 字段变更：

```
holdingYears: number            →  holdingYearsList: number[]   // 默认 [3]
```

新增 data 字段：

- `editorAddFormMode: 'add' | 'edit'`（默认 'add'）
- `editorEditingGroupKey: string`（编辑模式下的目标分组 key，add 模式为 ''）
- `editorHoldingOptions: number[]`（基础选项 `[1, 1.5, 2, 3, 4, 5]`；编辑模式并入组内已有非标准持有期，排序去重）

### D1b 交互

- chips 样式复用品牌选中态（蓝底白字 #007AFF，与 filter-chip / subsidy-toggle / 决策树 chips 一致）；未选中为白底灰边。
- 切换 handler `onEditorAddFormHoldingToggle`：tap 切换勾选；保存时校验至少 1 个，否则 toast「请至少勾选一个持有期」。
- 「添加」时为每个勾选持有期各构造一个 `EditedPlanPoint`：
  - `model: \`${机型}_${新品|二手} × ${years}年\``（与既有单持有期格式完全一致，保证分组 key 正常剥离后缀）
  - 每点独立 rowId；其余字段（chip/memoryGb/storageGb/buyPrice/channel/useSubsidy）全部相同
  - 500 上限校验：`snap.points.length + holdingYearsList.length > 500` 拦截
- 添加成功后同组多点自然被 `getGroupKey`（剥离 ` × Ny年` 后缀）聚合为一个方案组，展示「持有期 n/n ▾」，持有期多选菜单可直接再排除个别持有期——零额外代码。

## D2 编辑入口（custom 组）

### D2a 入口

- 主列表行操作区（复制/删除图标旁）对 `item.source === 'custom'` 的组显示编辑图标 `edit.svg`。
- 复制的自添加方案副本（`...orig` 展开保留 `source: 'custom'`）同样显示；编辑副本组时保留 `_copyKey`，分组不漂移。
- 「暂不考虑」分组行不提供编辑入口（与复制/删除一致，恢复后可编辑）。

### D2b 打开编辑（onEditorEditCustomPlan）

- 通过 `findGroupPoints(snap, groupKey)` 取组内全部点。
- 预填：
  - 机型名 = baseModel 去掉尾部 `_新品`/`_二手`（baseModel = model 剥离 ` × Ny年` 后缀）
  - chip / memoryGb / storageGb / buyTiming 取组内首点
  - buyPrice 取 `editedBuyPrice ?? buyPrice`（行内改过价则带出改后价）
  - `holdingYearsList` = 组内全部点的持有期（排序）
  - `editorHoldingOptions` = `[1, 1.5, 2, 3, 4, 5] ∪ 组内持有期`，升序去重
- `editorShowAddForm: true` 复用同一表单，标题「编辑自添加方案」、确认按钮「保存」。

### D2c 保存编辑（onEditorAddPlan 统一入口，按 mode 分流）

公共校验同 add（芯片/机型名/买入价/持有期非空 + 500 上限按净增量）。

1. **字段整组更新**：对组内每个点重建 `model = \${机型}_${买入时机} × \${点.holdingYears}年\`，并更新 chip/memoryGb/storageGb/buyPrice/holdingMonths；
   - editedBuyPrice 处理：编辑保存的 buyPrice 直接写 `buyPrice`（与「添加」语义一致，行内改价字段 `editedBuyPrice` 清空，避免新旧价并存取错）。
2. **持有期增删**（diff `holdingYearsList` vs 组内现有持有期）：
   - 取消勾选 → 删除对应点，并从 `deferredRowIds` 清除其 rowId；
   - 新勾选 → 在组尾插入新点（独立 rowId，继承组 `_copyKey`，channel/useSubsidy/buyPrice 等公共字段同组，deferred=false）；
   - 保留持有期 → 仅更新公共字段，deferred/excluded 状态原样保留。
3. **买入时机变化**：channel/useSubsidy 重置默认（new→京东+国补 true，used→闲鱼+false）；未变则保留组内现值。
4. 保存走 `commitEdit`（撤销栈 + 自动保存 + 视图刷新统一入口），关闭表单并复位 `editorAddFormMode='add'`。

### D2d 取消

- 「取消」直接 `editorShowAddForm=false` + 复位编辑态，无数据变更。

## D3 引擎：小数持有期后缀剥离

`stripHoldingYearsSuffix(model)` 正则 `/\s*×\s*\d+年$/` → `/\s*×\s*[\d.]+年$/`。

- 影响面：`rebuildEditedPlanPoint` / `rebuildCustomPlanPoint` 的 modelKey、两处按 modelKey 的查表逻辑。快照方案持有期均为整数（`\d+` 可匹配），行为不变；仅自添加方案 1.5 年等小数持有期被正确剥离。
- 单测：自添加方案 `holdingYears: 1.5` 经 `recomputeFrontierFromPoints` 重算后，生成点的 model 不含「× 1.5年」尾巴且月均成本按 18 个月折旧口径计算。

## D4 验证策略

- 引擎：vitest 全量回归 + 新增 1.5 年自添加方案用例。
- 端内：微信开发者工具手动冒烟（添加多持有期 → 分组展示 → 编辑 → 增删持有期 → 重算报告含全部变体）。
- WXSS 颜色合规：`node scripts/check-design-tokens.mjs`。
