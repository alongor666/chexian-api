"""一次性建表：「车险报告反馈表」

把 HTML 报告读者的反馈承接到一张企微智能表格。
HTML 模板底部嵌入此表的 URL，用户点击 → 在企微 App 里加新行 = 提交反馈。

字段（8 列，第一列保持默认 TEXT 类型 — 企微不允许跨类型变更默认列）：
    1. 反馈内容    TEXT           ← 默认列改名而来
    2. 提交时间    DATE_TIME
    3. 反馈人      TEXT
    4. 来源报告    TEXT
    5. 类型        SINGLE_SELECT  数据问题/计算口径/UI改进/新需求/其他
    6. 优先级      SINGLE_SELECT  高/中/低
    7. 状态        SINGLE_SELECT  待处理/处理中/已完成/已忽略
    8. 处理备注    TEXT

输出：state/_feedback_form_meta.json（docid + url + sheet_id），后续
HTML 模板从这里读 URL 注入到反馈链接占位符。

用法：
    python3 数据管理/integrations/wecom_bot/feedback_form.py [--name 表名] [--force-new]
    # 已有 meta 时默认报告复用，传 --force-new 强制新建
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
STATE_DIR = HERE / "state"
META_NAME = "_feedback_form_meta.json"

DEFAULT_DOC_NAME = "chexian-api · 报告反馈表"

TYPE_OPTIONS = ("数据问题", "计算口径", "UI改进", "新需求", "其他")
PRIORITY_OPTIONS = ("高", "中", "低")
STATUS_OPTIONS = ("待处理", "处理中", "已完成", "已忽略")


def call_wecom(cmd: str, payload: dict[str, Any]) -> dict[str, Any]:
    """调 wecom-cli doc <cmd>，解包 MCP RPC envelope，错误直接退出。"""
    proc = subprocess.run(
        ["wecom-cli", "doc", cmd, "--json", json.dumps(payload, ensure_ascii=False)],
        capture_output=True,
        text=True,
    )
    if not proc.stdout.strip():
        sys.stderr.write(f"[ERROR] wecom-cli doc {cmd} 无 stdout\n")
        sys.stderr.write(f"  stderr: {proc.stderr[:1500]}\n")
        sys.exit(1)
    out = json.loads(proc.stdout)
    inner_text = out["result"]["content"][0]["text"]
    inner = json.loads(inner_text)
    if out["result"].get("isError") or inner.get("errcode", 0) != 0:
        sys.stderr.write(f"[ERROR] wecom-cli doc {cmd} 失败:\n")
        sys.stderr.write(json.dumps(inner, ensure_ascii=False, indent=2)[:2000] + "\n")
        sys.exit(1)
    return inner


def setup_table(doc_name: str) -> tuple[str, str, str]:
    """新建反馈表 + 配置 8 列。"""
    print(f"[新建] 反馈智能表格：{doc_name}")
    res = call_wecom("create_doc", {"doc_name": doc_name, "doc_type": 10})
    docid, url = res["docid"], res["url"]

    res = call_wecom("smartsheet_get_sheet", {"docid": docid})
    sheets = res.get("sheet_list") or []
    if not sheets:
        sys.stderr.write("[ERROR] 未拿到 sheet_list\n")
        sys.exit(1)
    sheet_id = sheets[0]["sheet_id"]

    res = call_wecom("smartsheet_get_fields", {"docid": docid, "sheet_id": sheet_id})
    fields = res.get("fields") or []
    if not fields:
        sys.stderr.write("[ERROR] 未拿到 fields\n")
        sys.exit(1)
    default_id = fields[0]["field_id"]
    default_type = fields[0]["field_type"]  # 保留默认 type（TEXT），企微不允许跨类型变更

    call_wecom(
        "smartsheet_update_fields",
        {
            "docid": docid,
            "sheet_id": sheet_id,
            "fields": [
                {
                    "field_id": default_id,
                    "field_title": "反馈内容",
                    "field_type": default_type,
                },
            ],
        },
    )
    call_wecom(
        "smartsheet_add_fields",
        {
            "docid": docid,
            "sheet_id": sheet_id,
            "fields": [
                {"field_title": "提交时间", "field_type": "FIELD_TYPE_DATE_TIME"},
                {"field_title": "反馈人", "field_type": "FIELD_TYPE_TEXT"},
                {"field_title": "来源报告", "field_type": "FIELD_TYPE_TEXT"},
                {"field_title": "类型", "field_type": "FIELD_TYPE_SINGLE_SELECT"},
                {"field_title": "优先级", "field_type": "FIELD_TYPE_SINGLE_SELECT"},
                {"field_title": "状态", "field_type": "FIELD_TYPE_SINGLE_SELECT"},
                {"field_title": "处理备注", "field_type": "FIELD_TYPE_TEXT"},
            ],
        },
    )
    return docid, url, sheet_id


def seed_demo_rows(docid: str, sheet_id: str) -> None:
    """预播种一行示例 + 让 SINGLE_SELECT 下拉选项各被收录一次。

    企微智能表格的 SINGLE_SELECT 不需要预声明选项，写入字符串后自动加入下拉。
    我们写 max(选项数) 行，把每列的所有选项至少各填一次，让用户后续手填时有完整下拉。
    """
    rows_count = max(len(TYPE_OPTIONS), len(PRIORITY_OPTIONS), len(STATUS_OPTIONS))
    today = date.today().isoformat()
    records: list[dict[str, Any]] = []
    for i in range(rows_count):
        records.append(
            {
                "values": {
                    "反馈内容": [
                        {
                            "type": "text",
                            "text": "占位示例行（建表时自动写入，确认下拉选项就绪后可整批删除）",
                        }
                    ],
                    "提交时间": today,
                    "反馈人": [{"type": "text", "text": "示例 · 可删"}],
                    "来源报告": [{"type": "text", "text": "hello_demo"}],
                    "类型": [{"text": TYPE_OPTIONS[i % len(TYPE_OPTIONS)]}],
                    "优先级": [{"text": PRIORITY_OPTIONS[i % len(PRIORITY_OPTIONS)]}],
                    "状态": [{"text": STATUS_OPTIONS[i % len(STATUS_OPTIONS)]}],
                    "处理备注": [{"type": "text", "text": ""}],
                }
            }
        )

    print(f"[播种] 写入 {rows_count} 行示例（让下拉选项就绪）")
    call_wecom(
        "smartsheet_add_records",
        {
            "docid": docid,
            "sheet_id": sheet_id,
            "records": records,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="一次性建表：车险报告反馈表")
    parser.add_argument("--name", default=DEFAULT_DOC_NAME, help="智能表格文档名")
    parser.add_argument(
        "--force-new",
        action="store_true",
        help="强制新建（忽略并覆盖现有 meta）",
    )
    parser.add_argument(
        "--no-seed",
        action="store_true",
        help="跳过示例行播种（不让下拉选项预填）",
    )
    parser.add_argument(
        "--meta",
        type=Path,
        help=f"元数据 JSON 路径（默认 {STATE_DIR / META_NAME}）",
    )
    args = parser.parse_args()

    meta_path = (
        args.meta.expanduser().resolve() if args.meta else STATE_DIR / META_NAME
    )
    meta_path.parent.mkdir(parents=True, exist_ok=True)

    if meta_path.exists() and not args.force_new:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        print(f"[复用] 反馈表已存在：{meta['url']}")
        print(f"  meta：{meta_path}")
        print(f"  如需重建，加 --force-new")
        return 0

    docid, url, sheet_id = setup_table(args.name)

    if not args.no_seed:
        seed_demo_rows(docid, sheet_id)

    meta_path.write_text(
        json.dumps(
            {
                "doc_name": args.name,
                "docid": docid,
                "url": url,
                "sheet_id": sheet_id,
                "type_options": list(TYPE_OPTIONS),
                "priority_options": list(PRIORITY_OPTIONS),
                "status_options": list(STATUS_OPTIONS),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print("[OK] 反馈表已建好")
    print(f"  企微 URL：{url}")
    print(f"  meta：{meta_path}")
    print()
    print("→ 把这个 URL 嵌入到 HTML 报告底部，用户点击即可在企微里加新行提交反馈")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
