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


def test_renewal_row_not_quoted_maps_no_and_clears_attrs():
    # "是→否"回退：报价属性必须显式清空（评审 #1134-4），不得留旧值残影，
    # 也不得把窗口外旧报价（如促成签单的报价）当续保属性写入
    from sync_ledger_update_fields import CLEAR

    row = {"policy_no": "618X", "in_renewal_universe": True, "has_renewal_quote": False,
           "renewal_insurance_grade_raw": "A", "renewal_pricing_factor": 1.0,
           "renewal_commercial_ncd": 0.9}
    values = derive_update_values(row)
    assert values["renewal_is_quoted"] == "否"
    assert values["renewal_insurance_grade"] == CLEAR
    assert values["renewal_pricing_factor"] == CLEAR
    assert values["renewal_commercial_ncd"] == CLEAR


def test_invalid_grade_and_nan_become_clear():
    from sync_ledger_update_fields import CLEAR

    row = {
        "policy_no": "618X",
        "in_renewal_universe": True,
        "has_renewal_quote": True,
        "renewal_insurance_grade_raw": "X",
        "renewal_pricing_factor": math.nan,
        "renewal_commercial_ncd": None,
    }
    values = derive_update_values(row)
    assert values["renewal_insurance_grade"] == CLEAR
    assert values["renewal_pricing_factor"] == CLEAR
    assert values["renewal_commercial_ncd"] == CLEAR


def test_format_update_values_clear_payload_by_type():
    from sync_ledger_update_fields import CLEAR

    out = format_update_values(
        {"renewal_is_quoted": "否", "renewal_insurance_grade": CLEAR,
         "renewal_pricing_factor": CLEAR, "applicant_name": CLEAR},
        SPECS,
    )
    assert out["fGkRjv"] == [{"text": "否"}]
    assert out["fp6zIf"] == []      # SINGLE_SELECT 清空
    assert out["fKo7sD"] is None    # NUMBER 清空（JSON null）
    assert out["ffFwIh"] == ""      # TEXT 清空


def test_row_business_key_composite_matches_add_engine():
    from sync_ledger_update_fields import row_business_key
    from sync_filtered_policies import _row_key, InstanceConfig as AddCfg

    cfg = make_config(composite_key=("policy_no", "vehicle_frame_no"))
    row = {"policy_no": "618P", "vehicle_frame_no": "VIN01"}
    key = row_business_key(row, cfg)
    assert key == "618P|VIN01"
    # 与 add 引擎复合键完全同构（record map 捕获与更新查找必须同键）
    add_cfg = AddCfg(
        instance_name="t", webhook_env="W", batch_size=1, sheet_rpm=1, filters={},
        primary_key="policy_no", composite_key=("policy_no", "vehicle_frame_no"),
        field_mapping={}, field_types={}, field_labels={}, policy_glob="g", script=None,
    )
    assert _row_key({"policy_no": "618P", "vehicle_frame_no": "VIN01"}, add_cfg) == key


def test_add_engine_rejects_multi_target_explicit_record_map(tmp_path):
    import pytest
    from sync_filtered_policies import load_instances

    p = tmp_path / "multi.yaml"
    p.write_text("""
instance_name: x
webhook_env: W
field_mapping: { policy_no: fA }
targets:
  - name: a
  - name: b
update_sync:
  sheet_id: s
  key_field_id: fA
  renewal_tracker_glob: rt
  quotes_glob: q
  state: state/shared.json
  fields:
    applicant_name: {field_id: fB, type: TEXT}
""", encoding="utf-8")
    with pytest.raises(SystemExit):
        load_instances(p)


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


def test_user_field_format_and_roster_enrichment():
    from sync_filtered_policies import format_value as add_format_value, enrich_rows_with_roster

    # USER 型：有 user_id 才写，空值不写入
    assert add_format_value("USER", "RenWeiJun") == [{"user_id": "RenWeiJun"}]
    assert add_format_value("USER", "") is None
    assert add_format_value("USER", None) is None

    rows = [
        {"salesman_name": "118046126任卫军"},
        {"salesman_name": "999000000無名氏"},   # 花名册未登记 → 不设键（成员列留空）
        {"salesman_name": ""},
    ]
    stats = enrich_rows_with_roster(rows, {"118046126": "RenWeiJun"})
    assert stats == {"matched": 1, "missing": 2}
    assert rows[0]["salesman_user_id"] == "RenWeiJun"
    assert "salesman_user_id" not in rows[1] and "salesman_user_id" not in rows[2]


def test_derive_update_values_passes_salesman_uid():
    row = {"policy_no": "618X", "salesman_user_id": "RenWeiJun", "in_renewal_universe": False}
    assert derive_update_values(row)["salesman_user_id"] == "RenWeiJun"


def test_load_update_configs_targets_expansion(tmp_path):
    from sync_ledger_update_fields import load_update_configs, HERE

    yaml_text = """
instance_name: org-ledger
webhook_env: W_BASE
policy_glob: g
filters: { policy_date_from: "2025-08-01" }
targets:
  - name: t1
    webhook_env: W_T1
    filters: { extra_where: "branch_code='SX' AND org_level_3='太原二部'" }
  - name: t2
update_sync:
  sheet_id: s
  key_field_id: fKEY
  renewal_tracker_glob: rt
  quotes_glob: q
  fields:
    applicant_name: {field_id: fA, type: TEXT, label: 投保人, sensitive: true}
"""
    p = tmp_path / "inst.yaml"
    p.write_text(yaml_text, encoding="utf-8")
    configs = load_update_configs(p)
    assert [c.instance_name for c in configs] == ["org-ledger-t1", "org-ledger-t2"]
    assert configs[0].webhook_env == "W_T1" and configs[1].webhook_env == "W_BASE"
    # target filters 合并基础 filters
    assert configs[0].filters["policy_date_from"] == "2025-08-01"
    assert "太原二部" in configs[0].filters["extra_where"]
    # state 按目标名派生，互不覆盖
    assert configs[0].state_path == HERE / "state/org-ledger-t1_record_map.json"
    assert configs[1].state_path == HERE / "state/org-ledger-t2_record_map.json"


def test_read_key_text_from_text_cell():
    assert read_key_text([{"type": "text", "text": "618100"}, {"type": "text", "text": "123"}]) == "618100123"
    assert read_key_text("  P9  ") == "P9"
    assert read_key_text([]) is None
    assert read_key_text(None) is None
