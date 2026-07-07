#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从最终 parquet 单点派生 data-sources-status.json 的运行时状态。

背景: daily.mjs 与各 BaseConverter 之前在 4 处分别写 data-sources.json，
row_count/field_count/data_range 容易与实际 parquet 漂移。本脚本替代所有
散落写入点，发布流程末尾调用一次，从 parquet 实读派生值。

B314 拆分后：data-sources.json 是入库的静态契约文件，本脚本**只读**它做
domain 存在性校验；派生出的 row_count/field_count/data_range/last_updated
一律写入 data-sources-status.json（gitignored，运行时状态，经
write_data_sources_status() 单点原子写入）。

用法:
    python3 数据管理/pipelines/refresh_metadata.py \
        --domain customer_flow \
        --parquet '数据管理/warehouse/fact/customer_flow/latest.parquet' \
        --date-column insurance_start_date \
        --run-date 2026-04-19
"""

import argparse
import json
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipelines.data_sources_updater import write_data_sources_status  # noqa: E402


def refresh_domain_metadata(
    data_sources_path: Path,
    domain_id: str,
    parquet_glob: str,
    date_column: str | None,
    run_date: str,
    status_path: Path | None = None,
) -> dict:
    cfg = json.loads(data_sources_path.read_text(encoding="utf-8"))
    domain = next((d for d in cfg["domains"] if d["id"] == domain_id), None)
    if domain is None:
        raise ValueError(f"data-sources.json 中不存在 domain: {domain_id}")

    union = ", union_by_name=true" if "*" in parquet_glob else ""
    glob = parquet_glob.replace("'", "''")

    row_count = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{glob}'{union})").fetchone()[0]
    field_count = len(duckdb.sql(f"DESCRIBE SELECT * FROM read_parquet('{glob}'{union})").fetchall())

    data_range = None
    if date_column:
        min_date, max_date = duckdb.sql(
            f"SELECT MIN(CAST({date_column} AS DATE)), MAX(CAST({date_column} AS DATE)) "
            f"FROM read_parquet('{glob}'{union})"
        ).fetchone()
        data_range = f"{min_date} ~ {max_date}"

    return write_data_sources_status(
        domain_id,
        row_count=int(row_count),
        field_count=int(field_count),
        data_range=data_range,
        last_updated=run_date,
        status_path=status_path,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="从最终 parquet 刷新 data-sources-status.json")
    parser.add_argument("--data-sources", default="数据管理/data-sources.json")
    parser.add_argument("--domain", required=True)
    parser.add_argument("--parquet", required=True, help="parquet 路径或 glob (如 claims_*.parquet)")
    parser.add_argument("--date-column", default=None)
    parser.add_argument("--run-date", required=True)
    parser.add_argument(
        "--status-path",
        default=None,
        help="状态文件路径（可选，默认派生自 --data-sources 同目录 data-sources-status.json）",
    )
    args = parser.parse_args()

    data_sources_path = Path(args.data_sources)
    status_path = Path(args.status_path) if args.status_path else data_sources_path.parent / "data-sources-status.json"

    updated = refresh_domain_metadata(
        data_sources_path,
        args.domain,
        args.parquet,
        args.date_column,
        args.run_date,
        status_path=status_path,
    )
    print(json.dumps(updated, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
