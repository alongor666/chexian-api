#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 4: 风险评分 — 智能检测字段 + 无评分列"""

from diagnose_common import GLOB, joined_source, kpi_select


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    risk_expr = ctx.risk_expr
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr
    src = joined_source(con)

    # 获取实际等级值
    grades = con.execute(f"""
    SELECT DISTINCT {risk_expr} AS grade
    FROM {src}
    WHERE {base_where} AND {risk_expr} IS NOT NULL
    ORDER BY grade
    """).fetchall()
    grade_list = [g[0] for g in grades]
    grade_names = grade_list + ["无评分"]

    # 有评分的
    gr_data = {}
    for grade in grade_list:
        gr_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM {src}
        WHERE {base_where} AND {risk_expr} = '{grade}' AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
        """)
        gr_cols = [d[0] for d in gr_result.description]
        for row in gr_result.fetchall():
            gr_data[grade] = dict(zip(gr_cols, row))

    # 无评分的
    gr_null = con.execute(f"""
    SELECT {kpi_select()}
    FROM {src}
    WHERE {base_where} AND {risk_expr} IS NULL AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
    """)
    gr_null_cols = [d[0] for d in gr_null.description]
    for row in gr_null.fetchall():
        gr_data["无评分"] = dict(zip(gr_null_cols, row))

    result = {"gr_data": gr_data, "grade_names": grade_names, "grade_list": grade_list}
    collected[4] = result

    if silent:
        return result

    rpt.add("## 4. 风险评分\n")
    rpt.add("### 4.0 风险评分汇总\n")
    rpt.write_dim_summary_table(gr_data, grade_names, "评分分析")

    # 4.1+ 分项
    for i, grade in enumerate(grade_list):
        rpt.add(f"### 4.{i + 1} 等级 {grade}\n")
        g_yr_data = {}
        for yr in years:
            g_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM {src}
            WHERE {base_where} AND {risk_expr} = '{grade}' AND {ctx.yr_where(yr)}
            """)
            g_cols = [d[0] for d in g_result.description]
            for row in g_result.fetchall():
                g_yr_data[yr] = dict(zip(g_cols, row))
        rpt.write_year_table(g_yr_data, years)

    return result
