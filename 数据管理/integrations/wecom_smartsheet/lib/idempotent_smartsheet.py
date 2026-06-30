"""幂等 webhook → 企业微信智能表格 推送共享库（6 道防线）。

任何「读数据源 → 经 webhook `add_records` 写入智能表」的脚本都应复用本库，确保
**重复执行 / 中途崩溃都不产生重复行**（参 2026-06-03 org_renewal 空 state 全量
重写 28,899 行重复事故；memory `feedback_wecom_no_row_duplication`）。

本库与具体表 / InstanceConfig 解耦：调用方只需提供
  (state 文件路径, 唯一键描述 KeySpec, webhook 推送回调 post_fn)。

参考采用：`sync_filtered_policies.py`（邮政表，纯增 add-only）。

────────────────────────── 6 道防线 ──────────────────────────
1. 确定性稳定键        stable_value / row_key —— 值先稳定化（None/NaN→""、float→定点、
                       日期→isoformat、str→strip），杜绝格式漂移让同一行算出不同键。
2. 源端先聚合去重      collapse_by_key —— 推送前折叠源内重复，送进 webhook 的批次内部无重复键。
3. 本地"已同步键"快照  load_state / 去重 partition_new —— 持久 synced_keys 集合，
                       new = 键不在集合里的行。
4. 成功才记账·按批落盘  push_add_records_idempotent —— 每批 errcode==0 成功后立刻把该批键
                       并入 synced_keys 写盘；任何批失败即 raise，已成功批的键已落盘，
                       重跑只补未成功的。绝不"先记账后推送"或"全推完才一次性写盘"。
5. 返回条数断言        push_add_records_idempotent —— errcode==0 后断言返回条数==发送条数，
                       不一致则 raise、拒绝记账（并非真正全部写入）。
6. 键口径一致性校验    validate_state_key_strategy —— sync 前校验 state 的
                       key_strategy/composite_fields 与当前键描述一致，防键格式迁移全量重推。
+ 空 state 护栏        guard_state_not_empty —— sync 模式空 state 直接推默认拒绝
                       （疑似 state 丢失，盲推 = 全表当新增 = 大面积重复）。
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone, date as _date
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

__all__ = [
    "KeySpec",
    "stable_value",
    "row_key",
    "collapse_by_key",
    "load_state",
    "save_state",
    "persist_synced_keys",
    "validate_state_key_strategy",
    "partition_new",
    "EmptyStateError",
    "guard_state_not_empty",
    "ReturnedCountMismatch",
    "push_add_records_idempotent",
]


# ───────────────────────── 唯一键描述 ─────────────────────────


@dataclass(frozen=True)
class KeySpec:
    """唯一键描述：有序字段 + 口径标签（与 state 文件的 key_strategy/composite_fields 对齐）。

    - `KeySpec.composite([a, b])` → 复合键，state.key_strategy == "composite_key"
    - `KeySpec.primary("policy_no")` → 单主键，state.key_strategy == "primary_key"
    """

    fields: tuple[str, ...]
    strategy: str  # "composite_key" | "primary_key"

    @classmethod
    def composite(cls, fields: Sequence[str]) -> "KeySpec":
        fields = tuple(fields)
        if not fields:
            raise ValueError("KeySpec.composite 需至少一个字段")
        return cls(fields, "composite_key")

    @classmethod
    def primary(cls, field: str) -> "KeySpec":
        return cls((field,), "primary_key")

    @property
    def composite_fields(self) -> list[str]:
        return list(self.fields)


# ───────────────────── 防线1：确定性稳定键 ─────────────────────


def stable_value(v: Any) -> str:
    """把任意值稳定化为字符串，用于唯一键拼接。

    杜绝浮点精度漂移 / NaN / 日期格式 / 前后空格让同一行算出不同键 → 漏判 → 重复。
    """
    if v is None:
        return ""
    if isinstance(v, float):
        if v != v:  # NaN
            return ""
        return f"{v:.4f}"
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, _date):
        return v.isoformat()
    return str(v).strip()


def row_key(row: Mapping[str, Any], keyspec: KeySpec) -> str:
    """按 keyspec.fields 顺序用 `|` 拼接稳定化值。缺字段即抛错（绝不静默用空键）。"""
    missing = [f for f in keyspec.fields if f not in row]
    if missing:
        raise KeyError(f"row 缺少唯一键字段 {missing}（keyspec={keyspec.fields}）")
    return "|".join(stable_value(row[f]) for f in keyspec.fields)


# ─────────────────── 防线2：源端先聚合去重 ───────────────────


def collapse_by_key(
    rows: Iterable[Mapping[str, Any]],
    keyspec: KeySpec,
    *,
    prefer: Callable[[Mapping[str, Any], Mapping[str, Any]], Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """折叠源内同键重复，保证送进 webhook 的批次内部无重复键。

    prefer(existing, candidate) 返回保留哪条（默认保留先出现的）。
    """
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        k = row_key(row, keyspec)
        if k not in seen:
            seen[k] = dict(row)
        elif prefer is not None:
            seen[k] = dict(prefer(seen[k], row))
    return list(seen.values())


# ─────────────────── 防线3：本地已同步键快照 ───────────────────


def load_state(state_path: Path) -> dict[str, Any]:
    """读 state 文件；不存在返回空快照。"""
    p = Path(state_path)
    if not p.exists():
        return {"synced_keys": [], "last_sync_at": None, "key_strategy": None, "composite_fields": None}
    return json.loads(p.read_text(encoding="utf-8"))


def save_state(state_path: Path, state: dict[str, Any], *, backup_existing: bool = False) -> None:
    p = Path(state_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if backup_existing and p.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.copy2(p, p.with_name(f"{p.name}.bak.{ts}"))
    p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def persist_synced_keys(
    state_path: Path,
    state: dict[str, Any],
    new_keys: Iterable[str],
    *,
    keyspec: KeySpec,
) -> None:
    """把成功推送的键并入快照并立即写盘（防线4 的落盘动作）。

    幂等：synced_keys 取并集去重；同时回写 key_strategy/composite_fields 供防线6 校验。
    """
    state["synced_keys"] = sorted(set(state.get("synced_keys") or []) | set(new_keys))
    state["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    state["key_strategy"] = keyspec.strategy
    state["composite_fields"] = keyspec.composite_fields
    save_state(state_path, state)


# ─────────────────── 防线6：键口径一致性校验 ───────────────────


def _state_fields_compatible(state: Mapping[str, Any], keyspec: KeySpec) -> bool:
    actual_strategy = state.get("key_strategy")
    actual_fields = state.get("composite_fields")
    if actual_strategy != keyspec.strategy:
        return False
    # 过渡兼容：早期 composite state 只写了 key_strategy，未写 composite_fields。
    if actual_fields is None and keyspec.strategy == "composite_key":
        keys = [str(k) for k in (state.get("synced_keys") or []) if k]
        return bool(keys) and all("|" in k for k in keys)
    return actual_fields == keyspec.composite_fields


def validate_state_key_strategy(state: Mapping[str, Any], keyspec: KeySpec) -> None:
    """sync 前校验 state 口径，防旧键格式被新键描述全量错配 → 重复写入或漏同步。"""
    keys = state.get("synced_keys") or []
    if not keys:
        return  # 空 state 由 guard_state_not_empty 单独把关
    if state.get("key_strategy") is None:
        raise RuntimeError(
            "state 缺少 key_strategy，疑似旧口径；请先核对（rebuild-state）再迁移，禁止直接 sync"
        )
    if not _state_fields_compatible(state, keyspec):
        raise RuntimeError(
            "state key_strategy/composite_fields 与当前键描述不一致："
            f"state=({state.get('key_strategy')}, {state.get('composite_fields')}) "
            f"current=({keyspec.strategy}, {keyspec.composite_fields})；拒绝 sync，避免重复或漏同步"
        )


def partition_new(
    records: Sequence[Mapping[str, Any]],
    state: Mapping[str, Any],
    *,
    key_of: Callable[[Mapping[str, Any]], str],
) -> tuple[list[dict[str, Any]], int]:
    """按已同步键集合切分：返回 (待新增行, 已跳过条数)。"""
    synced = set(state.get("synced_keys") or [])
    new = [dict(r) for r in records if key_of(r) not in synced]
    return new, len(records) - len(new)


# ─────────────────────── 空 state 护栏 ───────────────────────


class EmptyStateError(RuntimeError):
    """sync 模式遇空 state 又要真实推送 → 默认拒绝（疑似 state 丢失，盲推会大面积重复）。"""


def guard_state_not_empty(state: Mapping[str, Any], *, planned_add: int, allow_empty: bool) -> None:
    """空 state + 计划新增 > 0 + 未显式放行 → 抛 EmptyStateError。

    放行条件：调用方人工核验线上表为空 / 确为首次全量后，显式传 allow_empty=True
    （对应 CLI 的 --allow-empty / init 模式）。
    """
    if allow_empty:
        return
    synced = state.get("synced_keys") or []
    if not synced and planned_add > 0:
        raise EmptyStateError(
            f"state 为空但计划新增 {planned_add} 条：疑似 state 丢失/未恢复。"
            "盲目推送会把全表当新增 → 大面积重复。请先核验线上表并恢复 state，"
            "确为首次全量再显式放行（allow_empty=True / --allow-empty / init 模式）。"
        )


# ──────────────── 防线4+5：幂等批量推送 ────────────────


class ReturnedCountMismatch(RuntimeError):
    """webhook 返回的新增条数 != 发送条数 → 拒绝记账（并非真正全部写入）。"""


def _chunked(seq: Sequence[Any], size: int) -> Iterable[list[Any]]:
    size = max(1, int(size))
    for i in range(0, len(seq), size):
        yield list(seq[i : i + size])


def push_add_records_idempotent(
    new_records: Sequence[Mapping[str, Any]],
    *,
    post_fn: Callable[[list[dict[str, Any]]], Mapping[str, Any]],
    persist_fn: Callable[[list[str]], None],
    batch_size: int,
    key_field: str = "_key",
    values_field: str = "values",
    rpm: int | None = None,
    sleep_fn: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    """分批推送 new_records 并保证幂等（防线 4 成功才记账·按批落盘 + 防线 5 返回条数断言）。

    new_records: 每条形如 {"values": {...}, "_key": "<唯一键>"}（字段名可经 key_field/values_field 覆盖）。
    post_fn(records) -> resp：records 为 [{"values": {...}}, ...]；resp 须含 errcode、可含 add_records、errmsg。
    persist_fn(cumulative_keys): **每批成功后**被调用一次，参数为累计已同步键列表；由调用方负责落盘
        （把 state 写入 seam 交给调用方，便于复用各自的 save_state / 测试注入）。
        典型实现：`lambda keys: persist_synced_keys(path, state, keys, keyspec=ks)`。
    rpm: 智能表每分钟记录数限速；None 不限速。sleep_fn 便于测试注入。

    返回 {batches, newly_synced_count, newly_synced_keys}。
    任一批失败立即 raise（已成功批已经 persist_fn 落盘，重跑只补未成功的）。
    """
    import time as _time

    sleep_fn = sleep_fn or _time.sleep
    batches: list[dict[str, Any]] = []
    newly_synced: list[str] = []

    for chunk in _chunked(list(new_records), batch_size):
        payload = [{"values": r[values_field]} for r in chunk]
        resp = post_fn(payload)
        errcode = resp.get("errcode")
        returned = resp.get("add_records")
        batches.append(
            {
                "op": "add",
                "sent": len(chunk),
                "errcode": errcode,
                "errmsg": (resp.get("errmsg") or "")[:200],
                "returned": len(returned) if isinstance(returned, list) else None,
            }
        )
        if errcode != 0:
            raise RuntimeError(f"webhook add 失败：errcode={errcode}, errmsg={resp.get('errmsg')}")
        # 防线5：返回条数必须等于发送条数，否则并非真正全部写入，拒绝记账
        if not isinstance(returned, list) or len(returned) != len(chunk):
            raise ReturnedCountMismatch(
                "企业微信新增返回数量不一致（与发送条数），拒绝更新 state："
                f"sent={len(chunk)} returned={len(returned) if isinstance(returned, list) else 'missing'}"
            )
        # 防线4：成功才记账·按批落盘（崩溃安全的幂等核心），落盘交给 persist_fn
        newly_synced.extend(r[key_field] for r in chunk if r.get(key_field))
        persist_fn(list(newly_synced))
        # 限速：每条记录占 60/rpm 秒
        if rpm:
            sleep_fn(60.0 / max(1, rpm) * len(chunk))

    return {
        "batches": batches,
        "newly_synced_count": len(newly_synced),
        "newly_synced_keys": list(newly_synced),
    }
