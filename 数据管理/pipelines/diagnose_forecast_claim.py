#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diagnose_forecast_claim.py — 满期赔付率推演与赔款空间反推（v1.0）

支持任意维度（机构/客户类别/险种/险别/新转续/能源等）筛选下：
  • 反向求解：给定目标赔付率 → 求 5/5-6/30 可新增已报告赔款 Δ
  • 正向求解：给定 Δ 增量 → 求 6/30 时点的满期赔付率
  • Cohort 双口径：默认 insurance_start_date（chexian 标准），附 policy_date sensitivity 行
  • YoY 同期对比：自动对照去年同期实际数据
  • 多机构/多类别智能分组：单值时仅汇总，多值或 ALL 时分组对比

用法示例：
  # 1. 四川全口径摩托交强 5/5-6/30 赔款空间
  python3 数据管理/pipelines/diagnose_forecast_claim.py \\
    --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \\
    --customer-category 摩托车 --insurance-type 交强险

  # 2. 仅天府机构 + 自定义档位
  python3 数据管理/pipelines/diagnose_forecast_claim.py \\
    --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \\
    --org 天府 --customer-category 摩托车 \\
    --targets 100,110,115,120,130

  # 3. 反向求解：若 5/5-6/30 新增 50 万赔款，赔付率多少？
  python3 数据管理/pipelines/diagnose_forecast_claim.py \\
    --base-start 2026-01-01 --base-end 2026-05-04 --eval-date 2026-06-30 \\
    --org 天府 --customer-category 摩托车 --reverse-delta 500000

版本: 1.0.0
日期: 2026-05-06
"""

import argparse
import json
import sys
from datetime import datetime, date, timedelta
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb", file=sys.stderr)
    sys.exit(1)


# ─── Path Resolution ─────────────────────────────────────────────

def find_project_root() -> Path:
    """通过 CLAUDE.md + 数据管理/ 标记定位项目根目录。"""
    p = Path(__file__).resolve()
    while p != p.parent:
        if (p / 'CLAUDE.md').exists() and (p / '数据管理').is_dir():
            return p
        p = p.parent
    raise RuntimeError("无法定位项目根目录（缺少 CLAUDE.md 或 数据管理/）")


ROOT = find_project_root()

POLICY_CANDIDATES = [
    ROOT / '数据管理/warehouse/fact/policy/current',
    ROOT / 'server/data/fact/policy/current',
    ROOT / 'server/data/current',
]
CLAIMS_CANDIDATES = [
    ROOT / '数据管理/warehouse/fact/claims_detail',
    ROOT / 'server/data/fact/claims_detail',
]


def resolve_dir(candidates: list) -> Path:
    for d in candidates:
        if d.exists() and any(d.glob('*.parquet')):
            return d
    raise RuntimeError(f"未找到数据目录: {[str(c) for c in candidates]}")


# ─── Cohort & File Selection ─────────────────────────────────────

def parse_csv_arg(s: str | None) -> list[str] | None:
    """ALL/all/None → None；其他按逗号拆分。"""
    if s is None or s.strip().lower() in ('all', ''):
        return None
    return [x.strip() for x in s.split(',') if x.strip()]


def select_policy_files(policy_dir: Path, customer_categories: list[str] | None,
                        base_start: str) -> list[Path]:
    """根据客户类别筛选选择合适的 parquet 文件。

    - 仅摩托车 → 限摩
    - 不含摩托车 → 剔摩
    - 含摩托车 + 其他 / ALL → 限摩 + 剔摩
    - 历史年份（base_start 早于 2024-01-01） → 加入 21-23 全量
    """
    files = []
    motor_file = policy_dir / '01_签单清单_限摩_20240101_20260504.parquet'
    nonmotor_file = policy_dir / '01_签单清单_剔摩_20240101_20260504.parquet'
    legacy_file = policy_dir / '01_签单清单_全量_21-23年.parquet'

    cats = customer_categories
    if cats is None:
        # ALL
        files = [motor_file, nonmotor_file]
    elif cats == ['摩托车']:
        files = [motor_file]
    elif '摩托车' not in cats:
        files = [nonmotor_file]
    else:
        files = [motor_file, nonmotor_file]

    base_year = int(base_start[:4])
    if base_year < 2024 and legacy_file.exists():
        files.append(legacy_file)

    files = [f for f in files if f.exists()]
    if not files:
        raise RuntimeError(f"未找到合适的 policy parquet 文件 in {policy_dir}")
    return files


def select_claims_files(claims_dir: Path, base_start: str, eval_date: str) -> list[Path]:
    """选择覆盖 [base_start, eval_date] 区间的赔案分区。"""
    start_year = int(base_start[:4])
    end_year = int(eval_date[:4])
    files = []
    for y in range(start_year, end_year + 1):
        f = claims_dir / f'claims_{y}.parquet'
        if f.exists():
            files.append(f)
    if not files:
        raise RuntimeError(f"未找到赔案文件 in {claims_dir}")
    return files


def build_policy_view(con, files: list[Path], view_name: str = 'pol') -> None:
    """注册 policy 视图（多文件 union_by_name）。"""
    files_sql = ', '.join(f"'{f}'" for f in files)
    con.execute(f"""
        CREATE OR REPLACE VIEW {view_name} AS
        SELECT * FROM read_parquet([{files_sql}], union_by_name=true)
    """)


def build_claims_view(con, files: list[Path], view_name: str = 'cl') -> None:
    files_sql = ', '.join(f"'{f}'" for f in files)
    con.execute(f"""
        CREATE OR REPLACE VIEW {view_name} AS
        SELECT * FROM read_parquet([{files_sql}], union_by_name=true)
    """)


# ─── Filter Builder ──────────────────────────────────────────────

def sql_in_clause(field: str, values: list[str] | None) -> str | None:
    if values is None:
        return None
    escaped = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return f"{field} IN ({escaped})"


def build_where(args, base_start: str, base_end_excl: str, cohort_by: str) -> str:
    """构建 cohort 过滤的 WHERE 子句。base_end_excl 为开区间右端（base_end + 1 day）。"""
    clauses = []

    if cohort_by == 'start_date':
        clauses.append(f"insurance_start_date >= TIMESTAMP '{base_start}'")
        clauses.append(f"insurance_start_date < TIMESTAMP '{base_end_excl}'")
    else:  # policy_date
        clauses.append(f"policy_date >= TIMESTAMP '{base_start}'")
        clauses.append(f"policy_date < TIMESTAMP '{base_end_excl}'")

    for field, arg_val in [
        ('org_level_3', args.org),
        ('customer_category', args.customer_category),
        ('insurance_type', args.insurance_type),
        ('coverage_combination', args.coverage),
    ]:
        vals = parse_csv_arg(arg_val)
        c = sql_in_clause(field, vals)
        if c:
            clauses.append(c)

    if args.is_nev and args.is_nev.lower() != 'all':
        nev_val = 'true' if args.is_nev in ('是', 'true', '1', 'yes') else 'false'
        clauses.append(f"is_nev = {nev_val}")

    if args.is_renewal and args.is_renewal.lower() != 'all':
        ren_val = 'true' if args.is_renewal in ('是', 'true', '1', 'yes', '续保') else 'false'
        clauses.append(f"is_renewal = {ren_val}")

    if args.is_new_car and args.is_new_car.lower() != 'all':
        nc_val = 'true' if args.is_new_car in ('是', 'true', '1', 'yes', '新车') else 'false'
        clauses.append(f"is_new_car = {nc_val}")

    return ' AND '.join(clauses)


# ─── Core Calculation ────────────────────────────────────────────

def compute_cohort(con, args, base_start: str, base_end: str, eval_date: str,
                   cohort_by: str = 'start_date') -> dict:
    """对指定 cohort 计算签单/满期/赔款核心指标。

    返回 dict:
      n_policies, signed, daily_avg_signed,
      earned_at_base_end, earned_at_eval, projected_signed, projected_earned,
      total_earned_at_eval,
      claim_n, settled, pending, reported
    """
    base_end_excl = (date.fromisoformat(base_end) + timedelta(days=1)).isoformat()
    base_days = (date.fromisoformat(base_end) - date.fromisoformat(base_start)).days + 1
    proj_days = (date.fromisoformat(eval_date) - date.fromisoformat(base_end)).days
    where = build_where(args, base_start, base_end_excl, cohort_by)

    # 基础期 cohort 统计 + 满期保费（at base_end & at eval_date）
    sql_base = f"""
      WITH p AS (
        SELECT policy_no, SUM(premium) AS net_premium,
          MIN(insurance_start_date) AS s,
          MIN(insurance_end_date) AS e
        FROM pol
        WHERE {where}
        GROUP BY policy_no
        HAVING SUM(premium) > 0
      )
      SELECT
        COUNT(*) AS n,
        SUM(net_premium) AS signed,
        SUM(net_premium * GREATEST(0.0, LEAST(
          DATE_DIFF('day', s, LEAST(e, TIMESTAMP '{base_end} 23:59:59'))::DOUBLE,
          DATE_DIFF('day', s, e)::DOUBLE
        )) / NULLIF(DATE_DIFF('day', s, e), 0)) AS earned_at_base_end,
        SUM(net_premium * GREATEST(0.0, LEAST(
          DATE_DIFF('day', s, LEAST(e, TIMESTAMP '{eval_date} 23:59:59'))::DOUBLE,
          DATE_DIFF('day', s, e)::DOUBLE
        )) / NULLIF(DATE_DIFF('day', s, e), 0)) AS earned_at_eval
      FROM p
    """
    r = con.execute(sql_base).fetchone()
    n, signed, earned_be, earned_ev = r
    n = n or 0
    signed = signed or 0
    earned_be = earned_be or 0
    earned_ev = earned_ev or 0

    daily_avg = signed / base_days if base_days > 0 else 0
    projected_signed = daily_avg * proj_days

    # Projected 满期保费的 expected ratio
    if cohort_by == 'start_date' and proj_days > 0:
        # Start_date 均匀 [base_end+1, eval_date]，eval at eval_date
        # earned/signed = max(0, eval_date - start)/term，假定 1 年期主导
        # E[earned/signed] = (proj_days - 1) / (2 × 365) （连续近似 (proj_days)/(2×365)）
        # 用更精确的：基础期实际 term 加权
        sql_term = f"""
          WITH p AS (
            SELECT SUM(premium) AS np,
              DATE_DIFF('day', MIN(insurance_start_date), MIN(insurance_end_date)) AS term_days
            FROM pol
            WHERE {where}
            GROUP BY policy_no
            HAVING SUM(premium) > 0
          )
          SELECT SUM(np * term_days) / SUM(np) AS prem_weighted_term
          FROM p WHERE term_days > 0
        """
        rt = con.execute(sql_term).fetchone()
        avg_term = rt[0] or 365
        # 严格积分: ∫_0^{D} (D-d)/term dd / D = D/(2*term)，D = proj_days
        proj_earned_ratio = proj_days / (2 * avg_term) if avg_term > 0 else 0
    elif cohort_by == 'policy_date' and proj_days > 0:
        # 用基础期 lead 分布严格积分
        sql_lead = f"""
          WITH p AS (
            SELECT premium,
              DATE_DIFF('day', policy_date, insurance_start_date) AS lead_L,
              DATE_DIFF('day', insurance_start_date, insurance_end_date) AS term_days
            FROM pol
            WHERE {where}
              AND premium > 0
              AND insurance_start_date IS NOT NULL
              AND insurance_end_date > insurance_start_date
          )
          SELECT
            SUM(premium * CASE
              WHEN lead_L < {proj_days}
              THEN POWER({proj_days}.0 - lead_L, 2) / (2.0 * {proj_days} * term_days)
              ELSE 0 END) / NULLIF(SUM(premium), 0) AS proj_earned_ratio
          FROM p
        """
        rl = con.execute(sql_lead).fetchone()
        proj_earned_ratio = rl[0] or 0
    else:
        proj_earned_ratio = 0

    # --simple-ratio 强制覆盖
    if args.simple_ratio is not None:
        proj_earned_ratio = args.simple_ratio

    projected_earned = projected_signed * proj_earned_ratio
    total_earned = earned_ev + projected_earned

    # 已报告赔款（基础期 cohort × claims 至 base_end）
    sql_claims = f"""
      WITH p AS (
        SELECT policy_no, SUM(premium) AS np
        FROM pol
        WHERE {where}
        GROUP BY policy_no
        HAVING SUM(premium) > 0
      ),
      c AS (
        SELECT policy_no,
          COALESCE(settled_amount, 0) AS settled_amount,
          COALESCE(pending_amount, 0) AS pending_amount
        FROM cl
        WHERE report_time < TIMESTAMP '{base_end_excl}'
      )
      SELECT
        COUNT(*) AS n_claims,
        COALESCE(SUM(c.settled_amount), 0) AS settled,
        COALESCE(SUM(c.pending_amount), 0) AS pending,
        COALESCE(SUM(c.settled_amount + c.pending_amount), 0) AS reported
      FROM c JOIN p USING(policy_no)
    """
    rc = con.execute(sql_claims).fetchone()

    return {
        'cohort_by': cohort_by,
        'base_start': base_start,
        'base_end': base_end,
        'eval_date': eval_date,
        'base_days': base_days,
        'proj_days': proj_days,
        'n_policies': n,
        'signed': signed,
        'daily_avg_signed': daily_avg,
        'earned_at_base_end': earned_be,
        'earned_at_eval': earned_ev,
        'proj_earned_ratio': proj_earned_ratio,
        'projected_signed': projected_signed,
        'projected_earned': projected_earned,
        'total_earned_at_eval': total_earned,
        'claim_n': rc[0] or 0,
        'settled': rc[1] or 0,
        'pending': rc[2] or 0,
        'reported': rc[3] or 0,
        'loss_ratio_at_base_end': (rc[3] / earned_be * 100) if earned_be > 0 else None,
        'natural_loss_ratio_at_eval': (rc[3] / total_earned * 100) if total_earned > 0 else None,
    }


def shift_one_year(d: str) -> str:
    """日期串 'YYYY-MM-DD' 减一年（处理 2/29 → 2/28）。"""
    dt = date.fromisoformat(d)
    try:
        return dt.replace(year=dt.year - 1).isoformat()
    except ValueError:  # 2/29
        return dt.replace(year=dt.year - 1, day=28).isoformat()


# ─── Output Formatting ──────────────────────────────────────────

def fmt_wan(x: float) -> str:
    return f"{x / 10000:,.2f}"


def fmt_pct(x: float | None, digits: int = 2) -> str:
    if x is None:
        return "—"
    return f"{x:.{digits}f}%"


def fmt_yoy(curr: float, prior: float) -> str:
    if prior == 0 or prior is None:
        return "—"
    delta_pct = (curr - prior) / abs(prior) * 100
    sign = "+" if delta_pct >= 0 else ""
    return f"{sign}{delta_pct:.1f}%"


def render_filter_summary(args) -> str:
    parts = []
    for label, val in [
        ('机构', args.org), ('客户类别', args.customer_category),
        ('险种', args.insurance_type), ('险别', args.coverage),
        ('能源', args.is_nev), ('新转续', args.is_renewal),
        ('新旧车', args.is_new_car),
    ]:
        if val and val.lower() != 'all':
            parts.append(f"{label}={val}")
    return ' | '.join(parts) if parts else 'ALL（无筛选）'


def render_markdown(args, current: dict, alt: dict, prior: dict | None,
                    targets: list[float], reverse_delta: float | None) -> str:
    lines = []
    lines.append("# 满期赔付率推演与赔款空间反推\n")
    lines.append(f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    lines.append(f"> 筛选：**{render_filter_summary(args)}**")
    lines.append(f"> 基础期：`{current['base_start']} ~ {current['base_end']}`（{current['base_days']} 天）"
                 f" | 评估日：`{current['eval_date']}` | Projection 期：`{current['proj_days']} 天`")
    lines.append(f"> Cohort 主口径：**{current['cohort_by']}** "
                 f"| Sensitivity 口径：{alt['cohort_by']}\n")

    # 小样本警告
    if current['n_policies'] < 100:
        lines.append(f"⚠️ **小样本警告**：cohort 仅 {current['n_policies']} 单，结果稳定性可能不足。\n")

    # 基础概览（含 YoY 列）
    lines.append("## Cohort 概览\n")
    if prior:
        lines.append("| 指标 | 当前期 | 同期（去年）| YoY |")
        lines.append("|---|---:|---:|---:|")
    else:
        lines.append("| 指标 | 当前期 |")
        lines.append("|---|---:|")

    def row(label, fcur, fpri=None, yoy_func=None):
        if prior and fpri is not None:
            yoy = yoy_func(current[fcur], prior[fpri]) if yoy_func else fmt_yoy(current[fcur], prior[fpri])
            return f"| {label} | {format_value(label, current[fcur])} | {format_value(label, prior[fpri])} | {yoy} |"
        return f"| {label} | {format_value(label, current[fcur])} |"

    def format_value(label, v):
        if v is None:
            return "—"
        if '万元' in label or '保费' in label or '赔款' in label or 'Δ' in label:
            return fmt_wan(v) + " 万元"
        if '率' in label and '系数' not in label:
            return fmt_pct(v)
        if '件数' in label or '保单' in label or '案' in label:
            return f"{v:,.0f}"
        if '天数' in label:
            return f"{v}"
        return f"{v:,.4f}"

    lines.append(row('保单件数', 'n_policies', 'n_policies'))
    lines.append(row('签单保费(万元)', 'signed', 'signed'))
    lines.append(row('日均签单保费(万元)', 'daily_avg_signed', 'daily_avg_signed'))
    lines.append(row(f'到 {current["base_end"]} 满期保费(万元)', 'earned_at_base_end', 'earned_at_base_end'))
    lines.append(row(f'到 {current["eval_date"]} 已签满期(万元)', 'earned_at_eval', 'earned_at_eval'))
    lines.append(row('Projection 期签单(万元)', 'projected_signed', 'projected_signed'))
    lines.append(row('Projection 期满期(万元)', 'projected_earned', 'projected_earned'))
    lines.append(row('合计满期保费(万元)', 'total_earned_at_eval', 'total_earned_at_eval'))
    lines.append(row('已报告赔款合计(万元)', 'reported', 'reported'))
    lines.append(row('已决赔款(万元)', 'settled', 'settled'))
    lines.append(row('未决赔款(万元)', 'pending', 'pending'))
    lines.append(row('报案件数', 'claim_n', 'claim_n'))
    lines.append(row(f'到 {current["base_end"]} 时点赔付率', 'loss_ratio_at_base_end', 'loss_ratio_at_base_end'))
    lines.append(row('自然演进赔付率(零新增情景)', 'natural_loss_ratio_at_eval', 'natural_loss_ratio_at_eval'))

    # 反向 / 正向求解
    lines.append("\n## 求解结果\n")
    if reverse_delta is not None:
        # 正向：给定 Δ 求赔付率
        target_total_claims = current['reported'] + reverse_delta
        implied_ratio = target_total_claims / current['total_earned_at_eval'] * 100 \
            if current['total_earned_at_eval'] > 0 else None
        lines.append(f"**正向求解**：若 Projection 期新增已报告赔款 = **{fmt_wan(reverse_delta)} 万元**\n")
        lines.append(f"- 总赔款 = {fmt_wan(current['reported'])} + {fmt_wan(reverse_delta)} "
                     f"= **{fmt_wan(target_total_claims)} 万元**")
        lines.append(f"- 合计满期保费 = {fmt_wan(current['total_earned_at_eval'])} 万元")
        lines.append(f"- **{current['eval_date']} 满期赔付率 = {fmt_pct(implied_ratio)}**\n")
    else:
        # 反向：给定目标赔付率求 Δ
        lines.append("**反向求解**：给定目标赔付率 → 求 Projection 期可新增已报告赔款 Δ\n")
        lines.append("公式：Δ = 合计满期保费 × 目标率 − 当前已报告赔款\n")
        lines.append("| 目标赔付率 | 目标总赔款(万元) | **Δ 新增空间(万元)** | 与当前 reported 倍数 |")
        lines.append("|:---:|---:|---:|---:|")
        for R in targets:
            target = current['total_earned_at_eval'] * R / 100
            delta = target - current['reported']
            ratio_to_curr = (delta / current['reported']) if current['reported'] > 0 else None
            lines.append(f"| {R:.0f}% | {fmt_wan(target)} | **{fmt_wan(delta)}** | "
                         f"{ratio_to_curr*100:+.1f}% " if ratio_to_curr is not None else
                         f"| {R:.0f}% | {fmt_wan(target)} | **{fmt_wan(delta)}** | — |")
            # 修复表格行结尾
            if not lines[-1].endswith('|'):
                lines[-1] = lines[-1].rstrip() + ' |'

    # Sensitivity（alt cohort）
    lines.append("\n## Sensitivity：备口径对比\n")
    lines.append(f"| 项 | 主口径 ({current['cohort_by']}) | 备口径 ({alt['cohort_by']}) | 差异 |")
    lines.append("|---|---:|---:|---:|")
    for label, key, money in [
        ('保单件数', 'n_policies', False),
        ('签单保费(万元)', 'signed', True),
        ('合计满期保费(万元)', 'total_earned_at_eval', True),
        ('已报告赔款(万元)', 'reported', True),
    ]:
        a, b = current[key], alt[key]
        if money:
            diff = a - b
            lines.append(f"| {label} | {fmt_wan(a)} | {fmt_wan(b)} | {fmt_wan(diff)} |")
        else:
            lines.append(f"| {label} | {a:,.0f} | {b:,.0f} | {a-b:+,.0f} |")
    lines.append(f"\n备口径主要差异来源：cohort 边界（policy_date 签单口径剔除 / 含入跨年保单）。\n")

    # 关键说明
    lines.append("## 关键说明\n")
    lines.append(f"- 满期保费公式：`signed × max(0, min(end, eval) - start) / (end - start)`")
    if current['cohort_by'] == 'start_date':
        lines.append(f"- Projection earned ratio = projection_days / (2 × 平均 term) "
                     f"= **{current['proj_earned_ratio']*100:.3f}%**（起期均匀分布假设）")
    else:
        lines.append(f"- Projection earned ratio（lead 分布积分）= "
                     f"**{current['proj_earned_ratio']*100:.3f}%**")
    lines.append(f"- 已报告赔款 = settled + pending（已决+未决）")
    lines.append(f"- 保单去重：`SUM(premium) GROUP BY policy_no, HAVING > 0`（去原单+批改重复）")
    if current['pending'] > 0 and current['reported'] > 0:
        pct = current['pending'] / current['reported'] * 100
        if pct > 80:
            lines.append(f"- ⚠️ 当前未决占比 **{pct:.1f}%**，结案换估上调风险高，"
                         f"实际留给新报案的空间会小于表中 Δ。")

    return '\n'.join(lines)


def render_json(current: dict, alt: dict, prior: dict | None,
                targets: list[float], reverse_delta: float | None) -> str:
    out = {
        'main': current,
        'sensitivity': alt,
        'yoy': prior,
    }
    if reverse_delta is not None:
        target_total = current['reported'] + reverse_delta
        out['solve'] = {
            'mode': 'forward',
            'reverse_delta': reverse_delta,
            'target_total_claims': target_total,
            'implied_loss_ratio': target_total / current['total_earned_at_eval'] * 100
                if current['total_earned_at_eval'] > 0 else None,
        }
    else:
        scenarios = []
        for R in targets:
            target = current['total_earned_at_eval'] * R / 100
            delta = target - current['reported']
            scenarios.append({
                'target_ratio_pct': R,
                'target_total_claims': target,
                'delta_claim_space': delta,
            })
        out['solve'] = {'mode': 'reverse', 'scenarios': scenarios}
    return json.dumps(out, ensure_ascii=False, indent=2, default=str)


# ─── Main ────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--base-start', required=True, help='基础期起 (YYYY-MM-DD, inclusive)')
    p.add_argument('--base-end', required=True, help='基础期止 (YYYY-MM-DD, inclusive)')
    p.add_argument('--eval-date', required=True, help='评估日 (YYYY-MM-DD, inclusive)')
    # Filters
    p.add_argument('--org', default=None, help='三级机构（逗号分隔，all=全部）')
    p.add_argument('--customer-category', default=None, help='客户类别（逗号分隔，all=全部）')
    p.add_argument('--insurance-type', default=None, help='险种：交强险/商业险/all')
    p.add_argument('--coverage', default=None, help='险别组合（逗号分隔）')
    p.add_argument('--is-nev', default='all', help='能源：是/否/all')
    p.add_argument('--is-renewal', default='all', help='新转续：续保/新单/all')
    p.add_argument('--is-new-car', default='all', help='新旧车：新车/旧车/all')
    # Solve mode
    p.add_argument('--targets', default='115,120,125,130,135,150', help='目标赔付率档位（逗号分隔，单位%%）')
    p.add_argument('--reverse-delta', type=float, default=None,
                   help='正向求解：给定 Δ（元）求赔付率；指定后忽略 --targets')
    # Cohort
    p.add_argument('--cohort-by', choices=['start_date', 'policy_date'], default='start_date',
                   help='cohort 定义口径（默认 start_date）')
    # Modes
    p.add_argument('--simple-ratio', type=float, default=None,
                   help='手动覆盖 projection earned ratio（高级，默认严格积分）')
    p.add_argument('--no-yoy', action='store_true', help='禁用 YoY 同期对比')
    p.add_argument('--output', choices=['markdown', 'json'], default='markdown')
    return p.parse_args()


def main():
    args = parse_args()
    targets = [float(t) for t in args.targets.split(',') if t.strip()]

    # 解析数据目录
    policy_dir = resolve_dir(POLICY_CANDIDATES)
    claims_dir = resolve_dir(CLAIMS_CANDIDATES)

    customer_cats = parse_csv_arg(args.customer_category)
    pol_files = select_policy_files(policy_dir, customer_cats, args.base_start)
    cl_files = select_claims_files(claims_dir, args.base_start, args.eval_date)

    con = duckdb.connect()
    build_policy_view(con, pol_files)
    build_claims_view(con, cl_files)

    # Main cohort + sensitivity (alt)
    current = compute_cohort(con, args, args.base_start, args.base_end, args.eval_date,
                             cohort_by=args.cohort_by)
    alt_cohort_by = 'policy_date' if args.cohort_by == 'start_date' else 'start_date'
    alt = compute_cohort(con, args, args.base_start, args.base_end, args.eval_date,
                        cohort_by=alt_cohort_by)

    # YoY: 同期去年
    prior = None
    if not args.no_yoy:
        try:
            prior_start = shift_one_year(args.base_start)
            prior_end = shift_one_year(args.base_end)
            prior_eval = shift_one_year(args.eval_date)
            prior_pol_files = select_policy_files(policy_dir, customer_cats, prior_start)
            prior_cl_files = select_claims_files(claims_dir, prior_start, prior_eval)
            build_policy_view(con, prior_pol_files, view_name='pol')
            build_claims_view(con, prior_cl_files, view_name='cl')
            prior = compute_cohort(con, args, prior_start, prior_end, prior_eval,
                                  cohort_by=args.cohort_by)
            # 重建 main view
            build_policy_view(con, pol_files)
            build_claims_view(con, cl_files)
        except Exception as e:
            print(f"⚠️ YoY 计算失败（{e}），跳过同期对比", file=sys.stderr)
            prior = None

    if args.output == 'json':
        print(render_json(current, alt, prior, targets, args.reverse_delta))
    else:
        print(render_markdown(args, current, alt, prior, targets, args.reverse_delta))


if __name__ == '__main__':
    main()
