"""
项目侧 DuckDB 取数（精简版）
============================

仅按客户类别 7 类 + 合计 → 4 个核心指标：
- total_premium_wan          = SUM(premium) / 10000
- earned_premium_wan         = SUM(premium × earned_days / policy_term) / 10000
- reported_claim_count       = SUM(claim_cases)
- total_reported_claims_wan  = SUM(reported_claims) / 10000

赔款过滤策略（实证 2026-05-20）：
- claim_cases 不加过滤（保持件数对齐 xlsx）
- reported_claims 加过滤：
    1) 排除 liability_ratio=0（无责案件）
    2) 排除 case_type ∈ {零结/注销/拒赔}
"""
from __future__ import annotations
import duckdb
from . import config as _cfg
from .config import CUSTOMER_CATEGORY_CASES


def _build_sql(*, cutoff_date: str, policy_year_start: str) -> str:
    """单一 SQL：客户类别 7 类明细 + 合计 → 4 指标
    路径用 lazy lookup（_cfg.POLICY_PARQUET_GLOB），让 CLI 注入的覆盖值生效。
    """
    cc = CUSTOMER_CATEGORY_CASES

    return f"""
WITH PolicyFact AS (
  SELECT * FROM read_parquet('{_cfg.POLICY_PARQUET_GLOB}', union_by_name=true)
),
ClaimsDetail AS (
  SELECT * FROM read_parquet('{_cfg.CLAIMS_PARQUET_GLOB}', union_by_name=true)
),
-- 件数不过滤 + 赔款过滤（liability=0 / case_type 异常 不计入金额，但计入件数）
ClaimsAgg AS (
  SELECT policy_no,
         COUNT(DISTINCT claim_no) AS claim_cases,
         SUM(CASE
               WHEN COALESCE(liability_ratio, 100) > 0
                AND (case_type IS NULL OR case_type NOT IN ('零结','注销','拒赔'))
               THEN (CASE
                       WHEN settlement_time IS NOT NULL AND settlement_time <= DATE '{cutoff_date}'
                         THEN COALESCE(settled_amount, 0)
                       ELSE COALESCE(reserve_amount, 0)
                     END)
               ELSE 0
             END) AS reported_claims
  FROM ClaimsDetail
  WHERE policy_no IS NOT NULL
    AND report_time BETWEEN DATE '{policy_year_start}' AND DATE '{cutoff_date}'
  GROUP BY policy_no
),
policy_dedup AS (
  SELECT
    policy_no,
    CAST(insurance_start_date AS DATE) AS insurance_start_date,
    SUM(premium) AS premium,
    ANY_VALUE(customer_category) AS customer_category
  FROM PolicyFact
  WHERE insurance_start_date IS NOT NULL
    AND CAST(insurance_start_date AS DATE) BETWEEN DATE '{policy_year_start}' AND DATE '{cutoff_date}'
  GROUP BY policy_no, CAST(insurance_start_date AS DATE)
  HAVING SUM(premium) > 0
),
policy_exposure AS (
  SELECT
    p.policy_no,
    p.premium,
    p.customer_category,
    -- earned_days +1 含起保日（与 xlsx 周报口径一致）
    DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
    LEAST(
      GREATEST(DATEDIFF('day', p.insurance_start_date, DATE '{cutoff_date}') + 1, 0),
      DATEDIFF('day', p.insurance_start_date, p.insurance_start_date + INTERVAL 1 YEAR)
    ) AS earned_days,
    COALESCE(c.claim_cases, 0) AS claim_cases,
    COALESCE(c.reported_claims, 0) AS reported_claims
  FROM policy_dedup p
  LEFT JOIN ClaimsAgg c USING(policy_no)
),
detail AS (
  SELECT {cc} AS dim_1,
         ROUND(SUM(premium) / 10000.0, 6) AS total_premium_wan,
         ROUND(SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) / 10000.0, 6) AS earned_premium_wan,
         CAST(SUM(claim_cases) AS INTEGER) AS reported_claim_count,
         ROUND(SUM(reported_claims) / 10000.0, 6) AS total_reported_claims_wan
  FROM policy_exposure
  GROUP BY 1
),
total AS (
  SELECT '合计' AS dim_1,
         ROUND(SUM(premium) / 10000.0, 6) AS total_premium_wan,
         ROUND(SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) / 10000.0, 6) AS earned_premium_wan,
         CAST(SUM(claim_cases) AS INTEGER) AS reported_claim_count,
         ROUND(SUM(reported_claims) / 10000.0, 6) AS total_reported_claims_wan
  FROM policy_exposure
)
SELECT * FROM detail
UNION ALL
SELECT * FROM total
""".strip()


def query_all(cutoff_date: str, policy_year: str = '2026') -> list[dict]:
    """返回 客户类别 7 类 + 合计 行 × 4 指标 的 records。"""
    con = duckdb.connect(':memory:')
    sql = _build_sql(cutoff_date=cutoff_date, policy_year_start=f'{policy_year}-01-01')
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    con.close()

    metric_ids = ['total_premium_wan', 'earned_premium_wan', 'reported_claim_count', 'total_reported_claims_wan']
    dim_idx = cols.index('dim_1')
    metric_idx = {m: cols.index(m) for m in metric_ids}

    out: list[dict] = []
    for row in rows:
        dim_value = str(row[dim_idx]) if row[dim_idx] else '未知'
        for metric_id, idx in metric_idx.items():
            val = row[idx]
            if val is None: continue
            out.append({
                'sheet': 'customer_category',
                'policy_year': policy_year,
                'dim_path': [dim_value],
                'metric_id': metric_id,
                'value': float(val),
            })
    return out
