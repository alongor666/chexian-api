from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import sync_may_renewal_fields as smrf  # noqa: E402


def test_table_schema_file_is_optional_for_default_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["sync_may_renewal_fields.py", "sync", "--province", "SC"])

    args = smrf.parse_args()

    assert args.table_schema_file is None
    assert args.province == "SC"


def test_table_schema_file_is_optional_for_default_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sys, "argv",
        ["sync_may_renewal_fields.py", "seed-from-excel", "--province", "SC", "--input", "export.xlsx"],
    )

    args = smrf.parse_args()

    assert args.table_schema_file is None


def test_sync_without_province_exits(monkeypatch: pytest.MonkeyPatch) -> None:
    """省份轴收窄（50d62e）fail-closed：缺 --province 直接 argparse 报错退出。"""
    monkeypatch.setattr(sys, "argv", ["sync_may_renewal_fields.py", "sync"])

    with pytest.raises(SystemExit):
        smrf.parse_args()


def test_unregistered_province_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """未注册省份禁静默回落（data-pipeline.md 红线）——resolve 阶段抛错。"""
    monkeypatch.setattr(sys, "argv", ["sync_may_renewal_fields.py", "sync", "--province", "XX"])

    args = smrf.parse_args()
    with pytest.raises(Exception, match="未注册省份"):
        smrf._resolve_policy_scope(args)


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
