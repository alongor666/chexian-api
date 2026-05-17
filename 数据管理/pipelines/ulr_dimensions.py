#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR 维度切片层 — 独立 Cohort / Relativity / 双阈值可信度收缩

维度分层：
  独立三角形：customer_category, coverage_combination, org_level_3
  Relativity-on-global：insurance_grade, is_nev, is_new_car, tonnage_segment
"""

import duckdb
import pandas as pd

from ulr_triangle import (
    CLAIMS_PATH,
    POLICY_GLOB,
    build_current_incurred_snapshot,
    build_earned_premium,
    build_paid_triangle,
)
from ulr_methods import (
    calc_cape_cod_lr,
    calc_cdfs,
    calc_paid_ldfs,
    dynamic_blend,
    estimate_tail,
    get_cdf_at_dev,
    get_maturity_dev,
    predict_bf,
    predict_benktander,
    predict_chain_ladder,
    select_ldfs,
)


# ============================================================================
# 可信度收缩
# ============================================================================

def credibility_blend(
    segment_lr: float,
    global_lr: float,
    n_policies: int,
    n_claims: int,
    min_policies: int = 5000,
    min_claims: int = 300,
    k_policy: int = 2000,
    k_claim: int = 150,
) -> tuple[float, float]:
    """双阈值 Bühlmann 可信度收缩。

    独立建模阈值：policy_count >= min_policies AND claim_count >= min_claims
    极小样本（policy < 100 或 claim < 30）：直接回退全局

    Returns:
        (blended_lr, credibility_Z)
    """
    if n_policies < 100 or n_claims < 30:
        return global_lr, 0.0

    z_pol = n_policies / (n_policies + k_policy)
    z_clm = n_claims / (n_claims + k_claim)
    z = min(z_pol, z_clm)

    blended = z * segment_lr + (1.0 - z) * global_lr
    return blended, z


# ============================================================================
# 独立 Cohort 维度预测
# ============================================================================

INDEPENDENT_DIMENSIONS = ["customer_category", "coverage_combination", "org_level_3"]


def predict_independent_dimension(
    con: duckdb.DuckDBPyConnection,
    dimension_col: str,
    global_ultimate_lr: float,
    global_prior_lr: float,
    cohort_years: list[int],
    valuation_date: str = "2026-04-05",
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> pd.DataFrame:
    """对独立维度，逐值建 paid triangle 并预测终极赔付率。

    小样本维度值自动收缩到全局。

    Returns:
        DataFrame: dimension_value | segment_ultimate_lr | credibility_z |
                   blended_lr | policy_count | claim_count | method | uncertainty_flag
    """
    # 获取该维度的所有取值及样本量
    snapshot = build_current_incurred_snapshot(
        con, cohort_years, valuation_date,
        where_clause=f"customer_category != '摩托车'" if dimension_col != "customer_category"
                      else None,
        policy_glob=policy_glob, claims_path=claims_path,
    )
    total_policies = int(snapshot["policy_count"].sum())
    total_claims = int(snapshot["claim_count"].sum())

    # 查各维度值的保单数和赔案数
    from ulr_triangle import _origin_policy_cte
    origin_cte = _origin_policy_cte(policy_glob, valuation_date, cohort_years,
                                     "customer_category != '摩托车'" if dimension_col != "customer_category" else None)
    sql = f"""
    WITH {origin_cte}
    SELECT
        p.{dimension_col} AS dim_value,
        COUNT(DISTINCT p.policy_no) AS policy_count,
        COUNT(DISTINCT c.claim_no) AS claim_count
    FROM origin_policy p
    LEFT JOIN read_parquet('{claims_path}') c ON c.policy_no = p.policy_no
    GROUP BY p.{dimension_col}
    ORDER BY policy_count DESC
    """
    dim_stats = con.sql(sql).fetchdf()

    results = []
    for _, row in dim_stats.iterrows():
        dim_val = row["dim_value"]
        n_pol = int(row["policy_count"])
        n_clm = int(row["claim_count"])

        if dim_val is None or str(dim_val).strip() == "":
            dim_val = "(空值)"

        # 判断是否有足够样本独立建模
        if n_pol >= 5000 and n_clm >= 300:
            # 独立建 paid triangle
            where = f"{dimension_col} = '{dim_val}'"
            if dimension_col != "customer_category":
                where += " AND customer_category != '摩托车'"

            try:
                seg_triangle = build_paid_triangle(
                    con, cohort_years, dev_months=list(range(1, 61)),
                    valuation_date=valuation_date, where_clause=where,
                    policy_glob=policy_glob, claims_path=claims_path,
                )
                seg_ep = build_earned_premium(
                    con, cohort_years, valuation_date=valuation_date,
                    where_clause=where, policy_glob=policy_glob,
                )

                if seg_triangle.empty or not seg_ep:
                    raise ValueError("Empty triangle")

                # 计算 LDF → CDF → predictions
                all_ldfs = calc_paid_ldfs(seg_triangle)
                ldfs = select_ldfs(all_ldfs)
                if not ldfs:
                    raise ValueError("No LDFs")
                tail = estimate_tail(ldfs)
                cdfs = calc_cdfs(ldfs, tail)

                # 用最新年份的 blend 作为该维度的终极 LR
                cl_res = predict_chain_ladder(seg_triangle, seg_ep, cdfs, valuation_date)
                cdfs_at_dev = {yr: get_cdf_at_dev(cdfs, get_maturity_dev(yr, valuation_date))
                               for yr in cohort_years if yr in seg_ep}
                current_paid = {yr: r["current_paid"] for yr, r in cl_res.items()}

                cape_cod_prior = calc_cape_cod_lr(
                    current_paid, seg_ep, cdfs_at_dev,
                    [y for y in [2021, 2022, 2023] if y in current_paid],
                )
                bf_res = predict_bf(current_paid, seg_ep, cape_cod_prior, cdfs_at_dev)
                cl_lr_map = {yr: r["ultimate_lr"] for yr, r in cl_res.items() if r["ultimate_lr"]}
                bk_res = predict_benktander(current_paid, seg_ep, cape_cod_prior, cdfs_at_dev, cl_lr_map)

                blend = dynamic_blend(cl_res, bf_res, bk_res, seg_ep, valuation_date)
                # 取最新 cohort 的混合 LR 作为该维度代表值
                latest_yr = max(blend.keys())
                seg_lr = blend[latest_yr]["ultimate_lr_blend"]
                method = "independent_triangle"
                uncertainty = blend[latest_yr]["uncertainty_flag"]

            except Exception:
                seg_lr = global_ultimate_lr
                method = "fallback_global"
                uncertainty = True
        else:
            seg_lr = global_ultimate_lr
            method = "credibility_shrink"
            uncertainty = n_pol < 500 or n_clm < 50

        # 可信度收缩
        blended, z = credibility_blend(
            seg_lr if seg_lr else global_ultimate_lr,
            global_ultimate_lr, n_pol, n_clm,
        )

        results.append({
            "dimension_value": str(dim_val),
            "segment_ultimate_lr": round(seg_lr, 2) if seg_lr else None,
            "credibility_z": round(z, 3),
            "blended_lr": round(blended, 2),
            "policy_count": n_pol,
            "claim_count": n_clm,
            "method": method,
            "uncertainty_flag": uncertainty,
        })

    return pd.DataFrame(results)


# ============================================================================
# Relativity 维度预测
# ============================================================================

RELATIVITY_DIMENSIONS = ["insurance_grade", "is_nev", "is_new_car", "tonnage_segment"]


def calc_relativities(
    con: duckdb.DuckDBPyConnection,
    dimension_col: str,
    global_ultimate_lr: float,
    cohort_years: list[int],
    valuation_date: str = "2026-04-05",
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> pd.DataFrame:
    """计算历史 LR 相对系数 → 乘以全局 prior。

    relativity = segment_historical_LR / global_historical_LR
    applied_lr = global_ultimate_lr × relativity

    Returns:
        DataFrame: dimension_value | historical_lr | global_lr | relativity |
                   applied_lr | policy_count | claim_count | method | uncertainty_flag
    """
    from ulr_triangle import _origin_policy_cte
    origin_cte = _origin_policy_cte(policy_glob, valuation_date, cohort_years,
                                     "customer_category != '摩托车'")
    sql = f"""
    WITH {origin_cte}
    SELECT
        p.{dimension_col}::VARCHAR AS dim_value,
        COUNT(DISTINCT p.policy_no) AS policy_count,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        SUM(p.premium * GREATEST(p.earned_factor, 0)) AS earned_premium,
        SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END) AS incurred
    FROM origin_policy p
    LEFT JOIN read_parquet('{claims_path}') c ON c.policy_no = p.policy_no
    GROUP BY p.{dimension_col}
    ORDER BY earned_premium DESC
    """
    dim_df = con.sql(sql).fetchdf()

    # 全局 LR
    total_ep = dim_df["earned_premium"].sum()
    total_inc = dim_df["incurred"].sum()
    global_hist_lr = (total_inc / total_ep * 100) if total_ep > 0 else 65.0

    results = []
    for _, row in dim_df.iterrows():
        dim_val = row["dim_value"]
        n_pol = int(row["policy_count"])
        n_clm = int(row["claim_count"])
        ep = float(row["earned_premium"])
        inc = float(row["incurred"])

        hist_lr = (inc / ep * 100) if ep > 0 else None
        relativity = (hist_lr / global_hist_lr) if hist_lr and global_hist_lr > 0 else 1.0
        raw_applied = global_ultimate_lr * relativity

        # 可信度收缩
        blended, z = credibility_blend(raw_applied, global_ultimate_lr, n_pol, n_clm)

        results.append({
            "dimension_value": str(dim_val) if dim_val is not None else "(空值)",
            "historical_lr": round(hist_lr, 2) if hist_lr else None,
            "global_lr": round(global_hist_lr, 2),
            "relativity": round(relativity, 3),
            "applied_lr": round(blended, 2),
            "policy_count": n_pol,
            "claim_count": n_clm,
            "credibility_z": round(z, 3),
            "method": "relativity_on_global",
            "uncertainty_flag": z < 0.5,
        })

    return pd.DataFrame(results)


# ============================================================================
# 全维度预测入口
# ============================================================================

def predict_all_dimensions(
    con: duckdb.DuckDBPyConnection,
    global_ultimate_lr: float,
    global_prior_lr: float,
    cohort_years: list[int],
    valuation_date: str = "2026-04-05",
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> dict[str, pd.DataFrame]:
    """对所有维度进行预测。

    Returns:
        {dimension_col: DataFrame}
    """
    results = {}

    for dim in INDEPENDENT_DIMENSIONS:
        print(f"  → 独立三角形维度: {dim}")
        results[dim] = predict_independent_dimension(
            con, dim, global_ultimate_lr, global_prior_lr,
            cohort_years, valuation_date, policy_glob, claims_path,
        )

    for dim in RELATIVITY_DIMENSIONS:
        print(f"  → 相对系数维度: {dim}")
        results[dim] = calc_relativities(
            con, dim, global_ultimate_lr, cohort_years,
            valuation_date, policy_glob, claims_path,
        )

    return results
