# 苹果产品价值分析与购买决策 / Apple Product Value Analysis & Purchase Decision

基于**帕累托前沿**的苹果产品量化分析技能。在「月均成本 × 持有期平均性能」平面上筛选非劣购买方案，帮你回答：买哪款、买新品还是二手、用几年最划算。

A quantitative Apple-product analysis skill based on the **Pareto frontier**. It filters non-inferior purchase options on the *monthly cost × average holding-period performance* plane, helping you answer: which model, new vs. used, and how many years to hold.

> **方法论见 [METHOD.md](METHOD.md)（中文 + English，同文件内可点击切换）。** 这是一篇独立文章，讲清楚为什么耐用品购买应该用帕累托框架，而不是「最佳推荐清单」。本 README 只描述技能的安装与使用。
>
> **The methodology lives in [METHOD.md](METHOD.md) (Chinese + English, switchable within the same file).** It is a standalone essay explaining why durable-goods purchases should use the Pareto framework rather than a "best-buy list." This README describes only how to install and use the skill.

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

完整定义见 [SKILL.md](SKILL.md)。常量数据库 constants.json 由 SKILL.md 在运行时从主仓库远程获取（见下节）。

Full definition in [SKILL.md](SKILL.md). The constants.json database is fetched at runtime from the main repo (see below).

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

---

## 安装 / Installation

```bash
npx skills add Zazia/apple-value-analysis
```

或手动克隆 / Or manually clone:

```bash
git clone https://github.com/Zazia/apple-value-analysis.git ~/.agents/skills/apple-value-analysis
```

国内用户可用 Gitee 镜像 / Users in China can use the Gitee mirror:

```bash
git clone https://gitee.com/zezia/apple-value-analysis.git ~/.agents/skills/apple-value-analysis
```

安装后，TRAE / QoderWork 等 Agent 平台会在你提到「买苹果设备」「iPhone 性价比」「持有几年划算」等场景时自动调用本技能。

After installation, agent platforms such as TRAE / QoderWork will auto-invoke this skill when you mention "buy Apple device", "iPhone value", "how many years to hold", etc.

---

## 触发场景 / Trigger Examples

```
想买个 Mac mini，预算 5000 以内，不知道用几年划算
iPhone 15 和 16 哪个值得买？用两年哪个省
手机和电脑哪个该先换
```

报告输出为自包含 HTML 文件（ECharts CDN），含帕累托前沿散点图、保值率曲线图、各机型多持有期成本曲线。

The report is a self-contained HTML file (ECharts CDN), with a Pareto scatter plot, retention curves, and per-model multi-holding-period cost curves.

---

## constants.json 远程获取 / Remote Fetch of constants.json

本仓库只分发技能定义（SKILL.md），不含常量数据。技能执行时自动从主仓库获取最新 constants.json，**双源容错，Gitee 优先**：

This repo distributes only the skill definition (SKILL.md), without bundled constants. At runtime the skill auto-fetches the latest constants.json from the main repo, **dual-source with Gitee as primary**:

```
主源 / Primary (Gitee, 国内推荐 / recommended in China):
  https://gitee.com/zezia/purchase_decision_making/raw/main/.agents/skills/apple-value-analysis/constants.json
备份 / Backup (GitHub):
  https://raw.githubusercontent.com/Zazia/purchase_decision_making/main/.agents/skills/apple-value-analysis/constants.json
```

获取逻辑 / Fetch logic：检查本地 constants.json 的 `last_updated` 日期 → 距今 ≤ 7 天直接使用 / 超过 7 天从远程获取最新版覆盖 / 本地不存在则远程下载并缓存。**不依赖版本号比对**——远程 constants.json 约每周更新一次，版本号会高于本地 SKILL.md 的 SOP 版本，这是正常现象（SOP 追踪方法论，constants.json 追踪数据，两者独立演进）。远程获取时先请求 Gitee，失败自动回退 GitHub；两个源均不可达时回退本地旧版并提示数据可能过期。

Check local `last_updated` → ≤ 7 days: use as-is / > 7 days: fetch latest from remote and overwrite / missing: download and cache. **No version-number comparison** — remote constants.json updates about weekly, so its version may be higher than the local SKILL.md SOP version. This is normal: SOP tracks methodology, constants.json tracks data, and they evolve independently. Gitee is tried first, with automatic fallback to GitHub; if both are unreachable, the local older copy is used with a "data may be stale" notice.

---

## 微信小程序入口 / WeChat Mini-Program

配套微信小程序「帕累托买苹果」已上线，AppID: `wx2f00740110e78738`，类目「工具-效率」，个人主体。

A companion WeChat mini-program "帕累托买苹果" is available, AppID: `wx2f00740110e78738`, category "Tools - Productivity", personal subject.

- 5 步决策树引导（品类 → 预算 → 持有期 → 新品/二手 → 性能地板）
- 结果页帕累托散点图 + 非劣方案列表
- 方案详情完整成本分解
- 1080×1440 分享卡 + 云端扫码复现方案（30 天有效）

小程序工程源码与本地开发指南见主仓库 [`purchase_decision_making/miniapp/wx/`](https://github.com/Zazia/purchase_decision_making/tree/main/miniapp/wx)。

For mini-program source and local development guide, see the main repo [`purchase_decision_making/miniapp/wx/`](https://github.com/Zazia/purchase_decision_making/tree/main/miniapp/wx).

---

## 仓库结构 / Repository Structure

```
apple-value-analysis/
├── LICENSE                        # MIT
├── README.md                      # 本文件 / this file
├── METHOD.md                      # 方法论文章（中文 + English 双语）/ Methodology essay (bilingual)
├── SKILL.md                       # 标准操作流程 SOP v3.8（Agent Skill 标准）/ SOP v3.8
└── docs/
    └── images/                    # METHOD.md 插图 / illustrations for METHOD.md
```

这是一个**轻量分发仓库**，只包含技能定义文件（SKILL.md + 方法论）。常量数据库 constants.json、TS 引擎源码、微信小程序工程都在主仓库 [`purchase_decision_making`](https://github.com/Zazia/purchase_decision_making) 维护。

This is a **thin distribution repo** containing only the skill definition (SKILL.md + methodology essay). The constants database, TS engine source, and WeChat mini-program are maintained in the main repo [`purchase_decision_making`](https://github.com/Zazia/purchase_decision_making).

---

## 数据来源 / Data Sources

constants.json 数据来源（详见主仓库 README）/ Data sources for constants.json (see main repo README for details):

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

## 版本 / Version

当前 SOP 为 **v3.8**（2026-08-02）。SOP（方法论）与 constants.json（数据）版本号**独立演进**：SOP 仅在流程/公式/规则变更时升级，constants.json 随数据更新（约每周一次）递增，版本号可能高于 SOP 版本。只要 SOP 定义的字段结构在 constants.json 中存在，两者即可正常协同。

Current SOP is **v3.8** (2026-08-02). SOP (methodology) and constants.json (data) **evolve independently**: SOP bumps only on changes to process/formula/rules; constants.json bumps on data updates (about weekly) and may run ahead of the SOP version. As long as the field structure defined by the SOP exists in constants.json, the two work together.

---

## License

[MIT](https://opensource.org/licenses/MIT)（本仓库 SKILL.md / README.md / METHOD.md）。

运行时从主仓库远程获取的 constants.json 数据采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 许可证，详见主仓库 [purchase_decision_making](https://github.com/Zazia/purchase_decision_making) 的 LICENSE 文件。

The files in this repo (SKILL.md / README.md / METHOD.md) are MIT-licensed. The constants.json data fetched at runtime from the main repo is licensed under CC BY-NC 4.0; see the main repo [purchase_decision_making](https://github.com/Zazia/purchase_decision_making) LICENSE for details.
