#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断工具公共模块 — 格式化、亮灯、SQL 构建器、报告基类

被 diagnose_vehicle.py 和 diagnose_agent.py 共享。
指标注册表对照：server/src/config/metric-registry/categories/cost.ts
"""

from pathlib import Path

# ============================================================================
# 路径 & SQL 常量
# ============================================================================

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
OUT_DIR = str(PROJECT_ROOT / "数据分析报告")

# 闰年感知：保险期限 = 起期+1年-起期（365 或 366 天）
POLICY_TERM = "DATE_DIFF('day', 保险起期, 保险起期 + INTERVAL 1 YEAR)"
EARNED_DAYS = f"LEAST(DATE_DIFF('day', 保险起期, CURRENT_DATE), {POLICY_TERM})"
EARNED = f"保费 * CAST({EARNED_DAYS} AS DOUBLE) / CAST({POLICY_TERM} AS DOUBLE)"


# ============================================================================
# 格式化函数
# ============================================================================

def fw(v):
    """万元格式"""
    return "-" if v is None else f"{v:,.1f}"

def fp(v):
    """百分比格式"""
    return "-" if v is None else f"{v:.1f}%"

def fi(v):
    """整数格式（年份不加千分位）"""
    if v is None:
        return "-"
    v = int(v) if isinstance(v, float) else v
    return str(v) if 2000 <= v <= 2099 else f"{v:,d}"

def fc(v):
    """系数格式"""
    return "-" if v is None else f"{v:.4f}"

def escape_sql(val: str) -> str:
    """转义 SQL 字符串中的单引号"""
    return val.replace("'", "''")


# ============================================================================
# 四级亮灯体系
# ============================================================================

def light(v, thresholds, higher_worse=True):
    """🟢正常 🔵关注 🟡预警 🔴危险
    thresholds = (关注, 预警, 危险) 三档阈值"""
    if v is None:
        return ""
    notice, warn, danger = thresholds
    if higher_worse:
        if v > danger:
            return " 🔴"
        if v > warn:
            return " 🟡"
        if v > notice:
            return " 🔵"
        return " 🟢"
    else:
        if v < danger:
            return " 🔴"
        if v < warn:
            return " 🟡"
        if v < notice:
            return " 🔵"
        return " 🟢"


# 阈值配置 (关注, 预警, 危险)
TH_VC = (85, 91, 94)                # 变动成本率 — variable_cost_ratio
TH_MR = (15, 9, 6)                  # 边际贡献率（越低越差）
TH_LR = (60, 70, 75)                # 满期赔付率 — earned_claim_ratio
TH_IR = (8, 10, 12)                 # 满期出险率 — earned_loss_frequency
TH_AC_CARGO = (8000, 10000, 12000)  # 案均赔款-货车 — avg_claim_amount


# ============================================================================
# SQL 构建器
# ============================================================================

def kpi_select(group_col: str = None) -> str:
    """构建标准 KPI SELECT 子句

    口径（v4.0）：
    - earned_premium: 闰年感知（policy_term=365/366）
    - incident_rate: (赔案/保单) × (保险期限/满期天数)
    - pricing_coeff: 仅险类='商业保险'
    """
    g = f"{group_col}," if group_col else ""
    return f"""
        {g}
        COUNT(DISTINCT 保单号)::INT AS policy_count,
        ROUND(SUM(保费)/10000, 1) AS written_premium,
        ROUND(AVG(CASE WHEN 保费>0 THEN 保费 END), 0)::INT AS avg_premium,
        ROUND(SUM({EARNED})/10000, 1) AS earned_premium,
        ROUND(SUM(COALESCE(已报告赔款,0))/10000, 1) AS reported_claims,
        SUM(COALESCE(赔案件数,0))::INT AS claim_cases,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM(COALESCE(赔案件数,0)),0), 0)::INT AS avg_claim,
        COUNT(DISTINCT CASE WHEN COALESCE(赔案件数,0)>0 THEN 保单号 END)::INT AS claim_policies,
        ROUND(SUM(COALESCE(费用金额,0))/10000, 1) AS fee_amount,
        ROUND(SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)*100, 1) AS loss_ratio,
        ROUND(SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0)*100, 1) AS expense_ratio,
        -- earned_loss_frequency: (赔案/保单) × (保险期限/满期天数)
        ROUND(SUM(COALESCE(赔案件数,0) * CAST({POLICY_TERM} AS DOUBLE)
                  / NULLIF(CAST({EARNED_DAYS} AS DOUBLE), 0))
              / NULLIF(COUNT(DISTINCT 保单号), 0) * 100, 2) AS incident_rate,
        -- earned_margin_amount
        ROUND(SUM({EARNED})*(1-SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)
              -SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0))/10000, 1) AS earned_margin,
        -- projected_margin_amount
        ROUND(SUM(保费)*(1-SUM(COALESCE(已报告赔款,0))/NULLIF(SUM({EARNED}),0)
              -SUM(COALESCE(费用金额,0))/NULLIF(SUM(保费),0))/10000, 1) AS projected_margin,
        -- pricing_coeff: 仅商业险
        ROUND(AVG(CASE WHEN 险类 = '商业保险' AND 商车自主定价系数 IS NOT NULL AND 商车自主定价系数 > 0
              THEN 商车自主定价系数 END), 4) AS pricing_coeff
    """


def query_kpi(con, where: str, group_col: str = None) -> list:
    """执行标准 KPI 查询，返回 [dict, ...]"""
    sel = kpi_select(group_col)
    gb = f"GROUP BY {group_col}" if group_col else ""
    ob = f"ORDER BY {group_col}" if group_col else ""
    sql = f"SELECT {sel} FROM read_parquet('{GLOB}', union_by_name=true) WHERE {where} {gb} {ob}"
    result = con.execute(sql)
    cols = [d[0] for d in result.description]
    return [dict(zip(cols, row)) for row in result.fetchall()]


def detect_risk_field(con, where: str) -> str:
    """智能检测风险评分字段：按客户类别 COALESCE 覆盖率最高的字段"""
    sql = f"""
    SELECT
        SUM(CASE WHEN 车险风险等级 IS NOT NULL THEN 1 ELSE 0 END) AS f1,
        SUM(CASE WHEN 大货车评分 IS NOT NULL THEN 1 ELSE 0 END) AS f2,
        SUM(CASE WHEN 小货车评分 IS NOT NULL THEN 1 ELSE 0 END) AS f3
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {where}
    """
    r = con.execute(sql).fetchone()
    fields = [("车险风险等级", r[0] or 0), ("大货车评分", r[1] or 0), ("小货车评分", r[2] or 0)]
    fields.sort(key=lambda x: -x[1])
    non_zero = [f[0] for f in fields if f[1] > 0]
    if not non_zero:
        return "车险风险等级"
    return f"COALESCE({', '.join(non_zero)})"


# ============================================================================
# KPI 行生成器
# ============================================================================

def kpi_rows(d: dict) -> list:
    """从标准 KPI dict 生成 [(label, value_str), ...]"""
    vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
    mr = 100 - vc
    return [
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


def sum_kpi_dicts(dicts: list) -> dict:
    """合并多个 KPI dict 为汇总（率指标重算）"""
    if not dicts:
        return {}
    total = {}
    sum_keys = ["policy_count", "written_premium", "earned_premium",
                "reported_claims", "claim_cases", "claim_policies", "fee_amount"]
    for k in sum_keys:
        total[k] = sum(d.get(k) or 0 for d in dicts)

    ep = total["earned_premium"]
    wp = total["written_premium"]
    total["loss_ratio"] = round(total["reported_claims"] / ep * 100, 1) if ep else None
    total["expense_ratio"] = round(total["fee_amount"] / wp * 100, 1) if wp else None
    total["incident_rate"] = round(total["claim_policies"] / total["policy_count"] * 100, 1) if total["policy_count"] else None
    total["avg_claim"] = round(total["reported_claims"] * 10000 / total["claim_cases"]) if total["claim_cases"] else None
    total["avg_premium"] = round(wp * 10000 / total["policy_count"]) if total["policy_count"] else None

    lr = total["loss_ratio"] or 0
    fr = total["expense_ratio"] or 0
    total["earned_margin"] = round(ep * (1 - lr / 100 - fr / 100), 1) if ep else None
    total["projected_margin"] = round(wp * (1 - lr / 100 - fr / 100), 1) if wp else None

    coeffs = [d.get("pricing_coeff") for d in dicts if d.get("pricing_coeff")]
    total["pricing_coeff"] = round(sum(coeffs) / len(coeffs), 4) if coeffs else None
    return total


# ============================================================================
# 趋势分析文字生成
# ============================================================================

def trend_text(vals: list, years: list) -> str:
    """从值列表生成趋势文字"""
    clean = [(y, v) for y, v in zip(years, vals) if v is not None]
    if len(clean) < 2:
        return ""
    first_v = clean[0][1]
    last_v = clean[-1][1]
    max_v = max(v for _, v in clean)
    min_v = min(v for _, v in clean)
    max_yr = [y for y, v in clean if v == max_v][0]
    min_yr = [y for y, v in clean if v == min_v][0]

    if first_v == 0:
        avg_v = sum(v for _, v in clean) / len(clean)
        return f"均值{avg_v:.1f}"

    change = (last_v - first_v) / abs(first_v) * 100
    if abs(change) < 5:
        trend = "平稳"
    elif change > 30:
        trend = "大幅上升↑"
    elif change > 10:
        trend = "上升↗"
    elif change < -30:
        trend = "大幅下降↓"
    elif change < -10:
        trend = "下降↘"
    else:
        trend = "微变"

    if isinstance(last_v, float) and abs(last_v) < 200:
        return f"{trend} 高{max_yr}:{max_v:.1f} 低{min_yr}:{min_v:.1f}"
    return f"{trend} 高{max_yr} 低{min_yr}"


# ============================================================================
# KPI 指标键列表（用于趋势/维度分析遍历）
# ============================================================================

METRIC_KEYS = [
    ("earned_margin", "边际贡献额"),
    ("projected_margin", "预估边际"),
    ("_vc", "变动成本率"),
    ("_mr", "边际贡献率"),
    None,
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


def get_metric_value(d: dict, key: str):
    """从 KPI dict 中获取指标值（支持 _vc/_mr 计算字段）"""
    if key == "_vc":
        return (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
    elif key == "_mr":
        return 100 - ((d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0))
    return d.get(key)
