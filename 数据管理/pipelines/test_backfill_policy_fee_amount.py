import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backfill_policy_fee_amount import backfill_policy_file


def test_backfills_zero_fee_from_cost_csv_without_overwriting_existing_fee(tmp_path):
    policy_path = tmp_path / "policy.parquet"
    output_path = tmp_path / "policy_patched.parquet"
    cost_path = tmp_path / "cost.csv"

    pd.DataFrame(
        [
            {
                "policy_no": "P1",
                "vehicle_frame_no": "VIN1",
                "insurance_start_date": "2026-01-01",
                "policy_date": "2026-01-02",
                "premium": 1000.0,
                "fee_amount": 0.0,
            },
            {
                "policy_no": "P2",
                "vehicle_frame_no": "VIN2",
                "insurance_start_date": "2026-01-03",
                "policy_date": "2026-01-04",
                "premium": 2000.0,
                "fee_amount": 12.0,
            },
            {
                "policy_no": "P3",
                "vehicle_frame_no": "VIN3",
                "insurance_start_date": "2026-01-05",
                "policy_date": "2026-01-06",
                "premium": 3000.0,
                "fee_amount": 0.0,
            },
        ]
    ).to_parquet(policy_path, index=False)

    pd.DataFrame(
        [
            {"车架号": "VIN1", "保险起期": "2026-01-01", "保费": 1000.0, "手续费金额实际": 80.0},
            {"车架号": "VIN1", "保险起期": "2026-01-01", "保费": 1000.0, "手续费金额实际": 20.0},
            {"车架号": "VIN2", "保险起期": "2026-01-03", "保费": 2000.0, "手续费金额实际": 200.0},
            {"车架号": "VIN3", "保险起期": "2026-01-05", "保费": 3000.0, "手续费金额实际": 0.0},
        ]
    ).to_csv(cost_path, index=False)

    stats = backfill_policy_file(policy_path, cost_path, output_path)

    patched = pd.read_parquet(output_path).sort_values("policy_no")
    assert patched["fee_amount"].tolist() == [100.0, 12.0, 0.0]
    assert stats.rows == 3
    assert stats.matched_rows == 3
    assert stats.backfilled_rows == 1
    assert stats.old_fee_sum == 12.0
    assert stats.new_fee_sum == 112.0
