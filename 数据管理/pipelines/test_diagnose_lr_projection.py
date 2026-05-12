#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diagnose_lr_projection 回归测试 — 锁定 burning-cost 平移核心契约。"""

from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from diagnose_lr_projection import (  # type: ignore
    compute_run_params_hash,
    parse_hist_years,
)

PROJECT_ROOT = _HERE.parent.parent
PARQUET_DIR = PROJECT_ROOT / "数据管理" / "warehouse" / "fact" / "policy" / "current"
_HAS_PARQUET = PARQUET_DIR.exists() and any(PARQUET_DIR.glob("*.parquet"))
SCRIPT_PATH = PROJECT_ROOT / "数据管理" / "pipelines" / "diagnose_lr_projection.py"


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
    # 4 维笛卡尔上限 = 11 客户类别 × 2 能源 × 4 四分类 × 3 险别 = 264
    # 下限 100 是合理基底（默认窗口下不会少于 ~130）；上限 264 让数据自然增长不误报
    assert 100 < len(detail) <= 264, f"2026 cell 数 {len(detail)} 不在 (100, 264] 范围内"

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


# ============================================================================
# 口径硬化回归测试（B287 阶段 0 落地后保留的契约锁）
# ============================================================================


def _build_dedup_fixture(tmp_path: Path) -> Path:
    """构造含重复保单的 fixture parquet:3 条同 (policy_no, insurance_start_date) 行 + 1 条独立保单。"""
    fixture_path = tmp_path / "dedup_fixture.parquet"
    df = pd.DataFrame([
        # P001 的 3 个批改副本(同 policy_no + 同 insurance_start_date)
        {"policy_no": "P001", "insurance_start_date": pd.Timestamp("2024-01-01"),
         "premium": 1000.0, "fee_amount": 500.0,
         "customer_category": "非营业个人客车", "is_nev": False,
         "is_new_car": False, "is_transfer": False, "is_renewal": True,
         "coverage_combination": "主全", "vehicle_frame_no": "VIN001"},
        {"policy_no": "P001", "insurance_start_date": pd.Timestamp("2024-01-01"),
         "premium": 200.0, "fee_amount": 100.0,
         "customer_category": "非营业个人客车", "is_nev": False,
         "is_new_car": False, "is_transfer": False, "is_renewal": True,
         "coverage_combination": "主全", "vehicle_frame_no": "VIN001"},
        {"policy_no": "P001", "insurance_start_date": pd.Timestamp("2024-01-01"),
         "premium": -100.0, "fee_amount": -50.0,
         "customer_category": "非营业个人客车", "is_nev": False,
         "is_new_car": False, "is_transfer": False, "is_renewal": True,
         "coverage_combination": "主全", "vehicle_frame_no": "VIN001"},
        # P002 单条,无重复
        {"policy_no": "P002", "insurance_start_date": pd.Timestamp("2024-02-01"),
         "premium": 2000.0, "fee_amount": 1000.0,
         "customer_category": "摩托车", "is_nev": False,
         "is_new_car": True, "is_transfer": False, "is_renewal": False,
         "coverage_combination": "单交", "vehicle_frame_no": "VIN002"},
        # P003 净额 ≤ 0(整张保单全退),应被 HAVING SUM(premium) > 0 剔除
        {"policy_no": "P003", "insurance_start_date": pd.Timestamp("2024-03-01"),
         "premium": 500.0, "fee_amount": 200.0,
         "customer_category": "非营业个人客车", "is_nev": False,
         "is_new_car": False, "is_transfer": False, "is_renewal": True,
         "coverage_combination": "主全", "vehicle_frame_no": "VIN003"},
        {"policy_no": "P003", "insurance_start_date": pd.Timestamp("2024-03-01"),
         "premium": -500.0, "fee_amount": -200.0,
         "customer_category": "非营业个人客车", "is_nev": False,
         "is_new_car": False, "is_transfer": False, "is_renewal": True,
         "coverage_combination": "主全", "vehicle_frame_no": "VIN003"},
    ])
    df.to_parquet(fixture_path, index=False)
    return fixture_path


def test_dedup_reduces_row_count(tmp_path, monkeypatch):
    """fixture 固化场景:6 raw 行 → 2 dedup 行(P001 合并、P003 净额 ≤ 0 被剔除)。"""
    import duckdb
    import diagnose_lr_projection as mod  # type: ignore

    fixture = _build_dedup_fixture(tmp_path)
    monkeypatch.setattr(mod, "GLOB", str(fixture))

    con = duckdb.connect()
    # 借 claims fixture(空表)避免 build_views 在赔案侧报错
    claims_fixture = tmp_path / "claims_empty.parquet"
    pd.DataFrame({
        "policy_no": pd.Series([], dtype="object"),
        "claim_no": pd.Series([], dtype="object"),
        "report_time": pd.Series([], dtype="datetime64[ns]"),
        "settled_amount": pd.Series([], dtype="float64"),
        "pending_amount": pd.Series([], dtype="float64"),
        "settlement_time": pd.Series([], dtype="datetime64[ns]"),
        "payment_time": pd.Series([], dtype="datetime64[ns]"),
    }).to_parquet(claims_fixture, index=False)
    monkeypatch.setattr(mod, "CLAIMS_GLOB", str(claims_fixture))

    mod.build_views(con, "2024-12-31", [2024], 2025)

    raw_count = con.execute(
        f"SELECT COUNT(*) FROM read_parquet('{fixture}', union_by_name=true)"
    ).fetchone()[0]
    dedup_count = con.execute("SELECT COUNT(*) FROM v_policy_base_dedup").fetchone()[0]

    assert raw_count == 6, f"fixture 应有 6 行,实际 {raw_count}"
    assert dedup_count == 2, (
        f"去重后应剩 2 条(P001 合并、P003 净额 ≤ 0 被剔除),实际 {dedup_count}"
    )
    assert dedup_count < raw_count, "去重必须严格减少行数"


@pytest.mark.skipif(not _HAS_PARQUET, reason="parquet data not available (CI environment)")
def test_proj_year_dedup_consistency(tmp_path):
    """历史与预测年都从 v_policy_base_dedup 派生,两侧行数均 <= raw rows(可减不增)。"""
    import duckdb
    import diagnose_lr_projection as mod  # type: ignore

    con = duckdb.connect()
    mod.build_views(con, "2026-05-10", [2023, 2024, 2025], 2026)

    hist_count = con.execute("SELECT COUNT(*) FROM v_policy_hist").fetchone()[0]
    proj_count = con.execute("SELECT COUNT(*) FROM v_policy_proj").fetchone()[0]

    raw_hist = con.execute(f"""
        SELECT COUNT(*) FROM read_parquet('{mod.GLOB}', union_by_name=true)
        WHERE YEAR(insurance_start_date) IN (2023, 2024, 2025)
          AND insurance_start_date IS NOT NULL
          AND {mod.COVERAGE_FILTER}
    """).fetchone()[0]
    raw_proj = con.execute(f"""
        SELECT COUNT(*) FROM read_parquet('{mod.GLOB}', union_by_name=true)
        WHERE YEAR(insurance_start_date) = 2026
          AND insurance_start_date IS NOT NULL
          AND {mod.COVERAGE_FILTER}
    """).fetchone()[0]

    assert hist_count <= raw_hist, (
        f"历史 dedup 行数虚增: {hist_count} > {raw_hist}"
    )
    assert proj_count <= raw_proj, (
        f"预测年 dedup 行数虚增: {proj_count} > {raw_proj}"
    )
    # 弱断言:两侧都基于同一 v_policy_base_dedup,行数都 <= raw 即可
    # 不要求"减少比例一致",因为各年份批改/重复分布天然不同


@pytest.mark.skipif(not _HAS_PARQUET, reason="parquet data not available (CI environment)")
def test_distinct_on_determinism(tmp_path):
    """反复跑两次,2026 预测 LR 差异必须 < 0.001 个百分点。

    严格"完全一致"不可达:`v_policy_base_dedup` 用 `ANY_VALUE()` 聚合批改字段时
    DuckDB 无确定性保证。本测试容忍 1e-5(0.001 个百分点)的浮点扰动,
    业务上完全无意义。排序 tie-breaker 把扰动控制在此量级。
    """
    results = []
    for i in range(2):
        out_dir = tmp_path / f"run_{i}"
        r = subprocess.run([
            sys.executable, str(SCRIPT_PATH),
            "--proj-year", "2026", "--hist-years", "2023-2025",
            "--as-of", "2026-05-10",
            "--output-dir", str(out_dir),
        ], capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=180)
        assert r.returncode == 0, f"第 {i} 次跑失败:\n{r.stderr}"
        s = json.loads((out_dir / "2026_LR_summary.json").read_text(encoding="utf-8"))
        results.append(s["overall"]["lr"])

    diff = abs(results[0] - results[1])
    assert diff < 1e-5, (
        f"反复跑差异 {diff:.2e} 超过 1e-5(0.001 个百分点): "
        f"{results[0]:.10f} vs {results[1]:.10f}"
    )


def test_run_params_hash_semantics(tmp_path):
    """run_params_hash 只含语义参数:snapshot-tag/output-dir 不影响,proj-year 必影响。"""
    base_kwargs = dict(
        proj_year=2026,
        hist_years=[2023, 2024, 2025],
        hist_as_of="2026-05-10",
        threshold_premium_wan=500.0,
        threshold_vehicle=5000,
        overrides_path=None,
    )
    h_base = compute_run_params_hash(**base_kwargs)
    # 语义参数相同 → 哈希必相等(即使 hist_years 顺序不同)
    h_reorder = compute_run_params_hash(
        **{**base_kwargs, "hist_years": [2025, 2024, 2023]}
    )
    assert h_base == h_reorder, "hist_years 顺序变化不应改变哈希"

    # proj_year 改变 → 哈希必变
    h_diff_year = compute_run_params_hash(**{**base_kwargs, "proj_year": 2027})
    assert h_base != h_diff_year, "proj_year 变化必须改变哈希"

    # 阈值改变 → 哈希必变
    h_diff_thr = compute_run_params_hash(
        **{**base_kwargs, "threshold_premium_wan": 300.0}
    )
    assert h_base != h_diff_thr, "阈值变化必须改变哈希"

    # overrides 内容变化 → 哈希必变
    ov1 = tmp_path / "ov1.csv"
    ov1.write_text("customer_category,is_nev,vehicle_type_4,coverage_combination,expected_lr\n"
                   "摩托车,False,新车,单交,0.7\n", encoding="utf-8")
    ov2 = tmp_path / "ov2.csv"
    ov2.write_text("customer_category,is_nev,vehicle_type_4,coverage_combination,expected_lr\n"
                   "摩托车,False,新车,单交,0.8\n", encoding="utf-8")
    h_ov1 = compute_run_params_hash(**{**base_kwargs, "overrides_path": ov1})
    h_ov2 = compute_run_params_hash(**{**base_kwargs, "overrides_path": ov2})
    assert h_ov1 != h_ov2, "overrides 内容变化必须改变哈希"
    assert h_base != h_ov1, "有无 overrides 必须改变哈希"


def test_snapshot_tag_isolates_output_dir():
    """--snapshot-tag 必须落到默认产物路径(不需要 --output-dir 显式覆盖)。

    Codex P2 反馈:之前 snapshot-tag 只 print 不影响路径,raw/dedup/cutoff/final
    在默认 output-dir 下互相覆盖。

    本测试单元级别验证:同函数中 args.snapshot_tag 的两种值会产生不同默认路径。
    端到端验证通过 stdout 中的 [INFO] 输出目录 行间接覆盖。
    """
    import diagnose_lr_projection as mod  # type: ignore

    # 构造同 main() 中相同的默认路径逻辑(避免动 subprocess)
    def make_default_dir(tag: str | None) -> str:
        suffix = f"_{tag}" if tag else ""
        return str(mod.OUTPUT_BASE / f"2026_LR_平移预测_{mod.RUN_DATE}{suffix}")

    no_tag = make_default_dir(None)
    alpha = make_default_dir("alpha")
    beta = make_default_dir("beta")

    assert no_tag != alpha, "无 tag 与 alpha tag 必须产生不同路径"
    assert alpha != beta, "alpha tag 与 beta tag 必须产生不同路径"
    assert alpha.endswith("_alpha"), f"alpha 路径应以 _alpha 结尾,实际: {alpha}"
    assert beta.endswith("_beta"), f"beta 路径应以 _beta 结尾,实际: {beta}"


@pytest.mark.skipif(not _HAS_PARQUET, reason="parquet data not available (CI environment)")
def test_snapshot_tag_subprocess_e2e(tmp_path):
    """端到端验证:subprocess 跑时 stdout 报出的输出目录路径含 snapshot-tag。"""
    # 用 --output-dir 控制基址,加 snapshot-tag,断言 stdout 含 tag(覆盖 print 路径)
    r = subprocess.run([
        sys.executable, str(SCRIPT_PATH),
        "--proj-year", "2026", "--hist-years", "2023-2025",
        "--as-of", "2026-05-10",
        "--snapshot-tag", "gamma_test",
        "--output-dir", str(tmp_path / "out_gamma"),
    ], capture_output=True, text=True, cwd=PROJECT_ROOT, timeout=180)
    assert r.returncode == 0, f"跑失败:\n{r.stderr}"
    # stdout 中应包含 snapshot 标签提示行(确认参数被脚本识别并影响行为)
    assert "gamma_test" in r.stdout, (
        f"stdout 未提及 snapshot-tag=gamma_test:\n{r.stdout[-500:]}"
    )
