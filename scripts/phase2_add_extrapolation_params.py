#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
阶段二：为 constants.json 保值率曲线添加指数衰减外推参数

基于亮机底价(8-10年老设备实测价格标准化)设定各品类渐近线锚点(floor):
  - iPhone (3%): iPhone 7/8/X 长期回收价 ~200-350元 / 当前新品5999元 → 3-5%, 取保守3%
  - iPad    (4%): 介于iPhone(3%)与Mac(5%)之间, 无直接老设备数据
  - Mac基础 (5%): Intel MacBook Air 2017 闲鱼500-800元 / 当前新品9999元 → 4.5-7.2%, 取5%
  - MacBook Pro (7%): Intel MBP 2017 闲鱼1800-2600元 / 当前新品19999元 → 8-12%, 取保守7%
  - 配件类  (3%): Apple Watch/AirPods等, 老款价值极低, 保持3%

半衰期 half_life_months=24: 每24个月(R(last)-floor)减半, 在96-120月区间平滑趋近floor
"""
import json
from pathlib import Path

CONSTANTS_PATH = Path(__file__).resolve().parent.parent / ".agents" / "skills" / "apple-value-analysis" / "constants.json"

# 各品类 floor (亮机底价标准化值%)
FLOORS = {
    "iPhone_ProMax": 3,
    "iPhone_Pro": 3,
    "iPhone_标准": 3,
    "iPad_Pro": 4,
    "iPad_Air": 4,
    "iPad_标准": 4,
    "iPad_mini": 4,
    "MacBook_Air": 5,
    "MacBook_Pro": 7,
    "Mac_mini": 5,
    "Mac_Studio": 5,
    "iMac": 5,
    "Mac_Pro": 5,
    "Apple_Watch": 3,
    "AirPods": 3,
    "Vision_Pro": 3,
    "Apple_TV": 3,
    "HomePod": 3,
}
HALF_LIFE = 24


def main():
    with open(CONSTANTS_PATH, encoding="utf-8") as f:
        data = json.load(f)

    curves = data["保值率曲线"]

    # 添加顶层说明
    curves["_外推参数_v3.9"] = {
        "_说明": "60月后外推使用指数衰减(带下限),替代v3.8线性外推。公式: R(t)=floor+(R(60)-floor)×0.5^((t-60)/half_life_months)。floor=渐近线锚点(亮机底价标准化值),基于8-10年老设备(Intel Mac/iPhone 7-8-X)实测二手价格标准化得出。half_life_months=半衰期(月),默认24",
        "_数据来源": "2026-08-10校验: iPhone 7(120月)回收价200-350元/当前新品5999元→3-5%; Intel MacBook Air 2017(108月)闲鱼500-800元/当前新品9999元→5-7%; Intel MacBook Pro 2017(108月)闲鱼1800-2600元/当前新品19999元→8-12%。取保守值作为floor",
        "_half_life_months_默认": HALF_LIFE,
    }

    added = []
    for cat, floor in FLOORS.items():
        if cat not in curves:
            print(f"  [警告] 品类 {cat} 不存在于保值率曲线,跳过")
            continue
        curve = curves[cat]
        if not isinstance(curve, dict):
            continue
        curve["_floor"] = floor
        curve["_half_life_months"] = HALF_LIFE
        added.append(f"  {cat}: floor={floor}%, half_life={HALF_LIFE}月")

    with open(CONSTANTS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"已为 {len(added)} 个品类添加外推参数:")
    for line in added:
        print(line)
    print(f"\n文件已写回: {CONSTANTS_PATH}")


if __name__ == "__main__":
    main()
