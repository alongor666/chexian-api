"""Markdown 报告 → 单页 HTML（带项目设计系统配色 + 表格 + 亮灯 emoji 颜色）。

用法：
    python3 scripts/ad-hoc/render_md_to_html.py <md 路径> [-o <html 路径>] [--title 标题]

输出：
    与 md 同目录、同 stem 的 .html 文件（除非 -o 指定）
    含 `<!-- FEEDBACK_URL -->` 占位符，便于 push_html.py 注入反馈表链接。
"""

from __future__ import annotations
import argparse
import sys
from pathlib import Path

import markdown

CSS = """
:root{
  --bg:#f6f8fa; --card:#fff; --text:#1f2937; --muted:#6b7280;
  --border:#e5e7eb; --accent:#2563eb;
  --table-head:#f3f4f6; --table-stripe:#fafbfc;
  --green:#16a34a; --yellow:#ca8a04; --red:#dc2626;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:14px;line-height:1.6}
.container{max-width:1280px;margin:0 auto;padding:32px 24px 80px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;
  padding:24px 28px;box-shadow:0 1px 3px rgba(0,0,0,0.04);margin-bottom:24px}
h1{font-size:22px;margin:0 0 16px;color:#0f172a;border-bottom:2px solid var(--accent);
  padding-bottom:10px}
h2{font-size:18px;margin:32px 0 12px;color:#0f172a;border-left:4px solid var(--accent);
  padding-left:12px;background:#f8fafc;padding-top:8px;padding-bottom:8px;border-radius:0 6px 6px 0}
h3{font-size:15px;margin:20px 0 8px;color:#374151;font-weight:600}
p{margin:8px 0;color:#374151}
hr{border:none;border-top:1px dashed var(--border);margin:24px 0}
strong{color:#0f172a}
table{width:100%;border-collapse:collapse;margin:8px 0 20px;
  font-size:13px;background:var(--card);font-variant-numeric:tabular-nums}
thead th{background:var(--table-head);color:#374151;font-weight:600;text-align:right;
  padding:8px 10px;border:1px solid var(--border);white-space:nowrap}
thead th:first-child, thead th:nth-child(2){text-align:left}
tbody td{padding:7px 10px;border:1px solid var(--border);text-align:right;white-space:nowrap}
tbody td:first-child, tbody td:nth-child(2){text-align:left;color:#374151}
tbody tr:nth-child(even){background:var(--table-stripe)}
tbody tr:hover{background:#eff6ff}
.footer{color:var(--muted);font-size:12px;text-align:center;margin-top:32px}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:6px}
.tag-meta{background:#eef2ff;color:#4338ca}
@media (max-width:768px){.container{padding:16px 12px}.card{padding:16px}h1{font-size:18px}
  table{font-size:12px}thead th,tbody td{padding:6px}}
"""


def main():
    ap = argparse.ArgumentParser(description="md→html (单页带样式)")
    ap.add_argument("md", help="markdown 文件路径")
    ap.add_argument("-o", "--out", help="HTML 输出路径（默认同目录同名 .html）")
    ap.add_argument("--title", help="HTML <title>（默认从 md 首个 h1 提取）")
    args = ap.parse_args()

    md_path = Path(args.md).resolve()
    if not md_path.exists():
        print(f"[ERROR] markdown 不存在: {md_path}", file=sys.stderr)
        sys.exit(1)

    md_text = md_path.read_text(encoding="utf-8")
    body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "sane_lists"])

    title = args.title
    if not title:
        for line in md_text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
    if not title:
        title = md_path.stem

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
<div class="container">
  <div class="card">
    {body}
  </div>
  <div class="footer">
    chexian-api · 由 ad-hoc 多维分析脚本生成 · 估值口径见正文
    <!-- FEEDBACK_URL -->
  </div>
</div>
</body>
</html>
"""

    out = Path(args.out).resolve() if args.out else md_path.with_suffix(".html")
    out.write_text(html, encoding="utf-8")
    print(f"[done] html written: {out}")
    print(f"[done] size: {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
