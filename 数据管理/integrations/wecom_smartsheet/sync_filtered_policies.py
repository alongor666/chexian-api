"""通用筛选保单 → 企业微信智能表同步引擎

与 sync_renewal_v2.py 的关系：
- sync_renewal_v2 深度耦合续保口径（quote_window / 重复投保审计 / 跨批排他）
- 本脚本面向通用筛选场景：agent_name LIKE / policy_date >= / org_level_3 IN ...
- 复用 sync_renewal_v2 的 webhook POST 工具（post_webhook）；幂等分批推送用 lib.idempotent_smartsheet

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

# --- bootstrap: load .env.local for standalone python3 invocation (see _env.py) ---
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import _env as _env  # noqa: F401,E402  module-level load_dotenv_local() runs on import
del _sys, _Path
# --- end bootstrap ---

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
sys.path.insert(0, str(HERE.parent.parent))  # 数据管理/ 根：供 import pipelines.*
from sync_renewal_v2 import post_webhook  # noqa: E402
from pipelines.branch_assert import assert_single_branch, is_national_view  # noqa: E402
from pipelines.branch_paths import policy_current_glob  # noqa: E402
from lib.idempotent_smartsheet import (  # noqa: E402  幂等共享库（6 道防线，详见库 docstring）
    KeySpec,
    stable_value as _stable_value,
    load_state as _lib_load_state,
    save_state as _lib_save_state,
    validate_state_key_strategy as _lib_validate_state_key_strategy,
    push_add_records_idempotent as _lib_push_add_records_idempotent,
)


def _keyspec(instance: "InstanceConfig") -> KeySpec:
    """实例 → 共享库唯一键描述（复合键优先，回退单主键）。"""
    if instance.composite_key:
        return KeySpec.composite(instance.composite_key)
    return KeySpec.primary(instance.primary_key)

# 双布局自适应（branch_paths SSOT · 801409 cutover 前置）；省份隔离由实例 extra_where
# 注入的 branch_code 条件 + fetch_rows 出口 assert_single_branch 承担，本 glob 只做路径路由。
DEFAULT_POLICY_GLOB = policy_current_glob(
    HERE.parent.parent / "warehouse" / "fact" / "policy" / "current", missing_ok=True
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
    aggregate_key: tuple[str, ...] | None = None  # 声明时先按字段聚合，再做 state 去重/企微写入
    prefer_insurance_type: str | None = None  # 聚合代表行优先选择的险种，如“商业保险”
    # update_sync 联动（可选）：实例声明 update_sync 块时，add 成功响应中的 record_id
    # 按序捕获并落 record map state（webhook 只能写不能读，这是零授权拿 record_id 的唯一通道）
    record_map_state: str | None = None       # update_sync.state（相对 integrations 目录）
    record_map_key_field: str = "policy_no"   # update_sync.key_source_field
    # 花名册（可选）：工号→企微 user_id，声明后自动派生 salesman_user_id 供 USER 型成员列映射
    roster: str | None = None                 # 相对 integrations 目录


def _build_instance(raw: dict[str, Any], target: dict[str, Any] | None = None) -> InstanceConfig:
    target = target or {}
    filters = dict(raw.get("filters", {}))
    filters.update(target.get("filters", {}))
    composite_raw = raw.get("composite_key")
    composite = tuple(composite_raw) if composite_raw else None
    aggregate_raw = raw.get("aggregate_key")
    if isinstance(aggregate_raw, list):
        aggregate = tuple(aggregate_raw)
    elif aggregate_raw:
        aggregate = (str(aggregate_raw),)
    else:
        aggregate = None
    update_sync_raw = raw.get("update_sync") or {}
    instance_name = target.get("instance_name") or (
        f"{raw['instance_name']}-{target['name']}" if target.get("name") else raw["instance_name"]
    )
    # record map state 缺省派生（与 sync_ledger_update_fields 同一规则）：多目标各自独立记账
    record_map_state = None
    if update_sync_raw:
        record_map_state = update_sync_raw.get("state") or f"state/{instance_name}_record_map.json"
    return InstanceConfig(
        record_map_state=record_map_state,
        record_map_key_field=update_sync_raw.get("key_source_field", "policy_no"),
        roster=raw.get("roster"),
        instance_name=instance_name,
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
        aggregate_key=aggregate,
        prefer_insurance_type=raw.get("prefer_insurance_type"),
    )


def load_instances(path: Path) -> list[InstanceConfig]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    targets = raw.get("targets") or []
    if not targets:
        return [_build_instance(raw)]
    # 多 targets 禁共用显式 record map（评审 #1134-1，与 update 引擎同规则）：
    # 不同智能表的 record_id 混入同一 state 会让更新引擎写错表，必须按目标名派生。
    if len(targets) > 1 and (raw.get("update_sync") or {}).get("state"):
        raise SystemExit("多 targets 时 update_sync.state 不可显式声明（record_id 会跨表混入同一文件），请删除让其按目标名派生")
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


# ---------- 花名册（工号 → 企微 user_id，机构级单表成员列写入用） ----------

_SALESMAN_CODE_RE = __import__("re").compile(r"^(\d+)")


def load_roster(path: Path) -> dict[str, str]:
    """读花名册：{工号: 企微 user_id}。文件不存在/无条目 → 空映射（fail-open 留空成员列）。"""
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for code, entry in (data.get("salesmen") or {}).items():
        uid = _to_text((entry or {}).get("wecom_user_id"))
        if uid:
            out[str(code)] = uid
    return out


def enrich_rows_with_roster(rows: list[dict[str, Any]], roster: dict[str, str]) -> dict[str, int]:
    """按 salesman_name 前缀工号解析企微 user_id，写入 row['salesman_user_id']。

    返回 {matched, missing}。未命中花名册的行不设该键 → USER 字段留空（安全默认，
    行权限下仅管理员可见）；花名册补齐后重跑 update 引擎即回填。
    """
    matched = missing = 0
    for row in rows:
        name = _to_text(row.get("salesman_name")) or ""
        m = _SALESMAN_CODE_RE.match(name)
        uid = roster.get(m.group(1)) if m else None
        if uid:
            row["salesman_user_id"] = uid
            matched += 1
        else:
            missing += 1
    return {"matched": matched, "missing": missing}


# 可选源列：仅当 parquet schema 实际含该列时才 SELECT，否则补 NULL 占位。
# 场景：applicant_name（投保人名称）2026-07-17 起上游签单清单才新增，
# 存量 parquet 无此列，直接 SELECT 会让全部实例（含无关实例）抽数报错。
OPTIONAL_SOURCE_COLUMNS = ("customer_category", "previous_insurer", "applicant_name", "commercial_ncd")

# 敏感源字段（个人信息，隐私红线）：dry-run 的 sample_records（stdout 打印 + logs/ 落盘）
# 必须脱敏后输出；真实 webhook 写入不受影响。与 server 侧注册表 sensitive: true 对齐。
SENSITIVE_SOURCE_FIELDS = ("applicant_name",)


def mask_pii(value: Any) -> Any:
    """个人信息脱敏：保留首字符 + 固定两个全角星号（定长，不泄漏原文长度）。"""
    text = _to_text(value)
    if not text:
        return value
    return text[0] + "＊＊"


def mask_sample_values(values: dict[str, Any], sensitive_field_ids: set[str]) -> dict[str, Any]:
    """对 sample_records 单条 values 做敏感字段脱敏（返回新 dict，不改原对象）。"""
    return {
        fid: (mask_pii(v) if fid in sensitive_field_ids else v)
        for fid, v in values.items()
    }


def sensitive_field_ids_of(instance: "InstanceConfig") -> set[str]:
    """实例映射中敏感源字段对应的智能表 field_id 集合。"""
    return {
        instance.field_mapping[src]
        for src in SENSITIVE_SOURCE_FIELDS
        if src in instance.field_mapping
    }


def fetch_rows(instance: InstanceConfig) -> list[dict[str, Any]]:
    where, params = build_where(instance.filters)
    pk = instance.primary_key

    con = duckdb.connect(":memory:")
    # 列探测（LIMIT 0 零扫描，仅取 union_by_name 合并后的 schema，不读数据行；
    # 省份隔离由下方主查询 extra_where + 出口 assert_single_branch 承担）
    available = set(
        con.execute(
            f"SELECT * FROM read_parquet('{instance.policy_glob}', union_by_name=true) LIMIT 0"
        ).fetchdf().columns
    )
    optional_selects = ",\n      ".join(
        col if col in available else f"NULL AS {col}"
        for col in OPTIONAL_SOURCE_COLUMNS
    )

    # 抽数 SQL：SELECT 所有注册表字段 + 派生 vehicle_age_group / vehicle_price_segment
    sql = f"""
    SELECT
      {optional_selects},
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
      /* 经代名简称：从经代全名派生（山西邮政/邮储表用）。
         ⚠️ 邮储全名是"中国邮政储蓄银行"，含"邮政"但不含子串"邮储"，
         故必须先判"储蓄"再判"邮政"，否则邮储会被误标成邮政。
         其他实例（如四川邮政表）不映射 fi6BsM，本列被忽略，向后兼容。 */
      CASE
        WHEN agent_name LIKE '%储蓄%' THEN '邮储'
        WHEN agent_name LIKE '%邮政%' THEN '邮政'
        ELSE NULL
      END AS agent_short_name,
      insurance_type,
      policy_no,
      vehicle_frame_no,
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
    df = con.execute(sql, params).fetchdf()
    # 防线④ 出口零信任断言：企微写入前强制单省体检，跨省混入（如山西 SX 邮政保单
    # 混进四川企微表）即 fail-closed 中止。df 无 branch_code 列（SELECT 是业务投影），
    # 从 policy_no[:3] 派生省份。allow_national 仅 PROVINCE=ALL 显式声明时放行。
    assert_single_branch(
        df,
        # is_national_view() 默认读运行时 os.environ（等价 is_national_view(os.environ)）：
        # 仅当显式设 PROVINCE=ALL 才放行跨省；默认 fail-closed，堵 SX 邮政混入四川表。
        allow_national=is_national_view(),
        context=f"企微出口 {instance.instance_name}",
    )
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
    if not text or text.lower() in {"nan", "none", "<na>", "nat"}:
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


def _money(value: Any) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if f != f else f


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    try:
        if value != value:  # NaN / NaT
            return False
    except TypeError:
        pass
    if isinstance(value, str):
        text = value.strip().lower()
        return bool(text) and text not in {"nan", "none", "<na>", "nat"}
    return True


def _first_present(rows: list[dict[str, Any]], field: str) -> Any:
    for row in rows:
        value = row.get(field)
        if _is_present(value):
            return value
    return None


def aggregate_rows(rows: list[dict[str, Any]], instance: InstanceConfig) -> list[dict[str, Any]]:
    """按业务键聚合源行，再交给 state 去重与 webhook 写入。

    邮政表按业务键管理记录。源清单可能出现同一保单号+车架号的重复行。
    若直接逐源行同步，企微会出现重复记录。启用 aggregate_key 后：
    - 一组只产出一条记录；
    - 保费按组内所有源行求和；
    - 风险等级/自主系数等字段优先取指定险种（通常为商业保险）的非空值。
    """
    if not instance.aggregate_key:
        return rows

    grouped: dict[str, list[dict[str, Any]]] = {}
    for idx, row in enumerate(rows):
        key_parts = [_stable_value(row.get(field)) for field in instance.aggregate_key]
        if not any(key_parts):
            key = f"__missing__{idx}__{_stable_value(row.get('_primary_key'))}"
        else:
            key = "|".join(key_parts)
        grouped.setdefault(key, []).append(row)

    out: list[dict[str, Any]] = []
    for key, group in grouped.items():
        preferred = None
        if instance.prefer_insurance_type:
            preferred = next(
                (
                    row for row in group
                    if _stable_value(row.get("insurance_type")) == instance.prefer_insurance_type
                ),
                None,
            )
        base = dict(preferred or group[0])
        ordered = [base] + [row for row in group if row is not base]

        for field in (
            "org_level_3",
            "salesman_name",
            "policy_date",
            "plate_no",
            "insurance_grade",
            "commercial_pricing_factor",
            "insurance_start_date",
            "vehicle_model",
            "driver_age_group",
            "new_vehicle_price",
            "first_registration_date",
            "agent_name",
            "agent_short_name",
            "customer_category",
            "previous_insurer",
            "applicant_name",
            "commercial_ncd",
            "policy_no",
            "vehicle_frame_no",
            "vehicle_price_segment",
            "vehicle_age_group",
            "_primary_key",
        ):
            value = _first_present(ordered, field)
            if value is not None:
                base[field] = value

        base["premium"] = round(sum(_money(row.get("premium")) for row in group), 2)
        base["_aggregate_key"] = key
        base["_source_row_count"] = len(group)
        out.append(base)

    return sorted(
        out,
        key=lambda row: (
            _stable_value(row.get("policy_date")),
            "|".join(_stable_value(row.get(field)) for field in (instance.aggregate_key or ())),
        ),
        reverse=True,
    )


def salesman_stats(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = _to_text(row.get("salesman_name")) or "未填"
        item = grouped.setdefault(
            name,
            {
                "salesman_name": name,
                "raw_rows": 0,
                "policy_count": 0,
                "dedup_vin_count": 0,
                "premium_sum": 0.0,
                "_policies": set(),
                "_vins": set(),
            },
        )
        item["raw_rows"] += 1
        item["premium_sum"] += _money(row.get("premium"))
        policy_no = _to_text(row.get("policy_no"))
        vin = _to_text(row.get("vehicle_frame_no"))
        if policy_no:
            item["_policies"].add(policy_no)
        if vin:
            item["_vins"].add(vin)
    out: list[dict[str, Any]] = []
    for item in grouped.values():
        item["policy_count"] = len(item.pop("_policies"))
        item["dedup_vin_count"] = len(item.pop("_vins"))
        item["premium_sum"] = round(item["premium_sum"], 2)
        out.append(item)
    return sorted(out, key=lambda x: (-x["dedup_vin_count"], x["salesman_name"]))


def invalid_grade_stats(rows: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in rows:
        value = row.get("insurance_grade")
        text = _to_text(value)
        if text and text.lower() in {"nan", "none", "<na>", "nat"}:
            text = None
        if text not in {"A", "B", "C", "D", "E", "F"}:
            key = text or "空值"
            out[key] = out.get(key, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def _to_user(value: Any) -> list[dict[str, str]] | None:
    """USER（企微成员）字段：值须为企微 user_id（经花名册解析），空值不写入。

    机构级单表 + 行权限架构（2026-07-18 用户验证「按成员字段设行权限」可用）：
    业务员成员列由本格式写入，行权限规则"业务员=当前成员"实现每人只见自己的行。
    花名册缺失 user_id 时该列留空——行权限下留空行仅管理员可见（安全默认），
    补齐花名册后由 update 引擎回填。
    """
    text = _to_text(value)
    if not text:
        return None
    return [{"user_id": text}]


def format_value(field_type: str, value: Any) -> Any:
    if field_type == "DATE_TIME":
        return _to_ts_ms(value)
    if field_type == "SINGLE_SELECT":
        return _to_select(value)
    if field_type == "NUMBER":
        return _to_number(value)
    if field_type == "USER":
        return _to_user(value)
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
        if src_field == "insurance_grade" and str(raw_val).strip() not in {"A", "B", "C", "D", "E", "F"}:
            raw_val = None
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
    return _lib_load_state(state_path(instance))


def save_state(instance: InstanceConfig, state: dict[str, Any], *, backup_existing: bool = False) -> None:
    _lib_save_state(state_path(instance), state, backup_existing=backup_existing)


def persist_synced_keys(instance: InstanceConfig, state: dict[str, Any], newly_synced_keys: list[str]) -> None:
    """成功 batch 的键立即落盘，避免部分失败后重复 add（防线4）。state 写入经本模块 save_state seam。"""
    state["synced_keys"] = sorted(set(state.get("synced_keys", [])) | set(newly_synced_keys))
    state["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    state["key_strategy"] = key_strategy(instance)
    state["composite_fields"] = composite_fields(instance)
    save_state(instance, state)


def record_map_state_path(instance: InstanceConfig) -> Path | None:
    """update_sync 联动的 record map state 路径（实例未声明 update_sync 时为 None）。"""
    if not instance.record_map_state:
        return None
    rel = Path(instance.record_map_state)
    return rel if rel.is_absolute() else HERE / rel


def merge_record_map(state: dict[str, Any], harvested: list[tuple[str, str]]) -> dict[str, Any]:
    """把 (业务键, record_id) 合并进 record map state（追加去重；不动 payload_hash 等既有字段）。

    webhook 只能写不能读——add 响应是零授权拿 record_id 的唯一通道（通道铁律：
    永不依赖智能机器人「文档」授权）。响应 add_records 与发送同序，由调用方对齐后传入。
    """
    records = state.setdefault("records", {})
    now = datetime.now(timezone.utc).isoformat()
    for key, rid in harvested:
        if not key or not rid:
            continue
        entry = records.setdefault(str(key), {})
        ids = set(entry.get("record_ids") or [])
        ids.add(str(rid))
        entry["record_ids"] = sorted(ids)
        entry["captured_at"] = now
    return state


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
    """sync 前校验 state 口径，防止旧 primary_key state 被 composite_key 全量错配（委托共享库防线6）。"""
    _lib_validate_state_key_strategy(state, _keyspec(instance))


# _stable_value 由 lib.idempotent_smartsheet.stable_value 提供（见顶部 import 别名），不再本地实现。


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
    raw_rows = fetch_rows(instance)
    rows = aggregate_rows(raw_rows, instance)

    # 花名册解析（机构级单表成员列）：派生 salesman_user_id 供 USER 型映射
    roster_stats: dict[str, int] | None = None
    if instance.roster:
        roster_path = Path(instance.roster)
        roster_path = roster_path if roster_path.is_absolute() else HERE / roster_path
        roster_stats = enrich_rows_with_roster(rows, load_roster(roster_path))
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
        add_records.append({
            "values": values,
            # 同一复合键同时用于 add state 去重与 record map 捕获（评审 #1134-2：
            # 与更新引擎 row_business_key 同源同构，一保单多车架各记录各归各键）
            "_primary_key": _row_key(row, instance),
        })

    summary: dict[str, Any] = {
        "instance_name": instance.instance_name,
        "mode": mode,
        "filters": instance.filters,
        "source_rows": len(rows),
        "source_rows_before_aggregate": len(raw_rows),
        "rows_collapsed_by_aggregate": len(raw_rows) - len(rows),
        "aggregate_key": instance.aggregate_key,
        "state_synced_keys_before": len(synced),
        "skipped_already_synced": skipped,
        "add_records_planned": len(add_records),
        "new_dedup_vin_count": len({_to_text(r.get("vehicle_frame_no")) for r in new_rows if _to_text(r.get("vehicle_frame_no"))}),
        "new_premium_sum": round(sum(_money(r.get("premium")) for r in new_rows), 2),
        "salesman_stats": salesman_stats(rows),
        "new_salesman_stats": salesman_stats(new_rows),
        "invalid_grade_stats": invalid_grade_stats(rows),
        "new_invalid_grade_stats": invalid_grade_stats(new_rows),
        "dry_run": dry_run,
        "schema_field_ids": list(schema.keys()),
    }
    if roster_stats is not None:
        summary["roster_stats"] = roster_stats  # matched/missing：missing 行成员列留空（仅管理员可见）

    if dry_run:
        # 打印前 3 条 sample，便于肉眼检查。
        # 敏感字段（如投保人 applicant_name）脱敏后才进 stdout / logs 落盘（隐私红线）。
        sensitive_fids = sensitive_field_ids_of(instance)
        summary["sample_records"] = [
            {"values": mask_sample_values(r["values"], sensitive_fids)}
            for r in add_records[:3]
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

    # 注：空 state 护栏（lib.guard_state_not_empty）为库内可选防线，未在此默认启用——
    # 本脚本 daily.mjs 周期调用恒为 --mode sync，新实例首跑即 sync+空 state（合法），
    # 故不做硬拦截；需该防护的新表可在采用库时显式调用 guard_state_not_empty。
    webhook_url = os.environ.get(instance.webhook_env)
    if not webhook_url:
        raise RuntimeError(f"缺少环境变量 {instance.webhook_env}")

    # update_sync 联动：add 响应按序捕获 record_id → record map（webhook 写响应是
    # 零授权拿 record_id 的唯一通道；通道铁律见实例 YAML 头注释）。
    # 库按 add_records 原序切批、逐批调用 post_fn，故用游标对齐发送批与响应批。
    rm_path = record_map_state_path(instance)
    rm_state: dict[str, Any] = {}
    rm_cursor = 0
    rm_captured = 0
    if rm_path is not None and rm_path.exists():
        rm_state = json.loads(rm_path.read_text(encoding="utf-8"))

    # 幂等批量推送：成功才记账·按批落盘（防线4）+ 返回条数断言（防线5）。委托共享库。
    def _post(records: list[dict[str, Any]]) -> dict[str, Any]:
        # webhook payload 不带内部 _primary_key 标记，外加 schema 信封
        nonlocal rm_cursor, rm_captured
        resp = post_webhook(webhook_url, {"schema": schema, "add_records": records})
        returned = resp.get("add_records")
        batch_src = add_records[rm_cursor:rm_cursor + len(records)]
        rm_cursor += len(records)
        if (
            rm_path is not None
            and resp.get("errcode") == 0
            and isinstance(returned, list)
            and len(returned) == len(records)
        ):
            harvested = []
            for src, ret in zip(batch_src, returned):
                rid = ret.get("record_id") or ret.get("id")
                if rid and src.get("_primary_key"):
                    harvested.append((src["_primary_key"], str(rid)))
            if harvested:
                merge_record_map(rm_state, harvested)
                rm_path.parent.mkdir(parents=True, exist_ok=True)
                rm_path.write_text(
                    json.dumps(rm_state, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                rm_captured += len(harvested)
        return resp

    push_summary = _lib_push_add_records_idempotent(
        add_records,
        post_fn=_post,
        persist_fn=lambda keys: persist_synced_keys(instance, state, keys),
        batch_size=instance.batch_size,
        key_field="_primary_key",
        rpm=instance.sheet_rpm,
    )
    summary["batches"] = push_summary["batches"]
    if rm_path is not None:
        summary["record_map_state"] = str(rm_path)
        summary["record_map_captured"] = rm_captured
        summary["record_map_keys_after"] = len(rm_state.get("records") or {})
    summary["state_synced_keys_after"] = len(state.get("synced_keys") or [])
    summary["newly_synced_count"] = push_summary["newly_synced_count"]
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
    raw_rows = fetch_rows(instance)
    rows = aggregate_rows(raw_rows, instance)
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
        "source_rows_before_aggregate": len(raw_rows),
        "rows_collapsed_by_aggregate": len(raw_rows) - len(rows),
        "aggregate_key": instance.aggregate_key,
        "previous_keys": len(previous_keys),
        "unique_keys_after": len(keys),
        "duplicates_collapsed": len(rows) - len(keys),
        "missing_primary_keys": missing_primary_keys[:20],
        "missing_primary_key_count": len(missing_primary_keys),
        "completed_at": state["last_sync_at"],
    }


def _add_safety_flag(p: argparse.ArgumentParser) -> None:
    """共享：所有 wecom 写入脚本都接 --i-checked-wecom-rows 闸覆盖开关。"""
    p.add_argument(
        "--i-checked-wecom-rows",
        action="store_true",
        dest="i_checked_wecom_rows",
        help=(
            "RED LINE 闸覆盖开关：state 失真 / 全 add 等危险信号触发时，默认拒绝执行。"
            "仅在你已亲自去企微表点查当前行数，与 preflight banner 的 state.records_count "
            "或 0 吻合时，才能加此开关放行。详见 [[project_wecom_org_renewal_first_real_run_dup]]。"
        ),
    )


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
    _add_safety_flag(p)
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

    # RED LINE preflight：真写入前永远先跑 dry-run 拿 plan，打 banner + 跑 gate；
    # 通过且非 --dry-run 才真写入。dry-run 不调 webhook。
    from _safety import (  # 局部 import 避免循环
        evaluate_gate,
        print_preflight_banner,
        must_check_wecom_rows_hint,
    )

    summaries: list[dict[str, Any]] = []
    for instance in instances:
        if args.dry_run:
            summaries.append(run(instance, mode=args.mode, dry_run=True))
            continue
        plan = run(instance, mode=args.mode, dry_run=True)
        gate = print_preflight_banner(
            label=f"{instance.instance_name}（postal add-only）",
            state_count=plan.get("state_synced_keys_before") or 0,
            source_rows=plan.get("source_rows") or 0,
            to_add=plan.get("add_records_planned") or 0,
            to_update=0,  # postal 是 add-only 模式，无 update 概念
        )
        if not gate.ok and not args.i_checked_wecom_rows:
            raise RuntimeError(
                gate.message
                + must_check_wecom_rows_hint(
                    instance.instance_name, plan.get("state_synced_keys_before") or 0
                )
            )
        summaries.append(run(instance, mode=args.mode, dry_run=False))
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
