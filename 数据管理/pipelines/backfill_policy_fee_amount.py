#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backfill PolicyFact fee_amount from the policy variable-cost sidecar.

The 2024+ policy source files may carry an empty `总费用金额` column while the
actual fee is available in `车险保单变动成本清单_精简.csv` as `手续费金额实际`.
This script patches only missing/zero PolicyFact fees and never overwrites an
existing non-zero fee from the signing list.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import duckdb


@dataclass(frozen=True)
class BackfillStats:
    file: str
    rows: int
    matched_rows: int
    backfilled_rows: int
    old_fee_sum: float
    new_fee_sum: float

    @property
    def added_fee_sum(self) -> float:
        return round(self.new_fee_sum - self.old_fee_sum, 2)


def _quote_path(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def _stats_for_file(con: duckdb.DuckDBPyConnection, policy_path: Path, cost_csv_path: Path) -> BackfillStats:
    policy = _quote_path(policy_path)
    cost = _quote_path(cost_csv_path)
    sql = f"""
WITH cost_fee AS (
  SELECT
    CAST(车架号 AS VARCHAR) AS vehicle_frame_no,
    CAST(保险起期 AS DATE) AS insurance_start_date,
    ROUND(CAST(保费 AS DOUBLE), 2) AS premium_key,
    SUM(COALESCE(CAST(手续费金额实际 AS DOUBLE), 0)) AS sidecar_fee_amount
  FROM read_csv_auto('{cost}', header=true, union_by_name=true)
  WHERE 车架号 IS NOT NULL
    AND 保险起期 IS NOT NULL
    AND 保费 IS NOT NULL
  GROUP BY 1, 2, 3
),
joined AS (
  SELECT
    p.policy_no,
    COALESCE(CAST(p.fee_amount AS DOUBLE), 0) AS old_fee_amount,
    c.sidecar_fee_amount,
    CASE
      WHEN COALESCE(CAST(p.fee_amount AS DOUBLE), 0) = 0
       AND c.sidecar_fee_amount IS NOT NULL
       AND c.sidecar_fee_amount != 0
      THEN c.sidecar_fee_amount
      ELSE COALESCE(CAST(p.fee_amount AS DOUBLE), 0)
    END AS patched_fee_amount
  FROM read_parquet('{policy}', union_by_name=true) p
  LEFT JOIN cost_fee c
    ON CAST(p.vehicle_frame_no AS VARCHAR) = c.vehicle_frame_no
   AND CAST(p.insurance_start_date AS DATE) = c.insurance_start_date
   AND ROUND(CAST(p.premium AS DOUBLE), 2) = c.premium_key
)
SELECT
  COUNT(*) AS rows,
  COUNT(sidecar_fee_amount) AS matched_rows,
  SUM(
    CASE
      WHEN old_fee_amount = 0
       AND sidecar_fee_amount IS NOT NULL
       AND sidecar_fee_amount != 0
      THEN 1
      ELSE 0
    END
  ) AS backfilled_rows,
  ROUND(SUM(old_fee_amount), 2) AS old_fee_sum,
  ROUND(SUM(patched_fee_amount), 2) AS new_fee_sum
FROM joined
"""
    row = con.execute(sql).fetchone()
    return BackfillStats(
        file=policy_path.name,
        rows=int(row[0] or 0),
        matched_rows=int(row[1] or 0),
        backfilled_rows=int(row[2] or 0),
        old_fee_sum=round(float(row[3] or 0), 2),
        new_fee_sum=round(float(row[4] or 0), 2),
    )


def backfill_policy_file(policy_path: Path | str, cost_csv_path: Path | str, output_path: Path | str) -> BackfillStats:
    policy_path = Path(policy_path)
    cost_csv_path = Path(cost_csv_path)
    output_path = Path(output_path)

    con = duckdb.connect()
    stats = _stats_for_file(con, policy_path, cost_csv_path)
    policy = _quote_path(policy_path)
    cost = _quote_path(cost_csv_path)

    sql = f"""
WITH cost_fee AS (
  SELECT
    CAST(车架号 AS VARCHAR) AS vehicle_frame_no,
    CAST(保险起期 AS DATE) AS insurance_start_date,
    ROUND(CAST(保费 AS DOUBLE), 2) AS premium_key,
    SUM(COALESCE(CAST(手续费金额实际 AS DOUBLE), 0)) AS sidecar_fee_amount
  FROM read_csv_auto('{cost}', header=true, union_by_name=true)
  WHERE 车架号 IS NOT NULL
    AND 保险起期 IS NOT NULL
    AND 保费 IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT
  p.* REPLACE (
    CASE
      WHEN COALESCE(CAST(p.fee_amount AS DOUBLE), 0) = 0
       AND c.sidecar_fee_amount IS NOT NULL
       AND c.sidecar_fee_amount != 0
      THEN c.sidecar_fee_amount
      ELSE COALESCE(CAST(p.fee_amount AS DOUBLE), 0)
    END AS fee_amount
  )
FROM read_parquet('{policy}', union_by_name=true) p
LEFT JOIN cost_fee c
  ON CAST(p.vehicle_frame_no AS VARCHAR) = c.vehicle_frame_no
 AND CAST(p.insurance_start_date AS DATE) = c.insurance_start_date
 AND ROUND(CAST(p.premium AS DOUBLE), 2) = c.premium_key
"""
    table = con.execute(sql).to_arrow_table()

    from pipelines.parquet_utils import write_parquet_with_metadata

    write_parquet_with_metadata(
        table,
        output_path,
        source_file=policy_path.name,
        processing_mode="fee_backfill",
        extra_metadata={
            "fee_backfill_source": cost_csv_path.name,
            "fee_backfill_matched_rows": stats.matched_rows,
            "fee_backfill_rows": stats.backfilled_rows,
            "fee_backfill_added_fee": stats.added_fee_sum,
        },
    )
    return stats


def backfill_policy_dir(policy_dir: Path | str, cost_csv_path: Path | str, dry_run: bool = False) -> list[BackfillStats]:
    policy_dir = Path(policy_dir)
    cost_csv_path = Path(cost_csv_path)
    parquet_files = sorted(policy_dir.glob("*.parquet"))
    stats_list: list[BackfillStats] = []

    for parquet_file in parquet_files:
        output_path = parquet_file.with_suffix(".parquet.tmp")
        stats = backfill_policy_file(parquet_file, cost_csv_path, output_path)
        stats_list.append(stats)
        if dry_run or stats.backfilled_rows == 0:
            output_path.unlink(missing_ok=True)
        else:
            os.replace(output_path, parquet_file)
        print(
            f"{parquet_file.name}: matched={stats.matched_rows:,}, "
            f"backfilled={stats.backfilled_rows:,}, added_fee={stats.added_fee_sum:,.2f}"
        )

    return stats_list


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill policy fee_amount from variable-cost CSV")
    parser.add_argument("--policy-dir", required=True, help="PolicyFact parquet directory")
    parser.add_argument("--fee-csv", required=True, help="CSV with 车架号/保险起期/保费/手续费金额实际")
    parser.add_argument("--dry-run", action="store_true", help="Compute stats without replacing parquet files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    policy_dir = Path(args.policy_dir)
    fee_csv = Path(args.fee_csv)
    if not policy_dir.exists():
        print(f"policy-dir not found: {policy_dir}", file=sys.stderr)
        return 2
    if not fee_csv.exists():
        print(f"fee-csv not found: {fee_csv}", file=sys.stderr)
        return 2

    stats_list = backfill_policy_dir(policy_dir, fee_csv, dry_run=args.dry_run)
    total_backfilled = sum(s.backfilled_rows for s in stats_list)
    total_added_fee = round(sum(s.added_fee_sum for s in stats_list), 2)
    print(f"total: backfilled={total_backfilled:,}, added_fee={total_added_fee:,.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
