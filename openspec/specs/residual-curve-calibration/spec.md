# residual-curve-calibration Specification

## Purpose

规定基于耐久二手市场样本校准苹果产品残值曲线时的数据门槛、拟合验收、报告输出与分发一致性要求。

## Requirements

### Requirement: 耐久样本驱动的曲线校准
系统 SHALL 允许在用户明确确认同配置二手价格经多次、长期观察保持稳定时，将该证据作为年度窗口之外的曲线校准依据，并 MUST 在常量溯源中记录例外来源、日期和样本口径。

#### Scenario: 用户确认价格区间长期稳定
- **WHEN** 用户确认 Mac mini M4 与 M2 的同配置价格已多次观察且长期稳定在现有快照区间
- **THEN** 系统更新 Mac mini 曲线和修订溯源，而不是继续只输出“实测偏差提示”

### Requirement: Mac mini 中期曲线拟合
Mac mini 曲线 MUST 保持单调不增，并 SHALL 使用 18月=68%、24月=55%、36月=47%、48月=41% 的中期节点；0–12 月、60 月、floor 与 half-life MUST 保持 v4.5 数值不变。

#### Scenario: 关键机龄插值
- **WHEN** 对新曲线计算 23 月和 44 月的线性插值
- **THEN** 23 月理论值约为 57.17%，44 月理论值为 43%，且所有相邻节点均不递增

#### Scenario: 长期外推边界不变
- **WHEN** 计算 60 月和 69 月残值率
- **THEN** 60 月仍为 35%，69 月仍约为 31.12%，不受中期节点校准影响

### Requirement: 拟合质量回归测试
自动化测试 MUST 验证曲线节点、单调性、关键机龄拟合和长期外推，并 SHALL 保证九个现有 Mac mini 实测点的 MAE 低于 v4.5 基线。

#### Scenario: 新曲线改善样本拟合
- **WHEN** 用九个现有 Mac mini 实测点比较 v4.5 和新曲线
- **THEN** 新曲线 MAE 小于 7.75pp，且 M4 23 月偏差绝对值小于 3pp

### Requirement: 报告、快照与云端一致
曲线校准后，系统 MUST 重新生成残值曲线报告、同步小程序本地快照，并在云发布成功后验证云端版本、payload 与本地哈希一致。

#### Scenario: 完成分发
- **WHEN** constants 更新并通过测试
- **THEN** HTML 报告显示新曲线和前后拟合结论，本地快照与 constants 一致，云端检查返回相同版本和哈希

### Requirement: 调试产物目录约束
分析事实、JSON payload 和一次性运行产物 MUST 存放在 `scripts/debug/`；可交付的自包含 HTML 报告 MAY 存放在项目根目录。

#### Scenario: 生成曲线报告
- **WHEN** 运行残值曲线报告生成脚本
- **THEN** payload 写入 `scripts/debug/`，且项目根目录不新增 `analysis-facts.md` 或其他分析中间文件
