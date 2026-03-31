#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 7: 险别组合"""

from diagnose_common import GLOB, kpi_select


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr

    combo_result = con.execute(f"""
    SELECT DISTINCT 险别组合
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
      AND 险别组合 IS NOT NULL
    ORDER BY 险别组合
    """)
    combo_names = [r[0] for r in combo_result.fetchall()]

    combo_data = {}
    for combo in combo_names:
        c_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND 险别组合 = '{combo}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
        """)
        c_cols = [d[0] for d in c_result.description]
        for row in c_result.fetchall():
            combo_data[combo] = dict(zip(c_cols, row))

    result = {"combo_data": combo_data, "combo_names": combo_names}
    collected[7] = result

    if silent:
        return result

    rpt.add("## 7. 险别组合\n")
    rpt.add("### 7.0 险别组合汇总\n")
    rpt.write_dim_summary_table(combo_data, combo_names, "险别分析")

    for ci, combo in enumerate(combo_names):
        rpt.add(f"### 7.{ci + 1} {combo}\n")
        combo_yr = {}
        for yr in years:
            c_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 险别组合 = '{combo}' AND {ctx.yr_where(yr)}
            """)
            c_cols = [d[0] for d in c_result.description]
            for row in c_result.fetchall():
                combo_yr[yr] = dict(zip(c_cols, row))
        rpt.write_year_table(combo_yr, years)

    return result
