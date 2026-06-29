#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diagnose_common / diagnose_agent 赔案去重 tie-breaker 确定性回归测试。

锁定 `DISTINCT ON (claim_no)` 的完整 tie-breaker（取最新版本赔案）契约：
同一 claim_no 跨分区出现多版本时，去重必须**确定性地取「最新版本」**
（报案时间 → 结案时间 → 赔付时间 倒序），且对 parquet 物理行序不敏感
（permutation invariant）——否则下游
`SUM(CASE WHEN settlement_time ... settled_amount ELSE reserve_amount)`
会随 DuckDB 任意选行而抖动。

背景：实测当前 claims_detail 的 claim_no 唯一，本 tie-breaker 不触发，是**防御性护栏**
（防未来 ETL 产生重复），与 PR #843 给 diagnose_lr_projection 的 v_claims_agg
加的 tie-breaker 同源。本测试用合成 fixture（含重复 claim_no + 不同金额 + 不同时间）
覆盖 diagnose_common 此前无数值测试的 claims 聚合路径。

不依赖真实 parquet，CI 环境亦可跑。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import pytest

try:
    import duckdb
except ImportError:  # pragma: no cover - 环境无 duckdb 时整模块跳过
    pytest.skip("duckdb 不可用", allow_module_level=True)

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


# C001 的两个版本：late（max report_time，已决 3000）应被取中；early（旧未决 9000）应被丢弃。
_LATE_REPORTED = 3000.0
_EARLY_REPORTED = 9000.0
# C002 单条无重复（已决为空 → 取未决 reserve 500），作对照。
_C002_REPORTED = 500.0


def _claims_rows() -> dict:
    """返回三条赔案行（含同 claim_no 的 early/late 两版本 + 独立 C002）。"""
    return {
        # C001 旧版本：仅报案、未结案，未决估损 9000
        "early": {
            "policy_no": "P001", "claim_no": "C001",
            "report_time": pd.Timestamp("2024-01-10"),
            "settlement_time": pd.NaT, "payment_time": pd.NaT,
            "settled_amount": 0.0, "reserve_amount": _EARLY_REPORTED,
            "branch_code": "SC",
        },
        # C001 最新版本：已结案，已决 3000（report/settlement/payment 时间均更晚）
        "late": {
            "policy_no": "P001", "claim_no": "C001",
            "report_time": pd.Timestamp("2024-08-20"),
            "settlement_time": pd.Timestamp("2024-08-25"),
            "payment_time": pd.Timestamp("2024-08-26"),
            "settled_amount": _LATE_REPORTED, "reserve_amount": 0.0,
            "branch_code": "SC",
        },
        # C002 单条：未结案，未决 500
        "c002": {
            "policy_no": "P002", "claim_no": "C002",
            "report_time": pd.Timestamp("2024-03-01"),
            "settlement_time": pd.NaT, "payment_time": pd.NaT,
            "settled_amount": 0.0, "reserve_amount": _C002_REPORTED,
            "branch_code": "SC",
        },
    }


def _build_claims_fixture(path: Path, order: tuple[str, ...]) -> Path:
    """按指定物理行序写 claims fixture parquet（用于验证 tie-breaker 对行序不敏感）。"""
    rows = _claims_rows()
    df = pd.DataFrame([rows[k] for k in order])
    # 显式 datetime64：含 NaT 的列若全空会落成 object，read_parquet 后类型漂移致比较异常。
    for col in ("report_time", "settlement_time", "payment_time"):
        df[col] = pd.to_datetime(df[col])
    df.to_parquet(path, index=False)
    return path


def _build_policy_fixture(path: Path) -> Path:
    """diagnose_agent.build_views 的 v_agent/v_org 需 policy glob：最小可解析 fixture。"""
    df = pd.DataFrame([
        {"policy_no": "P001", "agent_name": "示例经代", "policy_date": pd.Timestamp("2024-05-01"),
         "fee_amount": 100.0, "premium": 1000.0, "branch_code": "SC"},
        {"policy_no": "P002", "agent_name": "示例经代", "policy_date": pd.Timestamp("2024-06-01"),
         "fee_amount": 200.0, "premium": 2000.0, "branch_code": "SC"},
    ])
    df["policy_date"] = pd.to_datetime(df["policy_date"])
    df.to_parquet(path, index=False)
    return path


# 三种物理行序：tie-breaker 正确时三者结果必须完全一致（permutation invariant）。
_ORDERS = [
    ("early", "late", "c002"),
    ("late", "early", "c002"),
    ("c002", "late", "early"),
]


@pytest.mark.parametrize("order", _ORDERS)
def test_diagnose_common_claims_tiebreaker_picks_latest(tmp_path, monkeypatch, order):
    """diagnose_common._ensure_claims_view：去重取最新版本赔案，且对 parquet 物理行序不敏感。"""
    import diagnose_common as mod  # type: ignore

    fixture = _build_claims_fixture(tmp_path / f"claims_{'_'.join(order)}.parquet", order)
    monkeypatch.setattr(mod, "CLAIMS_GLOB", str(fixture))

    con = duckdb.connect()
    mod._ensure_claims_view(con)
    reported = dict(con.execute(
        "SELECT policy_no, reported_claims FROM _claims_agg"
    ).fetchall())
    cases = dict(con.execute(
        "SELECT policy_no, claim_cases FROM _claims_agg"
    ).fetchall())

    assert reported["P001"] == _LATE_REPORTED, (
        f"行序 {order}：P001 应取最新版本赔案(已决 {_LATE_REPORTED})，实际 {reported['P001']}；"
        f"取到 {_EARLY_REPORTED} 说明 tie-breaker 失效(选了旧未决版本)"
    )
    assert reported["P002"] == _C002_REPORTED, f"行序 {order}：P002 未决口径应为 {_C002_REPORTED}"
    assert cases["P001"] == 1 and cases["P002"] == 1, "claim_cases 应按 claim_no 去重计数"


@pytest.mark.parametrize("order", _ORDERS)
def test_diagnose_agent_claims_tiebreaker_picks_latest(tmp_path, monkeypatch, order):
    """diagnose_agent.DataLoader.build_views 的 v_claims_agg 同款 tie-breaker：取最新版本赔案。"""
    import diagnose_agent as mod  # type: ignore

    claims = _build_claims_fixture(tmp_path / f"agent_claims_{'_'.join(order)}.parquet", order)
    policy = _build_policy_fixture(tmp_path / f"agent_policy_{'_'.join(order)}.parquet")
    monkeypatch.setattr(mod, "CLAIMS_GLOB", str(claims))
    monkeypatch.setattr(mod, "POLICY_GLOB", str(policy))

    loader = mod.DataLoader()
    # org=None 跳过机构过滤；agent="" → LIKE '%%' 匹配全部；years=[2024] 命中 fixture policy_date。
    loader.build_views(org=None, agent="", years=[2024])
    reported = dict(loader.con.execute(
        "SELECT policy_no, reported_claims FROM v_claims_agg"
    ).fetchall())

    assert reported["P001"] == _LATE_REPORTED, (
        f"行序 {order}：P001 应取最新版本赔案(已决 {_LATE_REPORTED})，实际 {reported['P001']}"
    )
    assert reported["P002"] == _C002_REPORTED, f"行序 {order}：P002 未决口径应为 {_C002_REPORTED}"
