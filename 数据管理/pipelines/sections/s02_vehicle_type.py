#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 2: 新转续过户维度 — 汇总 + 分项分年"""

from diagnose_common import GLOB, kpi_select

VEHICLE_TYPE_EXPR = """CASE
    WHEN 是否新车 THEN '新车'
    WHEN 是否过户车 THEN '旧车过户'
    WHEN 是否续保 THEN '旧车续保'
    ELSE '旧车转保'
END"""

VT_NAMES = ["新车", "旧车续保", "旧车转保", "旧车过户"]


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr

    # 2.0 汇总
    vt_data = {}
    vt_result = con.execute(f"""
    SELECT {kpi_select('车辆类型')}
    FROM (SELECT *, {VEHICLE_TYPE_EXPR} AS 车辆类型 FROM read_parquet('{GLOB}', union_by_name=true)
          WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}) sub
    GROUP BY 车辆类型
    """)
    vt_col_names = [d[0] for d in vt_result.description]
    for row in vt_result.fetchall():
        d = dict(zip(vt_col_names, row))
        vt_data[d["车辆类型"]] = d

    result = {"vt_data": vt_data, "vt_names": VT_NAMES}
    collected[2] = result

    if silent:
        return result

    rpt.add("## 2. 新转续过户维度\n")
    rpt.add("### 2.0 各年汇总\n")
    rpt.write_dim_summary_table(vt_data, VT_NAMES, "维度分析")

    # 2.1-2.4 分项
    for vt_name in VT_NAMES:
        idx = VT_NAMES.index(vt_name) + 1
        rpt.add(f"### 2.{idx} {vt_name}\n")
        vt_yr_data = {}
        for yr in years:
            rows = con.execute(f"""
            SELECT {kpi_select()}
            FROM (SELECT *, {VEHICLE_TYPE_EXPR} AS 车辆类型 FROM read_parquet('{GLOB}', union_by_name=true)
                  WHERE {base_where} AND {ctx.yr_where(yr)}) sub
            WHERE 车辆类型 = '{vt_name}'
            """)
            cols = [d[0] for d in rows.description]
            for row in rows.fetchall():
                vt_yr_data[yr] = dict(zip(cols, row))
        rpt.write_year_table(vt_yr_data, years)

    return result
