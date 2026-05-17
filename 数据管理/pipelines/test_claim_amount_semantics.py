#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""理赔金额口径回归测试：已决/未决二选一，不相加。"""

from __future__ import annotations

from pathlib import Path


PIPELINES_DIR = Path(__file__).resolve().parent


def test_forecast_claim_settled_bucket_only_counts_settled_claims():
    """forecast 报表中的已决分项不能混入未结案案件上的部分 settled_amount。"""
    src = (PIPELINES_DIR / "diagnose_forecast_claim.py").read_text(encoding="utf-8")

    # 必须按 settlement_time IS NOT NULL 区分已决 / 未决
    assert "c.settlement_time IS NOT NULL" in src
    # 原始 blanket-sum 已决口径不能回归
    assert "COALESCE(SUM(c.settled_amount), 0) AS settled" not in src


def test_forecast_claim_settled_bucket_respects_cohort_cutoff():
    """codex P1 回归（PR #388）：已决/未决判定必须按 base_end 时点截断。

    若只用 settlement_time IS NULL 区分，会把 base_end 之后才结案的赔案
    提前算进"已决"，泄漏未来信息。修复后已决分支必须显式带上
    `settlement_time < TIMESTAMP '{base_end_excl}'`（与 report_time 同一截断）。
    """
    src = (PIPELINES_DIR / "diagnose_forecast_claim.py").read_text(encoding="utf-8")

    # 已决分支必须带 base_end_excl 时点截断（防未来信息泄漏）
    assert "c.settlement_time < TIMESTAMP '{base_end_excl}'" in src
    # 未决分支必须覆盖"未结案 OR 在 base_end 之后才结案"两种情况
    assert "c.settlement_time IS NULL" in src
    assert "c.settlement_time >= TIMESTAMP '{base_end_excl}'" in src
