import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sync_renewal import (
    DEFAULT_SCHEMA,
    OperationItem,
    RateLimiter,
    apply_add_response,
    build_record,
    date_to_epoch_ms,
    format_customer_status,
    group_contiguous_operations,
    iter_rate_limited_batches,
    plan_upsert,
)
from sync_renewal_v2 import (
    FieldDef,
    build_record as build_record_v2,
    payload_hash,
    plan_upsert as plan_upsert_v2,
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


def test_v2_build_record_writes_loss_reason_from_derived_customer_status():
    field = FieldDef(
        key="loss_reason",
        field_id="fnk47h",
        label="流失原因分析",
        source="derived.customer_status",
        type="text",
    )
    record = build_record_v2(
        {
            "customer_status": "已过期、涨价24.4%、未续回",
            "salesman_unmatched": False,
        },
        [field],
    )

    assert record["values"]["fnk47h"] == "已过期、涨价24.4%、未续回"


def test_v2_plan_upsert_skips_unchanged_payload_hash():
    field = FieldDef(
        key="salesman_name",
        field_id="fMDwYc",
        label="业务员",
        source="base.salesman_name",
        type="text",
    )
    row = {"vehicle_frame_no": "VIN001", "salesman_name": "A"}
    record = build_record_v2(row, [field])
    state = {
        "records": {
            "VIN001": {
                "record_id": "rec-1",
                "payload_hash": payload_hash(record),
            }
        }
    }

    plan = plan_upsert_v2([row], state, {}, [field], set())

    assert plan.add_items == []
    assert plan.update_items == []
    assert plan.missing_vins == []

    changed = {"vehicle_frame_no": "VIN001", "salesman_name": "B"}
    changed_plan = plan_upsert_v2([changed], state, {}, [field], set())

    assert len(changed_plan.update_items) == 1
    assert changed_plan.update_items[0]["record_id"] == "rec-1"


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


def test_iter_rate_limited_batches_splits_by_size_only():
    items = [{"id": i} for i in range(6500)]

    windows = list(iter_rate_limited_batches(items, batch_size=1000, records_per_minute=3000))

    assert [(w.batch_index, len(w.items), w.sleep_before_seconds) for w in windows] == [
        (1, 1000, 0),
        (2, 1000, 0),
        (3, 1000, 0),
        (4, 1000, 0),
        (5, 1000, 0),
        (6, 1000, 0),
        (7, 500, 0),
    ]


def test_iter_rate_limited_batches_preserves_operation_order():
    operations = [
        *(OperationItem(op="update", payload={"id": f"u{i}"}) for i in range(2000)),
        *(OperationItem(op="add", payload={"id": f"a{i}"}) for i in range(2000)),
    ]

    windows = list(iter_rate_limited_batches(operations, batch_size=1000, records_per_minute=3000))

    assert [(w.batch_index, len(w.items)) for w in windows] == [
        (1, 1000),
        (2, 1000),
        (3, 1000),
        (4, 1000),
    ]
    assert all(item.op == "update" for item in windows[1].items)
    assert all(item.op == "add" for item in windows[2].items)


def _make_clock():
    state = {"t": 0.0, "slept": 0.0}

    def now() -> float:
        return state["t"]

    def sleep(seconds: float) -> None:
        state["slept"] += seconds
        state["t"] += seconds

    def advance(seconds: float) -> None:
        state["t"] += seconds

    return now, sleep, advance, state


def test_rate_limiter_no_sleep_when_under_quota():
    now, sleep, _advance, state = _make_clock()
    limiter = RateLimiter(records_per_minute=3000, sleep_seconds=60, now_fn=now, sleep_fn=sleep)

    for _ in range(3):
        slept = limiter.acquire(1000)
        assert slept == 0.0

    assert state["slept"] == 0.0


def test_rate_limiter_sleeps_only_for_remaining_window_when_quota_full():
    now, sleep, advance, state = _make_clock()
    limiter = RateLimiter(records_per_minute=3000, sleep_seconds=60, now_fn=now, sleep_fn=sleep)

    limiter.acquire(3000)
    advance(20)
    slept = limiter.acquire(1)

    assert slept == 40.0
    assert state["slept"] == 40.0


def test_rate_limiter_skips_sleep_when_window_already_elapsed():
    """关键修复：webhook IO 慢导致窗口自然过期时，不再冗余 sleep 60s。"""
    now, sleep, advance, state = _make_clock()
    limiter = RateLimiter(records_per_minute=3000, sleep_seconds=60, now_fn=now, sleep_fn=sleep)

    limiter.acquire(3000)
    advance(186)
    slept = limiter.acquire(100)

    assert slept == 0.0
    assert state["slept"] == 0.0


def test_group_contiguous_operations_preserves_order_and_boundaries():
    grouped = group_contiguous_operations(
        [
            OperationItem(op="update", payload=1),
            OperationItem(op="update", payload=2),
            OperationItem(op="add", payload=3),
            OperationItem(op="add", payload=4),
            OperationItem(op="update", payload=5),
        ]
    )

    assert grouped == [
        ("update", [1, 2]),
        ("add", [3, 4]),
        ("update", [5]),
    ]


def test_may_build_seed_values_skips_schema_trimmed_fields():
    """codex PR#487 (P2): schema file 裁剪掉的 seed 字段，build_seed_values 应跳过，
    而非在 field_id(key) 抛 KeyError（与 build_update_values 的守卫对齐）。"""
    import sync_may_renewal_fields as may

    may.reset_table_spec()
    # 模拟 --table-schema-file 把目标表没有的列裁掉
    may.CURRENT_FULL_FIELD_IDS.pop("seat_account", None)
    may.CURRENT_FULL_FIELD_IDS.pop("team", None)
    excel_row = {
        "vehicle_frame_no": "VIN001",
        "seat_account": "acct01",  # 被裁字段且有值 —— 旧实现会抛 KeyError
        "team": "团队A",
        "vehicle_type": "非营业货车",
    }
    try:
        values = may.build_seed_values(excel_row, None)
        # 被裁字段不写入；保留字段正常写入
        assert may.FULL_FIELD_IDS["seat_account"] not in values
        assert may.FULL_FIELD_IDS["team"] not in values
        assert may.CURRENT_FULL_FIELD_IDS["vehicle_type"] in values
    finally:
        may.reset_table_spec()  # 复原全局态，避免污染其他测试


def test_may_read_excel_rows_maps_vehicle_type_aliases(tmp_path):
    """codex PR#487 (P2): '车型'(当前导出) 与 '客户类别'(表列名) 两种表头都映射到
    vehicle_type，且多别名不互相覆盖为 None。"""
    from openpyxl import Workbook

    import sync_may_renewal_fields as may

    def make(headers, values):
        wb = Workbook()
        ws = wb.active
        ws.append(headers)
        ws.append(values)
        path = tmp_path / f"{headers[-1]}.xlsx"
        wb.save(path)
        return path

    rows_chexing = may.read_excel_rows(make(["车架号", "车型"], ["VINA", "非营业货车"]))
    rows_kehu = may.read_excel_rows(make(["车架号", "客户类别"], ["VINB", "家庭自用车"]))

    assert rows_chexing[0]["vehicle_type"] == "非营业货车"
    assert rows_kehu[0]["vehicle_type"] == "家庭自用车"
