#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 v2.2 — CLI 编排入口（三级机构经营盯盘 + 分公司视角 + 三级机构视角模板）

本文件只负责：命令行参数 → 时间窗口解析 → 构建 base → 顺序调用 6 大板块 → 落盘。
实现分层（单一职责，依赖树无环）：
  renewal_common.py          共享口径常量 + Report + rate/light（依赖叶子，人人 import）
  renewal_resp_mode.py       责任模式清单加载（Excel/CSV → 车架号→责任模式）
  renewal_sections.py        主报告 6 大板块 section 函数 + base/overview/header
  diagnose_renewal.py        ← 本文件：argparse + resolve_window + main() 编排
  diagnose_renewal_branch.py 分公司视角 6 表（--branch-report，import renewal_common）

业务口径（用户 2026-06-06 确认，见 memory domain_renewal_responsibility_mode /
project_telesales_terminal_source / domain_renewal_timeliness_anchor）：
  · 应续 = 落入 expiry 窗口的去重车架号。
  · 责任模式：电销续保/网电电续/微保电续→电销自留；兜底→业务员兜底；白名单→电销转保；不在清单→业务员自留。
  · 电销渠道（实际成交）：签单清单 terminal_source='0110融合销售' 即电销。
  · 报价时效以进盘锚点衡量：进盘日 = 到期日 - pool_lead_days（默认 30）；首日/首周 = 进盘后 1/7 天内。

用法：
  python3 数据管理/pipelines/diagnose_renewal.py --year 2026                                  # 全年应续（按月切片）
  python3 数据管理/pipelines/diagnose_renewal.py --time-view custom --start 2026-06-01 --end 2026-06-30
  python3 数据管理/pipelines/diagnose_renewal.py --time-view custom --start 2026-06-01 --end 2026-06-30 --org <机构名>
  python3 数据管理/pipelines/diagnose_renewal.py --resp-mode-list 责任模式清单.xlsx --time-view mtd_today
  python3 数据管理/pipelines/diagnose_renewal.py --branch-report                              # 分公司视角 6 表
  python3 数据管理/pipelines/diagnose_renewal.py ... --pool-lead-days 60                      # 调整进盘锚点提前期
  python3 数据管理/pipelines/diagnose_renewal.py ... --no-action-list                         # 不落 CSV
"""

import argparse
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from renewal_common import (  # noqa: E402
    DEFAULT_LIST,
    OUT_DIR,
    POOL_LEAD_DEFAULT,
    Report,
    customer_category_clause,
    customer_category_label,
)
from renewal_sections import (  # noqa: E402
    Ctx,
    build_base,
    overview,
    section_followup,
    section_org_drill,
    section_org_overview,
    section_pricing_anomaly,
    section_progress,
    section_supplementary,
    write_header,
)


def resolve_window(args):
    """返回 (start: date, end: date, label: str, by_month: bool)。"""
    today = date.today()
    tv = args.time_view
    if tv in ("ytd", "by_month"):
        return date(args.year, 1, 1), date(args.year, 12, 31), f"{args.year}全年", True
    if tv == "mtd_today":
        start = today.replace(day=1)
        return start, today, f"{today:%Y年%m月}当月至{today:%m-%d}", False
    if tv == "next_to_eom":
        eom = today.replace(day=monthrange(today.year, today.month)[1])
        return today, eom, f"{today:%m-%d}至月末{eom:%m-%d}", False
    if tv == "next_30_days":
        return today, today + timedelta(days=30), f"未来30天({today:%m-%d}~{today + timedelta(days=30):%m-%d})", False
    if tv == "custom":
        if not args.start or not args.end:
            sys.exit("❌ --time-view custom 需同时提供 --start 与 --end")
        s = datetime.strptime(args.start, "%Y-%m-%d").date()
        e = datetime.strptime(args.end, "%Y-%m-%d").date()
        return s, e, f"{s:%Y-%m-%d}至{e:%Y-%m-%d}", False
    sys.exit(f"❌ 未知 time-view: {tv}")


def main():
    ap = argparse.ArgumentParser(description="续保诊断 v2.2 三级机构经营盯盘 + 分公司视角 + 三级机构视角模板")
    ap.add_argument("--time-view", default="ytd",
                    choices=["ytd", "by_month", "mtd_today", "next_to_eom", "next_30_days", "custom"])
    ap.add_argument("--year", type=int, default=date.today().year)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--org", help="三级机构模糊匹配")
    ap.add_argument("--team", help="销售团队模糊匹配")
    ap.add_argument("--customer-category",
                    help="客户类别精确筛选（枚举值，如「非营业个人客车」；逗号分隔多值，IN 匹配）；"
                         "对主报告/分公司视角(--branch-report)/三级机构视角(--org-report)均生效")
    ap.add_argument("--pool-lead-days", type=int, default=POOL_LEAD_DEFAULT,
                    help=f"进盘锚点提前期（天），进盘日=到期日-该值，默认 {POOL_LEAD_DEFAULT}")
    ap.add_argument("--renewal-list", default=str(DEFAULT_LIST) if DEFAULT_LIST else None,
                    help="wecom 电销续保清单（名单类型映射），默认 iCloud 路径；SX 等未配默认省份须显式传")
    ap.add_argument("--resp-mode-list", help="专项责任模式清单（含「责任模式」列，优先于 --renewal-list，支持 .xlsx/.csv）")
    ap.add_argument("--branch-report", action="store_true",
                    help="分公司视角模式：输出 7 张三级机构窗口表（当月已到期/临期7天/未到期/当月/当年已到期 + 首日/首周可续期响应），"
                         "以数据截止日当天所在月/年为窗口，忽略 --time-view/--start/--end")
    ap.add_argument("--org-report", action="store_true",
                    help="三级机构视角模式（模板）：锁定单一三级机构（--org 必填），同样 7 张窗口表，"
                         "但分组维度为业务员、统一展示当月应续 top15（以有续保业务员数为上限，不足则全列）固定同一批人，"
                         "合计=该机构全部业务员真实整体；以数据截止日当天所在月/年为窗口，忽略 --time-view/--start/--end")
    ap.add_argument("--top-n", type=int, default=15,
                    help="三级机构视角（--org-report）展示业务员数上限，按当月应续降序选取，"
                         "以「当月有续保业务员数」为天然上限（不足则全列），默认 15")
    ap.add_argument("--no-action-list", action="store_true", help="不落 CSV")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()

    if args.org_report:
        from diagnose_renewal_branch import run_org_report  # lazy：仅三级机构视角模式才加载
        run_org_report(con, args, out_dir, ts)
        return

    if args.branch_report:
        from diagnose_renewal_branch import run_branch_report  # lazy：仅分公司视角模式才加载
        run_branch_report(con, args, out_dir, ts)
        return

    start, end, label, by_month = resolve_window(args)
    today = date.today()
    where = [f"expiry_date >= DATE '{start}'", f"expiry_date <= DATE '{end}'"]
    if args.org:
        where.append(f"org_level_3 ILIKE '%{args.org}%'")
    if args.team:
        where.append(f"team_name ILIKE '%{args.team}%'")
    cc_clause = customer_category_clause(args.customer_category)
    if cc_clause:
        where.append(cc_clause)
        label += f" · {customer_category_label(args.customer_category)}"
    where_sql = " AND ".join(where)

    if not build_base(con, where_sql):
        sys.exit(f"❌ 窗口内无数据：{label}（检查 renewal_tracker expiry 覆盖范围）")

    yc_all, q_all, r_all, qr_all, rr_all = overview(con)
    ctx = Ctx(today=today, start=start, end=end, label=label, by_month=by_month,
              pool_lead=args.pool_lead_days, immature=(end > today),
              yc_all=yc_all, q_all=q_all, r_all=r_all, qr_all=qr_all, rr_all=rr_all,
              args=args, out_dir=out_dir, ts=ts)

    rpt = Report()
    write_header(rpt, ctx)
    ctx.org_rows = section_org_overview(con, rpt, ctx)   # 板块一产出 org_rows
    section_progress(con, rpt, ctx)
    section_pricing_anomaly(con, rpt, ctx)
    sm_csv = section_org_drill(con, rpt, ctx)            # 板块四消费 ctx.org_rows
    section_supplementary(con, rpt, ctx)
    act_csv, overdue_csv = section_followup(con, rpt, ctx)

    md_path = out_dir / f"续保诊断_{label}_{ts}.md"
    md_path.write_text(rpt.text(), encoding="utf-8")
    print(f"✅ 报告 → {md_path}")
    for c in (sm_csv, act_csv, overdue_csv):
        if c:
            print(f"✅ CSV  → {c}")


if __name__ == "__main__":
    main()
