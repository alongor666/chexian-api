#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diagnose_breakeven 回归测试 — 锁定 query_dim 走 claims JOIN（不引用未绑定列）。

历史 bug（修复前在干净 main 上复现）：query_dim 的 FROM 是裸 read_parquet(GLOB)（仅 policy
列），却调 kpi_select() —— 后者 SELECT 引用 reported_claims / claim_cases（来自 claims LEFT
JOIN），触发 BinderException，导致章节 2~7 全部维度表产不出。修复：query_dim 改走
joined_source(con)，与 query_kpi() 同源。本测试用 fixture 固化该契约。
"""

from __future__ import annotations
import sys
from pathlib import Path

import pandas as pd
import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


def _build_policy_fixture(tmp_path: Path) -> Path:
    """两个吨位分组的 policy fixture（不含 reported_claims/claim_cases —— 镜像真实 policy parquet）。"""
    fixture = tmp_path / "policy_be.parquet"
    df = pd.DataFrame([
        {"policy_no": "P001", "premium": 10000.0, "fee_amount": 1500.0,
         "insurance_start_date": pd.Timestamp("2023-01-01"),
         "insurance_type": "商业保险", "commercial_pricing_factor": 0.8,
         "tonnage_segment": "A", "vehicle_frame_no": "VIN001", "branch_code": "SC"},
        {"policy_no": "P002", "premium": 20000.0, "fee_amount": 2000.0,
         "insurance_start_date": pd.Timestamp("2023-01-01"),
         "insurance_type": "商业保险", "commercial_pricing_factor": 1.0,
         "tonnage_segment": "B", "vehicle_frame_no": "VIN002", "branch_code": "SC"},
    ])
    df.to_parquet(fixture, index=False)
    return fixture


def _build_claims_fixture(tmp_path: Path) -> Path:
    """claims fixture：P001 已决 5000、P002 已决 2000（settlement_time 非空 → 取 settled_amount）。

    report_time / payment_time 是 _ensure_claims_view 的 DISTINCT ON(claim_no) tie-breaker
    引用列（#845 起对齐 lr_projection），真实 claims parquet 含此列，fixture 须镜像。
    """
    fixture = tmp_path / "claims_be.parquet"
    df = pd.DataFrame([
        {"policy_no": "P001", "claim_no": "C001",
         "report_time": pd.Timestamp("2023-05-01"),
         "settlement_time": pd.Timestamp("2023-06-01"),
         "payment_time": pd.Timestamp("2023-06-05"),
         "settled_amount": 5000.0, "reserve_amount": 0.0},
        {"policy_no": "P002", "claim_no": "C002",
         "report_time": pd.Timestamp("2023-05-01"),
         "settlement_time": pd.Timestamp("2023-06-01"),
         "payment_time": pd.Timestamp("2023-06-05"),
         "settled_amount": 2000.0, "reserve_amount": 0.0},
    ])
    df.to_parquet(fixture, index=False)
    return fixture


def test_query_dim_joins_claims(tmp_path, monkeypatch):
    """query_dim 必须 LEFT JOIN claims：

    - 不再因引用 reported_claims/claim_cases 抛 BinderException（修复前崩在此处）。
    - loss_ratio 由 claims 正确算出（A=50%、B=10%），证明 claims 真的被关联
      （而非用"精简 SELECT 剥离 claims 列"的错误修法 —— 那会让 loss_ratio 恒为 0/NULL）。
    """
    import duckdb
    import diagnose_common
    import diagnose_breakeven as be  # type: ignore

    policy_fixture = _build_policy_fixture(tmp_path)
    claims_fixture = _build_claims_fixture(tmp_path)
    # joined_source / _ensure_claims_view 读 diagnose_common 模块级 GLOB / CLAIMS_GLOB
    monkeypatch.setattr(diagnose_common, "GLOB", str(policy_fixture))
    monkeypatch.setattr(diagnose_common, "CLAIMS_GLOB", str(claims_fixture))
    # be.GLOB 是 import 时的独立绑定；一并 patch，使任何回退到「裸 read_parquet(GLOB)」的
    # 改法在任意环境（含无 parquet 的 CI）都精确复现原始 BinderException 而非 IO Error。
    monkeypatch.setattr(be, "GLOB", str(policy_fixture))

    con = duckdb.connect()
    rows = be.query_dim(con, "1=1", "1=1", "tonnage_segment")

    by_dim = {r["dim_label"]: r for r in rows}
    assert set(by_dim) == {"A", "B"}, f"应按 tonnage_segment 分两组，实际 {set(by_dim)}"
    # EARNED = premium（2023 起保早已满期），loss_ratio = reported_claims / EARNED * 100
    assert by_dim["A"]["loss_ratio"] == pytest.approx(50.0), by_dim["A"]["loss_ratio"]
    assert by_dim["B"]["loss_ratio"] == pytest.approx(10.0), by_dim["B"]["loss_ratio"]
    # reported_claims（万元）：A=0.5、B=0.2 —— 仅当 claims 被 JOIN 才非零
    assert by_dim["A"]["reported_claims"] == pytest.approx(0.5)
    assert by_dim["B"]["reported_claims"] == pytest.approx(0.2)
    assert by_dim["A"]["claim_cases"] == 1
    # expense_ratio = fee_amount / premium * 100（policy 列，不依赖 claims）
    assert by_dim["A"]["expense_ratio"] == pytest.approx(15.0)


def test_query_dim_case_when_dim_expr(tmp_path, monkeypatch):
    """dim_expr 为 CASE WHEN（新转续过户）时也须正常 —— 子查询包裹 + claims JOIN 共存。"""
    import duckdb
    import diagnose_common
    import diagnose_breakeven as be  # type: ignore

    policy_fixture = _build_policy_fixture(tmp_path)
    claims_fixture = _build_claims_fixture(tmp_path)
    monkeypatch.setattr(diagnose_common, "GLOB", str(policy_fixture))
    monkeypatch.setattr(diagnose_common, "CLAIMS_GLOB", str(claims_fixture))
    monkeypatch.setattr(be, "GLOB", str(policy_fixture))

    con = duckdb.connect()
    # fixture 无 is_new_car/is_transfer/is_renewal 列 → 用一个仅依赖 policy 列的 CASE WHEN 验证语法路径
    rows = be.query_dim(
        con, "1=1", "1=1",
        "CASE WHEN tonnage_segment = 'A' THEN '轻' ELSE '重' END",
    )
    by_dim = {r["dim_label"]: r for r in rows}
    assert set(by_dim) == {"轻", "重"}
    assert by_dim["轻"]["loss_ratio"] == pytest.approx(50.0)
