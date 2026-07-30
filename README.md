# 苹果产品价值分析与购买决策

基于**帕累托前沿**的苹果产品量化分析技能。在「月均成本 × 持有期平均性能」平面上筛选非劣购买方案，帮你回答：买哪款、买新品还是二手、用几年最划算。

## 核心方法

将每个候选方案定义为 `(机型 × 持有期 × 买入时机)` 组合，在二维平面上计算帕累托前沿：

- **横轴**：月均成本（元/月）— 越低越省
- **纵轴**：持有期平均性能满足度（%）— 越高越好

前沿上的点即为非劣解：不存在「成本更低同时性能更高」的其他方案。用户偏好（性能地板 / 预算上限）仅用于在前沿上截取推荐区间，不人为设阈值分类。

```
月均成本 = (买入价 - 预期卖出残值 + 持有期预期维修成本) / 持有月数
预期卖出残值 = 调整后保值率 × 当前同品类新品价
持有期平均性能满足度 S̄(N) = [S(0) + S(N)] / 2
S(t) = S(0) / (1 + r)^(t/12)     # r: 芯片代际性能 CAGR
```

## 7 步标准流程

| 步骤 | 内容 |
|------|------|
| 1 | 确定分析范围与候选方案（机型 × 持有期 × 买入时机） |
| 2 | 宏观因素扫描与常量分级校验（绿/黄/红三级） |
| 3 | 校验市场价快照并按需更新（苹果官网直采 → 可信二手资料 → browser-use 直采 → 兜底） |
| 4 | 计算持有期平均性能满足度（含芯片代际衰减模型） |
| 5 | 计算月均成本（含持有期预期维修成本） |
| 6 | 帕累托前沿分析与决策（剔除被支配点，截取推荐区间） |
| 7 | 输出结论先行的 HTML 报告（ECharts 可视化） |

## 项目结构

```
purchase_decision_making/
├── LICENSE                        # CC BY-NC 4.0 许可证
├── README.md
├── .agents/skills/apple-value-analysis/
│   ├── SKILL.md                   # 标准操作流程 (SOP v3.7, 可独立分发)
│   └── constants.json             # 常量数据库 (133KB, v3.7, 可远程获取)
└── .gitignore
```

### constants.json 数据库

技能的唯一常量数据源，包含：

- **保值率曲线**：18 个品类从发布至 60+ 月的残值率，支持线性插值与外推
- **芯片性能跑分**：Geekbench 6 多核跑分，M 系列 / A 系列
- **性能满足度公式**：芯片性能系数 × 内存权重 × 存储权重
- **代际提升假设**：M 系列 CAGR 17%/年，A 系列 15%/年
- **发布节奏**：各品类系统支持月数与下一次预计发布
- **维修成本**：电池更换费用、年均故障维修费用（按品类）
- **实时市场价快照**：已搜索的真实交易渠道价格，按分级规则校验更新
- **新品发布冲击**：老款贬值幅度、同档同价假设
- **design_tokens**：报告视觉规范与 ECharts 图表模板

覆盖品类：iPhone、iPad、MacBook、Mac mini、Apple Watch、AirPods、Vision Pro。

## 数据来源

- SellMacBook 设备贬值指南
- SellCell 二手残值指数
- RefurbMe 全系翻新价追踪
- 什么值得买历史保值率统计
- Geekbench 6 跑分数据库
- Apple 官方系统支持政策页

## 如何使用

本技能面向 TRAE / QoderWork 等 AI Agent 平台。将 `.agents/skills/apple-value-analysis/` 目录放入技能路径后，Agent 在以下场景自动调用：

- 想买苹果设备，需要决策买哪款 / 新品还是二手 / 用几年
- 对比各代机型或不同持有期的性价比、月均成本、保值率
- 多品类纠结「先换哪个」
- 给出预算 + 品类，要求推荐最划算方案

触发示例：

```
想买个 Mac mini，预算 5000 以内，不知道用几年划算
iPhone 15 和 16 哪个值得买？用两年哪个省
手机和电脑哪个该先换
```

报告输出为自包含 HTML 文件（ECharts CDN），含帕累托前沿散点图、保值率曲线图、各机型多持有期成本曲线。

## constants.json 远程获取

SKILL.md 可**独立分发**，无需附带 constants.json。技能执行时自动从远程仓库获取最新数据，**双源容错，Gitee 优先**：

```
主源(Gitee,国内推荐): https://gitee.com/zezia/purchase_decision_making/raw/main/.agents/skills/apple-value-analysis/constants.json
备份(GitHub):          https://raw.githubusercontent.com/Zazia/purchase_decision_making/main/.agents/skills/apple-value-analysis/constants.json
```

获取逻辑：检查本地 constants.json 的 `last_updated` 日期 → 距今 ≤ 7 天直接使用 / 超过 7 天从远程获取最新版覆盖 / 本地不存在则远程下载并缓存。**不依赖版本号比对**——远程 constants.json 约每周更新一次，版本号会高于本地 SKILL.md 的 SOP 版本，这是正常现象（SOP 追踪方法论，constants.json 追踪数据，两者独立演进）。远程获取时先请求 Gitee，失败自动回退 GitHub；两个源均不可达时回退本地旧版并提示数据可能过期。数据维护集中在远程仓库进行，各分析节点的快照更新由维护者定期合并。

## 双仓库同步

本项目同时托管在 Gitee 和 GitHub，内容保持同步。维护策略如下：

**当前方案：本地双 remote 手动推送**

```bash
# 查看远程配置
git remote -v
# origin  → GitHub (https://github.com/Zazia/purchase_decision_making.git)
# gitee   → Gitee  (https://gitee.com/zezia/purchase_decision_making.git)

# 每次提交后同时推送两个远程
git push origin main && git push gitee main
```

也可用一条命令同时推送（配置 `push.default` 后）：
```bash
git push all main
# 需先配置: git remote add all https://github.com/Zazia/purchase_decision_making.git
#           git remote set-url --add --push all https://github.com/Zazia/purchase_decision_making.git
#           git remote set-url --add --push all https://gitee.com/zezia/purchase_decision_making.git
```

**备选方案：Gitee 自动镜像 GitHub**

Gitee 内置「强制同步」功能，可在仓库设置中绑定 GitHub 仓库，一键或定时从 GitHub 拉取。此方式下只需维护 GitHub，Gitee 自动跟进，但同步有延迟（通常几分钟内）。

## 版本

当前 SOP 为 **v3.7**（2026-07-29）。SOP（方法论）与 constants.json（数据）版本号**独立演进**：SOP 仅在流程/公式/规则变更时升级，constants.json 随数据更新（约每周一次）递增，版本号可能高于 SOP 版本。只要 SOP 定义的字段结构在 constants.json 中存在，两者即可正常协同。

- 保值率曲线：每年 1 月更新
- 芯片跑分：新芯片发布后更新
- 发布节奏：苹果官宣后更新
- 市场价快照：按分级规则按需更新（≤14 天免更新 / 15-30 天轻校验 / >30 天全更新）

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（署名-非商业性使用 4.0 国际）。任何人可自由复制、分发、修改本项目，但不得用于商业目的，且必须保留原作者署名。详见 [LICENSE](LICENSE) 文件。
