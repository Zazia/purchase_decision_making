# 独立性声明 / Independence Stance

本项目以**个人主体**运营，遵循「无商业化 + 决策框架独立性」原则。本声明是产品行为的硬边界，不是可选项。

This project operates as a **personal-subject** entity, following the "no commercialization + decision-framework independence" principle. This stance is a hard product boundary, not an option.

---

## 1. 个人主体声明 / Personal Subject Declaration

- 本项目注册为**个人主体**微信小程序，类目为「工具-效率」
- **永不接入微信支付**，不申请电商/导购类目
- **不挂京东联盟/拼多多多客/淘宝客等分销链接**
- **不提供付费功能、订阅、会员**
- 全站文案禁用「推荐购买」「立即下单」「下单」「最低价」「性价比之王」等导购字样，使用「推荐方案」「非劣方案」「查看方案详情」「月均成本最低」「前沿上的方案」替代
- 结果页与分享卡**不出现任何外部购买链接、电商 logo**

This project is registered as a **personal-subject** WeChat mini-program, category "Tools - Productivity":
- No WeChat Pay integration, no e-commerce/referral categories
- No affiliate links (JD Alliance, Pinduoduo Duoke, Taobao Affiliate)
- No paid features, subscriptions, or memberships
- Marketing language banned ("recommend to buy", "order now", "lowest price", "best value"); neutral replacements used
- No external purchase links or e-commerce logos in result page or share card

---

## 2. 决策框架独立性 / Decision-Framework Independence

帕累托前沿分析框架的算法逻辑**完全由 `apple-value-engine` 开源代码定义**，不受任何商业方影响：

The Pareto-frontier analysis algorithm is **entirely defined by the open-source `apple-value-engine` code**, with no commercial-party influence:

- **引擎算法无可被商业方影响的可调因子**：保值率插值、性能满足度公式（`S(t) = S(0)/(1+r)^(t/12)`）、月均成本计算、帕累托非劣解筛选，均为纯数学函数，无权重/偏好/人工调整参数
- **所有宏观因子来自 constants.json 可追溯字段**：存储超级周期、新品价格预测、冲击时变曲线等宏观调整因子，全部存储在 `constants.json` 的可追溯字段中（含数据来源 URL、更新日期），任何人可审查
- **CAGR 参数基于实测跑分**：M 系列 `r=0.16`、A 系列 `r=0.15` 基于 Geekbench 6 实测跑分计算，非人为设定
- **引擎代码开源**：`packages/apple-value-engine/src/` 下所有源码可审查，无黑箱

Key points:
- **No commercially adjustable factors**: retention interpolation, performance formula, cost calculation, Pareto selection are pure math functions with no weight/preference/manual-tuning parameters
- **All macro factors traceable**: storage super-cycle, price prediction, time-varying impact factors are stored in traceable `constants.json` fields (with source URL and update date)
- **CAGR parameters from measured benchmarks**: M-series `r=0.16`, A-series `r=0.15` computed from Geekbench 6 scores, not manually set
- **Engine code open-source**: all source under `packages/apple-value-engine/src/` is auditable, no black boxes

---

## 3. 商业化软约束解锁条件 / Commercialization Unlock Conditions

以下能力在个人主体阶段**永不实现**。仅在**主体类型变更**（个人 → 个体工商户/企业）后方可解锁：

The following capabilities are **never implemented** during the personal-subject phase. They may only be unlocked after a **subject-type change** (personal → business entity):

| 能力 / Capability | 解锁条件 / Unlock Condition |
|---|---|
| B 端工具订阅 / B2B subscription | 主体变更 + 企业类目审批通过 |
| 数据 API（付费）/ Data API (paid) | 主体变更 + API 计费基础设施搭建 |
| 付费会员功能 / Paid membership | 主体变更 + 微信支付接入 |
| 电商分销链接 / E-commerce affiliate links | 主体变更 + 电商类目审批 |
| 广告投放 / Ad placement | 主体变更 + 广告类目审批 |

**主体变更不可逆**：个人主体阶段积累的用户与分享记录归零的代价，小于个体工商户维护成本 × 12 个月 + 个人主体阶段错过的内容生产时间。MVP 阶段的目的不是商业化，而是验证飞轮与影响力建设。

**Subject-type change is irreversible**: the cost of losing users/sharing records from the personal phase is less than the cost of maintaining a business entity × 12 months + content-production time missed during the personal phase. The MVP goal is not commercialization, but validating the flywheel and building influence.

---

## 4. 数据透明性 / Data Transparency

- `constants.json` 采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 许可证，任何人可自由复制、审查
- 小程序打包快照为 `constants.json` 的月更副本，结果页底部显示数据更新日期与时效分级（≤35 天无提示 / 35-60 天黄色提示 / >60 天红色提示 + GitHub 链接）
- 引擎源码、SKILL.md SOP、constants.json 数据结构三者独立演进，版本号互不绑定，变更历史可通过 Git 追溯

Data transparency:
- `constants.json` under CC BY-NC 4.0, freely copyable and auditable
- Mini-program snapshot is a monthly copy; result page shows update date with freshness tiers
- Engine source, SKILL.md SOP, and constants.json data structure evolve independently; change history traceable via Git
