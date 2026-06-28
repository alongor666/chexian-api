#!/usr/bin/env python3
"""
摩托车满期赔付率 24 个月发展分析 — 离线单网页生成器

数据源：
  - PolicyFact（保单粒度）→ 保费、保单数（分母）
  - ClaimsDetail（赔案粒度）→ 立案金额、赔案数（分子，按 accident_time 锚定发展月）

用法：
  python3 moto_loss_ratio_development.py [-o OUTPUT_PATH]
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_common import branch_paths

# ── 路径 ──

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_BRANCH_CODE = (os.environ.get("BRANCH_CODE") or "SC").strip() or "SC"
_PATHS = branch_paths(_BRANCH_CODE)
POLICY_GLOB = _PATHS["policy_glob"]
CLAIMS_PATH = _PATHS["claims_glob"]
OUTPUT_DIR = REPO_ROOT / "数据管理/数据分析报告"
ECHARTS_LOCAL = Path(__file__).resolve().parent / "assets" / "echarts.min.js"

# ── 配置 ──

COHORT_YEARS = [2023, 2024, 2025, 2026]
MAX_DEV_MONTH = 24
COLORS = {2023: "#38bdf8", 2024: "#34d399", 2025: "#fb923c", 2026: "#f472b6"}


def run_triangle_query(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """日历发展三角形：M_N 的观察窗口 = [年初, 年初+N个月)，累计扩展。

    M1: 起保+出险都在1月 → M2: 都在1-2月 → ... → M12: 全年
    M13~M24: 保单仍是全年的，出险窗口继续向次年扩展。
    """
    sql = f"""
    WITH claims_cutoff_cte AS (
        SELECT COALESCE(CAST(MAX(report_time) AS DATE), CURRENT_DATE) AS claims_cutoff FROM read_parquet('{CLAIMS_PATH}')
    ),
    raw_policies AS (
        SELECT
            YEAR(insurance_start_date) AS cohort_year,
            policy_no,
            insurance_start_date,
            premium,
            DATE_DIFF('day', insurance_start_date,
                      insurance_start_date + INTERVAL 1 YEAR) AS policy_term_days
        FROM read_parquet('{POLICY_GLOB}', union_by_name := true)
        WHERE customer_category = '摩托车'
          AND YEAR(insurance_start_date) IN ({','.join(str(y) for y in COHORT_YEARS)})
    ),
    policies AS (
        SELECT cohort_year, policy_no, insurance_start_date,
               SUM(premium) AS premium,
               MAX(policy_term_days) AS policy_term_days
        FROM raw_policies
        GROUP BY cohort_year, policy_no, insurance_start_date
        HAVING SUM(premium) > 0
    ),
    policy_totals AS (
        SELECT cohort_year,
            COUNT(DISTINCT policy_no) AS total_policies,
            SUM(premium) AS total_premium
        FROM policies GROUP BY cohort_year
    ),
    dev_months AS (SELECT UNNEST(RANGE(1, {MAX_DEV_MONTH + 1})) AS dev_month),
    -- 日历窗口：observation_end = 年初 + dev_month 个月
    calendar_window AS (
        SELECT
            pt.cohort_year,
            m.dev_month,
            MAKE_DATE(pt.cohort_year, 1, 1) AS year_start,
            MAKE_DATE(pt.cohort_year, 1, 1) + to_months(m.dev_month) AS observation_end
        FROM policy_totals pt
        CROSS JOIN dev_months m
        WHERE MAKE_DATE(pt.cohort_year, 1, 1) + to_months(m.dev_month)
              <= (SELECT claims_cutoff FROM claims_cutoff_cte)
    ),
    -- 已赚保费：只含起保日 < observation_end 的保单
    earned AS (
        SELECT
            cw.cohort_year, cw.dev_month,
            COUNT(DISTINCT p.policy_no) AS dev_policies,
            SUM(p.premium
                * LEAST(
                    DATE_DIFF('day', p.insurance_start_date, cw.observation_end),
                    p.policy_term_days
                  )::DOUBLE
                / p.policy_term_days
            ) AS earned_premium,
            SUM(
                LEAST(
                    DATE_DIFF('day', p.insurance_start_date, cw.observation_end),
                    p.policy_term_days
                )::DOUBLE
                / p.policy_term_days
            ) AS earned_exposure
        FROM calendar_window cw
        JOIN policies p
            ON p.cohort_year = cw.cohort_year
           AND p.insurance_start_date >= cw.year_start
           AND p.insurance_start_date <  cw.observation_end
        GROUP BY cw.cohort_year, cw.dev_month
    ),
    -- 赔案：报案时间 < observation_end（IBNR 发展口径），且保单在窗口内
    -- 已决/未决按 settlement_time 分类：已结案取 settled_amount，未结案取 reserve_amount
    claimed AS (
        SELECT
            cw.cohort_year, cw.dev_month,
            COUNT(DISTINCT c.claim_no) AS claim_count,
            SUM(
                CASE
                    WHEN c.settlement_time IS NOT NULL
                         AND c.settlement_time < cw.observation_end
                    THEN COALESCE(c.settled_amount, 0)
                    ELSE COALESCE(c.reserve_amount, 0)
                END
            ) AS total_reserve
        FROM calendar_window cw
        JOIN policies p
            ON p.cohort_year = cw.cohort_year
           AND p.insurance_start_date >= cw.year_start
           AND p.insurance_start_date <  cw.observation_end
        LEFT JOIN read_parquet('{CLAIMS_PATH}') c
            ON c.policy_no = p.policy_no
           AND c.report_time < cw.observation_end
        GROUP BY cw.cohort_year, cw.dev_month
    )
    SELECT
        e.cohort_year,
        e.dev_month,
        pt.total_policies,
        ROUND(pt.total_premium / 1e4, 1) AS total_premium_wan,
        e.dev_policies,
        ROUND(e.earned_premium, 2) AS earned_premium,
        cl.claim_count,
        ROUND(cl.total_reserve, 2) AS total_reserve,
        ROUND(cl.total_reserve / NULLIF(e.earned_premium, 0) * 100, 2) AS loss_ratio_pct,
        ROUND(cl.claim_count * 100.0 / NULLIF(e.earned_exposure, 0), 4) AS incident_rate_pct,
        CASE WHEN cl.claim_count > 0
             THEN ROUND(cl.total_reserve / cl.claim_count, 0)
             ELSE NULL END AS avg_claim,
        ROUND(e.dev_policies * 100.0 / pt.total_policies, 1) AS coverage_pct
    FROM earned e
    JOIN claimed cl ON e.cohort_year = cl.cohort_year AND e.dev_month = cl.dev_month
    JOIN policy_totals pt ON e.cohort_year = pt.cohort_year
    ORDER BY e.cohort_year, e.dev_month
    """
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    return [dict(zip(cols, row)) for row in rows]


def build_chart_data(rows: list[dict]) -> dict:
    """将查询结果转为前端 JSON 结构"""
    today = datetime.today().strftime("%Y-%m-%d")
    result = {
        "meta": {"generated_at": datetime.now().isoformat(timespec="seconds"), "today": today},
        "cohorts": {},
    }

    for yr in COHORT_YEARS:
        sub = sorted([r for r in rows if r["cohort_year"] == yr], key=lambda r: r["dev_month"])
        lookup = {r["dev_month"]: r for r in sub}
        max_dev = max((r["dev_month"] for r in sub), default=0)

        # 覆盖率 < 5% 的数据点不可信，设为 None（图表自然截断）
        MIN_COVERAGE_PCT = 5.0

        def series(col):
            return [
                (float(lookup[m][col])
                 if m in lookup and lookup[m][col] is not None
                    and (col == "coverage_pct" or lookup[m].get("coverage_pct", 0) >= MIN_COVERAGE_PCT)
                 else None)
                for m in range(1, MAX_DEV_MONTH + 1)
            ]

        result["cohorts"][yr] = {
            "dev_months": list(range(1, MAX_DEV_MONTH + 1)),
            "loss_ratio": series("loss_ratio_pct"),
            "incident_rate": series("incident_rate_pct"),
            "avg_claim": series("avg_claim"),
            "earned_premium": series("earned_premium"),
            "claim_count": series("claim_count"),
            "total_reserve": series("total_reserve"),
            "coverage_pct": series("coverage_pct"),
            "policy_count": int(sub[0]["total_policies"]) if sub else 0,
            "total_premium_wan": float(sub[0]["total_premium_wan"]) if sub else 0,
            "max_dev_month": max_dev,
        }

    return result


def load_echarts_js() -> str:
    """加载 ECharts JS（本地优先，CDN 回退）"""
    if ECHARTS_LOCAL.exists():
        return ECHARTS_LOCAL.read_text(encoding="utf-8")
    print("[WARN] 本地 ECharts 不存在，使用 CDN 标签（离线不可用）")
    return None


def render_html(data: dict) -> str:
    """生成完整 HTML 字符串"""
    data_json = json.dumps(data, ensure_ascii=False)
    data_json_safe = data_json.replace("</", "<\\/")

    echarts_js = load_echarts_js()
    if echarts_js:
        echarts_tag = f"<script>{echarts_js}</script>"
    else:
        echarts_tag = '<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>'

    cohort_years_js = json.dumps(COHORT_YEARS)
    colors_js = json.dumps(COLORS)

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>摩托车满期赔付率发展分析</title>
{echarts_tag}
<style>
:root {{
  --bg:#0b1220; --panel:#0f1b31; --panel2:#111f3a;
  --text:#e7eefc; --muted:#9bb0d4; --border:rgba(255,255,255,0.10);
  --c2023:#38bdf8; --c2024:#34d399; --c2025:#fb923c; --c2026:#f472b6;
  --warn:#f59e0b; --bad:#fb7185; --ok:#2dd4bf;
  --mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  --sans:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:var(--sans);background:radial-gradient(1200px 600px at 10% 0%,rgba(45,212,191,0.12),transparent 55%),radial-gradient(1000px 500px at 90% 10%,rgba(251,113,133,0.10),transparent 55%),var(--bg);color:var(--text)}}
.wrap{{max-width:1200px;margin:0 auto;padding:0 16px}}
header{{padding:18px 16px 12px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,0.04),transparent)}}
h1{{font-size:18px;margin:0 0 4px}}
.meta{{color:var(--muted);font-size:12px}}
.kpi-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px 0}}
.kpi-card{{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center}}
.kpi-card .label{{color:var(--muted);font-size:12px;margin-bottom:4px}}
.kpi-card .value{{font-size:22px;font-weight:700;font-family:var(--mono)}}
.kpi-card .sub{{color:var(--muted);font-size:11px;margin-top:4px}}
.tabs{{display:flex;gap:8px;padding:12px 0;flex-wrap:wrap}}
button.tab{{border:1px solid var(--border);background:rgba(255,255,255,0.03);color:var(--text);padding:7px 14px;border-radius:10px;cursor:pointer;font-size:13px;transition:all .15s}}
button.tab:hover{{background:rgba(255,255,255,0.08)}}
button.tab.active{{background:rgba(56,189,248,0.18);border-color:var(--c2023);color:#fff}}
.chart-table-wrap{{overflow-x:auto;margin-bottom:24px}}
#chart{{width:100%;height:380px;margin:0}}
table{{width:100%;border-collapse:collapse;font-size:10px;font-family:var(--mono);table-layout:fixed}}
th{{background:var(--panel);color:var(--muted);font-weight:500;text-align:center;padding:4px 0;border-bottom:1px solid var(--border);white-space:nowrap;overflow:hidden}}
th.yr-col{{width:50px;text-align:center}}
td{{padding:3px 1px;text-align:center;border-bottom:1px solid var(--border);white-space:nowrap}}
td:first-child{{color:var(--muted);font-weight:500}}
tr:hover td{{background:rgba(255,255,255,0.03)}}
.partial{{color:var(--warn)}}
.footnote{{color:var(--muted);font-size:12px;line-height:1.6;padding:16px 0 32px;border-top:1px solid var(--border)}}
.yr-tag{{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:middle}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>摩托车满期赔付率 24 个月发展分析</h1>
    <div class="meta">
      生成时间: {data["meta"]["generated_at"]} &nbsp;|&nbsp;
      口径: 立案金额(ClaimsDetail) / 已赚保费(PolicyFact) &nbsp;|&nbsp;
      客户类别 = 摩托车
    </div>
  </header>

  <div class="kpi-grid" id="kpi"></div>
  <div class="tabs" id="tabs"></div>
  <div class="chart-table-wrap">
    <div id="chart"></div>
    <table id="triangle"></table>
  </div>

  <div class="footnote">
    <b>方法论说明（日历发展口径）</b><br/>
    1. 发展月 M 的观察窗口 = [年初, 年初+M个月)。M1=1月, M2=1-2月, ..., M12=全年, M18=至次年6月。<br/>
    2. 保单范围：起保日在窗口内的保单（M &le; 12 时逐月扩大，M &gt; 12 时为全年保单）。<br/>
    3. 赔案范围：出险时间在窗口内 &amp; 保单在窗口内。<br/>
    4. 已赚保费 = 保费 &times; min(起保日到窗口末端天数, 保险期间) / 保险期间。<br/>
    5. 赔款 = 按赔案结案状态二选一：已结案取 settled_amount，未结案取 reserve_amount。<br/>
    6. 满期出险率 = 赔案数 / 已赚暴露。已赚暴露 = &Sigma; min(观察天数, 保险期间) / 保险期间，年化可比。<br/>
    7. 覆盖率 = 窗口内保单数 / 该年全部保单数。M12 时 &asymp; 100%。
  </div>
</div>

<script id="DATA" type="application/json">{data_json_safe}</script>
<script>
window.addEventListener('load', function() {{
  const DATA = JSON.parse(document.getElementById('DATA').textContent);
  const YEARS = {cohort_years_js};
  const COLORS = {colors_js};
  const METRICS = [
    {{key:'loss_ratio', label:'满期赔付率(%)', unit:'%', decimals:2}},
    {{key:'incident_rate', label:'满期出险率(%)', unit:'%', decimals:4}},
    {{key:'avg_claim', label:'案均立案金额(元)', unit:'元', decimals:0}}
  ];
  let currentMetric = 0;
  let chart;

  // ── KPI 卡片 ──
  const kpiEl = document.getElementById('kpi');
  YEARS.forEach(yr => {{
    const c = DATA.cohorts[yr];
    const m12 = c.loss_ratio[11];
    const maxM = c.max_dev_month;
    const latestLR = c.loss_ratio[maxM - 1];
    const lrLabel = maxM >= 12
      ? (m12 !== null ? m12.toFixed(2) + '%' : '—')
      : (latestLR !== null ? latestLR.toFixed(2) + '% (M' + maxM + ')' : '—');

    kpiEl.innerHTML += `
      <div class="kpi-card" style="border-top:3px solid ${{COLORS[yr]}}">
        <div class="label"><span class="yr-tag" style="background:${{COLORS[yr]}}"></span>${{yr}}年</div>
        <div class="value">${{lrLabel}}</div>
        <div class="sub">
          ${{c.policy_count.toLocaleString()}}单 &nbsp;|&nbsp;
          ${{c.total_premium_wan.toLocaleString()}}万保费
        </div>
      </div>`;
  }});

  // ── Tab 按钮 ──
  const tabsEl = document.getElementById('tabs');
  METRICS.forEach((m, i) => {{
    const btn = document.createElement('button');
    btn.className = 'tab' + (i === 0 ? ' active' : '');
    btn.textContent = m.label;
    btn.onclick = () => {{
      currentMetric = i;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderChart();
      renderTable();
    }};
    tabsEl.appendChild(btn);
  }});

  // ── 图表 ──
  chart = echarts.init(document.getElementById('chart'));

  function renderChart() {{
    const m = METRICS[currentMetric];
    const series = YEARS.map(yr => {{
      const c = DATA.cohorts[yr];
      const vals = c[m.key];
      const cov = c.coverage_pct;

      return {{
        name: String(yr),
        type: 'line', data: vals, connectNulls: false,
        smooth: true, symbol: 'circle', symbolSize: 4,
        lineStyle: {{width: 2.5}}, itemStyle: {{color: COLORS[yr]}},
        markPoint: m.key === 'loss_ratio' && vals[11] != null ? {{
          data: [{{coord: [11, vals[11]], symbol: 'pin', symbolSize: 30,
                   label: {{formatter: v => v.value != null ? v.value.toFixed(1)+'%' : '', fontSize:10}}}}]
        }} : undefined
      }};
    }});

    chart.setOption({{
      backgroundColor: 'transparent',
      tooltip: {{
        trigger: 'axis',
        formatter: params => {{
          const idx = params[0]?.dataIndex;
          let html = `<b>发展月 M${{idx+1}}</b><br/>`;
          YEARS.forEach(yr => {{
            const c = DATA.cohorts[yr];
            const v = c[m.key][idx];
            const cov = c.coverage_pct[idx];
            const partial = cov !== null && cov < 99.9 ? ` <span style="color:#f59e0b">(${{cov.toFixed(0)}}%覆盖)</span>` : '';
            const vStr = v !== null ? (m.decimals > 0 ? v.toFixed(m.decimals) : Math.round(v).toLocaleString()) + m.unit : '—';
            html += `<span style="color:${{COLORS[yr]}}">●</span> ${{yr}}: ${{vStr}}${{partial}}<br/>`;
          }});
          return html;
        }}
      }},
      legend: {{
        data: YEARS.map(String),
        textStyle: {{color:'#9bb0d4'}}, top: 5
      }},
      grid: {{left:50, right:10, top:45, bottom:5}},
      xAxis: {{
        type: 'category',
        data: Array.from({{length:24}}, (_,i) => 'M'+(i+1)),
        axisLabel: {{show:false}},
        axisTick: {{show:false}},
        axisLine: {{lineStyle:{{color:'rgba(255,255,255,0.1)'}}}}
      }},
      yAxis: {{
        type: 'value', name: m.label,
        min: function(value) {{ return Math.floor(value.min * 0.9 / 10) * 10; }},
        nameTextStyle: {{color:'#9bb0d4', fontSize:11}},
        axisLabel: {{color:'#9bb0d4', formatter: v => m.unit==='%' ? v+'%' : v.toLocaleString()}},
        splitLine: {{lineStyle:{{color:'rgba(255,255,255,0.06)'}}}}
      }},
      series: series
    }}, true);
  }}

  // ── 数据表（行=年份，列=M1~M24，与图表 x 轴对齐）──
  function renderTable() {{
    const m = METRICS[currentMetric];
    const tbl = document.getElementById('triangle');
    // colgroup: 年度列固定 50px，剩余 24 列等分（减去右侧 10px 留白）
    let html = '<colgroup><col style="width:50px">';
    for (let i = 0; i < 24; i++) html += '<col>';
    html += '</colgroup>';
    html += '<thead><tr><th class="yr-col"></th>';
    for (let i = 0; i < 24; i++) {{
      const isM12 = i === 11;
      const cls = isM12 ? ' style="border-left:2px solid rgba(56,189,248,0.4)"' : '';
      html += `<th${{cls}}>M${{i+1}}</th>`;
    }}
    html += '</tr></thead><tbody>';

    YEARS.forEach(yr => {{
      const c = DATA.cohorts[yr];
      html += `<tr><td><span class="yr-tag" style="background:${{COLORS[yr]}}"></span>${{yr}}</td>`;
      for (let i = 0; i < 24; i++) {{
        const v = c[m.key][i];
        const cov = c.coverage_pct[i];
        const isM12 = i === 11;
        const vStr = v !== null
          ? (m.unit === '元' ? Math.round(v).toLocaleString() : v.toFixed(1))
          : '';
        const partial = cov !== null && cov < 99.9 ? ' class="partial"' : '';
        const m12 = isM12 ? 'border-left:2px solid rgba(56,189,248,0.4);' : '';
        html += `<td${{partial}} style="${{m12}}">${{vStr}}</td>`;
      }}
      html += '</tr>';
    }});
    html += '</tbody>';
    tbl.innerHTML = html;
  }}

  renderChart();
  renderTable();
  window.addEventListener('resize', () => chart.resize());
}});
</script>
</body>
</html>"""


def main():
    parser = argparse.ArgumentParser(description="摩托车满期赔付率发展分析 HTML 生成器")
    parser.add_argument("-o", "--output", help="输出 HTML 路径")
    args = parser.parse_args()

    print("=" * 70)
    print("摩托车满期赔付率 24 个月发展分析")
    print("=" * 70)

    con = duckdb.connect()

    print("[1/3] 查询发展三角形数据...")
    rows = run_triangle_query(con)
    print(f"  → {len(rows)} 行数据")

    for yr in COHORT_YEARS:
        sub = [r for r in rows if r["cohort_year"] == yr]
        max_m = max((r["dev_month"] for r in sub), default=0)
        print(f"  {yr}: {len(sub)} 个月 (M1~M{max_m})")

    print("[2/3] 构建图表数据...")
    data = build_chart_data(rows)

    print("[3/3] 生成 HTML...")
    html = render_html(data)

    out_path = Path(args.output) if args.output else (
        OUTPUT_DIR / f"摩托车满期赔付率发展_{datetime.today().strftime('%Y%m%d')}.html"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")

    size_kb = out_path.stat().st_size / 1024
    print(f"\n[OK] 报告已生成: {out_path}")
    print(f"     文件大小: {size_kb:.0f} KB")
    print(f"     离线可用: {'是' if ECHARTS_LOCAL.exists() else '否(需网络加载ECharts)'}")

    con.close()


if __name__ == "__main__":
    main()
