## Context

仓库当前是单 skill 形态：`.agents/skills/apple-value-analysis/` 下的 `SKILL.md`（SOP v3.8）+ `constants.json`（~155KB）由 AI Agent 直接执行。`BRAINSTORM.md` 已确定要做微信小程序化，并把帕累托方法论做成「苹果购买决策的引用标准」，但路径选择、MVP 策略、平台覆盖、主体类型在提案前均未收敛。

约束：
- 维护者时间 5–10h/周
- 现有 skill 必须继续可用，不因引擎抽离而中断
- 主体已定为个人主体 + 无商业化（见 proposal）
- 双仓库同步（GitHub + Gitee）不变
- 数据协议 CC BY-NC 4.0，代码协议需与之兼容

利益相关：
- 维护者本人：内容生产 + 数据更新 + 引擎/小程序迭代
- skill 用户（Agent 平台）：依赖 constants.json 远程获取不变
- 未来小程序用户：依赖分享卡裂变进入

## Goals / Non-Goals

**Goals:**
- 把 constants.json 访问 + 帕累托算法抽成 TS 引擎，skill 与小程序共用同一份逻辑
- 微信原生小程序 MVP 上线：决策树表单 + 引擎计算 + 帕累托图 + 分享卡
- 数据用打包快照月更，不引入云开发计费项
- 个人主体约束固化为产品行为契约，明确「不做」清单
- 引擎抽离后 skill 对外行为零变化（用户无感）

**Non-Goals:**
- 不做微信云开发（M2 范围）
- 不做用户上传真实成交价（M3 范围）
- 不做多品类「先换哪个」对比（M4 范围）
- 不做 LLM 顾问入口（M3 范围）
- 不做跨端（Taro/uni-app/抖音/支付宝/京东）（引擎稳定后单独提案）
- 不做付费、不挂分销、不申请电商类目（受个人主体约束）
- 不重写 `METHOD.md` / `METHOD_EN.md`（小程序文案需对齐其表述，但文件本身不变）

## Decisions

### D1. Monorepo 结构

```
purchase_decision_making/
├── packages/
│   └── apple-value-engine/        # TS 引擎 npm 包
│       ├── src/
│       │   ├── data/              # constants.json 类型定义与访问层
│       │   ├── pareto/            # 帕累托前沿算法
│       │   ├── cost/              # 月均成本、保值率插值、性能满足度
│       │   └── index.ts
│       ├── tests/                 # 单测（Vitest）
│       └── package.json
├── miniapp/
│   └── wx/                        # 微信原生小程序工程
│       ├── pages/
│       │   ├── decision-tree/     # 决策树表单页
│       │   ├── result/            # 结果页（帕累托图 + 推荐区间）
│       │   └── share-card/        # 分享卡预览/生成页
│       ├── components/
│       │   ├── pareto-chart/      # ec-canvas 帕累托图组件
│       │   └── share-card-canvas/ # canvas 2d 离屏渲染组件
│       ├── engine-bridge/         # 引擎适配层（数据注入 + 调用包装）
│       ├── snapshot/              # constants.json 月更快照（打包进版本）
│       ├── app.json
│       └── project.config.json
├── .agents/skills/apple-value-analysis/   # 现有 skill，改为引用引擎
├── METHOD.md / METHOD_EN.md       # 不变
└── README.md
```

**为什么 monorepo 而非独立仓库**：5–10h/周 不足以维护两个仓库的 CI/同步；引擎与 constants.json 强耦合（数据结构变更需同步改引擎），同仓库改一次提交一次。

**备选**：引擎独立仓库 `apple-value-engine` + 此仓库作为依赖方。否决理由：constants.json 在本仓库，引擎单测需要 fixtures，跨仓库维护成本翻倍。

### D2. 引擎 API 设计：数据注入而非内嵌

引擎不内嵌 constants.json，调用方注入：

```ts
import { loadConstants, computeParetoFrontier, type Constants } from 'apple-value-engine';

const constants: Constants = loadConstants(jsonText);  // 解析+校验
const frontier = computeParetoFrontier(constants, {
  category: 'mac-mini',
  budget: 5000,
  holdingYears: [2, 3, 4],
  buyTiming: 'used',
  performanceFloor: 0.7,
});
```

**为什么注入而非内嵌**：
- skill 走远程获取 constants.json（已实现），引擎内嵌会绑定数据版本
- 小程序走打包快照，引擎内嵌会撑大包体且无法月更
- B 端 API 未来走实时数据，引擎内嵌会阻塞数据流
- 引擎只负责「给定数据 + 参数 → 计算结果」，无副作用，易测

**备选 A**：引擎内嵌一份默认 constants.json，调用方可覆盖。否决理由：默认数据会过期，用户不知情时用了旧数据，违背「数据透明」原则。
**备选 B**：引擎发 npm 包，constants.json 由调用方自行 fetch。否决理由：增加调用方负担，skill 现有远程获取逻辑要重写。

### D3. 引擎从 skill 抽离的方式：算法移植，不调用 skill

引擎是 TS 重写，不是 shell-out 到 skill。`SKILL.md` 的算法描述作为实现参考（保值率插值、性能满足度公式、宏观因子调整、冲击时变曲线、缺货等待期模型）。

**为什么重写而非包装**：
- skill 是给 Agent 执行的 SOP，不是可直接调用的代码
- 小程序不能在运行时调用 Agent
- TS 重写后可单测，保证 skill 与小程序结果一致

**一致性保证**：引擎单测 fixtures 来自 skill 历史报告（已产出的 HTML 报告里的帕累托点），相同输入必须产出相同前沿。

### D4. 小程序架构：原生 + ec-canvas 静态渲染 + canvas 2d 分享卡

- 决策树表单：原生 `<view>` + `<radio-group>`，5 步单选 + 「不确定」选项
- 帕累托图：`ec-canvas` 组件，**关闭 tooltip/缩放交互**，静态散点图 + 前沿高亮 + 推荐区间着色；点击点位跳详情页（页内展示该方案完整成本分解）
- 分享卡：`<canvas type="2d">` 离屏渲染 1080×1440，绘制用户预算/推荐方案/前沿缩略图/小程序码 → `wx.canvasToTempFilePath` → `onShareAppMessage` 配 `imageUrl`

**为什么原生而非 Taro/uni-app**：
- MVP 只覆盖微信，跨端框架适配成本（生命周期差异、ec-canvas 在 Taro 下的二次封装）≥ 重写成本
- 引擎抽离后，跨端只是「换皮肤」，留到引擎稳定后做更划算

**为什么 ec-canvas 关闭交互**：BRAINSTORM 第七节已预警，小程序 ec-canvas 的 tooltip/缩放体验降级。静态图 + 跳详情页是更可控的体验，也符合「结论先行」的方法论。

**备选**：用原生 `<canvas>` 自绘散点图。否决理由：ECharts 的坐标轴/图例/着色逻辑自研 2 周起，5–10h/周 投不起。

### D5. 数据快照机制：打包进版本号，月更

`miniapp/wx/snapshot/constants.json` 是 `.agents/skills/apple-value-analysis/constants.json` 的副本，每次小程序发版前同步。快照含 `last_updated` 字段，结果页底部显示「数据更新于 YYYY-MM-DD」。

**过期提示策略**：
- `last_updated` 距今 ≤ 35 天：无提示
- 35–60 天：结果页底部黄色提示「数据已 N 天未更新，下次发版将刷新」
- > 60 天：红色提示「数据较旧，建议查看 GitHub 最新版」

**为什么 35 天阈值**：月更节奏 + 2 周发版缓冲。避免一过 30 天就报警，给维护者留缓冲。

**不引入云开发**：MVP 阶段省去云函数计费、IAM、定时任务运维。月更对用户足够（保值率年度更新、价格快照按需更新，月粒度已远超精度需求）。

### D6. skill 与引擎的关系：skill 改为引用引擎，对外行为不变

skill 的 `SKILL.md` 仍然是给 Agent 看的 SOP，但执行帕累托计算的部分改为：
- Agent 仍可远程获取 constants.json（现有逻辑保留）
- 当 Agent 环境支持 npm 时，优先调用 `apple-value-engine` 包
- 不支持时回退到 SOP 文字描述的计算步骤（Agent 自行执行）

**为什么保留 SOP 文字描述**：并非所有 Agent 平台都能调用 npm 包。SOP 文字是「人也能看懂的算法说明」，是 `METHOD.md` 的工程化版本，独立于引擎存在。

### D7. 个人主体约束的产品行为契约

硬约束（永不实现，除非主体变更）：
- 不接入微信支付
- 不申请电商类目
- 不挂京东联盟/拼多多多客分销链接
- 不提供付费功能、订阅、会员
- 不在分享卡/结果页出现「推荐购买」「下单」「立即购买」等导购字样
- 不在结果页挂任何外部购买链接

软约束（MVP 不做，未来主体变更后可解锁）：
- B 端工具订阅、数据 API（BRAINSTORM 第四节 B 端层与数据产品层）

**字样替代清单**：
| 禁用 | 替代 |
|---|---|
| 推荐购买 | 推荐方案 / 非劣方案 |
| 立即下单 | 查看方案详情 |
| 最低价 | 月均成本最低 |
| 性价比之王 | 前沿上的方案 |

**为什么把约束写进 design 而非仅在 proposal**：约束会指导 UI 文案、分享卡设计、结果页结构的每一处细节，是设计层面的硬边界，不是商业策略层面的可选项。

### D8. 跨端推迟到引擎稳定之后

MVP 阶段只做微信原生。引擎抽离完成后，跨端的成本主要在 UI 层重写（决策树表单 + 帕累托图组件 + 分享卡 canvas），引擎层零改动。

**触发条件**（满足任一即启动跨端提案）：
- 微信小程序 DAU ≥ 500 且分享卡裂变新增占比 ≥ 30%
- 抖音内容主阵地产出 3 篇以上挂小程序卡的内容
- 引擎 API 稳定 3 个月无 breaking change

## Risks / Trade-offs

- **[ec-canvas 性能不达预期]** → 帕累托图点位数量上限 50（候选方案数），单页静态渲染；如仍卡顿，降级为 PNG 服务端预渲染（M2 云函数生成）。
- **[个人主体类目审核被拒]** → 优先注册「工具-效率」类目（个人主体可办），避免「电商」「导购」类目；首次提审时小程序内零外链、零购买入口。
- **[主体迁移不可逆，未来商业化需推倒重来]** → 接受。MVP 阶段的目的是验证飞轮与影响力建设，不是商业化；用户与分享记录归零的代价 < 个体工商户维护成本 × 12 个月 + 个人主体阶段错过的内容生产时间。
- **[constants.json 体积 ~155KB 撑大小程序包]** → 微信小程序主包上限 2MB，155KB 占比 < 8%，可接受；如未来数据膨胀超过 500KB，拆分到分包。
- **[引擎抽离后 skill 行为漂移]** → 引擎单测 fixtures 来自 skill 历史报告，CI 跑同输入同输出断言；skill 每次发版前手动跑一次对比报告。
- **[分享卡生成在小程序端 canvas 2d 性能不稳]** → 离屏 canvas 提前渲染，用户点「生成分享卡」时仅做 `canvasToTempFilePath`，绘制已就绪；最差情况降级为「截图保存」引导。
- **[引擎发不发 npm 公开包未定]** → 见 Open Questions。MVP 阶段以 workspace 协议（`"apple-value-engine": "workspace:*"`）本地引用，发包决策推迟。
- **[METHOD.md 与小程序文案表述漂移]** → 小程序结果页文案 PR 必须交叉检查 METHOD.md 术语表；引擎返回字段名与 METHOD.md 公式符号对齐。

## Migration Plan

**部署步骤**：
1. 引擎抽离：在 `packages/apple-value-engine/` 实现 + 单测全绿，skill 暂不动
2. skill 切换：SKILL.md 增加引擎调用说明，保留 SOP 文字回退路径，验证 Agent 两种路径输出一致
3. 小程序工程搭建：`miniapp/wx/` 初始化，引入引擎（workspace 协议）
4. 决策树 + 结果页 + 帕累托图开发
5. 分享卡模块开发
6. 数据快照同步脚本 + 过期提示逻辑
7. 个人主体小程序注册 + 类目选择 + 提审
8. 上线 + 第一篇内容带小程序卡

**回滚策略**：
- 引擎抽离阶段：skill 行为不变，引擎出问题不影响 skill，无需回滚
- skill 切换阶段：保留 SOP 文字回退路径，引擎异常时 Agent 自动走文字路径
- 小程序阶段：分页面提审，单页问题单页回滚（小程序支持版本回退）

## Open Questions

- [ ] 引擎是否发 npm 公开包？影响 skill 远程引用方式（npm install vs git submodule vs 直接复制 dist）。MVP 阶段先用 workspace，发包决策推迟到引擎稳定 1 个月后。
- [ ] 小程序名称与 AppID 是否已注册？需维护者确认。
- [ ] 分享卡设计 token 是否复用 `constants.json` 里的 `design_tokens` 字段？倾向复用，但需确认该字段结构是否适配小程序 canvas 2d 的样式模型。
- [ ] 决策树「不确定」分支在 MVP 阶段如何兜底？倾向显示「请稍后访问，AI 顾问功能开发中」，不阻塞主路径。
- [ ] constants.json 同步到小程序快照的脚本是用 Node 还是 Python（uv）？倾向 Node（与引擎同栈），但仓库现有工具链是 Python。
