"""单测：幂等 webhook→智能表 共享库（lib/idempotent_smartsheet.py）。

核心验收：重复执行 0 新增（幂等）、中途失败不漏不重（崩溃安全）、
返回条数断言、空 state 护栏、确定性稳定键。
"""
from __future__ import annotations

import math
import sys
from datetime import datetime, date
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from lib.idempotent_smartsheet import (  # noqa: E402
    EmptyStateError,
    KeySpec,
    ReturnedCountMismatch,
    collapse_by_key,
    guard_state_not_empty,
    load_state,
    partition_new,
    persist_synced_keys,
    push_add_records_idempotent,
    row_key,
    stable_value,
    validate_state_key_strategy,
)

KS = KeySpec.composite(["policy_no", "vehicle_frame_no"])


def _persist_to(state_path, state):
    """构造 persist_fn：把累计键经共享库 persist 落盘到 state_path（模拟 caller）。"""
    return lambda keys: persist_synced_keys(state_path, state, keys, keyspec=KS)


# ─────────────────── 防线1：稳定键 ───────────────────


def test_stable_value_normalizes():
    assert stable_value(None) == ""
    assert stable_value(float("nan")) == ""
    assert stable_value(1.23) == "1.2300"  # 定点，杜绝浮点漂移
    assert stable_value("  ABC ") == "ABC"  # strip
    assert stable_value(date(2026, 6, 28)) == "2026-06-28"
    assert stable_value(datetime(2026, 6, 28, 1, 2, 3)) == "2026-06-28T01:02:03"


def test_row_key_composite_and_missing():
    assert row_key({"policy_no": "P1", "vehicle_frame_no": "V1"}, KS) == "P1|V1"
    with pytest.raises(KeyError):
        row_key({"policy_no": "P1"}, KS)  # 缺字段绝不静默空键


# ─────────────────── 防线2：源端聚合 ───────────────────


def test_collapse_by_key_dedups_source():
    rows = [
        {"policy_no": "P1", "vehicle_frame_no": "V1", "premium": 100},
        {"policy_no": "P1", "vehicle_frame_no": "V1", "premium": 999},  # 同键
        {"policy_no": "P2", "vehicle_frame_no": "V2", "premium": 50},
    ]
    out = collapse_by_key(rows, KS)
    assert len(out) == 2
    # 默认保留先出现的
    assert next(r for r in out if r["policy_no"] == "P1")["premium"] == 100


# ─────────────────── 防线3：去重过滤 ───────────────────


def test_partition_new_skips_synced():
    state = {"synced_keys": ["P1|V1"], "key_strategy": "composite_key", "composite_fields": ["policy_no", "vehicle_frame_no"]}
    recs = [{"_key": "P1|V1"}, {"_key": "P2|V2"}]
    new, skipped = partition_new(recs, state, key_of=lambda r: r["_key"])
    assert skipped == 1
    assert [r["_key"] for r in new] == ["P2|V2"]


# ─────────────────── 防线6：键口径校验 ───────────────────


def test_validate_state_key_strategy():
    # 一致 → 通过
    validate_state_key_strategy(
        {"synced_keys": ["P1|V1"], "key_strategy": "composite_key", "composite_fields": ["policy_no", "vehicle_frame_no"]}, KS
    )
    # 空 state → 跳过（交给空 state 护栏）
    validate_state_key_strategy({"synced_keys": []}, KS)
    # 旧 primary 口径碰新 composite → 拒绝
    with pytest.raises(RuntimeError):
        validate_state_key_strategy(
            {"synced_keys": ["P1"], "key_strategy": "primary_key", "composite_fields": ["policy_no"]}, KS
        )


# ─────────────────── 空 state 护栏 ───────────────────


def test_guard_state_not_empty():
    with pytest.raises(EmptyStateError):
        guard_state_not_empty({"synced_keys": []}, planned_add=5, allow_empty=False)
    guard_state_not_empty({"synced_keys": []}, planned_add=5, allow_empty=True)  # 显式放行
    guard_state_not_empty({"synced_keys": []}, planned_add=0, allow_empty=False)  # 无新增不触发
    guard_state_not_empty({"synced_keys": ["P1|V1"]}, planned_add=5, allow_empty=False)  # 非空 OK


# ─────────────────── 防线4+5：幂等推送 ───────────────────


def _ok_post(records):
    """模拟成功 webhook：errcode 0 + 返回等量 add_records。"""
    return {"errcode": 0, "add_records": [{"record_id": f"r{i}"} for i in range(len(records))]}


def _records(n):
    return [{"values": {"x": i}, "_key": f"K{i}"} for i in range(n)]


def test_push_happy_path(tmp_path):
    sp = tmp_path / "state.json"
    state = load_state(sp)
    summary = push_add_records_idempotent(
        _records(5), post_fn=_ok_post, persist_fn=_persist_to(sp, state), batch_size=2,
    )
    assert summary["newly_synced_count"] == 5
    # 落盘的快照含全部键
    assert set(load_state(sp)["synced_keys"]) == {f"K{i}" for i in range(5)}


def test_push_is_idempotent_on_rerun(tmp_path):
    sp = tmp_path / "state.json"
    state = load_state(sp)
    push_add_records_idempotent(_records(3), post_fn=_ok_post, persist_fn=_persist_to(sp, state), batch_size=10)
    # 重跑：partition_new 应把全部判为已同步 → 0 新增
    state2 = load_state(sp)
    new, skipped = partition_new(_records(3), state2, key_of=lambda r: r["_key"])
    assert new == [] and skipped == 3


def test_mid_batch_failure_no_dup_no_loss(tmp_path):
    """第 2 批失败：第 1 批键已落盘，重跑只补未成功的，不漏不重。"""
    sp = tmp_path / "state.json"
    state = load_state(sp)
    calls = {"n": 0}

    def flaky_post(records):
        calls["n"] += 1
        if calls["n"] == 2:  # 第 2 批炸
            return {"errcode": 90001, "errmsg": "boom"}
        return _ok_post(records)

    with pytest.raises(RuntimeError):
        push_add_records_idempotent(
            _records(4), post_fn=flaky_post, persist_fn=_persist_to(sp, state), batch_size=2,
        )
    # 第 1 批（K0,K1）已落盘，第 2 批（K2,K3）未记
    persisted = set(load_state(sp)["synced_keys"])
    assert persisted == {"K0", "K1"}
    # 重跑（修复后）：只推 K2,K3，不重推 K0,K1
    state2 = load_state(sp)
    new, skipped = partition_new(_records(4), state2, key_of=lambda r: r["_key"])
    assert {r["_key"] for r in new} == {"K2", "K3"} and skipped == 2
    push_add_records_idempotent(new, post_fn=_ok_post, persist_fn=_persist_to(sp, state2), batch_size=2)
    assert set(load_state(sp)["synced_keys"]) == {"K0", "K1", "K2", "K3"}


def test_returned_count_mismatch_blocks_state(tmp_path):
    """返回条数 < 发送 → ReturnedCountMismatch，该批键不记账。"""
    sp = tmp_path / "state.json"
    state = load_state(sp)

    def short_post(records):
        return {"errcode": 0, "add_records": [{"record_id": "r0"}]}  # 只返回 1 条

    with pytest.raises(ReturnedCountMismatch):
        push_add_records_idempotent(
            _records(3), post_fn=short_post, persist_fn=_persist_to(sp, state), batch_size=3,
        )
    assert not sp.exists()  # 未记账：从未落盘


def test_rate_limit_sleep_invoked(tmp_path):
    sp = tmp_path / "state.json"
    state = load_state(sp)
    slept = []
    push_add_records_idempotent(
        _records(2), post_fn=_ok_post, persist_fn=_persist_to(sp, state),
        batch_size=2, rpm=3000, sleep_fn=lambda s: slept.append(s),
    )
    assert slept and slept[0] == pytest.approx(60.0 / 3000 * 2)
