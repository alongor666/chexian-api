"""台账已有记录字段更新引擎（实例 YAML `update_sync` 块驱动）。

与 add-only 引擎（sync_filtered_policies.py）的关系：
- add 引擎负责"新签单进台账"（增量 add，state=已同步键集合）；
- 本引擎负责"已有行的动态字段刷新"：续保报价 4 字段（是否报价/风险等级/自主系数/商业险NCD）
  随报价进展变化，add-only 无法回写；投保人存量回填也走本机制。

口径（RED LINE business-domain.md）：
- 应续判定 ← 续保底册 renewal_tracker（source_policy_no 命中即应续）。
- 是否报价-续保 + 报价属性 ← 报价域 quotes_conversion：同车架号、签单日 30 天后的
  最新一次商业险报价（+30 天缓冲排除促成本单的签单报价；详见 fetch_source_rows 注释，
  底册 is_quoted 粗口径的假阳性问题也记录在彼处）。
- 非应续行不写任何续保字段（留空），杜绝"否"的假阴性。

机制（对齐 sync_may_renewal_fields.py 先例）：
- webhook 只能写不能读 → 真实更新前必须 prime-state：wecom-cli smartsheet_get_records
  读表建 保单号→record_id 映射（一个保单号可对应多条记录，record_ids 存列表）。
- payload_hash 幂等：值未变化的记录跳过，不重复推送。
- 隐私红线：投保人（sensitive: true）在 dry-run 样例与 logs/ 落盘前 mask_pii 脱敏；
  真实 webhook 写入不受影响。

用法：
    python3 sync_ledger_update_fields.py prime-state --instance instances/<name>.yaml --url <表URL>
    python3 sync_ledger_update_fields.py sync --instance instances/<name>.yaml [--execute] [--force]
"""

from __future__ import annotations

# --- bootstrap: load .env.local for standalone python3 invocation (see _env.py) ---
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import _env as _env  # noqa: F401,E402  module-level load_dotenv_local() runs on import
del _sys, _Path
# --- end bootstrap ---

import argparse
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import duckdb
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent))  # 数据管理/ 根：供 import pipelines.*
from sync_renewal_v2 import post_webhook  # noqa: E402
from sync_filtered_policies import (  # noqa: E402  复用：where 拼装 / 值格式化 / 脱敏 SSOT
    build_where,
    format_value,
    mask_pii,
    _to_text,
)
from sync_may_renewal_fields import (  # noqa: E402  复用：wecom-cli 读表 / 响应解包
    get_records_with_wecom_cli,
    iter_records,
)
from pipelines.branch_assert import assert_single_branch, is_national_view  # noqa: E402

VALID_GRADES = {"A", "B", "C", "D", "E", "F"}


# ---------- Config ----------


@dataclass(frozen=True)
class UpdateFieldSpec:
    source: str        # 源列名（SQL 输出列）
    field_id: str      # 智能表 field_id
    field_type: str    # TEXT / NUMBER / SINGLE_SELECT
    label: str
    sensitive: bool = False


@dataclass(frozen=True)
class UpdateConfig:
    instance_name: str
    webhook_env: str
    policy_glob: str
    filters: dict[str, Any]
    batch_size: int
    sheet_id: str
    key_source_field: str
    key_field_id: str
    renewal_tracker_glob: str
    quotes_glob: str
    state_path: Path
    fields: tuple[UpdateFieldSpec, ...] = field(default_factory=tuple)


def load_update_config(instance_path: Path) -> UpdateConfig:
    raw = yaml.safe_load(instance_path.read_text(encoding="utf-8"))
    block = raw.get("update_sync")
    if not block:
        raise SystemExit(f"实例 {instance_path.name} 无 update_sync 配置块，本引擎不适用")
    specs = tuple(
        UpdateFieldSpec(
            source=src,
            field_id=spec["field_id"],
            field_type=spec.get("type", "TEXT"),
            label=spec.get("label", src),
            sensitive=bool(spec.get("sensitive", False)),
        )
        for src, spec in dict(block["fields"]).items()
    )
    state_rel = Path(block["state"])
    return UpdateConfig(
        instance_name=raw["instance_name"],
        webhook_env=raw["webhook_env"],
        policy_glob=raw["policy_glob"],
        filters=dict(raw.get("filters", {})),
        batch_size=int(raw.get("batch_size", 100)),
        sheet_id=block["sheet_id"],
        key_source_field=block.get("key_source_field", "policy_no"),
        key_field_id=block["key_field_id"],
        renewal_tracker_glob=block["renewal_tracker_glob"],
        quotes_glob=block["quotes_glob"],
        state_path=state_rel if state_rel.is_absolute() else HERE / state_rel,
        fields=specs,
    )


# ---------- State ----------


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "records": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------- Source rows ----------


def fetch_source_rows(config: UpdateConfig) -> list[dict[str, Any]]:
    where, params = build_where(config.filters)

    con = duckdb.connect(":memory:")
    # applicant_name 缺列兼容（历史 parquet 分片无此列时补 NULL；与 add 引擎同款探测）
    available = set(
        con.execute(
            f"SELECT * FROM read_parquet('{config.policy_glob}', union_by_name=true) LIMIT 0"
        ).fetchdf().columns
    )
    applicant_expr = "applicant_name" if "applicant_name" in available else "NULL AS applicant_name"

    # 续保报价关联口径（2026-07-17 实测锁定）：
    # - 报价域 policy_no = 该报价"促成"的新签单号（报价日=签单日实证），按 policy_no 直连
    #   拿到的是台账保单自身出单前的报价（即"定价-签单"来源，由 add 引擎从签单域直写），
    #   不是它下一次续保的报价。
    # - 续保报价 = 同车架号、且报价时间晚于本单签单日 30 天以上的最新一次商业险报价
    #   （续保报价发生在保障期内、新单出单前；+30 天缓冲排除签单当口的促成报价）。
    # - 应续判定以续保底册（source_policy_no）为唯一事实源；「是否报价-续保」不用底册
    #   is_quoted——该字段是"车架号在窗口内有过任意商业险报价"的粗口径，2025-12 后签的单
    #   会把自己的促成签单报价误判成"已续保报价"（2026-07-17 实测 18 命中里 16 张假阳性）。
    #   本表口径 = 用户原话「从报价域筛选」：是否报价-续保 与报价属性同源同判
    #   （存在签单日+30天后的续保报价 ⟺ 是，且属性可写），自洽无打架。
    sql = f"""
    WITH ledger AS (
      SELECT
        policy_no,
        ANY_VALUE(applicant_name) FILTER (
          WHERE applicant_name IS NOT NULL AND applicant_name != ''
        ) AS applicant_name,
        ANY_VALUE(vehicle_frame_no) FILTER (
          WHERE vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
        ) AS vehicle_frame_no,
        MIN(CAST(policy_date AS DATE)) AS sign_date
      FROM (
        SELECT policy_no, vehicle_frame_no, policy_date, {applicant_expr}
        FROM read_parquet('{config.policy_glob}', union_by_name=true)
        WHERE {where}
      )
      GROUP BY policy_no
    ),
    rt AS (
      SELECT * EXCLUDE rn FROM (
        SELECT source_policy_no, is_quoted, vehicle_frame_no AS rt_vin,
               ROW_NUMBER() OVER (
                 PARTITION BY source_policy_no
                 ORDER BY expiry_date DESC NULLS LAST
               ) AS rn
        FROM read_parquet('{config.renewal_tracker_glob}')
        WHERE source_policy_no IS NOT NULL AND source_policy_no != ''
      ) WHERE rn = 1
    ),
    q AS (
      SELECT vehicle_frame_no AS q_vin,
             quote_time,
             insurance_grade,
             commercial_pricing_factor,
             commercial_ncd
      FROM read_parquet('{config.quotes_glob}')
      WHERE vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
        AND insurance_type = '商业保险'
    )
    SELECT
      ledger.policy_no,
      ledger.applicant_name,
      rt.source_policy_no IS NOT NULL AS in_renewal_universe,
      q.quote_time IS NOT NULL AS has_renewal_quote,
      q.insurance_grade AS renewal_insurance_grade_raw,
      q.commercial_pricing_factor AS renewal_pricing_factor,
      q.commercial_ncd AS renewal_commercial_ncd
    FROM ledger
    LEFT JOIN rt ON ledger.policy_no = rt.source_policy_no
    LEFT JOIN q
      ON q.q_vin = COALESCE(rt.rt_vin, ledger.vehicle_frame_no)
      AND ledger.sign_date IS NOT NULL
      AND CAST(q.quote_time AS DATE) > ledger.sign_date + INTERVAL 30 DAY
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY ledger.policy_no
      ORDER BY q.quote_time DESC NULLS LAST
    ) = 1
    ORDER BY ledger.policy_no
    """
    df = con.execute(sql, params).fetchdf()
    # 出口零信任断言：与 add 引擎同款，从 policy_no 前缀派生省份，跨省混入即中止
    assert_single_branch(
        df,
        allow_national=is_national_view(),
        context=f"台账字段更新 {config.instance_name}",
    )
    return df.to_dict("records")


def derive_update_values(row: dict[str, Any]) -> dict[str, Any]:
    """源行 → 业务值映射（source 名 → 原始值；None 表示不写入）。

    - 投保人：有值才写。
    - 应续行（续保底册命中）：是否报价 = 是/否；报价属性有值才写。
    - 非应续行：4 个续保字段一律不写（留空 ≠ 否，防假阴性）。
    - 风险等级仅接受 A-F（X/空值不写入，与 add 引擎口径一致）。
    """
    values: dict[str, Any] = {}
    applicant = _to_text(row.get("applicant_name"))
    if applicant:
        values["applicant_name"] = applicant

    if bool(row.get("in_renewal_universe")):
        raw_flag = row.get("has_renewal_quote")
        quoted = bool(raw_flag) if (raw_flag is not None and raw_flag == raw_flag) else False
        values["renewal_is_quoted"] = "是" if quoted else "否"
        # 是否报价与报价属性同源同判（见 fetch_source_rows 口径注释），天然自洽
        if quoted:
            grade = _to_text(row.get("renewal_insurance_grade_raw"))
            if grade in VALID_GRADES:
                values["renewal_insurance_grade"] = grade
            for key in ("renewal_pricing_factor", "renewal_commercial_ncd"):
                v = row.get(key)
                try:
                    if v is not None and float(v) == float(v):  # 非 NaN
                        values[key] = float(v)
                except (TypeError, ValueError):
                    continue
    return values


def format_update_values(
    business_values: dict[str, Any], specs: Iterable[UpdateFieldSpec]
) -> dict[str, Any]:
    """业务值 → 智能表 values（field_id → 格式化值；复用 add 引擎 format_value）。"""
    out: dict[str, Any] = {}
    for spec in specs:
        if spec.source not in business_values:
            continue
        formatted = format_value(spec.field_type, business_values[spec.source])
        if formatted is None:
            continue
        out[spec.field_id] = formatted
    return out


def payload_hash(values: dict[str, Any]) -> str:
    raw = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_plan(
    rows: list[dict[str, Any]], state: dict[str, Any], config: UpdateConfig, *, force: bool = False
) -> dict[str, Any]:
    state_records = state.get("records", {})
    update_records: list[dict[str, Any]] = []
    skipped_unchanged = 0
    skipped_no_values = 0
    missing_in_state: list[str] = []

    for row in rows:
        key = _to_text(row.get(config.key_source_field))
        if not key:
            continue
        entry = state_records.get(key)
        if not entry or not entry.get("record_ids"):
            missing_in_state.append(key)
            continue
        values = format_update_values(derive_update_values(row), config.fields)
        if not values:
            skipped_no_values += 1
            continue
        h = payload_hash(values)
        if not force and entry.get("payload_hash") == h:
            skipped_unchanged += 1
            continue
        for rid in entry["record_ids"]:
            update_records.append({
                "record_id": rid,
                "values": values,
                "_key": key,
                "_payload_hash": h,
            })

    return {
        "update_records": update_records,
        "skipped_unchanged": skipped_unchanged,
        "skipped_no_values": skipped_no_values,
        "missing_in_state": missing_in_state,
    }


# ---------- Masking（隐私红线：投保人不得明文进 stdout / logs/） ----------


def sensitive_ids(config: UpdateConfig) -> set[str]:
    return {spec.field_id for spec in config.fields if spec.sensitive}


def mask_update_sample(records: list[dict[str, Any]], sensitive: set[str]) -> list[dict[str, Any]]:
    out = []
    for r in records:
        masked = {
            fid: (mask_pii(v) if fid in sensitive else v)
            for fid, v in r["values"].items()
        }
        out.append({"record_id": r["record_id"], "values": masked, "_key": r["_key"]})
    return out


# ---------- Prime state ----------


def read_key_text(cell: Any) -> str | None:
    """从 get_records 单元格值提取文本（text 型：[{type,text}]）。"""
    if isinstance(cell, list):
        parts = [str(item.get("text", "")) for item in cell if isinstance(item, dict)]
        joined = "".join(parts).strip()
        return joined or None
    if isinstance(cell, str):
        return cell.strip() or None
    return None


def prime_state(config: UpdateConfig, *, docid: str | None, url: str | None) -> dict[str, Any]:
    response = get_records_with_wecom_cli(
        docid=docid, url=url, sheet_id=config.sheet_id, vin_field_id=config.key_field_id
    )
    state = load_state(config.state_path)
    records: dict[str, Any] = state.setdefault("records", {})
    seen = 0
    missing_key = 0
    now = datetime.now(timezone.utc).isoformat()
    fresh: dict[str, list[str]] = {}
    for rec in iter_records(response):
        rid = rec.get("record_id") or rec.get("id")
        if not rid:
            continue
        cell = (rec.get("values") or {}).get(config.key_field_id) \
            or (rec.get("values") or {}).get("保单号")
        key = read_key_text(cell)
        if not key:
            missing_key += 1
            continue
        fresh.setdefault(key, []).append(str(rid))
        seen += 1
    for key, rids in fresh.items():
        records[key] = {**records.get(key, {}), "record_ids": sorted(set(rids)), "primed_at": now}
    state["key_field_id"] = config.key_field_id
    state["summary"] = {
        "operation": "prime-state",
        "records_after": len(records),
        "records_seen": seen,
        "missing_key": missing_key,
        "multi_record_keys": sum(1 for v in fresh.values() if len(v) > 1),
        "updated_at": now,
    }
    save_state(config.state_path, state)
    return {"state_path": str(config.state_path), **state["summary"]}


# ---------- Sync ----------


def write_log(config: UpdateConfig, summary: dict[str, Any]) -> Path:
    log_dir = HERE / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = log_dir / f"{config.instance_name}_update_{ts}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def run_sync(config: UpdateConfig, *, execute: bool, force: bool) -> dict[str, Any]:
    state = load_state(config.state_path)
    if not state.get("records"):
        if execute:
            raise RuntimeError(
                f"state 为空，不能更新现有表。先执行 prime-state 建立 保单号→record_id 映射：{config.state_path}"
            )
        rows = fetch_source_rows(config)
        summary = {
            "operation": "sync_ledger_update_fields",
            "instance_name": config.instance_name,
            "dry_run": True,
            "state_required": True,
            "source_rows": len(rows),
            "state_records": 0,
            "to_update": 0,
            "message": "state 为空；真实更新前必须先 prime-state（wecom-cli 读表）",
        }
        log_path = write_log(config, summary)
        summary["log_path"] = str(log_path)
        return summary

    rows = fetch_source_rows(config)
    plan = build_plan(rows, state, config, force=force)
    schema = {spec.field_id: spec.label for spec in config.fields}
    summary: dict[str, Any] = {
        "operation": "sync_ledger_update_fields",
        "instance_name": config.instance_name,
        "dry_run": not execute,
        "source_rows": len(rows),
        "state_records": len(state.get("records", {})),
        "to_update": len(plan["update_records"]),
        "skipped_unchanged": plan["skipped_unchanged"],
        "skipped_no_values": plan["skipped_no_values"],
        "missing_in_state_count": len(plan["missing_in_state"]),
        "missing_in_state_sample": plan["missing_in_state"][:10],
        "schema_field_ids": list(schema.keys()),
        # 隐私红线：样例一律脱敏后再进 stdout / logs/
        "sample_updates": mask_update_sample(plan["update_records"][:3], sensitive_ids(config)),
    }
    if not execute:
        log_path = write_log(config, summary)
        summary["log_path"] = str(log_path)
        return summary

    webhook_url = os.environ.get(config.webhook_env)
    if not webhook_url:
        raise RuntimeError(f"缺少环境变量 {config.webhook_env}")

    batches: list[dict[str, Any]] = []
    records_state = state["records"]
    chunk: list[dict[str, Any]] = []

    def flush(chunk_records: list[dict[str, Any]]) -> None:
        payload = [{"record_id": r["record_id"], "values": r["values"]} for r in chunk_records]
        resp = post_webhook(webhook_url, {"schema": schema, "update_records": payload})
        if resp.get("errcode") != 0:
            raise RuntimeError(f"企业微信更新失败: {resp}")
        now = datetime.now(timezone.utc).isoformat()
        for r in chunk_records:
            records_state[r["_key"]] = {
                **records_state.get(r["_key"], {}),
                "payload_hash": r["_payload_hash"],
                "updated_at": now,
            }
        save_state(config.state_path, state)
        batches.append({"op": "update", "sent": len(chunk_records), "errcode": resp.get("errcode")})

    for record in plan["update_records"]:
        chunk.append(record)
        if len(chunk) >= config.batch_size:
            flush(chunk)
            chunk = []
    if chunk:
        flush(chunk)

    summary["batches"] = batches
    summary["completed_at"] = datetime.now(timezone.utc).isoformat()
    log_path = write_log(config, summary)
    summary["log_path"] = str(log_path)
    return summary


# ---------- CLI ----------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="台账已有记录字段更新引擎（instance yaml update_sync 驱动）")
    sub = p.add_subparsers(dest="command", required=True)

    prime = sub.add_parser("prime-state", help="wecom-cli 读表建立 保单号→record_id 映射")
    prime.add_argument("--instance", required=True)
    prime.add_argument("--docid")
    prime.add_argument("--url", help="智能表分享 URL（与 --docid 二选一）")

    sync = sub.add_parser("sync", help="按源数据更新已有记录字段（默认 dry-run）")
    sync.add_argument("--instance", required=True)
    sync.add_argument("--execute", action="store_true", help="真实调用 webhook；默认只 dry-run")
    sync.add_argument("--force", action="store_true", help="忽略 payload_hash 全量重推")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    config = load_update_config(Path(args.instance).resolve())
    if args.command == "prime-state":
        if not args.docid and not args.url:
            raise SystemExit("prime-state 需要 --docid 或 --url")
        result = prime_state(config, docid=args.docid, url=args.url)
    else:
        result = run_sync(config, execute=args.execute, force=args.force)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
