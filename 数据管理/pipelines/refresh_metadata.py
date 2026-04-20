#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从最终 parquet 单点派生 data-sources.json 的 metadata。

背景: daily.mjs 与各 BaseConverter 之前在 4 处分别写 data-sources.json，
row_count/field_count/data_range 容易与实际 parquet 漂移。本脚本替代所有
散落写入点，发布流程末尾调用一次，从 parquet 实读派生派生值。

用法:
    python3 数据管理/pipelines/refresh_metadata.py \
        --domain customer_flow \
        --parquet '数据管理/warehouse/fact/customer_flow/latest.parquet' \
        --date-column insurance_start_date \
        --run-date 2026-04-19
"""

import argparse
import json
from pathlib import Path

import duckdb


def refresh_domain_metadata(
    data_sources_path: Path,
    domain_id: str,
    parquet_glob: str,
    date_column: str | None,
    run_date: str,
) -> dict:
    cfg = json.loads(data_sources_path.read_text(encoding="utf-8"))
    domain = next((d for d in cfg["domains"] if d["id"] == domain_id), None)
    if domain is None:
        raise ValueError(f"data-sources.json 中不存在 domain: {domain_id}")

    union = ", union_by_name=true" if "*" in parquet_glob else ""
    glob = parquet_glob.replace("'", "''")

    row_count = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{glob}'{union})").fetchone()[0]
    field_count = len(duckdb.sql(f"DESCRIBE SELECT * FROM read_parquet('{glob}'{union})").fetchall())

    domain["row_count"] = int(row_count)
    domain["field_count"] = int(field_count)
    domain["last_updated"] = run_date

    if date_column:
        min_date, max_date = duckdb.sql(
            f"SELECT MIN(CAST({date_column} AS DATE)), MAX(CAST({date_column} AS DATE)) "
            f"FROM read_parquet('{glob}'{union})"
        ).fetchone()
        domain["data_range"] = f"{min_date} ~ {max_date}"

    data_sources_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return domain


def main() -> None:
    parser = argparse.ArgumentParser(description="从最终 parquet 刷新 data-sources.json")
    parser.add_argument("--data-sources", default="数据管理/data-sources.json")
    parser.add_argument("--domain", required=True)
    parser.add_argument("--parquet", required=True, help="parquet 路径或 glob (如 claims_*.parquet)")
    parser.add_argument("--date-column", default=None)
    parser.add_argument("--run-date", required=True)
    args = parser.parse_args()

    updated = refresh_domain_metadata(
        Path(args.data_sources),
        args.domain,
        args.parquet,
        args.date_column,
        args.run_date,
    )
    print(json.dumps(updated, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
