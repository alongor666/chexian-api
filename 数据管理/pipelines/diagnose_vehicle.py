#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
车型/客户类别 全维度经营诊断脚本 v5.0（两阶段诊断支持）

11 板块可插拔架构 + --output-json（结构化 JSON 产出）+ --drilldown（追加聚合）。
板块定义见 sections/ 目录，注册表见 sections/__init__.py。

使用:
    # 标准诊断（Markdown + JSON）
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --title 营业货车 --output-json

    # 追加下钻（仅 JSON，不跑板块）
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --drilldown "厂牌车型" --output-json

    # 传统模式（仅 Markdown，向后兼容）
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --title 营业货车

版本: 5.0.0
日期: 2026-04-01
"""

import argparse, json, sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb"); sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_common import GLOB, OUT_DIR, detect_risk_field, query_kpi, set_fixed_cost_sql  # noqa: E402
from diagnose_context import RunContext  # noqa: E402
from diagnose_report import Report  # noqa: E402
from sections import SECTION_REGISTRY, SECTION_NAMES, ALL_SECTION_IDS  # noqa: E402
import fixed_cost_config  # noqa: E402


def _parse_ids(s: str) -> set:
    """解析逗号分隔的板块 ID"""
    return {int(x.strip()) for x in s.split(",") if x.strip()}


def _build_json_output(ctx, collected):
    """从 collected 构建分层 JSON（L0 身份 + L1 健康 + L2 深挖 + findings）"""
    yr_data = collected.get(1, {}).get("yr_data", {})
    vt_data = collected.get(2, {}).get("vt_data", {})
    vt_names = collected.get(2, {}).get("vt_names", [])
    en_data = collected.get(3, {}).get("en_data", {})
    gr_data = collected.get(4, {}).get("gr_data", {})
    s9 = collected.get(9, {})

    # L0 身份
    total_prem = sum((d.get("written_premium") or 0) for d in yr_data.values())
    dominant_vt = max(vt_data.items(), key=lambda x: x[1].get("policy_count", 0), default=("", {}))
    total_vt_pol = sum((d.get("policy_count") or 0) for d in vt_data.values())
    l0 = {
        "total_premium_wan": round(total_prem, 1),
        "total_policies": ctx.total_pol,
        "years_covered": len(ctx.years),
        "dominant_vehicle_type": dominant_vt[0],
        "dominant_vehicle_type_pct": round(
            dominant_vt[1].get("policy_count", 0) / total_vt_pol * 100, 1
        ) if total_vt_pol > 0 else 0,
    }

    # L1 健康
    latest_yr = ctx.years[-1] if ctx.years else None
    latest_d = yr_data.get(latest_yr, {})
    lr = latest_d.get("loss_ratio") or 0
    fr = latest_d.get("expense_ratio") or 0
    vc = lr + fr
    vc_light = "🔴" if vc > 94 else "🟡" if vc > 91 else "🔵" if vc > 85 else "🟢"

    # 趋势方向
    margins = [(yr, (yr_data.get(yr, {}).get("earned_margin") or 0)) for yr in ctx.years]
    loss_ratios = [(yr, (yr_data.get(yr, {}).get("loss_ratio") or 0)) for yr in ctx.years]
    worst_lr = max(loss_ratios, key=lambda x: x[1], default=(None, 0))

    def _direction(vals):
        if len(vals) < 2:
            return "insufficient_data"
        first, last = vals[0][1], vals[-1][1]
        if first == 0:
            return "from_zero"
        change = (last - first) / abs(first) * 100
        if change > 20:
            return "rising"
        elif change < -20:
            return "falling"
        elif last > 0 and any(v[1] < 0 for v in vals[:-1]):
            return "recovering"
        return "stable"

    # alerts 从 year_summary 生成
    alerts = []
    for ys in s9.get("year_summary", []):
        y, yvc, ylight = ys["year"], ys["variable_cost_rate"], ys["light"]
        if ylight == "🔴":
            alerts.append(f"🔴 {y}年危险：变动成本率{yvc}%")
        elif ylight == "🟡":
            alerts.append(f"🟡 {y}年预警：变动成本率{yvc}%")

    l1 = {
        "latest_year": {
            "year": latest_yr,
            "variable_cost_rate": round(vc, 1),
            "variable_cost_light": vc_light,
            "margin_rate": round(100 - vc, 1),
            "loss_ratio": round(lr, 1),
            "incident_rate": round(latest_d.get("incident_rate") or 0, 1),
            "expense_ratio": round(fr, 1),
            "earned_margin_wan": round(latest_d.get("earned_margin") or 0, 1),
            "projected_margin_wan": round(latest_d.get("projected_margin") or 0, 1),
            "combined_cost_ratio": round(latest_d.get("combined_cost_ratio") or 0, 1) if latest_d.get("combined_cost_ratio") is not None else None,
            "profit_amount_wan": round(latest_d.get("profit_amount") or 0, 1) if latest_d.get("profit_amount") is not None else None,
            "policy_count": latest_d.get("policy_count") or 0,
            "avg_premium_yuan": latest_d.get("avg_premium") or 0,
        },
        "trend": {
            "margin_direction": _direction(margins),
            "loss_ratio_direction": _direction([(y, -v) for y, v in loss_ratios]),
            "worst_year": worst_lr[0],
            "worst_year_loss_ratio": round(worst_lr[1], 1),
        },
        "alerts": alerts,
    }

    # L2 深挖
    def _dim_summary(data_dict):
        out = {}
        for name, d in data_dict.items():
            lr_val = d.get("loss_ratio") or 0
            fr_val = d.get("expense_ratio") or 0
            out[name] = {
                "variable_cost_rate": round(lr_val + fr_val, 1),
                "margin_wan": round(d.get("earned_margin") or 0, 1),
                "policy_count": d.get("policy_count") or 0,
                "loss_ratio": round(lr_val, 1),
                "expense_ratio": round(fr_val, 1),
                "written_premium_wan": round(d.get("written_premium") or 0, 1),
            }
        return out

    l2 = {
        "by_vehicle_type": _dim_summary(vt_data),
        "by_risk_grade": _dim_summary(gr_data),
        "by_energy": _dim_summary(en_data),
        "by_year": {str(yr): {
            "variable_cost_rate": round((yr_data.get(yr, {}).get("loss_ratio") or 0) +
                                       (yr_data.get(yr, {}).get("expense_ratio") or 0), 1),
            "margin_wan": round(yr_data.get(yr, {}).get("earned_margin") or 0, 1),
            "policy_count": yr_data.get(yr, {}).get("policy_count") or 0,
            "loss_ratio": round(yr_data.get(yr, {}).get("loss_ratio") or 0, 1),
        } for yr in ctx.years},
    }

    return {
        "meta": {
            "title": ctx.title,
            "filter": ctx.base_where,
            "years": ctx.years,
            "compare": "ytd" if ctx.is_ytd else "full",
            "max_sign_date": ctx.max_sign,
            "total_policies": ctx.total_pol,
            "generated_at": datetime.now().isoformat(),
        },
        "L0_identity": l0,
        "L1_health": l1,
        "L2_deep": l2,
        "findings": s9.get("findings", []),
        "next_steps": s9.get("next_steps", []),
    }


def _run_drilldown(args):
    """--drilldown 快速路径：仅 GROUP BY 聚合，输出 JSON"""
    con = duckdb.connect()
    base_where = args.filter
    group_col = args.drilldown

    ytd_filter = ""
    if args.years and args.compare != "full":
        # drilldown 默认 full，除非显式指定
        pass

    yr_clause = ""
    if args.years:
        yr_parts = args.years.split("-")
        min_yr = int(yr_parts[0])
        max_yr = int(yr_parts[1]) if len(yr_parts) > 1 else int(yr_parts[0])
        yr_clause = f" AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}"

    full_where = f"{base_where}{yr_clause}"
    rows = query_kpi(con, full_where, group_col=group_col)

    # 转为输出结构
    data = []
    for row in rows:
        entry = {"dim_value": row.get(group_col, "")}
        lr = row.get("loss_ratio") or 0
        fr = row.get("expense_ratio") or 0
        entry["policy_count"] = row.get("policy_count") or 0
        entry["written_premium_wan"] = row.get("written_premium") or 0
        entry["loss_ratio"] = round(lr, 1)
        entry["expense_ratio"] = round(fr, 1)
        entry["variable_cost_rate"] = round(lr + fr, 1)
        entry["margin_wan"] = row.get("earned_margin") or 0
        entry["incident_rate"] = row.get("incident_rate") or 0
        entry["avg_premium_yuan"] = row.get("avg_premium") or 0
        entry["avg_claim_yuan"] = row.get("avg_claim") or 0
        entry["pricing_coeff"] = row.get("pricing_coeff") or 0
        data.append(entry)

    # 按保费降序
    data.sort(key=lambda x: x.get("written_premium_wan", 0), reverse=True)

    output = {
        "drilldown_by": group_col,
        "filter": base_where,
        "years": args.years or "all",
        "total_rows": len(data),
        "data": data,
    }

    # 输出
    safe_col = "".join(c for c in group_col if c.isalnum() or c in "._- ")[:20]
    fname = f"drilldown_{safe_col}.json"
    out = Path(args.output) / fname
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ {out} ({len(data)} 行)")
    return output


def main():
    parser = argparse.ArgumentParser(description="车型/客户类别全维度经营诊断 v5.0")
    parser.add_argument("--filter", required=True, help="SQL WHERE 条件")
    parser.add_argument("--title", default=None, help="报告标题")
    parser.add_argument("--years", default=None, help="年份范围，如: 2022-2026")
    parser.add_argument("--compare", choices=["ytd", "full"], default=None,
                        help="YoY 对比口径: ytd=同期对比, full=全年对比")
    parser.add_argument("--no-summary", action="store_true", help="跳过诊断总结板块")
    parser.add_argument("--sections", default=None, help="仅运行指定板块，如: 1,5,9")
    parser.add_argument("--skip", default=None, help="跳过指定板块，如: 3,4")
    parser.add_argument("--output", default=OUT_DIR, help="输出目录")
    parser.add_argument("--output-json", action="store_true",
                        help="额外输出结构化 JSON（L0/L1/L2 分层，供 Phase 2 诊断研判）")
    parser.add_argument("--drilldown", default=None, metavar="GROUP_COL",
                        help="追加聚合模式：按指定列 GROUP BY，仅输出 JSON（跳过板块编排）")
    args = parser.parse_args()

    # --drilldown 快速路径
    if args.drilldown:
        _run_drilldown(args)
        return

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
    # --output-json 需要 s09 数据
    if args.output_json and 9 not in requested:
        requested.add(9)
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

    # 加载固定成本配置（优雅降级：配置不存在则 fc_sql=None）
    fc_params = fixed_cost_config.load()
    fc_sql = fixed_cost_config.build_fixed_cost_sql(fc_params) if fc_params else None
    set_fixed_cost_sql(fc_sql)

    # 构建上下文
    ctx = RunContext(
        con=con, base_where=base_where, years=years,
        min_yr=min_yr, max_yr=max_yr, yr_where=yr_where,
        risk_expr=risk_expr, title=title,
        max_sign=str(max_sign), max_start=str(max_start),
        total_pol=total_pol, total_rec=total_rec,
        is_ytd=is_ytd, ytd_label=ytd_label,
        fixed_cost_sql=fc_sql,
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
        # --output-json + --no-summary 时，s09 静默运行（只产数据不输出 Markdown）
        s_silent = (sid == 9 and args.no_summary)
        section.run(ctx, rpt, collected, silent=s_silent)

    # --no-summary 占位
    if args.no_summary and 9 not in requested:
        rpt.add("---\n")
        rpt.add("> 诊断结论和关键发现由专项 skill/agent 生成，此处省略。\n")

    # Save Markdown
    safe_title = "".join(c for c in title if c.isalnum() or c in "._- ")[:20]
    fname = f"{safe_title}_经营诊断_{min_yr}_{max_yr}_截至{max_sign}.md"
    out = Path(args.output) / fname
    out.write_text("\n".join(rpt.lines), encoding="utf-8")
    print(f"\n✅ {out} ({len(rpt.lines)} 行)")

    # Save JSON（--output-json）
    if args.output_json:
        json_data = _build_json_output(ctx, collected)
        json_fname = f"{safe_title}_诊断_{min_yr}_{max_yr}_截至{max_sign}.json"
        json_out = Path(args.output) / json_fname
        json_out.write_text(json.dumps(json_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"✅ {json_out} (JSON)")


if __name__ == "__main__":
    main()
