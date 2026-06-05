"""从企微智能表反查 VIN→record_id 映射，重建 state.records。

何时用
------
- state/sichuan_<slug>_2025_may_jul_vin_record_map.json 丢失/被清空，
  但企微侧已有行数据（业务方手工或早期管道填入）
- 跑 sync_org_renewal_from_xlsx.py --execute 时被 RED LINE 闸挡住
  ("state.records 为空 → 拒绝 --execute"）

前置条件 ⚠️
-----------
本脚本依赖 `wecom-cli doc smartsheet_get_records`，**要求企微"工作台-智能机器人"
中该机器人对续保追踪表的文档使用权限有效**（参考 memory
project_wecom_org_renewal_xindu_dazhou_broken — errcode 851014 authorization
expired 时本脚本会失败，必须由机器人创建者去后台续期文档权限）。

执行
----
    # 单机构 dry-run（只打印能拉到多少行）：
    python3 数据管理/integrations/wecom_smartsheet/prime_state_from_wecom.py --org 自贡

    # 单机构真写回 state：
    python3 数据管理/integrations/wecom_smartsheet/prime_state_from_wecom.py --org 自贡 --execute

    # 全部 12 机构：
    python3 数据管理/integrations/wecom_smartsheet/prime_state_from_wecom.py --execute
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _env  # noqa: F401
from _safety import cli_call, WecomCliError  # noqa: E402 — SSOT 调用器，errcode 非 0 直接抛
from sync_org_renewal_from_xlsx import ORG_SLUGS, read_registry, DEFAULT_XLSX  # noqa: E402
from create_renewal_tracker import _read_text  # noqa: E402 — 复用 cell 形态解析（list/dict/str）

STATE_DIR = HERE / "state"
VIN_FIELD_TITLE = "车架号"  # field_registry_orgsheet.yaml 里 VIN 列标题


def resolve_sheet_id(url: str) -> str:
    # _safety.cli_call 已自动解 MCP envelope + 校验业务 errcode
    resp = cli_call("doc", "smartsheet_get_sheet", {"url": url})
    sheets = resp.get("sheet_list") or resp.get("sheets") or []
    if not sheets:
        raise RuntimeError(f"smartsheet_get_sheet 返回空 sheet_list: {resp}")
    sheet_id = sheets[0].get("sheet_id") or sheets[0].get("id")
    if not sheet_id:
        raise RuntimeError(f"sheet_list[0] 无 sheet_id 字段: {sheets[0]}")
    return sheet_id


def get_all_records(url: str, sheet_id: str) -> list[dict[str, Any]]:
    """分页拉所有 records；wecom-cli 支持 cursor + limit。
    _safety.cli_call 已校验 errcode；errcode 非 0（如 851014 文档权限过期）
    直接抛 WecomCliError，不会让我们用空 vin_index 覆盖 state.records。
    """
    rows: list[dict[str, Any]] = []
    cursor = None
    while True:
        payload: dict[str, Any] = {"url": url, "sheet_id": sheet_id, "limit": 500}
        if cursor:
            payload["cursor"] = cursor
        resp = cli_call("doc", "smartsheet_get_records", payload)
        batch = resp.get("records") or []
        rows.extend(batch)
        cursor = resp.get("next_cursor") or resp.get("cursor")
        if not cursor or not batch:
            break
    return rows


def extract_vin_record_pairs(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """从企微 records 提取 {vin: {record_id, ...}} 索引。"""
    out: dict[str, dict[str, Any]] = {}
    for rec in records:
        rid = rec.get("record_id") or rec.get("id")
        values = rec.get("values") or rec.get("fields") or {}
        vin = None
        # values 可能是 {field_title: cell} 或 {field_id: cell}；
        # cell 可能是 str / dict({"text": ...}) / list([{"text": ...}])。
        # 用 _read_text 统一解析；否则 list 形态会被 str(v) 序列化成 "[{'text': ...}]"
        # 导致 sync 按 vehicle_frame_no 查 state 匹配不到（codex P1 PR #485）。
        for k, v in values.items():
            if k == VIN_FIELD_TITLE or (isinstance(v, dict) and v.get("title") == VIN_FIELD_TITLE):
                vin = _read_text(v)
                break
        if not vin:
            continue
        vin = vin.strip()
        if not vin:
            continue
        out[vin] = {"record_id": rid, "primed_at": datetime.now(timezone.utc).isoformat()}
    return out


def prime_one(org: str, link: str, *, execute: bool) -> dict[str, Any]:
    slug = ORG_SLUGS[org]
    state_file = STATE_DIR / f"sichuan_{slug}_2025_may_jul_vin_record_map.json"
    summary: dict[str, Any] = {
        "org": org,
        "slug": slug,
        "state_file": str(state_file),
        "errors": [],
    }
    try:
        sheet_id = resolve_sheet_id(link)
        summary["sheet_id"] = sheet_id
    except Exception as exc:
        summary["status"] = "resolve_sheet_id_failed"
        summary["errors"].append(str(exc)[:300])
        return summary

    try:
        records = get_all_records(link, sheet_id)
    except Exception as exc:
        summary["status"] = "get_records_failed"
        summary["errors"].append(str(exc)[:300])
        return summary
    summary["wecom_rows_fetched"] = len(records)

    vin_index = extract_vin_record_pairs(records)
    summary["vin_index_size"] = len(vin_index)

    if not execute:
        summary["status"] = "dry_run"
        return summary

    # 写回 state.records（保留 summary，加 prime_history）
    data: dict[str, Any] = {"records": {}}
    if state_file.exists():
        data = json.loads(state_file.read_text(encoding="utf-8"))
    data["records"] = vin_index
    data.setdefault("prime_history", []).append(
        {
            "at": datetime.now(timezone.utc).isoformat(),
            "source": "wecom-cli smartsheet_get_records",
            "wecom_rows_fetched": len(records),
            "vins_indexed": len(vin_index),
        }
    )
    state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    summary["status"] = "ok"
    summary["state_records_after"] = len(vin_index)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="从企微表反查 VIN→record_id 写回 state.records")
    parser.add_argument("--execute", action="store_true", help="真写回 state；不传则 dry-run")
    parser.add_argument("--org", help="只处理指定机构，逗号分隔；默认全部 12 个")
    parser.add_argument("--xlsx", default=str(DEFAULT_XLSX), help=f"登记表 xlsx，默认：{DEFAULT_XLSX}")
    args = parser.parse_args()

    org_filter = {x.strip() for x in args.org.split(",") if x.strip()} if args.org else None
    registry = read_registry(Path(args.xlsx).expanduser(), org_filter)
    print(f"=== Prime state from WeCom ({'EXECUTE' if args.execute else 'DRY-RUN'}) ===")
    print(f"  registry rows: {len(registry)}")
    print()

    results = []
    for row in registry:
        org = row["org"]
        if org not in ORG_SLUGS:
            continue
        print(f"--- {org} ---")
        summary = prime_one(org, row["link"], execute=args.execute)
        results.append(summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        print()

    failures = [r for r in results if r.get("errors")]
    print("=== Summary ===")
    print(f"orgs:    {len(results)}")
    print(f"ok:      {sum(1 for r in results if r.get('status')=='ok')}")
    print(f"failed:  {len(failures)}")
    if failures:
        for r in failures:
            print(f"  - {r.get('org')}: {r.get('status')} {r.get('errors')}")
        if any("851014" in str(r.get("errors", "")) for r in failures):
            print()
            print("⚠ 检测到 errcode 851014（authorization expired）：")
            print("  机器人创建者须先去企微「工作台-智能机器人」给该机器人续期文档使用权限。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
