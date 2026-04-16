#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块 11: 品牌维度 — JOIN dim/brand/latest.parquet 提取品牌+用途大类

品牌是高基数维度（100+），使用纵向表格（品牌作为行）而非横向展开。
汇总表展示核心风险指标，年度明细仅展开 Top 10。
"""

from pathlib import Path
from diagnose_common import (
    GLOB, kpi_select, escape_sql, joined_source,
    fw, fp, fi, fc, light,
    TH_VC, TH_MR, TH_LR, TH_IR, TH_AC_CARGO,
)

BRAND_DIM = str(Path(__file__).resolve().parent.parent.parent
                / "warehouse/dim/brand/latest.parquet")

# 品牌 Top N 阈值（保单数 ≥ 此值才展示）
MIN_POLICIES = 50
# 年度明细展示 Top N
DETAIL_TOP_N = 10


def _write_brand_table(rpt, brand_data, brand_names):
    """纵向品牌汇总表：品牌作为行，核心指标作为列"""
    rpt.add("| 品牌_用途 | 保单数 | 签单premium | 满期premium | 赔款 | 赔付率 | 出险率 | 案均赔款† | 费用率 | 变动成本率 | 边际贡献额 | 系数 |")
    rpt.add("|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for brand in brand_names:
        d = brand_data.get(brand, {})
        vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
        coeff = fc(d.get("pricing_coeff"))
        rpt.add(
            f"| {brand} "
            f"| {fi(d.get('policy_count'))} "
            f"| {fw(d.get('written_premium'))} "
            f"| {fw(d.get('earned_premium'))} "
            f"| {fw(d.get('reported_claims'))} "
            f"| {fp(d.get('loss_ratio'))}{light(d.get('loss_ratio'), TH_LR)} "
            f"| {fp(d.get('incident_rate'))}{light(d.get('incident_rate'), TH_IR)} "
            f"| {fi(d.get('avg_claim'))}{light(d.get('avg_claim'), TH_AC_CARGO)} "
            f"| {fp(d.get('expense_ratio'))} "
            f"| {fp(vc)}{light(vc, TH_VC)} "
            f"| {fw(d.get('earned_margin'))} "
            f"| {coeff} |"
        )
    rpt.add()


def run(ctx, rpt, collected, silent=False):
    con = ctx.con
    base_where = ctx.base_where
    years = ctx.years
    min_yr, max_yr = ctx.min_yr, ctx.max_yr

    # 检查维度表是否存在
    if not Path(BRAND_DIM).exists():
        msg = (f"> ⚠️ 品牌维度表不存在: {BRAND_DIM}\n"
               "> 运行 `python3 数据管理/warehouse/dim/brand/generate_brand_dim.py` 生成\n")
        if not silent:
            rpt.add("## 11. 品牌维度\n")
            rpt.add(msg)
        return {"error": "brand_dim_not_found"}

    # 11.0 品牌汇总 Top N（一次性 GROUP BY 查询，避免 N+1）
    src = joined_source(con)
    brand_result = con.execute(f"""
    SELECT b.品牌_用途,
        {kpi_select()}
    FROM {src} p
    JOIN read_parquet('{BRAND_DIM}') b ON p.vehicle_model = b.vehicle_model
    WHERE {base_where} AND YEAR(p.insurance_start_date) BETWEEN {min_yr} AND {max_yr}
    GROUP BY b.品牌_用途
    HAVING COUNT(DISTINCT p.policy_no) >= {MIN_POLICIES}
    ORDER BY SUM(p.premium) DESC
    """)
    b_cols = [d[0] for d in brand_result.description]
    brand_rows = [dict(zip(b_cols, row)) for row in brand_result.fetchall()]

    brand_names = [r["品牌_用途"] for r in brand_rows]
    brand_data = {r["品牌_用途"]: r for r in brand_rows}

    result = {"brand_data": brand_data, "brand_names": brand_names}
    collected[11] = result

    if silent:
        return result

    rpt.add("## 11. 品牌维度\n")
    rpt.add(f"### 11.0 品牌×用途汇总（保单≥{MIN_POLICIES}，共 {len(brand_names)} 个品牌_用途组合，按premium降序）\n")
    _write_brand_table(rpt, brand_data, brand_names)

    # 11.1+ 各品牌年度明细（仅 Top N）
    for ci, brand in enumerate(brand_names[:DETAIL_TOP_N]):
        rpt.add(f"### 11.{ci + 1} {brand}\n")
        brand_yr = {}
        for yr in years:
            b_result = con.execute(f"""
            SELECT {kpi_select()}
            FROM {src} p
            JOIN read_parquet('{BRAND_DIM}') b ON p.vehicle_model = b.vehicle_model
            WHERE {base_where} AND b.品牌_用途 = '{escape_sql(brand)}' AND {ctx.yr_where(yr)}
            """)
            b_cols2 = [d[0] for d in b_result.description]
            for row in b_result.fetchall():
                brand_yr[yr] = dict(zip(b_cols2, row))
        rpt.write_year_table(brand_yr, years)

    return result
