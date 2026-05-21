"""通用筛选保单 → 企业微信智能表同步引擎

与 sync_renewal_v2.py 的关系：
- sync_renewal_v2 深度耦合续保口径（quote_window / 重复投保审计 / 跨批排他）
- 本脚本面向通用筛选场景：agent_name LIKE / policy_date >= / org_level_3 IN ...
- 复用 sync_renewal_v2 的 webhook POST + 分批工具（post_webhook / chunked）

YAML 配置示例见 instances/postal-policy-since-20260420.yaml。

用法：
    python3 sync_filtered_policies.py --instance instances/<name>.yaml [--mode init|sync] [--dry-run] [--batch-size 100]

mode 语义：
    init  首次全量导入；按 SQL 抽数顺序 add_records，不查既有记录
          （注意：重复触发会重复写入；仅用于首次或清表后重建）
    sync  增量 add-only：按 primary_key 维护 state.json，仅 add 不在已同步集合内的行
          （v0 不实现 update；既有记录字段变化不会回写智能表，等业务确认是否需要）

    默认 mode 不再是 init —— daily.mjs 周期调用必须显式传 --mode sync，
    init 仅供手工首次全量。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone, date as date_cls
from pathlib import Path
from typing import Any

import duckdb
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sync_renewal_v2 import post_webhook, chunked  # noqa: E402

DEFAULT_POLICY_GLOB = str(
    HERE.parent.parent / "warehouse" / "fact" / "policy" / "current" / "*.parquet"
)


# ---------- Config ----------


@dataclass(frozen=True)
class InstanceConfig:
    instance_name: str
    webhook_env: str
    batch_size: int
    sheet_rpm: int
    filters: dict[str, Any]
    primary_key: str
    composite_key: tuple[str, ...] | None  # 复合主键：声明时按 `|` 拼接去重；None 回退 primary_key
    field_mapping: dict[str, str]
    field_types: dict[str, str]
    field_labels: dict[str, str]
    policy_glob: str
    script: str | None  # 仅供 daily.mjs 路由用


def _build_instance(raw: dict[str, Any], target: dict[str, Any] | None = None) -> InstanceConfig:
    target = target or {}
    filters = dict(raw.get("filters", {}))
    filters.update(target.get("filters", {}))
    composite_raw = raw.get("composite_key")
    composite = tuple(composite_raw) if composite_raw else None
    return InstanceConfig(
        instance_name=target.get("instance_name") or (
            f"{raw['instance_name']}-{target['name']}" if target.get("name") else raw["instance_name"]
        ),
        webhook_env=target.get("webhook_env") or raw["webhook_env"],
        batch_size=int(raw.get("batch_size", 100)),
        sheet_rpm=int(raw.get("sheet_records_per_minute_limit", 3000)),
        filters=filters,
        primary_key=raw.get("primary_key", "policy_no"),
        composite_key=composite,
        field_mapping=dict(raw["field_mapping"]),
        field_types=dict(raw.get("field_types", {})),
        field_labels=dict(raw.get("field_labels", {})),
        policy_glob=raw.get("policy_glob", DEFAULT_POLICY_GLOB),
        script=raw.get("script"),
    )


def load_instances(path: Path) -> list[InstanceConfig]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    targets = raw.get("targets") or []
    if not targets:
        return [_build_instance(raw)]
    return [_build_instance(raw, target) for target in targets]


def load_instance(path: Path) -> InstanceConfig:
    return load_instances(path)[0]


# ---------- SQL ----------


def build_where(filters: dict[str, Any]) -> tuple[str, list[Any]]:
    """根据 filters 字段拼 WHERE 子句。当前支持：

    agent_name_like        : VARCHAR LIKE pattern
    policy_date_from       : DATE >=
    policy_date_to         : DATE <=
    org_level_3_in         : LIST 包含
    extra_where            : 任意 SQL 片段（无参数化，仅供受信任 YAML 使用）
    """
    clauses: list[str] = []
    params: list[Any] = []

    if filters.get("agent_name_like"):
        clauses.append("agent_name LIKE ?")
        params.append(filters["agent_name_like"])
    if filters.get("policy_date_from"):
        clauses.append("CAST(policy_date AS DATE) >= CAST(? AS DATE)")
        params.append(filters["policy_date_from"])
    if filters.get("policy_date_to"):
        clauses.append("CAST(policy_date AS DATE) <= CAST(? AS DATE)")
        params.append(filters["policy_date_to"])
    if filters.get("org_level_3_in"):
        orgs = list(filters["org_level_3_in"])
        placeholders = ",".join(["?"] * len(orgs))
        clauses.append(f"org_level_3 IN ({placeholders})")
        params.extend(orgs)
    if filters.get("extra_where"):
        clauses.append(f"({filters['extra_where']})")

    where = " AND ".join(clauses) if clauses else "1=1"
    return where, params


def fetch_rows(instance: InstanceConfig) -> list[dict[str, Any]]:
    where, params = build_where(instance.filters)
    pk = instance.primary_key

    # 抽数 SQL：SELECT 所有注册表字段 + 派生 vehicle_age_group / vehicle_price_segment
    sql = f"""
    SELECT
      org_level_3,
      salesman_name,
      policy_date,
      plate_no,
      insurance_grade,
      premium,
      commercial_pricing_factor,
      insurance_start_date,
      vehicle_model,
      driver_age_group,
      new_vehicle_price,
      first_registration_date,
      agent_name,
      policy_no,
      {pk} AS _primary_key,
      /* 车价分段：运行时派生 */
      CASE
        WHEN new_vehicle_price IS NULL THEN '未知'
        WHEN new_vehicle_price < 50000  THEN '5万以下'
        WHEN new_vehicle_price < 100000 THEN '5-10万'
        WHEN new_vehicle_price < 200000 THEN '10-20万'
        WHEN new_vehicle_price < 300000 THEN '20-30万'
        ELSE '30万以上'
      END AS vehicle_price_segment,
      /* 车龄分段：运行时派生（fields.json 已注册为 derived 字段，但未落 ETL Parquet） */
      CASE
        WHEN first_registration_date IS NULL OR policy_date IS NULL THEN '未知'
        WHEN DATE_DIFF('year', CAST(first_registration_date AS DATE), CAST(policy_date AS DATE)) <= 1 THEN '0-1年'
        WHEN DATE_DIFF('year', CAST(first_registration_date AS DATE), CAST(policy_date AS DATE)) <= 3 THEN '1-3年'
        WHEN DATE_DIFF('year', CAST(first_registration_date AS DATE), CAST(policy_date AS DATE)) <= 5 THEN '3-5年'
        WHEN DATE_DIFF('year', CAST(first_registration_date AS DATE), CAST(policy_date AS DATE)) <= 8 THEN '5-8年'
        ELSE '8年以上'
      END AS vehicle_age_group
    FROM read_parquet('{instance.policy_glob}', union_by_name=true)
    WHERE {where}
    ORDER BY policy_date DESC, policy_no
    """
    con = duckdb.connect(":memory:")
    df = con.execute(sql, params).fetchdf()
    return df.to_dict("records")


# ---------- Value formatters ----------


def _to_ts_ms(value: Any) -> str | None:
    """DATE_TIME 字段统一转毫秒 timestamp 字符串。

    企微日期字段会按查看端时区展示。业务日期没有日内时间含义，
    因此固定写成 UTC 中午，避免 UTC 零点在美西等时区显示成前一天。
    """
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, datetime):
        dt = datetime.combine(value.date(), datetime.min.time(), tzinfo=timezone.utc).replace(hour=12)
        return str(int(dt.timestamp() * 1000))
    if isinstance(value, date_cls):
        dt = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc).replace(hour=12)
        return str(int(dt.timestamp() * 1000))
    # duckdb 返回 pandas.Timestamp / numpy.datetime64
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00").split(".")[0].replace("T", " "))
        dt = datetime.combine(ts.date(), datetime.min.time(), tzinfo=timezone.utc).replace(hour=12)
        return str(int(dt.timestamp() * 1000))
    except (ValueError, TypeError):
        return None


def _to_select(value: Any) -> list[dict[str, str]] | None:
    if value is None:
        return None
    try:
        if value != value:  # NaN check
            return None
    except TypeError:
        pass
    text = str(value).strip()
    if not text:
        return None
    return [{"text": text}]


def _to_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    # NaN 不写入
    if f != f:  # NaN check
        return None
    return f


def _to_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def format_value(field_type: str, value: Any) -> Any:
    if field_type == "DATE_TIME":
        return _to_ts_ms(value)
    if field_type == "SINGLE_SELECT":
        return _to_select(value)
    if field_type == "NUMBER":
        return _to_number(value)
    return _to_text(value)


def build_record_values(
    row: dict[str, Any],
    field_mapping: dict[str, str],
    field_types: dict[str, str],
) -> dict[str, Any]:
    """把 1 行 SQL 结果转为 add_records.values 字段。

    field_mapping: 源字段（en）→ 智能表 field_id
    field_types:   field_id → 类型 (TEXT/NUMBER/DATE_TIME/SINGLE_SELECT)
    """
    values: dict[str, Any] = {}
    for src_field, target_id in field_mapping.items():
        raw_val = row.get(src_field)
        field_type = field_types.get(target_id, "TEXT")
        formatted = format_value(field_type, raw_val)
        if formatted is None:
            continue  # 不写入空字段，避免覆盖默认值
        values[target_id] = formatted
    return values


# ---------- Main ----------


def write_log(instance: InstanceConfig, summary: dict[str, Any]) -> Path:
    log_dir = HERE / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = log_dir / f"{instance.instance_name}_sync_{ts}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def state_path(instance: InstanceConfig) -> Path:
    """sync 模式的状态文件路径：记录已写入智能表的 primary_key 集合。"""
    return HERE / "state" / f"{instance.instance_name}_synced_keys.json"


def load_state(instance: InstanceConfig) -> dict[str, Any]:
    p = state_path(instance)
    if not p.exists():
        return {"synced_keys": [], "last_sync_at": None}
    return json.loads(p.read_text(encoding="utf-8"))


def save_state(instance: InstanceConfig, state: dict[str, Any], *, backup_existing: bool = False) -> None:
    p = state_path(instance)
    p.parent.mkdir(parents=True, exist_ok=True)
    if backup_existing and p.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.copy2(p, p.with_name(f"{p.name}.bak.{ts}"))
    p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def key_strategy(instance: InstanceConfig) -> str:
    return "composite_key" if instance.composite_key else "primary_key"


def composite_fields(instance: InstanceConfig) -> list[str]:
    return list(instance.composite_key) if instance.composite_key else [instance.primary_key]


def state_fields_compatible(instance: InstanceConfig, state: dict[str, Any]) -> bool:
    actual_strategy = state.get("key_strategy")
    actual_fields = state.get("composite_fields")
    expected_strategy = key_strategy(instance)
    if actual_strategy != expected_strategy:
        return False
    # 过渡兼容：PR 引入期间已有 composite_key state 只写了 key_strategy，
    # 下一次成功 sync/rebuild 会补写 composite_fields。
    if actual_fields is None and expected_strategy == "composite_key":
        keys = [str(k) for k in state.get("synced_keys", []) if k]
        return bool(keys) and all("|" in k for k in keys)
    return actual_fields == composite_fields(instance)


def validate_state_key_strategy(instance: InstanceConfig, state: dict[str, Any]) -> None:
    """sync 前校验 state 口径，防止旧 primary_key state 被 composite_key 全量错配。"""
    keys = state.get("synced_keys", [])
    if not keys:
        return

    expected_strategy = key_strategy(instance)
    expected_fields = composite_fields(instance)
    actual_strategy = state.get("key_strategy")
    actual_fields = state.get("composite_fields")

    if actual_strategy is None:
        raise RuntimeError(
            "state.json 缺少 key_strategy，疑似旧 primary_key 口径；"
            "请先执行 --rebuild-state --dry-run 核对，再按提示迁移或使用显式 force"
        )
    if not state_fields_compatible(instance, state):
        raise RuntimeError(
            "state.json key_strategy/composite_fields 与当前实例配置不一致："
            f"state=({actual_strategy}, {actual_fields}) current=({expected_strategy}, {expected_fields})；"
            "拒绝 sync，避免重复写入或漏同步"
        )


def _stable_value(v: Any) -> str:
    """把任意值稳定化为字符串，用于复合主键拼接（避免 float 精度漂移与 NaN）。"""
    if v is None:
        return ""
    if isinstance(v, float):
        if v != v:  # NaN
            return ""
        return f"{v:.4f}"
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, date_cls):
        return v.isoformat()
    return str(v).strip()


def _row_key(row: dict[str, Any], instance: InstanceConfig | None = None) -> str:
    """row 唯一性键值：

    - 若 instance.composite_key 声明 → 按字段顺序 `|` 拼接稳定化值
    - 否则 → row 的 _primary_key 别名列（即 instance.primary_key 字段值）
    """
    if instance is not None and instance.composite_key:
        missing = [f for f in instance.composite_key if f not in row]
        if missing:
            raise KeyError(f"row 缺少 composite_key 字段: {missing}")
        return "|".join(_stable_value(row[f]) for f in instance.composite_key)
    return str(row.get("_primary_key", ""))


def run(instance: InstanceConfig, mode: str, dry_run: bool) -> dict[str, Any]:
    rows = fetch_rows(instance)
    schema = {fid: instance.field_labels.get(fid, fid) for fid in instance.field_mapping.values()}

    # sync 模式过滤已同步的主键；init 模式全量
    if mode == "sync":
        state = load_state(instance)
        validate_state_key_strategy(instance, state)
        synced = set(state.get("synced_keys", []))
        new_rows = [r for r in rows if _row_key(r, instance) not in synced]
        skipped = len(rows) - len(new_rows)
    else:
        state = {"synced_keys": [], "last_sync_at": None}
        synced = set()
        new_rows = rows
        skipped = 0

    add_records = []
    for row in new_rows:
        values = build_record_values(row, instance.field_mapping, instance.field_types)
        add_records.append({"values": values, "_primary_key": _row_key(row, instance)})

    summary: dict[str, Any] = {
        "instance_name": instance.instance_name,
        "mode": mode,
        "filters": instance.filters,
        "source_rows": len(rows),
        "state_synced_keys_before": len(synced),
        "skipped_already_synced": skipped,
        "add_records_planned": len(add_records),
        "dry_run": dry_run,
        "schema_field_ids": list(schema.keys()),
    }

    if dry_run:
        # 打印前 3 条 sample，便于肉眼检查
        summary["sample_records"] = [
            {"values": r["values"]} for r in add_records[:3]
        ]
        log_path = write_log(instance, summary)
        summary["log_path"] = str(log_path)
        return summary

    if mode not in ("init", "sync"):
        raise ValueError(f"unknown mode: {mode}")

    if not add_records:
        summary["batches"] = []
        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        log_path = write_log(instance, summary)
        summary["log_path"] = str(log_path)
        return summary

    webhook_url = os.environ.get(instance.webhook_env)
    if not webhook_url:
        raise RuntimeError(f"缺少环境变量 {instance.webhook_env}")

    import time as time_mod

    summary["batches"] = []
    newly_synced_keys: list[str] = []
    for chunk in chunked(add_records, instance.batch_size):
        # webhook payload 不带内部 _primary_key 标记
        payload_records = [{"values": r["values"]} for r in chunk]
        resp = post_webhook(webhook_url, {"schema": schema, "add_records": payload_records})
        errcode = resp.get("errcode")
        returned_records = resp.get("add_records")
        summary["batches"].append({
            "op": "add",
            "sent": len(chunk),
            "errcode": errcode,
            "errmsg": (resp.get("errmsg") or "")[:200],
            "returned": len(returned_records) if isinstance(returned_records, list) else None,
        })
        # 成功 batch 内的主键追加到已同步集合（errcode == 0 = OK）
        if errcode == 0:
            if not isinstance(returned_records, list) or len(returned_records) != len(chunk):
                raise RuntimeError(
                    "企业微信新增返回数量不一致，拒绝更新本地 state："
                    f"sent={len(chunk)} returned="
                    f"{len(returned_records) if isinstance(returned_records, list) else 'missing'}"
                )
            newly_synced_keys.extend(r["_primary_key"] for r in chunk if r["_primary_key"])
        # 速率限制：每条记录占用 60/sheet_rpm 秒
        time_mod.sleep(60.0 / max(1, instance.sheet_rpm) * len(chunk))

    # 写回 state（init/sync 两种模式都更新，避免 init 后再 sync 又重复写入）
    state["synced_keys"] = sorted(set(state.get("synced_keys", [])) | set(newly_synced_keys))
    state["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    state["key_strategy"] = key_strategy(instance)
    state["composite_fields"] = composite_fields(instance)
    save_state(instance, state)

    summary["state_synced_keys_after"] = len(state["synced_keys"])
    summary["newly_synced_count"] = len(newly_synced_keys)
    summary["completed_at"] = datetime.now(timezone.utc).isoformat()
    log_path = write_log(instance, summary)
    summary["log_path"] = str(log_path)
    return summary


def rebuild_state(
    instance: InstanceConfig,
    *,
    dry_run: bool = False,
    force_assume_remote_complete: bool = False,
) -> dict[str, Any]:
    """按当前 key 口径重建/迁移 state.json。

    使用场景：composite_key 配置变更后，旧 state（按 primary_key 存储）需重生成。
    默认只做可证明安全的迁移；若要把当前源数据全量视为已同步，必须显式 force。
    """
    rows = fetch_rows(instance)
    previous_state = load_state(instance)
    previous_keys = set(previous_state.get("synced_keys", []))
    row_keys = {_row_key(r, instance) for r in rows if _row_key(r, instance)}

    ambiguous_primary_keys: dict[str, list[str]] = {}
    missing_primary_keys: list[str] = []

    if force_assume_remote_complete:
        keys = sorted(row_keys)
        rebuild_mode = "force_assume_remote_complete"
    elif state_fields_compatible(instance, previous_state):
        keys = sorted(previous_keys)
        rebuild_mode = "refresh_existing_strategy"
    elif previous_keys and not previous_state.get("key_strategy") and instance.composite_key:
        by_primary: dict[str, list[str]] = {}
        for row in rows:
            primary = str(row.get("_primary_key", ""))
            if not primary:
                continue
            by_primary.setdefault(primary, []).append(_row_key(row, instance))

        migrated: set[str] = set()
        for primary in sorted(previous_keys):
            matches = sorted(set(by_primary.get(primary, [])))
            if not matches:
                missing_primary_keys.append(primary)
            elif len(matches) == 1:
                migrated.add(matches[0])
            else:
                ambiguous_primary_keys[primary] = matches

        if ambiguous_primary_keys:
            sample = ", ".join(list(ambiguous_primary_keys)[:5])
            raise RuntimeError(
                "旧 primary_key state 存在一对多 composite_key，无法确认远端是否已写入全部行；"
                f"ambiguous={len(ambiguous_primary_keys)} sample={sample}。"
                "请人工核验企微表后使用 --force-assume-remote-complete，或先补写缺失行"
            )
        keys = sorted(migrated)
        rebuild_mode = "migrate_primary_to_composite"
    else:
        raise RuntimeError(
            "无法安全重建 state：缺少可迁移的旧 state，或 state 口径与当前配置不兼容。"
            "如已核验远端表完整，请加 --force-assume-remote-complete"
        )

    state = {
        "synced_keys": keys,
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
        "rebuilt_from_source": True,
        "key_strategy": key_strategy(instance),
        "composite_fields": composite_fields(instance),
        "rebuild_mode": rebuild_mode,
    }
    if not dry_run:
        save_state(instance, state, backup_existing=True)
    return {
        "instance_name": instance.instance_name,
        "operation": "rebuild_state",
        "dry_run": dry_run,
        "state_path": str(state_path(instance)),
        "rebuild_mode": rebuild_mode,
        "key_strategy": state["key_strategy"],
        "composite_fields": state["composite_fields"],
        "source_rows": len(rows),
        "previous_keys": len(previous_keys),
        "unique_keys_after": len(keys),
        "duplicates_collapsed": len(rows) - len(keys),
        "missing_primary_keys": missing_primary_keys[:20],
        "missing_primary_key_count": len(missing_primary_keys),
        "completed_at": state["last_sync_at"],
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="通用筛选保单 → 企业微信智能表同步引擎")
    p.add_argument("--instance", required=True, help="实例 YAML 路径")
    p.add_argument("--mode", default="init", choices=["init", "sync"], help="init=全量 add；sync=增量 add-only")
    p.add_argument("--dry-run", action="store_true", help="仅查询并打印 sample，不写入智能表")
    p.add_argument("--batch-size", type=int, help="覆盖实例 YAML 中 batch_size")
    p.add_argument("--rebuild-state", action="store_true",
                   help="按当前 composite_key/primary_key 重建 state.json；不发 webhook、不写智能表")
    p.add_argument("--force-assume-remote-complete", action="store_true",
                   help="仅用于 --rebuild-state：已人工核验远端完整时，把当前源数据全量标为已同步")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    instance_path = Path(args.instance).resolve()
    instances = load_instances(instance_path)

    if args.batch_size:
        instances = [
            InstanceConfig(**{**instance.__dict__, "batch_size": args.batch_size})
            for instance in instances
        ]

    if args.rebuild_state:
        summaries = [
            rebuild_state(
                instance,
                dry_run=args.dry_run,
                force_assume_remote_complete=args.force_assume_remote_complete,
            )
            for instance in instances
        ]
        payload = summaries[0] if len(summaries) == 1 else {
            "instance_file": str(instance_path),
            "target_count": len(summaries),
            "results": summaries,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        return

    summaries = [run(instance, mode=args.mode, dry_run=args.dry_run) for instance in instances]
    if len(summaries) > 1:
        print(json.dumps({
            "instance_file": str(instance_path),
            "target_count": len(summaries),
            "results": [
                {k: v for k, v in summary.items() if k != "sample_records"}
                for summary in summaries
            ],
        }, ensure_ascii=False, indent=2, default=str))
        return

    summary = summaries[0]
    print(json.dumps(
        {k: v for k, v in summary.items() if k != "sample_records"},
        ensure_ascii=False, indent=2, default=str,
    ))
    if summary.get("sample_records"):
        print("\n=== Sample (前 3 条) ===")
        print(json.dumps(summary["sample_records"], ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
