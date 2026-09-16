# 交接文档：iPhone 18 发布数据回填 constants v4.7

> 日期：2026-09-14 | 作者：上一会话（上下文耗尽前交接） | 状态：**2026-09-16 引擎收尾与云端 constants 发布完成**

## 2026-09-16 续作结果（优先于下方历史状态）

- 原 6 个失败已修复：发布窗口与置信度用克隆夹具固定；类型 C 用明确 iPhone_Pro 子品类，避免父品类选择其他发布计划。
- 新增 8 个 iPhone 芯片/性能映射案例（14–18 ProMax、Duo、17/18 标准版）与真实 v4.7 发布滚动案例；等待候选测试增加非空断言。
- 全量 **16 文件、138 用例通过**；TypeScript 构建、真实 ESM import 冒烟与 diff 空白检查通过。
- vendor 与 constants 快照同步完成，宏观状态保持 ongoing / true / 2026-09。
- 发布 dry-run 通过：304408 bytes，SHA-256 `ecb1e498ff18a55274dba4d1f4f1c6359e806debc10296f8ab6aa719dfd2c159`。
- **云端已发布并回读通过**：2026-09-16 通过统一流水线 `via update` 写入；云端 version=2026-09-14，payload=304408 bytes，SHA-256 与本地完全一致，publishedAt=`2026-09-16T12:37:23.083Z`。
- **代码与远程 raw 分发已更新**：功能提交 `64c3350` 已推送 origin/main 与 gitee/main；两条远程 constants 数据源均已包含 v4.7。
- 主规格已同步；变更发布完成后归档到 `openspec/changes/archive/2026-09-16-finish-v47-engine/`。
- ProMax 引擎修复已在本地 vendor 中，仍须小程序代码发版才能用于线上客户端；云端 constants 发布只能更新数据。
- 交接原列 9-18/10-23 后事项继续待办：市场采价、A20 Pro 基准切换、核实 iPhone 内存后修复映射。未把尚待核实的 RAM 数字加入本次改动。
- 关键新品信息已复核 [Apple 官方发布稿](https://www.apple.com.cn/newsroom/2026/09/apple-debuts-iphone-18-pro-and-iphone-18-pro-max/)：A20 Pro 与 9 月 18 日发售；其余市场冲击数字仍为下方 9 月 14 日交接观察，未进行新一轮采价。

## 一、任务背景

用户指令（原文）：
1. "iPhone 新品已经发布，更新 constants.json。先增加新品的选项。再做一些快速搜索，校对一下几个主要受到冲击的品类。实际的价格冲击是否和预测相符？"
2. "先把已确定，能记录的记录进constants。一步一步来，免得上下文压缩丢失"
3. "先跳过进一步的数据收集，先更新已收集到的信息到constants"

## 二、已收集的关键信息（均已写入 constants.json）

### iPhone 18 系列官宣（2026-09-09 发布会，北京时间 9-10 凌晨）

| 机型 | 256G | 512G | 1TB | 2TB | 较上代 256G | 预购/发售 |
|---|---|---|---|---|---|---|
| iPhone 18 Pro | 9999 | 11999 | 15499 | 20499 | +11.1%（vs 17 Pro 8999） | 9-12 / 9-18 |
| iPhone 18 Pro Max | 10999 | 12999 | 16499 | 21499 | +10.0%（vs 17 ProMax 9999） | 9-12 / 9-18 |
| iPhone Duo（折叠屏，首款） | 15999 | 17999 | 21499 | 26499 | — | 10-16 / 10-23 |

- 2TB 档涨幅 +3500 元（约 +19.4%）为全系之最
- 折叠屏官宣定名 **Duo**（替代此前媒体命名 Ultra/Fold）
- 18 Pro 发布 5 日内电商已破发：9699 叠 600 元券至 9099（潮新闻 9-14 核实结算页）；Pro Max 渠道价坚挺未破发
- 拆分发布策略：标准版/18e/Air 2 推迟 2027-03

### A20 芯片跑分（GB 6.7.0）

- **A20 Pro（实测）**：单核 4719 / 多核 12677，2nm，6核CPU约4.93GHz，12GB 内存
- **A20（推算）**：单核 4450 / 多核 12000（按标准版/Pro 历史代际差 -5.5% 外推，2027-03 标准版发售后回填实测）

### 市场冲击实录（T+1周，观察期仅 5 天）

- **17 系（次新）不降反涨**：闲鱼上门回收 +70 元、商家抬价抢货；转转 17 系交易量环比 +280%（标准版 +700%）
- **16 及更老款按代际跨越承压**：US 官方 TradeIn 16 ProMax $720→$610（-15.3%）、16 Pro $630→$510（-19.0%）；中国理论值 -22.1%
- **三因叠加**：涨价发布 + 17 Pro/ProMax 发布当日（9-10）官网停产下架 + 在售旧机全系官方涨价 800 元（17 全系 256G 5999→6799）
- 信源：九派新闻/新浪财经 2026-09-10（https://finance.sina.com.cn/roll/2026-09-10/doc-inirixkq5299940.shtml）、9to5Mac 2026-09-09、搜狐数码闲聊站 2026-09-12

### 冲击 vs 预测结论（用户核心问题的答案，已可汇报）

- **涨幅预测兑现**：发布前 IDC 预测中位数 12%（区间 10-15%）vs 实测 18 Pro +11.1% —— 预测模型校准有效
- **时变曲线方向正确**：次新代获支撑、隔代承压，与"1月内=冲击最大时点"一致；但量级分化（17系逆势上涨为预测外现象，归因于停产+旧机涨价两额外因素）
- ⚠️ 观察期仅 5 天，9-18 正式发售后需复采 T+1月 冲击是否深化

## 三、constants.json 已完成修改（全部已落盘，JSON 语法已验证通过）

文件：`.agents/skills/apple-value-analysis/constants.json`（约 296KB，读取需 Grep+Read offset/limit）

| 段落 | 修改内容 |
|---|---|
| metadata | version 4.6→**4.7**；last_updated 2026-09-09→**2026-09-14**；data_sources 追加 v4.7 信源条目；新增 `v4.7_变更摘要`（8 条） |
| 芯片性能跑分 | 新增 A20（推算）、A20_Pro（实测）条目 |
| 苹果产品发布节奏 | iPhone_Pro/iPhone_ProMax 滚动至 2027-09 iPhone 19 世代（置信度降"中"），已发售信息移入 `_最近发布_v4.7`；新增 iPhone_Duo 条目 |
| 产品发布日期 | iPhone_18="2026-09"（含拆分发布注记）；新增 iPhone_Duo="2026-09" 预留键 |
| 性能满足度计算公式.品类基准芯片 | 新增 `_v4.7说明`：基准暂留 A19 Pro，9-18 发售后统一切换 A20 Pro |
| 实时市场价快照 | iPhone_Pro/iPhone_ProMax 新增 18 代新品条目（国补/二手字段记"无法搜索"）；旧机停产标注、残值分母切换至 18 代官方价 |
| 分品类预测涨幅表 | iPhone_Pro/ProMax 分列并滚动为 19 世代口径（11.1%/10.0%） |
| 近期重大价格事件 | 新增"2026-09-10 三因叠加"条目 |
| 时变实证点 | 新增"iPhone_18发布"条目（T+1周实录） |

## 四、引擎代码修改（已完成，已构建成功）

文件：`packages/apple-value-engine/src/pareto.ts`（约 584 行处）

**修复**：`IPHONE_CHIP_MAP` 补齐 ProMax 条目 + Duo：
- 新增 `'iPhone_14_ProMax': 'A16', 'iPhone_15_ProMax': 'A17_Pro', 'iPhone_16_ProMax': 'A18_Pro', 'iPhone_17_ProMax': 'A19_Pro', 'iPhone_18_ProMax': 'A20_Pro', 'iPhone_Duo': 'A20_Pro'`
- **Bug 说明**：此前 ProMax 机型回退解析到同代标准版芯片（如 17 ProMax→A19 而非 A19_Pro），性能满足度被低估约 5%
- tsc 构建已通过（TSC_EXIT=True）

**已知未修（记入 v4.7 待办⑤）**：`parseModelKey` 对 iPhone 内存硬编码 6GB（权重 0.85），实际 15 Pro 起 8GB、17-18 系 12GB 应得 1.0 权重。需按代际核实后建 IPHONE_MEMORY_MAP 并给权重表补 12GB 档。

## 五、当前卡点：6 个测试失败（下一步要做的事）

`npx vitest run`（在 packages/apple-value-engine 下）→ 6 failed | 123 passed：

1. `tests/v38-wait-candidates.test.ts`（3 失败）：用例预期 iPhone_Pro 距 2026-09 发布 ≤90 天 且 confidence=高 → shouldGenerate=true。**失败原因**：v4.7 数据已滚动（下一次预计变为 2027-09、置信度降"中"），测试夹具未同步。注意 v4.6 曾做过"夹具克隆锁定与数据滚动解耦"（见 v4.6 摘要末条），这 3 个用例疑似漏改
2. `tests/confidence-parsing.test.ts:49`（1 失败）：预期 iPhone_ProMax 置信度 'high'，现已降 'medium'
3. `tests/residual-invariant.test.ts`（2 失败）：`iPhone_15_Pro_128G_二手` 候选点与类型 B 候选找不到（undefined）——疑与 iPhone_Pro 品类数据滚动/候选生成条件变化有关

**修复方向**：按 v4.6 先例更新测试夹具到 v4.7 数据口径（克隆锁定方式），不回改数据。可参考 v4.6 当时对 confidence-parsing/v38-wait-candidates/v41-anchor-term 的改法（git log 可查）。

## 六、待办清单（按优先级）

1. **修复上述 6 个测试**（见第五节）→ 全量绿
2. `node scripts/sync-engine.mjs`（vendor 同步，pareto.ts 已改必须做）
3. `node scripts/sync-snapshot.mjs`（快照同步到 miniapp/wx/snapshot/）
4. `node scripts/publish-constants.mjs`（云端发布，可先 --dry-run；参考 agents.md §6）
5. 向用户汇报"实际价格冲击 vs 预测"结论（素材已在本文档第二节）
6. **9-18 发售后待办**（已写入 v4.7 变更摘要最后一条）：①18 Pro/ProMax 二手价与国补价回填；②16 Pro/ProMax 冲击复采；③Duo 10-23 发售后建快照品类；④基准芯片切换 A20 Pro；⑤iPhone 内存映射修复

## 七、关键文件路径速查

- 数据：`.agents/skills/apple-value-analysis/constants.json`
- 引擎源码：`packages/apple-value-engine/src/{pareto,cost,retention,release,performance}.ts`
- 测试：`packages/apple-value-engine/tests/`（15 文件 129 用例）
- 脚本：`scripts/{sync-engine,sync-snapshot,publish-constants}.mjs`
- 项目规范：`agents.md`（§6 constants 维护与云端发布流程）
- 维护 SOP：`.agents/skills/apple-value-analysis/SKILL.md`（§9.4 涨价发布三情景、§9.5 官宣未发售窗口）
