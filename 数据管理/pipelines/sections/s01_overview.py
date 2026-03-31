#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 1: 整体经营概况 — 按年份展开 + 趋势分析"""

from diagnose_common import query_kpi


def run(ctx, rpt, collected, silent=False):
    yr_data = {}
    for yr in ctx.years:
        rows = query_kpi(ctx.con, f"{ctx.base_where} AND {ctx.yr_where(yr)}")
        if rows:
            yr_data[yr] = rows[0]

    result = {"yr_data": yr_data}
    collected[1] = result

    if not silent:
        rpt.add("## 1. 整体经营概况\n")
        rpt.write_year_table(yr_data, ctx.years)

    return result
