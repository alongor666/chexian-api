#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR 三角形构建层 — Paid / Closure / Current Incurred Snapshot

数据层红线：
  - Origin policy 基表仅保留 endorsement_no IS NULL 的原始承保记录
  - Paid triangle 按 settlement_time 锚定（覆盖 99%），不用 payment_time（仅 62%）
  - Current incurred snapshot 仅用于 valuation date 时点，不构造伪历史 as-of

v1 Snapshot-Constrained ULR。
"""

from pathlib import Path

import duckdb
import pandas as pd

# ── 路径 ──

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
POLICY_GLOB = str(REPO_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
CLAIMS_PATH = str(REPO_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")


# ============================================================================
# Origin Policy CTE (共享)
# ============================================================================

def _origin_policy_cte(
    policy_glob: str,
    valuation_date: str,
    cohort_years: list[int],
    where_clause: str | None = None,
) -> str:
    """生成 origin_policy CTE SQL 片段。"""
    years_csv = ",".join(str(y) for y in cohort_years)
    extra_where = f"AND ({where_clause})" if where_clause else ""
    return f"""
    origin_policy AS (
        SELECT
            policy_no,
            YEAR(insurance_start_date)  AS cohort_year,
            insurance_start_date,
            premium,
            customer_category,
            coverage_combination,
            insurance_grade,
            org_level_3,
            is_nev, is_new_car, is_renewal,
            tonnage_segment,
            DATE_DIFF('day', insurance_start_date,
                      insurance_start_date + INTERVAL 1 YEAR) AS policy_term_days,
            LEAST(
                DATE_DIFF('day', insurance_start_date, '{valuation_date}'::DATE),
                DATE_DIFF('day', insurance_start_date,
                          insurance_start_date + INTERVAL 1 YEAR)
            )::DOUBLE /
            NULLIF(DATE_DIFF('day', insurance_start_date,
                             insurance_start_date + INTERVAL 1 YEAR), 0)::DOUBLE
                AS earned_factor
        FROM read_parquet('{policy_glob}', union_by_name := true)
        WHERE endorsement_no IS NULL
          AND YEAR(insurance_start_date) IN ({years_csv})
          AND premium > 0
          {extra_where}
    )"""


# ============================================================================
# 1. Paid Triangle
# ============================================================================

def build_paid_triangle(
    con: duckdb.DuckDBPyConnection,
    cohort_years: list[int],
    dev_months: list[int] | None = None,
    valuation_date: str = "CURRENT_DATE",
    where_clause: str | None = None,
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> pd.DataFrame:
    """构建 paid triangle: 按 settlement_time 锚定的累计已付赔款。

    Returns:
        DataFrame: index=cohort_year, columns=dev_month(int), values=cumulative paid (元)
        不可用窗口为 NaN。
    """
    if dev_months is None:
        dev_months = list(range(1, 61))  # 1-60 月

    vd = valuation_date if valuation_date != "CURRENT_DATE" else "CURRENT_DATE"
    vd_sql = f"'{vd}'::DATE" if vd != "CURRENT_DATE" else "CURRENT_DATE"
    vd_for_cte = vd if vd != "CURRENT_DATE" else "2026-04-05"

    dev_csv = ",".join(str(m) for m in dev_months)
    origin_cte = _origin_policy_cte(policy_glob, vd_for_cte, cohort_years, where_clause)

    sql = f"""
    WITH
    {origin_cte},
    dev_points AS (SELECT UNNEST([{dev_csv}]) AS dev_month),
    -- 评估截止点：cohort 年初 + dev_month 个月
    eval_grid AS (
        SELECT
            op.cohort_year,
            dp.dev_month,
            MAKE_DATE(op.cohort_year, 1, 1) + to_months(dp.dev_month) AS eval_cutoff
        FROM (SELECT DISTINCT cohort_year FROM origin_policy) op
        CROSS JOIN dev_points dp
        WHERE MAKE_DATE(op.cohort_year, 1, 1) + to_months(dp.dev_month) <= {vd_sql}
    ),
    -- 关联赔案：settlement_time < eval_cutoff 的累计 paid
    paid AS (
        SELECT
            eg.cohort_year,
            eg.dev_month,
            SUM(COALESCE(c.settled_amount, 0)) AS cum_paid
        FROM eval_grid eg
        JOIN origin_policy p ON p.cohort_year = eg.cohort_year
        LEFT JOIN read_parquet('{claims_path}') c
            ON c.policy_no = p.policy_no
           AND c.settlement_time IS NOT NULL
           AND c.settlement_time < eg.eval_cutoff
        GROUP BY eg.cohort_year, eg.dev_month
    )
    SELECT cohort_year, dev_month, cum_paid
    FROM paid
    ORDER BY cohort_year, dev_month
    """
    rows = con.sql(sql).fetchall()
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["cohort_year", "dev_month", "cum_paid"])
    pivot = df.pivot(index="cohort_year", columns="dev_month", values="cum_paid")
    return pivot


# ============================================================================
# 2. Closure Triangle
# ============================================================================

def build_closure_triangle(
    con: duckdb.DuckDBPyConnection,
    cohort_years: list[int],
    dev_months: list[int] | None = None,
    valuation_date: str = "CURRENT_DATE",
    where_clause: str | None = None,
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> pd.DataFrame:
    """构建 closure triangle: 按 settlement_time 的累计已结案件数。

    Returns:
        DataFrame: index=cohort_year, columns=dev_month, values=cumulative closed count
    """
    if dev_months is None:
        dev_months = list(range(1, 61))

    vd = valuation_date if valuation_date != "CURRENT_DATE" else "CURRENT_DATE"
    vd_sql = f"'{vd}'::DATE" if vd != "CURRENT_DATE" else "CURRENT_DATE"
    vd_for_cte = vd if vd != "CURRENT_DATE" else "2026-04-05"

    dev_csv = ",".join(str(m) for m in dev_months)
    origin_cte = _origin_policy_cte(policy_glob, vd_for_cte, cohort_years, where_clause)

    sql = f"""
    WITH
    {origin_cte},
    dev_points AS (SELECT UNNEST([{dev_csv}]) AS dev_month),
    eval_grid AS (
        SELECT
            op.cohort_year,
            dp.dev_month,
            MAKE_DATE(op.cohort_year, 1, 1) + to_months(dp.dev_month) AS eval_cutoff
        FROM (SELECT DISTINCT cohort_year FROM origin_policy) op
        CROSS JOIN dev_points dp
        WHERE MAKE_DATE(op.cohort_year, 1, 1) + to_months(dp.dev_month) <= {vd_sql}
    ),
    closed AS (
        SELECT
            eg.cohort_year,
            eg.dev_month,
            COUNT(DISTINCT c.claim_no) AS cum_closed
        FROM eval_grid eg
        JOIN origin_policy p ON p.cohort_year = eg.cohort_year
        LEFT JOIN read_parquet('{claims_path}') c
            ON c.policy_no = p.policy_no
           AND c.settlement_time IS NOT NULL
           AND c.settlement_time < eg.eval_cutoff
           AND c.claim_status = '已业务结案'
        GROUP BY eg.cohort_year, eg.dev_month
    )
    SELECT cohort_year, dev_month, cum_closed
    FROM closed
    ORDER BY cohort_year, dev_month
    """
    rows = con.sql(sql).fetchall()
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["cohort_year", "dev_month", "cum_closed"])
    pivot = df.pivot(index="cohort_year", columns="dev_month", values="cum_closed")
    return pivot


# ============================================================================
# 3. Current Incurred Snapshot (valuation date 时点快照)
# ============================================================================

def build_current_incurred_snapshot(
    con: duckdb.DuckDBPyConnection,
    cohort_years: list[int],
    valuation_date: str = "CURRENT_DATE",
    where_clause: str | None = None,
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> pd.DataFrame:
    """当前时点的 incurred snapshot（非历史 as-of）。

    Returns:
        DataFrame: cohort_year | policy_count | claim_count |
                   current_paid | current_pending | current_incurred |
                   earned_premium | current_paid_lr | current_incurred_lr
    """
    vd_for_cte = valuation_date if valuation_date != "CURRENT_DATE" else "2026-04-05"
    origin_cte = _origin_policy_cte(policy_glob, vd_for_cte, cohort_years, where_clause)

    sql = f"""
    WITH
    {origin_cte},
    agg AS (
        SELECT
            p.cohort_year,
            COUNT(DISTINCT p.policy_no) AS policy_count,
            COUNT(DISTINCT c.claim_no)  AS claim_count,
            SUM(COALESCE(c.settled_amount, 0))  AS current_paid,
            SUM(CASE WHEN c.settlement_time IS NULL THEN COALESCE(c.reserve_amount, 0)
                     ELSE 0 END)  AS current_pending,
            SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END) AS current_incurred
        FROM origin_policy p
        LEFT JOIN read_parquet('{claims_path}') c ON c.policy_no = p.policy_no
        GROUP BY p.cohort_year
    ),
    ep AS (
        SELECT
            cohort_year,
            SUM(premium * GREATEST(earned_factor, 0)) AS earned_premium
        FROM origin_policy
        GROUP BY cohort_year
    )
    SELECT
        a.cohort_year,
        a.policy_count,
        a.claim_count,
        a.current_paid,
        a.current_pending,
        a.current_incurred,
        e.earned_premium,
        ROUND(a.current_paid / NULLIF(e.earned_premium, 0) * 100, 2)     AS current_paid_lr,
        ROUND(a.current_incurred / NULLIF(e.earned_premium, 0) * 100, 2) AS current_incurred_lr
    FROM agg a
    JOIN ep e ON e.cohort_year = a.cohort_year
    ORDER BY a.cohort_year
    """
    rows = con.sql(sql).fetchall()
    cols = [
        "cohort_year", "policy_count", "claim_count",
        "current_paid", "current_pending", "current_incurred",
        "earned_premium", "current_paid_lr", "current_incurred_lr",
    ]
    return pd.DataFrame(rows, columns=cols).set_index("cohort_year")


# ============================================================================
# 4. Earned Premium
# ============================================================================

def build_earned_premium(
    con: duckdb.DuckDBPyConnection,
    cohort_years: list[int],
    valuation_date: str = "CURRENT_DATE",
    where_clause: str | None = None,
    policy_glob: str = POLICY_GLOB,
) -> dict[int, float]:
    """返回 {cohort_year: earned_premium (元)}。"""
    vd_for_cte = valuation_date if valuation_date != "CURRENT_DATE" else "2026-04-05"
    origin_cte = _origin_policy_cte(policy_glob, vd_for_cte, cohort_years, where_clause)

    sql = f"""
    WITH {origin_cte}
    SELECT cohort_year, SUM(premium * GREATEST(earned_factor, 0)) AS ep
    FROM origin_policy
    GROUP BY cohort_year
    ORDER BY cohort_year
    """
    rows = con.sql(sql).fetchall()
    return {int(r[0]): float(r[1]) for r in rows}
