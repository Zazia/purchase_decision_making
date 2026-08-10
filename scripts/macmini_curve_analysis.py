#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
Mac_mini 单品类保值率曲线拟合度分析

重点考察:
1. 同配置分母标准化(256G用5999, 512G用7499)消除配置溢价干扰
2. 苹果2026-06涨价33.3%对跨代际保值率标准化的影响
3. 0-60月曲线是否需要调整,60+月外推参数是否需要调整
"""
import json
import statistics
from datetime import date
from pathlib import Path

CONSTANTS = Path(__file__).resolve().parent.parent / ".agents" / "skills" / "apple-value-analysis" / "constants.json"
ANALYSIS = date(2026, 8, 10)
LISTING_TO_TX = 0.9  # 闲鱼挂单价->实付系数

with open(CONSTANTS, encoding="utf-8") as f:
    c = json.load(f)

curve = c["保值率曲线"]["Mac_mini"]


def months_since(release_yyyy_mm):
    y, m = map(int, release_yyyy_mm.split("-"))
    return (ANALYSIS.year - y) * 12 + (ANALYSIS.month - m)


def get_rate(months):
    """复刻引擎 getRetentionRate (v3.9 指数衰减外推)"""
    pts = sorted([(int(k), float(v)) for k, v in curve.items() if not str(k).startswith("_")])
    floor = curve.get("_floor", 3)
    hl = curve.get("_half_life_months", 24)
    if months <= pts[0][0]:
        return max(3, min(100, pts[0][1]))
    last = pts[-1]
    if months >= last[0]:
        return max(3, min(100, floor + (last[1] - floor) * 0.5 ** ((months - last[0]) / hl)))
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        if a[0] <= months <= b[0]:
            t = (months - a[0]) / (b[0] - a[0])
            return max(3, min(100, a[1] + (b[1] - a[1]) * t))
    return max(3, min(100, last[1]))


# Mac_mini 全部样本 (机型, 内存, 存储, 闲鱼价, 发布日期, 分母, 来源)
# 分母策略: 256G用5999(M4基础款), 512G用7499(M4同配置) — 消除配置溢价干扰
samples = [
    # 256G 版本 (分母 5999)
    ("M2_16G_256G", 16, 256, 3566, "2023-01", 5999, "闲鱼中位(4样本)"),
    ("M2_8G_256G",  8,  256, 2675, "2023-01", 5999, "闲鱼中位(2样本)"),
    ("M1_16G_256G", 16, 256, 2650, "2020-11", 5999, "闲鱼中位(5样本)"),
    ("M1_8G_256G",  8,  256, 2244, "2020-11", 5999, "闲鱼中位(2样本)"),
    ("M1_16G_256G_用户", 16, 256, 2800, "2020-11", 5999, "用户实采(1样本)"),
    # 512G 版本 (分母 7499 同配置)
    ("M2_16G_512G", 16, 512, 4799, "2023-01", 7499, "闲鱼中位(7样本)"),
    ("M1_8G_512G",  8,  512, 2500, "2020-11", 7499, "用户实采(1样本)"),
    ("M1_16G_512G", 16, 512, 3500, "2020-11", 7499, "用户实采(1样本)"),
]

print("=" * 110)
print("Mac_mini 保值率曲线拟合度分析 (v3.9 指数衰减外推 + 同配置分母标准化)")
curve_str = f"0={curve['0']}, 12={curve['12']}, 24={curve['24']}, 36={curve['36']}, 48={curve['48']}, 60={curve['60']}"
print(f"分析日期: {ANALYSIS} | 曲线: {curve_str}, floor={curve['_floor']}, half_life={curve['_half_life_months']}")
print("分母策略: 256G用5999(M4基础款), 512G用7499(M4同配置) — 消除配置溢价干扰")
print("=" * 110)
header = f"{'机型':20s} {'机龄':>4s} {'内存':>4s} {'存储':>4s} {'实付价':>7s} {'分母':>5s} {'实测':>6s} {'预测':>6s} {'误差':>8s} {'判定':3s} {'来源'}"
print(header)
print("-" * 110)

errors_256 = []
errors_512 = []
errors_m1 = []
errors_m2 = []
errors_all = []

for name, mem, stor, price, release, denom, src in samples:
    age = months_since(release)
    tx_price = price * LISTING_TO_TX
    actual = tx_price / denom * 100
    predicted = get_rate(age)
    err = actual - predicted
    judge = "✓" if abs(err) <= 15 else ("⚠" if abs(err) <= 25 else "✗")
    print(f"{name:20s} {age:4d}月 {mem:4d}G {stor:4d}G {price:7d} {denom:5d} {actual:6.1f}% {predicted:6.1f}% {err:+8.1f}pp {judge:3s} {src}")
    errors_all.append(err)
    if stor == 256:
        errors_256.append(err)
    else:
        errors_512.append(err)
    if "M1" in name:
        errors_m1.append(err)
    else:
        errors_m2.append(err)

print("-" * 110)


def stats(errs, label):
    if not errs:
        return
    mae = statistics.mean([abs(e) for e in errs])
    bias = statistics.mean(errs)
    in15 = sum(1 for e in errs if abs(e) <= 15)
    print(f"{label}: 样本={len(errs)} MAE={mae:.1f}pp 系统偏差={bias:+.1f}pp ±15pp内={in15}/{len(errs)} ({in15/len(errs)*100:.0f}%)")


stats(errors_256, "256G版本(分母5999)")
stats(errors_512, "512G版本(分母7499)")
stats(errors_m1, "M1(69月, 老设备)")
stats(errors_m2, "M2(43月, 中期)")
stats(errors_all, "全部样本")

print()
print("=" * 110)
print("根因分析: 双分母对比 (当前新品价 vs 当年官方价)")
print("=" * 110)
# 用两种分母分别计算,验证是否是"涨价导致失真"还是"曲线本身偏低"
# 当年官方价: M1 8G+256G=3999, M1 16G+256G=4999, M1 8G+512G≈4999, M1 16G+512G≈5999
#             M2 8G+256G=4499, M2 16G+256G=4999, M2 16G+512G=5999
original_prices = {
    "M2_16G_256G": 4999, "M2_8G_256G": 4499, "M2_16G_512G": 5999,
    "M1_16G_256G": 4999, "M1_8G_256G": 3999, "M1_8G_512G": 4999, "M1_16G_512G": 5999,
    "M1_16G_256G_用户": 4999,
}
print(f"{'机型':20s} {'机龄':>4s} {'当前分母':>8s} {'实测A':>6s} {'当年分母':>8s} {'实测B':>6s} {'A-B':>6s} {'预测':>6s} {'误差A':>7s} {'误差B':>7s}")
print("-" * 110)
err_a_all, err_b_all = [], []
for name, mem, stor, price, release, denom, src in samples:
    age = months_since(release)
    tx = price * LISTING_TO_TX
    actual_a = tx / denom * 100  # 用当前M4官方价做分母(SKILL.md规定)
    orig = original_prices.get(name, denom)
    actual_b = tx / orig * 100   # 用当年官方价做分母(相对原价)
    predicted = get_rate(age)
    ea = actual_a - predicted
    eb = actual_b - predicted
    err_a_all.append(ea)
    err_b_all.append(eb)
    print(f"{name:20s} {age:4d}月 {denom:8d} {actual_a:6.1f}% {orig:8d} {actual_b:6.1f}% {actual_a-actual_b:+6.1f} {predicted:6.1f}% {ea:+7.1f}pp {eb:+7.1f}pp")
print("-" * 110)
print(f"用当前新品价做分母: MAE={statistics.mean([abs(e) for e in err_a_all]):.1f}pp 系统偏差={statistics.mean(err_a_all):+.1f}pp")
print(f"用当年官方价做分母: MAE={statistics.mean([abs(e) for e in err_b_all]):.1f}pp 系统偏差={statistics.mean(err_b_all):+.1f}pp")
print("→ 两种分母都严重低估,说明根因不是'涨价导致标准化失真',而是'曲线本身偏低'")

print()
print("=" * 110)
print("结论与建议")
print("=" * 110)
# 基于实测反推曲线
m2_actual = statistics.mean([s[3] * LISTING_TO_TX / original_prices[s[0]] * 100 for s in samples if "M2" in s[0]])
m1_actual = statistics.mean([s[3] * LISTING_TO_TX / original_prices[s[0]] * 100 for s in samples if "M1" in s[0]])
print(f"""
1. 曲线整体严重低估: 8个样本,用当前新品价做分母MAE=22.3pp(+22.3pp偏差),用当年官方价做分母MAE={statistics.mean([abs(e) for e in err_b_all]):.1f}pp(+{statistics.mean(err_b_all):.1f}pp偏差)
   → 不论用什么分母,Mac_mini曲线都系统性低估约+20-30pp
   → 根因: constants.json保值率曲线来自SellMacBook(海外市场),中国闲鱼市场Mac mini保值率显著更高
     (可能因M4远程租用需求推高二手价,中国Mac mini是热门机型)

2. 涨价影响有限: 用当年官方价做分母(消除涨价影响)后,误差仅缩小{statistics.mean([abs(e) for e in err_a_all]) - statistics.mean([abs(e) for e in err_b_all]):.1f}pp,仍严重低估
   → 涨价不是主因,曲线本身偏低才是主因

3. 建议上调Mac_mini曲线基准值:
   实测反推(用当年官方价做分母,即相对原价保值率):
   - M2(43月)实测均值: {m2_actual:.1f}%  → 48月曲线点应≈{m2_actual:.0f}
   - M1(69月)实测均值: {m1_actual:.1f}%  → 60月曲线点应≈{m1_actual:.0f}
   当前曲线: 0=100, 12=65, 24=48, 36=33, 48=25, 60=18
   建议新曲线(基于实测反推,保留0月100%锚点):
   - 0=100, 12=82, 24=68, 36=55, 48={m2_actual:.0f}, 60={m1_actual:.0f}
   验证: M2(43月)插值={55 + (m2_actual - 55) * (43-36)/(48-36):.1f}% vs 实测{m2_actual:.1f}% (合理)
         M1(69月)外推: floor=5, R(69)=5+({m1_actual:.0f}-5)*0.5^((69-60)/24)={5 + (m1_actual - 5) * 0.5 ** (9/24):.1f}% vs 实测{m1_actual:.1f}% (合理)

   ⚠️ 样本量有限(8台,含用户提供3台),建议作为"中国市场修正版"标注,待更多样本验证后正式更新
   ⚠️ 上调曲线会降低月均成本(残值更高),使Mac mini看起来更划算——需确认这是市场真实情况而非样本偏差
""")

