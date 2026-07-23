"""字段转换（field_transforms）纯函数锁 — 2026-07-23 业务员只保留中文。

锁 4 件事：
  1. chinese_only 转换：剥工号/字母只留中文，保留少数民族姓名分隔点「·」，
     剥空 → None（沿用"空值不写入"语义）。
  2. add 引擎 build_record_values：声明转换的字段写入转换后值；未声明字段不受影响。
  3. update 引擎 format_update_values：同一注册表生效；CLEAR 哨兵不经转换。
  4. 未注册转换器名在配置加载期 fail-fast（SystemExit）。
"""
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from sync_filtered_policies import (  # noqa: E402
    apply_field_transform,
    build_record_values,
    load_instance,
    validate_field_transforms,
)
from sync_ledger_update_fields import (  # noqa: E402
    CLEAR,
    UpdateFieldSpec,
    format_update_values,
)


def test_chinese_only_strips_code_prefix():
    assert apply_field_transform("chinese_only", "118046126任卫军") == "任卫军"


def test_chinese_only_keeps_ethnic_name_separator():
    assert apply_field_transform("chinese_only", "9001买买提·艾力") == "买买提·艾力"


def test_chinese_only_empty_result_is_none():
    assert apply_field_transform("chinese_only", "12345") is None
    assert apply_field_transform("chinese_only", None) is None
    assert apply_field_transform("chinese_only", "  ") is None


def test_add_engine_applies_declared_transform_only():
    mapping = {"salesman_name": "fNy4a6", "plate_no": "ftk5Tx"}
    types = {"fNy4a6": "TEXT", "ftk5Tx": "TEXT"}
    row = {"salesman_name": "118046126任卫军", "plate_no": "晋A12345"}
    values = build_record_values(row, mapping, types, {"salesman_name": "chinese_only"})
    assert values["fNy4a6"] == "任卫军"
    assert values["ftk5Tx"] == "晋A12345"  # 未声明字段原样


def test_add_engine_transform_empty_skips_write():
    mapping = {"salesman_name": "fNy4a6"}
    values = build_record_values(
        {"salesman_name": "12345"}, mapping, {"fNy4a6": "TEXT"}, {"salesman_name": "chinese_only"}
    )
    assert "fNy4a6" not in values


def test_update_engine_applies_transform_and_clear_bypasses():
    specs = (
        UpdateFieldSpec("salesman_name", "fNy4a6", "TEXT", "业务员"),
        UpdateFieldSpec("renewal_insurance_grade", "fp6zIf", "SINGLE_SELECT", "风险等级-续保"),
    )
    transforms = {"salesman_name": "chinese_only"}
    out = format_update_values(
        {"salesman_name": "118046126任卫军", "renewal_insurance_grade": CLEAR}, specs, transforms
    )
    assert out["fNy4a6"] == "任卫军"
    assert out["fp6zIf"] == []  # CLEAR 哨兵不经转换，保持类型空形态


def test_unknown_transform_fails_fast():
    with pytest.raises(SystemExit):
        validate_field_transforms({"x": "no_such_transform"})


def test_renweijun_instance_declares_salesman_chinese_only():
    inst = load_instance(HERE.parent / "instances" / "shanxi-taiyuan2-renweijun.yaml")
    assert inst.field_transforms == {"salesman_name": "chinese_only"}
