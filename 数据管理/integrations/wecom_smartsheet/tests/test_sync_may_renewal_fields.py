from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import sync_may_renewal_fields as smrf  # noqa: E402


def test_table_schema_file_is_optional_for_default_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["sync_may_renewal_fields.py", "sync"])

    args = smrf.parse_args()

    assert args.table_schema_file is None


def test_table_schema_file_is_optional_for_default_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["sync_may_renewal_fields.py", "seed-from-excel", "--input", "export.xlsx"])

    args = smrf.parse_args()

    assert args.table_schema_file is None


def test_seed_values_include_coverage_combination_from_excel() -> None:
    smrf.reset_table_spec()

    values = smrf.build_seed_values(
        {
            "vehicle_frame_no": "VIN001",
            "coverage_combination": "商业险",
        },
        enrichment_row=None,
    )

    assert values[smrf.field_id("coverage_combination")] == [{"text": "商业险"}]


def test_seed_enrichment_keys_include_coverage_combination() -> None:
    smrf.reset_table_spec()
    original_keys = list(smrf.BASE_UPDATE_KEYS)
    try:
        smrf.BASE_UPDATE_KEYS[:] = smrf.SEED_UPDATE_KEYS

        values = smrf.build_seed_values(
            {"vehicle_frame_no": "VIN001"},
            enrichment_row={
                "vehicle_frame_no": "VIN001",
                "coverage_combination": "主全",
            },
        )
    finally:
        smrf.BASE_UPDATE_KEYS[:] = original_keys

    assert values[smrf.field_id("coverage_combination")] == [{"text": "主全"}]


def test_date_to_epoch_ms_uses_utc_noon_to_preserve_business_date() -> None:
    assert smrf.date_to_epoch_ms(date(2026, 5, 18)) == "1779105600000"


def test_plan_field_stats_counts_each_updated_field() -> None:
    smrf.reset_table_spec()
    original_keys = list(smrf.BASE_UPDATE_KEYS)
    try:
        smrf.BASE_UPDATE_KEYS[:] = ["is_renewed", "is_quoted", "pricing_factor"]
        stats = smrf.plan_field_stats([
            {
                "values": {
                    smrf.field_id("is_renewed"): [{"text": "是"}],
                    smrf.field_id("is_quoted"): [{"text": "否"}],
                }
            },
            {
                "values": {
                    smrf.field_id("is_quoted"): [{"text": "是"}],
                    smrf.field_id("pricing_factor"): 0.72,
                }
            },
        ])
    finally:
        smrf.BASE_UPDATE_KEYS[:] = original_keys

    assert stats == {
        "total_update_records": 2,
        "field_counts": {
            "is_renewed": 1,
            "is_quoted": 2,
            "pricing_factor": 1,
        },
    }
