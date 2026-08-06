#!/usr/bin/env python3
"""生成 HTML 报告"""
import json

with open("/workspace/calc_results.json") as f:
    data = json.load(f)

results = data["results"]
frontier = data["frontier"]

# 分离前沿和被支配
frontier_set = set()
for r in frontier:
    key = f"{r['model']}_{r['type']}_{r['holding']}"
    frontier_set.add(key)

# 生成 JavaScript 数据
def make_js_data():
    lines = []
    # 前沿点
    lines.append("var frontPoints = [")
    for r in results:
        if r["pareto"]:
            label = f"{r['model']} {r['type']} 持{r['holding']}月"
            lines.append(f"  {{ name: '{label}', value: [{r['monthly']}, {r['s_avg']}, {r['net_cost']}], model: '{r['model']}', type: '{r['type']}', holding: {r['holding']} }},")
    lines.append("];")
    
    # 被支配点
    lines.append("var domPoints = [")
    for r in results:
        if not r["pareto"]:
            label = f"{r['model']} {r['type']} 持{r['holding']}月"
            lines.append(f"  {{ name: '{label}', value: [{r['monthly']}, {r['s_avg']}, {r['net_cost']}], model: '{r['model']}', type: '{r['type']}', holding: {r['holding']} }},")
    lines.append("];")
    
    # 前沿连线 (按x排序)
    sorted_frontier = sorted(frontier, key=lambda x: x["monthly"])
    lines.append("var frontLine = [")
    for r in sorted_frontier:
        lines.append(f"  [{r['monthly']}, {r['s_avg']}],")
    lines.append("];")
    
    # 成本曲线数据
    lines.append("var costData = {")
    for model_key in ["M4_国补", "M4", "M2", "M1", "M4(等降价)", "M5(等新品)"]:
        model_results = [r for r in results if r["model"] == model_key]
        if not model_results:
            continue
        model_results.sort(key=lambda x: x["holding"])
        lines.append(f"  '{model_key}': [")
        for r in model_results:
            lines.append(f"    [{r['holding']}, {r['monthly']}],")
        lines.append(f"  ],")
    lines.append("};")
    
    return "\n".join(lines)

js_data = make_js_data()

# 推荐区间: 性能 ≥ 50% (开发需求)
# 在前沿上找 S̄(N) ≥ 50% 的点
recs = [r for r in frontier if r["s_avg"] >= 50]
recs.sort(key=lambda x: x["monthly"])

# 生成推荐表行
def make_rec_rows():
    rows = []
    for r in recs[:5]:
        conf = ""
        if r["confidence"] == "低":
            conf = '<span class="badge badge-warning">低置信度</span>'
        elif r["confidence"] == "中":
            conf = '<span class="badge badge-default">中置信度</span>'
        else:
            conf = '<span class="badge badge-success">高置信度</span>'
        
        warn = f'<br><small style="color:var(--warning)">{r["support_warning"]}</small>' if r["support_warning"] else ""
        rows.append(f"""<tr style="background:var(--accent-soft)">
          <td><strong>{r['model']}</strong></td>
          <td>{r['type']}</td>
          <td>{r['holding']}月</td>
          <td>{r['buy_price']}元</td>
          <td><strong style="font-size:32px;font-weight:600;font-family:var(--font-display);color:var(--accent)">{r['monthly']}</strong> 元/月</td>
          <td><strong>{r['s_avg']}%</strong></td>
          <td>{r['net_cost']}元</td>
          <td>{conf}{warn}</td>
        </tr>""")
    return "\n".join(rows)

# 生成所有方案表行
def make_all_rows():
    rows = []
    # 按前沿优先, 月均成本排序
    sorted_results = sorted(results, key=lambda x: (0 if x["pareto"] else 1, x["monthly"]))
    for r in sorted_results:
        style = 'style="background:var(--accent-soft)"' if r["pareto"] else ""
        conf = ""
        if r["confidence"] == "低":
            conf = '<span class="badge badge-warning">低</span>'
        elif r["confidence"] == "中":
            conf = '<span class="badge badge-default">中</span>'
        else:
            conf = '<span class="badge badge-success">高</span>'
        
        p = "★ 前沿" if r["pareto"] else "✗ 已排除"
        warn = f'<br><small style="color:var(--warning)">{r["support_warning"]}</small>' if r["support_warning"] else ""
        rows.append(f"""<tr {style}>
          <td>{r['model']}</td>
          <td>{r['new_used']}</td>
          <td>{r['type']}</td>
          <td>{r['holding']}月</td>
          <td>{r['buy_price']}元</td>
          <td>{r['s_avg']}%</td>
          <td>{r['monthly']}元/月</td>
          <td>{r['residual']}元</td>
          <td>{r['net_cost']}元</td>
          <td>{conf}</td>
          <td>{p}{warn}</td>
        </tr>""")
    return "\n".join(rows)

rec_rows = make_rec_rows()
all_rows = make_all_rows()

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>2026-08-06-苹果产品购买决策报告</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
:root {{
  --bg: #F5F5F7; --surface: #FFFFFF; --rule: #D2D2D8;
  --muted: #86868F; --fg: #1D1D1F;
  --accent: #007AFF; --accent-hover: #0063D4; --accent-soft: #E6F2FF;
  --success: #2A8A61; --success-soft: #D9F0E3;
  --warning: #E09500; --warning-soft: #FFF0C2;
  --error: #F24B4B; --error-soft: #FFD9D9;
  --font-display: -apple-system, 'SF Pro Display', 'PingFang SC', sans-serif;
  --font-body: -apple-system, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'SF Mono', Consolas, monospace;
}}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }}
.container {{ max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }}
h1 {{ font-family: var(--font-display); font-size: 32px; font-weight: 600; margin-bottom: 8px; }}
h2 {{ font-family: var(--font-display); font-size: 24px; font-weight: 600; margin: 40px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }}
h3 {{ font-family: var(--font-display); font-size: 20px; font-weight: 600; margin: 24px 0 12px; }}
.card {{
  background: var(--surface); border-radius: 20px;
  box-shadow: 0 1px 2px rgba(29,29,31,0.06), 0 1px 1px rgba(29,29,31,0.04);
  padding: 24px; margin-bottom: 24px;
}}
.report-table {{
  width: 100%; border-collapse: separate; border-spacing: 0;
  background: var(--surface); border: 1px solid var(--rule);
  border-radius: 16px; overflow: hidden; font-size: 14px;
}}
.report-table th, .report-table td {{
  padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--rule);
}}
.report-table thead th {{ color: var(--muted); font-size: 12px; font-weight: 600; white-space: nowrap; }}
.report-table tbody tr:last-child td {{ border-bottom: none; }}
.report-table tbody tr:hover {{ filter: brightness(0.97); }}
.badge {{ display: inline-flex; align-items: center; height: 24px; padding: 0 8px;
  border-radius: 9999px; font-size: 12px; font-weight: 400; line-height: 1; white-space: nowrap; }}
.badge-default {{ background: var(--bg); color: var(--muted); }}
.badge-success {{ background: var(--success-soft); color: var(--success); }}
.badge-warning {{ background: var(--warning-soft); color: var(--warning); }}
.badge-error {{ background: var(--error-soft); color: var(--error); }}
.chart {{ width: 100%; height: 430px; }}
.chart-aux {{ width: 100%; height: 330px; }}
.key-number {{ font-size: 32px; font-weight: 600; font-family: var(--font-display); color: var(--accent); }}
.meta {{ color: var(--muted); font-size: 14px; }}
.warning-box {{ background: var(--warning-soft); border-left: 4px solid var(--warning); padding: 12px 16px; border-radius: 8px; margin: 12px 0; font-size: 14px; }}
.info-box {{ background: var(--accent-soft); border-left: 4px solid var(--accent); padding: 12px 16px; border-radius: 8px; margin: 12px 0; font-size: 14px; }}
@media (max-width: 768px) {{
  .chart, .chart-aux {{ height: 360px; }}
  .container {{ padding: 16px 12px 48px; }}
  h1 {{ font-size: 24px; }}
  h2 {{ font-size: 20px; }}
  .report-table {{ font-size: 12px; }}
  .report-table th, .report-table td {{ padding: 8px 10px; }}
}}
</style>
</head>
<body>
<div class="container">

<h1>Mac mini 购买决策分析报告</h1>
<p class="meta">分析日期: 2026-08-06 | 数据来源: constants.json v3.8 (2026-08-02) | 方法: 帕累托前沿分析</p>

<!-- 第一部分: 结论 -->
<h2>一、结论与推荐方案</h2>

<div class="card">
  <h3>核心结论</h3>
  <p style="font-size:18px;margin-bottom:12px;">
    对于<strong>开发/多任务</strong>场景，综合考虑性能与性价比，<strong>最优方案是现在入手 Mac mini M4 (16G+256G) 国补价</strong>，持有约4年。
  </p>
  <p>
    M4 性能满足度约 52-55%，完全满足开发多任务需求；M1/M2 二手虽然月均成本极低，但性能已不足 50%，不适合开发场景。
    等 M5 新品虽然性能更好，但 M5 Mac mini 发布时间已严重滞后（原预测 2026 年第三季度，至今无任何发布迹象），等待不确定性高。
  </p>
</div>

<div class="card">
  <h3>推荐方案 (性能地板 ≥ 50%)</h3>
  <table class="report-table">
    <thead>
      <tr><th>机型</th><th>买入方式</th><th>持有期</th><th>买入价</th><th>月均成本</th><th>平均性能</th><th>净支出</th><th>备注</th></tr>
    </thead>
    <tbody>
      {rec_rows}
    </tbody>
  </table>
  <div class="info-box" style="margin-top:16px;">
    <strong>首选推荐: M4 国补 持48月</strong> — 月均 101 元，性能 52.1%，立即可用，国补窗口期有限建议尽快入手。<br>
    <strong>次选: 等M5后买M4降价 持60月</strong> — 月均 81 元，性能 49.5%，极致性价比但需等待约6个月，且M5发布时间不确定。<br>
    <strong>性能优先: 等M5买M5 持48月</strong> — 月均 102 元，性能 59.4%，最新芯片但等待风险高。
  </div>
</div>

<!-- 第二部分: 支撑证据 -->
<h2>二、帕累托前沿分析</h2>

<div class="card">
  <h3>帕累托前沿图 (核心图表)</h3>
  <p class="meta" style="margin-bottom:8px;">横轴: 月均成本(越低越省) | 纵轴: 平均性能满足度(越高越好) | 气泡大小: 净支出</p>
  <div id="pareto" class="chart"></div>
  <p class="meta" style="margin-top:8px;">
    ★ 实心圆 = 帕累托前沿(非劣解) | ○ 空心圆 = 被支配点(已排除) | 虚线 = 前沿连线<br>
    <span style="color:var(--warning)">橙色边框</span> = 超出系统支持期 | 透明度降低 = 长持有期(>36月)预测置信度低
  </p>
</div>

<div class="card">
  <h3>各机型多持有期成本曲线</h3>
  <div id="costCurve" class="chart-aux"></div>
  <p class="meta" style="margin-top:8px;">持有越久月均成本越低，但边际递减。M1/M2 二手曲线平坦因残值已接近底部。</p>
</div>

<div class="card">
  <h3>Mac mini 保值率曲线</h3>
  <div id="valueCurve" class="chart-aux"></div>
  <p class="meta" style="margin-top:8px;">橙色虚线标注 macOS 系统支持期约 72 个月。60 月后为线性外推。</p>
</div>

<!-- 第三部分: 完整方案明细 -->
<h2>三、完整候选方案明细</h2>

<div class="card">
  <table class="report-table">
    <thead>
      <tr><th>机型</th><th>新旧</th><th>买入方式</th><th>持有</th><th>买入价</th><th>S̄(N)</th><th>月均</th><th>残值</th><th>净支出</th><th>置信度</th><th>前沿</th></tr>
    </thead>
    <tbody>
      {all_rows}
    </tbody>
  </table>
</div>

<!-- 第四部分: 宏观因素分析 -->
<h2>四、宏观因素与常量校验</h2>

<div class="card">
  <h3>常量校验结论</h3>
  <table class="report-table">
    <thead><tr><th>项目</th><th>级别</th><th>结论</th></tr></thead>
    <tbody>
      <tr><td>constants.json 时效</td><td><span class="badge badge-success">绿色</span></td><td>最后更新 2026-08-02 (4天前)，直接使用</td></tr>
      <tr><td>市场价快照时效</td><td><span class="badge badge-success">绿色</span></td><td>快照日期 2026-07-27 (10天前)，≤14天免更新</td></tr>
      <tr><td>宏观因素扫描</td><td><span class="badge badge-success">绿色</span></td><td>沿用 v3.8 已扫描结果，无需重新扫描</td></tr>
    </tbody>
  </table>
</div>

<div class="card">
  <h3>当前宏观环境</h3>
  <div class="warning-box">
    <strong>⚠️ 存储超级周期进行中</strong><br>
    AI/HBM 挤压消费级 DRAM/NAND 产能，苹果已于 2026-06-25 全线涨价 (Mac mini 涨 33.3%，4499→5999)。<br>
    已激活 v3.8 机制: 新品价格预测模型、冲击幅度向下修正 (38%→24.7%)、缺货延迟因子 2.0。
  </div>
  <div class="warning-box">
    <strong>⚠️ Mac mini M5 发布时间预测偏差已超 1 季度</strong><br>
    原预测 2026 年第三季度发布，但 M5 已于 3 月发布在 MacBook 产品线，Mac mini M5 至今无任何发布迹象，可能推迟至 2026 年第四季度甚至 2027 年。<br>
    类型 B/C (等待新品) 方案置信度降级，报告中已标注。
  </div>
</div>

<div class="card">
  <h3>关键假设与参数</h3>
  <table class="report-table">
    <thead><tr><th>参数</th><th>数值</th><th>说明</th></tr></thead>
    <tbody>
      <tr><td>M系列 CAGR</td><td>16%/年</td><td>基于 M1→M5 实测跑分重算 (v3.8)</td></tr>
      <tr><td>基准芯片</td><td>M5 (多核 17100)</td><td>MacRumors/Notebookcheck 实测</td></tr>
      <tr><td>Mac mini 新品冲击</td><td>原始 38% → 调整后 24.7%</td><td>存储超级周期下价格传导因子 -35%</td></tr>
      <tr><td>场景修正</td><td>×0.9</td><td>开发/多任务 = 专业工作流</td></tr>
      <tr><td>M5 等待月数</td><td>5月 (发布) + 1月 (到货延迟)</td><td>悲观估计 2027-01, 缺货延迟因子 2.0</td></tr>
      <tr><td>年均维修</td><td>100 元/年</td><td>Mac mini 台式机故障率低，无电池</td></tr>
      <tr><td>macOS 支持期</td><td>约 72 月</td><td>超出仅标注风险，不排除方案</td></tr>
    </tbody>
  </table>
</div>

<!-- 第五部分: 图表说明 -->
<h2>五、图表阅读说明</h2>

<div class="card">
  <h3>帕累托前沿图的阅读方法</h3>
  <ul style="padding-left:20px;line-height:2;">
    <li>每个点代表一个 (机型 × 持有期) 购买方案</li>
    <li><strong>越靠左上角越理想</strong>: 成本低、性能高</li>
    <li><strong>实心圆连接虚线 = 帕累托前沿</strong>: 这些方案之间不存在"成本更低且性能更高"的替代方案，都是合理选择</li>
    <li><strong>空心圆 = 被支配点</strong>: 存在另一个方案在成本和性能上都优于它，已排除</li>
    <li><strong>选择取决于偏好</strong>: 前沿左侧是省钱方案，右侧是性能方案，中间是均衡方案</li>
  </ul>
</div>

<div class="card">
  <h3>不确定性标注</h3>
  <ul style="padding-left:20px;line-height:2;">
    <li><strong>长持有期 (>36月)</strong>: 保值率为外推，性能衰减为假设，预测置信度低</li>
    <li><strong>类型 B/C 方案</strong>: M5 发布时间不确定，置信度低，以 <span class="badge badge-warning">低置信度</span> 标注</li>
    <li><strong>系统支持期风险</strong>: 超出 macOS 72 月支持期仅标注风险，不排除方案</li>
    <li><strong>M2/M1 二手价</strong>: 闲鱼挂单价 (中置信度)，实际成交价可能低 5-10%</li>
    <li><strong>M4 国补价</strong>: 来源为资讯稿非实付晒单 (低置信度)，实际到手价可能有差异</li>
  </ul>
</div>

<!-- 第六部分: 更新提示 -->
<h2>六、更新提示</h2>

<div class="card">
  <ul style="padding-left:20px;line-height:2;">
    <li><strong>M5 Mac mini 正式发布后</strong>: 建议重新分析，用真实价格替换预测值，触发快照红色全更新</li>
    <li><strong>国补政策变化</strong>: 若国补到期或额度调整，M4 国补方案的月均成本将上升至 120 元/月左右</li>
    <li><strong>下次建议分析时间</strong>: M5 Mac mini 发布后 1 周内，或 2026 年 10 月 (若 M5 仍未发布则重新评估等待策略)</li>
    <li><strong>市场价快照下次更新</strong>: 快照将于 2026-08-10 过期 (>14天)，届时需轻校验</li>
  </ul>
</div>

</div>

<script>
var C_PRIMARY = '#007AFF', C_ACCENT_SOFT = '#E6F2FF';
var C_MUTED = '#86868F', C_BORDER = '#D2D2D8', C_GRAY = '#C7C7CC';
var C_SUCCESS = '#2A8A61', C_WARNING = '#E09500', C_ERROR = '#F24B4B';
var PALETTE = ['#007AFF', '#8E8E93', '#2A8A61', '#E09500', '#AF52DE', '#5856D6'];

var baseOption = {{
  backgroundColor: 'transparent',
  color: PALETTE,
  textStyle: {{ fontFamily: '-apple-system, "PingFang SC", sans-serif', color: '#1D1D1F' }},
  grid: {{ left: 60, right: 24, top: 50, bottom: 60, containLabel: true }},
  tooltip: {{
    trigger: 'item',
    backgroundColor: '#FFFFFF',
    borderColor: '#D2D2D8', borderWidth: 1,
    textStyle: {{ color: '#1D1D1F', fontSize: 13 }},
    extraCssText: 'box-shadow: 0 4px 8px -2px rgba(29,29,31,0.08); border-radius: 8px;'
  }},
  legend: {{ top: 8, textStyle: {{ color: C_MUTED, fontSize: 12 }}, itemWidth: 14, itemHeight: 10 }},
  xAxis: {{
    type: 'value', nameLocation: 'middle', nameGap: 32, nameTextStyle: {{ color: C_MUTED, fontSize: 12 }},
    axisLine: {{ lineStyle: {{ color: C_BORDER }} }},
    axisLabel: {{ color: C_MUTED, fontSize: 12 }},
    splitLine: {{ lineStyle: {{ color: C_BORDER, type: 'solid' }} }}
  }},
  yAxis: {{
    type: 'value', nameLocation: 'middle', nameGap: 40, nameTextStyle: {{ color: C_MUTED, fontSize: 12 }},
    axisLine: {{ lineStyle: {{ color: C_BORDER }} }},
    axisLabel: {{ color: C_MUTED, fontSize: 12 }},
    splitLine: {{ lineStyle: {{ color: C_BORDER, type: 'solid' }} }}
  }}
}};

{js_data}

// 帕累托前沿图
(function() {{
  var frontData = frontPoints.map(function(p) {{
    var style = {{ color: C_PRIMARY }};
    if (p.holding > 36) style.opacity = 0.6;
    var hasWarning = p.model === 'M1' || p.model === 'M2' || (p.model === 'M4(等降价)' && p.holding >= 48);
    if (hasWarning && p.holding >= 48) style.borderColor = C_WARNING;
    return {{ name: p.name, value: p.value, itemStyle: style, symbol: 'circle', symbolSize: function(d) {{ return Math.sqrt(d[2]) / 3 + 6; }} }};
  }});
  
  var domData = domPoints.map(function(p) {{
    return {{ name: p.name, value: p.value, itemStyle: {{ color: C_GRAY, opacity: 0.5 }}, symbol: 'circle', symbolSize: 8 }};
  }});
  
  var opt = Object.assign({{}}, baseOption, {{
    xAxis: {{ name: '月均成本(元/月) → 越低越省', min: 30 }},
    yAxis: {{ name: '平均性能满足度% → 越高越好', min: 20, max: 75 }},
    tooltip: {{ trigger: 'item', formatter: function(p){{ return p.name + '<br>月均:' + p.value[0] + '元  性能:' + p.value[1] + '%<br>净支出:' + p.value[2] + '元'; }} }},
    legend: {{ data: ['前沿(非劣解)', '已排除'] }},
    series: [
      {{ name: '前沿(非劣解)', type: 'scatter', data: frontData }},
      {{ name: '已排除', type: 'scatter', data: domData }},
      {{ type: 'line', data: frontLine, symbol: 'none', lineStyle: {{ color: C_PRIMARY, type: 'dashed', width: 1.5 }}, tooltip: {{ show: false }} }},
      {{ type: 'line', data: [], symbol: 'none', markLine: {{ symbol: 'none', silent: true, lineStyle: {{ color: C_SUCCESS, type: 'dashed', width: 1.5 }}, data: [{{ yAxis: 50, label: {{ formatter: '性能地板 50%', color: C_SUCCESS }} }}] }} }}
    ]
  }});
  echarts.init(document.getElementById('pareto')).setOption(opt);
}})();

// 成本曲线
(function() {{
  var names = ['M4 (国补)', 'M4 (官方)', 'M2 (二手)', 'M1 (二手)', 'M4 (等降价)', 'M5 (等新品)'];
  var keys = ['M4_国补', 'M4', 'M2', 'M1', 'M4(等降价)', 'M5(等新品)'];
  var series = [];
  for (var i = 0; i < keys.length; i++) {{
    var k = keys[i];
    if (costData[k]) {{
      series.push({{
        name: names[i], type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        data: costData[k],
        lineStyle: {{ width: 2, color: PALETTE[i % PALETTE.length] }},
        itemStyle: {{ color: PALETTE[i % PALETTE.length] }}
      }});
    }}
  }}
  var opt = Object.assign({{}}, baseOption, {{
    xAxis: {{ name: '持有月数', min: 12 }},
    yAxis: {{ name: '月均成本(元/月)' }},
    tooltip: {{ trigger: 'axis', formatter: function(pts){{ var s = ''; pts.forEach(function(p){{ s += p.seriesName + ': ' + p.data[1] + '元/月<br>'; }}); return s; }} }},
    legend: {{ type: 'scroll', top: 0, textStyle: {{ color: C_MUTED, fontSize: 10 }}, height: 30 }},
    series: series
  }});
  echarts.init(document.getElementById('costCurve')).setOption(opt);
}})();

// 保值率曲线
(function() {{
  var curveData = [
    [0,100],[3,90],[6,82],[12,65],[18,56],[24,48],[36,33],[48,25],[60,18]
  ];
  // 外推至 72 月
  var slope = (18 - 25) / (60 - 48);
  curveData.push([72, Math.max(18 + slope * (72 - 60), 3)]);
  
  var opt = Object.assign({{}}, baseOption, {{
    xAxis: {{ name: '机龄(发布后月数)', min: 0, max: 75 }},
    yAxis: {{ name: '保值率%', min: 0, max: 100 }},
    tooltip: {{ trigger: 'axis' }},
    series: [
      {{ name: 'Mac mini', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, data: curveData, lineStyle: {{ color: C_PRIMARY, width: 2.5 }}, itemStyle: {{ color: C_PRIMARY }} }},
      {{ type: 'line', data: [], symbol: 'none', markLine: {{ symbol: 'none', silent: true, lineStyle: {{ color: C_WARNING, type: 'dashed' }}, data: [{{ xAxis: 72, label: {{ formatter: 'macOS支持期~72月', color: C_WARNING }} }}] }} }}
    ]
  }});
  echarts.init(document.getElementById('valueCurve')).setOption(opt);
}})();
</script>
</body>
</html>"""

with open("/workspace/2026-08-06-苹果产品购买决策报告.html", "w") as f:
    f.write(html)

print("报告已生成: /workspace/2026-08-06-苹果产品购买决策报告.html")
print(f"共 {len(results)} 个候选方案, {len(frontier)} 个前沿方案")