## 1. 数据与审计

- [x] 1.1 将根目录分析事实合并到 `scripts/debug/analysis-facts.md` 并移除根目录中间文件
- [x] 1.2 将 constants 升级到 v4.8，更新 Mac mini 中期曲线节点、耐久样本复核、修订溯源和快照日期

## 2. 自动化验证

- [x] 2.1 新增 Mac mini 曲线节点、单调性、关键机龄拟合、MAE 改善和长期外推测试
- [x] 2.2 运行新增测试、引擎全量测试、constants 校验与引擎冒烟

## 3. 报告与本地快照

- [x] 3.1 更新残值曲线报告生成器，展示 v4.5 与 v4.8 的校准结论且中间产物仅写入 `scripts/debug/`
- [x] 3.2 重新生成市场快照分析、残值曲线 payload 与 HTML 报告并做结果核对
- [x] 3.3 运行 `node scripts/sync-snapshot.mjs` 并验证小程序快照与源 constants 一致

## 4. 云端分发

- [x] 4.1 运行云发布 dry-run
- [x] 4.2 正式发布 constants，并运行 `node scripts/check-cloud-constants.mjs` 验证版本、payload 和哈希

## 5. 收尾

- [x] 5.1 更新分析事实与 OpenSpec 任务状态，检查工作区只包含本变更及用户原有改动
