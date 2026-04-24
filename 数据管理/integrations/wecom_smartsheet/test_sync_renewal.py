import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sync_renewal import (
    DEFAULT_SCHEMA,
    apply_add_response,
    build_record,
    date_to_epoch_ms,
    format_customer_status,
    iter_rate_limited_batches,
    plan_upsert,
)


def test_build_record_writes_salesman_as_text_and_utc_date():
    row = {
        "vehicle_frame_no": "VIN001",
        "expiry_date": date(2026, 3, 31),
        "org_level_3": "自贡",
        "team_name": "自贡业务一部",
        "plate_no": "川C12345",
        "salesman_name": "110053952刘芮嘉",
        "customer_category": "非营业个人客车",
        "coverage_combination": "主全",
        "prior_premium": 1000,
        "prior_discount": 0.87,
        "quote_premium": 1244,
        "quote_discount": None,
        "is_quoted": True,
        "is_renewed": False,
        "is_expired": True,
        "days_to_expiry": -24,
        "loss_reason": "",
        "renewal_mode": "自留",
    }

    record = build_record(row)

    assert date_to_epoch_ms(date(2026, 3, 31)) == "1774915200000"
    assert record["values"]["f04Gwj"] == "1774915200000"
    assert record["values"]["fMDwYc"] == "110053952刘芮嘉"
    assert record["values"]["fMAfWQ"] == "VIN001"
    assert record["values"]["fFMlZM"] == 1000
    assert record["values"]["fvtVUv"] == 1244
    assert record["values"]["fkjhnX"] == [{"text": "是"}]
    assert record["values"]["fnk47h"] == "已过期、涨价24.4%、未续回"
    assert "fDvNY2" not in record["values"]
    assert DEFAULT_SCHEMA["fMDwYc"] == "业务员"
    assert DEFAULT_SCHEMA["fFMlZM"] == "上年保费"
    assert DEFAULT_SCHEMA["fvtVUv"] == "报价保费"


def test_format_customer_status_records_price_quote_renewal_and_expiry():
    assert format_customer_status(
        {
            "prior_premium": 1000,
            "quote_premium": 1250,
            "is_quoted": True,
            "is_renewed": False,
            "is_expired": True,
            "days_to_expiry": -1,
        }
    ) == "已过期、涨价25%、未续回"

    assert format_customer_status(
        {
            "prior_premium": 1000,
            "quote_premium": 950,
            "is_quoted": True,
            "is_renewed": False,
            "is_expired": False,
            "days_to_expiry": 5,
        }
    ) == "5天后到期、未涨价、未续回"

    assert format_customer_status(
        {
            "prior_premium": 1000,
            "quote_premium": None,
            "is_quoted": False,
            "is_renewed": False,
            "is_expired": True,
            "days_to_expiry": -1,
        }
    ) == "已过期、未报价、未续回"

    assert format_customer_status(
        {
            "prior_premium": 1000,
            "quote_premium": None,
            "is_quoted": False,
            "is_renewed": False,
            "is_expired": False,
            "days_to_expiry": 31,
        }
    ) == "未到报价期"

    assert format_customer_status(
        {
            "prior_premium": 1000,
            "quote_premium": 1250,
            "is_quoted": True,
            "is_renewed": True,
            "is_expired": True,
            "days_to_expiry": -1,
        }
    ) == "涨价25%、已续回"


def test_plan_upsert_splits_existing_new_and_missing_vins():
    rows = [
        {"vehicle_frame_no": "VIN001", "expiry_date": date(2026, 3, 31), "salesman_name": "A"},
        {"vehicle_frame_no": "VIN002", "expiry_date": date(2026, 4, 1), "salesman_name": "B"},
    ]
    state = {
        "records": {
            "VIN001": {"record_id": "rec-1"},
            "VIN999": {"record_id": "rec-old"},
        }
    }

    plan = plan_upsert(rows, state)

    assert [item["record_id"] for item in plan.update_records] == ["rec-1"]
    assert [item["source_row"]["vehicle_frame_no"] for item in plan.add_records] == ["VIN002"]
    assert plan.missing_vins == ["VIN999"]


def test_apply_add_response_persists_vin_record_id_mapping():
    state = {"summary": {}, "records": {}}
    add_rows = [
        {"vehicle_frame_no": "VIN001", "policy_no": "P1", "expiry_date": date(2026, 3, 31), "salesman_name": "A"},
        {"vehicle_frame_no": "VIN002", "policy_no": "P2", "expiry_date": date(2026, 4, 1), "salesman_name": "B"},
    ]
    response = {
        "errcode": 0,
        "errmsg": "ok",
        "add_records": [{"record_id": "rec-1"}, {"record_id": "rec-2"}],
    }

    apply_add_response(state, add_rows, response)

    assert state["records"]["VIN001"]["record_id"] == "rec-1"
    assert state["records"]["VIN002"]["policy_no"] == "P2"
    json.dumps(state, ensure_ascii=False)


def test_iter_rate_limited_batches_splits_by_minute_limit_and_marks_waits():
    items = [{"id": i} for i in range(6500)]

    windows = list(iter_rate_limited_batches(items, batch_size=1000, records_per_minute=3000))

    assert [(w.batch_index, len(w.items), w.sleep_before_seconds) for w in windows] == [
        (1, 1000, 0),
        (2, 1000, 0),
        (3, 1000, 0),
        (4, 1000, 60),
        (5, 1000, 0),
        (6, 1000, 0),
        (7, 500, 60),
    ]
