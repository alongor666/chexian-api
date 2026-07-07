#!/usr/bin/env python3
"""扫描所有域的 parquet，从 schema 实读 field_count / row_count，回写运行时状态。

用途：
    ETL 历史曾有 5 个 convert 漏调 update_data_sources()（B 阶段已统一兜底），
    导致运行时状态中部分域的 field_count / row_count 长期过时。
    本脚本作为元数据校准工具，从 parquet 事实源重读并回写。

B314 拆分说明：对比基准不再直接读 data-sources.json（该文件已降级为静态契约，
不再含 row_count/field_count 的最新值），改为经 read_merged_domains() 读取
「契约 + data-sources-status.json 运行时状态」的合并视图（状态优先，契约中
残留的旧字段仅作 deprecated 域的冻结快照兜底）。写入侧仍走 update_data_sources()，
该函数内部已改为只写状态文件，此处零改动。

用法：
    python3 数据管理/pipelines/sync_data_sources_metadata.py          # 执行
    python3 数据管理/pipelines/sync_data_sources_metadata.py --dry-run  # 仅对比
"""

from __future__ import annotations

import argparse
import glob
import sys
from pathlib import Path

import duckdb  # type: ignore

from pipelines.data_sources_updater import read_merged_domains, update_data_sources

ROOT = Path(__file__).resolve().parent.parent
DATA_SOURCES_PATH = ROOT / "data-sources.json"


def scan_parquet(files: list[str], con: duckdb.DuckDBPyConnection) -> tuple[int, int]:
    # 参数化 read_parquet(?, ...)：list 作为 parameter，彻底隔离 SQL 注入
    cols = con.execute(
        "DESCRIBE SELECT * FROM read_parquet(?, union_by_name=true) LIMIT 0",
        [files],
    ).fetchall()
    rows = con.execute(
        "SELECT COUNT(*) FROM read_parquet(?, union_by_name=true)",
        [files],
    ).fetchone()[0]
    return len(cols), int(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="仅打印差异不回写")
    args = parser.parse_args()

    if not DATA_SOURCES_PATH.exists():
        print(f"✖ 找不到 {DATA_SOURCES_PATH}", file=sys.stderr)
        return 1

    merged_domains = read_merged_domains(data_sources_path=DATA_SOURCES_PATH)
    reg_by_id = {d["id"]: d for d in merged_domains}

    con = duckdb.connect()
    changes: list[tuple[str, str]] = []
    skipped: list[str] = []

    for domain_id, reg in reg_by_id.items():
        if reg.get("deprecated"):
            skipped.append(f"{domain_id} (deprecated)")
            continue
        output = reg.get("output")
        if not output or output == "N/A":
            skipped.append(f"{domain_id} (no output path)")
            continue

        # output 字段直接视为 glob（支持 *.parquet 或具体文件）
        pattern = output
        files = sorted(glob.glob(str(ROOT / pattern)))
        if not files:
            skipped.append(f"{domain_id} (no parquet)")
            continue

        try:
            actual_fc, actual_rc = scan_parquet(files, con)
        except Exception as e:  # noqa: BLE001
            skipped.append(f"{domain_id} (scan failed: {e})")
            continue

        reg_fc = reg.get("field_count")
        reg_rc = reg.get("row_count")

        diff_parts = []
        if reg_fc != actual_fc:
            diff_parts.append(f"fc {reg_fc}→{actual_fc}")
        if reg_rc != actual_rc:
            diff_parts.append(f"rc {reg_rc:,}→{actual_rc:,}" if reg_rc else f"rc +{actual_rc:,}")

        if not diff_parts:
            print(f"  ✓ {domain_id:24} fc={actual_fc} rc={actual_rc:,}")
            continue

        diff_str = " / ".join(diff_parts)
        print(f"  Δ {domain_id:24} {diff_str}")
        changes.append((domain_id, diff_str))

        if not args.dry_run:
            update_data_sources(
                domain_id,
                row_count=actual_rc,
                field_count=actual_fc,
            )

    print()
    print(f"总结: {len(changes)} 个域需更新, {len(skipped)} 个跳过")
    if skipped:
        for s in skipped:
            print(f"  skip: {s}")
    if args.dry_run and changes:
        print("\n(dry-run — 未写入；运行不加 --dry-run 以应用)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
