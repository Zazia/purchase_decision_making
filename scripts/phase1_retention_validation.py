#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
阶段一：保值率曲线回溯检验 (0-60月曲线拟合度分析)

目标: 验证 constants.json 中 18 个品类的理论保值率曲线(0-60月)
      与 2026-08 市场快照实测价格的偏离程度。

方法:
  - 预测组: constants.json "保值率曲线" 各品类基准值
  - 实测组: constants.json "实时市场价快照" 各机型闲鱼中位价
  - 标准化: 实测保值率 = 闲鱼挂单价×0.9(估实付) / 当前同品类新品官方价 × 100
  - 误差: error_pp = 实测保值率 - 预测保值率 (百分点)
  - 容忍带: ±10% 至 ±15%
"""
import json
import re
import statistics
from pathlib import Path
from datetime import date

CONSTANTS_PATH = Path(__file__).resolve().parent.parent / ".agents" / "skills" / "apple-value-analysis" / "constants.json"
ANALYSIS_DATE = date(2026, 8, 10)  # 分析日期
LISTING_TO_TRANSACTION = 0.9  # 闲鱼挂单价→实付价系数(实付比挂单价低5-10%)


def load_constants():
    with open(CONSTANTS_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---- 引擎逻辑复刻 (与 retention.ts 完全一致) ----

def get_retention_rate(curve, months):
    """复刻 apple-value-engine getRetentionRate: 线性插值 + 末段斜率外推 + 3%保底"""
    points = sorted(
        [(int(k), float(v)) for k, v in curve.items() if not str(k).startswith("_")],
        key=lambda x: x[0],
    )
    if not points:
        return None
    if months <= points[0][0]:
        return max(3.0, min(100.0, points[0][1]))
    last = points[-1]
    if months >= last[0]:
        if len(points) >= 2:
            prev = points[-2]
            slope = (last[1] - prev[1]) / (last[0] - prev[0])
            return max(3.0, min(100.0, last[1] + slope * (months - last[0])))
        return max(3.0, min(100.0, last[1]))
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        if a[0] <= months <= b[0]:
            t = (months - a[0]) / (b[0] - a[0])
            return max(3.0, min(100.0, a[1] + (b[1] - a[1]) * t))
    return max(3.0, min(100.0, last[1]))


# ---- 数据提取辅助 ----

def extract_denominator_per_device(dev_info, category, devices):
    """从设备条目提取残值分母(优先设备级官方价_说明,回退品类级)"""
    # 方法1: 从设备级 官方价_说明 解析(如"残值分母使用...官方价44999元")
    desc = dev_info.get("官方价_说明", "")
    if isinstance(desc, str):
        m = re.search(r"官方[售]?价?\s*(\d{3,6})\s*元", desc)
        if m:
            return int(m.group(1))
    # 方法2: 设备自身有官方价(新品条目)
    p = dev_info.get("官方价")
    if isinstance(p, (int, float)) and p > 0:
        return p
    # 方法3: 从品类级 _说明 解析
    cat_desc = devices.get("_说明", "")
    if isinstance(cat_desc, str):
        m = re.search(r"官方[售]?价?\s*(\d{3,6})\s*元", cat_desc)
        if m:
            return int(m.group(1))
    # 方法4: 品类内首个新品条目的官方价
    for key, info in devices.items():
        if "新品" in key and isinstance(info, dict):
            p = info.get("官方价")
            if isinstance(p, (int, float)):
                return p
    return None


def find_release_date(category, dev_key, release_dates):
    """将快照设备键映射到 constants.json 产品发布日期"""
    parts = dev_key.split("_")
    # iPhone 设备键格式: iPhone_16_ProMax_256G_二手 → 型号段=parts[1]
    if dev_key.startswith("iPhone_"):
        model_num = parts[1]  # e.g. 16, 15, 14
        key = f"iPhone_{model_num}"
        if key in release_dates:
            return release_dates[key]
        # 模糊
        for k, v in release_dates.items():
            if k.startswith("iPhone_") and model_num in k:
                return v
        return None

    # iPad 设备键格式: iPad_10代_...或 M2_11寸_...
    chip = parts[0]  # e.g. M2, M4, A17, A16
    # Apple Watch: Series_10_46mm_二手
    if dev_key.startswith("Series_"):
        series_num = parts[1]  # e.g. 10, 9, 8
        # Watch发布日期未收录在release_dates中,返回None
        return None

    candidates = []
    candidates.append(f"{category}_{chip}")
    if category == "MacBook_Pro":
        for size in ["14", "16"]:
            for suffix in [chip, f"{chip}Pro", f"{chip}Max"]:
                candidates.append(f"MacBook_Pro_{size}_{suffix}")
    if category == "Mac_Studio":
        for suffix in [f"{chip}Max", f"{chip}Ultra", chip]:
            candidates.append(f"Mac_Studio_{suffix}")
    if category == "iPad_Pro":
        candidates.append(f"iPad_Pro_{chip}")
    if category == "iPad_Air":
        candidates.append(f"iPad_Air_{chip}")
    if category == "iPad_mini":
        candidates.append(f"iPad_mini_{chip}")
        candidates.append(f"iPad_mini_{chip}Pro")
    if category == "iMac":
        candidates.append(f"iMac_{chip}")
    if category == "Mac_mini":
        candidates.append(f"Mac_mini_{chip}")
        candidates.append(f"Mac_mini_{chip}_Pro")

    for c in candidates:
        if c in release_dates:
            return release_dates[c]

    # 模糊匹配
    for k, v in release_dates.items():
        if k.startswith(category) and chip in k:
            return v
    return None


def compute_age_months(release_date_str):
    """机龄(月) = (分析年-发布年)×12 + (分析月-发布月)"""
    if not isinstance(release_date_str, str):
        return None
    m = re.match(r"(\d{4})-(\d{1,2})", release_date_str)
    if not m:
        return None
    release = date(int(m.group(1)), int(m.group(2)), 1)
    return (ANALYSIS_DATE.year - release.year) * 12 + (ANALYSIS_DATE.month - release.month)


def get_actual_price(dev_info):
    """提取实测价格: 优先闲鱼中位价(多种字段名),其次参考价"""
    for field in [
        "闲鱼中位价_二手同款",
        "闲鱼中位价",          # iPhone 快照用此字段名
        "闲鱼中位价_二手同款_参考",
    ]:
        p = dev_info.get(field)
        if isinstance(p, (int, float)) and p > 0:
            return p
    return None


def find_curve(category, curve_categories):
    """大小写不敏感查找保值率曲线(与引擎 clampRate 逻辑一致)"""
    if category in curve_categories:
        return curve_categories[category]
    lower = category.lower()
    for k, v in curve_categories.items():
        if k.lower() == lower:
            return v
    return None


# ---- 主流程 ----

def main():
    data = load_constants()
    curves_raw = data["保值率曲线"]
    snapshots = data["实时市场价快照"]
    release_dates = data["产品发布日期"]

    curve_categories = {k: v for k, v in curves_raw.items() if not k.startswith("_")}

    results = []
    skipped = []

    for category, devices in snapshots.items():
        if category.startswith("_") or not isinstance(devices, dict):
            continue
        curve = find_curve(category, curve_categories)
        if not curve:
            continue

        for dev_key, dev_info in devices.items():
            if dev_key.startswith("_") or not isinstance(dev_info, dict):
                continue
            if "二手" not in dev_key:
                continue

            actual_price = get_actual_price(dev_info)
            if not actual_price:
                skipped.append(f"{category}/{dev_key}: 无价格")
                continue

            # 每设备独立提取分母(同芯片级别原则)
            denominator = extract_denominator_per_device(dev_info, category, devices)
            if not denominator:
                skipped.append(f"{category}/{dev_key}: 无法提取分母")
                continue

            release_date = find_release_date(category, dev_key, release_dates)
            if not release_date:
                skipped.append(f"{category}/{dev_key}: 无法匹配发布日期")
                continue

            age_months = compute_age_months(release_date)
            if age_months is None:
                skipped.append(f"{category}/{dev_key}: 发布日期格式异常({release_date})")
                continue

            predicted_rate = get_retention_rate(curve, age_months)

            # 实测保值率(估算实付价 / 当前新品价)
            transaction_price = actual_price * LISTING_TO_TRANSACTION
            actual_rate = (transaction_price / denominator) * 100
            # 挂单价保值率(未折算,作为上限参考)
            listing_rate = (actual_price / denominator) * 100

            error_pp = actual_rate - predicted_rate

            results.append({
                "category": category,
                "device": dev_key,
                "age_months": age_months,
                "release_date": release_date,
                "actual_price": actual_price,
                "denominator": denominator,
                "actual_rate": round(actual_rate, 1),
                "listing_rate": round(listing_rate, 1),
                "predicted_rate": round(predicted_rate, 1),
                "error_pp": round(error_pp, 1),
                "abs_error": round(abs(error_pp), 1),
                "in_60m": age_months <= 60,
                "confidence": dev_info.get("置信度", "未知"),
                "sample": dev_info.get("闲鱼样本量", dev_info.get("样本量", "?")),
            })

    # ========== 输出报告 ==========
    print("=" * 90)
    print("阶段一：保值率曲线回溯检验 (0-60月拟合度)")
    print(f"分析日期: {ANALYSIS_DATE} | 快照日期: {snapshots.get('snapshot_date', '?')}")
    print(f"实付系数: 闲鱼挂单价 × {LISTING_TO_TRANSACTION} (挂单价非实付,实付低5-10%)")
    print(f"有效样本: {len(results)} 台 | 跳过: {len(skipped)} 台")
    print("=" * 90)

    # --- 分品类汇总 ---
    print("\n■ 分品类拟合度汇总 (0-60月样本)")
    print(f"{'品类':<16} {'样本':>4} {'平均误差':>8} {'MAE':>7} {'系统性偏差':>10} {'判定':>6}")
    print("-" * 90)

    by_category = {}
    for r in results:
        if r["in_60m"]:
            by_category.setdefault(r["category"], []).append(r)

    overall_errors = []
    for cat in sorted(by_category.keys()):
        items = by_category[cat]
        errors = [r["error_pp"] for r in items]
        mae = statistics.mean([abs(e) for e in errors])
        mean_err = statistics.mean(errors)
        # 系统性偏差判定: 所有点同侧 或 平均绝对误差>10且均值偏离>5
        all_above = all(e > 0 for e in errors)
        all_below = all(e < 0 for e in errors)
        if all_above:
            bias = "系统性低估↑"
        elif all_below:
            bias = "系统性高估↓"
        elif abs(mean_err) > 5:
            bias = f"偏向{'低估↑' if mean_err > 0 else '高估↓'}"
        else:
            bias = "无明显偏差"
        verdict = "✓合理" if mae <= 10 else ("⚠超容差" if mae <= 15 else "✗严重偏离")
        print(f"{cat:<16} {len(items):>4} {mean_err:>+7.1f}pp {mae:>6.1f}pp {bias:>10} {verdict:>6}")
        overall_errors.extend(errors)

    # --- 全局统计 ---
    print("-" * 90)
    if overall_errors:
        mae_all = statistics.mean([abs(e) for e in overall_errors])
        mean_all = statistics.mean(overall_errors)
        within_10 = sum(1 for e in overall_errors if abs(e) <= 10)
        within_15 = sum(1 for e in overall_errors if abs(e) <= 15)
        total = len(overall_errors)
        print(f"{'全局(0-60月)':<16} {total:>4} {mean_all:>+7.1f}pp {mae_all:>6.1f}pp")
        print(f"  ±10%容差内: {within_10}/{total} ({within_10/total*100:.0f}%) | ±15%容差内: {within_15}/{total} ({within_15/total*100:.0f}%)")

    # --- 明细: 0-60月 ---
    print("\n■ 0-60月样本明细 (按品类分组)")
    print(f"{'品类':<14} {'设备':<28} {'机龄':>5} {'实测':>7} {'预测':>7} {'误差':>7} {'判定':<8} {'置信':<12}")
    print("-" * 100)
    for r in sorted([r for r in results if r["in_60m"]], key=lambda x: (x["category"], x["age_months"])):
        verdict = "✓" if r["abs_error"] <= 10 else ("⚠" if r["abs_error"] <= 15 else "✗")
        print(f"{r['category']:<14} {r['device']:<28} {r['age_months']:>4}月 {r['actual_rate']:>6.1f}% {r['predicted_rate']:>6.1f}% {r['error_pp']:>+6.1f}pp {verdict:<8} {r['confidence']:<12}")

    # --- 明细: >60月 (外推区域,Phase 2 关注) ---
    over_60 = [r for r in results if not r["in_60m"]]
    if over_60:
        print(f"\n■ >60月外推样本明细 (Phase 2 关注: 线性外推 vs 实测)")
        print(f"{'品类':<14} {'设备':<28} {'机龄':>5} {'实测':>7} {'预测':>7} {'误差':>7} {'判定':<8}")
        print("-" * 100)
        for r in sorted(over_60, key=lambda x: x["age_months"]):
            verdict = "✓" if r["abs_error"] <= 10 else ("⚠" if r["abs_error"] <= 15 else "✗")
            note = ""
            if r["predicted_rate"] <= 3.1:
                note = " ← 已触3%保底"
            print(f"{r['category']:<14} {r['device']:<28} {r['age_months']:>4}月 {r['actual_rate']:>6.1f}% {r['predicted_rate']:>6.1f}% {r['error_pp']:>+6.1f}pp {verdict}{note}")

    # --- 跳过列表 ---
    if skipped:
        print(f"\n■ 跳过样本 ({len(skipped)}台)")
        for s in skipped[:20]:
            print(f"  - {s}")
        if len(skipped) > 20:
            print(f"  ... 还有 {len(skipped)-20} 台")

    # --- 结论 ---
    print("\n" + "=" * 90)
    print("■ 阶段一结论")
    print("=" * 90)
    if overall_errors:
        mae_all = statistics.mean([abs(e) for e in overall_errors])
        mean_all = statistics.mean(overall_errors)
        if mean_all > 5:
            print(f"  系统性偏差: 模型整体低估实测保值率 {mean_all:+.1f}pp (实测高于预测)")
            print(f"  → 曲线偏保守,实测设备比预测更保值")
        elif mean_all < -5:
            print(f"  系统性偏差: 模型整体高估实测保值率 {mean_all:+.1f}pp (实测低于预测)")
            print(f"  → 曲线偏乐观,实测设备贬值更快")
        else:
            print(f"  系统性偏差: 无明显方向性偏差 (均值 {mean_all:+.1f}pp)")
        print(f"  平均绝对误差 MAE: {mae_all:.1f}pp")
        if mae_all <= 10:
            print(f"  判定: 0-60月曲线整体拟合度良好 (MAE ≤ 10pp)")
        elif mae_all <= 15:
            print(f"  判定: 0-60月曲线存在偏差但在容忍带内 (10 < MAE ≤ 15pp)")
        else:
            print(f"  判定: 0-60月曲线偏离严重 (MAE > 15pp),需修订")


if __name__ == "__main__":
    main()
