#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diagnose_lr_projection 回归测试 — 锁定 burning-cost 平移核心契约。"""

from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from diagnose_lr_projection import parse_hist_years  # type: ignore

PROJECT_ROOT = _HERE.parent.parent
PARQUET_DIR = PROJECT_ROOT / "数据管理" / "warehouse" / "fact" / "policy" / "current"
_HAS_PARQUET = PARQUET_DIR.exists() and any(PARQUET_DIR.glob("*.parquet"))


@pytest.mark.parametrize("s,expected", [
    ("2023-2025", [2023, 2024, 2025]),
    ("2022,2023,2024", [2022, 2023, 2024]),
    ("2024", [2024]),
    (" 2023-2025 ", [2023, 2024, 2025]),
    ("2020-2020", [2020]),
])
def test_parse_hist_years(s, expected):
    assert parse_hist_years(s) == expected


@pytest.mark.skipif(not _HAS_PARQUET, reason="parquet data not available (CI environment)")
def test_e2e_default_run(tmp_path):
    """端到端回归：默认参数跑完后产物完整 + 关键数字在物理合理范围。

    宽容断言 — 当 parquet 数据自然增长时不应破坏测试，但脚本逻辑回归会被捕获。
    """
    out_dir = tmp_path / "lr_proj_out"
    result = subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "数据管理" / "pipelines" / "diagnose_lr_projection.py"),
            "--proj-year", "2026",
            "--hist-years", "2023-2025",
            "--as-of", "2026-05-10",
            "--output-dir", str(out_dir),
        ],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
        timeout=180,
    )
    assert result.returncode == 0, f"脚本退出码 {result.returncode}:\nstdout: {result.stdout}\nstderr: {result.stderr}"

    detail_csv = out_dir / "2026_LR_cells_detail.csv"
    summary_csv = out_dir / "2026_LR_summary_by_dim.csv"
    report_md = out_dir / "2026_LR_平移预测_报告.md"

    assert detail_csv.exists(), "缺 cells_detail.csv"
    assert summary_csv.exists(), "缺 summary_by_dim.csv"
    assert report_md.exists(), "缺 Markdown 报告"

    detail = pd.read_csv(detail_csv)
    assert 100 < len(detail) < 200, f"2026 cell 数 {len(detail)} 偏离预期 (~138)"

    fb_levels = set(detail["fallback_level"].unique())
    assert "4d_original" in fb_levels, "fallback 分布缺 4d_original — 核心 cell 路径异常"

    overall_lr = detail["projected_claims"].sum() / detail["earned_premium_full_year"].sum()
    assert 0.65 < overall_lr < 0.80, f"整体预期 LR {overall_lr:.4f} 超出物理合理区间 65%-80%"

    assert (detail["applied_lr"] >= 0).all(), "applied_lr 存在负值"
    assert (detail["applied_lr"] <= 3).all(), "applied_lr 存在 > 300% 异常值"
    assert detail["earned_premium_full_year"].sum() > 1e8, "预测年满期保费总额 < 1 亿，数据明显不足"


@pytest.mark.skipif(not _HAS_PARQUET, reason="parquet data not available (CI environment)")
def test_empty_projection_year_fails_loudly(tmp_path):
    """空数据年（如 2099）必须 exit 非零，错误信息明确指引排查方向。"""
    result = subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "数据管理" / "pipelines" / "diagnose_lr_projection.py"),
            "--proj-year", "2099",
            "--hist-years", "2023-2025",
            "--output-dir", str(tmp_path / "empty_out"),
        ],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
        timeout=60,
    )
    assert result.returncode != 0, "预测年无数据时脚本必须报错退出"
    combined = result.stdout + result.stderr
    assert "无符合" in combined or "coverage_combination" in combined, \
        f"错误信息未包含可操作的排查提示:\n{combined}"


@pytest.mark.skipif(not _HAS_PARQUET, reason="parquet data not available (CI environment)")
def test_duplicate_override_keys_rejected(tmp_path):
    """override CSV 含重复 4D key 时必须 exit 非零，避免 merge 后行复制扭曲结果。"""
    bad_csv = tmp_path / "bad_override.csv"
    bad_csv.write_text(
        "customer_category,is_nev,vehicle_type_4,coverage_combination,expected_lr,note\n"
        "营业出租租赁,False,旧车非过户转保,主全,0.7280,first\n"
        "营业出租租赁,False,旧车非过户转保,主全,0.6500,duplicate key\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "数据管理" / "pipelines" / "diagnose_lr_projection.py"),
            "--proj-year", "2026",
            "--hist-years", "2023-2025",
            "--overrides", str(bad_csv),
            "--output-dir", str(tmp_path / "dup_out"),
        ],
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
        timeout=180,
    )
    assert result.returncode != 0, "重复 4D key 时脚本必须报错退出"
    combined = result.stdout + result.stderr
    assert "重复" in combined or "duplicate" in combined.lower(), \
        f"错误信息未提及重复键:\n{combined}"
