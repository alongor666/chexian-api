"""企业微信智能表格续保追踪同步引擎 v2（配置驱动）

## 设计目标
- **配置驱动**：业务口径（起期/止期/省份/批次拆分/字段启用）全部在 YAML，引擎本体不改。
- **可扩展**：明年只需复制 instance YAML 改两行；扩省/扩字段亦然。
- **可观测**：summary 含未匹配业务员清单、商业险重复投保 VIN 清单、批次失败明细。
- **健壮**：SSL 重试、企业微信 transient errcode 重试、update 失败降级、每 batch flush state。

## 配置文件
- ``field_registry.yaml``：字段注册表（field_id ⇄ source 表达式 ⇄ 类型转换）
- ``instances/<name>.yaml``：实例配置（filter/webhook/拆批策略/启用字段列表）

## 命令行
```
python3 sync_renewal_v2.py --instance instances/sichuan_2025_h1.yaml [--dry-run] [--batch-size 100]
```
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import sys
import time as time_mod
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from pathlib import Path
from time import sleep as time_module_sleep
from typing import Any, Callable, Iterable

import duckdb
import pandas as pd
import yaml

HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parents[1]
sys.path.insert(0, str(DATA_ROOT))  # 供 import pipelines.*（省份隔离断言 SSOT）
from pipelines.branch_assert import (  # noqa: E402
    assert_single_branch,
    get_branch_mapping,
    is_national_view,
)
from pipelines.branch_paths import policy_current_glob  # noqa: E402

# 双布局自适应（branch_paths SSOT · 801409 cutover 前置）：扁平→current/*.parquet（现状）、
# 子目录→current/[A-Z][A-Z]/*.parquet；省份隔离仍由下方 SQL 的 WHERE branch_code=? 承担。
DEFAULT_POLICY_GLOB = policy_current_glob(
    DATA_ROOT / "warehouse" / "fact" / "policy" / "current", missing_ok=True
)
DEFAULT_QUOTES_PATH = DATA_ROOT / "warehouse" / "fact" / "quotes_conversion" / "latest.parquet"
DEFAULT_SALESMAN_PATH = DATA_ROOT / "warehouse" / "dim" / "salesman" / "latest.parquet"
DEFAULT_CUSTOMER_FLOW_PATH = DATA_ROOT / "warehouse" / "fact" / "customer_flow" / "latest.parquet"

TRANSIENT_WECOM_ERRCODES = {-1, 45009, 2040035, 2040039}


# ---------- 配置加载 ----------

@dataclass(frozen=True)
class FieldDef:
    key: str
    field_id: str
    label: str
    source: str
    type: str
    fallback: Any = None
    default: Any = None
    condition: str | None = None
    skip_when_null: bool = False
    alert_on_fallback: bool = False


def load_field_registry(path: Path) -> dict[str, FieldDef]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    out: dict[str, FieldDef] = {}
    for key, spec in (raw.get("fields") or {}).items():
        out[key] = FieldDef(
            key=key,
            field_id=spec["field_id"],
            label=spec["label"],
            source=spec["source"],
            type=spec["type"],
            fallback=spec.get("fallback"),
            default=spec.get("default"),
            condition=spec.get("condition"),
            skip_when_null=spec.get("skip_when_null", False),
            alert_on_fallback=spec.get("alert_on_fallback", False),
        )
    return out


@dataclass(frozen=True)
class InstanceConfig:
    instance_name: str
    webhook_env: str
    batch_size: int
    sheet_rpm: int
    doc_rpm: int
    rate_limit_sleep: int
    filters: dict[str, Any]
    quote_window_start: str
    exclusive_vin_strategy: str | None
    exclusive_lower_bound: str | None
    fields_enabled: list[str]
    branch_code: str  # 省份隔离键（SC/SX）；必填，注入所有 policy 读的 WHERE branch_code（RED LINE data-pipeline.md）
    field_registry_path: str | None = None  # 可选：覆盖默认 field_registry.yaml（机构表用 field_registry_orgsheet.yaml）


def _resolve_branch_code(raw: dict[str, Any], instance_name: str) -> str:
    """解析并校验实例省份隔离键（fail-closed）。

    缺省 / 非已注册省份 → 立即 RuntimeError 中止，禁止静默回落 'SC'
    （data-pipeline.md RED LINE「fail-closed」+ CLAUDE.md 禁硬编码单省）。
    已注册省份集取自 branch_assert.get_branch_mapping() 的值域（SSOT = fields.json），
    新省份上线只改 fields.json 一处，本引擎自动跟随。
    """
    branch_code = raw.get("branch_code")
    registered = sorted(set(get_branch_mapping().values()))
    if not branch_code:
        raise RuntimeError(
            f"实例 '{instance_name}' 缺少必填字段 branch_code（省份隔离键）。"
            f"裸读混省 current/ 会把他省保单推进本省企微表 — fail-closed 中止。"
            f"请在实例 YAML 顶层声明 branch_code: <{'/'.join(registered)}>"
        )
    if branch_code not in registered:
        raise RuntimeError(
            f"实例 '{instance_name}' branch_code='{branch_code}' 非已注册省份 {registered}。"
            f"若为新省份上线，须先同步 server/src/config/field-registry/fields.json "
            f"branch_code.derivation.mapping — fail-closed 中止。"
        )
    return branch_code


def load_instance(path: Path) -> InstanceConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    filters = raw["filters"]
    return InstanceConfig(
        instance_name=raw["instance_name"],
        webhook_env=raw["webhook_env"],
        batch_size=raw.get("batch_size", 100),
        sheet_rpm=raw.get("sheet_records_per_minute_limit", 3000),
        doc_rpm=raw.get("doc_records_per_minute_limit", 10000),
        rate_limit_sleep=raw.get("rate_limit_sleep_seconds", 60),
        filters=filters,
        quote_window_start=raw["quote_window_start"],
        exclusive_vin_strategy=raw.get("exclusive_vin_strategy"),
        exclusive_lower_bound=raw.get("exclusive_lower_bound"),
        fields_enabled=raw["fields_enabled"],
        branch_code=_resolve_branch_code(raw, raw["instance_name"]),
        field_registry_path=raw.get("field_registry_path"),
    )


# ---------- SQL 构造与执行 ----------

def build_source_rows(instance: InstanceConfig) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """按 instance 配置拼 SQL 拉取 source 行；返回 (rows, audit) 二元组。

    audit 含：
      - duplicate_commercial_vins: 同一 VIN 在该批起期内的多张原单 → 商业险重复投保候选
      - cross_batch_excluded_vins: 因 exclusive_vin_strategy 被剔除的 VIN（仅 H2 等非首批批次有意义）
    """
    f = instance.filters
    start_from = f["insurance_start_date_from"]
    start_to = f["insurance_start_date_to"]
    insurance_type = f.get("insurance_type", "商业保险")
    premium_gt = f.get("premium_gt", 0)
    exclude_endorsement = f.get("exclude_endorsement", True)
    organization_in: list[str] | None = f.get("organization_in")

    # 省份隔离（RED LINE data-pipeline.md）：current/ 物理混放 SC+SX，4 处 policy 读统一
    # 注入参数化 WHERE branch_code，杜绝山西保单混进四川企微表。branch_code 已在 load_instance
    # fail-closed 校验过（∈ 已注册省份集）。非 policy 源（quotes/salesman/customer_flow）经实证
    # 当前纯 SC（有 branch_code 列但暂无 SX 数据），base 单省后按 vehicle_frame_no/full_name
    # LEFT JOIN 天然收敛行级省份（policy_no 恒 SC，出口断言无感），本阶段不另注入。
    # follow-up：当三源落入 SX 数据时，VIN 碰撞可致 SX 报价属性匹配到 SC 行（属性级污染，
    # 行级不泄漏），届时对 q_latest/q_earliest/flow 也加 branch_code（已有列，单行追加）。
    branch_code = instance.branch_code
    branch_clause = "AND branch_code = ?"

    con = duckdb.connect(":memory:")
    as_of_date = date.today().isoformat()

    endorsement_sql = (
        "AND (endorsement_no IS NULL OR TRIM(CAST(endorsement_no AS VARCHAR)) = '')"
        if exclude_endorsement else ""
    )
    org_filter_sql = ""
    org_param: list[Any] = []
    if organization_in:
        placeholders = ",".join(["?"] * len(organization_in))
        org_filter_sql = f"AND org_level_3 IN ({placeholders})"
        org_param = list(organization_in)

    # ---- 1) 商业险重复投保审计（同一 VIN 多张原单）----
    audit_sql = f"""
    WITH single AS (
      SELECT vehicle_frame_no, policy_no, SUM(premium) AS prem
      FROM read_parquet('{DEFAULT_POLICY_GLOB}', union_by_name=true)
      WHERE insurance_type = ?
        {branch_clause}
        AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
        AND CAST(insurance_start_date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        {endorsement_sql}
        {org_filter_sql}
      GROUP BY vehicle_frame_no, policy_no
      HAVING SUM(premium) > ?
    )
    SELECT vehicle_frame_no, COUNT(DISTINCT policy_no) AS pol_cnt
    FROM single
    GROUP BY vehicle_frame_no
    HAVING COUNT(DISTINCT policy_no) > 1
    """
    audit_params = [insurance_type, branch_code, start_from, start_to, *org_param, premium_gt]
    duplicate_rows = con.execute(audit_sql, audit_params).fetchall()
    duplicate_vins = [(r[0], r[1]) for r in duplicate_rows]

    # ---- 2) 跨实例排他（earliest_start_first）：仅 H2 等非首批 instance 触发，剔除已落入更早批次的 VIN ----
    cross_batch_excluded: list[str] = []
    cross_filter_sql = ""
    cross_params: list[Any] = []
    if instance.exclusive_vin_strategy == "earliest_start_first":
        # 跨批排他：剔除起期落在 [exclusive_lower_bound, start_from) 区间的更早批次 VIN
        # 下界优先级：实例显式 exclusive_lower_bound > 实例 start_from（仅当下界 < start_from 时启用）
        # 默认 = start_from，意味着不启用历史排他（仅靠后续批次自身窗口去重）
        lower_bound = instance.exclusive_lower_bound or start_from
        excl_sql = f"""
        SELECT DISTINCT vehicle_frame_no FROM (
          SELECT vehicle_frame_no, SUM(premium) AS prem
          FROM read_parquet('{DEFAULT_POLICY_GLOB}', union_by_name=true)
          WHERE insurance_type = ?
            {branch_clause}
            AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
            AND CAST(insurance_start_date AS DATE) < CAST(? AS DATE)
            AND CAST(insurance_start_date AS DATE) >= CAST(? AS DATE)
            {endorsement_sql}
            {org_filter_sql}
          GROUP BY policy_no, vehicle_frame_no
          HAVING SUM(premium) > ?
        )
        """
        excl_rows = con.execute(excl_sql, [insurance_type, branch_code, start_from, lower_bound, *org_param, premium_gt]).fetchall()
        cross_batch_excluded = [r[0] for r in excl_rows if r[0]]
        if cross_batch_excluded:
            placeholders = ",".join(["?"] * len(cross_batch_excluded))
            cross_filter_sql = f"AND vehicle_frame_no NOT IN ({placeholders})"
            cross_params = list(cross_batch_excluded)

    # ---- 3) 主查询 ----
    main_sql = f"""
    WITH policy_in_window AS (
      SELECT
        policy_no, vehicle_frame_no,
        SUM(premium) AS premium,
        MAX(CAST(insurance_end_date AS DATE)) AS insurance_end_date,
        ANY_VALUE(salesman_name) AS salesman_name,
        ANY_VALUE(plate_no) AS plate_no,
        ANY_VALUE(is_nev) AS is_nev,
        ANY_VALUE(customer_category) AS customer_category,
        ANY_VALUE(coverage_combination) AS coverage_combination,
        ANY_VALUE(commercial_pricing_factor) AS commercial_pricing_factor
      FROM read_parquet('{DEFAULT_POLICY_GLOB}', union_by_name=true)
      WHERE insurance_type = ?
        {branch_clause}
        AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
        AND CAST(insurance_start_date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        {endorsement_sql}
        {org_filter_sql}
        {cross_filter_sql}
      GROUP BY policy_no, vehicle_frame_no
      HAVING SUM(premium) > ?
    ),
    base AS (
      SELECT * EXCLUDE rn FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY vehicle_frame_no
          ORDER BY insurance_end_date DESC NULLS LAST, policy_no DESC
        ) AS rn
        FROM policy_in_window
      ) WHERE rn = 1
    ),
    salesman_dim AS (
      SELECT full_name,
             NULLIF(NULLIF(team, 'nan'), '') AS team,
             NULLIF(NULLIF(organization, 'nan'), '') AS organization
      FROM read_parquet('{DEFAULT_SALESMAN_PATH}')
    ),
    q_latest AS (
      SELECT * EXCLUDE rn FROM (
        SELECT vehicle_frame_no, quote_time,
               commercial_pricing_factor AS quote_pricing_factor,
               final_quote_premium AS quote_premium,
               insurance_grade AS insurance_grade,
               team AS quote_team,
               ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC NULLS LAST) rn
        FROM read_parquet('{DEFAULT_QUOTES_PATH}')
        WHERE insurance_type = ?
          AND CAST(quote_time AS DATE) >= CAST(? AS DATE)
          AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
      ) WHERE rn = 1
    ),
    q_earliest AS (
      SELECT vehicle_frame_no, MIN(CAST(quote_time AS DATE)) AS earliest_quote_date
      FROM read_parquet('{DEFAULT_QUOTES_PATH}')
      WHERE insurance_type = ?
        AND CAST(quote_time AS DATE) >= CAST(? AS DATE)
        AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
      GROUP BY vehicle_frame_no
    ),
    renewed AS (
      SELECT * EXCLUDE rn FROM (
        SELECT
          renewal_policy_no AS source_policy_no,
          vehicle_frame_no,
          policy_no AS renewed_policy_no,
          CAST(policy_date AS DATE) AS renewed_sign_date,
          ROW_NUMBER() OVER (
            PARTITION BY renewal_policy_no, vehicle_frame_no
            ORDER BY policy_date DESC NULLS LAST, policy_no DESC
          ) AS rn
        FROM read_parquet('{DEFAULT_POLICY_GLOB}', union_by_name=true)
        WHERE insurance_type = ?
          {branch_clause}
          AND is_renewal = true
          AND renewal_policy_no IS NOT NULL AND renewal_policy_no != ''
          AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
          AND CAST(insurance_start_date AS DATE) >= DATE '2026-01-01'
          AND (endorsement_no IS NULL OR TRIM(CAST(endorsement_no AS VARCHAR)) = '')
      ) WHERE rn = 1
    ),
    flow AS (
      -- 客户来源去向：next_insurer 即"流失公司"。当前源按 vehicle_frame_no 匹配次年保险公司。
      SELECT vehicle_frame_no,
             ANY_VALUE(NULLIF(NULLIF(next_insurer, ''), 'NaN')) FILTER (
               WHERE next_insurer IS NOT NULL AND next_insurer != ''
             ) AS next_insurer
      FROM read_parquet('{DEFAULT_CUSTOMER_FLOW_PATH}')
      WHERE vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
      GROUP BY vehicle_frame_no
    )
    SELECT
      b.policy_no,
      CAST(b.insurance_end_date AS DATE) AS insurance_end_date,
      b.premium AS premium,
      b.commercial_pricing_factor AS commercial_pricing_factor,
      COALESCE(s.organization, '未知机构') AS organization,
      COALESCE(s.team, '未知团队') AS team,
      CASE WHEN s.full_name IS NULL THEN true ELSE false END AS salesman_unmatched,
      COALESCE(b.plate_no, '') AS plate_no,
      CASE WHEN b.is_nev THEN '新能源' ELSE '燃油' END AS energy_type,
      b.vehicle_frame_no AS vehicle_frame_no,
      COALESCE(b.salesman_name, '') AS salesman_name,
      COALESCE(b.customer_category, '') AS customer_category,
      COALESCE(b.coverage_combination, '') AS coverage_combination,
      q.quote_pricing_factor AS quote_pricing_factor,
      q.quote_premium AS quote_premium,
      q.quote_time AS quote_time,
      q.insurance_grade AS insurance_grade,
      qe.earliest_quote_date AS earliest_quote_date,
      r.renewed_policy_no AS renewed_policy_no,
      r.renewed_sign_date AS renewed_sign_date,
      COALESCE(f.next_insurer, '') AS next_insurer,
      CASE WHEN q.quote_time IS NOT NULL THEN true ELSE false END AS is_quoted,
      CASE WHEN r.renewed_policy_no IS NOT NULL THEN true ELSE false END AS is_renewed,
      '未分类' AS renewal_mode
    FROM base b
    LEFT JOIN salesman_dim s ON s.full_name = b.salesman_name
    LEFT JOIN q_latest q ON q.vehicle_frame_no = b.vehicle_frame_no
    LEFT JOIN q_earliest qe ON qe.vehicle_frame_no = b.vehicle_frame_no
    LEFT JOIN renewed r ON r.source_policy_no = b.policy_no AND r.vehicle_frame_no = b.vehicle_frame_no
    LEFT JOIN flow f ON f.vehicle_frame_no = b.vehicle_frame_no
    """
    main_params = [
        insurance_type, branch_code, start_from, start_to,  # policy_in_window（+branch_code）
        *org_param,
        *cross_params,
        premium_gt,
        insurance_type, instance.quote_window_start,   # q_latest（quotes 当前纯 SC，LEFT JOIN 收敛，不注入）
        insurance_type, instance.quote_window_start,   # q_earliest（同上）
        insurance_type, branch_code,                    # renewed（+branch_code）
    ]
    main_df = con.execute(main_sql, main_params).fetchdf()
    # 防线④ 出口零信任断言（与 sync_filtered_policies 同款）：从 base.policy_no[:3] 派生省份，
    # DISTINCT branch_code > 1（跨省混入）即 fail-closed 中止。WHERE branch_code 是主防线，
    # 本断言是「即便漏了也混不出去」的兜底。allow_national 仅显式 PROVINCE=ALL 时放行。
    assert_single_branch(
        main_df,
        allow_national=is_national_view(),
        context=f"续保引擎企微出口 {instance.instance_name}",
    )
    rows = main_df.to_dict("records")
    rows = [r for r in rows if r.get("vehicle_frame_no")]
    as_of = date.fromisoformat(as_of_date)
    for row in rows:
        row["customer_status"] = format_customer_status(row, as_of)

    # VIN 唯一性强制
    seen: set[str] = set()
    duplicates: list[str] = []
    for r in rows:
        vin = str(r.get("vehicle_frame_no") or "")
        if vin in seen:
            duplicates.append(vin)
        seen.add(vin)
    if duplicates:
        raise ValueError(f"VIN 不唯一，停止: {duplicates[:5]}")

    audit = {
        "duplicate_commercial_vin_count": len(duplicate_vins),
        "duplicate_commercial_vins": [{"vin": v[0], "policy_count": v[1]} for v in duplicate_vins[:50]],
        "cross_batch_excluded_count": len(cross_batch_excluded),
        "cross_batch_excluded_sample": cross_batch_excluded[:20],
    }
    return rows, audit


# ---------- 字段渲染 ----------

def date_to_epoch_ms(value: Any) -> str:
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        value = value.date()
    dt = datetime.combine(value, time.min, tzinfo=timezone.utc)
    return str(int(dt.timestamp() * 1000))


def text_value(v: Any) -> str:
    if v is None or pd.isna(v):
        return ""
    return str(v)


def clean_num(v: Any) -> float | None:
    if v is None or pd.isna(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def format_pct(value: float) -> str:
    rounded = round(value, 1)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.1f}"


def as_date(value: Any) -> date | None:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def format_customer_status(row: dict[str, Any], as_of: date | None = None) -> str:
    expiry_date = as_date(row.get("insurance_end_date"))
    as_of = as_of or date.today()
    days_to_expiry = (expiry_date - as_of).days if expiry_date is not None else None
    is_expired = days_to_expiry is not None and days_to_expiry < 0
    in_quote_period = is_expired or (days_to_expiry is not None and 0 <= days_to_expiry <= 30)

    prior_premium = clean_num(row.get("premium"))
    quote_premium = clean_num(row.get("quote_premium"))
    renewal_status = "已续回" if row.get("is_renewed") else "未续回"

    if not in_quote_period:
        middle_status = "未到报价期"
    elif not row.get("is_quoted"):
        middle_status = "未报价"
    elif prior_premium is None or prior_premium == 0 or quote_premium is None:
        middle_status = "涨价未知"
    elif quote_premium > prior_premium:
        increase_pct = (quote_premium - prior_premium) / prior_premium * 100
        middle_status = f"涨价{format_pct(increase_pct)}%"
    else:
        middle_status = "未涨价"

    if row.get("is_renewed"):
        return f"{middle_status}、{renewal_status}" if middle_status != "未报价" else renewal_status

    if is_expired:
        expiry_status = "已过期"
    elif days_to_expiry is not None and 0 <= days_to_expiry <= 30:
        expiry_status = f"{days_to_expiry}天后到期"
    else:
        return middle_status
    return f"{expiry_status}、{middle_status}、{renewal_status}"


def resolve_source(row: dict[str, Any], source_expr: str) -> Any:
    """source 表达式 cte.col → 取 row 中 'col' 列；'derived.x' 与具体 cte 列名都汇总到同一行 dict。

    SELECT 中已把所有 CTE 列扁平输出为 row keys，因此直接按列名取值即可。
    """
    _, col = source_expr.split(".", 1)
    return row.get(col)


def build_record(row: dict[str, Any], fields: Iterable[FieldDef], unmatched_set: set[str] | None = None) -> dict[str, dict[str, Any]]:
    values: dict[str, Any] = {}
    for fd in fields:
        # 条件字段（如 renewed_sign_date 仅 is_renewed=true 时写入）
        if fd.condition:
            cond_key = fd.condition
            if not bool(row.get(cond_key)):
                continue

        raw = resolve_source(row, fd.source)
        if fd.skip_when_null and (raw is None or pd.isna(raw) or str(raw).strip() == ""):
            continue

        if fd.type == "epoch_ms_date":
            if raw is None or pd.isna(raw):
                continue
            try:
                values[fd.field_id] = date_to_epoch_ms(raw)
            except (TypeError, ValueError):
                continue

        elif fd.type == "text":
            v = text_value(raw)
            if not v and fd.fallback is not None:
                v = str(fd.fallback)
            values[fd.field_id] = v

        elif fd.type == "select_text":
            v = text_value(raw)
            if not v:
                if fd.default is not None:
                    v = str(fd.default)
                elif fd.fallback is not None:
                    v = str(fd.fallback)
            values[fd.field_id] = [{"text": v}]

        elif fd.type == "select_yes_no":
            values[fd.field_id] = [{"text": "是" if bool(raw) else "否"}]

        elif fd.type == "text_yes_no":
            # bool source → text "是"/"否"（机构表 select 字段被改为 text 类型）
            values[fd.field_id] = "是" if bool(raw) else "否"

        elif fd.type == "bool":
            values[fd.field_id] = bool(raw)

        elif fd.type == "number":
            num = clean_num(raw)
            if num is None and fd.skip_when_null:
                continue
            values[fd.field_id] = num if num is not None else 0

        else:
            raise ValueError(f"未知字段类型: {fd.type} ({fd.key})")

        # 触发未匹配业务员告警
        if fd.alert_on_fallback and (raw is None or pd.isna(raw) or str(raw) == ""):
            if unmatched_set is not None and row.get("salesman_unmatched"):
                unmatched_set.add(text_value(row.get("salesman_name")))

    return {"values": values}


def build_schema(fields: Iterable[FieldDef]) -> dict[str, str]:
    return {fd.field_id: fd.label for fd in fields}


def payload_hash(record: dict[str, Any]) -> str:
    payload = json.dumps(
        record.get("values", {}),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------- Webhook ----------

def post_webhook(url: str, payload: dict[str, Any], timeout: int = 60, max_retries: int = 5) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    last_exc: Exception | None = None
    last_resp: dict[str, Any] | None = None
    for attempt in range(max_retries):
        req = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload_resp = json.loads(resp.read().decode("utf-8", errors="replace"))
                ec = payload_resp.get("errcode")
                if ec in TRANSIENT_WECOM_ERRCODES and attempt < max_retries - 1:
                    last_resp = payload_resp
                    sleep_s = 2 ** attempt
                    print(f"WARN: webhook errcode={ec}（transient）{sleep_s}s 后重试({attempt+1}/{max_retries}): {payload_resp.get('errmsg','')[:120]}", file=sys.stderr)
                    time_module_sleep(sleep_s)
                    continue
                return payload_resp
        except urllib.error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < max_retries - 1:
                last_exc = exc
                sleep_s = 2 ** attempt
                print(f"WARN: webhook HTTP {exc.code}，{sleep_s}s 后重试({attempt+1}/{max_retries})", file=sys.stderr)
                time_module_sleep(sleep_s)
                continue
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"企业微信 webhook HTTP {exc.code}: {body}") from exc
        except (urllib.error.URLError, socket.timeout, TimeoutError) as exc:
            last_exc = exc
            if attempt < max_retries - 1:
                sleep_s = 2 ** attempt
                print(f"WARN: webhook 网络抖动 {exc}，{sleep_s}s 后重试({attempt+1}/{max_retries})", file=sys.stderr)
                time_module_sleep(sleep_s)
                continue
            raise RuntimeError(f"企业微信 webhook 网络重试 {max_retries} 次失败: {exc}") from exc
    if last_resp is not None:
        return last_resp
    raise RuntimeError(f"企业微信 webhook 重试耗尽: {last_exc}")


# ---------- State / 限流 / 批次 ----------

def resolve_state_path(instance: InstanceConfig) -> Path:
    return HERE / "state" / f"{instance.instance_name}_vin_record_map.json"


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"summary": {}, "records": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass
class UpsertPlan:
    add_items: list[dict[str, Any]]
    update_items: list[dict[str, Any]]
    missing_vins: list[str]


def money_sum(rows: Iterable[dict[str, Any]], field: str = "premium") -> float:
    total = 0.0
    for row in rows:
        value = clean_num(row.get(field))
        if value is not None:
            total += value
    return round(total, 2)


def renewal_rate(renewed: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(renewed / total, 4)


def rows_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    renewed = sum(1 for row in rows if row.get("is_renewed"))
    return {
        "rows": len(rows),
        "premium_sum": money_sum(rows),
        "renewed_count": renewed,
        "renewal_rate": renewal_rate(renewed, len(rows)),
    }


def plan_metrics(plan: UpsertPlan) -> dict[str, Any]:
    add_rows = [item["source_row"] for item in plan.add_items]
    update_rows = [item["_source_row"] for item in plan.update_items]
    changed_rows = add_rows + update_rows
    return {
        "add": rows_metrics(add_rows),
        "update": rows_metrics(update_rows),
        "changed": rows_metrics(changed_rows),
    }


def plan_upsert(rows: list[dict[str, Any]], state: dict[str, Any], schema: dict[str, str], fields: list[FieldDef], unmatched_set: set[str]) -> UpsertPlan:
    mapped = state.get("records", {})
    current_vins = {str(r.get("vehicle_frame_no")) for r in rows}
    add_items: list[dict[str, Any]] = []
    update_items: list[dict[str, Any]] = []
    for row in rows:
        vin = str(row.get("vehicle_frame_no"))
        rec = build_record(row, fields, unmatched_set=unmatched_set)
        existing = mapped.get(vin, {})
        record_id = existing.get("record_id")
        if record_id:
            rec_hash = payload_hash(rec)
            if existing.get("payload_hash") == rec_hash:
                continue
            item = dict(rec)
            item["record_id"] = record_id
            item["_vin"] = vin
            item["_payload_hash"] = rec_hash
            item["_source_row"] = row
            update_items.append(item)
        else:
            add_items.append({"source_row": row, "record": rec})
    missing_vins = sorted(set(mapped) - current_vins)
    return UpsertPlan(add_items=add_items, update_items=update_items, missing_vins=missing_vins)


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def update_state_record(state: dict[str, Any], vin: str, src: dict[str, Any], record_id: str, record_hash: str) -> None:
    state.setdefault("records", {})
    state["records"][vin] = {
        "record_id": record_id,
        "policy_no": text_value(src.get("policy_no")),
        "expiry_date": text_value(src.get("expiry_date")),
        "salesman_name": text_value(src.get("salesman_name")),
        "payload_hash": record_hash,
    }


def apply_add_response(state: dict[str, Any], add_items: list[dict[str, Any]], response: dict[str, Any]) -> None:
    if response.get("errcode") != 0:
        raise RuntimeError(f"企业微信新增失败: {response}")
    added = response.get("add_records", [])
    if len(added) != len(add_items):
        raise RuntimeError(f"新增返回数量不一致: sent={len(add_items)} returned={len(added)}")
    for item, ret in zip(add_items, added):
        src = item["source_row"]
        rec = item["record"]
        vin = str(src.get("vehicle_frame_no"))
        update_state_record(state, vin, src, ret["record_id"], payload_hash(rec))


def apply_update_response(response: dict[str, Any]) -> None:
    if response.get("errcode") != 0:
        raise RuntimeError(f"企业微信更新失败: {response}")


# ---------- 主流程 ----------

def run_sync(instance: InstanceConfig, fields: list[FieldDef], dry_run: bool = False) -> dict[str, Any]:
    rows, audit = build_source_rows(instance)
    state_path = resolve_state_path(instance)
    state = load_state(state_path)
    schema = build_schema(fields)
    unmatched_salesmen: set[str] = set()
    plan = plan_upsert(rows, state, schema, fields, unmatched_salesmen)
    sync_metrics = plan_metrics(plan)
    overall_metrics = rows_metrics(rows)

    summary: dict[str, Any] = {
        "dry_run": dry_run,
        "instance_name": instance.instance_name,
        "filters": instance.filters,
        "source_rows": len(rows),
        "to_add": len(plan.add_items),
        "to_update": len(plan.update_items),
        "missing_vins_count": len(plan.missing_vins),
        "missing_vins_sample": plan.missing_vins[:20],
        "premium_sum": overall_metrics["premium_sum"],
        "renewal_rate": overall_metrics["renewal_rate"],
        "add_premium_sum": sync_metrics["add"]["premium_sum"],
        "add_renewed_count": sync_metrics["add"]["renewed_count"],
        "add_renewal_rate": sync_metrics["add"]["renewal_rate"],
        "update_premium_sum": sync_metrics["update"]["premium_sum"],
        "update_renewed_count": sync_metrics["update"]["renewed_count"],
        "update_renewal_rate": sync_metrics["update"]["renewal_rate"],
        "changed_rows": sync_metrics["changed"]["rows"],
        "changed_premium_sum": sync_metrics["changed"]["premium_sum"],
        "changed_renewed_count": sync_metrics["changed"]["renewed_count"],
        "changed_renewal_rate": sync_metrics["changed"]["renewal_rate"],
        "quoted_count": sum(1 for r in rows if r.get("is_quoted")),
        "renewed_count": sum(1 for r in rows if r.get("is_renewed")),
        "unmatched_salesmen_count": len({r.get("salesman_name") for r in rows if r.get("salesman_unmatched")}),
        "unmatched_salesmen_sample": sorted({r.get("salesman_name") for r in rows if r.get("salesman_unmatched")})[:20],
        "duplicate_commercial_vin_count": audit["duplicate_commercial_vin_count"],
        "duplicate_commercial_vins_sample": audit["duplicate_commercial_vins"][:20],
        "cross_batch_excluded_count": audit["cross_batch_excluded_count"],
        "rate_limit": {
            "sheet_records_per_minute_limit": instance.sheet_rpm,
            "doc_records_per_minute_limit": instance.doc_rpm,
            "sleep_seconds_between_windows": instance.rate_limit_sleep,
        },
        "fields_enabled_count": len(fields),
        "schema_field_ids": [fd.field_id for fd in fields],
    }
    if dry_run:
        summary["state_path"] = str(state_path)
        log_path = write_log(instance, summary)
        summary["log_path"] = str(log_path)
        return summary

    webhook_url = os.environ.get(instance.webhook_env)
    if not webhook_url:
        raise RuntimeError(f"缺少环境变量 {instance.webhook_env}")

    summary["batches"] = []
    update_failures: list[dict[str, Any]] = []

    # update 优先：先修正 state 中已有 record（如修复字段错误），再 add 新增
    # 失败降级：单 batch 失败不阻塞后续 add
    for chunk in chunked(plan.update_items, instance.batch_size):
        update_payload = [{"record_id": it["record_id"], "values": it["values"]} for it in chunk]
        try:
            resp = post_webhook(webhook_url, {"schema": schema, "update_records": update_payload})
            apply_update_response(resp)
            for it in chunk:
                update_state_record(
                    state,
                    it["_vin"],
                    it["_source_row"],
                    it["record_id"],
                    it["_payload_hash"],
                )
            save_state(state_path, state)
            summary["batches"].append({"op": "update", "sent": len(chunk), "errcode": resp.get("errcode")})
        except RuntimeError as exc:
            update_failures.append({"sent": len(chunk), "error": str(exc)[:200]})
            summary["batches"].append({"op": "update", "sent": len(chunk), "errcode": -1, "_degraded": True})
            print(f"WARN: update batch 失败({len(chunk)} 条)，已降级: {exc}", file=sys.stderr)
        time_mod.sleep(60.0 / max(1, instance.sheet_rpm) * len(chunk))

    # add 新车架号
    for chunk in chunked(plan.add_items, instance.batch_size):
        add_records = [it["record"] for it in chunk]
        resp = post_webhook(webhook_url, {"schema": schema, "add_records": add_records})
        apply_add_response(state, chunk, resp)
        save_state(state_path, state)
        summary["batches"].append({"op": "add", "sent": len(chunk), "errcode": resp.get("errcode")})
        time_mod.sleep(60.0 / max(1, instance.sheet_rpm) * len(chunk))

    summary["update_failures"] = update_failures
    summary["update_failure_count"] = sum(f["sent"] for f in update_failures)
    summary["state_records_after"] = len(state.get("records", {}))
    state["summary"] = {**summary, "updated_at": datetime.now(timezone.utc).isoformat()}
    save_state(state_path, state)
    log_path = write_log(instance, summary)
    summary["log_path"] = str(log_path)
    return summary


def write_log(instance: InstanceConfig, summary: dict[str, Any]) -> Path:
    log_dir = HERE / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = log_dir / f"{instance.instance_name}_sync_{ts}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


# ---------- CLI ----------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="企业微信智能表格续保追踪同步引擎 v2（配置驱动）")
    p.add_argument("--instance", required=True, help="实例 YAML 路径")
    p.add_argument("--field-registry", default=str(HERE / "field_registry.yaml"), help="字段注册表 YAML 路径")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--batch-size", type=int, help="覆盖实例 YAML 中 batch_size")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    try:
        instance = load_instance(Path(args.instance))
        # instance 自带 field_registry_path 优先（机构表用 orgsheet 版）；相对路径相对 HERE 解析
        if instance.field_registry_path:
            rp = Path(instance.field_registry_path)
            registry_path = rp if rp.is_absolute() else HERE / rp
        else:
            registry_path = Path(args.field_registry)
        registry = load_field_registry(registry_path)
        # 解析启用的字段
        missing = [k for k in instance.fields_enabled if k not in registry]
        if missing:
            raise RuntimeError(f"实例启用了未在 field_registry 中定义的字段: {missing}")
        fields = [registry[k] for k in instance.fields_enabled]

        if args.batch_size:
            instance = InstanceConfig(**{**instance.__dict__, "batch_size": args.batch_size})

        summary = run_sync(instance, fields, dry_run=args.dry_run)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
