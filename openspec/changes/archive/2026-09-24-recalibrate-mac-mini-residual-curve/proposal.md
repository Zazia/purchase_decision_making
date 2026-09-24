## Why

Mac mini M4 与 M2 的二手价格已由用户跨多次观察确认长期稳定在 v4.5 快照区间，但现行曲线在约 23 月和 44 月机龄仍分别出现约 -11pp 与分配置 -15pp 至 +2pp 的系统偏差。现在需要把已确认的耐久市场中枢纳入曲线，避免残值和月均成本继续沿用偏高估计。

## What Changes

- 将 Mac mini 曲线的 18、24、36、48 月节点重新校准到长期稳定样本中枢，保持 0–12 月、60 月节点及 60 月后半衰期外推不变。
- 将用户多次观察确认记入 Mac mini 市场快照与曲线修订溯源，更新 constants 元数据版本和日期。
- 增加曲线节点、单调性、关键机龄拟合误差与外推边界测试。
- 重新生成残值曲线分析数据和 HTML 报告，展示 v4.5 与新曲线的前后偏差。
- 同步小程序本地 constants 快照，并按标准流程发布和复核云端 constants。
- 将本次分析事实与运行产物统一放入 `scripts/debug/`，不在仓库根目录新增分析中间文件。

## Capabilities

### New Capabilities
- `residual-curve-calibration`: 规定基于耐久二手市场样本校准品类残值曲线、验证拟合质量并同步分发的要求。

### Modified Capabilities

无。

## Impact

- 数据源：`.agents/skills/apple-value-analysis/constants.json`
- 测试：constants/残值曲线相关数据完整性测试
- 报告：`scripts/visualize-residual-curves.mjs`、`scripts/debug/residual-curves-payload.json` 与根目录残值曲线 HTML 成品
- 分发：`miniapp/wx/snapshot/constants.json` 与云数据库 `constants/latest`
- 文档与审计：本 OpenSpec 变更、`scripts/debug/analysis-facts.md`
