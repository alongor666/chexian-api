#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""理赔金额口径回归测试：已决/未决二选一，不相加。"""

from __future__ import annotations

from pathlib import Path


PIPELINES_DIR = Path(__file__).resolve().parent


def test_forecast_claim_settled_bucket_only_counts_settled_claims():
    """forecast 报表中的已决分项不能混入未结案案件上的部分 settled_amount。"""
    src = (PIPELINES_DIR / "diagnose_forecast_claim.py").read_text(encoding="utf-8")

    assert "SUM(CASE WHEN c.settlement_time IS NOT NULL THEN c.settled_amount ELSE 0 END)" in src
    assert "COALESCE(SUM(c.settled_amount), 0) AS settled" not in src
