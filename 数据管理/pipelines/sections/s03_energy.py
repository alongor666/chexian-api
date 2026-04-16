#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 3: 能源类型 — 非新-燃/非新-天/新能源"""

from diagnose_common import GLOB, joined_source, kpi_select

ENERGY_EXPR = """CASE
    WHEN is_nev THEN '新能源'
    ELSE '非新-燃'
END"""

ENERGY_NAMES = ["非新-燃", "非新-天", "新能源"]


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    min_yr, max_yr = ctx.min_yr, ctx.max_yr
    src = joined_source(con)

    en_data = {}
    en_result = con.execute(f"""
    SELECT {kpi_select('能源类型')}
    FROM (SELECT *, {ENERGY_EXPR} AS 能源类型 FROM {src}
          WHERE {base_where} AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}) sub
    GROUP BY 能源类型
    """)
    en_cols = [d[0] for d in en_result.description]
    for row in en_result.fetchall():
        d = dict(zip(en_cols, row))
        en_data[d["能源类型"]] = d
    for n in ENERGY_NAMES:
        if n not in en_data:
            en_data[n] = {}

    result = {"en_data": en_data, "energy_names": ENERGY_NAMES}
    collected[3] = result

    if not silent:
        rpt.add("## 3. 能源类型\n")
        rpt.add("### 3.0 能源类型汇总\n")
        rpt.write_dim_summary_table(en_data, ENERGY_NAMES, "能源分析")
        rpt.add("> ⚠️ 非新-天（天然气）暂无数据源，预留列位\n")

    return result
