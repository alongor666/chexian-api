"""扫描本地 + VPS 现存 diagnose-* 报告目录，回填到归档表。

策略：
1. 本地：扫 server/data/reports/<report-type>/<YYYY-MM-DD>/ 的子目录
2. VPS：ssh ls /var/www/chexian/server/data/reports/<report-type>/，与本地合并去重
3. 报告 URL = https://chexian.cretvalu.com/api/reports/<report-type>/<date>/<entrypoint>
4. entrypoint 规则：
   - diagnose-loss-development: preview-mvp.html
   - diagnose-period-trend: <date>-dashboard.html (三视图都有，挑 dashboard 作主链接)
   - diagnose-org-weekly: <机构>_周报.html (难以从目录名推断，留 TODO)
5. 每条调用 push_report.py 的 main 函数（不走 shell，省 fork）

用法：
    python3 数据管理/integrations/lark_bitable/backfill_history.py \
        --report-type diagnose-loss-development
    python3 数据管理/integrations/lark_bitable/backfill_history.py --all
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# project root = 上溯三层 (integrations/lark_bitable -> integrations -> 数据管理 -> root)
PROJECT_ROOT = Path(__file__).resolve().parents[3]

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SSH_ALIAS = "chexian-vps-deploy"

# 两类报告的存储语义完全不同：
# - loss-development：受鉴权 API 托管，VPS 路径 server/data/reports/<slug>/<date>/<entrypoint>
#   URL = /api/reports/<slug>/<date>/<entrypoint>
# - period-trend：前端静态资源，VPS 路径 frontend/dist/reports/<slug>/<date>-<view>.html（扁平）
#   URL = /reports/<slug>/<date>-<view>.html
REPORT_TYPE_CONFIG = {
    "diagnose-loss-development": {
        "vps_root": "/var/www/chexian/server/data/reports/diagnose-loss-development",
        "local_root": PROJECT_ROOT / "server" / "data" / "reports" / "diagnose-loss-development",
        "url_template": lambda date, filename: (
            f"https://chexian.cretvalu.com/api/reports/diagnose-loss-development/{date}/{filename}"
        ),
        "entrypoint": lambda date: "preview-mvp.html",
        "has_date_subdir": True,
    },
    "diagnose-period-trend": {
        "vps_root": "/var/www/chexian/frontend/dist/reports/diagnose-period-trend",
        "local_root": PROJECT_ROOT / "public" / "reports" / "diagnose-period-trend",
        "url_template": lambda date, filename: (
            f"https://chexian.cretvalu.com/reports/diagnose-period-trend/{filename}"
        ),
        "entrypoint": lambda date: f"{date}-dashboard.html",
        "has_date_subdir": False,
    },
}


def scan_local(report_type: str) -> set[str]:
    cfg = REPORT_TYPE_CONFIG[report_type]
    root = cfg["local_root"]
    if not root.exists():
        return set()
    if cfg["has_date_subdir"]:
        return {p.name for p in root.iterdir() if p.is_dir() and DATE_RE.match(p.name)}
    # 扁平文件命名：从 <date>-<view>.html 提取日期
    dates = set()
    for p in root.iterdir():
        if not p.is_file() or not p.name.endswith(".html"):
            continue
        m = re.match(r"^(\d{4}-\d{2}-\d{2})-.*\.html$", p.name)
        if m:
            dates.add(m.group(1))
    return dates


def scan_vps(report_type: str) -> set[str]:
    cfg = REPORT_TYPE_CONFIG[report_type]
    root = cfg["vps_root"]
    if cfg["has_date_subdir"]:
        cmd = f"ls -d {root}/*/ 2>/dev/null"
    else:
        cmd = f"ls {root}/ 2>/dev/null"
    try:
        result = subprocess.run(
            ["ssh", SSH_ALIAS, cmd],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except subprocess.TimeoutExpired:
        print("[warn] VPS ssh 超时，跳过 VPS 扫描", file=sys.stderr)
        return set()
    dates = set()
    if cfg["has_date_subdir"]:
        for line in result.stdout.splitlines():
            parts = line.rstrip("/").split("/")
            if parts and DATE_RE.match(parts[-1]):
                dates.add(parts[-1])
    else:
        for line in result.stdout.splitlines():
            m = re.match(r"^(\d{4}-\d{2}-\d{2})-.*\.html$", line.strip())
            if m:
                dates.add(m.group(1))
    return dates


def get_vps_file_size_kb(report_type: str, date: str, filename: str) -> int | None:
    cfg = REPORT_TYPE_CONFIG[report_type]
    if cfg["has_date_subdir"]:
        path = f"{cfg['vps_root']}/{date}/{filename}"
    else:
        path = f"{cfg['vps_root']}/{filename}"
    try:
        result = subprocess.run(
            ["ssh", SSH_ALIAS, f"stat -c%s {path} 2>/dev/null"],
            capture_output=True, text=True, timeout=15, check=False,
        )
        if result.stdout.strip().isdigit():
            return int(result.stdout.strip()) // 1024
    except Exception:
        pass
    return None


def count_subpages_local(report_type: str, date: str) -> int | None:
    cfg = REPORT_TYPE_CONFIG[report_type]
    if not cfg["has_date_subdir"]:
        return None  # 扁平存储无下钻子页
    drill_dir = cfg["local_root"] / date / "drill"
    if drill_dir.exists():
        return sum(1 for _ in drill_dir.rglob("*.html"))
    return None


def backfill_one_type(report_type: str, dry_run: bool = False) -> None:
    if report_type not in REPORT_TYPE_CONFIG:
        print(f"[skip] {report_type}: 未在 REPORT_TYPE_CONFIG 中定义", file=sys.stderr)
        return
    cfg = REPORT_TYPE_CONFIG[report_type]
    local_dates = scan_local(report_type)
    vps_dates = scan_vps(report_type)
    all_dates = sorted(local_dates | vps_dates)
    print(f"\n=== {report_type} ===")
    print(f"  本地: {len(local_dates)} 期")
    print(f"  VPS:  {len(vps_dates)} 期")
    print(f"  合计: {len(all_dates)} 期")
    if not all_dates:
        return

    for date in all_dates:
        entrypoint = cfg["entrypoint"](date)
        url = cfg["url_template"](date, entrypoint)
        sub_pages = count_subpages_local(report_type, date)
        vps_size = get_vps_file_size_kb(report_type, date, entrypoint)
        in_vps = "✅" if date in vps_dates else "❌(已丢)"
        print(f"  · {date}  {in_vps}  url={url}  subpages={sub_pages}  vps_kb={vps_size}")

        if dry_run:
            continue

        args = [
            sys.executable,
            str(Path(__file__).parent / "push_report.py"),
            "--report-type", report_type,
            "--date", date,
            "--url", url,
            "--report-name", entrypoint,
            "--note", f"historical backfill ({'in-vps' if date in vps_dates else 'vps-missing'})",
        ]
        if sub_pages is not None:
            args.extend(["--sub-pages", str(sub_pages)])
        if vps_size is not None:
            args.extend(["--vps-size-kb", str(vps_size)])
        result = subprocess.run(args, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            print(f"    [push 失败] {result.stdout} {result.stderr}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report-type", choices=list(REPORT_TYPE_CONFIG.keys()))
    parser.add_argument("--all", action="store_true", help="回填所有支持的报告类型")
    parser.add_argument("--dry-run", action="store_true", help="只列计划不写入")
    args = parser.parse_args()

    if args.all:
        targets = list(REPORT_TYPE_CONFIG.keys())
    elif args.report_type:
        targets = [args.report_type]
    else:
        parser.error("必须指定 --report-type 或 --all")

    for rt in targets:
        backfill_one_type(rt, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
