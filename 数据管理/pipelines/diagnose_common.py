#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断工具公共模块 — 格式化、亮灯、SQL 构建器、报告基类

被 diagnose_vehicle.py 和 diagnose_agent.py 共享。
指标注册表对照：server/src/config/metric-registry/categories/cost.ts
"""

import os
from pathlib import Path

# ============================================================================
# 路径 & SQL 常量
# ============================================================================

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
# 数据根：默认 数据管理/；CHEXIAN_DATA_ROOT env 可覆盖（worktree 内跑、数据只在主仓时指向主仓）
DATA_ROOT = Path(os.environ.get("CHEXIAN_DATA_ROOT") or SCRIPT_DIR.parent)

# ============================================================================
# 多省省份路由（ADR D5 · 全诊断族数据源单一事实源）
# ============================================================================
# 诊断脚本族（diagnose_*/ulr_*/moto_*）与 renewal_common 复用本路由，杜绝每脚本各自硬编码
# fact/ 路径致 BRANCH_CODE=SX 静默读四川（2026-06-28 技能层审计 ~18 处缺口的统一根因）。
# SC→生产 fact/；非 SC 省→隔离区 validation/<省>/（SX GATED：生产 current/ 无 SX 数据，验证数据
# 在 validation/SX/）。fail-closed：未知省份立即 RuntimeError，禁止静默回落四川（data-pipeline.md 红线）。
BRANCH_CODE = (os.environ.get("BRANCH_CODE") or "SC").strip() or "SC"
KNOWN_BRANCHES = frozenset({"SC", "SX"})


def branch_paths(branch, data_root=DATA_ROOT):
    """省份 → 数据源路径（多省路由纯函数 · 全诊断族 SSOT，不依赖模块级 BRANCH_CODE）。

    返回 policy_glob/claims_glob/quotes/renewal_tracker；诊断脚本取 policy_glob+claims_glob，
    renewal_common 取 policy_glob+quotes+renewal_tracker。报告落地 out_dir 各模块自处理
    （diagnose 用 PROJECT_ROOT 基准、renewal 用 DATA_ROOT 基准，历史不同，不并入本函数）。
    fail-closed：未知省份立即 RuntimeError，禁止静默回落四川 fact/ 路径。
    """
    if branch not in KNOWN_BRANCHES:
        raise RuntimeError(
            f"未知省份代码 '{branch}'，已注册省份：{sorted(KNOWN_BRANCHES)}。"
            "新省份须先在 diagnose_common.KNOWN_BRANCHES 注册。"
        )
    if branch == "SC":
        fact = data_root / "warehouse" / "fact"
        return {
            # [!S]* 排除 SX_ 前缀：fact/current 物理混放 SC+SX（Phase A 前缀架构），裸 *.parquet
            # 会混入 SX 致四川诊断虚高约 70%（实证 SC 261.6 万 + SX 183.3 万）。[!S]* 实测 SC
            # 纯净（保留数字开头 + sichuan_，排除 SX_）。文件名前缀可靠性由 governance
            # 「省份文件名前缀一致性」闸校验兜底（防未来 SX 文件名漂移成非 SX_ 前缀致静默漏）。
            "policy_glob": str(fact / "policy" / "current" / "[!S]*.parquet"),
            "claims_glob": str(fact / "claims_detail" / "claims_*.parquet"),
            "quotes": str(fact / "quotes_conversion" / "latest.parquet"),
            "renewal_tracker": str(fact / "renewal_tracker" / "latest.parquet"),
        }
    val = data_root / "warehouse" / "validation" / branch
    return {
        "policy_glob": str(val / "*.parquet"),  # 签单清单（隔离区顶层，已按省机构规范化）
        "claims_glob": str(val / "claims_detail" / "claims_*.parquet"),
        "quotes": str(val / "quotes_conversion" / "latest.parquet"),
        "renewal_tracker": str(val / "renewal_tracker" / "latest.parquet"),
    }


# 模块级常量经 branch_paths 路由（含未知省 fail-closed）：穿透 import 这些常量的诊断脚本（diagnose_vehicle 等）
_PATHS = branch_paths(BRANCH_CODE)
GLOB = _PATHS["policy_glob"]
CLAIMS_GLOB = _PATHS["claims_glob"]
# 报告落地：PROJECT_ROOT 基准（向后兼容 diagnose 历史输出位置）；SC 无后缀、非 SC 省加 /<省>/ 隔离
OUT_DIR = str(PROJECT_ROOT / "数据分析报告" / BRANCH_CODE) if BRANCH_CODE != "SC" else str(PROJECT_ROOT / "数据分析报告")

# 闰年感知：保险期限 = 起期+1年-起期（365 或 366 天）
# 模块级固定成本 SQL 片段（由 set_fixed_cost_sql() 设置，kpi_select 自动使用）
_FIXED_COST_SQL: dict | None = None

def set_fixed_cost_sql(sql_dict: dict | None):
    """设置模块级固定成本 SQL 片段，供 kpi_select() 默认使用"""
    global _FIXED_COST_SQL
    _FIXED_COST_SQL = sql_dict

POLICY_TERM = "DATE_DIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR)"
EARNED_DAYS = f"LEAST(DATE_DIFF('day', insurance_start_date, CURRENT_DATE), {POLICY_TERM})"
EARNED = f"premium * CAST({EARNED_DAYS} AS DOUBLE) / CAST({POLICY_TERM} AS DOUBLE)"


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
TH_CC = (99, 101, 105)              # 综合成本率 — combined_cost_ratio


# ============================================================================
# SQL 构建器
# ============================================================================

def kpi_select(group_col: str = None, fixed_cost_sql: dict = None) -> str:
    """构建标准 KPI SELECT 子句

    口径（v5.0）：
    - earned_premium: 闰年感知（policy_term=365/366）
    - incident_rate: (赔案/保单) × (保险期限/满期天数)
    - pricing_coeff: 仅insurance_type='商业保险'
    - fixed_cost / combined_cost / profit: 需传入 fixed_cost_sql（来自 fixed_cost_config）

    参数:
        group_col: GROUP BY 列名
        fixed_cost_sql: fixed_cost_config.build_fixed_cost_sql() 的返回值，为 None 时不输出固定成本列
    """
    g = f"{group_col}," if group_col else ""

    # 固定成本 SQL：优先用显式参数，其次用模块级默认值
    if fixed_cost_sql is None:
        fixed_cost_sql = _FIXED_COST_SQL

    # 固定成本相关列（配置存在时追加，否则输出 NULL — 优雅降级）
    if fixed_cost_sql:
        fc = fixed_cost_sql["fixed_total"]
        fixed_cols = f""",
        -- 固定成本（绝对值，万元）
        ROUND(SUM({fc})/10000, 1) AS fixed_cost_amount,
        -- 综合成本额（绝对值，万元）= 变动成本 + 固定成本
        ROUND((SUM(COALESCE(reported_claims,0)) + SUM(COALESCE(fee_amount,0)) + SUM({fc}))/10000, 1) AS combined_cost_amount,
        -- 综合成本率 = 综合成本额 / 满期premium（绝对值除法，非率值相加）
        ROUND((SUM(COALESCE(reported_claims,0)) + SUM(COALESCE(fee_amount,0)) + SUM({fc}))
              / NULLIF(SUM({EARNED}), 0) * 100, 1) AS combined_cost_ratio,
        -- 利润额 = 满期premium - 综合成本额
        ROUND((SUM({EARNED}) - SUM(COALESCE(reported_claims,0)) - SUM(COALESCE(fee_amount,0)) - SUM({fc}))/10000, 1) AS profit_amount"""
    else:
        fixed_cols = """,
        NULL AS fixed_cost_amount,
        NULL AS combined_cost_amount,
        NULL AS combined_cost_ratio,
        NULL AS profit_amount"""

    return f"""
        {g}
        COUNT(DISTINCT policy_no)::INT AS policy_count,
        ROUND(SUM(premium)/10000, 1) AS written_premium,
        ROUND(AVG(CASE WHEN premium>0 THEN premium END), 0)::INT AS avg_premium,
        COUNT(DISTINCT COALESCE(NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''), policy_no))::INT AS vehicle_count,
        ROUND(SUM(premium) / NULLIF(COUNT(DISTINCT COALESCE(NULLIF(TRIM(CAST(vehicle_frame_no AS VARCHAR)), ''), policy_no)), 0), 0)::INT AS per_vehicle_premium,
        ROUND(SUM({EARNED})/10000, 1) AS earned_premium,
        ROUND(SUM(COALESCE(reported_claims,0))/10000, 1) AS reported_claims,
        SUM(COALESCE(claim_cases,0))::INT AS claim_cases,
        ROUND(SUM(COALESCE(reported_claims,0))/NULLIF(SUM(COALESCE(claim_cases,0)),0), 0)::INT AS avg_claim,
        COUNT(DISTINCT CASE WHEN COALESCE(claim_cases,0)>0 THEN policy_no END)::INT AS claim_policies,
        ROUND(SUM(COALESCE(fee_amount,0))/10000, 1) AS fee_amount,
        ROUND(SUM(COALESCE(reported_claims,0))/NULLIF(SUM({EARNED}),0)*100, 1) AS loss_ratio,
        ROUND(SUM(COALESCE(fee_amount,0))/NULLIF(SUM(premium),0)*100, 1) AS expense_ratio,
        -- annualized_cases: 年化claim_cases（可加绝对值，用于跨分组汇总时重算 incident_rate）
        ROUND(SUM(COALESCE(claim_cases,0) * CAST({POLICY_TERM} AS DOUBLE)
                  / NULLIF(CAST({EARNED_DAYS} AS DOUBLE), 0)), 2) AS annualized_cases,
        -- earned_loss_frequency: (赔案/保单) × (保险期限/满期天数)
        ROUND(SUM(COALESCE(claim_cases,0) * CAST({POLICY_TERM} AS DOUBLE)
                  / NULLIF(CAST({EARNED_DAYS} AS DOUBLE), 0))
              / NULLIF(COUNT(DISTINCT policy_no), 0) * 100, 2) AS incident_rate,
        -- earned_margin_amount
        ROUND(SUM({EARNED})*(1-SUM(COALESCE(reported_claims,0))/NULLIF(SUM({EARNED}),0)
              -SUM(COALESCE(fee_amount,0))/NULLIF(SUM(premium),0))/10000, 1) AS earned_margin,
        -- projected_margin_amount
        ROUND(SUM(premium)*(1-SUM(COALESCE(reported_claims,0))/NULLIF(SUM({EARNED}),0)
              -SUM(COALESCE(fee_amount,0))/NULLIF(SUM(premium),0))/10000, 1) AS projected_margin,
        -- pricing_coeff: 仅商业险，premium加权
        ROUND(SUM(CASE WHEN insurance_type = '商业保险' AND commercial_pricing_factor > 0
              THEN commercial_pricing_factor * premium END)
              / NULLIF(SUM(CASE WHEN insurance_type = '商业保险' AND commercial_pricing_factor > 0
              THEN premium END), 0), 4) AS pricing_coeff{fixed_cols}
    """


def _ensure_claims_view(con):
    """确保 claims 聚合视图存在（惰性创建，去重 claim_no 防跨分区重复）"""
    try:
        con.execute("SELECT 1 FROM _claims_agg LIMIT 0")
    except Exception:
        con.execute(f"""
            CREATE OR REPLACE VIEW _claims_agg AS
            SELECT policy_no,
                   COUNT(DISTINCT claim_no) AS claim_cases,
                   SUM(CASE WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                            ELSE COALESCE(reserve_amount, 0) END) AS reported_claims
            FROM (SELECT DISTINCT ON (claim_no) *
                  FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true)
                  -- tie-breaker(护栏,与 diagnose_lr_projection v_claims_agg 对齐):同一 claim_no
                  -- 跨分区多版本时取最新版本赔案(报案→结案→赔付时间倒序),消除 DISTINCT ON 随机选行。
                  -- 当前 claim_no 唯一不触发,纯防御(防未来 ETL 产生重复)。语义=取最新赔案版本,
                  -- 与 policy-dedup.ts「禁为消除抖动而确定化」不冲突(此为明确业务取版本规则,非脏组随机归属)。
                  -- 本子查询无 report_time WHERE 过滤(异于 lr_projection),故 report_time 亦加 NULLS LAST。
                  ORDER BY claim_no, report_time DESC NULLS LAST,
                           settlement_time DESC NULLS LAST,
                           payment_time DESC NULLS LAST)
            GROUP BY policy_no
        """)


def joined_source(con) -> str:
    """返回 policy LEFT JOIN claims 的 FROM 子句（公开接口，供 sections 使用）"""
    _ensure_claims_view(con)
    return f"""(
        SELECT p.*, COALESCE(c.claim_cases, 0) AS claim_cases,
               COALESCE(c.reported_claims, 0) AS reported_claims
        FROM read_parquet('{GLOB}', union_by_name=true) p
        LEFT JOIN _claims_agg c ON p.policy_no = c.policy_no
    )"""


def query_kpi(con, where: str, group_col: str = None, fixed_cost_sql: dict = None) -> list:
    """执行标准 KPI 查询，返回 [dict, ...]

    自动 LEFT JOIN claims_detail 聚合赔案数据（claim_cases, reported_claims）。

    参数:
        fixed_cost_sql: fixed_cost_config.build_fixed_cost_sql() 返回值，为 None 时固定成本列输出 NULL
    """
    sel = kpi_select(group_col, fixed_cost_sql)
    gb = f"GROUP BY {group_col}" if group_col else ""
    ob = f"ORDER BY {group_col}" if group_col else ""
    source = joined_source(con)
    sql = f"SELECT {sel} FROM {source} WHERE {where} {gb} {ob}"
    result = con.execute(sql)
    cols = [d[0] for d in result.description]
    return [dict(zip(cols, row)) for row in result.fetchall()]


def detect_risk_field(con, where: str) -> str:
    """智能检测风险评分字段：三字段已合并为统一的 insurance_grade"""
    # 2026-03-24: insurance_grade/小货车评分/大货车评分 已合并为 insurance_grade
    # 直接检测该字段是否有数据
    sql = f"""
    SELECT SUM(CASE WHEN insurance_grade IS NOT NULL THEN 1 ELSE 0 END) AS f1
    FROM read_parquet('{GLOB}', union_by_name=true) WHERE {where}
    """
    r = con.execute(sql).fetchone()
    if (r[0] or 0) > 0:
        return "insurance_grade"
    return "insurance_grade"


# ============================================================================
# KPI 行生成器
# ============================================================================

def kpi_rows(d: dict) -> list:
    """从标准 KPI dict 生成 [(label, value_str), ...]"""
    vc = (d.get("loss_ratio") or 0) + (d.get("expense_ratio") or 0)
    mr = 100 - vc
    cc = d.get("combined_cost_ratio")
    rows = [
        ("**满期边际贡献额**", f"**{fw(d.get('earned_margin'))}**"),
        ("**预估边际贡献额**", f"**{fw(d.get('projected_margin'))}**"),
        ("**变动成本率**", f"**{fp(vc)}**{light(vc, TH_VC)}"),
        ("**边际贡献率**", f"**{fp(mr)}**{light(mr, TH_MR, False)}"),
    ]
    # 综合成本率/利润额（配置存在时输出）
    if cc is not None:
        rows.extend([
            ("**综合成本率**", f"**{fp(cc)}**{light(cc, TH_CC)}"),
            ("**利润额**", f"**{fw(d.get('profit_amount'))}**"),
        ])
    rows.extend([
        ("── 赔付 ──", ""),
        ("满期赔付率", f"{fp(d.get('loss_ratio'))}{light(d.get('loss_ratio'), TH_LR)}"),
        ("reported_claims", fw(d.get("reported_claims"))),
        ("claim_cases", fi(d.get("claim_cases"))),
        ("案均赔款 †", f"{fi(d.get('avg_claim'))}{light(d.get('avg_claim'), TH_AC_CARGO)}"),
        ("── 出险 ──", ""),
        ("满期出险率", f"{fp(d.get('incident_rate'))}{light(d.get('incident_rate'), TH_IR)}"),
        ("有赔案保单数", fi(d.get("claim_policies"))),
        ("── 费用 ──", ""),
        ("费用率", fp(d.get("expense_ratio"))),
        ("fee_amount", fw(d.get("fee_amount"))),
        ("── premium ──", ""),
        ("保单数", fi(d.get("policy_count"))),
        ("签单premium", fw(d.get("written_premium"))),
        ("满期premium", fw(d.get("earned_premium"))),
        ("件均premium †", fi(d.get("avg_premium"))),
        ("车均premium †", fi(d.get("per_vehicle_premium"))),
        ("── 系数 ──", ""),
        ("商车定价系数", fc(d.get("pricing_coeff"))),
    ])
    return rows


def sum_kpi_dicts(dicts: list) -> dict:
    """合并多个 KPI dict 为汇总（率值指标基于绝对值重算，禁止对子项率值做平均）
    治理规则：所有率值 = 聚合后分子 / 聚合后分母，详见 CLAUDE.md §率值指标治理
    """
    if not dicts:
        return {}
    total = {}
    sum_keys = ["policy_count", "written_premium", "earned_premium",
                "reported_claims", "claim_cases", "claim_policies", "fee_amount",
                "annualized_cases", "vehicle_count",
                "fixed_cost_amount", "combined_cost_amount"]
    for k in sum_keys:
        total[k] = sum(d.get(k) or 0 for d in dicts)

    ep = total["earned_premium"]
    wp = total["written_premium"]
    total["loss_ratio"] = round(total["reported_claims"] / ep * 100, 1) if ep else None
    total["expense_ratio"] = round(total["fee_amount"] / wp * 100, 1) if wp else None
    # 年化出险率：基于可加绝对值 annualized_cases（B类率值，禁止用 claim_policies/policy_count 简化）
    total["incident_rate"] = round(
        total["annualized_cases"] / total["policy_count"] * 100, 1
    ) if total["policy_count"] and total.get("annualized_cases") else None
    total["avg_claim"] = round(total["reported_claims"] * 10000 / total["claim_cases"]) if total["claim_cases"] else None
    total["avg_premium"] = round(wp * 10000 / total["policy_count"]) if total["policy_count"] else None
    total["per_vehicle_premium"] = round(wp * 10000 / total["vehicle_count"]) if total.get("vehicle_count") else None

    lr = total["loss_ratio"] or 0
    fr = total["expense_ratio"] or 0
    total["earned_margin"] = round(ep * (1 - lr / 100 - fr / 100), 1) if ep else None
    total["projected_margin"] = round(wp * (1 - lr / 100 - fr / 100), 1) if wp else None

    # 定价系数：premium加权平均
    coeff_weighted = sum((d.get("pricing_coeff") or 0) * (d.get("written_premium") or 0)
                         for d in dicts if d.get("pricing_coeff"))
    coeff_premium = sum((d.get("written_premium") or 0)
                        for d in dicts if d.get("pricing_coeff"))
    total["pricing_coeff"] = round(coeff_weighted / coeff_premium, 4) if coeff_premium else None

    # 综合成本率/利润额（绝对值除法，非率值相加）
    fca = total.get("fixed_cost_amount") or 0
    cca = total.get("combined_cost_amount") or 0
    if fca and ep:
        total["combined_cost_ratio"] = round(cca * 10000 / (ep * 10000) * 100, 1) if ep else None
        total["profit_amount"] = round(ep - cca, 1) if ep else None
    else:
        total["combined_cost_ratio"] = None
        total["profit_amount"] = None

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
    ("combined_cost_ratio", "综合成本率"),
    ("profit_amount", "利润额"),
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
    ("written_premium", "premium"),
    ("earned_premium", "满期premium"),
    ("avg_premium", "件均"),
    ("per_vehicle_premium", "车均"),
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
