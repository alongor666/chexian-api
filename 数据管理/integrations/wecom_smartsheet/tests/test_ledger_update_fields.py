"""台账字段更新引擎（sync_ledger_update_fields）纯函数锁。

锁 4 件事：
  1. derive_update_values 口径：非应续行不写任何续保字段（留空 ≠ 否，防假阴性）；
     应续行 is_quoted 映射 是/否；风险等级仅 A-F 白名单；NaN 数值不写入。
  2. build_plan 幂等：payload_hash 未变跳过；state 缺失记 missing；
     一个保单号多 record_id 时按记录逐条扇出。
  3. 敏感字段（sensitive: true）样例脱敏。
  4. prime-state 单元格文本提取（text 型 list 结构）。
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from sync_ledger_update_fields import (  # noqa: E402
    UpdateConfig,
    UpdateFieldSpec,
    build_plan,
    derive_update_values,
    format_update_values,
    mask_update_sample,
    payload_hash,
    read_key_text,
)

SPECS = (
    UpdateFieldSpec("applicant_name", "ffFwIh", "TEXT", "投保人", sensitive=True),
    UpdateFieldSpec("renewal_is_quoted", "fGkRjv", "SINGLE_SELECT", "是否报价-续保"),
    UpdateFieldSpec("renewal_insurance_grade", "fp6zIf", "SINGLE_SELECT", "风险等级-续保"),
    UpdateFieldSpec("renewal_pricing_factor", "fKo7sD", "NUMBER", "定价-续保"),
    UpdateFieldSpec("renewal_commercial_ncd", "f6Crlx", "NUMBER", "商NCD-续保"),
)


def make_config(**overrides):
    defaults = dict(
        instance_name="t",
        webhook_env="W",
        policy_glob="g",
        filters={},
        batch_size=100,
        sheet_id="s",
        key_source_field="policy_no",
        key_field_id="ftQMc5",
        renewal_tracker_glob="rt",
        quotes_glob="q",
        state_path=Path("/tmp/never-written.json"),
        fields=SPECS,
    )
    defaults.update(overrides)
    return UpdateConfig(**defaults)


def test_non_renewal_row_writes_no_renewal_fields():
    row = {
        "policy_no": "618X",
        "applicant_name": "张三",
        "in_renewal_universe": False,
        "has_renewal_quote": None,
        "renewal_insurance_grade_raw": "A",   # 即便报价域有值也不写（非应续）
        "renewal_pricing_factor": 0.98,
        "renewal_commercial_ncd": 0.85,
    }
    values = derive_update_values(row)
    assert values == {"applicant_name": "张三"}


def test_renewal_row_maps_quoted_flag_and_attrs():
    row = {
        "policy_no": "618X",
        "applicant_name": "张三",
        "in_renewal_universe": True,
        "has_renewal_quote": True,
        "renewal_insurance_grade_raw": "B",
        "renewal_pricing_factor": 1.05,
        "renewal_commercial_ncd": 0.7,
    }
    values = derive_update_values(row)
    assert values["renewal_is_quoted"] == "是"
    assert values["renewal_insurance_grade"] == "B"
    assert values["renewal_pricing_factor"] == 1.05
    assert values["renewal_commercial_ncd"] == 0.7


def test_renewal_row_not_quoted_maps_no_and_suppresses_attrs():
    # 底册判"未报价"时即便车架号能关联到旧报价，也不得写报价属性（防口径打架）
    row = {"policy_no": "618X", "in_renewal_universe": True, "has_renewal_quote": False,
           "renewal_insurance_grade_raw": "A", "renewal_pricing_factor": 1.0,
           "renewal_commercial_ncd": 0.9}
    values = derive_update_values(row)
    assert values["renewal_is_quoted"] == "否"
    assert "renewal_insurance_grade" not in values
    assert "renewal_pricing_factor" not in values
    assert "renewal_commercial_ncd" not in values


def test_invalid_grade_and_nan_skipped():
    row = {
        "policy_no": "618X",
        "in_renewal_universe": True,
        "has_renewal_quote": True,
        "renewal_insurance_grade_raw": "X",
        "renewal_pricing_factor": math.nan,
        "renewal_commercial_ncd": None,
    }
    values = derive_update_values(row)
    assert "renewal_insurance_grade" not in values
    assert "renewal_pricing_factor" not in values
    assert "renewal_commercial_ncd" not in values


def test_format_update_values_shapes_by_type():
    out = format_update_values(
        {"renewal_is_quoted": "是", "renewal_pricing_factor": 1.02, "applicant_name": "李四"},
        SPECS,
    )
    assert out["fGkRjv"] == [{"text": "是"}]
    assert out["fKo7sD"] == 1.02
    assert out["ffFwIh"] == "李四"


def _plan_rows():
    return [
        {"policy_no": "P1", "applicant_name": "张三", "in_renewal_universe": True, "has_renewal_quote": True,
         "renewal_insurance_grade_raw": "A", "renewal_pricing_factor": 1.0, "renewal_commercial_ncd": 0.9},
        {"policy_no": "P2", "applicant_name": "李四", "in_renewal_universe": False},
        {"policy_no": "P3", "applicant_name": "王五", "in_renewal_universe": False},
    ]


def test_build_plan_missing_state_and_multi_record_fanout():
    config = make_config()
    state = {"records": {
        "P1": {"record_ids": ["r1", "r1b"]},   # 同保单号两条记录 → 扇出 2 条更新
        "P2": {"record_ids": ["r2"]},
        # P3 不在 state → missing
    }}
    plan = build_plan(_plan_rows(), state, config)
    keys = [(r["record_id"], r["_key"]) for r in plan["update_records"]]
    assert ("r1", "P1") in keys and ("r1b", "P1") in keys and ("r2", "P2") in keys
    assert plan["missing_in_state"] == ["P3"]


def test_build_plan_skips_unchanged_payload_hash():
    config = make_config()
    rows = _plan_rows()[:1]
    values = format_update_values(derive_update_values(rows[0]), SPECS)
    state = {"records": {"P1": {"record_ids": ["r1"], "payload_hash": payload_hash(values)}}}
    plan = build_plan(rows, state, config)
    assert plan["update_records"] == []
    assert plan["skipped_unchanged"] == 1
    # force 时全量重推
    plan_forced = build_plan(rows, state, config, force=True)
    assert len(plan_forced["update_records"]) == 1


def test_mask_update_sample_masks_sensitive_only():
    records = [{"record_id": "r1", "_key": "P1",
                "values": {"ffFwIh": "张三丰", "fTDa2j": 1.0}}]
    masked = mask_update_sample(records, {"ffFwIh"})
    assert masked[0]["values"]["ffFwIh"] == "张＊＊"
    assert masked[0]["values"]["fTDa2j"] == 1.0
    # 原对象不被修改
    assert records[0]["values"]["ffFwIh"] == "张三丰"


def test_merge_record_map_appends_dedupes_and_keeps_existing_fields():
    from sync_filtered_policies import merge_record_map

    state = {"records": {"P1": {"record_ids": ["r1"], "payload_hash": "h1"}}}
    merge_record_map(state, [("P1", "r1"), ("P1", "r1b"), ("P2", "r2"), ("", "rX"), ("P3", None)])
    assert state["records"]["P1"]["record_ids"] == ["r1", "r1b"]
    assert state["records"]["P1"]["payload_hash"] == "h1"   # 既有字段不被覆盖
    assert state["records"]["P2"]["record_ids"] == ["r2"]
    assert "P3" not in state["records"] and "" not in state["records"]


def test_read_key_text_from_text_cell():
    assert read_key_text([{"type": "text", "text": "618100"}, {"type": "text", "text": "123"}]) == "618100123"
    assert read_key_text("  P9  ") == "P9"
    assert read_key_text([]) is None
    assert read_key_text(None) is None
