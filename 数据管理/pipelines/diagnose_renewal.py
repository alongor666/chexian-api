#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""续保诊断 — 责任模式 / 报价提前天数 / 折扣降幅 / 团队产能 / 待跟进清单

数据源（只读 Parquet）：
- renewal_funnel/*.parquet — 应续盘（含 renewal_mode 自留/兜底、is_quoted、is_renewed）
- policy/current/*.parquet — 上年原单（拿 prior_premium、prior_factor、coverage_combination）
- quotes_conversion/latest.parquet — 报价（拿 first_quote_date 算提前天数 / quote_factor / quote_premium）

时间口径（与续保模块对齐）：
  ytd            — 应续 expiry ∈ [year-01-01, year-12-31]，cutoff = today
  mtd_today      — expiry 当月，cutoff = today
  next_to_eom    — today ≤ expiry ≤ 当月最后一天，cutoff = today
  next_30_days   — today ≤ expiry ≤ today + 30，cutoff = today
  by_month       — 同 ytd 但报告按 expiry 月份切片
  custom         — 通过 --start --end 自定义

责任模式（renewal_mode）：
  自留 — 业务员自己跟进
  兜底 — 电销坐席跟进
  未分类 — 历史遗留
（注意：renewal_mode 是责任分配，不直接代表续回结果。续回结果由 is_renewed 标识）

CLI:
  python3 数据管理/pipelines/diagnose_renewal.py
    [--time-view ytd|mtd_today|next_to_eom|next_30_days|by_month|custom]
    [--year 2026] [--month 4]
    [--start 2026-04-01 --end 2026-04-30]   # custom 时必填
    [--cutoff 2026-04-26]                    # 默认 today
    [--org 天府]                              # 三级机构筛选
    [--team 蒲江]                             # 销售团队筛选
    [--insurance-type 商业保险]                # 默认商业保险
    [--no-action-list]                        # 关闭待跟进 CSV 输出
    [--top-n 15]                              # 团队产能 / 业务员排名取前 N（默认 15）
"""
from __future__ import annotations

import argparse
import calendar
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from diagnose_common import fp, fi, fc, fw, light  # noqa: E402

PROJECT_ROOT = SCRIPT_DIR.parent.parent
POLICY_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
QUOTES_PATH = str(PROJECT_ROOT / "数据管理/warehouse/fact/quotes_conversion/latest.parquet")
FUNNEL_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/renewal/renewal_funnel_*.parquet")
REPORT_DIR = PROJECT_ROOT / "数据管理/数据分析报告"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

# 亮灯阈值（越低越差）
TH_QUOTE_RATE = (90, 80, 70)        # 报价率
TH_RENEW_RATE = (75, 65, 55)        # 续回率


# ============================================================================
# 时间窗口解析
# ============================================================================

def resolve_window(args: argparse.Namespace, today: date) -> tuple[date, date, str]:
    tv = args.time_view
    if tv == "custom":
        if not args.start or not args.end:
            raise SystemExit("--time-view custom 必须传 --start 和 --end")
        return date.fromisoformat(args.start), date.fromisoformat(args.end), "自定义窗口"
    if tv == "ytd" or tv == "by_month":
        y = args.year or today.year
        return date(y, 1, 1), date(y, 12, 31), f"{y} 全年应续"
    if tv == "mtd_today":
        y, m = (args.year or today.year), (args.month or today.month)
        last = calendar.monthrange(y, m)[1]
        return date(y, m, 1), date(y, m, last), f"{y}-{m:02d} 当月应续"
    if tv == "next_to_eom":
        last = calendar.monthrange(today.year, today.month)[1]
        return today, date(today.year, today.month, last), "今至月末到期"
    if tv == "next_30_days":
        return today, today + timedelta(days=30), "未来 30 天到期"
    raise SystemExit(f"未知 --time-view: {tv}")


# ============================================================================
# 数据集构造（一次性 JOIN，后续 sections 在 DataFrame 上分组）
# ============================================================================

def load_dataset(
    win_start: date, win_end: date, insurance_type: str,
    org: str | None, team: str | None
) -> pd.DataFrame:
    con = duckdb.connect(":memory:")

    extra: list[str] = []
    params: list[object] = [insurance_type, win_start, win_end]
    if org:
        extra.append("AND f.org_level_3 = ?")
        params.append(org)
    if team:
        extra.append("AND f.team_name LIKE ?")
        params.append(f"%{team}%")
    extra_sql = "\n        ".join(extra)
    # 两次出现 insurance_type 占位（policy_prior + policy_renewed），其余按位序拼接
    params = [insurance_type, insurance_type] + params[1:]

    sql = f"""
    WITH funnel AS (
      SELECT vehicle_frame_no, policy_no, salesman_name, team_name, org_level_3,
             customer_category, insurance_grade, tonnage_segment,
             CAST(insurance_start_date AS DATE) AS insurance_start_date,
             CAST(insurance_end_date AS DATE)   AS insurance_end_date,
             is_quoted, is_renewed, renewed_policy_no,
             renewal_mode, is_self_retained, competition_level
      FROM read_parquet('{FUNNEL_GLOB}')
    ),
    policy_prior AS (
      SELECT policy_no, vehicle_frame_no,
             SUM(premium) AS prior_premium,
             ANY_VALUE(commercial_pricing_factor) AS prior_factor,
             ANY_VALUE(coverage_combination) AS coverage_combination,
             BOOL_OR(is_telemarketing) AS prior_is_telemarketing
      FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
      WHERE insurance_type = ?
        AND (endorsement_no IS NULL OR TRIM(CAST(endorsement_no AS VARCHAR)) = '')
      GROUP BY policy_no, vehicle_frame_no
    ),
    policy_renewed AS (
      SELECT policy_no, vehicle_frame_no,
             BOOL_OR(is_telemarketing) AS renewed_is_telemarketing,
             SUM(premium) AS renewed_premium
      FROM read_parquet('{POLICY_GLOB}', union_by_name=true)
      WHERE insurance_type = ?
        AND (endorsement_no IS NULL OR TRIM(CAST(endorsement_no AS VARCHAR)) = '')
      GROUP BY policy_no, vehicle_frame_no
    ),
    quote_earliest AS (
      SELECT vehicle_frame_no,
             MIN(CAST(quote_time AS DATE)) AS first_quote_date,
             ANY_VALUE(commercial_pricing_factor) AS quote_factor,
             ANY_VALUE(final_quote_premium) AS quote_premium
      FROM read_parquet('{QUOTES_PATH}')
      WHERE insurance_type = '商业保险'
        AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
      GROUP BY vehicle_frame_no
    )
    SELECT f.org_level_3, f.team_name, f.salesman_name,
           f.customer_category, f.insurance_grade, f.tonnage_segment,
           f.competition_level, f.renewal_mode,
           f.vehicle_frame_no, f.policy_no, f.renewed_policy_no,
           f.insurance_start_date, f.insurance_end_date,
           f.is_quoted, f.is_renewed,
           p.prior_premium, p.prior_factor, p.coverage_combination,
           COALESCE(p.prior_is_telemarketing, false) AS prior_is_telemarketing,
           pr.renewed_is_telemarketing,
           pr.renewed_premium,
           q.first_quote_date, q.quote_factor, q.quote_premium,
           CASE WHEN q.first_quote_date IS NOT NULL
                THEN DATE_DIFF('day', q.first_quote_date, f.insurance_end_date)
           END AS quote_lead_days,
           DATE_DIFF('day', CURRENT_DATE, f.insurance_end_date) AS days_to_expiry
    FROM funnel f
    LEFT JOIN policy_prior p ON p.policy_no = f.policy_no AND p.vehicle_frame_no = f.vehicle_frame_no
    LEFT JOIN policy_renewed pr ON pr.policy_no = f.renewed_policy_no AND pr.vehicle_frame_no = f.vehicle_frame_no
    LEFT JOIN quote_earliest q ON q.vehicle_frame_no = f.vehicle_frame_no
    WHERE f.insurance_end_date BETWEEN ? AND ?
      {extra_sql}
    """
    df = con.execute(sql, params).fetchdf()
    return df


# ============================================================================
# 板块：整体漏斗
# ============================================================================

def fmt_funnel_row(label: str, A: int, B: int, C: int) -> str:
    qr = (B / A * 100) if A else None
    rr = (C / A * 100) if A else None
    return (f"| {label} | {fi(A)} | {fi(B)} | {fp(qr)}{light(qr, TH_QUOTE_RATE, higher_worse=False)} "
            f"| {fi(C)} | {fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} |")


def section_funnel(df: pd.DataFrame, by_month: bool) -> str:
    out = ["## 1. 续保漏斗（应续 → 已报价 → 已续回）", ""]
    out.append("| 维度 | 应续 | 已报价 | 报价率 | 已续回 | 续回率 |")
    out.append("|------|------|--------|--------|--------|--------|")
    A, B, C = len(df), int(df.is_quoted.sum()), int(df.is_renewed.sum())
    out.append(fmt_funnel_row("**全期合计**", A, B, C))
    if by_month and len(df):
        df = df.assign(month=df.insurance_end_date.dt.strftime("%Y-%m"))
        for m, g in sorted(df.groupby("month")):
            out.append(fmt_funnel_row(m, len(g), int(g.is_quoted.sum()), int(g.is_renewed.sum())))
    return "\n".join(out) + "\n"


# ============================================================================
# 板块：责任模式（自留 / 兜底）
# ============================================================================

def section_renewal_mode(df: pd.DataFrame) -> str:
    out = ["## 2. 责任模式（自留 / 兜底）", "",
           "> 责任模式 = 续保跟进责任分配，与续回结果（是否续回）相互独立。",
           ""]
    out.append("| 模式 | 应续 | 占比 | 已报价 | 报价率 | 已续回 | 续回率 |")
    out.append("|------|------|------|--------|--------|--------|--------|")
    total = len(df)
    if not total:
        return "\n".join(out) + "\n（窗口内无应续数据）\n"
    for mode, g in df.groupby(df.renewal_mode.fillna("未分类")):
        A = len(g); B = int(g.is_quoted.sum()); C = int(g.is_renewed.sum())
        share = A / total * 100
        qr = B / A * 100 if A else None
        rr = C / A * 100 if A else None
        out.append(f"| {mode} | {fi(A)} | {fp(share)} | {fi(B)} | {fp(qr)}{light(qr, TH_QUOTE_RATE, higher_worse=False)} "
                   f"| {fi(C)} | {fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} |")
    return "\n".join(out) + "\n"


# ============================================================================
# 板块：报价提前天数分桶 × 续回率
# ============================================================================

LEAD_BUCKETS = [
    ("≥30 天", lambda d: d >= 30),
    ("21~29 天", lambda d: 21 <= d < 30),
    ("14~20 天", lambda d: 14 <= d < 21),
    ("7~13 天", lambda d: 7 <= d < 14),
    ("0~6 天", lambda d: 0 <= d < 7),
    ("已过期才报价（< 0）", lambda d: d < 0),
]


def section_quote_lead_time(df: pd.DataFrame) -> str:
    out = ["## 3. 报价提前天数 × 续回率", "",
           "> 提前天数 = 首次报价日 → 应到期日。一般而言，报价越早续回率越高。",
           ""]
    out.append("| 提前期 | 应续件数 | 已报价件数 | 已续回件数 | 续回率（已报价口径）|")
    out.append("|--------|---------|-----------|-----------|---------------------|")
    quoted = df[df.is_quoted == True].copy()
    if quoted.empty:
        return "\n".join(out) + "\n（窗口内无报价记录）\n"
    quoted["lead"] = quoted.quote_lead_days
    total_unquoted = int((df.is_quoted == False).sum())
    for label, pred in LEAD_BUCKETS:
        sub = quoted[quoted.lead.apply(lambda d: pd.notna(d) and pred(d))]
        A = len(sub); C = int(sub.is_renewed.sum())
        rr = C / A * 100 if A else None
        out.append(f"| {label} | {fi(A)} | {fi(A)} | {fi(C)} | {fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} |")
    out.append(f"| **未报价** | {fi(total_unquoted)} | 0 | 0 | — |")
    return "\n".join(out) + "\n"


# ============================================================================
# 板块：折扣降幅 / 保费比值 × 续回率
# ============================================================================

def section_discount_premium(df: pd.DataFrame) -> str:
    out = ["## 4. 折扣降幅 / 保费比值 × 续回率", ""]
    quoted = df[(df.is_quoted == True) & df.prior_factor.notna() & df.quote_factor.notna()].copy()
    if quoted.empty:
        return "\n".join(out) + "（窗口内无可比对的折扣数据）\n"

    quoted["discount_drop"] = quoted.quote_factor - quoted.prior_factor   # <0 = 报价折扣下降（更优惠）
    quoted["premium_ratio"] = (quoted.quote_premium / quoted.prior_premium).where(quoted.prior_premium.gt(0))

    out.append("### 4.1 报价折扣相比上年的变动（quote_factor − prior_factor）")
    out.append("| 折扣变动 | 件数 | 已续回 | 续回率 |")
    out.append("|----------|------|--------|--------|")
    discount_buckets = [
        ("降低 ≥ 0.10（更优惠）", lambda d: d <= -0.10),
        ("降低 0.05~0.10", lambda d: -0.10 < d <= -0.05),
        ("基本持平 (-0.05, +0.05)", lambda d: -0.05 < d < 0.05),
        ("上调 0.05~0.10", lambda d: 0.05 <= d < 0.10),
        ("上调 ≥ 0.10", lambda d: d >= 0.10),
    ]
    for label, pred in discount_buckets:
        sub = quoted[quoted.discount_drop.apply(lambda d: pd.notna(d) and pred(d))]
        A = len(sub); C = int(sub.is_renewed.sum())
        rr = C / A * 100 if A else None
        out.append(f"| {label} | {fi(A)} | {fi(C)} | {fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} |")

    out.append("")
    out.append("### 4.2 报价保费 / 上年保费 比值")
    out.append("| 比值区间 | 件数 | 已续回 | 续回率 |")
    out.append("|----------|------|--------|--------|")
    valid = quoted[quoted.premium_ratio.notna()]
    ratio_buckets = [
        ("≤ 0.85（明显降低）", lambda r: r <= 0.85),
        ("0.85~0.95", lambda r: 0.85 < r <= 0.95),
        ("0.95~1.05（持平）", lambda r: 0.95 < r <= 1.05),
        ("1.05~1.15", lambda r: 1.05 < r <= 1.15),
        ("> 1.15（明显上涨）", lambda r: r > 1.15),
    ]
    for label, pred in ratio_buckets:
        sub = valid[valid.premium_ratio.apply(lambda r: pd.notna(r) and pred(r))]
        A = len(sub); C = int(sub.is_renewed.sum())
        rr = C / A * 100 if A else None
        out.append(f"| {label} | {fi(A)} | {fi(C)} | {fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} |")
    return "\n".join(out) + "\n"


# ============================================================================
# 板块：团队产能（三级机构 / 销售团队 / 业务员）
# ============================================================================

def _summary(g: pd.DataFrame) -> dict:
    A = len(g); B = int(g.is_quoted.sum()); C = int(g.is_renewed.sum())
    return {"A": A, "B": B, "C": C,
            "QR": B / A * 100 if A else None,
            "RR": C / A * 100 if A else None}


def section_productivity(df: pd.DataFrame, top_n: int) -> str:
    out = ["## 5. 团队产能（应续 ≥ 20 才入选排名）", ""]

    def render(level: str, label: str, key_cols: list[str]):
        out.append(f"### 5.{level} {label} 排名 Top {top_n}")
        out.append("| 排名 | " + " | ".join(key_cols) + " | 应续 | 报价率 | 续回率 |")
        sep = "|------|" + "|".join(["------"] * len(key_cols)) + "|------|--------|--------|"
        out.append(sep)
        rows = []
        for keys, g in df.groupby(key_cols, dropna=False):
            s = _summary(g)
            if s["A"] < 20:
                continue
            rows.append((keys if isinstance(keys, tuple) else (keys,), s))
        rows.sort(key=lambda r: (r[1]["RR"] or -1), reverse=True)
        for i, (keys, s) in enumerate(rows[:top_n], 1):
            cells = " | ".join(str(k) if k else "—" for k in keys)
            out.append(f"| {i} | {cells} | {fi(s['A'])} | "
                       f"{fp(s['QR'])}{light(s['QR'], TH_QUOTE_RATE, higher_worse=False)} | "
                       f"{fp(s['RR'])}{light(s['RR'], TH_RENEW_RATE, higher_worse=False)} |")
        if len(rows) > top_n:
            out.append("")
            out.append(f"### 5.{level}.末 续回率倒数 Top 5（应续 ≥ 20）")
            out.append("| 排名 | " + " | ".join(key_cols) + " | 应续 | 报价率 | 续回率 |")
            out.append(sep)
            for i, (keys, s) in enumerate(rows[-5:], 1):
                cells = " | ".join(str(k) if k else "—" for k in keys)
                out.append(f"| {i} | {cells} | {fi(s['A'])} | "
                           f"{fp(s['QR'])}{light(s['QR'], TH_QUOTE_RATE, higher_worse=False)} | "
                           f"{fp(s['RR'])}{light(s['RR'], TH_RENEW_RATE, higher_worse=False)} |")
        out.append("")

    render("1", "三级机构", ["org_level_3"])
    render("2", "销售团队", ["org_level_3", "team_name"])
    render("3", "业务员", ["org_level_3", "team_name", "salesman_name"])
    return "\n".join(out)


# ============================================================================
# 板块：客户结构 × 责任模式
# ============================================================================

def section_customer_structure(df: pd.DataFrame) -> str:
    out = ["## 6. 客户结构 × 责任模式", "",
           "| 客户类别 | 险别组合 | 自留 应续 | 自留 续回率 | 兜底 应续 | 兜底 续回率 |",
           "|---------|---------|----------|------------|----------|------------|"]
    if df.empty:
        return "\n".join(out) + "\n"
    grouped = df.groupby([df.customer_category.fillna("未知"),
                          df.coverage_combination.fillna("未知")])
    rows = []
    for (cat, cov), g in grouped:
        if len(g) < 30:
            continue
        sub_self = g[g.renewal_mode == "自留"]
        sub_back = g[g.renewal_mode == "兜底"]
        rs = _summary(sub_self) if len(sub_self) else None
        rb = _summary(sub_back) if len(sub_back) else None
        rows.append((cat, cov, rs, rb, len(g)))
    rows.sort(key=lambda r: r[4], reverse=True)
    for cat, cov, rs, rb, _ in rows[:15]:
        a_s = rs["A"] if rs else 0
        rr_s = rs["RR"] if rs else None
        a_b = rb["A"] if rb else 0
        rr_b = rb["RR"] if rb else None
        out.append(f"| {cat} | {cov} | {fi(a_s)} | "
                   f"{fp(rr_s)}{light(rr_s, TH_RENEW_RATE, higher_worse=False)} | "
                   f"{fi(a_b)} | {fp(rr_b)}{light(rr_b, TH_RENEW_RATE, higher_worse=False)} |")
    return "\n".join(out) + "\n"


# ============================================================================
# 板块：电销渠道交叉（上年原单 × 续保单）
# ============================================================================

def section_channel_crosstab(df: pd.DataFrame) -> str:
    """交叉分析：上年原单是否电销 × 续保单是否电销。
    四类：自营续自营 / 自营续电销 / 电销续自营 / 电销续电销 + 未续回。
    渠道标记来自 policy.is_telemarketing。"""
    out = ["## 8. 电销渠道交叉（上年原单 × 续保单）", "",
           "> 渠道判定依据 `policy.is_telemarketing`：上年原单与续保单各自的电销标记。"
           "  续保单口径只统计已续回（is_renewed=true）的单子。",
           ""]

    if df.empty:
        return "\n".join(out) + "（窗口内无应续数据）\n"

    df = df.copy()
    df["prior_channel"] = df.prior_is_telemarketing.fillna(False).map(lambda v: "电销" if v else "自营")
    renewed = df[df.is_renewed == True].copy()

    # 8.1 整体交叉表
    out.append("### 8.1 整体：上年 → 续保 渠道流向（仅含已续回 N 件）")
    if renewed.empty:
        out.append("（窗口内无续回）")
        return "\n".join(out) + "\n"
    renewed["renewed_channel"] = renewed.renewed_is_telemarketing.fillna(False).map(
        lambda v: "电销" if v else "自营"
    )
    cross = renewed.groupby(["prior_channel", "renewed_channel"]).size().unstack(fill_value=0)
    total_renewed = len(renewed)

    out.append(f"- 续回总数：{total_renewed:,d}")
    out.append("")
    out.append("| 上年 → 续保 | 件数 | 占续回总数 |")
    out.append("|------------|------|-----------|")
    flows = [
        ("自营 → 自营", "自营", "自营"),
        ("自营 → 电销", "自营", "电销"),
        ("电销 → 自营", "电销", "自营"),
        ("电销 → 电销", "电销", "电销"),
    ]
    for label, prior, new in flows:
        n = int(cross.loc[prior, new]) if prior in cross.index and new in cross.columns else 0
        share = n / total_renewed * 100 if total_renewed else 0
        out.append(f"| {label} | {fi(n)} | {fp(share)} |")

    # 上年渠道总盘 + 续回率
    out.append("")
    out.append("### 8.2 上年渠道续回画像")
    out.append("| 上年渠道 | 应续 | 已续回 | 续回率 | 续回中转入电销占比 | 续回中保留自营占比 |")
    out.append("|---------|------|-------|--------|------------------|------------------|")
    for ch in ["自营", "电销"]:
        sub = df[df.prior_channel == ch]
        sub_renewed = renewed[renewed.prior_channel == ch]
        A = len(sub); C = len(sub_renewed)
        rr = C / A * 100 if A else None
        if C > 0:
            tele_ratio = (sub_renewed.renewed_channel == "电销").sum() / C * 100
            self_ratio = (sub_renewed.renewed_channel == "自营").sum() / C * 100
        else:
            tele_ratio = self_ratio = None
        out.append(f"| {ch} | {fi(A)} | {fi(C)} | {fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} "
                   f"| {fp(tele_ratio)} | {fp(self_ratio)} |")

    # 8.3 各三级机构的渠道流向占比
    out.append("")
    out.append("### 8.3 各三级机构 续回渠道流向占比（应续 ≥ 50 才入选）")
    out.append("| 三级机构 | 续回件数 | 自留自营 % | 自留→电销 % | 电销→自营 % | 电销→电销 % |")
    out.append("|---------|---------|----------|-----------|-----------|-----------|")
    rows = []
    for org, g in renewed.groupby("org_level_3"):
        org_total_apply = len(df[df.org_level_3 == org])
        if org_total_apply < 50:
            continue
        n = len(g)
        if n == 0:
            continue
        ss = ((g.prior_channel == "自营") & (g.renewed_channel == "自营")).sum() / n * 100
        st = ((g.prior_channel == "自营") & (g.renewed_channel == "电销")).sum() / n * 100
        ts = ((g.prior_channel == "电销") & (g.renewed_channel == "自营")).sum() / n * 100
        tt = ((g.prior_channel == "电销") & (g.renewed_channel == "电销")).sum() / n * 100
        rows.append((org, n, ss, st, ts, tt))
    rows.sort(key=lambda r: r[1], reverse=True)
    for org, n, ss, st, ts, tt in rows:
        out.append(f"| {org} | {fi(n)} | {fp(ss)} | {fp(st)} | {fp(ts)} | {fp(tt)} |")

    # 8.4 责任模式 (renewal_mode 自留/兜底) × 上年渠道 交叉续回率
    out.append("")
    out.append("### 8.4 责任模式 × 上年渠道 交叉续回率")
    out.append("| 责任模式 | 上年渠道 | 应续 | 已续回 | 续回率 |")
    out.append("|---------|---------|------|-------|--------|")
    for mode in ["自留", "兜底", "未分类"]:
        for ch in ["自营", "电销"]:
            sub = df[(df.renewal_mode == mode) & (df.prior_channel == ch)]
            A = len(sub); C = int(sub.is_renewed.sum())
            if A == 0:
                continue
            rr = C / A * 100
            out.append(f"| {mode} | {ch} | {fi(A)} | {fi(C)} | "
                       f"{fp(rr)}{light(rr, TH_RENEW_RATE, higher_worse=False)} |")

    return "\n".join(out) + "\n"


# ============================================================================
# 板块：待跟进清单（重点 — 输出 CSV）
# ============================================================================

def section_action_list(df: pd.DataFrame, today: date, run_id: str) -> tuple[str, Path | None]:
    out = ["## 7. 待跟进清单（重点输出）", "",
           "> 筛选条件：未报价 + 上年保费 ≥ 全样本 P75 + 上年自主系数 ≤ 全样本 P50（高价值优质客户）。",
           ""]

    candidates = df[(df.is_quoted == False) &
                    df.prior_premium.notna() &
                    df.prior_factor.notna()].copy()
    if candidates.empty:
        return "\n".join(out) + "（窗口内无未报价的候选客户）\n", None

    p75 = candidates.prior_premium.quantile(0.75)
    p50 = candidates.prior_factor.quantile(0.50)
    target = candidates[(candidates.prior_premium >= p75) &
                        (candidates.prior_factor <= p50)].copy()

    out.append(f"- 全样本未报价：{len(candidates):,d} 件")
    out.append(f"- 上年保费 P75 阈值：{p75:,.2f} 元")
    out.append(f"- 上年自主系数 P50 阈值：{p50:.4f}")
    out.append(f"- **高价值优质未报价：{len(target):,d} 件**")
    out.append("")

    if target.empty:
        return "\n".join(out), None

    target = target.sort_values(["org_level_3", "team_name", "salesman_name", "insurance_end_date"])
    cols = ["org_level_3", "team_name", "salesman_name", "customer_category",
            "coverage_combination", "vehicle_frame_no", "policy_no",
            "insurance_end_date", "days_to_expiry",
            "prior_premium", "prior_factor", "insurance_grade",
            "renewal_mode", "competition_level"]
    out_path = REPORT_DIR / f"续保待跟进_{run_id}.csv"
    target[cols].to_csv(out_path, index=False, encoding="utf-8-sig")
    out.append(f"清单文件：`{out_path.relative_to(PROJECT_ROOT)}`（按机构/团队/业务员/到期日 排序，含 14 列）")
    out.append("")
    out.append("### 7.1 按业务员聚合 Top 15（待跟进件数最多）")
    out.append("| 三级机构 | 销售团队 | 业务员 | 待跟进件数 | 上年保费合计 |")
    out.append("|---------|---------|--------|-----------|-------------|")
    by_sm = target.groupby(["org_level_3", "team_name", "salesman_name"]).agg(
        cnt=("vehicle_frame_no", "count"),
        prior_premium_sum=("prior_premium", "sum"),
    ).reset_index().sort_values("cnt", ascending=False).head(15)
    for _, r in by_sm.iterrows():
        out.append(f"| {r.org_level_3} | {r.team_name} | {r.salesman_name} "
                   f"| {fi(int(r.cnt))} | {fw(r.prior_premium_sum / 10000)} 万 |")
    return "\n".join(out) + "\n", out_path


# ============================================================================
# 主入口
# ============================================================================

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--time-view", default="ytd",
                    choices=["ytd", "mtd_today", "next_to_eom", "next_30_days", "by_month", "custom"])
    ap.add_argument("--year", type=int)
    ap.add_argument("--month", type=int)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--cutoff")
    ap.add_argument("--org")
    ap.add_argument("--team")
    ap.add_argument("--insurance-type", default="商业保险")
    ap.add_argument("--no-action-list", action="store_true")
    ap.add_argument("--top-n", type=int, default=15)
    args = ap.parse_args()

    today = date.fromisoformat(args.cutoff) if args.cutoff else date.today()
    win_start, win_end, view_label = resolve_window(args, today)

    print(f"[diagnose-renewal] 窗口 {win_start} ~ {win_end} ({view_label}) cutoff={today}", file=sys.stderr)

    df = load_dataset(win_start, win_end, args.insurance_type, args.org, args.team)
    if df.empty:
        print("窗口内无数据。请确认 funnel 是否覆盖该期间，或调整时间窗口。", file=sys.stderr)
        return 1

    run_id = today.strftime("%Y%m%d_%H%M%S")[:13] if "_" in today.strftime("%Y%m%d_%H%M%S") else today.strftime("%Y%m%d")
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    sections = []
    sections.append(f"# 续保诊断 — {view_label} ({win_start} ~ {win_end})")
    sections.append("")
    sections.append(f"- cutoff（截至日）：{today}")
    sections.append(f"- 数据规模：应续 {len(df):,d} 件")
    sections.append(f"- 筛选：org={args.org or '全部'} / team={args.team or '全部'} / insurance_type={args.insurance_type}")
    sections.append("")
    sections.append("> 亮灯：🟢 正常 · 🔵 关注 · 🟡 预警 · 🔴 危险（针对率值越低越差）")
    sections.append("")

    sections.append(section_funnel(df, args.time_view in ("ytd", "by_month")))
    sections.append(section_renewal_mode(df))
    sections.append(section_quote_lead_time(df))
    sections.append(section_discount_premium(df))
    sections.append(section_productivity(df, args.top_n))
    sections.append(section_customer_structure(df))
    sections.append(section_channel_crosstab(df))
    if not args.no_action_list:
        action_md, action_csv = section_action_list(df, today, run_id)
        sections.append(action_md)

    body = "\n".join(sections)
    out_path = REPORT_DIR / f"续保诊断_{view_label}_{run_id}.md"
    out_path.write_text(body, encoding="utf-8")
    print(body)
    print(f"\n报告已保存：{out_path.relative_to(PROJECT_ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
