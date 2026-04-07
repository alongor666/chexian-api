#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR HTML 报告生成器 — ECharts 离线单网页

报告内容：
1. 方法说明面板（Snapshot-Constrained v1）
2. Paid 三角形热图
3. LDF 趋势图
4. 终极赔付率多方法对比
5. IBNR 瀑布图
6. 回测验证表
"""

import json
from datetime import datetime
from pathlib import Path

ECHARTS_LOCAL = Path(__file__).resolve().parent / "assets" / "echarts.min.js"


def generate_report(result: dict, output_path: str | None = None) -> str:
    """从预测结果 dict 生成离线 HTML 报告。

    Args:
        result: run_prediction() 的完整输出 dict
        output_path: 输出文件路径，默认自动生成

    Returns:
        输出文件路径
    """
    vd = result.get("valuation_date", "unknown")
    if output_path is None:
        out_dir = Path(__file__).resolve().parent.parent / "数据分析报告"
        out_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(out_dir / f"终极赔付率预测_{vd.replace('-', '')}.html")

    # 读 ECharts JS
    if ECHARTS_LOCAL.exists():
        echarts_js = ECHARTS_LOCAL.read_text(encoding="utf-8")
        echarts_tag = f"<script>{echarts_js}</script>"
    else:
        echarts_tag = '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>'

    # 提取数据
    cohort_data = result.get("by_cohort_year", {})
    triangle = result.get("triangle", {})
    snapshot = result.get("snapshot", {})
    limitations = result.get("data_limitations", [])
    backtest = result.get("backtest", {})

    closure_rate = result.get("closure_rate", {})

    # 生成各图表数据
    cohort_years = sorted(cohort_data.keys())
    methods_chart_data = _build_methods_chart(cohort_data, cohort_years)
    ibnr_chart_data = _build_ibnr_chart(cohort_data, cohort_years)
    ldf_chart_data = _build_ldf_chart(triangle)
    closure_chart_data = _build_closure_chart(closure_rate)
    summary_table = _build_summary_table(cohort_data, snapshot, cohort_years)
    backtest_table = _build_backtest_table(backtest)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>终极赔付率预测报告（Snapshot-Constrained v1）— 评估日 {vd}</title>
{echarts_tag}
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
       background: #f5f5f5; color: #333; padding: 24px; }}
.container {{ max-width: 1200px; margin: 0 auto; }}
.card {{ background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 20px;
         box-shadow: 0 2px 8px rgba(0,0,0,0.06); }}
h1 {{ font-size: 24px; font-weight: 700; margin-bottom: 8px; }}
h2 {{ font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #1a1a1a; }}
.subtitle {{ font-size: 14px; color: #666; margin-bottom: 24px; }}
.badge {{ display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px;
          font-weight: 500; margin-right: 8px; }}
.badge-info {{ background: #e6f7ff; color: #1890ff; }}
.badge-warn {{ background: #fff7e6; color: #fa8c16; }}
.badge-danger {{ background: #fff1f0; color: #ff4d4f; }}
.limitations {{ background: #fffbe6; border: 1px solid #ffe58f; border-radius: 8px;
                padding: 12px 16px; margin-bottom: 16px; font-size: 13px; }}
.limitations li {{ margin-left: 16px; margin-bottom: 4px; color: #8c6d1f; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
th {{ background: #fafafa; font-weight: 600; text-align: left; padding: 10px 12px;
     border-bottom: 2px solid #e8e8e8; }}
td {{ padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }}
.num {{ text-align: right; font-family: "SF Pro Text", "Helvetica Neue", monospace;
        font-variant-numeric: tabular-nums; }}
.chart-box {{ height: 400px; }}
.grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
@media (max-width: 768px) {{ .grid-2 {{ grid-template-columns: 1fr; }} }}
.mature {{ color: #389e0d; }}
.mid {{ color: #d48806; }}
.immature {{ color: #cf1322; }}
.flag {{ font-size: 11px; }}
</style>
</head>
<body>
<div class="container">

<!-- 标题 -->
<div class="card">
  <h1>终极赔付率预测报告</h1>
  <div class="subtitle">
    <span class="badge badge-info">Snapshot-Constrained v1</span>
    <span class="badge badge-info">Paid CL + BF + Benktander</span>
    评估日: {vd} &nbsp;|&nbsp; 生成时间: {result.get('generated_at', '')}
  </div>
  <div class="limitations">
    <strong>数据限制：</strong>
    <ul>{''.join(f'<li>{l}</li>' for l in limitations)}</ul>
  </div>
</div>

<!-- 核心指标 -->
<div class="card">
  <h2>终极赔付率预测汇总</h2>
  {summary_table}
</div>

<!-- 图表区 -->
<div class="grid-2">
  <div class="card">
    <h2>终极赔付率 — 多方法对比</h2>
    <div id="chart-methods" class="chart-box"></div>
  </div>
  <div class="card">
    <h2>IBNR 分解（万元）</h2>
    <div id="chart-ibnr" class="chart-box"></div>
  </div>
</div>

<div class="grid-2">
  <div class="card">
    <h2>Paid LDF 趋势 (Selected)</h2>
    <div id="chart-ldf" class="chart-box"></div>
  </div>
  <div class="card">
    <h2>Closure Maturity — 各 Cohort 结案率曲线</h2>
    <div id="chart-closure" class="chart-box"></div>
  </div>
</div>

<!-- 三角形参数 -->
<div class="card">
  <h2>模型参数</h2>
  <table>
    <tr><th>参数</th><th class="num">值</th></tr>
    <tr><td>Cape Cod Prior LR</td><td class="num">{triangle.get('cape_cod_prior_lr', '-')}%</td></tr>
    <tr><td>Tail Factor</td><td class="num">{triangle.get('tail', '-')}</td></tr>
  </table>
  <br>
  <h3 style="font-size:14px;margin-bottom:8px;">Selected Paid LDFs</h3>
  <table>
    <tr><th>Dev Month</th>{''.join(f'<th class="num">{k}</th>' for k in list(triangle.get('paid_ldfs', {}).keys())[:15])}</tr>
    <tr><td>LDF</td>{''.join(f'<td class="num">{v}</td>' for v in list(triangle.get('paid_ldfs', {}).values())[:15])}</tr>
  </table>
</div>

<!-- 回测 -->
{f'''<div class="card">
  <h2>回测验证</h2>
  {backtest_table}
</div>''' if backtest else ''}

<!-- 维度切片 -->
{_build_dimension_section(result.get('by_dimension', {}))}

</div>

<script>
// 方法对比图
var chart1 = echarts.init(document.getElementById('chart-methods'));
chart1.setOption({methods_chart_data});

// IBNR 瀑布图
var chart2 = echarts.init(document.getElementById('chart-ibnr'));
chart2.setOption({ibnr_chart_data});

// LDF 趋势图
var chart3 = echarts.init(document.getElementById('chart-ldf'));
chart3.setOption({ldf_chart_data});

// Closure Maturity 曲线
var chart4 = echarts.init(document.getElementById('chart-closure'));
chart4.setOption({closure_chart_data});

window.addEventListener('resize', function() {{
  chart1.resize(); chart2.resize(); chart3.resize(); chart4.resize();
}});
</script>
</body>
</html>"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)

    return output_path


# ── 图表数据构建 ──

def _build_methods_chart(cohort_data, years):
    categories = years
    cl = [cohort_data[y].get("ultimate_lr_cl") for y in years]
    bf = [cohort_data[y].get("ultimate_lr_bf") for y in years]
    bk = [cohort_data[y].get("ultimate_lr_bk") for y in years]
    blend = [cohort_data[y].get("ultimate_lr_blend") for y in years]

    # Cap CL at 150 for display
    cl_display = [min(v, 150) if v else None for v in cl]

    return json.dumps({
        "tooltip": {"trigger": "axis"},
        "legend": {"data": ["Chain Ladder", "BF", "Benktander", "Dynamic Blend"]},
        "grid": {"containLabel": True, "left": 60, "right": 20},
        "xAxis": {"type": "category", "data": categories, "splitLine": {"show": False}},
        "yAxis": {"type": "value", "name": "Ultimate LR (%)", "splitLine": {"show": False},
                  "min": 50, "max": 100},
        "series": [
            {"name": "Chain Ladder", "type": "line", "data": cl_display,
             "lineStyle": {"type": "dashed", "opacity": 0.5}, "symbol": "circle", "symbolSize": 4},
            {"name": "BF", "type": "line", "data": bf,
             "lineStyle": {"type": "dashed", "opacity": 0.5}, "symbol": "diamond", "symbolSize": 4},
            {"name": "Benktander", "type": "line", "data": bk,
             "lineStyle": {"type": "dashed", "opacity": 0.5}, "symbol": "triangle", "symbolSize": 4},
            {"name": "Dynamic Blend", "type": "line", "data": blend,
             "lineStyle": {"width": 3}, "symbol": "circle", "symbolSize": 8,
             "itemStyle": {"color": "#1890ff"}},
        ],
    }, ensure_ascii=False)


def _build_ibnr_chart(cohort_data, years):
    current_paid = [round((cohort_data[y].get("current_paid", 0) or 0) / 1e4) for y in years]
    ibnr = [round(cohort_data[y].get("ibnr_wan") or 0) for y in years]

    return json.dumps({
        "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
        "legend": {"data": ["Current Paid", "IBNR (估算)"]},
        "grid": {"containLabel": True, "left": 80, "right": 20},
        "xAxis": {"type": "category", "data": years, "splitLine": {"show": False}},
        "yAxis": {"type": "value", "name": "万元", "splitLine": {"show": False}},
        "series": [
            {"name": "Current Paid", "type": "bar", "stack": "total", "data": current_paid,
             "itemStyle": {"color": "#91d5ff"}},
            {"name": "IBNR (估算)", "type": "bar", "stack": "total", "data": ibnr,
             "itemStyle": {"color": "#ff7875"}},
        ],
    }, ensure_ascii=False)


def _build_ldf_chart(triangle):
    ldfs = triangle.get("paid_ldfs", {})
    keys = list(ldfs.keys())[:20]
    vals = [ldfs[k] for k in keys]

    return json.dumps({
        "tooltip": {"trigger": "axis"},
        "grid": {"containLabel": True, "left": 60, "right": 20},
        "xAxis": {"type": "category", "data": [f"M{k}" for k in keys],
                  "splitLine": {"show": False}, "name": "Dev Month"},
        "yAxis": {"type": "value", "name": "LDF", "splitLine": {"show": False},
                  "min": 1.0},
        "series": [{
            "name": "Volume Weighted LDF", "type": "bar", "data": vals,
            "itemStyle": {"color": "#1890ff"},
            "label": {"show": True, "position": "top",
                      "formatter": "{c}", "fontSize": 10},
        }],
    }, ensure_ascii=False)


def _build_closure_chart(closure_rate):
    """各 cohort 结案率随发展月变化的曲线。"""
    if not closure_rate:
        return json.dumps({"title": {"text": "No closure data"}})

    colors = ["#1890ff", "#52c41a", "#fa8c16", "#ff4d4f", "#722ed1", "#13c2c2"]
    # 收集所有月份
    all_months = set()
    for yr_data in closure_rate.values():
        all_months.update(int(m) for m in yr_data.keys())
    x_months = sorted(all_months)
    # 只取前 48 个月
    x_months = [m for m in x_months if m <= 48]

    series = []
    for i, (yr, yr_data) in enumerate(sorted(closure_rate.items())):
        data = [yr_data.get(str(m)) for m in x_months]
        series.append({
            "name": str(yr),
            "type": "line",
            "data": data,
            "smooth": True,
            "symbol": "none",
            "lineStyle": {"width": 2},
            "itemStyle": {"color": colors[i % len(colors)]},
            "connectNulls": False,
        })

    return json.dumps({
        "tooltip": {"trigger": "axis", "valueFormatter": lambda: ""},
        "legend": {"data": [str(yr) for yr in sorted(closure_rate.keys())]},
        "grid": {"containLabel": True, "left": 60, "right": 20},
        "xAxis": {"type": "category", "data": [f"M{m}" for m in x_months],
                  "splitLine": {"show": False}, "name": "Dev Month"},
        "yAxis": {"type": "value", "name": "Closure Rate (%)", "splitLine": {"show": False},
                  "max": 100},
        "series": series,
    }, ensure_ascii=False, default=str)


# ── HTML 表格构建 ──

def _build_summary_table(cohort_data, snapshot, years):
    rows = []
    for y in years:
        d = cohort_data.get(y, {})
        s = snapshot.get(y, {})
        maturity = d.get("maturity", "")
        mat_class = {"mature": "mature", "mid_mature": "mid",
                     "immature": "immature", "very_immature": "immature"}.get(maturity, "")
        flag = ' <span class="flag badge-warn">⚠ uncertain</span>' if d.get("uncertainty_flag") else ""
        weights = d.get("method_weights", {})
        weight_str = " / ".join(f"{k}:{v:.0%}" for k, v in weights.items() if v > 0) if weights else "-"

        rows.append(f"""<tr>
            <td><strong>{y}</strong></td>
            <td class="{mat_class}">{maturity}{flag}</td>
            <td class="num">{_fmt(d.get('earned_premium_wan'))}</td>
            <td class="num">{s.get('policy_count', 0):,}</td>
            <td class="num">{s.get('claim_count', 0):,}</td>
            <td class="num">{_fmt(d.get('current_paid_lr'))}</td>
            <td class="num">{_fmt(d.get('current_incurred_lr'))}</td>
            <td class="num"><strong>{_fmt(d.get('ultimate_lr_blend'))}</strong></td>
            <td class="num">{_fmt(d.get('ibnr_wan'))}</td>
            <td style="font-size:11px">{weight_str}</td>
        </tr>""")

    return f"""<table>
    <thead><tr>
        <th>Cohort</th><th>Maturity</th><th class="num">满期保费(万)</th>
        <th class="num">保单数</th><th class="num">赔案数</th>
        <th class="num">Paid LR%</th><th class="num">Incurred LR%</th>
        <th class="num">Ultimate LR%</th><th class="num">IBNR(万)</th>
        <th>Method Weights</th>
    </tr></thead>
    <tbody>{''.join(rows)}</tbody>
    </table>"""


def _build_backtest_table(backtest):
    if not backtest:
        return "<p>未运行回测</p>"

    rows = []
    for vd, vd_data in sorted(backtest.items()):
        for yr, data in sorted(vd_data.items()):
            err = data.get("error_pp", 0)
            err_class = "mature" if abs(err) < 6 else "immature"
            rows.append(f"""<tr>
                <td>{vd}</td><td>{yr}</td>
                <td class="num">{data.get('predicted_ulr', '-'):.1f}%</td>
                <td class="num">{data.get('actual_current_lr', '-'):.1f}%</td>
                <td class="num {err_class}">{err:+.1f}pp</td>
            </tr>""")

    return f"""<table>
    <thead><tr>
        <th>Valuation Date</th><th>Cohort</th>
        <th class="num">Predicted ULR%</th><th class="num">Actual Current%</th>
        <th class="num">Error (pp)</th>
    </tr></thead>
    <tbody>{''.join(rows)}</tbody>
    </table>"""


def _build_dimension_section(dim_data):
    if not dim_data:
        return ""

    sections = []
    for dim_name, dim_records in dim_data.items():
        rows = []
        for rec in dim_records:
            z = rec.get("credibility_z", 0)
            z_class = "mature" if z >= 0.7 else ("mid" if z >= 0.3 else "immature")
            flag = ' <span class="flag badge-warn">⚠</span>' if rec.get("uncertainty_flag") else ""
            lr_key = "blended_lr" if "blended_lr" in rec else "applied_lr"
            rows.append(f"""<tr>
                <td>{rec.get('dimension_value', '')}{flag}</td>
                <td class="num">{rec.get('policy_count', 0):,}</td>
                <td class="num">{rec.get('claim_count', 0):,}</td>
                <td class="num"><strong>{_fmt(rec.get(lr_key))}</strong></td>
                <td class="num {z_class}">{z:.2f}</td>
                <td>{rec.get('method', '')}</td>
            </tr>""")

        sections.append(f"""<div class="card">
        <h2>维度: {dim_name}</h2>
        <table>
        <thead><tr>
            <th>Value</th><th class="num">保单数</th><th class="num">赔案数</th>
            <th class="num">Ultimate LR%</th><th class="num">Credibility Z</th><th>Method</th>
        </tr></thead>
        <tbody>{''.join(rows)}</tbody>
        </table></div>""")

    return "\n".join(sections)


def _fmt(v):
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:,.1f}"
    return str(v)
