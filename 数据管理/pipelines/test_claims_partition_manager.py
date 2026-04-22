#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""claims_partition_manager replace_range regression tests."""

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd


SCRIPT = Path(__file__).with_name("claims_partition_manager.py")


def _write_parquet(path: Path, rows: list[dict]) -> None:
    df = pd.DataFrame(rows)
    df["report_time"] = pd.to_datetime(df["report_time"])
    df.to_parquet(path, index=False)


def _read_claims(path: Path) -> set[str]:
    return set(pd.read_parquet(path)["claim_no"].tolist())


def _base_row(claim_no: str, year: int, report_time: str) -> dict:
    return {
        "claim_no": claim_no,
        "policy_no": f"P{claim_no}",
        "insurance_year": year,
        "report_time": report_time,
        "claim_status": "未业务结案",
        "settled_amount": 0.0,
        "pending_amount": 100.0,
    }


def test_replace_range_replaces_only_report_time_window_and_preserves_other_partitions(tmp_path: Path):
    out_dir = tmp_path / "claims_detail"
    out_dir.mkdir()

    claims_2023 = out_dir / "claims_2023.parquet"
    claims_2024 = out_dir / "claims_2024.parquet"
    incoming = tmp_path / "incoming.parquet"

    _write_parquet(claims_2023, [
        _base_row("old-2023", 2023, "2024-12-28 10:00:00"),
    ])
    _write_parquet(claims_2024, [
        _base_row("keep-before-window", 2024, "2024-12-31 23:59:59"),
        _base_row("drop-at-start", 2024, "2025-01-01 00:00:00"),
        _base_row("drop-at-end-late", 2024, "2026-04-19 23:59:00"),
        _base_row("keep-after-window", 2024, "2026-04-20 00:00:00"),
    ])
    before_2023_bytes = claims_2023.read_bytes()

    _write_parquet(incoming, [
        _base_row("new-2024-end-late", 2024, "2026-04-19 23:59:00"),
        _base_row("new-2025", 2025, "2025-06-01 09:30:00"),
    ])

    (out_dir / "_partition_meta.json").write_text(json.dumps({
        "partitions": {
            "2023": {"file": "claims_2023.parquet", "rows": 1, "frozen": False},
            "2024": {"file": "claims_2024.parquet", "rows": 4, "frozen": False},
        },
        "cdc_logs": [],
    }), encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "replace_range",
            "-i",
            str(incoming),
            "-o",
            str(out_dir),
            "--report-start",
            "2025-01-01",
            "--report-end",
            "2026-04-19",
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert claims_2023.read_bytes() == before_2023_bytes
    assert _read_claims(claims_2024) == {
        "keep-before-window",
        "keep-after-window",
        "new-2024-end-late",
    }
    assert _read_claims(out_dir / "claims_2025.parquet") == {"new-2025"}

    meta = json.loads((out_dir / "_partition_meta.json").read_text(encoding="utf-8"))
    latest = meta["cdc_logs"][-1]
    assert latest["command"] == "replace_range"
    assert latest["report_start"] == "2025-01-01"
    assert latest["report_end"] == "2026-04-19"
    assert latest["partitions"]["2024"]["deleted_in_range"] == 2
    assert latest["partitions"]["2024"]["inserted"] == 1
    assert latest["partitions"]["2025"]["old_rows"] == 0
    assert meta["partitions"]["2024"]["rows"] == 3
    assert meta["partitions"]["2025"]["rows"] == 1
