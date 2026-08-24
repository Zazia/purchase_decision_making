# 苹果产品价值分析与购买决策 / Apple Product Value Analysis & Purchase Decision

基于**帕累托前沿**的苹果产品量化分析技能。在「月均成本 × 持有期平均性能」平面上筛选非劣购买方案，帮你回答：买哪款、买新品还是二手、用几年最划算。

A quantitative Apple-product analysis skill based on the **Pareto frontier**. It filters non-inferior purchase options on the *monthly cost × average holding-period performance* plane, helping you answer: which model, new vs. used, and how many years to hold.

> **方法论见 [METHOD.md](METHOD.md)（中文 + English）。** 这是一篇独立文章，讲清楚为什么耐用品购买应该用帕累托框架，而不是「最佳推荐清单」。本 README 只描述技能的工程实现。**完整框架见 [paretopurchase.com](HTTPS://paretopurchase.com)。**
>
> **The methodology lives in [METHOD.md](METHOD.md) (Chinese + English).** It is a standalone essay explaining why durable-goods purchases should use the Pareto framework rather than a "best-buy list." This README describes only the engineering implementation of the skill. **For the whole picture please refer to [paretopurchase.com](HTTPS://paretopurchase.com).**

---

## 核心方法 / Core Method

将每个候选方案定义为 `(机型 × 持有期 × 买入时机)` 组合，在二维平面上计算帕累托前沿：

Each candidate option is defined as a `(model × holding period × buy timing)` tuple, and the Pareto frontier is computed on a 2D plane:

- **横轴 / x-axis**：月均成本（元/月）— 越低越省 / Monthly cost (¥/month) — lower is better
- **纵轴 / y-axis**：持有期平均性能满足度（%）— 越高越好 / Average holding-period performance satisfaction (%) — higher is better

前沿上的点即为非劣解：不存在「成本更低同时性能更高」的其他方案。用户偏好（性能地板 / 预算上限）仅用于在前沿上截取推荐区间，不人为设阈值分类。

Points on the frontier are non-inferior: no other option is simultaneously cheaper and higher-performance. User preferences (performance floor / budget cap) are only used to slice a recommendation range along the frontier — no arbitrary thresholds are imposed.

```
月均成本 = (买入价 - 预期卖出残值 + 持有期预期维修成本) / 持有月数
预期卖出残值 = 调整后保值率 × 当前同品类新品价
持有期平均性能满足度 S̄(N) = [S(0) + S(N)] / 2
S(t) = S(0) / (1 + r)^(t/12)     # r: 芯片代际性能 CAGR

Monthly cost = (Purchase price − Expected residual + Holding-period maintenance) / Holding months
Expected residual = Adjusted retention rate × Current new-good price of the same category
Avg. performance satisfaction S̄(N) = [S(0) + S(N)] / 2
S(t) = S(0) / (1 + r)^(t/12)     # r: chip generational performance CAGR
```

代际性能 CAGR（v3.8 实测更新）：M 系列 `r = 0.16`/年（基于 M1→M5 实测跑分重算，原 v3.7 为 0.17），A 系列 `r = 0.15`/年。

Generational performance CAGR (updated with v3.8 measured scores): M-series `r = 0.16`/yr (recomputed from M1→M5 measured scores; v3.7 used 0.17), A-series `r = 0.15`/yr.

---

## 7 步标准流程 / 7-Step Standard Procedure

| 步骤 / Step | 内容 / Content |
|------|------|
| 1 | 确定分析范围与候选方案（机型 × 持有期 × 买入时机）/ Scope & candidates (model × holding period × buy timing) |
| 2 | 宏观因素分层扫描与常量分级校验（绿/黄/红三级）/ Layered macro scan & tiered constants check (green/yellow/red) |
| 3 | 校验市场价快照并按需更新（苹果官网直采 → 可信二手资料 → browser-use 直采 → 兜底）/ Verify market-price snapshot, update as needed (Apple official → trusted used-market sources → browser-use direct → fallback) |
| 4 | 计算持有期平均性能满足度（含芯片代际衰减与跃升识别模型）/ Compute average holding-period performance (chip generational decay + leap-generation model) |
| 5 | 计算月均成本（含维修成本、宏观因子调整、冲击时变因子）/ Compute monthly cost (maintenance, macro-factor adjustment, time-varying impact factor) |
| 6 | 帕累托前沿分析与决策（剔除被支配点，截取推荐区间）/ Pareto frontier analysis & decision (drop dominated points, slice recommendation range) |
| 7 | 输出结论先行的 HTML 报告（ECharts 可视化）/ Conclusion-first HTML report (ECharts visualization) |

---

## v3.8 新增机制 / What v3.8 Adds

v3.8 引入「宏观因素扩展模型」，把宏观扫描结果通过传导链接入价格预测、冲击调整、缺货延迟：

v3.8 introduces a *Macro-Factor Extended Model* that links macro-scan results through a transmission chain into price prediction, impact adjustment, and stockout delay:

- **分层宏观扫描 / Layered macro scan**：L1 必扫层（涨价/存储/路线图）→ L2 存储超级周期层 → L3 BOM 成本层 → L4 产能与缺货层
- **新品价格预测模型 / New-product price-prediction model**：替代静态「同档同价假设」。检测到全线涨价 / 存储超级周期时启用，对未发布新品按预测涨幅外推
- **冲击时变曲线 / Time-varying impact curve**：原 v3.7 的单一 50% 因子改为分时点表（1月/3月/6月/12月/12月后）
- **缺货等待期模型 / Stockout-delay model**：分品类上市到货延迟 × 宏观产能因子（存储超级周期进行中 = 2.0）
- **发布时间预测校验 / Release-time prediction check**：若搜索结果偏离预测 ≥ 1 季度，标注类型 B/C 方案置信度降级
- **代际跃升识别 / Leap-generation detection**：M 系列 / A 系列 per-generation 详表，节点首发代际下调 r×0.5，跃升代际上调 r×1.5

完整定义见 [`.agents/skills/apple-value-analysis/SKILL.md`](.agents/skills/apple-value-analysis/SKILL.md) 与 [`constants.json`](.agents/skills/apple-value-analysis/constants.json)。

---

## 项目结构 / Project Structure

```
purchase_decision_making/
├── agents.md                      # Agent 协作约定（任务前必读）/ Agent conventions (read first)
├── design.md                      # 视觉规范分层入口 → .design_library/ / Design-token entry
├── README.md                      # 本文件 / this file
├── STANCE.md                      # 独立性声明 / Independence stance
├── METHOD.md                      # 方法论文章（中文 + English 双语）/ Methodology essay (bilingual)
├── .agents/skills/
│   ├── apple-value-analysis/      # 核心 SOP 技能 / Core skill
│   │   ├── SKILL.md               # 标准操作流程 SOP v3.8（可独立分发）/ SOP v3.8 (independently distributable)
│   │   └── constants.json         # 常量数据库 ~155KB v3.8（可远程获取）/ Constants DB ~155KB v3.8 (remote-fetchable)
│   └── wx-miniprogram-autotest/   # 小程序自动化调试 SOP / Mini-program E2E autotest SOP
├── .agent/ · .trae/               # OpenSpec CLI 生成的技能与命令（勿手改）/ Generated by openspec CLI (do not edit)
├── packages/
│   └── apple-value-engine/        # TS 引擎包（帕累托前沿计算）/ TS engine (Pareto computation)
│       ├── src/                   # 源码（保值率/性能/成本/帕累托）/ source
│       └── tests/                 # 一致性单测（vitest）/ consistency tests
├── miniapp/
│   ├── wx/                        # 微信原生小程序工程 / WeChat native mini-program
│   │   ├── pages/                 # 决策树/结果/详情/分享卡/报告/已保存列表 / decision-tree/result/detail/share-card/report/saved-list
│   │   ├── components/            # 帕累托图/分享卡canvas / pareto-chart/share-card-canvas
│   │   ├── cloudfunctions/        # 云函数 / Cloud functions
│   │   │   └── share-result/      # 分享结果保存/读取/小程序码生成 / share-result save/get/qrcode
│   │   ├── engine-bridge/         # 引擎适配层 / engine adapter
│   │   ├── services/              # 本地缓存服务 / local cache service (saved-results)
│   │   ├── snapshot/              # constants.json 月更快照 / monthly snapshot
│   │   └── project.config.json    # AppID: wx2f00740110e78738
│   ├── test/                      # miniprogram-automator 端到端测试（独立 npm 工程）/ E2E tests (standalone npm project)
│   └── AUTOTEST-GUIDE.md · AUTOTEST-LESSONS.md   # 自动化调试指南与踩坑记录 / autotest guide & lessons
├── product-tour/                  # HyperFrames 产品介绍视频工程 / product-intro video project
│   ├── compositions/              # 分镜场景 HTML / scene compositions
│   ├── assets/                    # 截图/音频/logo（入库）/ screenshots & audio (tracked)
│   └── renders/ · .thumbnails/    # 渲染产物（本地不入库）/ render outputs (local only)
├── openspec/                      # spec-driven 变更管理 / spec-driven change management
│   ├── specs/                     # 主规格（能力级）/ main capability specs
│   └── changes/ → archive/        # 进行中变更 → 完成归档 / active changes → archive
├── scripts/                       # 数据维护与同步脚本 / data-maintenance & sync scripts
│   └── hooks/pre-commit           # constants.json 变更自动同步小程序快照 / auto-sync snapshot on commit
├── docs/                          # METHOD.md 配图 + 保值率验证报告 / essay figures + retention validation
├── test-results/                  # 本地测试与验证产物（不入库）/ local test artifacts (untracked)
└── .gitignore
```

### constants.json 数据库 / Constants Database

技能的唯一常量数据源，包含 / The skill's single source of constants, including:

- **保值率曲线 / Retention curves**：18 个品类从发布至 60+ 月的残值率，支持线性插值与外推
- **芯片性能跑分 / Chip benchmarks**：Geekbench 6 多核跑分（v3.8 已用 M5/M5 Pro/M5 Max 实测值替换预测值）
- **性能满足度公式 / Performance formula**：芯片性能系数 × 内存权重 × 存储权重
- **代际提升假设 / Generational growth**：M 系列 CAGR 16%/年，A 系列 15%/年（含 per-generation 详表与跃升识别）
- **发布节奏 / Release rhythm**：各品类系统支持月数、下一次预计发布、缺货等待期模型、发布时间预测校验
- **维修成本 / Maintenance**：电池更换费用、年均故障维修费用（按品类）
- **实时市场价快照 / Live market-price snapshot**：已搜索的真实交易渠道价格，按分级规则校验更新
- **新品发布冲击 / New-release impact**：老款贬值幅度、宏观因子调整、冲击时变曲线、新品价格预测模型
- **宏观因素扩展模型 / Macro extended model**：分层扫描框架 + 周期阶段判定 + 价格传导链路
- **design_tokens**：报告视觉规范与 ECharts 图表模板

覆盖品类 / Categories covered: iPhone、iPad、MacBook、Mac mini、Mac Studio、iMac、Mac Pro、Apple Watch、AirPods、Vision Pro。

---

## 数据来源 / Data Sources

- SellMacBook 设备贬值指南 / device depreciation guide
- SellCell 二手残值指数 / resale index
- RefurbMe 全系翻新价追踪 / refurbished-price tracker
- 什么值得买历史保值率统计 / historical retention stats
- Geekbench 6 跑分数据库 / benchmark database
- Apple 官方系统支持政策页 / official support policy page
- TrendForce 存储芯片市场报告（2026-01~07）/ memory market reports
- Gartner 半导体市场预测（2026-04）/ semiconductor market forecast
- MacRumors M5 实测跑分首测（2026-03-05）/ M5 measured-score first test
- Notebookcheck M5 Pro/Max CPU 分析（2026-03）/ M5 Pro/Max CPU analysis
- Bloomberg / Mark Gurman 苹果路线图（2026）/ Apple roadmap
- TechInsights / Counterpoint iPhone 18 Pro BOM 分析（2026-07）/ BOM analysis

---

## 如何使用 / How to Use

本技能面向 TRAE / QoderWork 等 AI Agent 平台。将 `.agents/skills/apple-value-analysis/` 目录放入技能路径后，Agent 在以下场景自动调用：

This skill targets AI-agent platforms such as TRAE / QoderWork. After placing `.agents/skills/apple-value-analysis/` in the skill path, the agent is auto-invoked for:

- 想买苹果设备，需要决策买哪款 / 新品还是二手 / 用几年 / Deciding which Apple device to buy, new vs. used, how many years
- 对比各代机型或不同持有期的性价比、月均成本、保值率 / Comparing models or holding periods on cost, monthly expense, retention
- 多品类纠结「先换哪个」/ "Which one should I replace first" across categories
- 给出预算 + 品类，要求推荐最划算方案 / "Given budget + category, recommend the best value"

触发示例 / Trigger examples:

```
想买个 Mac mini，预算 5000 以内，不知道用几年划算
iPhone 15 和 16 哪个值得买？用两年哪个省
手机和电脑哪个该先换
```

报告输出为自包含 HTML 文件（ECharts CDN），含帕累托前沿散点图、保值率曲线图、各机型多持有期成本曲线。

The report is a self-contained HTML file (ECharts CDN), with a Pareto scatter plot, retention curves, and per-model multi-holding-period cost curves.

---

## 根仓库本地开发 / Root-Workspace Development

根 workspace（`packages/*` + `miniapp/wx` + 维护脚本）统一使用 **pnpm**（`package.json` 已通过 `packageManager` 字段声明，请勿在根目录用 npm 生成 `package-lock.json`）。

The root workspace (`packages/*` + `miniapp/wx` + maintenance scripts) uses **pnpm** exclusively (declared via the `packageManager` field; do not run npm at the root, which would create a stale `package-lock.json`).

```bash
corepack enable            # 启用 packageManager 声明的 pnpm / enable pnpm via corepack
pnpm install               # 安装全部 workspace 依赖 / install all workspace deps
pnpm test                  # 引擎一致性单测（vitest）/ engine consistency tests
pnpm build                 # 构建 packages/* / build workspaces
pnpm sync:snapshot         # constants.json → miniapp/wx/snapshot 同步 / sync mini-program snapshot
```

两个例外保持 npm（微信工具链生态）/ Two npm exceptions (WeChat toolchain):

```bash
cd miniapp/wx   && npm install   # 开发者工具「构建 npm」依赖 / for DevTools "build npm"
cd miniapp/test && npm install   # miniprogram-automator E2E 测试依赖 / E2E test deps
```

> **pre-commit 钩子 / pre-commit hook**: `core.hooksPath` 已指向 `scripts/hooks`。当 `.agents/skills/apple-value-analysis/constants.json` 被 staged 时，提交会自动执行 `sync-snapshot` 并把 `miniapp/wx/snapshot/` 一并入库——请勿用 `--no-verify` 跳过。
>
> `core.hooksPath` points to `scripts/hooks`: staging the skill's `constants.json` auto-runs `sync-snapshot` and stages `miniapp/wx/snapshot/` on commit — do not bypass with `--no-verify`.

其他工程约定（视觉规范、OpenSpec 变更流程、视频工程、仓库整洁）见 [agents.md](agents.md)。

Other engineering conventions (design tokens, OpenSpec change flow, video project, repo hygiene) live in [agents.md](agents.md).

---

## 微信小程序入口 / WeChat Mini-Program

本项目已上线微信小程序，AppID: `wx2f00740110e78738`，类目「工具-效率」，个人主体。

A WeChat mini-program is available, AppID: `wx2f00740110e78738`, category "Tools - Productivity", personal subject.

### 使用流程 / Usage Flow

1. **决策树表单 / Decision tree**: 5 步引导（品类 → 预算 → 持有期 → 新品/二手 → 性能地板），每步可选「不确定」
2. **结果页 / Result page**: 调用 `apple-value-engine` 计算帕累托前沿，结论先行展示非劣方案列表 + 散点图
3. **方案详情 / Plan detail**: 点击方案卡片查看完整成本分解（买入价/残值/维修/性能满足度）
4. **分享卡 / Share card**: 生成 1080×1440 分享图，支持保存到相册与转发
5. **保存与回看 / Save & replay**: 生成分享卡即缓存完整结果快照，首页可查看已保存列表，点击回看完整报告
6. **扫码查看方案 / Scan to view**: 分享卡上的小程序码携带云端 ID，扫码即可在他人小程序中复现同一决策方案（30 天有效）

### 技术架构 / Tech Architecture

- **引擎复用 / Engine reuse**: 小程序通过 `workspace:*` 协议引用 `apple-value-engine`，与 skill 共用同一份帕累托算法
- **数据快照 / Data snapshot**: `constants.json` 月更快照打包进小程序版本，结果页底部显示数据更新日期与时效分级
- **ec-canvas 图表 / Chart**: 静态帕累托散点图，关闭 tooltip/缩放，点击点位跳详情页
- **云开发 / Cloud development**: `share-result` 云函数提供分享结果云端存储（30 天过期）+ 小程序码生成（`wxacode.getUnlimited`），扫码即可复现方案
- **本地缓存 / Local cache**: `services/saved-results.ts` 用 `wx.setStorageSync` 保存完整结果快照（最多 20 条），支持回看与列表管理
- **个人主体合规 / Compliance**: 无支付、无外链、无导购字样，详见 [STANCE.md](STANCE.md)

### 本地开发 / Local Development

```bash
# 1. 安装依赖 / Install dependencies
cd miniapp/wx
npm install

# 2. 微信开发者工具打开 miniapp/wx/ 目录 / Open in WeChat DevTools
# 3. 工具 → 构建 npm / Tools → Build npm
# 4. 预览/真机调试 / Preview / Real device debug
```

#### 云开发配置 / Cloud Development Setup

分享卡的「展示我的方案」小程序码功能依赖微信云开发。未配置时分享卡会自动降级为文字模式（只显小程序名），不影响其他功能。

The "show my plan" QR code on the share card relies on WeChat Cloud Development. Without configuration, the share card degrades to text-only mode (showing only the mini-program name); other features are unaffected.

1. 微信开发者工具 → 云开发 → 开通，记录云环境 ID / Open Cloud Development, note the env ID
2. 云开发 → 数据库 → 新建集合 `shared_results`，权限规则设为「仅创建者可读写」/ Create collection `shared_results`, permission "only creator can read/write"
3. 编辑 [miniapp/wx/app.ts](miniapp/wx/app.ts) 的 `CLOUD_ENV` 常量为你的云环境 ID / Edit `CLOUD_ENV` in app.ts
4. 右键 `cloudfunctions/share-result` → 「上传并部署：云端安装依赖」/ Right-click `cloudfunctions/share-result` → "Upload and Deploy: Install Dependencies in Cloud"

> **云函数权限 / Cloud function permissions**: `wxacode.getUnlimited` 必须从小程序端触发调用，不能在云开发控制台直接测试（会报 `invalid wx openapi access_token`）。在小程序内点击「生成分享卡」即可触发。

> **小程序名 / Mini-program name**: 小程序端无 API 自动获取自身名称，`appName` 集中配置在 [app.ts](miniapp/wx/app.ts) 的 `globalData.appName`，审核改名后改这一处即可全局生效。

---

## constants.json 远程获取 / Remote Fetch of constants.json

SKILL.md 可**独立分发**，无需附带 constants.json。技能执行时自动从远程仓库获取最新数据，**双源容错，Gitee 优先**：

SKILL.md is **independently distributable** without bundling constants.json. At runtime the skill auto-fetches the latest data from a remote repo, **dual-source with Gitee as primary**:

```
主源 / Primary (Gitee, 国内推荐 / recommended in China):
  https://gitee.com/zezia/purchase_decision_making/raw/main/.agents/skills/apple-value-analysis/constants.json
备份 / Backup (GitHub):
  https://raw.githubusercontent.com/Zazia/purchase_decision_making/main/.agents/skills/apple-value-analysis/constants.json
```

获取逻辑 / Fetch logic：检查本地 constants.json 的 `last_updated` 日期 → 距今 ≤ 7 天直接使用 / 超过 7 天从远程获取最新版覆盖 / 本地不存在则远程下载并缓存。**不依赖版本号比对**——远程 constants.json 约每周更新一次，版本号会高于本地 SKILL.md 的 SOP 版本，这是正常现象（SOP 追踪方法论，constants.json 追踪数据，两者独立演进）。远程获取时先请求 Gitee，失败自动回退 GitHub；两个源均不可达时回退本地旧版并提示数据可能过期。

Check local `last_updated` → ≤ 7 days: use as-is / > 7 days: fetch latest from remote and overwrite / missing: download and cache. **No version-number comparison** — remote constants.json updates about weekly, so its version may be higher than the local SKILL.md SOP version. This is normal: SOP tracks methodology, constants.json tracks data, and they evolve independently. Gitee is tried first, with automatic fallback to GitHub; if both are unreachable, the local older copy is used with a "data may be stale" notice.

数据维护集中在远程仓库进行，各分析节点的快照更新由维护者定期合并。

Data maintenance is centralized in the remote repo; snapshot updates from individual analysis nodes are periodically merged by the maintainer.

---

## 双仓库同步 / Dual-Repo Sync

本项目同时托管在 Gitee 和 GitHub，内容保持同步。维护策略如下：

This project is hosted on both Gitee and GitHub and kept in sync. Maintenance strategy:

**当前方案：本地双 remote 手动推送 / Current: local dual-remote manual push**

```bash
# 查看远程配置 / Show remote config
git remote -v
# origin  → GitHub (https://github.com/Zazia/purchase_decision_making.git)
# gitee   → Gitee  (https://gitee.com/zezia/purchase_decision_making.git)

# 每次提交后同时推送两个远程 / Push to both remotes after each commit
git push origin main && git push gitee main
```

也可用一条命令同时推送（配置 `push.default` 后）/ Or push with a single command (after configuring `push.default`):

```bash
git push all main
# 需先配置 / First configure:
# git remote add all https://github.com/Zazia/purchase_decision_making.git
# git remote set-url --add --push all https://github.com/Zazia/purchase_decision_making.git
# git remote set-url --add --push all https://gitee.com/zezia/purchase_decision_making.git
```

**备选方案：Gitee 自动镜像 GitHub / Alternative: Gitee auto-mirrors GitHub**

Gitee 内置「强制同步」功能，可在仓库设置中绑定 GitHub 仓库，一键或定时从 GitHub 拉取。此方式下只需维护 GitHub，Gitee 自动跟进，但同步有延迟（通常几分钟内）。

Gitee has a built-in "force sync" feature: bind the GitHub repo in repo settings, then trigger one-click or scheduled pulls from GitHub. Only GitHub needs maintenance; Gitee follows automatically, with a sync delay (usually within minutes).

---

## 版本 / Version

当前 SOP 为 **v3.8**（2026-08-02）。SOP（方法论）与 constants.json（数据）版本号**独立演进**：SOP 仅在流程/公式/规则变更时升级，constants.json 随数据更新（约每周一次）递增，版本号可能高于 SOP 版本。只要 SOP 定义的字段结构在 constants.json 中存在，两者即可正常协同。

Current SOP is **v3.8** (2026-08-02). SOP (methodology) and constants.json (data) **evolve independently**: SOP bumps only on changes to process/formula/rules; constants.json bumps on data updates (about weekly) and may run ahead of the SOP version. As long as the field structure defined by the SOP exists in constants.json, the two work together.

更新频率 / Update frequency:

- 保值率曲线 / Retention curves: 每年 1 月 / annually in January
- 芯片跑分 / Chip benchmarks: 新芯片发布后 / on new-chip release
- 发布节奏 / Release rhythm: 苹果官宣后 / on Apple's official announcement
- 市场价快照 / Market snapshot: 按分级规则按需更新（≤14 天免更新 / 15-30 天轻校验 / >30 天全更新）/ on-demand by tier (≤14d: skip / 15–30d: light check / >30d: full update)
- 宏观因素扩展模型 / Macro extended model: 每月扫描，重大事件触发更新 / monthly scan, event-triggered updates
- 新品价格预测模型 / New-product price prediction: 涨价/发布事件触发更新 / event-triggered updates

---

## License

仓库整体（含 constants.json 数据、小程序、引擎源码、设计系统）采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（署名-非商业性使用 4.0 国际 / Attribution-NonCommercial 4.0 International）。任何人可自由复制、分发、修改本项目，但不得用于商业目的，且必须保留原作者署名。详见 [LICENSE](LICENSE) 文件。

`.agents/skills/apple-value-analysis/SKILL.md` 本身采用 [MIT](https://opensource.org/licenses/MIT)，可经瘦仓库 [Zazia/apple-value-analysis](https://github.com/Zazia/apple-value-analysis) 独立分发（含商业用途）。

The repository as a whole (constants.json data, mini-program, engine source, design system) is licensed under CC BY-NC 4.0. Anyone may freely copy, distribute, and modify this project, but not for commercial purposes, with original attribution retained. See the [LICENSE](LICENSE) file for details.

The file `.agents/skills/apple-value-analysis/SKILL.md` itself is MIT-licensed and independently distributable via the thin repo [Zazia/apple-value-analysis](https://github.com/Zazia/apple-value-analysis) (including commercial use).
