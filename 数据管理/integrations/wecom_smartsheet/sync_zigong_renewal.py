#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sync Zigong commercial renewal rows to WeCom Smart Sheet.

This module is intentionally local to 数据管理/integrations so it can reuse the
warehouse parquet contract without turning the main ETL into an external-system
sync job.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time as time_mod
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any

import duckdb


HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parents[1]
DEFAULT_POLICY_GLOB = DATA_ROOT / "warehouse" / "fact" / "policy" / "current" / "*.parquet"
DEFAULT_QUOTES_PATH = DATA_ROOT / "warehouse" / "fact" / "quotes_conversion" / "latest.parquet"
DEFAULT_SALESMAN_PATH = DATA_ROOT / "warehouse" / "dim" / "salesman" / "latest.parquet"
DEFAULT_RENEWAL_FUNNEL_PATH = DATA_ROOT / "warehouse" / "fact" / "renewal" / "renewal_funnel_2026q1.parquet"

DEFAULT_SCHEMA = {
    "f04Gwj": "到期日",
    "ftQMc5": "三级机构",
    "fkMcDX": "销售团队",
    "ftk5Tx": "车牌号码",
    "fMAfWQ": "车架号",
    "fn8TJd": "客户类别",
    "f8ZIoF": "险别组合",
    "fkjhnX": "是否报价",
    "fqTbVL": "上年折扣",
    "fFMlZM": "上年保费",
    "fDvNY2": "报价折扣",
    "fvtVUv": "报价保费",
    "fq3LsN": "是否续回",
    "fMDwYc": "业务员",
    "fnk47h": "流失原因分析",
    "fEdcCG": "续保模式",
}


@dataclass(frozen=True)
class SyncConfig:
    org_level_3: str = "自贡"
    insurance_type: str = "商业保险"
    insurance_end_date_from: str = "2026-03-31"
    insurance_end_date_to: str = "2026-05-30"
    premium_gt: float = 300.0
    quote_window_start: str = "2025-12-03"
    as_of_date: str | None = None
    sheet_records_per_minute_limit: int = 3000
    doc_records_per_minute_limit: int = 10000
    rate_limit_sleep_seconds: int = 60
    webhook_env: str = "WECOM_SMARTSHEET_WEBHOOK_URL"
    policy_glob: str = str(DEFAULT_POLICY_GLOB)
    quotes_path: str = str(DEFAULT_QUOTES_PATH)
    salesman_path: str = str(DEFAULT_SALESMAN_PATH)
    renewal_funnel_path: str = str(DEFAULT_RENEWAL_FUNNEL_PATH)
    state_path: str = str(HERE / "state" / "zigong_vin_record_map.json")
    log_dir: str = str(HERE / "logs")


@dataclass
class UpsertPlan:
    add_records: list[dict[str, Any]]
    update_records: list[dict[str, Any]]
    missing_vins: list[str]


@dataclass
class RateLimitedBatch:
    batch_index: int
    items: list[Any]
    sleep_before_seconds: int


def date_to_epoch_ms(value: date | datetime | Any) -> str:
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, datetime):
        value = value.date()
    dt = datetime.combine(value, time.min, tzinfo=timezone.utc)
    return str(int(dt.timestamp() * 1000))


def clean_num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        as_float = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(as_float):
        return None
    return round(as_float, 6)


def text_value(value: Any) -> str:
    if value is None:
        return ""
    try:
        if math.isnan(float(value)):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value)


def format_pct(value: float) -> str:
    rounded = round(value, 1)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.1f}"


def format_customer_status(row: dict[str, Any]) -> str:
    days_to_expiry = row.get("days_to_expiry")
    try:
        days_to_expiry = int(days_to_expiry)
    except (TypeError, ValueError):
        days_to_expiry = None
    is_expired = bool(row.get("is_expired"))
    in_quote_period = is_expired or (days_to_expiry is not None and 0 <= days_to_expiry <= 30)

    prior_premium = clean_num(row.get("prior_premium"))
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


def build_record(row: dict[str, Any]) -> dict[str, dict[str, Any]]:
    values: dict[str, Any] = {
        "f04Gwj": date_to_epoch_ms(row["expiry_date"]),
        "ftQMc5": [{"text": text_value(row.get("org_level_3"))}],
        "fkMcDX": text_value(row.get("team_name")),
        "ftk5Tx": text_value(row.get("plate_no")),
        "fMAfWQ": text_value(row.get("vehicle_frame_no")),
        "fMDwYc": text_value(row.get("salesman_name")),
        "fn8TJd": text_value(row.get("customer_category")),
        "f8ZIoF": [{"text": text_value(row.get("coverage_combination"))}],
        "fkjhnX": [{"text": "是" if row.get("is_quoted") else "否"}],
        "fq3LsN": bool(row.get("is_renewed")),
        "fnk47h": format_customer_status(row),
        "fEdcCG": [{"text": text_value(row.get("renewal_mode"))}],
    }
    prior_discount = clean_num(row.get("prior_discount"))
    prior_premium = clean_num(row.get("prior_premium"))
    quote_discount = clean_num(row.get("quote_discount"))
    quote_premium = clean_num(row.get("quote_premium"))
    if prior_discount is not None:
        values["fqTbVL"] = prior_discount
    if prior_premium is not None:
        values["fFMlZM"] = prior_premium
    if quote_discount is not None:
        values["fDvNY2"] = quote_discount
    if quote_premium is not None:
        values["fvtVUv"] = quote_premium
    return {"values": values}


def load_config(path: str | None) -> SyncConfig:
    if path is None:
        return SyncConfig()
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    allowed = set(SyncConfig.__dataclass_fields__)
    unknown = sorted(set(data) - allowed)
    if unknown:
        raise ValueError(f"未知配置字段: {unknown}")
    return SyncConfig(**data)


def load_state(path: str) -> dict[str, Any]:
    state_path = Path(path)
    if not state_path.exists():
        return {"summary": {}, "records": {}}
    return json.loads(state_path.read_text(encoding="utf-8"))


def save_state(path: str, state: dict[str, Any]) -> None:
    state_path = Path(path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def build_source_rows(config: SyncConfig) -> list[dict[str, Any]]:
    con = duckdb.connect(":memory:")
    as_of_date = config.as_of_date or date.today().isoformat()
    sql = f"""
    WITH base AS (
      SELECT policy_no, vehicle_frame_no, org_level_3, salesman_name, plate_no, customer_category,
             coverage_combination, premium, commercial_pricing_factor, insurance_end_date
      FROM read_parquet('{config.policy_glob}', union_by_name=true)
      WHERE org_level_3 = ?
        AND insurance_type = ?
        AND CAST(insurance_end_date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        AND premium > ?
    ),
    q_latest AS (
      SELECT * EXCLUDE rn FROM (
        SELECT vehicle_frame_no, quote_time, commercial_pricing_factor AS quote_pricing_factor,
               final_quote_premium AS quote_premium,
               team AS quote_team,
               ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC NULLS LAST) rn
        FROM read_parquet('{config.quotes_path}')
        WHERE insurance_type = ?
          AND CAST(quote_time AS DATE) >= CAST(? AS DATE)
          AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
      ) WHERE rn = 1
    ),
    renewed AS (
      SELECT DISTINCT renewal_policy_no AS source_policy_no, vehicle_frame_no, policy_no AS renewed_policy_no
      FROM read_parquet('{config.policy_glob}', union_by_name=true)
      WHERE insurance_type = ?
        AND is_renewal = true
        AND renewal_policy_no IS NOT NULL AND renewal_policy_no != ''
        AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
        AND CAST(insurance_start_date AS DATE) >= DATE '2026-01-01'
    ),
    salesman_dim AS (
      SELECT full_name, NULLIF(NULLIF(team, 'nan'), '') AS team FROM read_parquet('{config.salesman_path}')
    ),
    funnel AS (
      SELECT policy_no, vehicle_frame_no, MAX(NULLIF(renewal_mode, '')) AS renewal_mode
      FROM read_parquet('{config.renewal_funnel_path}')
      GROUP BY 1, 2
    )
    SELECT
      b.policy_no,
      CAST(b.insurance_end_date AS DATE) AS expiry_date,
      b.org_level_3,
      COALESCE(s.team, NULLIF(NULLIF(q.quote_team, 'nan'), ''), '未分配') AS team_name,
      COALESCE(b.plate_no, '') AS plate_no,
      COALESCE(b.vehicle_frame_no, '') AS vehicle_frame_no,
      COALESCE(b.salesman_name, '') AS salesman_name,
      COALESCE(b.customer_category, '') AS customer_category,
      COALESCE(b.coverage_combination, '') AS coverage_combination,
      b.commercial_pricing_factor AS prior_discount,
      b.premium AS prior_premium,
      q.quote_pricing_factor AS quote_discount,
      q.quote_premium,
      CASE WHEN q.quote_time IS NOT NULL THEN true ELSE false END AS is_quoted,
      CASE WHEN r.renewed_policy_no IS NOT NULL THEN true ELSE false END AS is_renewed,
      CASE WHEN CAST(b.insurance_end_date AS DATE) < CAST(? AS DATE) THEN true ELSE false END AS is_expired,
      DATE_DIFF('day', CAST(? AS DATE), CAST(b.insurance_end_date AS DATE)) AS days_to_expiry,
      COALESCE(f.renewal_mode, '未分类') AS renewal_mode,
      CASE
        WHEN r.renewed_policy_no IS NOT NULL THEN ''
        WHEN q.quote_time IS NULL THEN '未报价'
        ELSE '已报价未续回'
      END AS loss_reason
    FROM base b
    LEFT JOIN q_latest q ON q.vehicle_frame_no = b.vehicle_frame_no
    LEFT JOIN renewed r ON r.source_policy_no = b.policy_no AND r.vehicle_frame_no = b.vehicle_frame_no
    LEFT JOIN salesman_dim s ON s.full_name = b.salesman_name
    LEFT JOIN funnel f ON f.policy_no = b.policy_no AND f.vehicle_frame_no = b.vehicle_frame_no
    ORDER BY expiry_date, b.policy_no
    """
    rows = con.execute(
        sql,
        [
            config.org_level_3,
            config.insurance_type,
            config.insurance_end_date_from,
            config.insurance_end_date_to,
            config.premium_gt,
            config.insurance_type,
            config.quote_window_start,
            config.insurance_type,
            as_of_date,
            as_of_date,
        ],
    ).fetchdf().to_dict("records")
    vins = [text_value(row.get("vehicle_frame_no")) for row in rows]
    duplicates = sorted({vin for vin in vins if vins.count(vin) > 1})
    if duplicates:
        raise ValueError(f"车架号不是唯一，停止同步。重复样例: {duplicates[:5]}")
    return rows


def plan_upsert(rows: list[dict[str, Any]], state: dict[str, Any]) -> UpsertPlan:
    mapped = state.get("records", {})
    current_vins = {text_value(row.get("vehicle_frame_no")) for row in rows}
    add_records: list[dict[str, Any]] = []
    update_records: list[dict[str, Any]] = []
    for row in rows:
        vin = text_value(row.get("vehicle_frame_no"))
        existing = mapped.get(vin, {})
        record_id = existing.get("record_id")
        if record_id:
            item = build_record(row)
            item["record_id"] = record_id
            update_records.append(item)
        else:
            add_records.append({"source_row": row, "record": build_record(row)})
    missing_vins = sorted(set(mapped) - current_vins)
    return UpsertPlan(add_records=add_records, update_records=update_records, missing_vins=missing_vins)


def post_webhook(url: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"企业微信 webhook HTTP {exc.code}: {body}") from exc


def apply_add_response(state: dict[str, Any], add_rows: list[dict[str, Any]], response: dict[str, Any]) -> None:
    if response.get("errcode") != 0:
        raise RuntimeError(f"企业微信新增失败: {response}")
    added = response.get("add_records", [])
    if len(added) != len(add_rows):
        raise RuntimeError(f"新增返回数量不一致: sent={len(add_rows)} returned={len(added)}")
    state.setdefault("records", {})
    for source_row, added_row in zip(add_rows, added):
        vin = text_value(source_row.get("vehicle_frame_no"))
        state["records"][vin] = {
            "record_id": added_row["record_id"],
            "policy_no": text_value(source_row.get("policy_no")),
            "expiry_date": text_value(source_row.get("expiry_date")),
            "salesman_name": text_value(source_row.get("salesman_name")),
        }


def apply_update_response(response: dict[str, Any]) -> None:
    if response.get("errcode") != 0:
        raise RuntimeError(f"企业微信更新失败: {response}")


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def iter_rate_limited_batches(
    items: list[Any],
    batch_size: int,
    records_per_minute: int,
    sleep_seconds: int = 60,
) -> list[RateLimitedBatch]:
    if batch_size <= 0:
        raise ValueError("batch_size 必须大于 0")
    if records_per_minute <= 0:
        raise ValueError("records_per_minute 必须大于 0")
    effective_batch_size = min(batch_size, records_per_minute)
    batches: list[RateLimitedBatch] = []
    used_in_window = 0
    for raw_batch in chunked(items, effective_batch_size):
        sleep_before = 0
        if used_in_window + len(raw_batch) > records_per_minute:
            sleep_before = sleep_seconds
            used_in_window = 0
        used_in_window += len(raw_batch)
        batches.append(
            RateLimitedBatch(
                batch_index=len(batches) + 1,
                items=raw_batch,
                sleep_before_seconds=sleep_before,
            )
        )
    return batches


def write_log(config: SyncConfig, summary: dict[str, Any]) -> Path:
    log_dir = Path(config.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = log_dir / f"sync_{stamp}.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def run_sync(config: SyncConfig, dry_run: bool = False, batch_size: int = 100) -> dict[str, Any]:
    if config.sheet_records_per_minute_limit > config.doc_records_per_minute_limit:
        raise ValueError("工作表分钟限制不能大于智能表格文档分钟限制")
    rows = build_source_rows(config)
    state = load_state(config.state_path)
    plan = plan_upsert(rows, state)
    summary: dict[str, Any] = {
        "dry_run": dry_run,
        "filter": {
            "org_level_3": config.org_level_3,
            "insurance_type": config.insurance_type,
            "insurance_end_date_from": config.insurance_end_date_from,
            "insurance_end_date_to": config.insurance_end_date_to,
            "premium_gt": config.premium_gt,
            "unique_key": "vehicle_frame_no",
            "as_of_date": config.as_of_date or date.today().isoformat(),
        },
        "source_rows": len(rows),
        "state_records_before": len(state.get("records", {})),
        "to_add": len(plan.add_records),
        "to_update": len(plan.update_records),
        "missing_vins": plan.missing_vins,
        "quoted_count": sum(1 for row in rows if row.get("is_quoted")),
        "renewed_count": sum(1 for row in rows if row.get("is_renewed")),
        "batches": [],
        "rate_limit": {
            "sheet_records_per_minute_limit": config.sheet_records_per_minute_limit,
            "doc_records_per_minute_limit": config.doc_records_per_minute_limit,
            "sleep_seconds_between_windows": config.rate_limit_sleep_seconds,
        },
    }
    if dry_run:
        summary["state_path"] = config.state_path
        summary["log_path"] = str(write_log(config, summary))
        return summary

    webhook_url = os.environ.get(config.webhook_env)
    if not webhook_url:
        raise RuntimeError(f"缺少环境变量 {config.webhook_env}")

    for rate_batch in iter_rate_limited_batches(
        plan.update_records,
        batch_size=batch_size,
        records_per_minute=config.sheet_records_per_minute_limit,
        sleep_seconds=config.rate_limit_sleep_seconds,
    ):
        if rate_batch.sleep_before_seconds:
            time_mod.sleep(rate_batch.sleep_before_seconds)
        response = post_webhook(webhook_url, {"schema": DEFAULT_SCHEMA, "update_records": rate_batch.items})
        apply_update_response(response)
        summary["batches"].append({
            "op": "update",
            "sent": len(rate_batch.items),
            "errcode": response.get("errcode"),
            "sleep_before_seconds": rate_batch.sleep_before_seconds,
        })
        time_mod.sleep(0.2)

    for rate_batch in iter_rate_limited_batches(
        plan.add_records,
        batch_size=batch_size,
        records_per_minute=config.sheet_records_per_minute_limit,
        sleep_seconds=config.rate_limit_sleep_seconds,
    ):
        if rate_batch.sleep_before_seconds:
            time_mod.sleep(rate_batch.sleep_before_seconds)
        add_rows = [item["source_row"] for item in rate_batch.items]
        add_records = [item["record"] for item in rate_batch.items]
        response = post_webhook(webhook_url, {"schema": DEFAULT_SCHEMA, "add_records": add_records})
        apply_add_response(state, add_rows, response)
        summary["batches"].append({
            "op": "add",
            "sent": len(rate_batch.items),
            "errcode": response.get("errcode"),
            "sleep_before_seconds": rate_batch.sleep_before_seconds,
        })
        time_mod.sleep(0.2)

    state["summary"] = {
        **summary,
        "state_records_after": len(state.get("records", {})),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    save_state(config.state_path, state)
    summary["state_records_after"] = len(state.get("records", {}))
    summary["state_path"] = config.state_path
    summary["log_path"] = str(write_log(config, summary))
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="同步自贡商业险续保追踪数据到企业微信智能表格")
    parser.add_argument("--config", help="配置 JSON；缺省使用模块默认配置")
    parser.add_argument("--dry-run", action="store_true", help="只生成计划和日志，不调用 webhook")
    parser.add_argument("--batch-size", type=int, default=100, help="每批 add/update 记录数")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        config = load_config(args.config)
        summary = run_sync(config, dry_run=args.dry_run, batch_size=args.batch_size)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
