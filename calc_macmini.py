#!/usr/bin/env python3
"""Mac mini 购买决策分析 - 计算脚本"""
import json
import math
from datetime import date

# 分析日期
ANALYSIS_DATE = date(2026, 8, 6)

# 从 constants.json 读取关键数据
# Mac mini 保值率曲线
DEPRECIATION = {
    0: 100, 3: 90, 6: 82, 12: 65, 18: 56, 24: 48, 36: 33, 48: 25, 60: 18
}

# 芯片跑分 (多核)
CHIPS = {
    "M1": 7400, "M2": 9700, "M4": 15000, "M5": 17100
}

# 基准芯片
BENCHMARK = "M5"
BENCHMARK_SCORE = CHIPS[BENCHMARK]

# 配置权重
MEM_WEIGHT = {"8GB": 0.65, "16GB": 1.0, "24GB": 1.0}
STORAGE_WEIGHT = {"256GB": 0.85, "512GB": 1.0}

# M系列 CAGR
r = 0.16

# 场景修正 (开发/多任务=专业工作流)
SCENE_FACTOR = 0.9

# 发布信息
RELEASE = {
    "M1": date(2020, 11, 1),
    "M2": date(2023, 1, 1),
    "M4": date(2024, 10, 1),
}

# 价格 (从快照)
PRICES = {
    "M1_16G_256G_二手": 2650,  # 闲鱼中位挂单
    "M2_16G_256G_二手": 3566,  # 闲鱼中位挂单
    "M4_16G_256G_新品_官方": 5999,  # 官方价
    "M4_16G_256G_新品_国补": 5074,  # 国补到手价
}

# 当前同品类新品价 (残值分母)
CURRENT_NEW_PRICE = 5999  # M4 官方价

# 新品冲击 (Mac mini)
IMPACT_MEAN = 0.38  # 历史均值
# 存储超级周期_进行中 + 涨价33.3% >30% → 价格传导因子 = -35%
PRICE_CONDUCTION = -0.35
ADJUSTED_IMPACT = IMPACT_MEAN * (1 + PRICE_CONDUCTION)  # 0.247

# 冲击时变曲线
IMPACT_TIME = {
    "1月内": {"残值调整因子": 0.95, "买入价下降因子": 1.0},
    "3月内": {"残值调整因子": 0.85, "买入价下降因子": 0.95},
    "6月内": {"残值调整因子": 0.60, "买入价下降因子": 0.80},
    "12月内": {"残值调整因子": 0.30, "买入价下降因子": 0.50},
    "12月后": {"残值调整因子": 0.10, "买入价下降因子": 0.20},
}

# 维修成本
ANNUAL_REPAIR = 100  # Mac mini 年均故障维修
BATTERY_COST = 0  # Mac mini 无电池

# macOS 支持月数
SUPPORT_MONTHS = 72

# 持有期候选
HOLDING_PERIODS = [12, 18, 24, 36, 48, 60]

# 等待新品参数
# M5 Mac mini: 预测2026-Q3, 但偏差已超1季度, 悲观估计2027-01
WAIT_MONTHS = 5  # 2026-08 → 2027-01
# 上市到货延迟: 基线14天 × 存储超级周期2.0 = 28天 ≈ 1月
DELIVERY_DELAY = 1
TOTAL_WAIT = WAIT_MONTHS + DELIVERY_DELAY  # 6月

# M5 新品预测价: 已涨33.3%, 预计同价
M5_PREDICTED_PRICE = 5999


def get_age(release_date, analysis_date=ANALYSIS_DATE):
    """计算发布后月数"""
    return (analysis_date.year - release_date.year) * 12 + (analysis_date.month - release_date.month)


def get_depreciation_rate(age_months):
    """查保值率曲线, 线性插值"""
    points = sorted(DEPRECIATION.items())
    if age_months <= points[0][0]:
        return points[0][1]
    if age_months >= points[-1][0]:
        # 外推: 用最后两点斜率
        slope = (points[-1][1] - points[-2][1]) / (points[-1][0] - points[-2][0])
        extrapolated = points[-1][1] + slope * (age_months - points[-1][0])
        return max(extrapolated, 3.0)
    
    for i in range(len(points) - 1):
        if points[i][0] <= age_months <= points[i + 1][0]:
            ratio = (age_months - points[i][0]) / (points[i + 1][0] - points[i][0])
            return points[i][1] + ratio * (points[i + 1][1] - points[i][1])
    return 3.0


def get_time_factor(months_from_release):
    """获取冲击时变因子"""
    if months_from_release <= 1:
        return IMPACT_TIME["1月内"]
    elif months_from_release <= 3:
        return IMPACT_TIME["3月内"]
    elif months_from_release <= 6:
        return IMPACT_TIME["6月内"]
    elif months_from_release <= 12:
        return IMPACT_TIME["12月内"]
    else:
        return IMPACT_TIME["12月后"]


def calc_s0(chip_name, mem="16GB", storage="256GB"):
    """计算静态性能满足度"""
    chip_score = CHIPS[chip_name]
    chip_coef = chip_score / BENCHMARK_SCORE
    mem_w = MEM_WEIGHT.get(mem, 1.0)
    storage_w = STORAGE_WEIGHT.get(storage, 0.85)
    return chip_coef * mem_w * storage_w * 100


def calc_s_avg(chip_name, holding_months, mem="16GB", storage="256GB"):
    """计算持有期平均性能满足度"""
    s0 = calc_s0(chip_name, mem, storage)
    sn = s0 / ((1 + r) ** (holding_months / 12))
    s_avg = (s0 + sn) / 2
    return s_avg * SCENE_FACTOR


def calc_monthly_cost(buy_price, current_age, holding_months, 
                       is_type_a=True, is_type_b=False, is_type_c=False,
                       m5_release_months_from_now=None):
    """
    计算月均成本
    - type_a: 现在买 (施加新品冲击)
    - type_b: 等新品买新品
    - type_c: 等新品买降价老款
    """
    if is_type_b:
        # 类型B: 等新品买M5
        buy_price = M5_PREDICTED_PRICE
        sell_age = holding_months  # 新品买入时机龄≈0
        # 残值分母 = M5预测价
        residual_denom = M5_PREDICTED_PRICE
        impact_applied = False
    elif is_type_c:
        # 类型C: 等新品买降价M4
        # 买入时距新品发布 ≈ 1月内
        time_f = get_time_factor(1)  # "1月内"
        buy_price = CURRENT_NEW_PRICE * (1 - ADJUSTED_IMPACT * time_f["买入价下降因子"])
        sell_age = current_age + TOTAL_WAIT + holding_months
        residual_denom = CURRENT_NEW_PRICE
        impact_applied = False  # 冲击已体现在买入价中
    else:
        # 类型A: 现在买
        sell_age = current_age + holding_months
        residual_denom = CURRENT_NEW_PRICE
        impact_applied = True
    
    # 保值率
    raw_rate = get_depreciation_rate(sell_age)
    
    # 新品冲击调整 (仅类型A)
    if impact_applied and m5_release_months_from_now:
        # 持有期内M5发布, 用残值调整因子
        # 距新品发布剩余月数
        months_to_release = m5_release_months_from_now
        # 在持有期内发布: 冲击时点 = 距发布月数
        time_f = get_time_factor(months_to_release)
        adjusted_rate = raw_rate * (1 - ADJUSTED_IMPACT * time_f["残值调整因子"] / 100)
        # Actually wait, let me re-read the formula...
        # 冲击后保值率 = 原始保值率 × (1 - 调整后冲击幅度 × 时变因子)
        # 调整后冲击幅度 = 0.247 (24.7%)
        # 时变因子 depends on when the new product releases relative to the sale
        adjusted_rate = raw_rate * (1 - ADJUSTED_IMPACT * time_f["残值调整因子"])
    else:
        adjusted_rate = raw_rate
    
    adjusted_rate = max(adjusted_rate, 3.0)
    
    # 残值
    residual = residual_denom * adjusted_rate / 100
    
    # 维修成本
    repair_cost = (holding_months / 12) * ANNUAL_REPAIR
    
    # 月均成本
    monthly = (buy_price - residual + repair_cost) / holding_months
    
    return {
        "buy_price": buy_price,
        "sell_age": sell_age,
        "raw_rate": raw_rate,
        "adjusted_rate": adjusted_rate,
        "residual": residual,
        "repair_cost": repair_cost,
        "monthly": monthly,
        "residual_denom": residual_denom,
    }


def main():
    results = []
    
    # 各机型机龄
    ages = {k: get_age(v) for k, v in RELEASE.items()}
    print("=== 机龄 ===")
    for k, v in ages.items():
        print(f"  {k}: {v}月")
    
    # M5 预计发布时间 (距现在)
    m5_release_months = WAIT_MONTHS  # 5月
    print(f"\nM5 预计发布距现在: {m5_release_months}月 (2027-01)")
    print(f"总等待(含延迟): {TOTAL_WAIT}月")
    
    # 计算各机型 × 持有期方案
    print("\n=== 候选方案计算 ===")
    
    for model_name, chip, age, price_key, is_new in [
        ("M1", "M1", ages["M1"], "M1_16G_256G_二手", False),
        ("M2", "M2", ages["M2"], "M2_16G_256G_二手", False),
        ("M4", "M4", ages["M4"], "M4_16G_256G_新品_官方", True),
        ("M4_国补", "M4", ages["M4"], "M4_16G_256G_新品_国补", True),
    ]:
        buy_price = PRICES[price_key]
        s0 = calc_s0(chip)
        s0_corrected = s0 * SCENE_FACTOR
        
        for hp in HOLDING_PERIODS:
            # 硬约束: 二手 + 持有期 < 6 → 排除
            if not is_new and hp < 6:
                continue
            
            s_avg = calc_s_avg(chip, hp)
            cost = calc_monthly_cost(
                buy_price, age, hp,
                is_type_a=True,
                m5_release_months_from_now=m5_release_months
            )
            
            sell_age = cost["sell_age"]
            support_warning = ""
            if sell_age > SUPPORT_MONTHS:
                excess = sell_age - SUPPORT_MONTHS
                support_warning = f"⚠️超出系统支持期{excess}月"
            elif SUPPORT_MONTHS - sell_age < 12:
                remain = SUPPORT_MONTHS - sell_age
                support_warning = f"⚠️接近系统支持尾声(剩余{remain}月)"
            
            results.append({
                "model": model_name,
                "chip": chip,
                "config": "16G+256G",
                "type": "A-现在买",
                "new_used": "新品" if is_new else "二手",
                "age": age,
                "holding": hp,
                "sell_age": sell_age,
                "buy_price": buy_price,
                "s0": round(s0, 1),
                "s_avg": round(s_avg, 1),
                "monthly": round(cost["monthly"], 0),
                "residual": round(cost["residual"], 0),
                "repair": round(cost["repair_cost"], 0),
                "raw_rate": round(cost["raw_rate"], 1),
                "adj_rate": round(cost["adjusted_rate"], 1),
                "support_warning": support_warning,
                "confidence": "中" if not is_new else "高",
                "net_cost": round(buy_price - cost["residual"] + cost["repair_cost"], 0),
            })
    
    # 类型B: 等M5买M5
    m5_s0 = 100.0  # M5 是基准
    for hp in HOLDING_PERIODS:
        s_avg = calc_s_avg("M5", hp)
        cost = calc_monthly_cost(
            M5_PREDICTED_PRICE, 0, hp,
            is_type_b=True
        )
        results.append({
            "model": "M5(等新品)",
            "chip": "M5",
            "config": "16G+256G(预计)",
            "type": "B-等新品买新品",
            "new_used": "新品(预测)",
            "age": 0,
            "holding": hp,
            "sell_age": hp,
            "buy_price": M5_PREDICTED_PRICE,
            "s0": round(m5_s0, 1),
            "s_avg": round(s_avg, 1),
            "monthly": round(cost["monthly"], 0),
            "residual": round(cost["residual"], 0),
            "repair": round(cost["repair_cost"], 0),
            "raw_rate": round(cost["raw_rate"], 1),
            "adj_rate": round(cost["adjusted_rate"], 1),
            "support_warning": "",
            "confidence": "低",
            "net_cost": round(M5_PREDICTED_PRICE - cost["residual"] + cost["repair_cost"], 0),
        })
    
    # 类型C: 等M5后买降价M4
    for hp in HOLDING_PERIODS:
        s_avg = calc_s_avg("M4", hp)
        cost = calc_monthly_cost(
            CURRENT_NEW_PRICE, ages["M4"], hp,
            is_type_c=True
        )
        sell_age = cost["sell_age"]
        support_warning = ""
        if sell_age > SUPPORT_MONTHS:
            excess = sell_age - SUPPORT_MONTHS
            support_warning = f"⚠️超出系统支持期{excess}月"
        
        results.append({
            "model": "M4(等降价)",
            "chip": "M4",
            "config": "16G+256G",
            "type": "C-等新品买降价老款",
            "new_used": "新品(降价预测)",
            "age": ages["M4"] + TOTAL_WAIT,
            "holding": hp,
            "sell_age": sell_age,
            "buy_price": round(cost["buy_price"], 0),
            "s0": round(calc_s0("M4"), 1),
            "s_avg": round(s_avg, 1),
            "monthly": round(cost["monthly"], 0),
            "residual": round(cost["residual"], 0),
            "repair": round(cost["repair_cost"], 0),
            "raw_rate": round(cost["raw_rate"], 1),
            "adj_rate": round(cost["adjusted_rate"], 1),
            "support_warning": support_warning,
            "confidence": "低",
            "net_cost": round(cost["buy_price"] - cost["residual"] + cost["repair_cost"], 0),
        })
    
    # 帕累托前沿计算
    # 每个方案: (月均成本, 平均性能)
    # 支配规则: B 支配 A 当 B的月均成本 ≤ A 且 B的性能 ≥ A, 且至少一个严格不等
    
    points = [(r["monthly"], r["s_avg"], i) for i, r in enumerate(results)]
    n = len(points)
    dominated = [False] * n
    
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            # j 支配 i?
            if points[j][0] <= points[i][0] and points[j][1] >= points[i][1]:
                if points[j][0] < points[i][0] or points[j][1] > points[i][1]:
                    dominated[i] = True
                    break
    
    for i, r in enumerate(results):
        r["pareto"] = not dominated[i]
    
    # 排序输出
    results.sort(key=lambda x: (x["monthly"], -x["s_avg"]))
    
    print("\n=== 所有候选方案 (按月均成本排序) ===")
    print(f"{'机型':<12} {'类型':<20} {'持有':>5} {'买入价':>7} {'S̄(N)':>6} {'月均':>7} {'残值':>7} {'维修':>6} {'净支出':>8} {'支持':>10} {'前沿':>4}")
    print("-" * 120)
    for r in results:
        p = "★" if r["pareto"] else "✗"
        print(f"{r['model']:<12} {r['type']:<20} {r['holding']:>4}月 {r['buy_price']:>6}元 {r['s_avg']:>5.1f}% {r['monthly']:>6}元 {r['residual']:>6}元 {r['repair']:>5}元 {r['net_cost']:>7}元 {r['support_warning']:<10} {p:>4}")
    
    print("\n=== 帕累托前沿方案 ===")
    frontier = [r for r in results if r["pareto"]]
    for r in frontier:
        print(f"  {r['model']} {r['type']} 持{r['holding']}月: 月均{r['monthly']}元, S̄(N)={r['s_avg']}%")
    
    # 保存结果
    output = {
        "analysis_date": str(ANALYSIS_DATE),
        "ages": {k: v for k, v in ages.items()},
        "m5_release_months": m5_release_months,
        "total_wait": TOTAL_WAIT,
        "adjusted_impact": round(ADJUSTED_IMPACT * 100, 1),
        "results": results,
        "frontier": [r for r in results if r["pareto"]],
    }
    
    with open("/workspace/calc_results.json", "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print("\n结果已保存到 calc_results.json")


if __name__ == "__main__":
    main()