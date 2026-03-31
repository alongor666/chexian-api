#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 6: 险类 — 商业险/交强险"""

from diagnose_common import GLOB, kpi_select

INS_TYPES = ["商业保险", "交强险"]


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years

    ins_data = {}
    for itype in INS_TYPES:
        i_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND 险类 = '{itype}'
        """)
        i_cols = [d[0] for d in i_result.description]
        for row in i_result.fetchall():
            ins_data[itype] = dict(zip(i_cols, row))

    result = {"ins_data": ins_data}
    collected[6] = result

    if silent:
        return result

    rpt.add("## 6. 险类\n")
    rpt.add("### 6.0 险类汇总\n")
    rpt.write_dim_summary_table(ins_data, INS_TYPES, "险类分析")

    for i, itype in enumerate(INS_TYPES):
        rpt.add(f"### 6.{i + 1} {itype}\n")
        ins_yr = {}
        for yr in years:
            i_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 险类 = '{itype}' AND {ctx.yr_where(yr)}
            """)
            i_cols = [d[0] for d in i_result.description]
            for row in i_result.fetchall():
                ins_yr[yr] = dict(zip(i_cols, row))
        rpt.write_year_table(ins_yr, years)

    return result
