## 1. 文档

- [x] 1.1 OpenSpec change：proposal.md / design.md / tasks.md / specs/wx-miniapp-mvp/spec.md / .openspec.yaml

## 2. 持有期多选（新增表单）

- [x] 2.1 `result.ts`：`editorAddForm.holdingYears` → `holdingYearsList: number[]`（默认 [3]），新增 `editorAddFormMode` / `editorEditingGroupKey` / `editorHoldingChips`（预计算 active 态，基础选项 [1, 1.5, 2, 3, 4, 5]）
- [x] 2.2 `result.wxml`：持有期数字输入框 → chips 多选；新增 `onEditorAddFormHoldingToggle`
- [x] 2.3 `result.wxss`：`.form-chips` / `.form-chip` / 选中态样式（灰色系选中态 `#86868F`，遵守 tokens.md「小程序持有期按钮不用品牌蓝」约束）
- [x] 2.4 `result.ts` `onEditorAddPlan`：按勾选持有期逐个构造方案点（同 model 前缀、独立 rowId），500 上限按新增点数拦截，至少勾选 1 个校验

## 3. 自添加方案编辑入口

- [x] 3.1 新增 `miniapp/wx/assets/icons/edit.svg`（铅笔图标，与 copy/delete 同风格）
- [x] 3.2 `result.wxml`：`source === 'custom'` 组行操作区显示编辑图标；表单标题/按钮按 `editorAddFormMode` 切换文案
- [x] 3.3 `result.ts` `onEditorEditCustomPlan`：预填组数据（机型名剥离 `_新品/_二手` 尾缀、买入价优先 editedBuyPrice、持有期勾选 = 组内现有持有期，选项并入非标准值）
- [x] 3.4 `result.ts` `onEditorAddPlan` 编辑分支：公共字段整组更新 + model 重建；持有期 diff（取消勾选删点并清 deferredRowIds / 新勾选插点继承 _copyKey）；买入时机变化时渠道/国补重置默认；保存走 `commitEdit`，取消复位编辑态

## 4. 引擎修复与回归

- [x] 4.1 `pareto.ts`：`stripHoldingYearsSuffix` 正则 `\d+年` → `[\d.]+年`
- [x] 4.2 引擎单测：自添加方案 1.5 年持有期重算后 model 后缀剥离正确（无双重后缀）、月均成本按 18 个月口径（`recompute-frontier.test.ts`，115/115 通过）
- [x] 4.3 引擎全量测试 + `npm run build --workspace apple-value-engine` + `node scripts/sync-engine.mjs` 同步 vendor（vendor pareto.js 已含 `[\d.]+年` 修复）
- [x] 4.4 `miniapp/test/engine-integration.test.js` 回归：56 通过 / 1 失败（「推荐区间性能≥0.8」为 HEAD 既有失败，与本 change 无关，stash 验证基线一致）
- [x] 4.5 `npx tsc -p miniapp/wx/tsconfig.check.json --noEmit`：仅 3 个 HEAD 既有错误（Picker 类型 ×2 / vendor EditedPlanPoint candidateType 差异），本 change 无新增错误

## 5. 收尾

- [x] 5.1 新增 WXSS 色值人工比对 `.design_library/tokens.md` 通过（#86868F / #D1D1D6 / #F5F5F7 / #1D1D1F / #FFFFFF 均为令牌色；check-design-tokens.mjs 脚本已不存在，按令牌文档逐色核对）
- [x] 5.2 `openspec validate custom-scheme-multi-holding-and-edit` 通过
- [x] 5.3 微信开发者工具手动冒烟：多持有期添加 → 分组展示「持有期 n/n」→ 编辑入口回填 → 增删持有期 → 重算报告含全部变体（用户确认完成）
