#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 7: coverage_combination"""

from diagnose_common import GLOB, joined_source, kpi_select


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr
    src = joined_source(con)

    combo_result = con.execute(f"""
    SELECT DISTINCT coverage_combination
    FROM {src}
    WHERE {base_where} AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
      AND coverage_combination IS NOT NULL
    ORDER BY coverage_combination
    """)
    combo_names = [r[0] for r in combo_result.fetchall()]

    combo_data = {}
    for combo in combo_names:
        c_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM {src}
        WHERE {base_where} AND coverage_combination = '{combo}' AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
        """)
        c_cols = [d[0] for d in c_result.description]
        for row in c_result.fetchall():
            combo_data[combo] = dict(zip(c_cols, row))

    result = {"combo_data": combo_data, "combo_names": combo_names}
    collected[7] = result

    if silent:
        return result

    rpt.add("## 7. coverage_combination\n")
    rpt.add("### 7.0 coverage_combination汇总\n")
    rpt.write_dim_summary_table(combo_data, combo_names, "险别分析")

    for ci, combo in enumerate(combo_names):
        rpt.add(f"### 7.{ci + 1} {combo}\n")
        combo_yr = {}
        for yr in years:
            c_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM {src}
            WHERE {base_where} AND coverage_combination = '{combo}' AND {ctx.yr_where(yr)}
            """)
            c_cols = [d[0] for d in c_result.description]
            for row in c_result.fetchall():
                combo_yr[yr] = dict(zip(c_cols, row))
        rpt.write_year_table(combo_yr, years)

    return result
