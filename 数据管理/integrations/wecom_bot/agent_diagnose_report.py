#!/usr/bin/env python3
"""经代/机构诊断 HTML 报告生成器（chexian-api 报告链接化通道专用）

输入：agent_name 精确匹配 + 保险起期日期窗口（默认 2026-01-01 至 today）
输出：单文件 HTML（杂志风视觉 + 数据高密度 + 规则化问题点提示），含
  - Hero 封面（页眉 + 标题 + 统计口径）
  - 核心数字大字报（KPI 卡片）
  - 月度结构（机构 × 客户类别 × 月）
  - 6 维度分组（机构 / 类别 / 新旧车 / 能源 / 过户 / 险别）
  - 3 维度专题（仅非营业个人客车子集：年龄段 / 车价段 / 车牌归属）
  - 反馈卡片占位符

8 个核心指标公式（与 server/src/sql/kpi.ts 对齐）：
- 保费 = SUM(premium)
- 已报告赔款 = SUM(reported_claims) where reported_claims = settled_amount + pending_amount
- 满期出险率(年化) = SUM(claim_cases) / SUM(earned_days/365.25) * 100%
- 满期赔付率 = SUM(reported_claims) * 100 / SUM(earned_premium) where earned_premium = premium * earned_days / policy_term
- 件均保费 = SUM(premium) / COUNT(DISTINCT policy_no)
- 案均赔款 = SUM(reported_claims) / NULLIF(SUM(claim_cases), 0)
- 费用率 = SUM(fee_amount) * 100 / SUM(premium)
- 变动成本率 = 满期赔付率 + 费用率

颜色阈值（与项目 [memory: feedback_four_level_alert] 一致）：
- 满期出险率：8% / 10% / 12%（关注 / 预警 / 危险）
- 满期赔付率：60% / 70% / 75%
- 变动成本率：85% / 91% / 94%

口径要点（按 [memory] 项目规则）：
- policy 表 policy_no 非唯一（原单+批改），先按 (policy_no, insurance_start_date) 去重再 JOIN ClaimsAgg
- HAVING SUM(premium) > 0（净额，排除全额冲销批改）
- earned_days 用 DATEDIFF + 闰年感知 policy_term
- 率值禁加权平均，分组后绝对值聚合再算
- 样本不足 10 件不参与问题点排名（避免小样本伪信号）
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from html import escape
from pathlib import Path
from typing import Any

import duckdb

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent.parent
_DATA_ROOT = REPO_ROOT / "数据管理"
if str(_DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(_DATA_ROOT))  # 供 import pipelines.*（branch_paths SSOT）
from pipelines.branch_paths import (  # noqa: E402
    PolicyCurrentLayoutError,
    policy_current_glob,
    resolve_province,
)

# 省份轴收窄（50d62e）：policy glob 在 main 按 --province 解析后计算（fail-closed，禁全省混查）
_POLICY_CURRENT_DIR = _DATA_ROOT / "warehouse" / "fact" / "policy" / "current"
PARQUET_CLAIMS = REPO_ROOT / "数据管理" / "warehouse" / "fact" / "claims_detail" / "*.parquet"

FEEDBACK_PLACEHOLDER = "<!-- FEEDBACK_URL -->"

DIMENSIONS_ALL: list[tuple[str, str]] = [
    ("org_level_3", "三级机构"),
    ("customer_category", "客户类别"),
    ("is_new_car_label", "新旧车"),
    ("is_nev_label", "能源类型"),
    ("is_transfer_label", "是否过户"),
    ("coverage_combination", "险别组合"),
]

DIMENSIONS_PERSONAL: list[tuple[str, str]] = [
    ("driver_age_group", "车主年龄段"),
    ("price_band", "新车购置价段"),
    ("plate_prefix", "车牌归属"),
]

# 中文章节编号
CN_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]

# (列名, sql_alias, 小数位)
METRIC_COLS: list[tuple[str, str, int]] = [
    ("保费(万元)", "premium_wan", 2),
    ("已报告赔款(万元)", "reported_wan", 2),
    ("满期出险率%", "earned_incident_rate_pct", 2),
    ("满期赔付率%", "earned_loss_ratio_pct", 2),
    ("件均保费(元)", "premium_per_policy", 0),
    ("案均赔款(元)", "claim_per_case", 0),
    ("费用率%", "expense_ratio_pct", 2),
    ("变动成本率%", "variable_cost_ratio_pct", 2),
]

# 项目四级亮灯阈值：(关注, 预警, 危险)
ALERT_THRESHOLDS: dict[str, tuple[float, float, float]] = {
    "earned_incident_rate_pct": (8.0, 10.0, 12.0),
    "earned_loss_ratio_pct": (60.0, 70.0, 75.0),
    "variable_cost_ratio_pct": (85.0, 91.0, 94.0),
}

ALERT_LEVEL_TEXT = {
    "normal": ("🟢", "正常"),
    "watch": ("🔵", "关注"),
    "warn": ("🟡", "预警"),
    "danger": ("🔴", "危险"),
}

METRIC_CN_LABEL = {
    "earned_incident_rate_pct": "满期出险率",
    "earned_loss_ratio_pct": "满期赔付率",
    "variable_cost_ratio_pct": "变动成本率",
}

# 样本下限：低于此件数的格子不参与问题点排名
ISSUE_MIN_POLICIES = 10


def alert_level(metric_key: str, value: Any) -> str:
    """返回四级亮灯：normal / watch / warn / danger / unknown"""
    if value is None:
        return "unknown"
    if metric_key not in ALERT_THRESHOLDS:
        return "unknown"
    w, p, d = ALERT_THRESHOLDS[metric_key]
    f = float(value)
    if f >= d:
        return "danger"
    if f >= p:
        return "warn"
    if f >= w:
        return "watch"
    return "normal"


def build_filtered_cte(
    agent_name: str,
    start_date: str,
    end_date: str,
    policy_glob: str,
    province: str,
    personal_only: bool = False,
) -> str:
    """构造去重 + 标签化 + 派生维度的 CTE。过滤条件用 insurance_start_date 区间。

    province 已经 resolve_province fail-closed 校验；WHERE branch_code 才是省份
    隔离保证，glob 收窄仅性能辅助（data-pipeline.md 红线）。
    """
    safe_agent = agent_name.replace("'", "''")
    extra_filter = "AND customer_category = '非营业个人客车'" if personal_only else ""
    return f"""
    WITH raw_policy AS (
      SELECT
        policy_no,
        CAST(insurance_start_date AS DATE) AS insurance_start_date,
        org_level_3,
        customer_category,
        coverage_combination,
        is_new_car,
        is_nev,
        is_transfer,
        driver_age_group,
        new_vehicle_price,
        plate_no,
        premium,
        COALESCE(fee_amount, 0) AS fee_amount,
        CAST(policy_date AS DATE) AS policy_date
      FROM read_parquet('{policy_glob}', union_by_name=true)
      WHERE agent_name = '{safe_agent}'
        AND branch_code = '{province}'
        AND CAST(insurance_start_date AS DATE) BETWEEN DATE '{start_date}' AND DATE '{end_date}'
        {extra_filter}
    ),
    filtered_dedup AS (
      SELECT
        policy_no,
        insurance_start_date,
        ANY_VALUE(org_level_3) AS org_level_3,
        ANY_VALUE(customer_category) AS customer_category,
        ANY_VALUE(coverage_combination) AS coverage_combination,
        ANY_VALUE(is_new_car) AS is_new_car,
        ANY_VALUE(is_nev) AS is_nev,
        ANY_VALUE(is_transfer) AS is_transfer,
        ANY_VALUE(driver_age_group) AS driver_age_group,
        ANY_VALUE(new_vehicle_price) AS new_vehicle_price,
        ANY_VALUE(plate_no) AS plate_no,
        SUM(premium) AS premium,
        SUM(fee_amount) AS fee_amount,
        ANY_VALUE(insurance_start_date) AS insurance_start_date_anchor
      FROM raw_policy
      GROUP BY policy_no, insurance_start_date
      HAVING SUM(premium) > 0
    ),
    claims_agg AS (
      SELECT
        policy_no,
        COUNT(DISTINCT claim_no) AS claim_cases,
        SUM(COALESCE(settled_amount, 0) + COALESCE(pending_amount, 0)) AS reported_claims
      FROM read_parquet('{PARQUET_CLAIMS.as_posix()}', union_by_name=true)
      WHERE policy_no IS NOT NULL
      GROUP BY policy_no
    ),
    base AS (
      SELECT
        f.*,
        CASE WHEN f.is_new_car THEN '新车' ELSE '旧车' END AS is_new_car_label,
        CASE WHEN f.is_nev THEN '新能源' ELSE '燃油' END AS is_nev_label,
        CASE WHEN f.is_transfer THEN '过户' ELSE '非过户' END AS is_transfer_label,
        CASE
          WHEN f.new_vehicle_price IS NULL THEN '(未知)'
          WHEN f.new_vehicle_price < 50000 THEN '小于5万'
          WHEN f.new_vehicle_price < 100000 THEN '5至10万'
          WHEN f.new_vehicle_price < 150000 THEN '10至15万'
          WHEN f.new_vehicle_price < 200000 THEN '15至20万'
          WHEN f.new_vehicle_price < 300000 THEN '20至30万'
          WHEN f.new_vehicle_price < 500000 THEN '30至50万'
          ELSE '50万以上'
        END AS price_band,
        CASE
          WHEN f.plate_no IS NULL OR LENGTH(f.plate_no) < 2 THEN '(未知)'
          ELSE SUBSTR(f.plate_no, 1, 2)
        END AS plate_prefix,
        DATEDIFF('day', f.insurance_start_date, f.insurance_start_date + INTERVAL 1 YEAR) AS policy_term,
        -- earned_days 锚定到报告截止日期（codex P1 修复），不再依赖 sample 中最近保单起期
        LEAST(
          GREATEST(DATEDIFF('day', f.insurance_start_date, DATE '{end_date}'), 0),
          DATEDIFF('day', f.insurance_start_date, f.insurance_start_date + INTERVAL 1 YEAR)
        ) AS earned_days,
        COALESCE(ca.claim_cases, 0) AS claim_cases,
        COALESCE(ca.reported_claims, 0) AS reported_claims
      FROM filtered_dedup f
      LEFT JOIN claims_agg ca ON f.policy_no = ca.policy_no
    )
    """


def metrics_sql(group_by: str | None, having_premium: bool = True) -> str:
    select_dim = f"{group_by} AS dim_value," if group_by else ""
    group_clause = f"GROUP BY {group_by}" if group_by else ""
    having = "HAVING SUM(premium) > 0" if having_premium and group_by else ""
    return f"""
    SELECT
      {select_dim}
      COUNT(DISTINCT policy_no) AS policy_count,
      SUM(claim_cases) AS claim_cases,
      ROUND(SUM(premium) / 10000.0, 2) AS premium_wan,
      ROUND(SUM(reported_claims) / 10000.0, 2) AS reported_wan,
      CASE WHEN SUM(earned_days) > 0
           THEN ROUND(SUM(claim_cases) * 100.0 / (SUM(earned_days) / 365.25), 2)
           ELSE NULL END AS earned_incident_rate_pct,
      CASE WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
           THEN ROUND(SUM(reported_claims) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)), 2)
           ELSE NULL END AS earned_loss_ratio_pct,
      CASE WHEN COUNT(DISTINCT policy_no) > 0
           THEN ROUND(SUM(premium) / COUNT(DISTINCT policy_no), 0)
           ELSE NULL END AS premium_per_policy,
      CASE WHEN SUM(claim_cases) > 0
           THEN ROUND(SUM(reported_claims) / SUM(claim_cases), 0)
           ELSE NULL END AS claim_per_case,
      CASE WHEN SUM(premium) > 0
           THEN ROUND(SUM(fee_amount) * 100.0 / SUM(premium), 2)
           ELSE NULL END AS expense_ratio_pct,
      CASE WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
            AND SUM(premium) > 0
           THEN ROUND(
             SUM(reported_claims) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
             + SUM(fee_amount) * 100.0 / SUM(premium),
             2)
           ELSE NULL END AS variable_cost_ratio_pct
    FROM base
    {group_clause}
    {having}
    ORDER BY {'premium_wan DESC' if group_by else 'premium_wan'}
    """


def query(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict[str, Any]]:
    rel = con.execute(sql)
    cols = [desc[0] for desc in rel.description]
    return [dict(zip(cols, row)) for row in rel.fetchall()]


def fmt_num(v: Any, decimals: int) -> str:
    if v is None:
        return "—"
    if decimals == 0:
        return f"{int(round(float(v))):,}"
    return f"{float(v):,.{decimals}f}"


def metric_cell_class(metric_key: str, value: Any) -> str:
    """根据四级亮灯返回 CSS class。"""
    level = alert_level(metric_key, value)
    return f"num cell-{level}"


def render_metrics_row(row: dict[str, Any], dim_label: str | None = None) -> str:
    cells = []
    if dim_label is not None:
        cells.append(f'<td>{escape(dim_label)}</td>')
    cells.append(f'<td class="num">{int(row["policy_count"]):,}</td>')
    cells.append(f'<td class="num">{int(row["claim_cases"] or 0):,}</td>')
    for col_label, col_key, decimals in METRIC_COLS:
        v = row.get(col_key)
        cls = metric_cell_class(col_key, v) if col_key in ALERT_THRESHOLDS else "num"
        cells.append(f'<td class="{cls}">{fmt_num(v, decimals)}</td>')
    return "<tr>" + "".join(cells) + "</tr>"


def render_dim_table(rows: list[dict[str, Any]], dim_label: str) -> str:
    headers = (
        f"<th>{escape(dim_label)}</th>"
        '<th class="num">保单件数</th>'
        '<th class="num">报案件数</th>'
        + "".join(f'<th class="num">{escape(c)}</th>' for c, _, _ in METRIC_COLS)
    )
    body = "".join(
        render_metrics_row(r, str(r["dim_value"]) if r["dim_value"] is not None else "(未填)")
        for r in rows
    )
    return f"""
    <div class="table-wrap">
      <table>
        <thead><tr>{headers}</tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>
    """


def identify_issues(rows: list[dict[str, Any]], total_premium_wan: float) -> list[dict[str, Any]]:
    """识别问题点：影响度（保费占比）× 严重度（颜色）筛选 top 5。

    规则：
    - 仅对 policy_count >= ISSUE_MIN_POLICIES 的格子参与排名（避免小样本伪信号）
    - 必须至少有一项指标触发 watch / warn / danger
    - 排序：(最严重等级权重 × 保费占比) 降序
    """
    severity_weight = {"danger": 3, "warn": 2, "watch": 1, "normal": 0, "unknown": 0}
    candidates = []
    for r in rows:
        if (r.get("policy_count") or 0) < ISSUE_MIN_POLICIES:
            continue
        flags: list[tuple[str, str, float]] = []  # (level, metric_label, value)
        max_severity = "normal"
        for metric_key in ALERT_THRESHOLDS:
            level = alert_level(metric_key, r.get(metric_key))
            if level in ("watch", "warn", "danger"):
                flags.append((level, METRIC_CN_LABEL[metric_key], float(r[metric_key])))
                if severity_weight[level] > severity_weight[max_severity]:
                    max_severity = level
        if not flags:
            continue
        share = (r.get("premium_wan") or 0) / total_premium_wan * 100 if total_premium_wan else 0
        candidates.append({
            "dim_value": r["dim_value"],
            "premium_wan": r["premium_wan"],
            "share": share,
            "policy_count": r["policy_count"],
            "claim_cases": r["claim_cases"] or 0,
            "flags": sorted(flags, key=lambda f: -severity_weight[f[0]]),
            "score": severity_weight[max_severity] * share,
            "max_severity": max_severity,
        })
    candidates.sort(key=lambda c: -c["score"])
    return candidates[:5]


def render_issues(issues: list[dict[str, Any]], dim_label: str, total_policies: int, total_premium_wan: float) -> str:
    """渲染问题点摘要 HTML（脚本规则化输出，待 AI 二次提炼）。"""
    if not issues:
        return f"""
        <div class="issues issues-clean">
          <div class="issues-title">问题点 · 按"保费影响度 × 颜色严重度"排序</div>
          <p class="issues-empty">本维度下，<strong>保单件数 ≥ {ISSUE_MIN_POLICIES} 的格子均无亮灯异常</strong>。可能原因：① 该维度尚未暴露风险结构；② 样本不足以触发阈值。</p>
        </div>
        """
    items = []
    for i, c in enumerate(issues):
        flag_html = " · ".join(
            f"<span class='flag flag-{lvl}'>{ALERT_LEVEL_TEXT[lvl][0]} {escape(label)} {val:.2f}%</span>"
            for lvl, label, val in c["flags"]
        )
        items.append(f"""
        <li class="issue-item issue-{c['max_severity']}">
          <div class="issue-head">
            <span class="issue-rank">{i+1}</span>
            <span class="issue-name">{escape(str(c['dim_value']))}</span>
            <span class="issue-impact">保费 {c['premium_wan']:.2f} 万 · 占该维度 {c['share']:.1f}% · {int(c['policy_count']):,} 件保单 · {int(c['claim_cases']):,} 件报案</span>
          </div>
          <div class="issue-flags">{flag_html}</div>
        </li>
        """)
    return f"""
    <div class="issues">
      <div class="issues-title">问题点 · 按"保费影响度 × 颜色严重度"排序（前 {len(issues)} 名）</div>
      <ol class="issues-list">{"".join(items)}</ol>
      <p class="issues-note">仅展示保单件数 ≥ {ISSUE_MIN_POLICIES} 且至少触发 🔵关注/🟡预警/🔴危险 的格子。规则化输出，待业务复盘对齐。</p>
    </div>
    """


def render_total_table(row: dict[str, Any]) -> str:
    headers = (
        '<th class="num">保单件数</th>'
        '<th class="num">报案件数</th>'
        + "".join(f'<th class="num">{escape(c)}</th>' for c, _, _ in METRIC_COLS)
    )
    body = render_metrics_row(row)
    return f"""
    <div class="table-wrap">
      <table>
        <thead><tr>{headers}</tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>
    """


def render_monthly_pivot(con: duckdb.DuckDBPyConnection, base_cte: str) -> str:
    sql = f"""
    {base_cte}
    SELECT
      org_level_3,
      customer_category,
      DATE_TRUNC('month', insurance_start_date) AS pm,
      ROUND(SUM(premium) / 10000.0, 2) AS premium_wan,
      ROUND(SUM(reported_claims) / 10000.0, 2) AS reported_wan,
      COUNT(DISTINCT policy_no) AS policies
    FROM base
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    """
    rows = query(con, sql)
    months = sorted({r["pm"].strftime("%Y-%m") for r in rows if r["pm"]})
    pivot: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
    for r in rows:
        if r["pm"] is None:
            continue
        key = (r["org_level_3"] or "(未填)", r["customer_category"] or "(未填)")
        m = r["pm"].strftime("%Y-%m")
        pivot.setdefault(key, {})[m] = {
            "premium_wan": r["premium_wan"],
            "reported_wan": r["reported_wan"],
        }
    sorted_keys = sorted(
        pivot.keys(),
        key=lambda k: -sum(v.get("premium_wan", 0) or 0 for v in pivot[k].values()),
    )
    headers = "<th>三级机构</th><th>客户类别</th>" + "".join(
        f'<th class="num" colspan="2">{m}</th>' for m in months
    ) + '<th class="num">合计保费(万)</th><th class="num">合计赔款(万)</th>'
    sub_headers = "<th></th><th></th>" + "".join(
        '<th class="num sub">保费</th><th class="num sub">赔款</th>'
        for _ in months
    ) + '<th class="num sub">合计</th><th class="num sub">合计</th>'
    body_rows = []
    for org, cat in sorted_keys:
        cells = [f"<td>{escape(org)}</td>", f"<td>{escape(cat)}</td>"]
        total_p = 0.0
        total_r = 0.0
        for m in months:
            cell = pivot[(org, cat)].get(m, {})
            p = cell.get("premium_wan")
            r = cell.get("reported_wan")
            total_p += float(p or 0)
            total_r += float(r or 0)
            # codex P2 修复：用 None 判定缺失而非 truthy 检查，避免把合法零值（无赔月）误显示为缺失
            cells.append(f'<td class="num">{fmt_num(p, 1) if p is not None else "—"}</td>')
            cells.append(f'<td class="num">{fmt_num(r, 1) if r is not None else "—"}</td>')
        cells.append(f'<td class="num"><strong>{fmt_num(total_p, 1)}</strong></td>')
        cells.append(f'<td class="num"><strong>{fmt_num(total_r, 1)}</strong></td>')
        body_rows.append("<tr>" + "".join(cells) + "</tr>")
    return f"""
    <div class="table-wrap">
      <table>
        <thead>
          <tr>{headers}</tr>
          <tr>{sub_headers}</tr>
        </thead>
        <tbody>{"".join(body_rows)}</tbody>
      </table>
    </div>
    """


def build_html(
    *,
    title: str,
    eyebrow: str,
    period_text: str,
    total_row: dict[str, Any],
    dim_tables_all: list[tuple[str, str, str]],  # (label, table_html, issues_html)
    monthly_pivot: str,
    personal_total: dict[str, Any],
    dim_tables_personal: list[tuple[str, str, str]],
    cutoff_text: str,
) -> str:
    generated_at = datetime.now().strftime("%Y 年 %m 月 %d 日 %H:%M")

    big_stats = [
        ("保单件数", f"{int(total_row['policy_count']):,}", "件", ""),
        ("签单保费", fmt_num(total_row['premium_wan'], 2), "万元", ""),
        ("已报告赔款", fmt_num(total_row['reported_wan'], 2), "万元", ""),
        ("报案件数", f"{int(total_row['claim_cases'] or 0):,}", "件", ""),
        ("满期赔付率", fmt_num(total_row.get('earned_loss_ratio_pct'), 2), "%",
         alert_level("earned_loss_ratio_pct", total_row.get('earned_loss_ratio_pct'))),
        ("满期出险率", fmt_num(total_row.get('earned_incident_rate_pct'), 2), "%",
         alert_level("earned_incident_rate_pct", total_row.get('earned_incident_rate_pct'))),
        ("变动成本率", fmt_num(total_row.get('variable_cost_ratio_pct'), 2), "%",
         alert_level("variable_cost_ratio_pct", total_row.get('variable_cost_ratio_pct'))),
        ("件均保费", fmt_num(total_row.get('premium_per_policy'), 0), "元", ""),
    ]
    big_stats_html = "".join(
        f"""
        <div class="stat-card stat-{cls or 'neutral'}">
          <div class="stat-label">{escape(label)}</div>
          <div class="stat-value">{escape(val)}<span class="stat-unit">{escape(unit)}</span></div>
        </div>
        """
        for label, val, unit, cls in big_stats
    )

    dim_cards_all = "\n".join(
        f"""
        <section class="card">
          <h2><span class="num-tag">{CN_NUMERALS[i]}</span>按 {escape(label)} 分组</h2>
          {table_html}
          {issues_html}
        </section>
        """
        for i, (label, table_html, issues_html) in enumerate(dim_tables_all)
    )

    personal_intro = ""
    dim_cards_personal = ""
    if personal_total and personal_total.get("policy_count"):
        share_pct = int(personal_total['policy_count']) / int(total_row['policy_count']) * 100
        share_premium = (personal_total['premium_wan'] or 0) / (total_row['premium_wan'] or 1) * 100
        personal_intro = f"""
        <div class="personal-intro">
          <div class="personal-eyebrow">深入子集 · 非营业个人客车专题</div>
          <h2>客户结构特征下钻</h2>
          <p class="lead">非营业个人客车 {int(personal_total['policy_count']):,} 件 · {fmt_num(personal_total['premium_wan'], 2)} 万元保费，占创展全量 <strong>{share_pct:.1f}% 件数</strong> / <strong>{share_premium:.1f}% 保费</strong>。以下三个维度仅在该子集下计算。</p>
        </div>
        """
        dim_cards_personal = "\n".join(
            f"""
            <section class="card card-personal">
              <h2><span class="num-tag personal">专 {CN_NUMERALS[i]}</span>按 {escape(label)} 分组（仅非营业个人客车）</h2>
              {table_html}
              {issues_html}
            </section>
            """
            for i, (label, table_html, issues_html) in enumerate(dim_tables_personal)
        )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{escape(title)}</title>
<style>
  :root {{
    --ink: #0f172a;
    --ink-soft: #475569;
    --ink-faint: #94a3b8;
    --paper: #fafaf7;
    --paper-elev: #ffffff;
    --line: #e2e8f0;
    --line-soft: #f1f5f9;
    --accent: #1e3a8a;
    --normal: #047857;
    --normal-bg: #ecfdf5;
    --watch: #1d4ed8;
    --watch-bg: #eff6ff;
    --warn: #b45309;
    --warn-bg: #fffbeb;
    --danger: #b91c1c;
    --danger-bg: #fef2f2;
    --serif: "Source Han Serif SC", "Noto Serif SC", "Songti SC", "宋体", Georgia, serif;
    --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.6;
    color: var(--ink);
    background: var(--paper);
    margin: 0;
    padding: 0;
  }}
  .container {{ max-width: 1200px; margin: 0 auto; padding: 0 24px; }}

  /* Hero */
  .hero {{
    border-bottom: 1px solid var(--line);
    padding: 36px 24px 26px;
    background: linear-gradient(180deg, #ffffff 0%, var(--paper) 100%);
  }}
  .hero .eyebrow {{
    font-family: var(--serif);
    font-size: 14px;
    color: var(--ink-soft);
    margin-bottom: 10px;
    letter-spacing: 0.05em;
  }}
  .hero h1 {{
    font-family: var(--serif);
    font-size: 38px;
    font-weight: 600;
    line-height: 1.2;
    margin: 0 0 8px;
    letter-spacing: -0.5px;
  }}
  .hero .meta {{
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    font-family: var(--serif);
    font-size: 13px;
    color: var(--ink-soft);
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px dashed var(--line);
  }}
  .hero .meta strong {{ color: var(--ink); font-weight: 600; }}

  /* 大字报数字 */
  .stats-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 1px;
    background: var(--line);
    margin: 28px 0;
    border: 1px solid var(--line);
  }}
  .stat-card {{ background: var(--paper-elev); padding: 18px 20px; }}
  .stat-card.stat-normal {{ background: var(--normal-bg); }}
  .stat-card.stat-watch {{ background: var(--watch-bg); }}
  .stat-card.stat-warn {{ background: var(--warn-bg); }}
  .stat-card.stat-danger {{ background: var(--danger-bg); }}
  .stat-label {{
    font-family: var(--serif);
    font-size: 12px;
    color: var(--ink-soft);
    margin-bottom: 6px;
    letter-spacing: 0.05em;
  }}
  .stat-value {{
    font-family: var(--serif);
    font-size: 30px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }}
  .stat-card.stat-normal .stat-value {{ color: var(--normal); }}
  .stat-card.stat-watch .stat-value {{ color: var(--watch); }}
  .stat-card.stat-warn .stat-value {{ color: var(--warn); }}
  .stat-card.stat-danger .stat-value {{ color: var(--danger); }}
  .stat-unit {{
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 400;
    color: var(--ink-soft);
    margin-left: 4px;
  }}

  /* Section */
  section.card {{
    background: var(--paper-elev);
    border: 1px solid var(--line);
    padding: 22px 26px;
    margin: 14px 0;
  }}
  section.card.card-personal {{ border-left: 3px solid var(--accent); }}
  section.card h2 {{
    font-family: var(--serif);
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 14px;
    color: var(--ink);
    display: flex;
    align-items: baseline;
    gap: 12px;
  }}
  .num-tag {{
    font-family: var(--serif);
    font-size: 13px;
    color: var(--ink-faint);
    border: 1px solid var(--line);
    padding: 2px 10px;
    border-radius: 3px;
    font-weight: 500;
    letter-spacing: 0.1em;
  }}
  .num-tag.personal {{ color: var(--accent); border-color: var(--accent); }}

  .lead {{ font-size: 14px; color: var(--ink-soft); line-height: 1.7; margin: 8px 0 0; }}
  .lead strong {{ color: var(--ink); }}

  /* 子集分隔 */
  .personal-intro {{
    margin: 36px 0 14px;
    padding: 24px 26px;
    background: var(--paper-elev);
    border: 1px solid var(--line);
    border-left: 4px solid var(--accent);
  }}
  .personal-eyebrow {{
    font-family: var(--serif);
    font-size: 13px;
    color: var(--accent);
    margin-bottom: 6px;
    letter-spacing: 0.05em;
  }}
  .personal-intro h2 {{
    font-family: var(--serif);
    font-size: 22px;
    margin: 0 0 8px;
  }}

  /* 表格 */
  .table-wrap {{ overflow-x: auto; margin: 0 -8px; }}
  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 0 8px;
  }}
  th, td {{
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-soft);
  }}
  th {{
    background: var(--paper);
    color: var(--ink-soft);
    font-weight: 600;
    font-size: 12px;
    border-bottom: 2px solid var(--line);
    font-family: var(--serif);
    letter-spacing: 0.03em;
  }}
  th.sub {{
    font-weight: 400;
    font-size: 11px;
    color: var(--ink-faint);
    border-bottom: 1px solid var(--line);
  }}
  td.num, th.num {{
    text-align: right;
    font-family: var(--serif);
    font-variant-numeric: tabular-nums;
  }}
  tbody tr:hover {{ background: var(--line-soft); }}
  /* 四级亮灯 */
  td.cell-normal {{ color: var(--normal); font-weight: 600; }}
  td.cell-watch {{ color: var(--watch); font-weight: 600; }}
  td.cell-warn {{ color: var(--warn); font-weight: 600; background: var(--warn-bg); }}
  td.cell-danger {{ color: var(--danger); font-weight: 700; background: var(--danger-bg); }}

  /* 问题点 */
  .issues {{
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px dashed var(--line);
  }}
  .issues-title {{
    font-family: var(--serif);
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 10px;
  }}
  .issues-list {{ list-style: none; padding: 0; margin: 0; }}
  .issue-item {{
    padding: 10px 14px;
    margin-bottom: 6px;
    background: var(--paper);
    border-left: 3px solid var(--ink-faint);
  }}
  .issue-item.issue-watch {{ border-left-color: var(--watch); }}
  .issue-item.issue-warn {{ border-left-color: var(--warn); background: var(--warn-bg); }}
  .issue-item.issue-danger {{ border-left-color: var(--danger); background: var(--danger-bg); }}
  .issue-head {{
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 4px;
  }}
  .issue-rank {{
    font-family: var(--serif);
    font-size: 13px;
    color: var(--ink-faint);
    min-width: 18px;
  }}
  .issue-name {{
    font-family: var(--serif);
    font-weight: 600;
    font-size: 14px;
    color: var(--ink);
  }}
  .issue-impact {{
    font-size: 12px;
    color: var(--ink-soft);
    font-family: var(--serif);
    font-variant-numeric: tabular-nums;
  }}
  .issue-flags {{
    font-size: 12px;
    color: var(--ink-soft);
    font-family: var(--serif);
    font-variant-numeric: tabular-nums;
    margin-left: 28px;
  }}
  .flag {{ display: inline-block; margin-right: 4px; }}
  .flag-watch {{ color: var(--watch); }}
  .flag-warn {{ color: var(--warn); font-weight: 600; }}
  .flag-danger {{ color: var(--danger); font-weight: 700; }}
  .issues-empty {{ font-size: 13px; color: var(--ink-soft); margin: 0; }}
  .issues-clean .issues-title {{ color: var(--normal); }}
  .issues-note {{
    font-size: 11px;
    color: var(--ink-faint);
    margin: 8px 0 0;
    font-family: var(--serif);
  }}

  /* 公式说明 */
  .formula {{
    font-size: 12px;
    color: var(--ink-soft);
    line-height: 1.7;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--line);
    font-family: var(--serif);
  }}

  /* 阅读边界与反馈（统一灰白调） */
  .callout {{
    background: var(--paper-elev);
    border: 1px solid var(--line);
    border-left: 4px solid var(--ink-soft);
    padding: 22px 26px;
    margin: 14px 0;
  }}
  .callout h2 {{
    font-family: var(--serif);
    font-size: 18px;
    margin: 0 0 10px;
    color: var(--ink);
  }}
  .callout ul {{
    margin: 6px 0 0;
    padding-left: 22px;
    font-size: 13px;
    color: var(--ink-soft);
    line-height: 1.85;
  }}
  .callout p {{
    font-size: 13px;
    color: var(--ink-soft);
    margin: 6px 0 14px;
  }}
  .callout a.fb-button {{
    display: inline-block;
    padding: 9px 22px;
    background: var(--ink);
    color: var(--paper-elev);
    border-radius: 3px;
    text-decoration: none;
    font-family: var(--serif);
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.05em;
  }}

  footer {{
    color: var(--ink-faint);
    font-family: var(--serif);
    font-size: 12px;
    text-align: center;
    margin: 28px 0 18px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
    letter-spacing: 0.05em;
  }}

  @media (max-width: 720px) {{
    .hero h1 {{ font-size: 26px; }}
    .stat-value {{ font-size: 22px; }}
    .stats-grid {{ grid-template-columns: repeat(2, 1fr); }}
    section.card {{ padding: 16px 18px; }}
  }}
</style>
</head>
<body>

<div class="hero container">
  <div class="eyebrow">{escape(eyebrow)}</div>
  <h1>{escape(title)}</h1>
  <div class="meta">
    <span><strong>统计口径</strong> {escape(period_text)}</span>
    <span><strong>样本</strong> {int(total_row['policy_count']):,} 件保单 · {int(total_row['claim_cases'] or 0):,} 件报案</span>
    <span><strong>生成于</strong> {generated_at}</span>
  </div>
</div>

<div class="container">

  <div class="stats-grid">
    {big_stats_html}
  </div>

  <section class="card">
    <h2><span class="num-tag">月</span>三级机构 × 客户类别 × 月度结构（保费 / 已报告赔款，单位：万元）</h2>
    {monthly_pivot}
    <div class="formula">行按合计保费降序。月份按保险起期归属。"—" 表示该 (机构,类别,月) 无签单。</div>
  </section>

  {dim_cards_all}

  {personal_intro}
  {dim_cards_personal}

  <div class="callout">
    <h2>阅读边界</h2>
    <ul>
      <li>样本基数小（{int(total_row['policy_count']):,} 件保单 · {int(total_row['claim_cases'] or 0):,} 件报案），分组后部分小类样本不足 10 件；问题点排名已剔除样本 &lt; 10 件的格子，但表格仍展示数字。</li>
      <li>件均/案均按绝对值聚合后重算；率值同理。未做加权平均。</li>
      <li>"已报告赔款" = 已决赔款 + 未决赔款（含未决估损），不等于已支付金额。</li>
      <li>"经代名"是销售环节实体，不直接代表真实业务来源；建议交叉看业务员 + 三级机构维度归因。</li>
      <li>非营业个人客车专题中的"车牌归属"用车牌前 2 位（如 川 Q）做归属代理，不等同于车主行政区划。</li>
      <li>四级亮灯阈值：满期出险率 8/10/12% · 满期赔付率 60/70/75% · 变动成本率 85/91/94%。来源：项目 feedback_four_level_alert。</li>
    </ul>
  </div>

  <div class="callout">
    <h2>有问题或建议？</h2>
    <p>点击下方链接打开「车险报告反馈表」，加新行即提交。所有有看板权限的同事都能在企微里看到反馈进度。</p>
    <a class="fb-button" href="{FEEDBACK_PLACEHOLDER}" target="_blank" rel="noopener">打开反馈表</a>
  </div>

  <footer>
    华安保险四川分公司 · 经代专项诊断 · 报告链接化通道 · 生成于 {generated_at}
  </footer>

</div>

</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="经代/机构诊断 HTML 报告生成器（杂志风视觉 + 规则化问题点）")
    parser.add_argument("--agent-name", required=True, help="精确匹配的 agent_name 全字符串")
    parser.add_argument("--province", required=True,
                        help="省份代码（fail-closed：仅接受已注册省份如 SC/SX，缺省/未知即报错中止；"
                             "data-pipeline.md「省份数据隔离」红线）")
    parser.add_argument("--start-date", default="2026-01-01", help="保险起期下限 YYYY-MM-DD（含）")
    parser.add_argument("--end-date", default=date.today().isoformat(), help="保险起期上限 YYYY-MM-DD（含）")
    parser.add_argument("--title", required=True, help="报告主标题")
    parser.add_argument("--eyebrow", required=True, help="页眉文字（hero 上方小字）")
    parser.add_argument("--output", type=Path, required=True, help="输出 HTML 路径")
    args = parser.parse_args()

    try:
        province = resolve_province(args.province)
    except PolicyCurrentLayoutError as e:
        sys.stderr.write(f"[ERROR] {e}\n")
        return 2
    policy_glob = policy_current_glob(_POLICY_CURRENT_DIR, province, missing_ok=True)

    con = duckdb.connect()
    base_cte_all = build_filtered_cte(
        args.agent_name, args.start_date, args.end_date, policy_glob, province, personal_only=False
    )
    base_cte_personal = build_filtered_cte(
        args.agent_name, args.start_date, args.end_date, policy_glob, province, personal_only=True
    )

    total_rows = query(con, base_cte_all + metrics_sql(group_by=None, having_premium=False))
    if not total_rows or not total_rows[0].get("policy_count"):
        sys.stderr.write(f"[ERROR] 没有数据：agent_name={args.agent_name} {args.start_date}~{args.end_date}\n")
        return 1
    total_row = total_rows[0]
    total_premium_wan = float(total_row.get("premium_wan") or 0)

    cutoff_text = f"保险起期 {args.start_date} 至 {args.end_date}"

    # 全量 6 维度
    dim_tables_all: list[tuple[str, str, str]] = []
    for dim_field, dim_label in DIMENSIONS_ALL:
        rows = query(con, base_cte_all + metrics_sql(group_by=dim_field))
        table_html = render_dim_table(rows, dim_label)
        issues = identify_issues(rows, total_premium_wan)
        issues_html = render_issues(issues, dim_label, int(total_row["policy_count"]), total_premium_wan)
        dim_tables_all.append((dim_label, table_html, issues_html))

    monthly_pivot = render_monthly_pivot(con, base_cte_all)

    # 非营业个人客车子集
    personal_total_rows = query(con, base_cte_personal + metrics_sql(group_by=None, having_premium=False))
    personal_total = personal_total_rows[0] if personal_total_rows else {}
    personal_premium_wan = float(personal_total.get("premium_wan") or 0)
    dim_tables_personal: list[tuple[str, str, str]] = []
    if personal_total.get("policy_count"):
        for dim_field, dim_label in DIMENSIONS_PERSONAL:
            rows = query(con, base_cte_personal + metrics_sql(group_by=dim_field))
            table_html = render_dim_table(rows, dim_label)
            issues = identify_issues(rows, personal_premium_wan)
            issues_html = render_issues(issues, dim_label, int(personal_total["policy_count"]), personal_premium_wan)
            dim_tables_personal.append((dim_label, table_html, issues_html))

    html = build_html(
        title=args.title,
        eyebrow=args.eyebrow,
        period_text=cutoff_text,
        total_row=total_row,
        dim_tables_all=dim_tables_all,
        monthly_pivot=monthly_pivot,
        personal_total=personal_total,
        dim_tables_personal=dim_tables_personal,
        cutoff_text=cutoff_text,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding="utf-8")
    print(f"[OK] HTML 已生成: {args.output}")
    print(f"  全量样本: {int(total_row['policy_count']):,} 保单 / {int(total_row['claim_cases'] or 0):,} 报案 / {total_premium_wan:.2f} 万")
    if personal_total.get("policy_count"):
        print(f"  非营业个人客车子集: {int(personal_total['policy_count']):,} 保单 / {personal_premium_wan:.2f} 万")
    return 0


if __name__ == "__main__":
    sys.exit(main())
