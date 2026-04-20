#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据发布预检：基于 release manifest 校验源文件摆放与日期范围。

用法:
    python3 数据管理/pipelines/preflight_refresh.py \
        --manifest 数据管理/release-manifests/2026-04-19.json \
        --project-root .

通过后打印 JSON 报告；任一检查失败以 PreflightError 退出（exit 1）。
"""

import argparse
import json
import os
import sys
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipelines.etl_validation import load_excel_all_sheets  # noqa: E402


class PreflightError(RuntimeError):
    pass


PARQUET_DATE_COLUMN = {
    "premium": "policy_date",
    "claims_detail": "report_time",
    "customer_flow": "insurance_start_date",
    "cross_sell": "policy_date",
}


def expand_path(value: str, project_root: Path) -> Path:
    p = Path(os.path.expanduser(value))
    return p if p.is_absolute() else project_root / p


def read_excel_date_range(path: Path, date_col: str) -> tuple[str, str, int]:
    df = load_excel_all_sheets(str(path), dtype=None, required_columns=[date_col])
    if date_col not in df.columns or df.empty:
        raise PreflightError(f"{path.name} 缺少可用日期列: {date_col}")
    dates = pd.to_datetime(df[date_col], errors="coerce").dropna()
    if dates.empty:
        raise PreflightError(f"{path.name} 在 {date_col} 中无可解析日期")
    return dates.min().date().isoformat(), dates.max().date().isoformat(), len(df)


def reject_conflicting_active_files(root: Path, pattern: str, allowed: set[Path], label: str) -> None:
    active_dir = root / "数据管理" if (root / "数据管理").exists() else root
    allowed_resolved = {a.resolve() for a in allowed}
    conflicts = [p.name for p in active_dir.glob(pattern) if p.resolve() not in allowed_resolved]
    if conflicts:
        raise PreflightError(f"{label} 活动源冲突: {', '.join(sorted(conflicts))}")


def check_premium_overlap(root: Path, min_date: str, max_date: str) -> None:
    current = root / "数据管理/warehouse/fact/policy/current"
    if not current.exists():
        return
    col = PARQUET_DATE_COLUMN["premium"]
    for parquet in current.glob("*.parquet"):
        parquet_str = str(parquet).replace("'", "''")
        try:
            row = duckdb.sql(
                f"SELECT COUNT(*) FROM read_parquet('{parquet_str}') "
                f"WHERE CAST({col} AS DATE) BETWEEN DATE '{min_date}' AND DATE '{max_date}'"
            ).fetchone()
        except Exception:
            continue
        if row and row[0] > 0:
            raise PreflightError(f"premium 日期窗与现有 parquet 重叠: {parquet.name} ({row[0]} 行)")


def run_preflight(manifest: dict, project_root: Path | str = ".") -> dict:
    root = Path(project_root).resolve()
    archive_dir = expand_path(manifest["archive_dir"], root)
    if not archive_dir.exists() or not os.access(archive_dir, os.W_OK):
        raise PreflightError(f"archive_dir 不可写: {archive_dir}")

    domains = manifest["domains"]
    report = {"ok": True, "run_id": manifest["run_id"], "domains": {}}

    premium_files = [expand_path(p, root) for p in domains["premium"]["files"]]
    for p in premium_files:
        if not p.exists():
            raise PreflightError(f"premium 源文件缺失: {p}")
    min_date, max_date, rows = read_excel_date_range(premium_files[0], domains["premium"]["date_column"])
    if min_date != domains["premium"]["expected_min_date"] or max_date != domains["premium"]["expected_max_date"]:
        raise PreflightError(f"premium 日期范围不符: {min_date} ~ {max_date}")
    if domains["premium"]["overlap_policy"] == "fail_if_overlaps_existing_parquet":
        check_premium_overlap(root, min_date, max_date)
    report["domains"]["premium"] = {"rows": rows, "min_date": min_date, "max_date": max_date}

    claims_spec = domains["claims_detail"]
    claims_files = [expand_path(p, root) for p in claims_spec["files"]]
    for cf in claims_files:
        if not cf.exists():
            raise PreflightError(f"claims_detail 源文件缺失: {cf}")
    reject_conflicting_active_files(root, "02_理赔明细_*.xlsx", set(claims_files), "claims_detail")
    reject_conflicting_active_files(root, "车险报立结案清单_*.xlsx", set(), "claims_detail_legacy")
    claims_min = claims_max = None
    claims_rows = 0
    for cf in claims_files:
        mn, mx, n = read_excel_date_range(cf, claims_spec["date_column"])
        claims_rows += n
        claims_min = mn if claims_min is None or mn < claims_min else claims_min
        claims_max = mx if claims_max is None or mx > claims_max else claims_max
    if claims_min > claims_spec["report_start"] or claims_max < claims_spec["report_end"]:
        raise PreflightError(
            f"claims_detail 日期范围 {claims_min}~{claims_max} 未覆盖 report_window "
            f"{claims_spec['report_start']}~{claims_spec['report_end']}"
        )
    report["domains"]["claims_detail"] = {"rows": claims_rows, "min_date": claims_min, "max_date": claims_max}

    flow_file = expand_path(domains["customer_flow"]["file"], root)
    if not flow_file.exists():
        raise PreflightError(f"customer_flow 源文件缺失: {flow_file}")
    reject_conflicting_active_files(root, "08_客户来源去向*.xlsx", {flow_file}, "customer_flow")
    flow_min, flow_max, flow_rows = read_excel_date_range(flow_file, domains["customer_flow"]["date_column"])
    if flow_max != domains["customer_flow"]["expected_max_date"]:
        raise PreflightError(f"customer_flow 最大日期不符: {flow_max}")
    report["domains"]["customer_flow"] = {"rows": flow_rows, "min_date": flow_min, "max_date": flow_max}

    incoming = root / "数据管理/warehouse/fact/claims_detail/_incoming.parquet"
    if incoming.exists():
        raise PreflightError(f"发布前必须移除中间态文件: {incoming}")

    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="数据发布预检（manifest 驱动）")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    try:
        report = run_preflight(manifest, Path(args.project_root))
    except PreflightError as e:
        print(f"[preflight] 失败: {e}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
