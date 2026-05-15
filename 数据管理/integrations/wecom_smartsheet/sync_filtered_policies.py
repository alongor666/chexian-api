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
    sync  增量 upsert；按 primary_key 维护 state.json，新增 add / 已存在 update
          （v0 仅实现 add；update 视后续业务需求接入 plan_upsert）
"""

from __future__ import annotations

import argparse
import json
import os
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
    field_mapping: dict[str, str]
    field_types: dict[str, str]
    field_labels: dict[str, str]
    policy_glob: str
    script: str | None  # 仅供 daily.mjs 路由用


def load_instance(path: Path) -> InstanceConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return InstanceConfig(
        instance_name=raw["instance_name"],
        webhook_env=raw["webhook_env"],
        batch_size=int(raw.get("batch_size", 100)),
        sheet_rpm=int(raw.get("sheet_records_per_minute_limit", 3000)),
        filters=raw["filters"],
        primary_key=raw.get("primary_key", "policy_no"),
        field_mapping=raw["field_mapping"],
        field_types=raw.get("field_types", {}),
        field_labels=raw.get("field_labels", {}),
        policy_glob=raw.get("policy_glob", DEFAULT_POLICY_GLOB),
        script=raw.get("script"),
    )


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
    """DATE_TIME 字段统一转毫秒 timestamp 字符串。"""
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, datetime):
        return str(int(value.timestamp() * 1000))
    if isinstance(value, date_cls):
        dt = datetime.combine(value, datetime.min.time())
        return str(int(dt.timestamp() * 1000))
    # duckdb 返回 pandas.Timestamp / numpy.datetime64
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00").split(".")[0].replace("T", " "))
        return str(int(ts.timestamp() * 1000))
    except (ValueError, TypeError):
        return None


def _to_select(value: Any) -> list[dict[str, str]] | None:
    if value is None:
        return None
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


def run(instance: InstanceConfig, mode: str, dry_run: bool) -> dict[str, Any]:
    rows = fetch_rows(instance)
    schema = {fid: instance.field_labels.get(fid, fid) for fid in instance.field_mapping.values()}

    add_records = []
    for row in rows:
        values = build_record_values(row, instance.field_mapping, instance.field_types)
        add_records.append({"values": values})

    summary: dict[str, Any] = {
        "instance_name": instance.instance_name,
        "mode": mode,
        "filters": instance.filters,
        "source_rows": len(rows),
        "add_records_planned": len(add_records),
        "dry_run": dry_run,
        "schema_field_ids": list(schema.keys()),
    }

    if dry_run:
        # 打印前 3 条 sample，便于肉眼检查
        summary["sample_records"] = add_records[:3]
        log_path = write_log(instance, summary)
        summary["log_path"] = str(log_path)
        return summary

    if mode != "init":
        raise NotImplementedError(
            f"mode={mode} 尚未实现（v0 仅支持 init）。后续增量同步可基于 primary_key 维护 state.json。"
        )

    webhook_url = os.environ.get(instance.webhook_env)
    if not webhook_url:
        raise RuntimeError(f"缺少环境变量 {instance.webhook_env}")

    import time as time_mod

    summary["batches"] = []
    for chunk in chunked(add_records, instance.batch_size):
        resp = post_webhook(webhook_url, {"schema": schema, "add_records": chunk})
        summary["batches"].append({
            "op": "add",
            "sent": len(chunk),
            "errcode": resp.get("errcode"),
            "errmsg": (resp.get("errmsg") or "")[:200],
        })
        # 速率限制：每条记录占用 60/sheet_rpm 秒
        time_mod.sleep(60.0 / max(1, instance.sheet_rpm) * len(chunk))

    summary["completed_at"] = datetime.now(timezone.utc).isoformat()
    log_path = write_log(instance, summary)
    summary["log_path"] = str(log_path)
    return summary


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="通用筛选保单 → 企业微信智能表同步引擎")
    p.add_argument("--instance", required=True, help="实例 YAML 路径")
    p.add_argument("--mode", default="init", choices=["init", "sync"], help="init=全量 add；sync=增量 upsert（v0 未实现）")
    p.add_argument("--dry-run", action="store_true", help="仅查询并打印 sample，不写入智能表")
    p.add_argument("--batch-size", type=int, help="覆盖实例 YAML 中 batch_size")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    instance_path = Path(args.instance).resolve()
    instance = load_instance(instance_path)

    if args.batch_size:
        instance = InstanceConfig(
            **{**instance.__dict__, "batch_size": args.batch_size}
        )

    summary = run(instance, mode=args.mode, dry_run=args.dry_run)

    print(json.dumps(
        {k: v for k, v in summary.items() if k != "sample_records"},
        ensure_ascii=False, indent=2, default=str,
    ))
    if summary.get("sample_records"):
        print("\n=== Sample (前 3 条) ===")
        print(json.dumps(summary["sample_records"], ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
