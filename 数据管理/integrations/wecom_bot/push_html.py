"""把本地 HTML 报告推送到企业微信（链接路径）。

设计决策（2026-05-08 重写，从「附件路径」切到「链接路径」）：
- 旧路径：上传 HTML 到智能表格附件 → 企微 App 内预览只显示源码（产品决策防 XSS），失败
- 新路径：HTML 复制到 chexian-api 后端 server/data/reports/ → 拼公网 URL
         → 写到智能表格 URL 字段 → 用户在企微点击 → 浏览器打开 → JWT cookie 鉴权 → 渲染 HTML

通道：仍走 wecom-cli `doc smartsheet_add_records`（doc 权限默认开放）
鉴权：复用 chexian-api JWT — 凡 chexian.cretvalu.com 登录过的用户都能看（cookie 自动带）

依赖：
- wecom-cli 已 init
- chexian-api 后端运行（本地 :3000 或 VPS chexian.cretvalu.com）
- doc 权限开放
- 仅 stdlib，subprocess 调 wecom-cli

用法（两种模式互斥）：
    # 模式 A：单文件 HTML，本脚本负责 stage + 拼 URL
    python3 数据管理/integrations/wecom_bot/push_html.py [HTML 路径] [选项]
    # 不指定路径默认发本目录 hello_demo.html

    # 模式 B：多文件报告（v2.1+，URL 已由生成端 stage 到子目录树），只推 URL
    python3 数据管理/integrations/wecom_bot/push_html.py \\
      --external-url https://chexian.cretvalu.com/api/reports/diagnose-loss-development/2026-05-14/preview-mvp.html \\
      --note "诊断报告 v2.1"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
DEFAULT_DEMO = HERE / "hello_demo.html"
STATE_DIR = HERE / "state"
META_NAME = "_html_push_meta.json"
FEEDBACK_META_NAME = "_feedback_form_meta.json"

# 项目根：数据管理/integrations/wecom_bot/ 向上 3 级
REPO_ROOT = HERE.parent.parent.parent
DEFAULT_REPORTS_DIR = REPO_ROOT / "server" / "data" / "reports"
DEFAULT_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://chexian.cretvalu.com")

FEEDBACK_PLACEHOLDER = "<!-- FEEDBACK_URL -->"


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
    """新建智能表格 + 配置 4 列（报告 / 链接 / 推送日期 / 备注）。"""
    print(f"[新建] 智能表格：{doc_name}")
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
    default_type = fields[0]["field_type"]

    call_wecom(
        "smartsheet_update_fields",
        {
            "docid": docid,
            "sheet_id": sheet_id,
            "fields": [
                {"field_id": default_id, "field_title": "报告", "field_type": default_type},
            ],
        },
    )
    call_wecom(
        "smartsheet_add_fields",
        {
            "docid": docid,
            "sheet_id": sheet_id,
            "fields": [
                {"field_title": "链接", "field_type": "FIELD_TYPE_URL"},
                {"field_title": "推送日期", "field_type": "FIELD_TYPE_DATE_TIME"},
                {"field_title": "备注", "field_type": "FIELD_TYPE_TEXT"},
            ],
        },
    )
    return docid, url, sheet_id


def append_row(
    docid: str,
    sheet_id: str,
    title: str,
    public_url: str,
    push_date: str,
    note: str,
) -> None:
    """往智能表格追加一行（报告标题 + URL 链接 + 日期 + 备注）。"""
    print(f"[写入] 智能表格新行：{title} → {public_url}")
    call_wecom(
        "smartsheet_add_records",
        {
            "docid": docid,
            "sheet_id": sheet_id,
            "records": [
                {
                    "values": {
                        "报告": [{"type": "text", "text": title}],
                        "链接": [
                            {"type": "url", "link": public_url, "text": title}
                        ],
                        "推送日期": push_date,
                        "备注": [{"type": "text", "text": note or ""}],
                    }
                }
            ],
        },
    )


def slugify(name: str, max_len: int = 40) -> str:
    """文件名 stem → 文件系统/URL 安全的 slug。

    保留中英文数字下划线连字符，其余替换为 -，连续 - 折叠，截断。
    """
    s = re.sub(r"[^\w一-龥\-]+", "-", name, flags=re.UNICODE)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:max_len] or "report"


def load_feedback_url(meta_path: Path) -> str:
    """读反馈表 URL；不存在则返回 # 占位（不报错，让链路继续可跑）。"""
    if not meta_path.exists():
        return "#"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return meta.get("url") or "#"
    except (OSError, json.JSONDecodeError):
        return "#"


def stage_html(
    src: Path,
    reports_dir: Path,
    title: str,
    push_date: str,
    feedback_url: str,
    source_label: str,
) -> Path:
    """读 HTML → 替换反馈占位 → 写入 reports_dir/<日期-slug-hash>.html。

    文件名结构：<YYYYMMDD>-<title-slug>-<8hex>.html
    hash 以源文件 + 推送时刻为 seed，避免多次 push 同一 HTML 互相覆盖。
    """
    raw = src.read_text(encoding="utf-8")

    # 替换反馈链接占位
    rendered = raw.replace(FEEDBACK_PLACEHOLDER, feedback_url)
    # 同时把 ?source= 占位（如果模板里用了）替换为 source_label，方便反馈表追踪
    rendered = rendered.replace("__SOURCE_LABEL__", source_label)

    h = hashlib.sha256(
        f"{src}|{push_date}|{rendered[:128]}".encode("utf-8")
    ).hexdigest()[:8]
    date_compact = push_date.replace("-", "")
    filename = f"{date_compact}-{slugify(title)}-{h}.html"

    reports_dir.mkdir(parents=True, exist_ok=True)
    target = reports_dir / filename
    target.write_text(rendered, encoding="utf-8")
    return target


def derive_title_from_url(url: str) -> str:
    """从公网 URL 末段派生默认标题（去 .html/.htm 后缀）。

    https://.../preview-mvp.html → "preview-mvp"
    https://.../drill/team/abc123.html → "abc123"
    """
    last_segment = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1] or "report"
    return re.sub(r"\.html?$", "", last_segment, flags=re.IGNORECASE) or "report"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="把本地 HTML 报告托管到 chexian-api，链接推送到企微智能表格"
    )
    parser.add_argument(
        "html_file",
        nargs="?",
        type=Path,
        default=None,
        help=f"HTML 文件路径（不传且无 --external-url 时回落到 {DEFAULT_DEMO.name}）",
    )
    parser.add_argument(
        "--external-url",
        help="跳过本地 stage，直接把这个公网 URL 写入智能表格（多文件报告场景）。"
        "与 html_file 互斥。",
    )
    parser.add_argument("--name", help="智能表格文档名（仅新建时用，复用时忽略）")
    parser.add_argument("--note", default="", help="备注/概要（写入备注列）")
    parser.add_argument("--title", help="本行报告标题（默认：单文件模式→HTML 文件名 stem，"
                                          "--external-url 模式→URL 末段文件名 stem）")
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="推送日期 YYYY-MM-DD（默认今天）",
    )
    parser.add_argument(
        "--meta",
        type=Path,
        help=f"推送目标 meta JSON 路径（默认 {STATE_DIR / META_NAME}）",
    )
    parser.add_argument(
        "--feedback-meta",
        type=Path,
        help=f"反馈表 meta JSON 路径（默认 {STATE_DIR / FEEDBACK_META_NAME}）",
    )
    parser.add_argument(
        "--reports-dir",
        type=Path,
        default=DEFAULT_REPORTS_DIR,
        help=f"chexian-api 报告托管目录（默认 {DEFAULT_REPORTS_DIR}）",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"公网 base URL（默认 {DEFAULT_BASE_URL}，VPS 应改成 https://chexian.cretvalu.com）",
    )
    parser.add_argument(
        "--force-new",
        action="store_true",
        help="强制新建智能表格（忽略并覆盖现有 meta）",
    )
    args = parser.parse_args()

    if args.external_url is not None and args.html_file is not None:
        sys.stderr.write("[ERROR] --external-url 与 html_file 互斥，请只传一个\n")
        return 2

    meta_path = (
        args.meta.expanduser().resolve() if args.meta else STATE_DIR / META_NAME
    )
    meta_path.parent.mkdir(parents=True, exist_ok=True)

    if args.external_url is not None:
        if not args.external_url.strip():
            sys.stderr.write("[ERROR] --external-url 不能为空\n")
            return 2
        parsed = urlparse(args.external_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            sys.stderr.write(
                f"[ERROR] --external-url 必须是 http(s) 绝对 URL: {args.external_url}\n"
            )
            return 2
        if not re.search(r"\.html?$", parsed.path, re.IGNORECASE):
            sys.stderr.write(
                f"[ERROR] --external-url 应指向 .html / .htm: {args.external_url}\n"
            )
            return 2
        public_url = args.external_url
        title = args.title or derive_title_from_url(public_url)
        print(f"[外链] 跳过 stage，直接写入企微表格：{public_url}")
    else:
        html_path = (args.html_file or DEFAULT_DEMO).expanduser().resolve()
        if not html_path.is_file():
            sys.stderr.write(f"[ERROR] HTML 文件不存在: {html_path}\n")
            return 1
        if html_path.suffix.lower() not in (".html", ".htm"):
            sys.stderr.write(f"[ERROR] 不是 HTML 文件: {html_path}\n")
            return 1

        feedback_meta_path = (
            args.feedback_meta.expanduser().resolve()
            if args.feedback_meta
            else STATE_DIR / FEEDBACK_META_NAME
        )
        feedback_url = load_feedback_url(feedback_meta_path)
        if feedback_url == "#":
            print(
                f"[WARN] 反馈表 meta 不存在（{feedback_meta_path}），HTML 内 "
                f"{FEEDBACK_PLACEHOLDER} 将替换为 '#'。先跑 feedback_form.py 建反馈表。"
            )

        title = args.title or html_path.stem
        reports_dir = args.reports_dir.expanduser().resolve()
        base_url = args.base_url.rstrip("/")

        staged = stage_html(
            src=html_path,
            reports_dir=reports_dir,
            title=title,
            push_date=args.date,
            feedback_url=feedback_url,
            source_label=title,
        )
        public_url = f"{base_url}/api/reports/{staged.name}"
        print(f"[托管] HTML 已落到：{staged}")
        print(f"[公网] URL：{public_url}")

    # 2. 复用或新建推送智能表格
    if meta_path.exists() and not args.force_new:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        docid, url, sheet_id = meta["docid"], meta["url"], meta["sheet_id"]
        print(f"[复用] 推送目标智能表格：{url}")
    else:
        doc_name = args.name or f"chexian-api · 报告推送 · {args.date}"
        docid, url, sheet_id = setup_table(doc_name)

    # 3. 写新行
    append_row(
        docid=docid,
        sheet_id=sheet_id,
        title=title,
        public_url=public_url,
        push_date=args.date,
        note=args.note,
    )

    # 4. 持久化 meta
    meta_path.write_text(
        json.dumps(
            {
                "doc_name": args.name or title,
                "docid": docid,
                "url": url,
                "sheet_id": sheet_id,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print("[OK] 链路完成")
    if args.external_url:
        print(f"  数据源：--external-url（未 stage 本地文件）")
    else:
        print(f"  HTML 文件：{staged.name}")
        print(f"  托管目录：{reports_dir}")
    print(f"  报告标题：{title}")
    print(f"  推送日期：{args.date}")
    print(f"  公网链接：{public_url}")
    print(f"  企微表格：{url}")
    print(f"  推送 meta：{meta_path}")
    print()
    print("→ 在企微 App 打开企微表格 → 点击「链接」列 → 浏览器渲染 HTML（需先在 chexian-api 登录）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
