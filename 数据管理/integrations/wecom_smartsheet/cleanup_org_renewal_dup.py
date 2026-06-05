"""一次性清理脚本：删除 2026-06-03 sync_org_renewal_from_xlsx.py 误写入的重复行。

根因
----
- 74c25f50 (2026-04-26 等历史) 已在企微侧为 12 个机构续保表手工/早期管道填入数据。
- 8816fdf2 (2026-06-03) 引入 _env.py 自动加载 .env.local，11 个原本因缺
  WECOM_SMARTSHEET_WEBHOOK_* 而"假成功"的机构今天首次真的把行写进了企微表。
- state/sichuan_<slug>_2025_may_jul_vin_record_map.json 跑前为空 → 全部走 add 路径
  → 与企微侧既存数据形成行级重复（合计 28,899 行）。

本脚本逻辑
----------
对 12 个机构：
  1. 读 state.records → 提取所有 record_id（精确等于今天写入的脏数据）
  2. 从登记表 ~/Library/Mobile Documents/.../续保追踪表链接与意见反馈.xlsx
     拿到该机构的"智能表链接" → 调 wecom-cli smartsheet_get_sheet 拿 sheet_id
  3. 按 500/批调 wecom-cli smartsheet_delete_records 删除
  4. 备份 + 清空 state.records，summary 加 cleanup 标记

执行
----
    # 默认 dry-run，只打印计划：
    python3 数据管理/integrations/wecom_smartsheet/cleanup_org_renewal_dup.py

    # 真删（不可逆，企微侧立即生效）：
    python3 数据管理/integrations/wecom_smartsheet/cleanup_org_renewal_dup.py --execute

    # 单机构清理：
    python3 数据管理/integrations/wecom_smartsheet/cleanup_org_renewal_dup.py --org 自贡 --execute

退出码
------
- 0：全部机构成功（dry-run 或 execute）
- 1：≥1 个机构失败（其他机构不中断，最后汇总报错）
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
# 触发 _env.py 加载 .env.local（与 sync_org_renewal_from_xlsx.py 保持一致）
import _env  # noqa: F401
from sync_org_renewal_from_xlsx import ORG_SLUGS, read_registry, DEFAULT_XLSX  # noqa: E402

STATE_DIR = HERE / "state"
BATCH = 500


def cli_call(group: str, command: str, payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    cmd = ["wecom-cli", group, command, "--json", json.dumps(payload, ensure_ascii=False)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(
            f"wecom-cli {group} {command} 失败 rc={proc.returncode}: "
            f"stdout={proc.stdout[:300]!r} stderr={proc.stderr[:300]!r}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"wecom-cli 返回非 JSON: {proc.stdout[:300]!r}") from exc


def resolve_sheet_id(url: str) -> str:
    """通过智能表链接拿子表 sheet_id。续保追踪表只有一个子表。"""
    resp = cli_call("doc", "smartsheet_get_sheet", {"url": url})
    sheets = resp.get("sheet_list") or resp.get("sheets") or []
    if not sheets:
        raise RuntimeError(f"smartsheet_get_sheet 返回空 sheet_list: {resp}")
    sheet_id = sheets[0].get("sheet_id") or sheets[0].get("id")
    if not sheet_id:
        raise RuntimeError(f"sheet_list[0] 无 sheet_id 字段: {sheets[0]}")
    return sheet_id


def state_path_for(slug: str) -> Path:
    return STATE_DIR / f"sichuan_{slug}_2025_may_jul_vin_record_map.json"


def load_state_record_ids(state_file: Path) -> list[str]:
    if not state_file.exists():
        return []
    data = json.loads(state_file.read_text(encoding="utf-8"))
    records = data.get("records") or {}
    ids = []
    for vin, info in records.items():
        rid = info.get("record_id") if isinstance(info, dict) else None
        if rid:
            ids.append(rid)
    return ids


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def cleanup_one(org: str, link: str, *, execute: bool) -> dict[str, Any]:
    slug = ORG_SLUGS[org]
    state_file = state_path_for(slug)
    record_ids = load_state_record_ids(state_file)
    summary: dict[str, Any] = {
        "org": org,
        "slug": slug,
        "state_file": str(state_file),
        "state_record_ids": len(record_ids),
        "batches_planned": (len(record_ids) + BATCH - 1) // BATCH,
        "batches_done": 0,
        "deleted_count": 0,
        "errors": [],
    }
    if not record_ids:
        summary["status"] = "skip_empty_state"
        return summary

    try:
        sheet_id = resolve_sheet_id(link)
    except Exception as exc:
        summary["status"] = "resolve_sheet_id_failed"
        summary["errors"].append(str(exc)[:300])
        return summary
    summary["sheet_id"] = sheet_id
    summary["link"] = link

    if not execute:
        summary["status"] = "dry_run"
        return summary

    deleted_ids: list[str] = []
    for batch in chunks(record_ids, BATCH):
        try:
            cli_call(
                "doc",
                "smartsheet_delete_records",
                {"url": link, "sheet_id": sheet_id, "record_ids": batch},
                timeout=180,
            )
            summary["batches_done"] += 1
            summary["deleted_count"] += len(batch)
            deleted_ids.extend(batch)
            time.sleep(0.3)  # 轻微节流避免 webhook 频控
        except Exception as exc:
            # 失败 batch 的 record_id 不进 deleted_ids → state 里保留以便后续精确重试
            summary["errors"].append(f"batch {summary['batches_done']+1}: {str(exc)[:300]}")

    # 备份并精确移除已删 record_id 对应的 vin（未删成功的保留在 state，下次按原计划重试）
    if state_file.exists() and deleted_ids:
        bak_dir = STATE_DIR / "_backup_20260603_cleanup"
        bak_dir.mkdir(exist_ok=True)
        bak = bak_dir / state_file.name
        bak.write_text(state_file.read_text(encoding="utf-8"), encoding="utf-8")
        data = json.loads(state_file.read_text(encoding="utf-8"))
        records = data.get("records") or {}
        deleted_set = set(deleted_ids)
        vins_to_drop = [
            vin
            for vin, info in records.items()
            if isinstance(info, dict) and info.get("record_id") in deleted_set
        ]
        for vin in vins_to_drop:
            records.pop(vin, None)
        data["records"] = records
        data.setdefault("cleanup_history", []).append(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "reason": "remove duplicates from 2026-06-03 first-real-run with empty state",
                "deleted_count": summary["deleted_count"],
                "removed_state_vins": len(vins_to_drop),
                "remaining_state_records": len(records),
                "had_errors": bool(summary["errors"]),
                "backup": str(bak),
            }
        )
        state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        summary["state_cleared"] = not records  # 仅在全删干净时为 True
        summary["state_remaining"] = len(records)

    summary["status"] = "ok" if not summary["errors"] else "partial"
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="清理 sync_org_renewal_from_xlsx 误写入的重复行")
    parser.add_argument("--execute", action="store_true", help="真删；不传则 dry-run")
    parser.add_argument("--org", help="只清理指定机构，逗号分隔；默认全部 12 个")
    parser.add_argument("--xlsx", default=str(DEFAULT_XLSX), help=f"登记表 xlsx 路径，默认：{DEFAULT_XLSX}")
    args = parser.parse_args()

    org_filter: set[str] | None = None
    if args.org:
        org_filter = {x.strip() for x in args.org.split(",") if x.strip()}

    registry = read_registry(Path(args.xlsx).expanduser(), org_filter)
    if not registry:
        print("ERROR: 登记表中无可处理机构", file=sys.stderr)
        return 1

    print(f"=== Cleanup org_renewal duplicates ({'EXECUTE' if args.execute else 'DRY-RUN'}) ===")
    print(f"  registry rows: {len(registry)}")
    print(f"  state dir:     {STATE_DIR}")
    print()

    results = []
    for row in registry:
        org = row["org"]
        link = row["link"]
        if org not in ORG_SLUGS:
            print(f"[skip] {org} 不在 ORG_SLUGS 映射", file=sys.stderr)
            continue
        print(f"--- {org} ---")
        try:
            summary = cleanup_one(org, link, execute=args.execute)
        except Exception as exc:
            summary = {"org": org, "status": "exception", "errors": [str(exc)[:300]]}
        results.append(summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        print()

    print("=== Summary ===")
    total_planned = sum(r.get("state_record_ids", 0) for r in results)
    total_deleted = sum(r.get("deleted_count", 0) for r in results)
    print(f"orgs:           {len(results)}")
    print(f"records to del: {total_planned}")
    print(f"actually del:   {total_deleted}")
    failures = [r for r in results if r.get("errors")]
    if failures:
        print(f"⚠ {len(failures)} 机构有错误:")
        for r in failures:
            print(f"  - {r.get('org')}: {r.get('errors')}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
