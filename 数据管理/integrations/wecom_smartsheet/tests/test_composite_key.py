"""单测：sync_filtered_policies 的复合主键去重逻辑。

场景：同 policy_no 的批改副本/保费拆分需用 composite_key 区分，
避免 sync 模式误判为"已同步"漏掉新行。
"""
from __future__ import annotations

import sys
from datetime import datetime, date
from pathlib import Path

import pytest

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


def test_row_key_raises_when_composite_field_missing() -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no"))
    with pytest.raises(KeyError, match="plate_no"):
        sfp._row_key({"policy_no": "P12345"}, inst)


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


def test_to_ts_ms_encodes_business_date_at_utc_noon() -> None:
    """DATE_TIME 写入固定为 UTC 中午，避免查看端时区把业务日期显示成前一天。"""
    assert sfp._to_ts_ms(date(2026, 5, 19)) == "1779192000000"
    assert sfp._to_ts_ms(datetime(2026, 5, 19, 0, 0, 0)) == "1779192000000"


def test_to_select_omits_nan() -> None:
    assert sfp._to_select(float("nan")) is None


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


def test_load_instances_expands_targets_with_shared_mapping(tmp_path: Path) -> None:
    """同一业务配置可展开成多个目标表，目标级 filters 只追加不复制字段映射。"""
    yaml_path = tmp_path / "postal.yaml"
    yaml_path.write_text(
        """
instance_name: postal
script: sync_filtered_policies.py
filters:
  agent_name_like: "%邮政%"
  policy_date_from: "2026-04-20"
targets:
  - name: risk
    instance_name: postal-risk
    webhook_env: WEBHOOK_RISK
    filters:
      extra_where: "insurance_grade IS NOT NULL"
  - name: all
    instance_name: postal-all
    webhook_env: WEBHOOK_ALL
primary_key: policy_no
field_mapping:
  policy_no: fAAA
field_types:
  fAAA: TEXT
field_labels:
  fAAA: 保单号
""".strip(),
        encoding="utf-8",
    )

    risk, all_rows = sfp.load_instances(yaml_path)

    assert risk.instance_name == "postal-risk"
    assert risk.webhook_env == "WEBHOOK_RISK"
    assert risk.filters == {
        "agent_name_like": "%邮政%",
        "policy_date_from": "2026-04-20",
        "extra_where": "insurance_grade IS NOT NULL",
    }
    assert all_rows.instance_name == "postal-all"
    assert all_rows.webhook_env == "WEBHOOK_ALL"
    assert all_rows.filters == {
        "agent_name_like": "%邮政%",
        "policy_date_from": "2026-04-20",
    }
    assert risk.field_mapping is not all_rows.field_mapping
    assert risk.field_mapping == all_rows.field_mapping == {"policy_no": "fAAA"}


def test_validate_state_rejects_old_primary_state_for_composite_key() -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    old_state = {"synced_keys": ["P123"]}
    with pytest.raises(RuntimeError, match="缺少 key_strategy"):
        sfp.validate_state_key_strategy(inst, old_state)


def test_validate_state_rejects_strategy_mismatch() -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no"))
    wrong_state = {
        "synced_keys": ["P123"],
        "key_strategy": "primary_key",
        "composite_fields": ["policy_no"],
    }
    with pytest.raises(RuntimeError, match="不一致"):
        sfp.validate_state_key_strategy(inst, wrong_state)


def test_validate_state_accepts_transitional_composite_state_without_fields() -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    transitional_state = {
        "synced_keys": ["P123|川A12345|100.0000|2026-05-14"],
        "key_strategy": "composite_key",
    }
    sfp.validate_state_key_strategy(inst, transitional_state)


def test_run_sync_fails_closed_on_old_primary_state(monkeypatch: pytest.MonkeyPatch) -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    monkeypatch.setattr(sfp, "fetch_rows", lambda _inst: [
        {"_primary_key": "P123", "policy_no": "P123", "plate_no": "川A12345", "premium": 100.0, "policy_date": date(2026, 5, 14)}
    ])
    monkeypatch.setattr(sfp, "load_state", lambda _inst: {"synced_keys": ["P123"]})

    def fail_post(*_args, **_kwargs):
        raise AssertionError("post_webhook should not be called")

    monkeypatch.setattr(sfp, "post_webhook", fail_post)
    with pytest.raises(RuntimeError, match="缺少 key_strategy"):
        sfp.run(inst, mode="sync", dry_run=False)


def test_rebuild_state_dry_run_does_not_write(monkeypatch: pytest.MonkeyPatch) -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    monkeypatch.setattr(sfp, "fetch_rows", lambda _inst: [
        {"_primary_key": "P123", "policy_no": "P123", "plate_no": "川A12345", "premium": 100.0, "policy_date": date(2026, 5, 14)}
    ])
    monkeypatch.setattr(sfp, "load_state", lambda _inst: {"synced_keys": ["P123"]})

    def fail_save(*_args, **_kwargs):
        raise AssertionError("dry-run rebuild should not write state")

    monkeypatch.setattr(sfp, "save_state", fail_save)
    summary = sfp.rebuild_state(inst, dry_run=True)
    assert summary["rebuild_mode"] == "migrate_primary_to_composite"
    assert summary["unique_keys_after"] == 1


def test_rebuild_state_rejects_ambiguous_primary_migration(monkeypatch: pytest.MonkeyPatch) -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    monkeypatch.setattr(sfp, "fetch_rows", lambda _inst: [
        {"_primary_key": "P123", "policy_no": "P123", "plate_no": "川A12345", "premium": 100.0, "policy_date": date(2026, 5, 14)},
        {"_primary_key": "P123", "policy_no": "P123", "plate_no": "川A54321", "premium": 0.0, "policy_date": date(2026, 5, 14)},
    ])
    monkeypatch.setattr(sfp, "load_state", lambda _inst: {"synced_keys": ["P123"]})
    with pytest.raises(RuntimeError, match="一对多"):
        sfp.rebuild_state(inst, dry_run=True)


def test_run_success_writes_composite_strategy(monkeypatch: pytest.MonkeyPatch) -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    row = {"_primary_key": "P123", "policy_no": "P123", "plate_no": "川A12345", "premium": 100.0, "policy_date": date(2026, 5, 14)}
    saved: dict[str, object] = {}
    monkeypatch.setattr(sfp, "fetch_rows", lambda _inst: [row])
    monkeypatch.setattr(sfp, "load_state", lambda _inst: {
        "synced_keys": [],
        "key_strategy": "composite_key",
        "composite_fields": ["policy_no", "plate_no", "premium", "policy_date"],
    })
    monkeypatch.setattr(sfp, "post_webhook", lambda *_args, **_kwargs: {"errcode": 0, "add_records": [{"record_id": "rec1"}]})
    monkeypatch.setattr(sfp, "write_log", lambda *_args, **_kwargs: Path("/tmp/test-log.json"))
    monkeypatch.setattr(sfp, "save_state", lambda _inst, state, **_kwargs: saved.update(state))
    monkeypatch.setenv("TEST_WEBHOOK", "https://example.invalid/webhook")

    summary = sfp.run(inst, mode="sync", dry_run=False)

    assert summary["newly_synced_count"] == 1
    assert saved["key_strategy"] == "composite_key"
    assert saved["composite_fields"] == ["policy_no", "plate_no", "premium", "policy_date"]
    assert saved["synced_keys"] == ["P123|川A12345|100.0000|2026-05-14"]


def test_run_rejects_success_response_without_add_records(monkeypatch: pytest.MonkeyPatch) -> None:
    inst = _make_instance(composite_key=("policy_no", "plate_no", "premium", "policy_date"))
    row = {"_primary_key": "P123", "policy_no": "P123", "plate_no": "川A12345", "premium": 100.0, "policy_date": date(2026, 5, 14)}
    monkeypatch.setattr(sfp, "fetch_rows", lambda _inst: [row])
    monkeypatch.setattr(sfp, "load_state", lambda _inst: {
        "synced_keys": [],
        "key_strategy": "composite_key",
        "composite_fields": ["policy_no", "plate_no", "premium", "policy_date"],
    })
    monkeypatch.setattr(sfp, "post_webhook", lambda *_args, **_kwargs: {"errcode": 0})
    monkeypatch.setattr(sfp, "write_log", lambda *_args, **_kwargs: Path("/tmp/test-log.json"))
    monkeypatch.setenv("TEST_WEBHOOK", "https://example.invalid/webhook")

    with pytest.raises(RuntimeError, match="新增返回数量不一致"):
        sfp.run(inst, mode="sync", dry_run=False)
