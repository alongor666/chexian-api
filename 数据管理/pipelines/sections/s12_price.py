#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 12: new_vehicle_price分段 — 直接从原始 Parquet 的new_vehicle_price字段分段聚合"""

from diagnose_common import GLOB, joined_source, kpi_select

# 车价分段定义（标签, 下限, 上限）
PRICE_SEGMENTS = [
    ("≤5万",    0,      50000),
    ("5-10万",  50000,  100000),
    ("10-15万", 100000, 150000),
    ("15-20万", 150000, 200000),
    ("20-30万", 200000, 300000),
    ("30-50万", 300000, 500000),
    ("50-100万", 500000, 1000000),
    (">100万",  1000000, 999999999),
]

# 生成 SQL CASE 表达式
PRICE_CASE = "CASE\n" + "\n".join(
    f"            WHEN new_vehicle_price > {lo} AND new_vehicle_price <= {hi} THEN '{label}'"
    if lo > 0 else
    f"            WHEN new_vehicle_price <= {hi} THEN '{label}'"
    for label, lo, hi in PRICE_SEGMENTS
) + "\n            ELSE '未知'\n        END"


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr
    src = joined_source(con)

    # 12.0 车价分段汇总
    seg_names = [s[0] for s in PRICE_SEGMENTS]

    seg_data = {}
    for label, lo, hi in PRICE_SEGMENTS:
        price_cond = (f"new_vehicle_price <= {hi}" if lo == 0
                      else f"new_vehicle_price > {lo} AND new_vehicle_price <= {hi}")
        s_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM {src}
        WHERE {base_where} AND {price_cond}
          AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
        """)
        s_cols = [d[0] for d in s_result.description]
        for row in s_result.fetchall():
            d = dict(zip(s_cols, row))
            if d.get("policy_count", 0) and d["policy_count"] > 0:
                seg_data[label] = d

    active_segs = [s for s in seg_names if s in seg_data]

    result = {"seg_data": seg_data, "seg_names": active_segs}
    collected[12] = result

    if silent:
        return result

    rpt.add("## 12. new_vehicle_price分段\n")
    rpt.add("### 12.0 车价分段汇总\n")
    rpt.write_dim_summary_table(seg_data, active_segs, "车价分析")

    # 12.1+ 各车价段年度明细
    for ci, label in enumerate(active_segs):
        lo, hi = [(l, h) for lb, l, h in PRICE_SEGMENTS if lb == label][0]
        price_cond = (f"new_vehicle_price <= {hi}" if lo == 0
                      else f"new_vehicle_price > {lo} AND new_vehicle_price <= {hi}")

        rpt.add(f"### 12.{ci + 1} {label}\n")
        seg_yr = {}
        for yr in years:
            s_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM {src}
            WHERE {base_where} AND {price_cond} AND {ctx.yr_where(yr)}
            """)
            s_cols = [d[0] for d in s_result.description]
            for row in s_result.fetchall():
                seg_yr[yr] = dict(zip(s_cols, row))
        rpt.write_year_table(seg_yr, years)

    return result
