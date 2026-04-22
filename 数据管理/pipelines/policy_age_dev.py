#!/usr/bin/env python3
"""
保单年龄发展口径 — 共享 SQL 构建模块

与 moto_loss_ratio_development.py 的"日历发展口径"（按自然月/年份锚定）不同：
本模块按**保单自身起期**锚定，每张保单从 insurance_start_date +N 天看累计赔付状态。
适用任意车型细分的 90/180/270/满期 四桩诊断。

核心概念：
  - eligible 保单 = 该桩所需发展天数已过估值日的保单
  - observation window = [start_date, start_date + min(N, policy_term))
  - 已赚保费 = premium * min(N, policy_term) / policy_term
  - 已赚暴露 = min(N, policy_term) / 365（年化可比）

使用：
    from pipelines.policy_age_dev import build_main_table_sql
    sql = build_main_table_sql(
        policy_parquet_glob="...",
        claims_parquet_glob="...",
        where_clause="is_new_car=TRUE AND ...",
        valuation_date="DATE '2026-04-21'",
        stages=[("90天", 90), ("180天", 180), ("270天", 270), ("满期", None)],
    )
"""
from __future__ import annotations


def build_cohort_cte(policy_glob: str, where_clause: str) -> str:
    """构建 base cohort CTE：按保单唯一化 + 净保费 + 最长保期"""
    return f"""
  base AS (
    SELECT policy_no,
      MIN(insurance_start_date) AS start_date,
      MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) AS term_days,
      SUM(premium) AS premium
    FROM read_parquet('{policy_glob}', union_by_name := true)
    WHERE {where_clause}
    GROUP BY policy_no
    HAVING SUM(premium) > 0
       AND MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) > 0
  )
""".strip()


def build_stages_cte(stages: list[tuple[str, int | None]]) -> str:
    """构建 stages CTE：(name, days_param) 元组列表，days_param=None 表示满期"""
    lines = []
    for i, (name, days) in enumerate(stages, 1):
        days_val = "NULL" if days is None else str(days)
        lines.append(f"('{name}', {days_val}, {i})")
    values = ",\n      ".join(lines)
    return f"""
  stages AS (
    SELECT * FROM (VALUES
      {values}
    ) AS t(stage, days_param, ord)
  )
""".strip()


def build_policy_stage_cte(valuation_date: str) -> str:
    """构建 policy × stage 笛卡尔 + eligible + 已赚指标"""
    return f"""
  policy_stage AS (
    SELECT s.stage, s.ord, s.days_param,
      b.policy_no, b.start_date, b.term_days, b.premium,
      CASE WHEN s.days_param IS NULL THEN b.start_date + b.term_days * INTERVAL 1 DAY
           ELSE b.start_date + LEAST(s.days_param, b.term_days) * INTERVAL 1 DAY
      END AS window_end,
      CASE WHEN s.days_param IS NULL THEN b.start_date + b.term_days * INTERVAL 1 DAY <= {valuation_date}
           ELSE b.start_date + s.days_param * INTERVAL 1 DAY <= {valuation_date}
      END AS eligible,
      CASE WHEN s.days_param IS NULL THEN b.term_days / 365.0
           ELSE LEAST(s.days_param, b.term_days) / 365.0
      END AS earned_exposure,
      CASE WHEN s.days_param IS NULL THEN b.premium
           ELSE b.premium * LEAST(s.days_param, b.term_days)::DOUBLE / b.term_days
      END AS earned_premium
    FROM base b CROSS JOIN stages s
  ),
  eligible_policies AS (SELECT * FROM policy_stage WHERE eligible = TRUE)
""".strip()


def build_claims_agg_cte(claims_glob: str, valuation_date: str) -> str:
    """按桩聚合赔案数 + 赔款（已结用 settled，未结用 reserve）"""
    return f"""
  claims_agg AS (
    SELECT ep.stage, ep.ord,
      COUNT(DISTINCT c.claim_no) AS claim_count,
      SUM(CASE WHEN c.settlement_time IS NOT NULL AND c.settlement_time <= {valuation_date}
               THEN COALESCE(c.settled_amount, 0)
               ELSE COALESCE(c.reserve_amount, 0)
          END) AS total_loss
    FROM eligible_policies ep
    LEFT JOIN read_parquet('{claims_glob}', union_by_name := true) c
      ON c.policy_no = ep.policy_no
     AND c.accident_time >= ep.start_date
     AND c.accident_time <  ep.window_end
     AND c.accident_time <= {valuation_date}
    GROUP BY ep.stage, ep.ord
  )
""".strip()


def build_main_table_sql(
    policy_parquet_glob: str,
    claims_parquet_glob: str,
    where_clause: str,
    valuation_date: str = "DATE '2026-04-21'",
    stages: list[tuple[str, int | None]] | None = None,
) -> str:
    """主表 SQL：四桩发展指标。

    Returns:
        SELECT ord, stage, 件数, 保费_万, 已赚保费_万, 已赚暴露, 赔案数,
               已报告赔款_万, 案均赔款_元, 满期出险率_pct, 满期赔付率_pct
    """
    if stages is None:
        stages = [("90天", 90), ("180天", 180), ("270天", 270), ("满期", None)]

    return f"""
WITH {build_cohort_cte(policy_parquet_glob, where_clause)},
{build_stages_cte(stages)},
{build_policy_stage_cte(valuation_date)},
{build_claims_agg_cte(claims_parquet_glob, valuation_date)}
SELECT ep.ord, ep.stage,
  COUNT(DISTINCT ep.policy_no) AS 件数,
  ROUND(SUM(ep.premium)/1e4, 2) AS 保费_万,
  ROUND(SUM(ep.earned_premium)/1e4, 2) AS 已赚保费_万,
  ROUND(SUM(ep.earned_exposure), 2) AS 已赚暴露,
  COALESCE(ca.claim_count, 0) AS 赔案数,
  ROUND(COALESCE(ca.total_loss, 0)/1e4, 2) AS 已报告赔款_万,
  ROUND(COALESCE(ca.total_loss, 0) / NULLIF(ca.claim_count, 0), 0) AS 案均赔款_元,
  ROUND(COALESCE(ca.claim_count, 0) * 100.0 / NULLIF(SUM(ep.earned_exposure), 0), 2) AS 满期出险率_pct,
  ROUND(COALESCE(ca.total_loss, 0) * 100.0 / NULLIF(SUM(ep.earned_premium), 0), 2) AS 满期赔付率_pct
FROM eligible_policies ep
LEFT JOIN claims_agg ca USING(ord, stage)
GROUP BY ep.ord, ep.stage, ca.claim_count, ca.total_loss
ORDER BY ep.ord
""".strip()


def build_cohort_summary_sql(
    policy_parquet_glob: str,
    where_clause: str,
    start_date: str,
    end_date: str,
) -> str:
    """Cohort 概览：总件数/保费/起期范围/年度拆分"""
    return f"""
WITH {build_cohort_cte(policy_parquet_glob, where_clause)}
SELECT
  COUNT(*) AS 保单数,
  ROUND(SUM(premium)/1e4, 2) AS 保费_万,
  MIN(start_date)::DATE AS 最早起期,
  MAX(start_date)::DATE AS 最晚起期,
  SUM(CASE WHEN start_date < DATE '{end_date[:4]}-01-01' THEN 1 ELSE 0 END) AS 起保_较早,
  SUM(CASE WHEN start_date >= DATE '{end_date[:4]}-01-01' THEN 1 ELSE 0 END) AS 起保_较晚
FROM base
""".strip()


def build_vehicle_model_drill_sql(
    policy_parquet_glob: str,
    claims_parquet_glob: str,
    where_clause: str,
    valuation_date: str = "DATE '2026-04-21'",
    min_count: int = 20,
    top_n: int = 15,
) -> str:
    """按厂牌车型累计口径下钻"""
    return f"""
WITH {build_cohort_cte(policy_parquet_glob, where_clause)},
with_model AS (
  SELECT b.*, (SELECT MIN(vehicle_model) FROM read_parquet('{policy_parquet_glob}', union_by_name := true) p
               WHERE p.policy_no = b.policy_no) AS model,
    LEAST(DATE_DIFF('day', b.start_date, {valuation_date}), b.term_days) AS observed_days
  FROM base b
),
claims AS (
  SELECT m.policy_no,
    COUNT(DISTINCT c.claim_no) AS claim_count,
    SUM(CASE WHEN c.settlement_time IS NOT NULL AND c.settlement_time <= {valuation_date}
             THEN COALESCE(c.settled_amount, 0)
             ELSE COALESCE(c.reserve_amount, 0)
        END) AS loss
  FROM with_model m
  LEFT JOIN read_parquet('{claims_parquet_glob}', union_by_name := true) c
    ON c.policy_no = m.policy_no
   AND c.accident_time >= m.start_date
   AND c.accident_time <= {valuation_date}
  GROUP BY m.policy_no
)
SELECT m.model AS 厂牌车型,
  COUNT(DISTINCT m.policy_no) AS 件数,
  ROUND(SUM(m.premium)/1e4, 1) AS 保费_万,
  ROUND(SUM(m.premium * m.observed_days::DOUBLE / m.term_days)/1e4, 1) AS 已赚保费_万,
  COALESCE(SUM(cl.claim_count), 0) AS 赔案数,
  ROUND(COALESCE(SUM(cl.loss), 0)/1e4, 1) AS 已报告赔款_万,
  ROUND(COALESCE(SUM(cl.loss), 0) / NULLIF(SUM(cl.claim_count), 0), 0) AS 案均_元,
  ROUND(COALESCE(SUM(cl.loss), 0) * 100.0
        / NULLIF(SUM(m.premium * m.observed_days::DOUBLE / m.term_days), 0), 1) AS 满期赔付率_pct,
  ROUND(COALESCE(SUM(cl.claim_count), 0) * 100.0
        / NULLIF(SUM(m.observed_days::DOUBLE / 365), 0), 1) AS 满期出险率_pct
FROM with_model m
LEFT JOIN claims cl USING(policy_no)
GROUP BY m.model
HAVING COUNT(DISTINCT m.policy_no) >= {min_count}
ORDER BY 件数 DESC
LIMIT {top_n}
""".strip()
