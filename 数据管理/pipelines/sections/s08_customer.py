#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 8: 客户类别 — 含货车吨位分段子板块"""

from diagnose_common import GLOB, kpi_select

TRUCK_CATS = {"营业货车", "非营业货车"}


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr

    # 动态获取客户类别（过滤 <10 单的类别）
    cat_result = con.execute(f"""
    SELECT 客户类别, COUNT(DISTINCT 保单号) AS cnt
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
      AND 客户类别 IS NOT NULL
    GROUP BY 客户类别 ORDER BY cnt DESC
    """)
    cat_all = [(r[0], r[1]) for r in cat_result.fetchall()]
    cat_names = [c[0] for c in cat_all if c[1] >= 10]

    # 汇总
    cat_data = {}
    for cat in cat_names:
        c_result = con.execute(f"""
        SELECT {kpi_select()}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND 客户类别 = '{cat}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
        """)
        c_cols = [d[0] for d in c_result.description]
        for row in c_result.fetchall():
            cat_data[cat] = dict(zip(c_cols, row))

    result = {"cat_data": cat_data, "cat_names": cat_names}
    collected[8] = result

    if silent:
        return result

    rpt.add("## 8. 客户类别\n")
    rpt.add("### 8.0 客户类别汇总\n")
    rpt.write_dim_summary_table(cat_data, cat_names, "类别分析")

    # 8.1+ 各客户类别年度明细
    for ci, cat in enumerate(cat_names):
        rpt.add(f"### 8.{ci + 1} {cat}\n")
        cat_yr = {}
        for yr in years:
            c_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 客户类别 = '{cat}' AND {ctx.yr_where(yr)}
            """)
            c_cols = [d[0] for d in c_result.description]
            for row in c_result.fetchall():
                cat_yr[yr] = dict(zip(c_cols, row))
        rpt.write_year_table(cat_yr, years)

        # 货车类别：追加吨位分段子板块
        if cat in TRUCK_CATS:
            rpt.add(f"#### {cat} — 吨位分段\n")
            ton_result = con.execute(f"""
            SELECT 吨位分段, COUNT(DISTINCT 保单号) AS cnt
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 客户类别 = '{cat}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
              AND 吨位分段 IS NOT NULL
            GROUP BY 吨位分段 ORDER BY cnt DESC
            """)
            ton_names = [r[0] for r in ton_result.fetchall()]

            # 吨位汇总表
            ton_data = {}
            for tn in ton_names:
                t_result = con.execute(f"""
                SELECT {kpi_select()}
                FROM read_parquet('{GLOB}', union_by_name=true)
                WHERE {base_where} AND 客户类别 = '{cat}' AND 吨位分段 = '{tn}'
                  AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
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
                    FROM read_parquet('{GLOB}', union_by_name=true)
                    WHERE {base_where} AND 客户类别 = '{cat}' AND 吨位分段 = '{tn}' AND {ctx.yr_where(yr)}
                    """)
                    t_cols = [d[0] for d in t_result.description]
                    for row in t_result.fetchall():
                        ton_yr[yr] = dict(zip(t_cols, row))
                rpt.write_year_table(ton_yr, years)

    return result
