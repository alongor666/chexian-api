from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

import duckdb

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from baseline_loss_ratio_evaluation import EvaluationParams, run_evaluation  # type: ignore


def _seed(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(
        """
        CREATE TABLE policy_rows (
          policy_no VARCHAR,
          policy_date DATE,
          insurance_start_date DATE,
          insurance_end_date DATE,
          customer_category VARCHAR,
          agent_name VARCHAR,
          insurance_type VARCHAR,
          insurance_grade VARCHAR,
          commercial_pricing_factor DOUBLE,
          premium DOUBLE
        )
        """
    )
    con.execute(
        """
        INSERT INTO policy_rows VALUES
          ('P1', DATE '2024-05-01', DATE '2024-05-01', DATE '2025-04-30', '非营业个人客车', '普通渠道', '商业保险', 'A', 0.8, 80),
          ('P2', DATE '2024-05-01', DATE '2024-05-01', DATE '2025-04-30', '非营业个人客车', '普通渠道', '商业保险', 'A', 1.0, 100),
          ('P3', DATE '2024-05-01', DATE '2024-05-01', DATE '2025-04-30', '非营业个人客车', '普通渠道', '交强险', 'A', NULL, 60),
          ('P4', DATE '2026-04-20', DATE '2026-04-20', DATE '2027-04-19', '非营业个人客车', '中国邮政集团', '商业保险', 'A', 0.7, 70),
          ('P5', DATE '2026-04-20', DATE '2026-04-20', DATE '2027-04-19', '非营业个人客车', '中国邮政集团', '交强险', 'A', NULL, 50)
        """
    )
    con.execute(
        """
        CREATE TABLE claim_rows (
          policy_no VARCHAR,
          report_time DATE,
          settled_amount DOUBLE,
          pending_amount DOUBLE
        )
        """
    )
    con.execute(
        """
        INSERT INTO claim_rows VALUES
          ('P1', DATE '2025-02-01', 40, 10),
          ('P2', DATE '2025-03-01', 30, 0),
          ('P3', DATE '2025-04-01', 7, 5)
        """
    )


def test_run_evaluation_applies_baseline_chain_to_target_agent() -> None:
    con = duckdb.connect()
    _seed(con)

    params = EvaluationParams(
        policy_source="policy_rows",
        claims_source="claim_rows",
        start_date=date(2024, 5, 1),
        end_date=date(2025, 4, 30),
        target_start_date=date(2026, 4, 20),
        target_end_date=date(2026, 5, 11),
        valuation_date=date(2026, 5, 12),
        customer_category="非营业个人客车",
        target_agent_pattern="%邮政%",
        target_date_field="policy_date",
    )

    result = run_evaluation(con, params)
    baseline = {
        (r["insurance_type"], r["insurance_grade"]): r
        for r in result["baseline"]
    }
    target = {
        (r["insurance_type"], r["insurance_grade"]): r
        for r in result["target"]
    }

    commercial_base = baseline[("商业保险", "A")]
    assert commercial_base["baseline_earned_premium"] == 200
    assert round(commercial_base["baseline_earned_claim_ratio"], 4) == 40.0

    commercial_target = target[("商业保险", "A")]
    assert commercial_target["target_earned_premium"] == 4.41
    assert commercial_target["target_baseline_earned_premium"] == 6.3
    # codex P2 修复后：estimated_* 使用未 ROUND 的精确分子分母计算，
    # 不再受 target_baseline_earned_premium 展示列 ROUND(2) 的误差影响
    assert round(commercial_target["estimated_reported_claims"], 4) == 2.5205
    assert round(commercial_target["estimated_earned_claim_ratio"], 4) == 57.1429

    compulsory_base = baseline[("交强险", "A")]
    assert compulsory_base["baseline_earned_premium"] == 60
    assert round(compulsory_base["baseline_earned_claim_ratio"], 4) == 20.0

    compulsory_target = target[("交强险", "A")]
    assert compulsory_target["target_earned_premium"] == 3.15
    assert round(compulsory_target["estimated_earned_claim_ratio"], 4) == 20.0
