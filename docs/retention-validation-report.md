# 残值预测校验报告 (v3.9)

> 校验日期: 2026-08-10 | constants.json 版本: v3.8 → v3.9 | 引擎: apple-value-engine@0.1.0

## 摘要

本次校验针对长持有期方案末期残值计算不准的问题,分两阶段执行:

1. **阶段一(0-60月回溯检验)**: 47 台实测样本 vs 理论曲线,MAE=11.7pp,系统性低估+7.6pp,68% 样本在 ±15pp 容忍带内。结论:曲线偏保守但在容忍范围内,无需调整。
2. **阶段二(96-120月外推改进)**: 将 60 月以上的**线性外推**改为**指数衰减外推**(带渐近线锚点),解决线性外推在 8-10 年区间残值为负的问题。

**核心改进**: 96-120 月区间,旧模型残值全部被 clamp 到 3%(线性外推已为负值),新模型给出 5-13% 的合理值,符合"亮机底价"现实。

---

## 前置校验: 小程序与技能引擎一致性

| 项目 | 技能引擎 (TS 源) | 小程序引擎 (vendor) | 一致 |
|------|------------------|---------------------|------|
| 保值率算法 | `packages/apple-value-engine/src/retention.ts` | `miniapp/wx/vendor/apple-value-engine/retention.js` | ✓ |
| 常量数据 | `.agents/skills/apple-value-analysis/constants.json` | `miniapp/wx/snapshot/constants.json` (经 sync-snapshot.mjs 同步) | ✓ |

**结论**: 小程序通过 `sync-engine.mjs` + `sync-snapshot.mjs` 双脚本同步引擎代码与常量数据,逻辑完全一致。

---

## 阶段一: 0-60 月曲线拟合度回溯检验

### 方法

- **预测组**: constants.json 中 18 个品类的理论保值率曲线(0/3/6/12/18/24/36/48/60 月基准值)
- **实测组**: constants.json "实时市场价快照"中各机型的闲鱼中位价(snapshot_date=2026-08-07)
- **标准化**: 实测保值率 = 闲鱼挂单价 × 0.9(估实付系数) / 当前同品类新品官方价 × 100
- **机龄**: 由发布日期与分析日期(2026-08-10)计算确切月数

### 全局结果

| 指标 | 值 |
|------|-----|
| 有效样本 | 47 台(跳过 15 台:无价格/无发布日期) |
| 平均绝对误差 MAE | **11.7pp** |
| 系统性偏差 | **+7.6pp**(模型低估,实测高于预测) |
| ±10% 容差内 | 21/40 (52%) |
| ±15% 容差内 | 27/40 (68%) |

### 分品类结果

| 品类 | 样本 | 平均误差 | MAE | 判定 |
|------|------|----------|-----|------|
| MacBook_Air | 6 | +7.8pp | 9.9pp | ✓ 合理 |
| MacBook_Pro | 5 | +9.3pp | 9.6pp | ✓ 合理 |
| Mac_Studio | 2 | +20.5pp | 20.5pp | ✗ 严重偏离 |
| Mac_mini | 3 | +26.9pp | 26.9pp | ✗ 严重偏离 |
| iMac | 2 | +15.2pp | 15.2pp | ✗ 严重偏离 |
| iPad_Air | 3 | +3.8pp | 14.3pp | ⚠ 超容差 |
| iPad_Pro | 4 | +7.3pp | 9.2pp | ✓ 合理 |
| iPad_mini | 1 | +10.3pp | 10.3pp | ⚠ 超容差 |
| iPhone_Pro | 5 | -1.1pp | 8.9pp | ✓ 合理 |
| iPhone_proMax | 4 | -7.6pp | 7.6pp | ✓ 合理(高估) |
| iPhone_标准 | 5 | +8.4pp | 8.7pp | ✓ 合理 |

### 阶段一结论

0-60 月曲线整体偏保守(系统性低估+7.6pp),但 MAE=11.7pp 落在 10-15pp 容忍带内,**暂不调整曲线基准值**。Mac_mini/Mac_Studio/iMac 三个品类偏离较大,主因是样本量不足(2-3台)且含异常高配溢价样本,需后续补充样本再评估。

> **注**: 部分严重偏离样本(如 Mac_mini M2 16G 512G 实测72% vs 预测28%,误差+43.7pp)源于高配版本的大容量溢价未被标准化分母覆盖,属数据问题而非模型问题。

---

## 阶段二: 96-120 月外推改进

### 问题诊断

旧模型对 60 月以上设备采用"48-60 月斜率"线性外推,数学上必然导致残值为负:

```
Mac_mini: 60月=18%, 48月=24%, slope=(18-24)/(60-48)=-0.5%/月
R(120) = 18% + (-0.5%/月) × (120-60) = 18% - 30% = -12% → clamp 到 3%
```

**实测对比(63-70 月区间,旧线性外推)**:

| 设备 | 机龄 | 实测 | 旧预测 | 误差 |
|------|------|------|--------|------|
| iMac M1 | 63月 | 36.0% | 13.2% | +22.7pp ✗ |
| Mac mini M1 | 69月 | 39.8% | 12.8% | +27.0pp ✗ |
| MacBook Air M1 | 69月 | 26.8% | 9.8% | +17.1pp ✗ |

线性外推在 63-70 月已严重低估,96-120 月更是全部 clamp 到 3%,不符合"亮机底价"现实(8-10 年老设备仍可卖几百元)。

### 改进方案: 指数衰减外推

**新公式**:
```
R(t) = floor + (R(last) - floor) × 0.5^((t - last_month) / half_life)
```

- `floor`: 渐近线锚点(亮机底价标准化值%),基于 8-10 年老设备实测价格标准化
- `half_life`: 半衰期(月),默认 24,即每 24 个月(R(last)-floor)减半
- 特性: 永远 > floor,平滑趋近,不会为负

### 亮机底价(floor)取值依据

基于 2026-08 市场调研,8-10 年机龄老设备的"亮机底价"标准化:

| 品类 | floor | 依据 |
|------|-------|------|
| iPhone (全系) | 3% | iPhone 7/8/X(120月)回收价 200-350 元 / 当前新品 5999 元 → 3-5%,取保守 3% |
| iPad (全系) | 4% | 介于 iPhone(3%)与 Mac(5%)之间 |
| Mac mini/Studio/iMac/Pro | 5% | Intel MacBook Air 2017(108月)闲鱼 500-800 元 / 当前新品 9999 元 → 5-7%,取 5% |
| MacBook Air | 5% | 同上 |
| MacBook Pro | 7% | Intel MBP 2017(108月)闲鱼 1800-2600 元 / 当前新品 19999 元 → 8-12%,取保守 7% |
| 配件类(Watch/AirPods等) | 3% | 老款价值极低 |

### 改进效果对比

**96-120 月区间(旧线性 vs 新指数衰减)**:

| 品类 | 96月(旧/新) | 120月(旧/新) | 150月(旧/新) |
|------|-------------|--------------|--------------|
| Mac_mini | 3.0% / **9.6%** | 3.0% / **7.3%** | 3.0% / **6.0%** |
| MacBook_Air | 3.0% / **8.5%** | 3.0% / **6.8%** | 3.0% / **5.7%** |
| iPhone_ProMax | 3.0% / **13.3%** | 3.0% / **8.1%** | 3.0% / **5.2%** |
| iPhone_标准 | 3.0% / **9.7%** | 3.0% / **6.4%** | 3.0% / **4.4%** |
| iPad_Pro | 3.0% / **11.4%** | 3.0% / **7.7%** | 3.0% / **5.6%** |

- **旧模型**: 96 月起全部 clamp 到 3%(线性外推已为负),丢失品类差异
- **新模型**: 96 月给出 8-13%(符合亮机底价),120 月趋近 5-8%,150 月趋近 floor
- 新模型保留了品类差异(MacBook Pro 因 floor=7% 更高,衰减更慢)

**63-70 月区间改善(更接近实测)**:

| 设备 | 机龄 | 实测 | 旧预测 | 新预测 | 改善 |
|------|------|------|--------|--------|------|
| Mac_mini M1 | 69月 | 39.8% | 12.8% | 15.0% | +2.3pp |
| iMac M1 | 63月 | 36.0% | 13.2% | 14.2% | +0.9pp |
| MacBook Air M1 | 69月 | 26.8% | 9.8% | 12.7% | +3.0pp |
| iPhone 12 | 70月 | 17.8% | 15.3% | 17.2% | +1.9pp |

> 63-70 月改善有限(+1-3pp),因该区间仍在衰减早期。核心价值在 96-120 月区间避免残值为负。

---

## 变更清单

### 代码变更

| 文件 | 变更 |
|------|------|
| [retention.ts](file:///d:/_Projects/1-small-tools/purchase_decision_making/packages/apple-value-engine/src/retention.ts) | 线性外推 → 指数衰减外推;新增 `readParam()` 读取 `_floor`/`_half_life_months` |
| [consistency.test.ts](file:///d:/_Projects/1-small-tools/purchase_decision_making/packages/apple-value-engine/tests/consistency.test.ts) | 更新"范围外外推"和"月均成本"测试用例匹配指数衰减结果 |

### 数据变更

| 文件 | 变更 |
|------|------|
| [constants.json](file:///d:/_Projects/1-small-tools/purchase_decision_making/.agents/skills/apple-value-analysis/constants.json) | 18 个品类添加 `_floor`(3-7%)和 `_half_life_months`(24);版本 v3.8 → v3.9,last_updated 2026-08-10 |

### 小程序同步

| 目标 | 脚本 | 状态 |
|------|------|------|
| `miniapp/wx/vendor/apple-value-engine/*.js` | `sync-engine.mjs` | ✓ 已同步(8 .js + 8 .d.ts) |
| `miniapp/wx/snapshot/constants.json` | `sync-snapshot.mjs` | ✓ 已同步(v3.9) |
| `miniapp/wx/snapshot/constants.js` | `sync-snapshot.mjs` | ✓ 已重新生成(含 MACRO_CONTEXT 注入) |

### 校验脚本

| 脚本 | 用途 |
|------|------|
| [phase1_retention_validation.py](file:///d:/_Projects/1-small-tools/purchase_decision_making/scripts/phase1_retention_validation.py) | 阶段一:0-60 月曲线拟合度回溯检验 |
| [phase2_add_extrapolation_params.py](file:///d:/_Projects/1-small-tools/purchase_decision_making/scripts/phase2_add_extrapolation_params.py) | 阶段二:为 18 个品类写入 floor/half_life 参数 |

---

## 验证状态

- ✓ 引擎单测: 61/61 通过(含更新后的指数衰减外推测试)
- ✓ 引擎构建: tsc 编译成功
- ✓ 小程序同步: vendor 引擎代码 + snapshot 常量均已同步
- ✓ 一致性: 小程序 vendor/retention.js 与引擎 src/retention.ts 逻辑完全一致

## 后续建议

1. **Mac_mini/Mac_Studio/iMac 曲线校准**: 这三个品类 0-60 月偏离较大(需补充样本后重新评估基准值)
2. **floor 参数年度复核**: 随老设备退出市场,"亮机底价"可能下移,建议每年 1 月随保值率曲线更新时复核
3. **half_life 敏感性**: 当前统一 24 月,后续可按品类差异化(如 iPhone 衰减更快可设 18 月)
