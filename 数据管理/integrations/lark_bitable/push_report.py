"""单次推送：往归档表追加一行。

用法（被 sync-and-reload.mjs 在报告生成后调用）：
    python3 数据管理/integrations/lark_bitable/push_report.py \
        --report-type diagnose-loss-development \
        --date 2026-06-13 \
        --url https://chexian.cretvalu.com/api/reports/diagnose-loss-development/2026-06-13/preview-mvp.html \
        --report-name "preview-mvp.html" \
        --sub-pages 75 \
        --duration-seconds 120 \
        --vps-size-kb 384 \
        --note "v2.1 主页"

幂等：以 (日期, 报告类型, 报告名) 三元组做幂等键，已存在则跳过（默认）或更新（--update-existing）。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import client
from auth import AuthError

INTEGRATION_DIR = Path(__file__).resolve().parent
META_PATH = INTEGRATION_DIR / "state" / "meta.json"
LOGS_DIR = INTEGRATION_DIR / "logs"


def _load_meta() -> dict:
    if not META_PATH.exists():
        raise RuntimeError(
            f"未找到 {META_PATH} — 请先跑 bootstrap.py 初始化归档表。"
        )
    return json.loads(META_PATH.read_text(encoding="utf-8"))


def _build_fields_payload(meta: dict, args: argparse.Namespace) -> dict:
    # 飞书日期字段需要毫秒时间戳
    import datetime as dt
    date_obj = dt.datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=dt.timezone(dt.timedelta(hours=8)))
    date_ms = int(date_obj.timestamp() * 1000)

    payload: dict = {
        "日期": date_ms,
        "报告类型": args.report_type,
        "报告名": args.report_name,
        "报告 URL": {"text": args.report_name or args.url, "link": args.url},
        "链接状态": "⏳未探测",
    }
    if args.sub_pages is not None:
        payload["子页数"] = args.sub_pages
    if args.duration_seconds is not None:
        payload["生成耗时(秒)"] = args.duration_seconds
    if args.vps_size_kb is not None:
        payload["VPS文件大小(KB)"] = args.vps_size_kb
    if args.note:
        payload["备注"] = args.note
    return payload


def find_existing(meta: dict, date_str: str, report_type: str, report_name: str) -> dict | None:
    """以三元组幂等键查找：返回 record dict 或 None。

    飞书 v1 records/search 的 filter DSL 在不同 schema 下兼容性差，
    这里改用全表 list + Python 端过滤（归档表条数小，性能足够）。
    """
    import datetime as dt
    date_obj = dt.datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=dt.timezone(dt.timedelta(hours=8)))
    date_ms = int(date_obj.timestamp() * 1000)
    rows = client.list_records(meta["app_token"], meta["table_id"])
    for row in rows:
        f = row.get("fields", {})
        row_date = f.get("日期")
        # 日期字段可能是 int (ms) 或 str (formatted)，统一比较 ms
        if isinstance(row_date, dict):
            row_date = row_date.get("value", [None])[0]
        try:
            row_date_int = int(row_date) if row_date else None
        except (TypeError, ValueError):
            row_date_int = None
        if row_date_int != date_ms:
            continue
        rt = f.get("报告类型")
        if isinstance(rt, list) and rt:
            rt = rt[0].get("text") if isinstance(rt[0], dict) else rt[0]
        if rt != report_type:
            continue
        rn = f.get("报告名")
        if isinstance(rn, list) and rn:
            rn = rn[0].get("text") if isinstance(rn[0], dict) else rn[0]
        if rn != report_name:
            continue
        return row
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-type", required=True,
                        choices=["diagnose-loss-development", "diagnose-period-trend",
                                 "diagnose-org-weekly", "diagnose-renewal", "其他"])
    parser.add_argument("--date", required=True, help="YYYY-MM-DD 报告 cutoff")
    parser.add_argument("--url", required=True)
    parser.add_argument("--report-name", required=True, help="主页 HTML 文件名，如 preview-mvp.html")
    parser.add_argument("--sub-pages", type=int)
    parser.add_argument("--duration-seconds", type=float)
    parser.add_argument("--vps-size-kb", type=int)
    parser.add_argument("--note", default="")
    parser.add_argument("--update-existing", action="store_true",
                        help="幂等键命中时更新；不传则跳过")
    args = parser.parse_args()

    try:
        meta = _load_meta()
    except RuntimeError as exc:
        print(f"[ERROR] {exc}")
        raise SystemExit(2)

    try:
        existing = find_existing(meta, args.date, args.report_type, args.report_name)
        fields_payload = _build_fields_payload(meta, args)

        if existing:
            if args.update_existing:
                print(f"[update] 已存在记录 {existing['record_id']}, 更新字段")
                client.update_record(meta["app_token"], meta["table_id"],
                                     existing["record_id"], fields_payload)
                action = "updated"
            else:
                print(f"[skip] 已存在记录 {existing['record_id']}, 跳过（用 --update-existing 强制更新）")
                action = "skipped"
            record_id = existing["record_id"]
        else:
            resp = client.create_record(meta["app_token"], meta["table_id"], fields_payload)
            record_id = resp.get("record", {}).get("record_id", "?")
            print(f"[create] 新增记录 {record_id}")
            action = "created"

        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOGS_DIR / f"push_{args.date}_{args.report_type}.json"
        log_path.write_text(
            json.dumps({"action": action, "record_id": record_id,
                        "fields": fields_payload}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except AuthError as exc:
        print(f"[ERROR] 鉴权失败: {exc}")
        raise SystemExit(2)
    except Exception as exc:
        print(f"[ERROR] {type(exc).__name__}: {exc}")
        raise SystemExit(3)


if __name__ == "__main__":
    main()
