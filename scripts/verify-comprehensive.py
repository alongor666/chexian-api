#!/usr/bin/env python3
"""
综合分析口径验证脚本（铁律对齐验证）

用途：DuckDB 直查 Parquet 源数据，按新口径（earned_days/policy_term + 年化出险率）
      计算关键指标，与 API `/api/query/comprehensive-bundle` 返回对比，确保一致性。

执行：python3 scripts/verify-comprehensive.py [--start 2026-01-01] [--end 2026-04-17]

铁律检查点：
  1. 赔付率分母：premium × earned_days / policy_term（闰年感知）
  2. 变动成本率：已赚赔付率 + 费用率
  3. 出险率：SUM(claim_cases × policy_term / earned_days) / COUNT(DISTINCT policy_no) × 100
  4. 综合费用率：(reported_claims + fee_amount) / earned_premium × 100
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("ERROR: 需要安装 duckdb: pip3 install duckdb", file=sys.stderr)
    sys.exit(1)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CURRENT_PATH = PROJECT_ROOT / "数据管理/warehouse/fact/policy/current"
if str(PROJECT_ROOT / "数据管理") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "数据管理"))  # 供 import pipelines.*（branch_paths SSOT）
from pipelines.branch_paths import (  # noqa: E402
    PolicyCurrentLayoutError,
    has_policy_current_parquet,
    policy_current_glob,
)


def query_parquet(start: str, end: str) -> dict:
    """直查 Parquet 按新口径计算关键指标"""
    con = duckdb.connect()

    if not CURRENT_PATH.exists():
        print(f"ERROR: 找不到源目录 {CURRENT_PATH}", file=sys.stderr)
        sys.exit(1)

    if not has_policy_current_parquet(CURRENT_PATH):
        print(f"ERROR: {CURRENT_PATH} 下无 Parquet 文件", file=sys.stderr)
        sys.exit(1)

    # 双布局自适应（branch_paths SSOT · 801409 cutover 前置）：全量读（跨省验证）
    try:
        glob = policy_current_glob(CURRENT_PATH)
    except PolicyCurrentLayoutError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    sql = f"""
    WITH base AS (
      SELECT
        "保单号" AS policy_no,
        "保单起期" AS start_date,
        "保单到期" AS end_date,
        CAST("签单保费" AS DOUBLE) AS signed_premium,
        CAST("保费" AS DOUBLE) AS premium,
        CAST("已报告赔款" AS DOUBLE) AS reported_claims,
        CAST("报案件数" AS DOUBLE) AS claim_cases,
        CAST("费用金额" AS DOUBLE) AS fee_amount,
        -- 闰年感知：policy_term = DATEDIFF(起期, 起期+1年)
        DATEDIFF('day', CAST("保单起期" AS DATE), CAST("保单起期" AS DATE) + INTERVAL 1 YEAR) AS policy_term,
        -- earned_days 截断于 [end, start+1year]，无退保日信息时用 end
        DATEDIFF('day',
          CAST("保单起期" AS DATE),
          LEAST(CAST('{end}' AS DATE), CAST("保单到期" AS DATE), CAST("保单起期" AS DATE) + INTERVAL 1 YEAR)
        ) AS earned_days_raw
      FROM '{glob}'
      WHERE CAST("签单日期" AS DATE) BETWEEN '{start}' AND '{end}'
    ),
    scoped AS (
      SELECT *, GREATEST(earned_days_raw, 0) AS earned_days FROM base
    )
    SELECT
      COUNT(DISTINCT policy_no) AS policy_count,
      SUM(signed_premium) / 1e4 AS signed_premium_wan,
      SUM(premium * CAST(earned_days AS DOUBLE) / NULLIF(CAST(policy_term AS DOUBLE), 0)) / 1e4 AS earned_premium_wan,
      SUM(reported_claims) / 1e4 AS reported_claims_wan,
      SUM(fee_amount) / 1e4 AS fee_amount_wan,
      -- 满期赔付率 = reported_claims / earned_premium × 100
      SUM(reported_claims) * 100.0 / NULLIF(SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 0) AS earned_claim_ratio,
      -- 综合费用率 = (reported_claims + fee_amount) / earned_premium × 100
      (SUM(reported_claims) + SUM(fee_amount)) * 100.0 / NULLIF(SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 0) AS comprehensive_expense_ratio,
      -- 变动成本率 = earned_claim_ratio + expense_ratio(fee/signed_premium)
      SUM(reported_claims) * 100.0 / NULLIF(SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 0)
        + SUM(fee_amount) * 100.0 / NULLIF(SUM(premium), 0) AS variable_cost_ratio,
      -- 年化满期出险率 = SUM(claim_cases × policy_term / earned_days) / COUNT(DISTINCT policy_no) × 100
      SUM(CAST(claim_cases AS DOUBLE) * CAST(policy_term AS DOUBLE) / NULLIF(CAST(earned_days AS DOUBLE), 0)) * 100.0
        / NULLIF(COUNT(DISTINCT policy_no), 0) AS claim_frequency,
      -- 单均保费 = signed_premium / policy_count
      SUM(signed_premium) / NULLIF(COUNT(DISTINCT policy_no), 0) AS per_vehicle_premium
    FROM scoped
    """

    row = con.execute(sql).fetchone()
    keys = [
        "policy_count",
        "signed_premium_wan",
        "earned_premium_wan",
        "reported_claims_wan",
        "fee_amount_wan",
        "earned_claim_ratio",
        "comprehensive_expense_ratio",
        "variable_cost_ratio",
        "claim_frequency",
        "per_vehicle_premium",
    ]
    return {k: (round(v, 4) if v is not None else None) for k, v in zip(keys, row)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2026-01-01")
    parser.add_argument("--end", default="2026-04-17")
    parser.add_argument("--json", action="store_true", help="仅输出 JSON")
    args = parser.parse_args()

    result = query_parquet(args.start, args.end)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"\n=== 综合分析铁律对账 · {args.start} ~ {args.end} ===\n")
    print(f"  保单数                  : {result['policy_count']:,}")
    print(f"  签单保费（万）          : {result['signed_premium_wan']:,.2f}")
    print(f"  满期保费（万）          : {result['earned_premium_wan']:,.2f}")
    print(f"  已报告赔款（万）        : {result['reported_claims_wan']:,.2f}")
    print(f"  费用金额（万）          : {result['fee_amount_wan']:,.2f}")
    print("")
    print(f"  满期赔付率 (%)          : {result['earned_claim_ratio']:.2f}"
          if result["earned_claim_ratio"] is not None else "  满期赔付率 (%)          : -")
    print(f"  综合费用率 (%)          : {result['comprehensive_expense_ratio']:.2f}"
          if result["comprehensive_expense_ratio"] is not None else "  综合费用率 (%)          : -")
    print(f"  变动成本率 (%)          : {result['variable_cost_ratio']:.2f}"
          if result["variable_cost_ratio"] is not None else "  变动成本率 (%)          : -")
    print(f"  满期出险率 (%, 年化)    : {result['claim_frequency']:.2f}"
          if result["claim_frequency"] is not None else "  满期出险率 (%, 年化)    : -")
    print(f"  单均保费 (元)           : {result['per_vehicle_premium']:,.2f}"
          if result["per_vehicle_premium"] is not None else "  单均保费 (元)           : -")
    print("")
    print("验证对比：")
    print("  curl -s 'http://localhost:3000/api/query/comprehensive-bundle?startDate="
          f"{args.start}&endDate={args.end}' | jq '.data.summary'")


if __name__ == "__main__":
    main()
