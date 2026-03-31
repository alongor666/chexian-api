#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
车型/客户类别 全维度经营诊断脚本 v3.0

7 板块结构：整体概况 → 新转续过户 → 能源类型 → 风险评分 → 季度趋势 → 险类 → 诊断总结
指标注册表对照：earned_margin_amount / projected_margin_amount / variable_cost_ratio / ...

使用:
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'"
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --title 营业货车
    python3 数据管理/pipelines/diagnose_vehicle.py --filter "三级机构 = '天府'" --title 天府机构

版本: 4.0.0
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

# 公共模块
sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_common import (  # noqa: E402
    GLOB, OUT_DIR, POLICY_TERM, EARNED_DAYS, EARNED,
    fw, fp, fi, fc, light, escape_sql,
    TH_VC, TH_MR, TH_LR, TH_IR, TH_AC_CARGO,
    kpi_select, query_kpi, detect_risk_field,
    kpi_rows, sum_kpi_dicts, trend_text,
    METRIC_KEYS, get_metric_value,
)

# ============================================================================
# 格式化 + 亮灯
# ============================================================================

def fw(v):
    """万元"""
    return "-" if v is None else f"{v:,.1f}"
def fp(v):
    """百分比"""
    return "-" if v is None else f"{v:.1f}%"
def fi(v):
    """整数"""
    if v is None: return "-"
    v = int(v) if isinstance(v, float) else v
    return str(v) if 2000 <= v <= 2099 else f"{v:,d}"
def fc(v):
    """系数"""
    return "-" if v is None else f"{v:.4f}"

def light(v, thresholds, higher_worse=True):
    """四级亮灯：🔴⛔危险 🟡⚠️预警 🔵关注 🟢✅正常
    thresholds = (关注, 预警, 危险) 三档阈值"""
    if v is None: return ""
    notice, warn, danger = thresholds
    if higher_worse:
        if v > danger: return " 🔴"
        if v > warn: return " 🟡"
        if v > notice: return " 🔵"
        return " 🟢"
    else:
        if v < danger: return " 🔴"
        if v < warn: return " 🟡"
        if v < notice: return " 🔵"
        return " 🟢"

# 阈值配置 (关注, 预警, 危险)
TH_VC = (85, 91, 94)         # 变动成本率
TH_MR = (15, 9, 6)           # 边际贡献率（越低越差）
TH_LR = (60, 70, 75)         # 满期赔付率
TH_IR = (8, 10, 12)          # 满期出险率（非摩托）
TH_AC_CARGO = (8000, 10000, 12000)  # 案均赔款-货车

# ============================================================================
# SQL 构建器
# ============================================================================

def kpi_select(earned_expr: str, group_col: str = None) -> str:
    """构建标准 KPI SELECT 子句

    口径修正（v3.1）：
    - 满期保费/赔付率：闰年感知（policy_term=365或366天）
    - 满期出险率：(赔案件数/保单数) × (保险期限/满期天数)
      满期后 ratio=1，未满期 ratio>1 年化放大
    - 商车定价系数：仅限险类='商业保险'
    """
    g = f"{group_col}," if group_col else ""
    return f"""
        {g}
        COUNT(DISTINCT 保单号)::INT AS policy_count,
        ROUND(SUM(保费)/10000, 1) AS written_premium,
        ROUND(AVG(CASE WHEN 保费>0 THEN 保费 END), 0)::INT AS avg_premium,
        ROUND(SUM({earned_expr})/10000, 1) AS earned_premium,
        ROUND(SUM(COALESCE(已报告赔款,0))/10000, 1) AS reported_claims,
        SUM(COALESCE(赔案件数,0))::INT AS claim_cases,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM(COALESCE(赔案件数,0)),0), 0)::INT AS avg_claim,
        COUNT(DISTINCT CASE WHEN COALESCE(赔案件数,0)>0 THEN 保单号 END)::INT AS claim_policies,
        ROUND(SUM(COALESCE(费用金额,0))/10000, 1) AS fee_amount,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({earned_expr}),0)*100, 1) AS loss_ratio,
        ROUND(SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0)*100, 1) AS expense_ratio,
        -- 满期出险率：(赔案/保单) × (保险期限/满期天数)，闰年感知
        ROUND(SUM(COALESCE(赔案件数,0) * CAST({POLICY_TERM} AS DOUBLE)
                  / NULLIF(CAST({EARNED_DAYS} AS DOUBLE), 0))
              / NULLIF(COUNT(DISTINCT 保单号), 0) * 100, 2) AS incident_rate,
        ROUND(SUM({earned_expr})*(1-SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({earned_expr}),0)
              -SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0))/10000, 1) AS earned_margin,
        ROUND(SUM(保费)*(1-SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({earned_expr}),0)
              -SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0))/10000, 1) AS projected_margin,
        -- 商车定价系数：仅商业险
        ROUND(AVG(CASE WHEN 险类 = '商业保险' AND 商车自主定价系数 IS NOT NULL AND 商车自主定价系数 > 0
              THEN 商车自主定价系数 END), 4) AS pricing_coeff
    """


# ============================================================================
# 报告写入器
# ============================================================================

class Report:
    def __init__(self):
        self.lines = []
    def add(self, t=""): self.lines.append(t)

    def kpi_rows(self, d: dict, fmt_fn=None):
        """从标准 KPI dict 生成指标行列表，返回 [(label, value_str)] """
        vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
        mr = 100 - vc
        rows = [
            ("**满期边际贡献额**", f"**{fw(d.get('earned_margin'))}**"),
            ("**预估边际贡献额**", f"**{fw(d.get('projected_margin'))}**"),
            ("**变动成本率**", f"**{fp(vc)}**{light(vc, TH_VC)}"),
            ("**边际贡献率**", f"**{fp(mr)}**{light(mr, TH_MR, False)}"),
            ("── 赔付 ──", ""),
            ("满期赔付率", f"{fp(d.get('loss_ratio'))}{light(d.get('loss_ratio'), TH_LR)}"),
            ("已报告赔款", fw(d.get("reported_claims"))),
            ("赔案件数", fi(d.get("claim_cases"))),
            ("案均赔款 †", f"{fi(d.get('avg_claim'))}{light(d.get('avg_claim'), TH_AC_CARGO)}"),
            ("── 出险 ──", ""),
            ("满期出险率", f"{fp(d.get('incident_rate'))}{light(d.get('incident_rate'), TH_IR)}"),
            ("有赔案保单数", fi(d.get("claim_policies"))),
            ("── 费用 ──", ""),
            ("费用率", fp(d.get("expense_ratio"))),
            ("费用金额", fw(d.get("fee_amount"))),
            ("── 保费 ──", ""),
            ("保单数", fi(d.get("policy_count"))),
            ("签单保费", fw(d.get("written_premium"))),
            ("满期保费", fw(d.get("earned_premium"))),
            ("件均保费 †", fi(d.get("avg_premium"))),
            ("── 系数 ──", ""),
            ("商车定价系数", fc(d.get("pricing_coeff"))),
        ]
        return rows

    def write_year_table(self, data_by_year: dict, years: list, show_growth: bool = True):
        """板块1/2.x/4.x/6.x: 按年份展开的 KPI 表
        data_by_year = {2021: kpi_dict, 2022: ...}
        show_growth: 是否在年份列之间插入 YoY 增长率列
        """
        # 构建汇总
        all_keys = set()
        for d in data_by_year.values():
            all_keys.update(d.keys())

        # 示例行获取标签
        sample = next(iter(data_by_year.values()), {})
        label_vals = self.kpi_rows(sample)
        labels = [lv[0] for lv in label_vals]

        # 各年 + 汇总列
        cols_data = {}
        for yr in years:
            d = data_by_year.get(yr, {})
            cols_data[str(yr)] = self.kpi_rows(d)

        # 趋势分析
        trends = self._compute_trends(data_by_year, years)

        # 增长率用到的 metric key 与行号映射
        growth_keys = [
            "earned_margin", "projected_margin", "_vc", "_mr",
            None,  # 分隔
            "loss_ratio", "reported_claims", "claim_cases", "avg_claim",
            None,
            "incident_rate", "claim_policies",
            None,
            "expense_ratio", "fee_amount",
            None,
            "policy_count", "written_premium", "earned_premium", "avg_premium",
            None,
            "pricing_coeff",
        ]

        def _get_raw_val(d: dict, key: str):
            if key == "_vc":
                return (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
            elif key == "_mr":
                return 100 - ((d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0))
            return d.get(key)

        def _yoy(prev, curr):
            if prev is None or curr is None or prev == 0:
                return "-"
            pct = (curr - prev) / abs(prev) * 100
            if pct > 0:
                return f"+{pct:.1f}%"
            return f"{pct:.1f}%"

        # 表头
        yr_headers = [str(y) for y in years]
        if show_growth and len(years) > 1:
            header_parts = [yr_headers[0]]
            align_parts = ["---:"]
            for j in range(1, len(years)):
                header_parts.append(f"YoY")
                header_parts.append(yr_headers[j])
                align_parts.append("---:")
                align_parts.append("---:")
            self.add("| 指标 | " + " | ".join(header_parts) + " | 趋势分析 |")
            self.add("| :--- | " + " | ".join(align_parts) + " | :--- |")
        else:
            self.add("| 指标 | " + " | ".join(yr_headers) + " | 趋势分析 |")
            self.add("| :--- | " + " | ".join(["---:"] * len(years)) + " | :--- |")

        for i, label in enumerate(labels):
            cells = []
            if show_growth and len(years) > 1:
                # 第一年
                row_data_0 = cols_data.get(yr_headers[0], [])
                cells.append(row_data_0[i][1] if i < len(row_data_0) else "-")
                # 后续年份：增长率 + 数值
                for j in range(1, len(years)):
                    gk = growth_keys[i] if i < len(growth_keys) else None
                    if gk is not None:
                        prev_d = data_by_year.get(years[j-1], {})
                        curr_d = data_by_year.get(years[j], {})
                        yoy_str = _yoy(_get_raw_val(prev_d, gk), _get_raw_val(curr_d, gk))
                    else:
                        yoy_str = ""
                    row_data_j = cols_data.get(yr_headers[j], [])
                    cells.append(yoy_str)
                    cells.append(row_data_j[i][1] if i < len(row_data_j) else "-")
            else:
                for yr_str in yr_headers:
                    row_data = cols_data.get(yr_str, [])
                    cells.append(row_data[i][1] if i < len(row_data) else "-")
            trend = trends[i] if i < len(trends) else ""
            self.add(f"| {label} | " + " | ".join(cells) + f" | {trend} |")
        self.add()

    def write_dim_summary_table(self, data_by_dim: dict, dim_names: list, analysis_col: str = "分析"):
        """板块2.0/3.0/4.0: 按维度汇总的 KPI 表"""
        sample = next(iter(data_by_dim.values()), {})
        label_vals = self.kpi_rows(sample)
        labels = [lv[0] for lv in label_vals]

        cols_data = {}
        for dim in dim_names:
            d = data_by_dim.get(dim, {})
            cols_data[dim] = self.kpi_rows(d)

        # 汇总列
        total = self._sum_dicts(list(data_by_dim.values()))
        total_rows = self.kpi_rows(total)

        # 维度分析
        analyses = self._compute_dim_analysis(data_by_dim, dim_names)

        self.add("| 指标 | " + " | ".join(dim_names) + " | 汇总 | " + analysis_col + " |")
        self.add("| :--- | " + " | ".join(["---:"] * len(dim_names)) + " | ---: | :--- |")

        for i, label in enumerate(labels):
            cells = []
            for dim in dim_names:
                row_data = cols_data.get(dim, [])
                cells.append(row_data[i][1] if i < len(row_data) else "-")
            t_cell = total_rows[i][1] if i < len(total_rows) else "-"
            analysis = analyses[i] if i < len(analyses) else ""
            self.add(f"| {label} | " + " | ".join(cells) + f" | {t_cell} | {analysis} |")
        self.add()

    def write_quarter_table(self, rows: list, cols: list):
        """板块5: 季度趋势表"""
        self.add("| " + " | ".join(cols) + " |")
        self.add("| :--- | " + " | ".join(["---:"] * (len(cols)-1)) + " |")
        for r in rows:
            cells = []
            for i, v in enumerate(r):
                if i == 0: cells.append(str(v))
                elif v is None: cells.append("-")
                elif isinstance(v, float):
                    cells.append(f"{v:,.1f}" if abs(v) < 1000 else f"{v:,.0f}")
                elif isinstance(v, int):
                    cells.append(f"{v:,d}")
                else: cells.append(str(v))
            self.add("| " + " | ".join(cells) + " |")
        self.add()

    def write_bar_chart(self, title: str, labels: list, values: list, unit: str = ""):
        """ASCII 条形图"""
        self.add(f"### {title}\n")
        if not values or all(v is None for v in values):
            self.add("*无数据*\n"); return
        safe_vals = [v or 0 for v in values]
        max_v = max(abs(v) for v in safe_vals) or 1
        self.add("```")
        for lbl, val in zip(labels, safe_vals):
            bar_len = max(1, int(abs(val) / max_v * 35))
            sign = "▓" if val >= 0 else "░"
            self.add(f"  {lbl} | {sign * bar_len} {val:>8,.1f}{unit}")
        self.add("```\n")

    def _compute_trends(self, data_by_year: dict, years: list) -> list:
        """计算趋势分析文字"""
        if len(years) < 2:
            return [""] * 22

        sample = next(iter(data_by_year.values()), {})
        metrics = [
            ("earned_margin", "边际贡献额"),
            ("projected_margin", "预估边际"),
            ("_vc", "变动成本率"),
            ("_mr", "边际贡献率"),
            None,  # 分隔
            ("loss_ratio", "赔付率"),
            ("reported_claims", "赔款"),
            ("claim_cases", "赔案数"),
            ("avg_claim", "案均"),
            None,
            ("incident_rate", "出险率"),
            ("claim_policies", "赔案保单"),
            None,
            ("expense_ratio", "费用率"),
            ("fee_amount", "费用额"),
            None,
            ("policy_count", "保单数"),
            ("written_premium", "保费"),
            ("earned_premium", "满期保费"),
            ("avg_premium", "件均"),
            None,
            ("pricing_coeff", "系数"),
        ]
        trends = []
        for m in metrics:
            if m is None:
                trends.append(""); continue
            key, name = m
            vals = []
            for yr in years:
                d = data_by_year.get(yr, {})
                if key == "_vc":
                    v = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
                elif key == "_mr":
                    v = 100 - ((d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0))
                else:
                    v = d.get(key)
                vals.append(v)
            trends.append(self._trend_text(vals, years))
        return trends

    def _trend_text(self, vals: list, years: list) -> str:
        """生成趋势文字"""
        clean = [(y, v) for y, v in zip(years, vals) if v is not None]
        if len(clean) < 2: return ""
        first_v = clean[0][1]; last_v = clean[-1][1]
        avg_v = sum(v for _, v in clean) / len(clean)
        max_v = max(v for _, v in clean); min_v = min(v for _, v in clean)
        max_yr = [y for y, v in clean if v == max_v][0]
        min_yr = [y for y, v in clean if v == min_v][0]

        if first_v == 0: return f"均值{avg_v:.1f}"
        change = (last_v - first_v) / abs(first_v) * 100

        if abs(change) < 5: trend = "平稳"
        elif change > 30: trend = "大幅上升↑"
        elif change > 10: trend = "上升↗"
        elif change < -30: trend = "大幅下降↓"
        elif change < -10: trend = "下降↘"
        else: trend = "微变"

        # 简洁输出
        if isinstance(last_v, float) and abs(last_v) < 200:
            return f"{trend} 高{max_yr}:{max_v:.1f} 低{min_yr}:{min_v:.1f}"
        return f"{trend} 高{max_yr} 低{min_yr}"

    def _compute_dim_analysis(self, data_by_dim: dict, dim_names: list) -> list:
        """维度分析文字"""
        metrics = [
            ("earned_margin", "边际贡献额"),
            ("projected_margin", "预估边际"),
            ("_vc", "变动成本率"),
            ("_mr", "边际贡献率"),
            None,
            ("loss_ratio", "赔付率"),
            ("reported_claims", "赔款"),
            ("claim_cases", "赔案"),
            ("avg_claim", "案均"),
            None,
            ("incident_rate", "出险率"),
            ("claim_policies", "赔案保单"),
            None,
            ("expense_ratio", "费用率"),
            ("fee_amount", "费用"),
            None,
            ("policy_count", "保单"),
            ("written_premium", "保费"),
            ("earned_premium", "满期"),
            ("avg_premium", "件均"),
            None,
            ("pricing_coeff", "系数"),
        ]
        analyses = []
        for m in metrics:
            if m is None: analyses.append(""); continue
            key, name = m
            vals = {}
            for dim in dim_names:
                d = data_by_dim.get(dim, {})
                if key == "_vc":
                    vals[dim] = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
                elif key == "_mr":
                    vals[dim] = 100 - ((d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0))
                else:
                    vals[dim] = d.get(key)
            valid = {k: v for k, v in vals.items() if v is not None}
            if not valid: analyses.append(""); continue
            best = max(valid, key=valid.get)
            worst = min(valid, key=valid.get)
            if best == worst: analyses.append("")
            else: analyses.append(f"高:{best} 低:{worst}")
        return analyses

    def _sum_dicts(self, dicts: list) -> dict:
        """合并多个 KPI dict 为汇总"""
        if not dicts: return {}
        total = {}
        sum_keys = ["policy_count", "written_premium", "earned_premium",
                     "reported_claims", "claim_cases", "claim_policies",
                     "fee_amount"]
        for k in sum_keys:
            total[k] = sum(d.get(k) or 0 for d in dicts)
        # 率指标重算
        ep = total["earned_premium"]
        wp = total["written_premium"]
        total["loss_ratio"] = round(total["reported_claims"] / ep * 100, 1) if ep else None
        total["expense_ratio"] = round(total["fee_amount"] / wp * 100, 1) if wp else None
        # 满期出险率：用加权平均（各维度 incident_rate × policy_count 的加权）保持与 kpi_select 口径一致
        weighted_ir = sum((d.get("incident_rate") or 0) * (d.get("policy_count") or 0) for d in dicts)
        total_pc = total["policy_count"]
        total["incident_rate"] = round(weighted_ir / total_pc, 1) if total_pc else None
        total["avg_claim"] = round(total["reported_claims"] * 10000 / total["claim_cases"]) if total["claim_cases"] else None
        total["avg_premium"] = round(wp * 10000 / total["policy_count"]) if total["policy_count"] else None
        lr = total["loss_ratio"] or 0; fr = total["expense_ratio"] or 0
        total["earned_margin"] = round(ep * (1 - lr/100 - fr/100), 1) if ep else None
        total["projected_margin"] = round(wp * (1 - lr/100 - fr/100), 1) if wp else None
        # 系数取均值
        coeffs = [d.get("pricing_coeff") for d in dicts if d.get("pricing_coeff")]
        total["pricing_coeff"] = round(sum(coeffs)/len(coeffs), 4) if coeffs else None
        return total


# ============================================================================
# 数据加载
# ============================================================================

def query_kpi(con, where: str, group_col: str = None) -> list:
    """执行标准 KPI 查询，返回 [dict, ...]"""
    sel = kpi_select(EARNED, group_col)
    gb = f"GROUP BY {group_col}" if group_col else ""
    ob = f"ORDER BY {group_col}" if group_col else ""
    sql = f"SELECT {sel} FROM read_parquet('{GLOB}', union_by_name=true) WHERE {where} {gb} {ob}"
    result = con.execute(sql)
    cols = [d[0] for d in result.description]
    return [dict(zip(cols, row)) for row in result.fetchall()]

def detect_risk_field(con, where: str) -> str:
    """智能检测风险评分字段：根据客户类别自动选择"""
    # 检查各字段覆盖率
    sql = f"""
    SELECT
        SUM(CASE WHEN 车险风险等级 IS NOT NULL THEN 1 ELSE 0 END) AS f1,
        SUM(CASE WHEN 大货车评分 IS NOT NULL THEN 1 ELSE 0 END) AS f2,
        SUM(CASE WHEN 小货车评分 IS NOT NULL THEN 1 ELSE 0 END) AS f3
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {where}
    """
    r = con.execute(sql).fetchone()
    # 合并：优先用覆盖最广的，然后 COALESCE
    fields = [("车险风险等级", r[0] or 0), ("大货车评分", r[1] or 0), ("小货车评分", r[2] or 0)]
    fields.sort(key=lambda x: -x[1])
    # 返回 COALESCE 表达式
    non_zero = [f[0] for f in fields if f[1] > 0]
    if not non_zero:
        return "车险风险等级"  # fallback
    return f"COALESCE({', '.join(non_zero)})"


# ============================================================================
# 主程序
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="车型/客户类别全维度经营诊断 v3.0")
    parser.add_argument("--filter", required=True, help="SQL WHERE 条件，如: 厂牌车型 LIKE '%%牵引%%'")
    parser.add_argument("--title", default=None, help="报告标题（默认从筛选条件推断）")
    parser.add_argument("--years", default=None, help="年份范围，如: 2022-2026")
    parser.add_argument("--compare", choices=["ytd", "full"], default=None,
                        help="YoY 对比口径: ytd=同期对比(各年截取相同日期范围), full=全年对比. 不指定时自动检测并提示选择")
    parser.add_argument("--no-summary", action="store_true", help="跳过诊断总结和关键发现板块")
    parser.add_argument("--output", default=OUT_DIR, help="输出目录")
    args = parser.parse_args()

    con = duckdb.connect()
    base_where = args.filter
    title = args.title or args.filter

    # 元数据
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
    from datetime import date as _date
    if max_sign is None:
        print(f"\n❌ 筛选条件未命中任何保单，无法生成诊断报告。")
        sys.exit(1)
    _ms = datetime.strptime(str(max_sign), "%Y-%m-%d").date() if isinstance(max_sign, str) else max_sign
    ytd_month, ytd_day = _ms.month, _ms.day
    latest_year_incomplete = not (ytd_month == 12 and ytd_day >= 25)

    # 确定对比模式
    compare_mode = args.compare
    if compare_mode is None and latest_year_incomplete:
        # 未指定且最新年不完整 → 交互提示
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
        compare_mode = "full"  # 最新年完整，默认全年

    is_ytd = (compare_mode == "ytd") and latest_year_incomplete
    if is_ytd:
        ytd_filter = f"AND (MONTH(签单日期) < {ytd_month} OR (MONTH(签单日期) = {ytd_month} AND DAY(签单日期) <= {ytd_day}))"
        ytd_label = f"1月1日-{ytd_month}月{ytd_day}日"
    else:
        ytd_filter = ""
        ytd_label = "全年"

    def yr_where(yr: int) -> str:
        """生成年度对比的 WHERE 片段（含 YTD 截止）"""
        return f"YEAR(签单日期) = {yr} {ytd_filter}"

    # 风险字段
    risk_expr = detect_risk_field(con, base_where)
    print(f"\n🔍 诊断: {title}")
    print(f"   {total_pol:,d} 保单 | {min_yr}-{max_yr} | 风险字段: {risk_expr}")
    print(f"   📊 YoY 口径: {ytd_label}" + (f"（最新签单日期 {max_sign}，同期对齐）" if is_ytd else ""))

    rpt = Report()

    # ================================================================
    # Header
    # ================================================================
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

    # ================================================================
    # 1. 整体经营概况
    # ================================================================
    rpt.add("## 1. 整体经营概况\n")
    yr_data = {}
    for d in query_kpi(con, f"{base_where} AND YEAR(签单日期) = {yr}", None) if False else []:
        pass
    for yr in years:
        rows = query_kpi(con, f"{base_where} AND {yr_where(yr)}")
        if rows:
            yr_data[yr] = rows[0]
    rpt.write_year_table(yr_data, years)

    # ================================================================
    # 2. 新转续过户维度
    # ================================================================
    rpt.add("## 2. 新转续过户维度\n")

    vehicle_type_expr = """CASE
        WHEN 是否新车 THEN '新车'
        WHEN 是否过户车 THEN '旧车过户'
        WHEN 是否续保 THEN '旧车续保'
        ELSE '旧车转保'
    END"""
    vt_names = ["新车", "旧车续保", "旧车转保", "旧车过户"]

    # 2.0 汇总
    rpt.add("### 2.0 各年汇总\n")
    vt_data = {}
    vt_rows = con.execute(f"""
    SELECT 车辆类型, {kpi_select(EARNED, '车辆类型')}
    FROM (SELECT *, {vehicle_type_expr} AS 车辆类型 FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}) sub
    GROUP BY 车辆类型
    """).fetchall()
    vt_cols = ["车辆类型"] + [d[0] for d in con.execute("SELECT 1 AS x").description]  # placeholder
    # Re-query properly
    vt_result = con.execute(f"""
    SELECT {kpi_select(EARNED, '车辆类型')}
    FROM (SELECT *, {vehicle_type_expr} AS 车辆类型 FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}) sub
    GROUP BY 车辆类型
    """)
    vt_col_names = [d[0] for d in vt_result.description]
    for row in vt_result.fetchall():
        d = dict(zip(vt_col_names, row))
        vt_data[d["车辆类型"]] = d
    rpt.write_dim_summary_table(vt_data, vt_names, "维度分析")

    # 2.1-2.4 分项
    for vt_name in vt_names:
        idx = vt_names.index(vt_name) + 1
        rpt.add(f"### 2.{idx} {vt_name}\n")
        vt_yr_data = {}
        for yr in years:
            rows = con.execute(f"""
            SELECT {kpi_select(EARNED)}
            FROM (SELECT *, {vehicle_type_expr} AS 车辆类型 FROM read_parquet('{GLOB}', union_by_name=true)
                  WHERE {base_where} AND {yr_where(yr)}) sub
            WHERE 车辆类型 = '{vt_name}'
            """)
            cols = [d[0] for d in rows.description]
            for row in rows.fetchall():
                vt_yr_data[yr] = dict(zip(cols, row))
        rpt.write_year_table(vt_yr_data, years)

    # ================================================================
    # 3. 能源类型
    # ================================================================
    rpt.add("## 3. 能源类型\n")
    energy_expr = """CASE
        WHEN 是否新能源 THEN '新能源'
        ELSE '非新-燃'
    END"""
    energy_names = ["非新-燃", "非新-天", "新能源"]

    rpt.add("### 3.0 能源类型汇总\n")
    en_data = {}
    en_result = con.execute(f"""
    SELECT {kpi_select(EARNED, '能源类型')}
    FROM (SELECT *, {energy_expr} AS 能源类型 FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}) sub
    GROUP BY 能源类型
    """)
    en_cols = [d[0] for d in en_result.description]
    for row in en_result.fetchall():
        d = dict(zip(en_cols, row))
        en_data[d["能源类型"]] = d
    # 确保预留列存在
    for n in energy_names:
        if n not in en_data:
            en_data[n] = {}
    rpt.write_dim_summary_table(en_data, energy_names, "能源分析")

    rpt.add("> ⚠️ 非新-天（天然气）暂无数据源，预留列位\n")

    # ================================================================
    # 4. 风险评分
    # ================================================================
    rpt.add("## 4. 风险评分\n")

    # 获取实际等级值
    grades = con.execute(f"""
    SELECT DISTINCT {risk_expr} AS grade
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND {risk_expr} IS NOT NULL
    ORDER BY grade
    """).fetchall()
    grade_list = [g[0] for g in grades]
    grade_names = grade_list + ["无评分"]

    rpt.add("### 4.0 风险评分汇总\n")
    gr_data = {}
    # 有评分的
    for grade in grade_list:
        gr_result = con.execute(f"""
        SELECT {kpi_select(EARNED)}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND {risk_expr} = '{grade}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
        """)
        gr_cols = [d[0] for d in gr_result.description]
        for row in gr_result.fetchall():
            gr_data[grade] = dict(zip(gr_cols, row))
    # 无评分的
    gr_null = con.execute(f"""
    SELECT {kpi_select(EARNED)}
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND {risk_expr} IS NULL AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
    """)
    gr_null_cols = [d[0] for d in gr_null.description]
    for row in gr_null.fetchall():
        gr_data["无评分"] = dict(zip(gr_null_cols, row))

    rpt.write_dim_summary_table(gr_data, grade_names, "评分分析")

    # 4.1+ 分项（仅输出有数据的）
    for i, grade in enumerate(grade_list):
        rpt.add(f"### 4.{i+1} 等级 {grade}\n")
        g_yr_data = {}
        for yr in years:
            g_result = con.execute(f"""
            SELECT {kpi_select(EARNED)}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND {risk_expr} = '{grade}' AND {yr_where(yr)}
            """)
            g_cols = [d[0] for d in g_result.description]
            for row in g_result.fetchall():
                g_yr_data[yr] = dict(zip(g_cols, row))
        rpt.write_year_table(g_yr_data, years)

    # ================================================================
    # 5. 季度趋势
    # ================================================================
    rpt.add("## 5. 季度趋势\n")

    q_result = con.execute(f"""
    SELECT
        YEAR(签单日期)::INT * 10 + QUARTER(签单日期)::INT AS q_sort,
        SUBSTR(CAST(YEAR(签单日期) AS VARCHAR), 3, 2) || 'Q' || CAST(QUARTER(签单日期) AS VARCHAR) AS quarter_label,
        {kpi_select(EARNED)}
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where}
    GROUP BY q_sort, quarter_label
    ORDER BY q_sort DESC LIMIT 24
    """)
    q_cols = [d[0] for d in q_result.description]
    q_rows_raw = [dict(zip(q_cols, r)) for r in q_result.fetchall()]
    q_rows_raw.reverse()

    # 5.0 汇总表
    rpt.add("### 5.0 季度汇总\n")
    q_table_rows = []
    for d in q_rows_raw:
        vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
        q_table_rows.append([
            d["quarter_label"],
            d.get("earned_margin"),
            d.get("written_premium"),
            round(vc, 1) if vc else None,
            d.get("expense_ratio"),
            d.get("loss_ratio"),
            d.get("incident_rate"),
            d.get("avg_claim"),
        ])
    rpt.write_quarter_table(q_table_rows,
        ["季度", "边际贡献额", "签单保费", "变动成本率", "费用率", "满期赔付率", "满期出险率", "案均赔款 †"])

    # 5.1-5.7 条形图
    q_labels = [d["quarter_label"] for d in q_rows_raw]
    chart_items = [
        ("5.1 满期边际贡献额", "earned_margin", "万"),
        ("5.2 签单保费", "written_premium", "万"),
        ("5.3 变动成本率", "_vc", "%"),
        ("5.4 费用率", "expense_ratio", "%"),
        ("5.5 满期赔付率", "loss_ratio", "%"),
        ("5.6 满期出险率", "incident_rate", "%"),
        ("5.7 案均赔款", "avg_claim", "†"),
    ]
    for title_str, key, unit in chart_items:
        vals = []
        for d in q_rows_raw:
            if key == "_vc":
                vals.append((d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0))
            else:
                vals.append(d.get(key))
        rpt.write_bar_chart(title_str, q_labels, vals, unit)

    # ================================================================
    # 6. 险类
    # ================================================================
    rpt.add("## 6. 险类\n")
    ins_types = ["商业保险", "交强险"]

    rpt.add("### 6.0 险类汇总\n")
    ins_data = {}
    for itype in ins_types:
        i_result = con.execute(f"""
        SELECT {kpi_select(EARNED)}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND 险类 = '{itype}'
        """)
        i_cols = [d[0] for d in i_result.description]
        for row in i_result.fetchall():
            ins_data[itype] = dict(zip(i_cols, row))
    rpt.write_dim_summary_table(ins_data, ins_types, "险类分析")

    for i, itype in enumerate(ins_types):
        rpt.add(f"### 6.{i+1} {itype}\n")
        ins_yr = {}
        for yr in years:
            i_result = con.execute(f"""
            SELECT {kpi_select(EARNED)}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 险类 = '{itype}' AND {yr_where(yr)}
            """)
            i_cols = [d[0] for d in i_result.description]
            for row in i_result.fetchall():
                ins_yr[yr] = dict(zip(i_cols, row))
        rpt.write_year_table(ins_yr, years)

    # ================================================================
    # 7. 险别组合
    # ================================================================
    rpt.add("## 7. 险别组合\n")

    # 动态获取险别组合值（按保单数降序）
    combo_result = con.execute(f"""
    SELECT DISTINCT 险别组合
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
      AND 险别组合 IS NOT NULL
    ORDER BY 险别组合
    """)
    combo_names = [r[0] for r in combo_result.fetchall()]

    rpt.add("### 7.0 险别组合汇总\n")
    combo_data = {}
    for combo in combo_names:
        c_result = con.execute(f"""
        SELECT {kpi_select(EARNED)}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND 险别组合 = '{combo}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
        """)
        c_cols = [d[0] for d in c_result.description]
        for row in c_result.fetchall():
            combo_data[combo] = dict(zip(c_cols, row))
    rpt.write_dim_summary_table(combo_data, combo_names, "险别分析")

    for ci, combo in enumerate(combo_names):
        rpt.add(f"### 7.{ci+1} {combo}\n")
        combo_yr = {}
        for yr in years:
            c_result = con.execute(f"""
            SELECT {kpi_select(EARNED)}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 险别组合 = '{combo}' AND {yr_where(yr)}
            """)
            c_cols = [d[0] for d in c_result.description]
            for row in c_result.fetchall():
                combo_yr[yr] = dict(zip(c_cols, row))
        rpt.write_year_table(combo_yr, years)

    # ================================================================
    # 8. 客户类别
    # ================================================================
    rpt.add("## 8. 客户类别\n")

    # 动态获取客户类别（按保单数降序，过滤极小量）
    cat_result = con.execute(f"""
    SELECT 客户类别, COUNT(DISTINCT 保单号) AS cnt
    FROM read_parquet('{GLOB}', union_by_name=true)
    WHERE {base_where} AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
      AND 客户类别 IS NOT NULL
    GROUP BY 客户类别 ORDER BY cnt DESC
    """)
    cat_all = [(r[0], r[1]) for r in cat_result.fetchall()]
    cat_names = [c[0] for c in cat_all if c[1] >= 10]  # 过滤 <10 单的类别

    rpt.add("### 8.0 客户类别汇总\n")
    cat_data = {}
    for cat in cat_names:
        c_result = con.execute(f"""
        SELECT {kpi_select(EARNED)}
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE {base_where} AND 客户类别 = '{cat}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
        """)
        c_cols = [d[0] for d in c_result.description]
        for row in c_result.fetchall():
            cat_data[cat] = dict(zip(c_cols, row))
    rpt.write_dim_summary_table(cat_data, cat_names, "类别分析")

    # 8.1+ 各客户类别年度明细
    truck_cats = {"营业货车", "非营业货车"}  # 需要吨位分段的类别
    for ci, cat in enumerate(cat_names):
        rpt.add(f"### 8.{ci+1} {cat}\n")
        cat_yr = {}
        for yr in years:
            c_result = con.execute(f"""
            SELECT {kpi_select(EARNED)}
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 客户类别 = '{cat}' AND {yr_where(yr)}
            """)
            c_cols = [d[0] for d in c_result.description]
            for row in c_result.fetchall():
                cat_yr[yr] = dict(zip(c_cols, row))
        rpt.write_year_table(cat_yr, years)

        # 货车类别：追加吨位分段子板块
        if cat in truck_cats:
            rpt.add(f"#### {cat} — 吨位分段\n")
            ton_result = con.execute(f"""
            SELECT 吨位分段, COUNT(DISTINCT 保单号) AS cnt
            FROM read_parquet('{GLOB}', union_by_name=true)
            WHERE {base_where} AND 客户类别 = '{cat}' AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
              AND 吨位分段 IS NOT NULL
            GROUP BY 吨位分段 ORDER BY cnt DESC
            """)
            ton_names = [r[0] for r in ton_result.fetchall()]

            # 吨位汇总表
            ton_data = {}
            for tn in ton_names:
                t_result = con.execute(f"""
                SELECT {kpi_select(EARNED)}
                FROM read_parquet('{GLOB}', union_by_name=true)
                WHERE {base_where} AND 客户类别 = '{cat}' AND 吨位分段 = '{tn}'
                  AND YEAR(签单日期) BETWEEN {min_yr} AND {max_yr}
                """)
                t_cols = [d[0] for d in t_result.description]
                for row in t_result.fetchall():
                    ton_data[tn] = dict(zip(t_cols, row))
            rpt.write_dim_summary_table(ton_data, ton_names, "吨位分析")

            # 各吨位段年度明细
            for ti, tn in enumerate(ton_names):
                rpt.add(f"##### {cat} {tn}\n")
                ton_yr = {}
                for yr in years:
                    t_result = con.execute(f"""
                    SELECT {kpi_select(EARNED)}
                    FROM read_parquet('{GLOB}', union_by_name=true)
                    WHERE {base_where} AND 客户类别 = '{cat}' AND 吨位分段 = '{tn}' AND {yr_where(yr)}
                    """)
                    t_cols = [d[0] for d in t_result.description]
                    for row in t_result.fetchall():
                        ton_yr[yr] = dict(zip(t_cols, row))
                rpt.write_year_table(ton_yr, years)

    # ================================================================
    # 9. 诊断总结（--no-summary 时跳过）
    # ================================================================
    if args.no_summary:
        rpt.add("---\n")
        rpt.add("> 诊断结论和关键发现由专项 skill/agent 生成，此处省略。\n")
    else:
        rpt.add("## 9. 诊断总结\n")

        # 整体年度总结
        for yr in years:
            d = yr_data.get(yr, {})
            lr = d.get("loss_ratio") or 0; fr = d.get("expense_ratio") or 0
            vc = lr + fr; em = d.get("earned_margin") or 0; pm = d.get("projected_margin") or 0
            ir = d.get("incident_rate") or 0
            if vc > 94: rpt.add(f"- 🔴 {yr}年 变动成本率 {vc:.1f}%，满期边际 {em:,.1f} 万，预估边际 {pm:,.1f} 万")
            elif vc > 91: rpt.add(f"- 🟡 {yr}年 变动成本率 {vc:.1f}%，满期边际 {em:,.1f} 万，预估边际 {pm:,.1f} 万")
            elif vc > 85: rpt.add(f"- 🔵 {yr}年 变动成本率 {vc:.1f}%，满期边际 {em:,.1f} 万，预估边际 {pm:,.1f} 万")
            else: rpt.add(f"- 🟢 {yr}年 变动成本率 {vc:.1f}%，满期边际 {em:,.1f} 万，预估边际 {pm:,.1f} 万")
            if lr > 75: rpt.add(f"  - 满期赔付率 {lr:.1f}%")
            if ir > 12: rpt.add(f"  - 满期出险率 {ir:.1f}%")

            # 新转续亮点
            for vt in vt_names:
                vt_d = {}
                for row_d in con.execute(f"""
                SELECT {kpi_select(EARNED)}
                FROM (SELECT *, {vehicle_type_expr} AS 车辆类型 FROM read_parquet('{GLOB}', union_by_name=true)
                      WHERE {base_where} AND {yr_where(yr)}) sub
                WHERE 车辆类型 = '{vt}'
                """).fetchall():
                    vt_d = dict(zip([d2[0] for d2 in con.execute("SELECT 1").description], row_d))
                # simplified: just re-query
                pass
        rpt.add()

        # 关键发现（自动规则引擎）
        rpt.add("### 关键发现\n")

        findings = []

        # ---- 边际贡献趋势 ----
        if len(years) >= 2:
            first_d = yr_data.get(years[0], {})
            last_d = yr_data.get(years[-1], {})
            first_em = first_d.get("earned_margin") or 0
            last_em = last_d.get("earned_margin") or 0
            if last_em < 0 and first_em > 0:
                findings.append(f"🔴 **边际贡献转负**：从 {years[0]}年 {first_em:,.1f}万 恶化至 {years[-1]}年 {last_em:,.1f}万，机构整体亏损")
            elif last_em < first_em * 0.5 and first_em > 0:
                findings.append(f"🟡 **边际贡献大幅萎缩**：从 {years[0]}年 {first_em:,.1f}万 降至 {years[-1]}年 {last_em:,.1f}万")

        # ---- 件均保费下降 ----
        if len(years) >= 2:
            first_ap = (yr_data.get(years[0], {}).get("avg_premium") or 0)
            last_ap = (yr_data.get(years[-1], {}).get("avg_premium") or 0)
            if first_ap > 0 and last_ap > 0:
                drop_pct = (last_ap - first_ap) / first_ap * 100
                if drop_pct < -15:
                    findings.append(f"🔴 **件均保费持续下滑**：{first_ap:,d}元→{last_ap:,d}元（{drop_pct:+.1f}%），定价空间被压缩")
                elif drop_pct < -5:
                    findings.append(f"🟡 **件均保费下降**：{first_ap:,d}元→{last_ap:,d}元（{drop_pct:+.1f}%）")

        # ---- 赔付率恶化 ----
        if len(years) >= 2:
            first_lr = first_d.get("loss_ratio") or 0
            last_lr = last_d.get("loss_ratio") or 0
            if last_lr - first_lr > 15:
                findings.append(f"🔴 **赔付率显著恶化**：{first_lr:.1f}%→{last_lr:.1f}%（+{last_lr - first_lr:.1f}pp）")

        # ---- 转保占比 ----
        transfer_d = vt_data.get("旧车转保", {})
        total_pol = sum((d.get("policy_count") or 0) for d in vt_data.values())
        transfer_pol = transfer_d.get("policy_count") or 0
        if total_pol > 0:
            transfer_pct = transfer_pol / total_pol * 100
            if transfer_pct > 50:
                transfer_lr = transfer_d.get("loss_ratio") or 0
                findings.append(f"🔴 **转保占比过高**：{transfer_pol:,d}单（{transfer_pct:.0f}%），赔付率 {transfer_lr:.1f}%——逆选择风险高")
            elif transfer_pct > 35:
                findings.append(f"🟡 **转保占比较高**：{transfer_pol:,d}单（{transfer_pct:.0f}%），需关注风险质量")

        # ---- 新车亏损 ----
        new_d = vt_data.get("新车", {})
        new_lr = new_d.get("loss_ratio") or 0
        new_em = new_d.get("earned_margin") or 0
        if new_lr > 100 and new_em < -50:
            findings.append(f"🔴 **新车业务持续亏损**：赔付率 {new_lr:.1f}%，满期边际 {new_em:,.1f}万")

        # ---- 风险评分覆盖率 ----
        no_grade_d = gr_data.get("无评分", {})
        no_grade_pol = no_grade_d.get("policy_count") or 0
        total_grade_pol = sum((d.get("policy_count") or 0) for d in gr_data.values())
        if total_grade_pol > 0:
            no_grade_pct = no_grade_pol / total_grade_pol * 100
            if no_grade_pct > 60:
                findings.append(f"🟡 **风险评分覆盖不足**：{no_grade_pol:,d}单（{no_grade_pct:.0f}%）无评分，精准定价受限")

        # ---- 新能源亏损 ----
        nev_d = en_data.get("新能源", {})
        nev_lr = nev_d.get("loss_ratio") or 0
        if nev_lr > 90:
            nev_pol = nev_d.get("policy_count") or 0
            findings.append(f"🟡 **新能源车亏损**：{nev_pol:,d}单，赔付率 {nev_lr:.1f}%，出险率远高于燃油车")

        # ---- 费用率波动 ----
        if len(years) >= 3:
            frs = [(yr_data.get(y, {}).get("expense_ratio") or 0) for y in years]
            fr_range = max(frs) - min(frs)
            if fr_range > 8:
                findings.append(f"🟡 **费用率波动大**：{min(frs):.1f}%~{max(frs):.1f}%（波幅 {fr_range:.1f}pp），管控不稳定")

        if findings:
            for f in findings:
                rpt.add(f"- {f}")
        else:
            rpt.add("- 🟢 各项指标在合理范围内，未发现重大异常")
        rpt.add()

        # 新转续详情
        rpt.add("**新转续过户**：")
        for vt in vt_names:
            d = vt_data.get(vt, {})
            p = d.get("written_premium") or 0
            lr = d.get("loss_ratio") or 0
            em = d.get("earned_margin") or 0
            vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
            rpt.add(f"- {vt}：保费 {p:,.1f} 万，赔付率 {lr:.1f}%，变动成本率 {vc:.1f}%，边际 {em:,.1f} 万")
        rpt.add()

        # 风险评分
        rpt.add("**风险评分**：")
        for g in grade_names:
            d = gr_data.get(g, {})
            p = d.get("written_premium") or 0
            lr = d.get("loss_ratio") or 0
            if p > 0:
                vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
                rpt.add(f"- 等级{g}：保费 {p:,.1f} 万，赔付率 {lr:.1f}%，变动成本率 {vc:.1f}%")
        rpt.add()

        # 建议下一步
        rpt.add("### 建议下一步\n")
        next_steps = []
        if transfer_pct > 50:
            next_steps.append("按经代/渠道拆分转保来源，识别高赔付经代")
        if no_grade_pct > 60:
            next_steps.append("提升风险评分覆盖率，优先对转保业务做风险分级")
        if nev_lr > 90:
            next_steps.append("单独出新能源诊断（按品牌/车型细分），制定差异化定价")
        if len(years) >= 2 and (last_d.get("expense_ratio") or 0) > (first_d.get("expense_ratio") or 0) + 3:
            next_steps.append("按渠道/经代拆分费用率，定位费用失控环节")
        # 通用建议
        suggestions = con.execute(f"""
        SELECT
            COUNT(DISTINCT 三级机构) AS 机构数,
            COUNT(DISTINCT 业务员) AS 业务员数,
            COUNT(DISTINCT 经代名) AS 经代数,
            COUNT(DISTINCT 客户类别) AS 客户类别数,
            COUNT(DISTINCT 险别组合) AS 险别组合数
        FROM read_parquet('{GLOB}', union_by_name=true) WHERE {base_where}
        """).fetchone()
        if suggestions[2] > 3:
            next_steps.append(f"按经代公司（{suggestions[2]} 个）拆分对比变动成本率")
        if suggestions[1] > 10:
            next_steps.append(f"Top 业务员（{suggestions[1]} 人）产能和质量排名")
        if not next_steps:
            next_steps.append("各项指标稳定，可按季度持续监控")

        for s in next_steps:
            rpt.add(f"- {s}")
        rpt.add()

    # Save
    safe_title = "".join(c for c in title if c.isalnum() or c in "._- ")[:20]
    fname = f"{safe_title}_经营诊断_{min_yr}_{max_yr}_截至{max_sign}.md"
    out = Path(args.output) / fname
    out.write_text("\n".join(rpt.lines), encoding="utf-8")
    print(f"\n✅ {out} ({len(rpt.lines)} 行)")


if __name__ == "__main__":
    main()
