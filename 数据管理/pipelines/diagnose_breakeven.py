#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
盈亏平衡系数分析 — 反事实定价红线

假设赔款金额不变、费用率不变，反推各维度颗粒度的盈亏平衡自主系数。
公式：breakeven_coeff = current_coeff × loss_ratio / (1 - expense_ratio)

复用 diagnose_common.py 的 query_kpi() 获取标准 KPI，仅做后处理计算。
"""

import argparse
import sys
from datetime import datetime, date
from pathlib import Path

import duckdb

from diagnose_common import (
    GLOB, EARNED, POLICY_TERM, EARNED_DAYS, OUT_DIR,
    fw, fp, fi, fc, light, escape_sql,
    kpi_select, query_kpi, detect_risk_field,
)

# 新转续过户表达式（与 sections/s02_vehicle_type.py 一致）
VEHICLE_TYPE_EXPR = """CASE
    WHEN 是否新车 THEN '新车'
    WHEN 是否过户车 THEN '旧车过户'
    WHEN 是否续保 THEN '旧车续保'
    ELSE '旧车转保'
END"""

# 系数差距亮灯阈值 (关注, 预警, 危险)
TH_GAP = (-0.05, 0.00, 0.10)

MIN_POLICIES = 30  # 最小样本量


def compute_breakeven(row: dict) -> dict:
    """从标准 KPI 行计算盈亏平衡系数"""
    lr = row.get("loss_ratio")
    er = row.get("expense_ratio")
    coeff = row.get("pricing_coeff")
    if lr is None or er is None or coeff is None or coeff <= 0:
        return {"be_coeff": None, "gap": None, "multiplier": None}
    if er >= 100:
        return {"be_coeff": float("inf"), "gap": float("inf"), "multiplier": float("inf")}
    m = (lr / 100) / (1 - er / 100)
    be = round(coeff * m, 4)
    gap = round(be - coeff, 4)
    return {"be_coeff": be, "gap": gap, "multiplier": round(m, 4)}


def gap_light(gap):
    """系数差距亮灯"""
    if gap is None:
        return ""
    if gap == float("inf"):
        return " 🔴"
    return light(gap, TH_GAP, higher_worse=True)


def fmt_be(v):
    """盈亏平衡系数格式"""
    if v is None:
        return "—"
    if v == float("inf"):
        return "∞"
    return f"{v:.4f}"


def fmt_gap(v):
    """差距格式（带正负号）"""
    if v is None:
        return "—"
    if v == float("inf"):
        return "+∞"
    return f"{v:+.4f}"


def render_table(lines: list, rows: list, dim_name: str):
    """渲染一个维度的盈亏平衡表"""
    lines.append(f"| {dim_name} | 保单数 | 保费(万) | 赔付率 | 费用率 | 当前系数 | 平衡系数 | 差距 | 状态 |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---|")
    for r in rows:
        if (r.get("policy_count") or 0) < MIN_POLICIES:
            continue
        be = compute_breakeven(r)
        coeff = r.get("pricing_coeff")
        coeff_str = fc(coeff) if coeff else "仅交强"
        be_str = fmt_be(be["be_coeff"]) if coeff else "—"
        gap_str = fmt_gap(be["gap"]) if coeff else "—"
        gl = gap_light(be["gap"]) if coeff else ""
        lines.append(
            f"| {r['dim_label']} "
            f"| {fi(r.get('policy_count'))} "
            f"| {fw(r.get('written_premium'))} "
            f"| {fp(r.get('loss_ratio'))} "
            f"| {fp(r.get('expense_ratio'))} "
            f"| {coeff_str} "
            f"| {be_str} "
            f"| {gap_str} "
            f"| {gl} |"
        )
    lines.append("")


def query_dim(con, base_where: str, year_filter: str, dim_expr: str, dim_alias: str = "dim_label") -> list:
    """按维度查询 KPI（需要子查询因为 dim_expr 可能是 CASE WHEN）"""
    sel = kpi_select(dim_alias)
    sql = f"""
    SELECT {sel}
    FROM (
        SELECT *, {dim_expr} AS {dim_alias}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND {year_filter}
    ) sub
    GROUP BY {dim_alias}
    ORDER BY SUM(保费) DESC
    """
    result = con.execute(sql)
    cols = [d[0] for d in result.description]
    return [dict(zip(cols, row)) for row in result.fetchall()]


def main():
    parser = argparse.ArgumentParser(description="盈亏平衡系数分析 — 反事实定价红线")
    parser.add_argument("--filter", required=True, help="SQL WHERE 条件")
    parser.add_argument("--title", default="分析对象", help="报告标题")
    parser.add_argument("--years", default=None, help="年份范围，如: 2021-2025")
    parser.add_argument("--compare", choices=["ytd", "full"], default="full")
    parser.add_argument("--output", default=OUT_DIR, help="输出目录")
    args = parser.parse_args()

    con = duckdb.connect()
    base_where = args.filter
    title = args.title

    # 年份范围
    meta = con.execute(f"""
    SELECT MIN(YEAR(签单日期))::INT, MAX(YEAR(签单日期))::INT,
           MAX(签单日期)::DATE, COUNT(DISTINCT 保单号)::INT
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where}
    """).fetchone()
    min_yr, max_yr, max_sign, total_pol = meta
    if args.years:
        parts = args.years.split("-")
        min_yr = int(parts[0])
        max_yr = int(parts[1]) if len(parts) > 1 else int(parts[0])

    # YTD 处理
    _ms = datetime.strptime(str(max_sign), "%Y-%m-%d").date() if isinstance(max_sign, str) else max_sign
    ytd_month, ytd_day = _ms.month, _ms.day
    latest_incomplete = not (ytd_month == 12 and ytd_day >= 25)
    is_ytd = (args.compare == "ytd") and latest_incomplete

    if is_ytd:
        ytd_filter = f"AND (MONTH(签单日期) < {ytd_month} OR (MONTH(签单日期) = {ytd_month} AND DAY(签单日期) <= {ytd_day}))"
    else:
        ytd_filter = ""

    year_filter = f"YEAR(签单日期) BETWEEN {min_yr} AND {max_yr} {ytd_filter}"
    years = list(range(min_yr, max_yr + 1))

    # 风险等级字段
    risk_expr = detect_risk_field(con, base_where)

    print(f"\n📊 盈亏平衡系数分析: {title}")
    print(f"   {total_pol:,d} 保单 | {min_yr}-{max_yr} | 口径: {'同期' if is_ytd else '全年'}")

    lines = []
    all_be_results = []  # 收集所有维度的盈亏平衡结果，用于红线总结

    # ========== 报告头 ==========
    lines.append(f"# {title} — 盈亏平衡系数分析")
    lines.append(f"\n> 生成时间: {date.today()} | 口径: {min_yr}-{max_yr} {'同期' if is_ytd else '全年'} | 保单: {total_pol:,d}")
    lines.append(f"> 公式: 平衡系数 = 当前系数 × 赔付率 / (1 - 费用率)，假设赔款金额不变、费用率不变")
    lines.append(f"> 亮灯: 🟢差距≤-0.05 🔵-0.05~0 🟡0~+0.10 🔴>+0.10\n")

    # ========== 0. 整体摘要 ==========
    lines.append("## 0. 整体摘要\n")
    overall = query_kpi(con, f"{base_where} AND {year_filter}")
    if overall:
        o = overall[0]
        be = compute_breakeven(o)
        lines.append(f"| 指标 | 值 |")
        lines.append(f"|------|---:|")
        lines.append(f"| 保单数 | {fi(o.get('policy_count'))} |")
        lines.append(f"| 签单保费 | {fw(o.get('written_premium'))}万 |")
        lines.append(f"| 满期赔付率 | {fp(o.get('loss_ratio'))} |")
        lines.append(f"| 费用率 | {fp(o.get('expense_ratio'))} |")
        lines.append(f"| 当前加权系数 | {fc(o.get('pricing_coeff'))} |")
        lines.append(f"| **盈亏平衡系数** | **{fmt_be(be['be_coeff'])}** |")
        lines.append(f"| **系数差距** | **{fmt_gap(be['gap'])}**{gap_light(be['gap'])} |")
        lines.append("")
        overall_be = be["be_coeff"]
    else:
        lines.append("无数据\n")
        overall_be = None

    # ========== 1. 年度维度 ==========
    lines.append("## 1. 年度趋势\n")
    yr_rows = []
    for yr in years:
        yr_data = query_kpi(con, f"{base_where} AND YEAR(签单日期) = {yr} {ytd_filter}")
        if yr_data:
            yr_data[0]["dim_label"] = str(yr)
            yr_rows.append(yr_data[0])
    render_table(lines, yr_rows, "年份")
    for r in yr_rows:
        be = compute_breakeven(r)
        if be["gap"] is not None:
            all_be_results.append({"dim": "年度", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 2. 吨位分段 ==========
    lines.append("## 2. 吨位分段\n")
    ton_rows = query_dim(con, base_where, year_filter, "吨位分段")
    render_table(lines, ton_rows, "吨位")
    for r in ton_rows:
        be = compute_breakeven(r)
        if be["gap"] is not None and (r.get("policy_count") or 0) >= MIN_POLICIES:
            all_be_results.append({"dim": "吨位", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 3. 三级机构 ==========
    lines.append("## 3. 三级机构\n")
    org_rows = query_dim(con, base_where, year_filter, "三级机构")
    render_table(lines, org_rows, "机构")
    for r in org_rows:
        be = compute_breakeven(r)
        if be["gap"] is not None and (r.get("policy_count") or 0) >= MIN_POLICIES:
            all_be_results.append({"dim": "机构", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 4. 风险等级 ==========
    lines.append("## 4. 风险等级\n")
    risk_rows = query_dim(con, base_where, year_filter, f"COALESCE({risk_expr}, '无评分')")
    render_table(lines, risk_rows, "等级")
    for r in risk_rows:
        be = compute_breakeven(r)
        if be["gap"] is not None and (r.get("policy_count") or 0) >= MIN_POLICIES:
            all_be_results.append({"dim": "风险等级", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 5. 新转续过户 ==========
    lines.append("## 5. 新转续过户\n")
    vt_rows = query_dim(con, base_where, year_filter, VEHICLE_TYPE_EXPR)
    render_table(lines, vt_rows, "类型")
    for r in vt_rows:
        be = compute_breakeven(r)
        if be["gap"] is not None and (r.get("policy_count") or 0) >= MIN_POLICIES:
            all_be_results.append({"dim": "新转续过户", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 6. 经代名 Top 20 ==========
    lines.append("## 6. 经代名（Top 20 by 保费）\n")
    agent_rows = query_dim(con, base_where, year_filter, "COALESCE(经代名, '(直销)')")
    agent_top = [r for r in agent_rows if (r.get("policy_count") or 0) >= MIN_POLICIES][:20]
    render_table(lines, agent_top, "经代")
    for r in agent_top:
        be = compute_breakeven(r)
        if be["gap"] is not None:
            all_be_results.append({"dim": "经代", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 7. 险别组合 ==========
    lines.append("## 7. 险别组合\n")
    cov_rows = query_dim(con, base_where, year_filter, "险别组合")
    render_table(lines, cov_rows, "险别")
    for r in cov_rows:
        be = compute_breakeven(r)
        if be["gap"] is not None and (r.get("policy_count") or 0) >= MIN_POLICIES:
            all_be_results.append({"dim": "险别", "value": r["dim_label"], **be, "coeff": r.get("pricing_coeff")})

    # ========== 8. 定价红线总结 ==========
    lines.append("## 8. 定价红线总结\n")

    # 全口径
    lines.append(f"**全口径盈亏平衡系数**: {fmt_be(overall_be)}\n")

    # 建议最低系数 = 所有维度平衡系数的 75 分位
    valid_be = sorted([r["be_coeff"] for r in all_be_results
                       if r["be_coeff"] is not None and r["be_coeff"] != float("inf")])
    if valid_be:
        p75_idx = int(len(valid_be) * 0.75)
        recommended = round(valid_be[min(p75_idx, len(valid_be) - 1)], 2)
        lines.append(f"**建议最低可接受系数**: {recommended:.2f}（各维度平衡系数 75 分位数）\n")

    # 系统性定价不足列表
    danger = [r for r in all_be_results if r["gap"] is not None and r["gap"] > 0.10]
    warning = [r for r in all_be_results if r["gap"] is not None and 0 < r["gap"] <= 0.10]

    if danger:
        lines.append("### 🔴 系统性定价不足（差距 > +0.10）\n")
        lines.append("| 维度 | 值 | 当前系数 | 平衡系数 | 差距 |")
        lines.append("|------|---|---:|---:|---:|")
        for r in sorted(danger, key=lambda x: x["gap"], reverse=True):
            lines.append(f"| {r['dim']} | {r['value']} | {fc(r['coeff'])} | {fmt_be(r['be_coeff'])} | {fmt_gap(r['gap'])} 🔴 |")
        lines.append("")

    if warning:
        lines.append("### 🟡 轻度定价不足（差距 0 ~ +0.10）\n")
        lines.append("| 维度 | 值 | 当前系数 | 平衡系数 | 差距 |")
        lines.append("|------|---|---:|---:|---:|")
        for r in sorted(warning, key=lambda x: x["gap"], reverse=True):
            lines.append(f"| {r['dim']} | {r['value']} | {fc(r['coeff'])} | {fmt_be(r['be_coeff'])} | {fmt_gap(r['gap'])} 🟡 |")
        lines.append("")

    safe = [r for r in all_be_results if r["gap"] is not None and r["gap"] <= -0.05]
    if safe:
        lines.append("### 🟢 安全区（差距 ≤ -0.05，当前定价充足）\n")
        lines.append("| 维度 | 值 | 当前系数 | 平衡系数 | 差距 |")
        lines.append("|------|---|---:|---:|---:|")
        for r in sorted(safe, key=lambda x: x["gap"])[:10]:
            lines.append(f"| {r['dim']} | {r['value']} | {fc(r['coeff'])} | {fmt_be(r['be_coeff'])} | {fmt_gap(r['gap'])} 🟢 |")
        lines.append("")

    # 写文件
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    yr_tag = f"{min_yr}_{max_yr}" if min_yr != max_yr else str(min_yr)
    filename = f"{title}_盈亏平衡系数分析_{yr_tag}_截至{date.today()}.md"
    out_path = out_dir / filename
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n✅ {out_path} ({len(lines)} 行)")


if __name__ == "__main__":
    main()
