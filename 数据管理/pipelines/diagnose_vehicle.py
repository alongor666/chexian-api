#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
车型/客户类别 全维度经营诊断脚本 v4.0（板块拆分版）

9 板块可插拔架构，支持 --sections/--skip 按需选择。
板块定义见 sections/ 目录，注册表见 sections/__init__.py。

使用:
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'"
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --title 营业货车
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'" --sections 1,5,9
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'" --skip 3,4

版本: 4.1.0
作者: @claude
日期: 2026-03-31
"""

import argparse, sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb"); sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_common import GLOB, OUT_DIR, detect_risk_field  # noqa: E402
from diagnose_context import RunContext  # noqa: E402
from diagnose_report import Report  # noqa: E402
from sections import SECTION_REGISTRY, SECTION_NAMES, ALL_SECTION_IDS  # noqa: E402


def _parse_ids(s: str) -> set:
    """解析逗号分隔的板块 ID"""
    return {int(x.strip()) for x in s.split(",") if x.strip()}


def main():
    parser = argparse.ArgumentParser(description="车型/客户类别全维度经营诊断 v4.1")
    parser.add_argument("--filter", required=True, help="SQL WHERE 条件")
    parser.add_argument("--title", default=None, help="报告标题")
    parser.add_argument("--years", default=None, help="年份范围，如: 2022-2026")
    parser.add_argument("--compare", choices=["ytd", "full"], default=None,
                        help="YoY 对比口径: ytd=同期对比, full=全年对比")
    parser.add_argument("--no-summary", action="store_true", help="跳过诊断总结板块")
    parser.add_argument("--sections", default=None, help="仅运行指定板块，如: 1,5,9")
    parser.add_argument("--skip", default=None, help="跳过指定板块，如: 3,4")
    parser.add_argument("--output", default=OUT_DIR, help="输出目录")
    args = parser.parse_args()

    # --sections 和 --skip 互斥
    if args.sections and args.skip:
        print("❌ --sections 和 --skip 不可同时指定"); sys.exit(1)

    # 解析板块选择
    if args.sections:
        requested = _parse_ids(args.sections)
        unknown = requested - set(ALL_SECTION_IDS)
        if unknown:
            print(f"❌ 未知板块 ID: {unknown}，有效范围 {ALL_SECTION_IDS}"); sys.exit(1)
    elif args.skip:
        skip_ids = _parse_ids(args.skip)
        unknown = skip_ids - set(ALL_SECTION_IDS)
        if unknown:
            print(f"❌ 未知板块 ID: {unknown}，有效范围 {ALL_SECTION_IDS}"); sys.exit(1)
        requested = set(ALL_SECTION_IDS) - skip_ids
    else:
        requested = set(ALL_SECTION_IDS)

    if args.no_summary:
        requested.discard(9)
    if not requested:
        print("❌ 至少需要运行一个板块"); sys.exit(1)

    # DuckDB 连接 + 元数据
    con = duckdb.connect()
    base_where = args.filter
    title = args.title or args.filter

    meta = con.execute(f"""
    SELECT MAX(签单日期)::DATE, MAX(保险起期)::DATE, COUNT(DISTINCT 保单号)::INT, COUNT(*)::INT,
           MIN(YEAR(签单日期))::INT, MAX(YEAR(签单日期))::INT
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where}
    """).fetchone()
    max_sign, max_start, total_pol, total_rec, min_yr, max_yr = meta
    if args.years:
        yr_parts = args.years.split("-")
        min_yr = int(yr_parts[0])
        max_yr = int(yr_parts[1]) if len(yr_parts) > 1 else int(yr_parts[0])
    years = list(range(min_yr, max_yr + 1))

    # YTD 口径检测
    if max_sign is None:
        print(f"\n❌ 筛选条件未命中任何保单，无法生成诊断报告。"); sys.exit(1)
    _ms = datetime.strptime(str(max_sign), "%Y-%m-%d").date() if isinstance(max_sign, str) else max_sign
    ytd_month, ytd_day = _ms.month, _ms.day
    latest_year_incomplete = not (ytd_month == 12 and ytd_day >= 25)

    compare_mode = args.compare
    if compare_mode is None and latest_year_incomplete:
        print(f"\n⚠️  最新签单日期 {max_sign}，{max_yr}年数据不完整。")
        print(f"   YoY 对比口径选择：")
        print(f"     [1] 同期对比 — 各年均取 1月1日-{ytd_month}月{ytd_day}日（推荐，增长率可比）")
        print(f"     [2] 全年对比 — 历史年用全年，{max_yr}年用已有数据（保费/赔款等绝对值更完整）")
        try:
            choice = input("   请选择 [1/2]（默认1）: ").strip()
        except (EOFError, KeyboardInterrupt):
            choice = "1"
        compare_mode = "full" if choice == "2" else "ytd"
    elif compare_mode is None:
        compare_mode = "full"

    is_ytd = (compare_mode == "ytd") and latest_year_incomplete
    if is_ytd:
        ytd_filter = f"AND (MONTH(签单日期) < {ytd_month} OR (MONTH(签单日期) = {ytd_month} AND DAY(签单日期) <= {ytd_day}))"
        ytd_label = f"1月1日-{ytd_month}月{ytd_day}日"
    else:
        ytd_filter = ""
        ytd_label = "全年"

    def yr_where(yr: int) -> str:
        return f"YEAR(签单日期) = {yr} {ytd_filter}"

    risk_expr = detect_risk_field(con, base_where)
    print(f"\n🔍 诊断: {title}")
    print(f"   {total_pol:,d} 保单 | {min_yr}-{max_yr} | 风险字段: {risk_expr}")
    print(f"   📊 YoY 口径: {ytd_label}" + (f"（最新签单日期 {max_sign}，同期对齐）" if is_ytd else ""))
    if requested != set(ALL_SECTION_IDS):
        names = [f"{sid}.{SECTION_NAMES[sid]}" for sid in sorted(requested)]
        print(f"   📋 板块: {', '.join(names)}")

    # 构建上下文
    ctx = RunContext(
        con=con, base_where=base_where, years=years,
        min_yr=min_yr, max_yr=max_yr, yr_where=yr_where,
        risk_expr=risk_expr, title=title,
        max_sign=str(max_sign), max_start=str(max_start),
        total_pol=total_pol, total_rec=total_rec,
        is_ytd=is_ytd, ytd_label=ytd_label,
    )

    rpt = Report()

    # Header
    rpt.add(f"# {title} 经营诊断报告（{min_yr}-{max_yr}）")
    rpt.add()
    rpt.add(f"> **最新签单日期**: {max_sign} | **最新起保日期**: {max_start}")
    rpt.add(f"> **生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')} | **数据来源**: policy/current/ 分片")
    rpt.add(f"> **筛选条件**: {base_where} | 总计 {total_pol:,d} 保单 / {total_rec:,d} 条记录")
    rpt.add(f"> **金额单位**: 万元（† 标注项为元） | **亮灯**: 🟢正常 🔵关注 🟡预警 🔴危险")
    if is_ytd:
        rpt.add(f"> **YoY 口径**: 各年均取 **{ytd_label}** 签单数据对比，确保同比可比")
    else:
        rpt.add(f"> **YoY 口径**: 全年对比")
    rpt.add()
    rpt.add("---\n")

    # 编排循环
    collected = {}
    for sid in sorted(requested):
        section = SECTION_REGISTRY[sid]
        section.run(ctx, rpt, collected, silent=False)

    # --no-summary 占位
    if args.no_summary and 9 not in requested:
        rpt.add("---\n")
        rpt.add("> 诊断结论和关键发现由专项 skill/agent 生成，此处省略。\n")

    # Save
    safe_title = "".join(c for c in title if c.isalnum() or c in "._- ")[:20]
    fname = f"{safe_title}_经营诊断_{min_yr}_{max_yr}_截至{max_sign}.md"
    out = Path(args.output) / fname
    out.write_text("\n".join(rpt.lines), encoding="utf-8")
    print(f"\n✅ {out} ({len(rpt.lines)} 行)")


if __name__ == "__main__":
    main()
