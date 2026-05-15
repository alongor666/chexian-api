"""单测：sync_filtered_policies 的复合主键去重逻辑。

场景：同 policy_no 的批改副本/保费拆分需用 composite_key 区分，
避免 sync 模式误判为"已同步"漏掉新行。
"""
from __future__ import annotations

import sys
from datetime import datetime, date
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import sync_filtered_policies as sfp  # noqa: E402


def _make_instance(
    *,
    primary_key: str = "policy_no",
    composite_key: tuple[str, ...] | None = None,
) -> sfp.InstanceConfig:
    return sfp.InstanceConfig(
        instance_name="test",
        webhook_env="TEST_WEBHOOK",
        batch_size=100,
        sheet_rpm=3000,
        filters={},
        primary_key=primary_key,
        composite_key=composite_key,
        field_mapping={},
        field_types={},
        field_labels={},
        policy_glob="",
        script=None,
    )


def test_row_key_falls_back_to_primary_key_when_composite_none() -> None:
    inst = _make_instance(composite_key=None)
    row = {"_primary_key": "P12345", "policy_no": "P12345", "premium": 100.0}
    assert sfp._row_key(row, inst) == "P12345"


def test_row_key_uses_composite_when_configured() -> None:
    inst = _make_instance(composite_key=("policy_no", "premium"))
    row = {"_primary_key": "P12345", "policy_no": "P12345", "premium": 627.36}
    assert sfp._row_key(row, inst) == "P12345|627.3600"


def test_composite_key_distinguishes_amendment_with_zero_premium() -> None:
    """同 policy_no 的原单 + 零保费批改副本应产生不同 key。"""
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    original = {
        "_primary_key": "P123",
        "policy_no": "P123",
        "plate_no": "川AB1351",
        "premium": 627.36,
        "policy_date": date(2026, 5, 14),
    }
    amendment = {
        "_primary_key": "P123",
        "policy_no": "P123",
        "plate_no": "川AK267B",
        "premium": 0.0,
        "policy_date": date(2026, 5, 14),
    }
    k1 = sfp._row_key(original, inst)
    k2 = sfp._row_key(amendment, inst)
    assert k1 != k2
    assert k1 == "P123|川AB1351|627.3600|2026-05-14"
    assert k2 == "P123|川AK267B|0.0000|2026-05-14"


def test_composite_key_distinguishes_premium_split_same_date() -> None:
    """同 policy_no、同车牌、同日的保费拆分（主险/附加险）也应区分。"""
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    main = {"policy_no": "P", "plate_no": "川R0N906", "premium": 3768.08, "policy_date": date(2026, 5, 7)}
    addon = {"policy_no": "P", "plate_no": "川R0N906", "premium": 788.48, "policy_date": date(2026, 5, 7)}
    assert sfp._row_key(main, inst) != sfp._row_key(addon, inst)


def test_stable_value_handles_none_nan_and_datetime() -> None:
    assert sfp._stable_value(None) == ""
    assert sfp._stable_value(float("nan")) == ""
    assert sfp._stable_value(627.36) == "627.3600"
    assert sfp._stable_value(datetime(2026, 5, 14, 10, 30, 0)) == "2026-05-14T10:30:00"
    assert sfp._stable_value(date(2026, 5, 14)) == "2026-05-14"
    assert sfp._stable_value("  川A12345  ") == "川A12345"


def test_load_instance_parses_composite_key_as_tuple(tmp_path: Path) -> None:
    """YAML 中 composite_key 是 list，加载后应为 tuple（frozen dataclass 友好）。"""
    yaml_path = tmp_path / "test.yaml"
    yaml_path.write_text(
        """
instance_name: test
webhook_env: TEST_WEBHOOK
filters:
  agent_name_like: "%test%"
primary_key: policy_no
composite_key:
  - policy_no
  - premium
  - plate_no
field_mapping:
  policy_no: fAAA
""".strip(),
        encoding="utf-8",
    )
    inst = sfp.load_instance(yaml_path)
    assert inst.composite_key == ("policy_no", "premium", "plate_no")
    assert isinstance(inst.composite_key, tuple)


def test_load_instance_composite_key_absent_means_none(tmp_path: Path) -> None:
    """未声明 composite_key 时应为 None（向后兼容）。"""
    yaml_path = tmp_path / "test.yaml"
    yaml_path.write_text(
        """
instance_name: test
webhook_env: TEST_WEBHOOK
filters:
  agent_name_like: "%test%"
primary_key: policy_no
field_mapping:
  policy_no: fAAA
""".strip(),
        encoding="utf-8",
    )
    inst = sfp.load_instance(yaml_path)
    assert inst.composite_key is None
