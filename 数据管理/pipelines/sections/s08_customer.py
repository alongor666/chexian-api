#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 8: customer_category — 含货车tonnage_segment子板块"""

from diagnose_common import GLOB, joined_source, kpi_select

TRUCK_CATS = {"营业货车", "非营业货车"}


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr
    src = joined_source(con)

    # 动态获取customer_category（过滤 <10 单的类别）
    cat_result = con.execute(f"""
    SELECT customer_category, COUNT(DISTINCT policy_no) AS cnt
    FROM {src}
    WHERE {base_where} AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
      AND customer_category IS NOT NULL
    GROUP BY customer_category ORDER BY cnt DESC
    """)
    cat_all = [(r[0], r[1]) for r in cat_result.fetchall()]
    cat_names = [c[0] for c in cat_all if c[1] >= 10]

    # 汇总
    cat_data = {}
    for cat in cat_names:
        c_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM {src}
        WHERE {base_where} AND customer_category = '{cat}' AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
        """)
        c_cols = [d[0] for d in c_result.description]
        for row in c_result.fetchall():
            cat_data[cat] = dict(zip(c_cols, row))

    result = {"cat_data": cat_data, "cat_names": cat_names}
    collected[8] = result

    if silent:
        return result

    rpt.add("## 8. customer_category\n")
    rpt.add("### 8.0 customer_category汇总\n")
    rpt.write_dim_summary_table(cat_data, cat_names, "类别分析")

    # 8.1+ 各customer_category年度明细
    for ci, cat in enumerate(cat_names):
        rpt.add(f"### 8.{ci + 1} {cat}\n")
        cat_yr = {}
        for yr in years:
            c_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM {src}
            WHERE {base_where} AND customer_category = '{cat}' AND {ctx.yr_where(yr)}
            """)
            c_cols = [d[0] for d in c_result.description]
            for row in c_result.fetchall():
                cat_yr[yr] = dict(zip(c_cols, row))
        rpt.write_year_table(cat_yr, years)

        # 货车类别：追加tonnage_segment子板块
        if cat in TRUCK_CATS:
            rpt.add(f"#### {cat} — tonnage_segment\n")
            ton_result = con.execute(f"""
            SELECT tonnage_segment, COUNT(DISTINCT policy_no) AS cnt
            FROM {src}
            WHERE {base_where} AND customer_category = '{cat}' AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
              AND tonnage_segment IS NOT NULL
            GROUP BY tonnage_segment ORDER BY cnt DESC
            """)
            ton_names = [r[0] for r in ton_result.fetchall()]

            # 吨位汇总表
            ton_data = {}
            for tn in ton_names:
                t_result = con.execute(f"""
                SELECT {kpi_select()}
                FROM {src}
                WHERE {base_where} AND customer_category = '{cat}' AND tonnage_segment = '{tn}'
                  AND YEAR(insurance_start_date) BETWEEN {min_yr} AND {max_yr}
                """)
                t_cols = [d[0] for d in t_result.description]
                for row in t_result.fetchall():
                    ton_data[tn] = dict(zip(t_cols, row))
            rpt.write_dim_summary_table(ton_data, ton_names, "吨位分析")

            # 各吨位段年度明细
            for ti, tn in enumerate(ton_names):
                rpt.add(f"##### {cat} {tn}\n")
                ton_yr = {}
                for yr in years:
                    t_result = con.execute(f"""
                    SELECT {kpi_select()}
                    FROM {src}
                    WHERE {base_where} AND customer_category = '{cat}' AND tonnage_segment = '{tn}' AND {ctx.yr_where(yr)}
                    """)
                    t_cols = [d[0] for d in t_result.description]
                    for row in t_result.fetchall():
                        ton_yr[yr] = dict(zip(t_cols, row))
                rpt.write_year_table(ton_yr, years)

    return result
