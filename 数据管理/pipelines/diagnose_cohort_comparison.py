#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
双 cutoff cohort 发展对比诊断 — 因素分解 + 归一速度 + 自动打灯

复用 server/src/sql/claims-heatmap.ts 的 earned premium / earned exposure 公式，
对任意两个 cutoff（A → B）做：
  1. 顶层（整体 / isolate_category / 其他）三段对照
  2. 二级拆分（默认按 customer_category）的逐项对照
  3. 双因素分解：每类对整体满期赔付率变化的 结构 / 赔付 / 二阶 / 合计 影响度
  4. 同比对照（按 yoy_offset 年偏移，cohort 同月同位发展节奏）
  5. 归一发展速度 = 该类 lr 增速 ÷ 整体 lr 增速；> 1.5 自动打🟡, < 0.7 打🔵
  6. 异常自动打灯：双暴涨 🔴 / 单边异常 🟡 / 样本不足 ⚪ / 跟随 🟢

用法（示例）:
  python3 数据管理/pipelines/diagnose_cohort_comparison.py \\
    --policy-year 2026 \\
    --cutoffs 2026-03-31,2026-04-30 \\
    --yoy-offset 1 \\
    --isolate-category 摩托车 \\
    --claims-date-field accident_time

参数:
  --policy-year       保单年度 (YEAR(insurance_start_date))，默认 max_date 所在年
  --cutoffs           逗号分隔 ISO 日期列表（A,B 或更多），按时序排序
  --yoy-offset        同比偏移年数（默认 1，表示 vs 上一年同月同日）
  --isolate-category  把某个 customer_category 单独切出（默认 摩托车）
  --split-dim         二级拆分维度（默认 customer_category；预留扩展）
  --claims-date-field accident_time | report_time（默认 accident_time）
  --where             额外 WHERE 条件（如 'org_level_3=\\'天府\\''），可选
  --min-claim-count   样本充足阈值（默认 5），低于则打 ⚪
  --abnormal-pp       双暴涨阈值（赔付率绝对水位 pp，默认 100）
  --yoy-deteriorate-pp 同比恶化阈值（pp，默认 30）
  --output            md|console|both（默认 console）
  --out-dir           当 output 含 md 时落盘目录（默认 数据分析报告/）
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb

SCRIPT_DIR = Path(__file__).resolve().parent
CODE_ROOT = SCRIPT_DIR.parent.parent
DATA_ROOT = Path(os.environ.get("CHEXIAN_DATA_ROOT") or CODE_ROOT)
POLICY = str(DATA_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
CLAIMS = str(DATA_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")
DEFAULT_OUT_DIR = CODE_ROOT / "数据分析报告"

VALID_CLAIMS_FIELDS = ("accident_time", "report_time")


# ────────── SQL builder ──────────

def build_query(cutoff_iso: str, policy_year: int, claims_date_field: str,
                where_extra: str | None = None) -> str:
    extra = f" AND {where_extra}" if where_extra else ""
    return f"""
WITH eligible AS (
  SELECT
    policy_no,
    customer_category,
    SUM(premium) AS premium,
    ANY_VALUE(insurance_start_date) AS insurance_start_date
  FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE EXTRACT(YEAR FROM CAST(insurance_start_date AS DATE)) = {policy_year}
    AND CAST(insurance_start_date AS DATE) <= DATE '{cutoff_iso}'
    {extra}
  GROUP BY policy_no, customer_category
  HAVING SUM(premium) > 0
),
earned AS (
  SELECT
    customer_category,
    COUNT(DISTINCT policy_no) AS policy_count,
    SUM(premium) / 1e4 AS premium_wan,
    SUM(premium * LEAST(
      GREATEST(DATE_DIFF('day', CAST(insurance_start_date AS DATE), DATE '{cutoff_iso}' + INTERVAL 1 DAY), 0),
      GREATEST(DATE_DIFF('day', CAST(insurance_start_date AS DATE),
                         CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)
    )::DOUBLE / GREATEST(DATE_DIFF('day', CAST(insurance_start_date AS DATE),
                                    CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)) / 1e4 AS earned_premium_wan,
    SUM(LEAST(
      GREATEST(DATE_DIFF('day', CAST(insurance_start_date AS DATE), DATE '{cutoff_iso}' + INTERVAL 1 DAY), 0),
      GREATEST(DATE_DIFF('day', CAST(insurance_start_date AS DATE),
                         CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)
    )::DOUBLE / GREATEST(DATE_DIFF('day', CAST(insurance_start_date AS DATE),
                                    CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR), 1)) AS earned_exposure
  FROM eligible
  GROUP BY customer_category
),
claims AS (
  SELECT
    e.customer_category,
    COUNT(DISTINCT c.claim_no) AS claim_count,
    SUM(COALESCE(c.settled_amount, 0) + COALESCE(c.pending_amount, 0)) / 1e4 AS total_claims_wan
  FROM read_parquet('{CLAIMS}', union_by_name := true) c
  JOIN eligible e USING (policy_no)
  WHERE CAST(c.{claims_date_field} AS DATE) <= DATE '{cutoff_iso}'
  GROUP BY e.customer_category
)
SELECT
  e.customer_category,
  e.policy_count,
  ROUND(e.premium_wan, 4) AS premium_wan,
  ROUND(e.earned_premium_wan, 4) AS earned_premium_wan,
  ROUND(e.earned_exposure, 6) AS earned_exposure,
  COALESCE(c.claim_count, 0) AS claim_count,
  ROUND(COALESCE(c.total_claims_wan, 0), 4) AS total_claims_wan
FROM earned e
LEFT JOIN claims c USING (customer_category)
"""


# ────────── 数据结构 ──────────

@dataclass
class Snapshot:
    earned_premium_wan: float = 0.0
    earned_exposure: float = 0.0
    total_claims_wan: float = 0.0
    claim_count: int = 0
    premium_wan: float = 0.0
    policy_count: int = 0

    @property
    def loss_ratio(self) -> float | None:
        return (self.total_claims_wan / self.earned_premium_wan * 100
                if self.earned_premium_wan > 0 else None)

    @property
    def incident_rate(self) -> float | None:
        return (self.claim_count / self.earned_exposure * 100
                if self.earned_exposure > 0 else None)

    @property
    def avg_claim(self) -> float | None:
        return (self.total_claims_wan * 10000 / self.claim_count
                if self.claim_count > 0 else None)

    def add(self, other: "Snapshot") -> "Snapshot":
        return Snapshot(
            self.earned_premium_wan + other.earned_premium_wan,
            self.earned_exposure + other.earned_exposure,
            self.total_claims_wan + other.total_claims_wan,
            self.claim_count + other.claim_count,
            self.premium_wan + other.premium_wan,
            self.policy_count + other.policy_count,
        )


# ────────── Format helpers ──────────

def f(v, dec=2):
    return "—" if v is None else f"{v:.{dec}f}"

def s(v, dec=2):
    if v is None: return "—"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.{dec}f}"

def share(part: float, total: float) -> float | None:
    return (part / total * 100) if total > 0 else None


# ────────── 影响度分解 ──────────

def decompose(part_a: Snapshot, part_b: Snapshot,
              total_a: Snapshot, total_b: Snapshot) -> dict:
    """对整体满期赔付率 A → B 变化的双因素分解（pp 单位）"""
    sa = (part_a.earned_premium_wan / total_a.earned_premium_wan
          if total_a.earned_premium_wan > 0 else 0)
    sb = (part_b.earned_premium_wan / total_b.earned_premium_wan
          if total_b.earned_premium_wan > 0 else 0)
    lra = part_a.loss_ratio or 0
    lrb = part_b.loss_ratio or 0
    ds = sb - sa
    dlr = lrb - lra
    structural = ds * lra
    loss_eff = sa * dlr
    cross = ds * dlr
    return dict(
        share_a=sa * 100, share_b=sb * 100,
        lr_a=lra, lr_b=lrb,
        structural=structural, loss=loss_eff, cross=cross,
        total=structural + loss_eff + cross,
    )


# ────────── 自动打灯 ──────────

def alert(part_b: Snapshot, lr_b: float | None, lr_yoy: float | None,
          velocity: float | None, abnormal_pp: float, yoy_pp: float,
          min_count: int) -> str:
    if part_b.claim_count < min_count:
        return "⚪样本不足"
    yoy_delta = (lr_b - lr_yoy) if (lr_b is not None and lr_yoy is not None) else None
    if (lr_b is not None and lr_b > abnormal_pp
        and yoy_delta is not None and yoy_delta > yoy_pp):
        return "🔴双暴涨"
    if velocity is not None and velocity > 1.5:
        return "🟡快于大盘"
    if velocity is not None and velocity < 0.7:
        return "🔵慢于大盘"
    if yoy_delta is not None and yoy_delta > yoy_pp:
        return "🟡同比恶化"
    return "🟢跟随"


# ────────── Main ──────────

def parse_args():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--policy-year", type=int, default=None,
                   help="保单年度；默认 max_date 所在年")
    p.add_argument("--cutoffs", required=True,
                   help="逗号分隔 ISO 日期，至少 2 个 (e.g. 2026-03-31,2026-04-30)")
    p.add_argument("--yoy-offset", type=int, default=1,
                   help="同比偏移年数（默认 1）")
    p.add_argument("--isolate-category", default="摩托车",
                   help="把某 customer_category 单独切出（默认 摩托车，传空字符串关闭）")
    p.add_argument("--split-dim", default="customer_category",
                   help="二级拆分维度（默认 customer_category）")
    p.add_argument("--claims-date-field", default="accident_time",
                   choices=VALID_CLAIMS_FIELDS)
    p.add_argument("--where", default=None, help="额外 WHERE 条件")
    p.add_argument("--min-claim-count", type=int, default=5)
    p.add_argument("--abnormal-pp", type=float, default=100.0)
    p.add_argument("--yoy-deteriorate-pp", type=float, default=30.0)
    p.add_argument("--output", default="console", choices=("console", "md", "both"))
    p.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    return p.parse_args()


def shift_year(d: str, years: int) -> str:
    dt = datetime.strptime(d, "%Y-%m-%d").date()
    try:
        return dt.replace(year=dt.year - years).isoformat()
    except ValueError:  # 闰日 02-29 → 平年 02-28
        return dt.replace(year=dt.year - years, day=28).isoformat()


def main():
    args = parse_args()
    cutoffs = [c.strip() for c in args.cutoffs.split(",") if c.strip()]
    if len(cutoffs) < 2:
        sys.exit("错误：至少需要 2 个 cutoff")
    for c in cutoffs:
        if not (len(c) == 10 and c[4] == "-" and c[7] == "-"):
            sys.exit(f"错误：cutoff 格式必须为 YYYY-MM-DD: {c}")
    cutoffs.sort()
    cutoff_a, cutoff_b = cutoffs[0], cutoffs[-1]

    # 自动推断 policy_year
    if args.policy_year is None:
        args.policy_year = int(cutoff_b[:4])

    yoy_year = args.policy_year - args.yoy_offset
    yoy_a = shift_year(cutoff_a, args.yoy_offset)
    yoy_b = shift_year(cutoff_b, args.yoy_offset)

    print(f"# Cohort 发展对比诊断", file=sys.stderr)
    print(f"  policy_year={args.policy_year}  cutoffs=[{cutoff_a}, {cutoff_b}]",
          file=sys.stderr)
    print(f"  vs yoy_year={yoy_year}  yoy_cutoffs=[{yoy_a}, {yoy_b}]", file=sys.stderr)
    print(f"  claims_date_field={args.claims_date_field}", file=sys.stderr)

    con = duckdb.connect()

    # 4 个查询 → snapshots
    snapshots: dict[tuple[str, str], Snapshot] = {}
    queries = [
        (cutoff_a, args.policy_year),
        (cutoff_b, args.policy_year),
        (yoy_a, yoy_year),
        (yoy_b, yoy_year),
    ]
    for cutoff, year in queries:
        rows = con.execute(build_query(cutoff, year, args.claims_date_field, args.where)).fetchall()
        cols = [d[0] for d in con.description]
        for r in rows:
            d = dict(zip(cols, r))
            snapshots[(cutoff, d["customer_category"])] = Snapshot(
                earned_premium_wan=float(d["earned_premium_wan"] or 0),
                earned_exposure=float(d["earned_exposure"] or 0),
                total_claims_wan=float(d["total_claims_wan"] or 0),
                claim_count=int(d["claim_count"] or 0),
                premium_wan=float(d["premium_wan"] or 0),
                policy_count=int(d["policy_count"] or 0),
            )

    all_cats = sorted({k[1] for k in snapshots})
    isolate = args.isolate_category if args.isolate_category else None
    other_cats = [c for c in all_cats if c != isolate]

    def agg(cutoff: str, cats: list[str]) -> Snapshot:
        result = Snapshot()
        for c in cats:
            sn = snapshots.get((cutoff, c))
            if sn: result = result.add(sn)
        return result

    # ────────── 输出 ──────────
    out_lines: list[str] = []
    def w(line: str = ""):
        out_lines.append(line)
        print(line)

    w(f"# Cohort 发展对比诊断报告")
    w()
    w(f"- **保单年度**: {args.policy_year}（起保口径）")
    w(f"- **对比 cutoff**: {cutoff_a} → {cutoff_b}")
    w(f"- **同比基准**: {yoy_year} 同位 cutoff [{yoy_a}, {yoy_b}]")
    w(f"- **赔案纳入**: {args.claims_date_field} ≤ cutoff")
    if args.where:
        w(f"- **额外 WHERE**: `{args.where}`")
    if isolate:
        w(f"- **隔离类别**: {isolate}（顶层独立显示）")
    w()

    # 表 1：顶层（整体 / 隔离 / 其他）
    w(f"## 一、顶层三段对照")
    w()
    w(f"| 段 | 指标 | A({cutoff_a}) | B({cutoff_b}) | 环比Δ | 环比% | YoY({yoy_b}) | 同比Δ | 同比% |")
    w(f"|---|---|---:|---:|---:|---:|---:|---:|---:|")

    def render_block(name: str, cats: list[str]):
        a = agg(cutoff_a, cats); b = agg(cutoff_b, cats)
        ya = agg(yoy_a, cats); yb = agg(yoy_b, cats)
        total_a = agg(cutoff_a, all_cats); total_b = agg(cutoff_b, all_cats)
        total_yb = agg(yoy_b, all_cats)
        sa = share(a.earned_premium_wan, total_a.earned_premium_wan)
        sb = share(b.earned_premium_wan, total_b.earned_premium_wan)
        syb = share(yb.earned_premium_wan, total_yb.earned_premium_wan)
        items = [
            ("满期保费(万)", a.earned_premium_wan, b.earned_premium_wan, yb.earned_premium_wan, 1),
            ("满期保费占比(%)", sa, sb, syb, 2),
            ("已报告赔款(万)", a.total_claims_wan, b.total_claims_wan, yb.total_claims_wan, 1),
            ("满期赔付率(%)", a.loss_ratio, b.loss_ratio, yb.loss_ratio, 2),
            ("满期出险频度(%)", a.incident_rate, b.incident_rate, yb.incident_rate, 2),
            ("已报告件数", a.claim_count, b.claim_count, yb.claim_count, 0),
        ]
        for label, va, vb, vy, dec in items:
            d = (vb - va) if (va is not None and vb is not None) else None
            dp = (d / abs(va) * 100) if (d is not None and va not in (None, 0)) else None
            yd = (vb - vy) if (vb is not None and vy is not None) else None
            ydp = (yd / abs(vy) * 100) if (yd is not None and vy not in (None, 0)) else None
            w(f"| {name} | {label} | {f(va, dec)} | {f(vb, dec)} | "
              f"{s(d, dec)} | {s(dp, 1)} | {f(vy, dec)} | {s(yd, dec)} | {s(ydp, 1)} |")

    render_block("整体", all_cats)
    if isolate and isolate in all_cats:
        render_block(isolate, [isolate])
        render_block("其他", other_cats)

    # 表 2：影响度分解（对整体 lr 变化）
    overall_a = agg(cutoff_a, all_cats); overall_b = agg(cutoff_b, all_cats)
    lr_total_change = ((overall_b.loss_ratio or 0) - (overall_a.loss_ratio or 0))
    w()
    w(f"## 二、影响度分解（对整体满期赔付率 {s(lr_total_change, 2)} pp 变化）")
    w()
    w(f"双因素分解: 合计 = 结构(占比变化×旧赔付率) + 赔付(旧占比×赔付率变化) + 二阶交叉")
    w()
    w(f"| 类别 | 占比A% | 占比B% | LRA% | LRB% | 结构pp | 赔付pp | 二阶pp | 合计pp | 占整体% | 灯 |")
    w(f"|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|")
    decompositions = []
    for cat in all_cats:
        pa = snapshots.get((cutoff_a, cat), Snapshot())
        pb = snapshots.get((cutoff_b, cat), Snapshot())
        yb_sn = snapshots.get((yoy_b, cat), Snapshot())
        dec = decompose(pa, pb, overall_a, overall_b)
        # 归一速度 = 该类 lr 增长比 ÷ 整体 lr 增长比
        velocity = None
        if dec["lr_a"] > 0 and overall_a.loss_ratio and overall_a.loss_ratio > 0 and overall_b.loss_ratio:
            velocity = (dec["lr_b"] / dec["lr_a"]) / (overall_b.loss_ratio / overall_a.loss_ratio)
        flag = alert(pb, dec["lr_b"], yb_sn.loss_ratio, velocity,
                     args.abnormal_pp, args.yoy_deteriorate_pp, args.min_claim_count)
        decompositions.append((cat, dec, velocity, flag, yb_sn.loss_ratio))

    decompositions.sort(key=lambda x: -abs(x[1]["total"]))
    for cat, dec, velocity, flag, _ in decompositions:
        pct = (dec["total"] / lr_total_change * 100) if lr_total_change else None
        w(f"| {cat} | {f(dec['share_a'], 2)} | {f(dec['share_b'], 2)} | "
          f"{f(dec['lr_a'], 1)} | {f(dec['lr_b'], 1)} | "
          f"{s(dec['structural'], 2)} | {s(dec['loss'], 2)} | {s(dec['cross'], 2)} | "
          f"**{s(dec['total'], 2)}** | {s(pct, 1) if pct else '—'} | {flag} |")
    sum_total = sum(d[1]["total"] for d in decompositions)
    w()
    w(f"_合计 {s(sum_total, 2)} pp · 整体变化 {s(lr_total_change, 2)} pp · 差额 {s(sum_total - lr_total_change, 3)}pp（舍入）_")

    # 表 3：归一发展速度
    w()
    w(f"## 三、归一发展速度（该类 lr 增速 ÷ 整体 lr 增速）")
    w()
    w(f"> 1 = 比平均水位快（异常）；< 1 = 比平均水位慢（落后）；≈ 1 = 跟随大盘节奏")
    w()
    w(f"| 类别 | LR_A% | LR_B% | 该类增速 | 整体增速 | 归一速度 | 灯 |")
    w(f"|---|---:|---:|---:|---:|---:|:---:|")
    overall_velo = (overall_b.loss_ratio / overall_a.loss_ratio
                    if (overall_a.loss_ratio and overall_a.loss_ratio > 0
                        and overall_b.loss_ratio) else None)
    for cat, dec, velocity, flag, _ in decompositions:
        if dec["lr_a"] <= 0:
            continue
        my_velo = dec["lr_b"] / dec["lr_a"]
        w(f"| {cat} | {f(dec['lr_a'], 1)} | {f(dec['lr_b'], 1)} | "
          f"{f(my_velo, 2)} | {f(overall_velo, 2)} | "
          f"**{f(velocity, 2) if velocity else '—'}** | {flag} |")

    # 表 4：同比对照（B vs YoY_B，按 cat 全列）
    w()
    w(f"## 四、{cutoff_b} 同比 {yoy_b} 客户类别对照")
    w()
    w(f"| 类别 | 满期保费(万) 同比% | 满期赔付率Δpp | 已报告赔款(万) 同比% | 出险频度Δpp |")
    w(f"|---|---:|---:|---:|---:|")
    rows_yoy = []
    for cat in all_cats:
        b = snapshots.get((cutoff_b, cat), Snapshot())
        yb_sn = snapshots.get((yoy_b, cat), Snapshot())
        ep_d = ((b.earned_premium_wan - yb_sn.earned_premium_wan) / yb_sn.earned_premium_wan * 100
                if yb_sn.earned_premium_wan > 0 else None)
        lr_d = ((b.loss_ratio - yb_sn.loss_ratio) if (b.loss_ratio is not None
                                                       and yb_sn.loss_ratio is not None) else None)
        tc_d = ((b.total_claims_wan - yb_sn.total_claims_wan) / yb_sn.total_claims_wan * 100
                if yb_sn.total_claims_wan > 0 else None)
        ir_d = ((b.incident_rate - yb_sn.incident_rate) if (b.incident_rate is not None
                                                              and yb_sn.incident_rate is not None) else None)
        rows_yoy.append((cat, ep_d, lr_d, tc_d, ir_d, b.earned_premium_wan))
    rows_yoy.sort(key=lambda x: -x[5])
    for cat, ep_d, lr_d, tc_d, ir_d, _ in rows_yoy:
        w(f"| {cat} | {s(ep_d, 1)}% | {s(lr_d, 1)} | {s(tc_d, 1)}% | {s(ir_d, 2)} |")

    # 落盘
    if args.output in ("md", "both"):
        out_dir = Path(args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        slug = f"{args.policy_year}_{cutoff_a}_to_{cutoff_b.replace('-', '')}_{ts}"
        path = out_dir / f"cohort_comparison_{slug}.md"
        path.write_text("\n".join(out_lines), encoding="utf-8")
        print(f"\n[已落盘] {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
