#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""基准满期赔付率评估脚本。

核心链路：
1. 基准保费 baseline_premium
2. 满期基准保费 baseline_earned_premium
3. 满期基准赔付率 baseline_earned_claim_ratio

默认用全量非营业个人客车作为等级基准池，再把基准赔付率套到目标经代
（默认“邮政”）的真实自主系数业务上。
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path
import re
import sys
from typing import Any

try:
    import duckdb
except ImportError:  # pragma: no cover - CLI guard
    print("ERROR: duckdb not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class EvaluationParams:
    policy_source: str
    claims_source: str
    start_date: date
    end_date: date
    target_start_date: date | None = None
    target_end_date: date | None = None
    valuation_date: date | None = None
    date_field: str = "insurance_start_date"
    target_date_field: str | None = None
    customer_category: str = "非营业个人客车"
    target_agent_pattern: str = "%邮政%"
    grade_null_value: str = "X"
    commercial_insurance_type: str = "商业保险"
    policy_no_field: str = "policy_no"
    insurance_start_field: str = "insurance_start_date"
    insurance_end_field: str = "insurance_end_date"
    premium_field: str = "premium"
    agent_field: str = "agent_name"
    customer_category_field: str = "customer_category"
    insurance_type_field: str = "insurance_type"
    insurance_grade_field: str = "insurance_grade"
    pricing_factor_field: str = "commercial_pricing_factor"
    claim_report_time_field: str = "report_time"
    settled_claim_field: str = "settled_amount"
    pending_claim_field: str = "pending_amount"


def project_root() -> Path:
    p = Path(__file__).resolve()
    for parent in p.parents:
        if (parent / "package.json").exists() and (parent / "数据管理").exists():
            return parent
    return Path.cwd()


def sql_string(value: str | date) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def ident(name: str) -> str:
    if not IDENT_RE.match(name):
        raise ValueError(f"Unsafe SQL identifier: {name}")
    return name


def read_parquet_source(path: Path) -> str:
    return f"read_parquet({sql_string(str(path))}, union_by_name=true)"


def default_policy_source(root: Path) -> str:
    return read_parquet_source(root / "数据管理/warehouse/fact/policy/current/*.parquet")


def default_claims_source(root: Path) -> str:
    return read_parquet_source(root / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")


def _resolve_valuation_date(con: duckdb.DuckDBPyConnection, params: EvaluationParams) -> date:
    if params.valuation_date:
        return params.valuation_date
    report_time = ident(params.claim_report_time_field)
    row = con.execute(
        f"SELECT MAX(CAST({report_time} AS DATE)) AS valuation_date FROM {params.claims_source}"
    ).fetchone()
    if not row or row[0] is None:
        raise ValueError("Cannot resolve valuation_date: claims source has no report_time")
    return row[0]


def _fetch_dicts(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def _base_ctes(params: EvaluationParams, valuation_date: date) -> str:
    policy_no = ident(params.policy_no_field)
    date_field = ident(params.date_field)
    target_date_field = ident(params.target_date_field or params.date_field)
    start_field = ident(params.insurance_start_field)
    end_field = ident(params.insurance_end_field)
    premium = ident(params.premium_field)
    agent = ident(params.agent_field)
    category = ident(params.customer_category_field)
    ins_type = ident(params.insurance_type_field)
    grade = ident(params.insurance_grade_field)
    factor = ident(params.pricing_factor_field)
    report_time = ident(params.claim_report_time_field)
    settled = ident(params.settled_claim_field)
    pending = ident(params.pending_claim_field)
    target_start_date = params.target_start_date or params.start_date
    target_end_date = params.target_end_date or params.end_date

    fallback_end = (
        f"CAST({start_field} AS DATE) + INTERVAL 1 YEAR - INTERVAL 1 DAY"
    )
    return f"""
WITH
policy_filtered AS (
  SELECT *
  FROM {params.policy_source}
  WHERE {category} = {sql_string(params.customer_category)}
    AND (
      CAST({date_field} AS DATE) BETWEEN DATE {sql_string(params.start_date)} AND DATE {sql_string(params.end_date)}
      OR (
        CAST({target_date_field} AS DATE) BETWEEN DATE {sql_string(target_start_date)} AND DATE {sql_string(target_end_date)}
        AND {agent} LIKE {sql_string(params.target_agent_pattern)}
      )
    )
),
policy_base AS (
  SELECT
    {policy_no} AS policy_no,
    {ins_type},
    COALESCE(NULLIF(TRIM({grade}), ''), {sql_string(params.grade_null_value)}) AS insurance_grade,
    MIN(CAST({start_field} AS DATE)) AS insurance_start_date,
    MAX(COALESCE(CAST({end_field} AS DATE), {fallback_end})) AS insurance_end_date,
    ANY_VALUE({agent}) AS agent_name,
    ANY_VALUE({category}) AS customer_category,
    ANY_VALUE({factor}) AS commercial_pricing_factor,
    SUM(COALESCE({premium}, 0)) AS premium,
    BOOL_OR(CAST({date_field} AS DATE) BETWEEN DATE {sql_string(params.start_date)} AND DATE {sql_string(params.end_date)}) AS is_baseline_period,
    BOOL_OR(
      CAST({target_date_field} AS DATE) BETWEEN DATE {sql_string(target_start_date)} AND DATE {sql_string(target_end_date)}
      AND {agent} LIKE {sql_string(params.target_agent_pattern)}
    ) AS is_target_period
  FROM policy_filtered
  GROUP BY {policy_no}, {ins_type}, COALESCE(NULLIF(TRIM({grade}), ''), {sql_string(params.grade_null_value)})
),
claims_agg AS (
  -- 赔案表无 insurance_type 字段；赔款按 policy_no 聚合后只关联到商业险行（codex P1 配套）
  SELECT
    {policy_no} AS policy_no,
    SUM(COALESCE({settled}, 0) + COALESCE({pending}, 0)) AS reported_claims
  FROM {params.claims_source}
  WHERE CAST({report_time} AS DATE) <= DATE {sql_string(valuation_date)}
  GROUP BY {policy_no}
),
scored AS (
  SELECT
    p.*,
    COALESCE(c.reported_claims, 0) AS reported_claims,
    GREATEST(1, DATE_DIFF('day', p.insurance_start_date, p.insurance_end_date) + 1) AS policy_term,
    CASE
      WHEN DATE {sql_string(valuation_date)} < p.insurance_start_date THEN 0
      ELSE LEAST(
        GREATEST(1, DATE_DIFF('day', p.insurance_start_date, p.insurance_end_date) + 1),
        GREATEST(0, DATE_DIFF('day', p.insurance_start_date, LEAST(DATE {sql_string(valuation_date)}, p.insurance_end_date)) + 1)
      )
    END AS earned_days,
    CASE
      WHEN p.insurance_type = {sql_string(params.commercial_insurance_type)}
        AND p.commercial_pricing_factor > 0
      THEN p.premium / NULLIF(p.commercial_pricing_factor, 0)
      WHEN p.insurance_type = {sql_string(params.commercial_insurance_type)}
      THEN NULL
      ELSE p.premium
    END AS baseline_premium,
    p.is_baseline_period AS is_baseline,
    p.is_target_period AS is_target
  FROM policy_base p
  LEFT JOIN claims_agg c ON p.policy_no = c.policy_no
),
exposure AS (
  SELECT
    *,
    premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE) AS earned_premium,
    baseline_premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE) AS baseline_earned_premium
  FROM scored
)
"""


def _baseline_sql(params: EvaluationParams, valuation_date: date) -> str:
    return _base_ctes(params, valuation_date) + """
SELECT
  insurance_type,
  insurance_grade,
  COUNT(DISTINCT policy_no) AS policy_count,
  ROUND(SUM(earned_premium), 2) AS earned_premium,
  ROUND(SUM(baseline_earned_premium), 2) AS baseline_earned_premium,
  ROUND(SUM(reported_claims), 2) AS reported_claims,
  ROUND(SUM(CASE WHEN baseline_earned_premium IS NOT NULL THEN reported_claims ELSE 0 END), 2) AS baseline_reported_claims,
  CASE
    WHEN SUM(earned_premium) > 0
    THEN ROUND(SUM(reported_claims) * 100.0 / SUM(earned_premium), 4)
    ELSE NULL
  END AS earned_claim_ratio,
  CASE
    WHEN SUM(baseline_earned_premium) > 0
    THEN ROUND(
      SUM(CASE WHEN baseline_earned_premium IS NOT NULL THEN reported_claims ELSE 0 END) * 100.0
      / SUM(baseline_earned_premium),
      4
    )
    ELSE NULL
  END AS baseline_earned_claim_ratio,
  SUM(CASE WHEN insurance_type = '商业保险' AND baseline_earned_premium IS NULL THEN 1 ELSE 0 END) AS invalid_factor_policy_count
FROM exposure
WHERE is_baseline
GROUP BY insurance_type, insurance_grade
ORDER BY insurance_type, insurance_grade
"""


def _target_sql(params: EvaluationParams, valuation_date: date) -> str:
    return _base_ctes(params, valuation_date) + """
, baseline AS (
  SELECT
    insurance_type,
    insurance_grade,
    CASE
      WHEN SUM(baseline_earned_premium) > 0
      THEN
        SUM(CASE WHEN baseline_earned_premium IS NOT NULL THEN reported_claims ELSE 0 END)
        / SUM(baseline_earned_premium)
      ELSE NULL
    END AS baseline_ratio_decimal
  FROM exposure
  WHERE is_baseline
  GROUP BY insurance_type, insurance_grade
),
target AS (
  SELECT
    insurance_type,
    insurance_grade,
    COUNT(DISTINCT policy_no) AS target_policy_count,
    -- 保留未 ROUND 的精确值用于下游估算，展示列在最终 SELECT 中 ROUND
    SUM(earned_premium) AS target_earned_premium_raw,
    SUM(baseline_earned_premium) AS target_baseline_earned_premium_raw,
    SUM(reported_claims) AS target_observed_reported_claims_raw,
    CASE
      WHEN SUM(earned_premium) > 0
      THEN SUM(reported_claims) * 100.0 / SUM(earned_premium)
      ELSE NULL
    END AS target_observed_earned_claim_ratio_raw,
    CASE
      WHEN SUM(baseline_earned_premium) > 0
      THEN SUM(earned_premium) / SUM(baseline_earned_premium)
      ELSE NULL
    END AS earned_pricing_factor_raw,
    SUM(CASE WHEN insurance_type = '商业保险' AND baseline_earned_premium IS NULL THEN 1 ELSE 0 END) AS invalid_factor_policy_count
  FROM exposure
  WHERE is_target
  GROUP BY insurance_type, insurance_grade
)
SELECT
  t.insurance_type,
  t.insurance_grade,
  t.target_policy_count,
  -- 展示列在最终输出时 ROUND（避免下游估算用到提前 ROUND 的值）
  ROUND(t.target_earned_premium_raw, 2) AS target_earned_premium,
  ROUND(t.target_baseline_earned_premium_raw, 2) AS target_baseline_earned_premium,
  ROUND(t.target_observed_reported_claims_raw, 2) AS target_observed_reported_claims,
  ROUND(t.target_observed_earned_claim_ratio_raw, 4) AS target_observed_earned_claim_ratio,
  ROUND(b.baseline_ratio_decimal * 100.0, 4) AS baseline_earned_claim_ratio,
  -- 估算用未 ROUND 的精确值
  ROUND(t.target_baseline_earned_premium_raw * b.baseline_ratio_decimal, 4) AS estimated_reported_claims,
  CASE
    WHEN t.target_earned_premium_raw > 0
    THEN ROUND(
      t.target_baseline_earned_premium_raw * b.baseline_ratio_decimal * 100.0 / t.target_earned_premium_raw,
      4
    )
    ELSE NULL
  END AS estimated_earned_claim_ratio,
  ROUND(t.earned_pricing_factor_raw, 6) AS earned_pricing_factor,
  t.invalid_factor_policy_count
FROM target t
LEFT JOIN baseline b USING (insurance_type, insurance_grade)
ORDER BY t.insurance_type, t.insurance_grade
"""


def _anomalies_sql(params: EvaluationParams, valuation_date: date) -> str:
    return _base_ctes(params, valuation_date) + """
SELECT
  policy_no,
  agent_name,
  insurance_type,
  insurance_grade,
  premium,
  commercial_pricing_factor,
  is_target,
  'invalid_commercial_pricing_factor' AS anomaly_type
FROM exposure
WHERE insurance_type = '商业保险'
  AND (is_baseline OR is_target)
  AND baseline_premium IS NULL
ORDER BY is_target DESC, agent_name, policy_no
"""


def run_evaluation(
    con: duckdb.DuckDBPyConnection,
    params: EvaluationParams,
) -> dict[str, Any]:
    valuation_date = _resolve_valuation_date(con, params)
    return {
        "params": {
            **params.__dict__,
            "start_date": str(params.start_date),
            "end_date": str(params.end_date),
            "target_start_date": str(params.target_start_date or params.start_date),
            "target_end_date": str(params.target_end_date or params.end_date),
            "valuation_date": str(valuation_date),
        },
        "baseline": _fetch_dicts(con, _baseline_sql(params, valuation_date)),
        "target": _fetch_dicts(con, _target_sql(params, valuation_date)),
        "anomalies": _fetch_dicts(con, _anomalies_sql(params, valuation_date)),
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8-sig")
        return
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_outputs(result: dict[str, Any], output_dir: Path, prefix: str) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "baseline_csv": output_dir / f"{prefix}_全量等级基准.csv",
        "target_csv": output_dir / f"{prefix}_目标业务评估.csv",
        "anomalies_csv": output_dir / f"{prefix}_异常数据.csv",
        "xlsx": output_dir / f"{prefix}.xlsx",
    }
    write_csv(paths["baseline_csv"], result["baseline"])
    write_csv(paths["target_csv"], result["target"])
    write_csv(paths["anomalies_csv"], result["anomalies"])

    try:
        from openpyxl import Workbook
    except ImportError:  # pragma: no cover - CSV fallback
        return paths

    wb = Workbook()
    del wb[wb.active.title]

    def add_sheet(title: str, rows: list[dict[str, Any]]) -> None:
        ws = wb.create_sheet(title)
        if not rows:
            return
        headers = list(rows[0].keys())
        ws.append(headers)
        for row in rows:
            ws.append([row.get(h) for h in headers])
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions

    add_sheet("参数说明", [{"参数": k, "值": v} for k, v in result["params"].items()])
    add_sheet("全量等级基准", result["baseline"])
    add_sheet("目标业务评估", result["target"])
    add_sheet("异常数据", result["anomalies"])
    wb.save(paths["xlsx"])
    return paths


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = project_root()
    parser = argparse.ArgumentParser(description="基准满期赔付率参数化评估")
    parser.add_argument("--policy-source", default=default_policy_source(root))
    parser.add_argument("--claims-source", default=default_claims_source(root))
    parser.add_argument("--date-field", default="insurance_start_date")
    parser.add_argument("--start-date", default="2024-05-01")
    parser.add_argument("--end-date", default="2025-04-30")
    parser.add_argument("--target-date-field", default=None)
    parser.add_argument("--target-start-date", default=None)
    parser.add_argument("--target-end-date", default=None)
    parser.add_argument("--valuation-date")
    parser.add_argument("--customer-category", default="非营业个人客车")
    parser.add_argument("--target-agent-pattern", default="%邮政%")
    parser.add_argument("--grade-null-value", default="X")
    parser.add_argument("--output-dir", default=str(root / "数据管理/数据分析报告/基准赔付评估"))
    parser.add_argument("--output-prefix", default="邮政_非营业个人客车_基准赔付评估")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    params = EvaluationParams(
        policy_source=args.policy_source,
        claims_source=args.claims_source,
        start_date=date.fromisoformat(args.start_date),
        end_date=date.fromisoformat(args.end_date),
        target_start_date=date.fromisoformat(args.target_start_date) if args.target_start_date else None,
        target_end_date=date.fromisoformat(args.target_end_date) if args.target_end_date else None,
        valuation_date=date.fromisoformat(args.valuation_date) if args.valuation_date else None,
        date_field=args.date_field,
        target_date_field=args.target_date_field,
        customer_category=args.customer_category,
        target_agent_pattern=args.target_agent_pattern,
        grade_null_value=args.grade_null_value,
    )
    con = duckdb.connect()
    result = run_evaluation(con, params)
    paths = write_outputs(result, Path(args.output_dir), args.output_prefix)
    print("输出文件:")
    for name, path in paths.items():
        print(f"- {name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
