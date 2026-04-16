#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 5: 季度趋势 — 汇总表 + 7 个 ASCII 条形图"""

from diagnose_common import GLOB, joined_source, kpi_select, get_metric_value


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    src = joined_source(con)

    q_result = con.execute(f"""
    SELECT
        YEAR(policy_date)::INT * 10 + QUARTER(policy_date)::INT AS q_sort,
        SUBSTR(CAST(YEAR(policy_date) AS VARCHAR), 3, 2) || 'Q' || CAST(QUARTER(policy_date) AS VARCHAR) AS quarter_label,
        {kpi_select()}
    FROM {src} WHERE {base_where}
    GROUP BY q_sort, quarter_label
    ORDER BY q_sort DESC LIMIT 24
    """)
    q_cols = [d[0] for d in q_result.description]
    q_rows_raw = [dict(zip(q_cols, r)) for r in q_result.fetchall()]
    q_rows_raw.reverse()

    result = {"q_rows_raw": q_rows_raw}
    collected[5] = result

    if silent:
        return result

    rpt.add("## 5. 季度趋势\n")

    # 5.0 汇总表
    rpt.add("### 5.0 季度汇总\n")
    q_table_rows = []
    for d in q_rows_raw:
        vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
        q_table_rows.append([
            d["quarter_label"],
            d.get("earned_margin"),
            d.get("written_premium"),
            round(vc, 1) if vc else None,
            d.get("expense_ratio"),
            d.get("loss_ratio"),
            d.get("incident_rate"),
            d.get("avg_claim"),
        ])
    rpt.write_quarter_table(q_table_rows,
        ["季度", "边际贡献额", "签单premium", "变动成本率", "费用率", "满期赔付率", "满期出险率", "案均赔款 †"])

    # 5.1-5.7 条形图
    q_labels = [d["quarter_label"] for d in q_rows_raw]
    chart_items = [
        ("5.1 满期边际贡献额", "earned_margin", "万"),
        ("5.2 签单premium", "written_premium", "万"),
        ("5.3 变动成本率", "_vc", "%"),
        ("5.4 费用率", "expense_ratio", "%"),
        ("5.5 满期赔付率", "loss_ratio", "%"),
        ("5.6 满期出险率", "incident_rate", "%"),
        ("5.7 案均赔款", "avg_claim", "†"),
    ]
    for title_str, key, unit in chart_items:
        vals = [get_metric_value(d, key) for d in q_rows_raw]
        rpt.write_bar_chart(title_str, q_labels, vals, unit)

    return result
