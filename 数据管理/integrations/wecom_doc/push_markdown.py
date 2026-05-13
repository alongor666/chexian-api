"""
将本地 markdown 文件以「章节表格化」形式推送到企业微信智能表格。

设计决策（用户拍板，2026-05-08）：
- 形态：智能表格（doc_type=10），每个 H1/H2 章节 → 一行记录
- 字段：章节标题 / 层级(H1|H2) / 序号 / 正文(纯文本) / 字数
- 去重：每次新建一篇，累积归档（不维护 名称→docid 映射）
- 输出：仅打印 docid + url，用户手动复粘到企微群

⚠️ 局限：smartsheet 单元格只支持 FIELD_TYPE_TEXT（纯文本），不渲染 markdown 语法；
   `# 标题` `- 列表` `|表格|` 在 cell 里是字面字符串。需要原生 markdown 渲染请改用 smartpage。

依赖：
- 复用 wecom_smartsheet/create_renewal_tracker.py 的 WeComCli 类
- 复用 wecom_smartsheet/field_spec.py 的 FieldSpec/render_*/build_record_values

用法：
    python -m integrations.wecom_doc.push_markdown <md_file> [--name "标题"] [--dry-run]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

# 复用 wecom_smartsheet 中的工具（不重复造轮子，沿用项目既有路线）
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent))
from wecom_smartsheet import field_spec as fs  # noqa: E402
from wecom_smartsheet.create_renewal_tracker import WeComCli, WeComCliError  # noqa: E402

# H1 / H2 标题（行首 `# ` 或 `## `，至多匹配两级）
H_PATTERN = re.compile(r"^(#{1,2}) (.+?)\s*$", re.MULTILINE)

# 单元格文本长度上限（保守值；wecom 未公开明确上限，超过则截断 + 加尾标）
CELL_TEXT_LIMIT = 32_000


# ===========================================================================
# 字段方案
# ===========================================================================
SECTION_FIELDS: list[fs.FieldSpec] = [
    # 第 1 列必须是默认字段重命名锚点（smartsheet 新建子表自带一个文本字段）
    fs.FieldSpec(
        "章节标题",
        fs.FIELD_TYPE_TEXT,
        renderer=lambda r: fs.render_text(r["title"]),
    ),
    fs.FieldSpec(
        "层级",
        fs.FIELD_TYPE_SINGLE_SELECT,
        renderer=lambda r: fs.render_single_select(r["level"]),
    ),
    fs.FieldSpec(
        "序号",
        fs.FIELD_TYPE_NUMBER,
        renderer=lambda r: fs.render_number(r["index"]),
    ),
    fs.FieldSpec(
        "正文",
        fs.FIELD_TYPE_TEXT,
        renderer=lambda r: fs.render_text(r["content"]),
    ),
    fs.FieldSpec(
        "字数",
        fs.FIELD_TYPE_NUMBER,
        renderer=lambda r: fs.render_number(r["word_count"]),
    ),
]
assert SECTION_FIELDS[0].title == "章节标题", "第 1 列必须是'章节标题'（默认子表字段重命名锚点）"


# ===========================================================================
# Markdown 解析
# ===========================================================================
def parse_sections(md_text: str, doc_title_fallback: str) -> list[dict[str, Any]]:
    """按 H1/H2 切片，返回 [{index, level, title, content, word_count}, ...]。

    规则：
    - 全文无 H1/H2：整篇当一节，标题 = doc_title_fallback
    - H1/H2 之前有非空内容：作为独立首节（标题"前言"）
    - 章节正文：从该标题行之后到下一个 H1/H2 之前
    - content 超过 CELL_TEXT_LIMIT 时截断并附加尾标
    """
    matches = list(H_PATTERN.finditer(md_text))
    if not matches:
        text = md_text.strip()
        return [{
            "index": 1,
            "level": "H1",
            "title": doc_title_fallback,
            "content": _truncate(text),
            "word_count": len(text),
        }]

    sections: list[dict[str, Any]] = []
    first_start = matches[0].start()
    if first_start > 0:
        preface = md_text[:first_start].strip()
        if preface:
            sections.append({
                "index": 1,
                "level": "H1",
                "title": "前言",
                "content": _truncate(preface),
                "word_count": len(preface),
            })

    for i, m in enumerate(matches):
        level = "H1" if len(m.group(1)) == 1 else "H2"
        title = m.group(2).strip()
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(md_text)
        content = md_text[body_start:body_end].strip()
        sections.append({
            "index": len(sections) + 1,
            "level": level,
            "title": title,
            "content": _truncate(content),
            "word_count": len(content),
        })
    return sections


def _truncate(text: str) -> str:
    if len(text) <= CELL_TEXT_LIMIT:
        return text
    return text[:CELL_TEXT_LIMIT] + f"\n\n...(已截断，原文 {len(text)} 字符)"


def resolve_doc_title(md_text: str, md_path: Path, override: str | None) -> str:
    if override:
        return override
    first = H_PATTERN.search(md_text)
    if first and len(first.group(1)) == 1:
        return first.group(2).strip()
    return md_path.stem


# ===========================================================================
# 推送主流程
# ===========================================================================
def push_markdown(
    md_path: Path,
    doc_name: str | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """主入口：把 markdown 文件推送到企业微信智能表格（章节表格化）。

    返回 {docid, url, sections, title}（dry_run 时不含 docid/url）。
    """
    if not md_path.is_file():
        raise FileNotFoundError(f"Markdown 文件不存在: {md_path}")

    md_text = md_path.read_text(encoding="utf-8")
    if not md_text.strip():
        raise ValueError("Markdown 文件内容为空")

    title = resolve_doc_title(md_text, md_path, doc_name)
    sections = parse_sections(md_text, doc_title_fallback=title)

    if dry_run:
        return {
            "_dry_run": True,
            "title": title,
            "sections": len(sections),
            "preview": [
                {
                    "index": s["index"],
                    "level": s["level"],
                    "title": s["title"],
                    "word_count": s["word_count"],
                    "truncated": s["word_count"] > CELL_TEXT_LIMIT,
                }
                for s in sections
            ],
        }

    cli = WeComCli()

    # 1) 创建 smartsheet
    create_result = cli.create_doc(doc_name=title, doc_type=10)
    docid = create_result.get("docid", "")
    url = create_result.get("url", "")
    if not docid:
        raise WeComCliError(f"create_doc 未返回 docid: {create_result}")

    # 2) 获取默认子表
    sheets = cli.get_sheets(docid)
    if not sheets:
        raise WeComCliError(f"docid={docid} 未找到默认子表")
    sheet_id = sheets[0].get("sheet_id")
    if not sheet_id:
        raise WeComCliError(f"默认子表缺少 sheet_id: {sheets[0]}")

    # 3) 重命名默认字段为「章节标题」
    existing_fields = cli.get_fields(docid, sheet_id)
    if not existing_fields:
        raise WeComCliError(f"docid={docid} sheet_id={sheet_id} 默认字段查询为空")
    default_field_id = existing_fields[0].get("field_id")
    if not default_field_id:
        raise WeComCliError(f"默认字段缺少 field_id: {existing_fields[0]}")
    cli.update_fields(docid, sheet_id, [{
        "field_id": default_field_id,
        "field_title": SECTION_FIELDS[0].title,
        "field_type": SECTION_FIELDS[0].field_type,
    }])

    # 4) 添加剩余字段
    cli.add_fields(
        docid, sheet_id,
        [spec.to_add_field_payload() for spec in SECTION_FIELDS[1:]],
    )

    # 5) 写入章节记录
    records = [
        {"values": fs.build_record_values(section, SECTION_FIELDS)}
        for section in sections
    ]
    cli.add_records(docid, sheet_id, records)

    return {
        "docid": docid,
        "url": url,
        "sections": len(sections),
        "title": title,
    }


# ===========================================================================
# Preflight
# ===========================================================================
def preflight() -> None:
    """启动前检查：wecom-cli 可用 + 必需子命令存在。"""
    version = WeComCli.version()
    if version.startswith("<unknown"):
        raise WeComCliError(f"wecom-cli 不可用：{version}")

    import subprocess  # 局部 import，避免污染主流程命名空间
    out = subprocess.run(
        ["wecom-cli", "doc", "--help"], capture_output=True, text=True, timeout=10
    )
    required = ("create_doc", "smartsheet_get_sheet", "smartsheet_get_fields",
                "smartsheet_update_fields", "smartsheet_add_fields", "smartsheet_add_records")
    missing = [cmd for cmd in required if cmd not in out.stdout]
    if missing:
        raise WeComCliError(
            f"wecom-cli doc 缺少必需子命令: {missing}；请升级到 0.1.8+"
        )


# ===========================================================================
# CLI
# ===========================================================================
def main() -> int:
    parser = argparse.ArgumentParser(
        description="把本地 markdown 文件推送到企业微信智能表格（按 H1/H2 拆章节，每节一行）"
    )
    parser.add_argument("md_file", type=Path, help="markdown 文件路径")
    parser.add_argument("--name", help="文档标题（默认取首个 H1 或文件名）")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印章节切分结果，不实际推送",
    )
    args = parser.parse_args()

    try:
        if not args.dry_run:
            preflight()
        result = push_markdown(args.md_file, doc_name=args.name, dry_run=args.dry_run)
    except FileNotFoundError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1
    except WeComCliError as exc:
        print(f"[ERROR] wecom-cli 调用失败: {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        print(f"[DRY-RUN] 文档标题：{result['title']}")
        print(f"[DRY-RUN] 章节数：{result['sections']}")
        print(f"[DRY-RUN] 预览（前 10 行）：")
        for p in result["preview"][:10]:
            mark = " ⚠️ 已截断" if p["truncated"] else ""
            print(f"  {p['index']:2d}. [{p['level']}] {p['title']}  ({p['word_count']} 字符){mark}")
        if len(result["preview"]) > 10:
            print(f"  ... 还有 {len(result['preview']) - 10} 节")
        print()
        print("[DRY-RUN] 看起来 OK 就去掉 --dry-run 重新执行实际推送。")
        return 0

    print("[OK] 推送成功")
    print(f"  标题：{result['title']}")
    print(f"  章节数：{result['sections']} 行")
    print(f"  docid：{result['docid']}")
    print(f"  url：{result['url']}")
    print()
    print("[复粘到企微群]")
    print(f"【报告】{result['title']} 已生成，点击查看：{result['url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
