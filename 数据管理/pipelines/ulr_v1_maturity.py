#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR v1 · Development Maturity 判定脚本（T2 交付物）

按险别分档计算 2021-2024 cohort 在估值日的 maturity 状态。
输出 mature cohort 清单，供 Prior 模型训练窗口选择使用。

成熟判定阈值（§3 P2）：
  车损（短尾）      : paid_ldf(t->t+12) < 1.02  且  未决占比 < 3%
  三者责任（中尾）  : paid_ldf(t->t+12) < 1.05  且  未决占比 < 8%
  人伤 / BI（长尾）: paid_ldf(t->t+12) < 1.10  且  未决占比 < 12%

险别金额来源（claims_detail）：
  车损     : settled_vehicle_amount
  三者责任 : settled_amount - settled_vehicle_amount - settled_bodily_amount (残余)
  人伤     : settled_bodily_amount

未决：
  pending_amount / (settled_amount + pending_amount)
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
POLICY_GLOB = str(REPO_ROOT / "数据管理/warehouse/fact/policy/current/*.parquet")
CLAIMS_PATH = str(REPO_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")
REPORT_DIR = REPO_ROOT / "数据管理/数据分析报告"


# ============================================================================
# 1. 阈值配置
# ============================================================================

@dataclass(frozen=True)
class MaturityThreshold:
    coverage: str
    coverage_label: str
    ldf_threshold: float
    unpaid_threshold: float

    @property
    def rule_text(self) -> str:
        return (
            f"paid_ldf < {self.ldf_threshold} "
            f"AND 未决占比 < {self.unpaid_threshold * 100:.0f}%"
        )


THRESHOLDS: list[MaturityThreshold] = [
    MaturityThreshold("vehicle", "车损（短尾）", 1.02, 0.03),
    MaturityThreshold("third_party", "三者责任（中尾）", 1.05, 0.08),
    MaturityThreshold("bodily", "人伤/BI（长尾）", 1.10, 0.12),
]


# ============================================================================
# 2. 计算逻辑
# ============================================================================

def compute_cohort_maturity(
    con: duckdb.DuckDBPyConnection,
    valuation_date: str,
    cohort_years: list[int],
    where_clause: str | None = None,
    policy_glob: str = POLICY_GLOB,
    claims_path: str = CLAIMS_PATH,
) -> list[dict]:
    """按 (cohort_year, coverage) 计算 maturity 指标。

    返回行：
        cohort_year, coverage, dev_age_months,
        cum_paid_now, cum_paid_prior (12 个月前),
        paid_ldf_12m, pending_amount, unpaid_ratio,
        policies, claims
    """
    years_csv = ",".join(str(y) for y in cohort_years)
    extra_where = f"AND ({where_clause})" if where_clause else ""

    sql = f"""
    WITH origin_policy AS (
        SELECT
            policy_no,
            YEAR(insurance_start_date) AS cohort_year,
            insurance_start_date,
            premium
        FROM read_parquet('{policy_glob}', union_by_name := true)
        WHERE endorsement_no IS NULL
          AND YEAR(insurance_start_date) IN ({years_csv})
          AND premium > 0
          {extra_where}
    ),
    cohort_summary AS (
        SELECT
            cohort_year,
            COUNT(*) AS policies,
            MIN(insurance_start_date) AS cohort_start,
            DATE_DIFF('month',
                      MAKE_DATE(cohort_year, 1, 1),
                      '{valuation_date}'::DATE) AS dev_age_months
        FROM origin_policy
        GROUP BY cohort_year
    ),
    claims_with_split AS (
        SELECT
            YEAR(p.insurance_start_date) AS cohort_year,
            c.claim_no,
            c.settlement_time,
            -- 险别金额拆分
            COALESCE(c.settled_vehicle_amount, 0) AS paid_vehicle,
            COALESCE(c.settled_bodily_amount, 0) AS paid_bodily,
            GREATEST(
                COALESCE(c.settled_amount, 0)
                - COALESCE(c.settled_vehicle_amount, 0)
                - COALESCE(c.settled_bodily_amount, 0),
                0
            ) AS paid_third_party,
            COALESCE(c.settled_amount, 0) AS paid_total,
            -- 未决
            COALESCE(c.reserve_vehicle_amount, 0) AS reserve_vehicle,
            COALESCE(c.reserve_bodily_amount, 0) AS reserve_bodily,
            COALESCE(c.reserve_property_amount, 0) AS reserve_property,
            COALESCE(c.pending_amount, 0) AS pending_total
        FROM read_parquet('{claims_path}') c
        JOIN origin_policy p ON p.policy_no = c.policy_no
        WHERE YEAR(p.insurance_start_date) IN ({years_csv})
    ),
    -- 当前估值日累计已付（按 coverage 拆）
    paid_now AS (
        SELECT
            cohort_year,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE
                     THEN paid_vehicle ELSE 0 END) AS paid_now_vehicle,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE
                     THEN paid_third_party ELSE 0 END) AS paid_now_third_party,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE
                     THEN paid_bodily ELSE 0 END) AS paid_now_bodily,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE
                     THEN paid_total ELSE 0 END) AS paid_now_total,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE
                     THEN 1 ELSE 0 END) AS claims_now
        FROM claims_with_split
        GROUP BY cohort_year
    ),
    -- 12 个月前的累计已付
    paid_prior AS (
        SELECT
            cohort_year,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE - INTERVAL 12 MONTH
                     THEN paid_vehicle ELSE 0 END) AS paid_prior_vehicle,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE - INTERVAL 12 MONTH
                     THEN paid_third_party ELSE 0 END) AS paid_prior_third_party,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE - INTERVAL 12 MONTH
                     THEN paid_bodily ELSE 0 END) AS paid_prior_bodily,
            SUM(CASE WHEN settlement_time <= '{valuation_date}'::DATE - INTERVAL 12 MONTH
                     THEN paid_total ELSE 0 END) AS paid_prior_total
        FROM claims_with_split
        GROUP BY cohort_year
    ),
    -- 当前未决（按险别）
    pending_now AS (
        SELECT
            cohort_year,
            -- 未决按 reserve_* 拆分，如果 reserve 均为 0 则视作已全部已决
            SUM(CASE WHEN (reserve_vehicle + reserve_bodily + reserve_property) > 0
                     THEN pending_total * reserve_vehicle
                          / NULLIF(reserve_vehicle + reserve_bodily + reserve_property, 0)
                     ELSE 0 END) AS pending_vehicle,
            SUM(CASE WHEN (reserve_vehicle + reserve_bodily + reserve_property) > 0
                     THEN pending_total * reserve_property
                          / NULLIF(reserve_vehicle + reserve_bodily + reserve_property, 0)
                     ELSE 0 END) AS pending_third_party,
            SUM(CASE WHEN (reserve_vehicle + reserve_bodily + reserve_property) > 0
                     THEN pending_total * reserve_bodily
                          / NULLIF(reserve_vehicle + reserve_bodily + reserve_property, 0)
                     ELSE 0 END) AS pending_bodily,
            SUM(pending_total) AS pending_all
        FROM claims_with_split
        GROUP BY cohort_year
    )
    SELECT
        cs.cohort_year,
        cs.policies,
        cs.dev_age_months,
        -- vehicle
        pn.paid_now_vehicle, pp.paid_prior_vehicle, pd.pending_vehicle,
        -- third_party
        pn.paid_now_third_party, pp.paid_prior_third_party, pd.pending_third_party,
        -- bodily
        pn.paid_now_bodily, pp.paid_prior_bodily, pd.pending_bodily,
        -- total
        pn.paid_now_total, pp.paid_prior_total, pd.pending_all,
        pn.claims_now
    FROM cohort_summary cs
    LEFT JOIN paid_now pn USING (cohort_year)
    LEFT JOIN paid_prior pp USING (cohort_year)
    LEFT JOIN pending_now pd USING (cohort_year)
    ORDER BY cs.cohort_year
    """
    rows = con.sql(sql).fetchall()
    cols = [
        "cohort_year", "policies", "dev_age_months",
        "paid_now_vehicle", "paid_prior_vehicle", "pending_vehicle",
        "paid_now_third_party", "paid_prior_third_party", "pending_third_party",
        "paid_now_bodily", "paid_prior_bodily", "pending_bodily",
        "paid_now_total", "paid_prior_total", "pending_all",
        "claims_now",
    ]
    return [dict(zip(cols, r)) for r in rows]


# ============================================================================
# 3. Maturity 判定
# ============================================================================

def assess_maturity(raw: list[dict]) -> list[dict]:
    """对每个 (cohort_year, coverage) 组合输出 maturity 结果。"""
    results: list[dict] = []

    for row in raw:
        cohort = row["cohort_year"]
        for th in THRESHOLDS:
            paid_now = row[f"paid_now_{th.coverage}"] or 0
            paid_prior = row[f"paid_prior_{th.coverage}"] or 0
            pending = row[f"pending_{th.coverage}"] or 0
            total_incurred = paid_now + pending

            if paid_prior > 0:
                ldf_12m = paid_now / paid_prior
            else:
                ldf_12m = None

            if total_incurred > 0:
                unpaid_ratio = pending / total_incurred
            else:
                unpaid_ratio = None

            if ldf_12m is None or unpaid_ratio is None:
                mature = False
                reason = "insufficient_data"
            else:
                ldf_ok = ldf_12m < th.ldf_threshold
                unpaid_ok = unpaid_ratio < th.unpaid_threshold
                mature = ldf_ok and unpaid_ok
                if mature:
                    reason = "mature"
                else:
                    fails = []
                    if not ldf_ok:
                        fails.append(f"ldf={ldf_12m:.4f}>={th.ldf_threshold}")
                    if not unpaid_ok:
                        fails.append(f"unpaid={unpaid_ratio:.4f}>={th.unpaid_threshold}")
                    reason = "developing:" + "|".join(fails)

            results.append({
                "cohort_year": cohort,
                "coverage": th.coverage,
                "coverage_label": th.coverage_label,
                "dev_age_months": row["dev_age_months"],
                "policies": row["policies"],
                "claims": row["claims_now"],
                "paid_now": round(paid_now, 2),
                "paid_prior_12m": round(paid_prior, 2),
                "pending": round(pending, 2),
                "paid_ldf_12m": round(ldf_12m, 4) if ldf_12m is not None else None,
                "unpaid_ratio": round(unpaid_ratio, 4) if unpaid_ratio is not None else None,
                "threshold_ldf": th.ldf_threshold,
                "threshold_unpaid": th.unpaid_threshold,
                "mature": mature,
                "status": reason,
            })

    return results


# ============================================================================
# 4. 报告格式化
# ============================================================================

def format_markdown(assessments: list[dict], valuation_date: str,
                    cohort_years: list[int]) -> str:
    mature_pairs = [(r["cohort_year"], r["coverage"]) for r in assessments if r["mature"]]

    lines = [
        "# ULR v1 · Development Maturity 判定报告",
        "",
        f"**估值日**：{valuation_date} · **Cohort 范围**：{min(cohort_years)}-{max(cohort_years)}",
        "",
        "## 1. 判定规则",
        "",
        "| 险别 | paid_ldf 阈值 | 未决占比阈值 | 成熟要求 |",
        "|---|---|---|---|",
    ]
    for th in THRESHOLDS:
        lines.append(
            f"| {th.coverage_label} | < {th.ldf_threshold} | "
            f"< {th.unpaid_threshold * 100:.0f}% | 两项均满足 |"
        )

    lines.extend([
        "",
        f"## 2. 成熟 Cohort 清单（{len(mature_pairs)} 个）",
        "",
    ])
    if mature_pairs:
        by_coverage: dict[str, list[int]] = {}
        for cy, cov in mature_pairs:
            by_coverage.setdefault(cov, []).append(cy)
        lines.append("| 险别 | 成熟 cohort |")
        lines.append("|---|---|")
        for th in THRESHOLDS:
            cys = sorted(by_coverage.get(th.coverage, []))
            lines.append(f"| {th.coverage_label} | {', '.join(map(str, cys)) if cys else '— 无'} |")
    else:
        lines.append("> ⚠️ 没有 cohort 通过所有阈值。请核对数据或放宽阈值。")

    lines.extend([
        "",
        "## 3. 详细指标",
        "",
        "| Cohort | 险别 | dev_age(月) | 保单数 | 案件数 | paid_now (元) | paid_prior_12m (元) | 未决 (元) | paid_ldf_12m | 未决占比 | Mature | 状态 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:-:|---|",
    ])
    for r in sorted(assessments, key=lambda x: (x["cohort_year"], x["coverage"])):
        ldf = f"{r['paid_ldf_12m']:.4f}" if r["paid_ldf_12m"] is not None else "—"
        unpaid = f"{r['unpaid_ratio'] * 100:.2f}%" if r["unpaid_ratio"] is not None else "—"
        mark = "✅" if r["mature"] else "❌"
        lines.append(
            f"| {r['cohort_year']} | {r['coverage_label']} | {r['dev_age_months']} | "
            f"{r['policies']:,} | {r['claims']:,} | {r['paid_now']:,.0f} | "
            f"{r['paid_prior_12m']:,.0f} | {r['pending']:,.0f} | {ldf} | {unpaid} | "
            f"{mark} | {r['status']} |"
        )

    lines.extend([
        "",
        "## 4. 方法备注",
        "",
        "- 数据源：`policy/current/*.parquet` + `claims_detail/claims_*.parquet`",
        "- Origin policy：`endorsement_no IS NULL AND premium > 0`（排除批单/零保费）",
        "- Dev age：`DATE_DIFF('month', MAKE_DATE(cohort_year,1,1), valuation_date)`",
        "- Paid LDF(12m)：`paid_now / paid_prior_12m`，反映过去 12 个月已付增量",
        "- 险别拆分：",
        "  - `车损` = `settled_vehicle_amount`",
        "  - `三者责任` = `settled_amount - settled_vehicle_amount - settled_bodily_amount`（残余项）",
        "  - `人伤` = `settled_bodily_amount`",
        "- 未决拆分：按 `reserve_vehicle / reserve_property / reserve_bodily` 比例摊分 `pending_amount`",
        "- 未决占比：`pending / (paid_now + pending)`，反映 development 尾部风险",
        "",
        "## 5. 后续使用",
        "",
        "- 成熟 cohort 用于 Prior 模型训练窗口（§3 P2）",
        "- IBNR 层 BF 方法的 industry prior ELR 从本表成熟 cohort 导出（§3 P1）",
        "- 非成熟 cohort 进入 holdout，不作为终极真值",
        "",
    ])
    return "\n".join(lines)


# ============================================================================
# 5. CLI
# ============================================================================

def main() -> int:
    parser = argparse.ArgumentParser(description="ULR v1 Development Maturity 判定")
    parser.add_argument("--valuation-date", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--cohort-from", type=int, default=2021)
    parser.add_argument("--cohort-to", type=int, default=2024)
    parser.add_argument("--where", type=str, default=None,
                        help="额外 WHERE 子句（如限定燃油/主全）")
    parser.add_argument("--policy-glob", type=str, default=POLICY_GLOB)
    parser.add_argument("--claims-path", type=str, default=CLAIMS_PATH)
    parser.add_argument("--out-md", type=str, default=None)
    parser.add_argument("--out-json", type=str, default=None)
    args = parser.parse_args()

    cohort_years = list(range(args.cohort_from, args.cohort_to + 1))

    con = duckdb.connect(":memory:")

    print(f"[{datetime.now():%H:%M:%S}] 计算 cohort maturity "
          f"({args.cohort_from}-{args.cohort_to} @ {args.valuation_date})...")
    raw = compute_cohort_maturity(con, args.valuation_date, cohort_years,
                                  args.where, args.policy_glob, args.claims_path)
    print(f"[{datetime.now():%H:%M:%S}] 计算完成，{len(raw)} 个 cohort")

    assessments = assess_maturity(raw)

    date_tag = args.valuation_date.replace("-", "")
    out_md = Path(args.out_md) if args.out_md else REPORT_DIR / f"ulr_v1_maturity_{date_tag}.md"
    out_json = Path(args.out_json) if args.out_json else REPORT_DIR / f"ulr_v1_maturity_{date_tag}.json"
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(format_markdown(assessments, args.valuation_date, cohort_years),
                      encoding="utf-8")
    out_json.write_text(json.dumps(assessments, ensure_ascii=False, indent=2,
                                   default=str), encoding="utf-8")

    mature_n = sum(1 for r in assessments if r["mature"])
    print(f"\n[{datetime.now():%H:%M:%S}] 报告已输出:")
    print(f"  - {out_md}")
    print(f"  - {out_json}")
    print(f"\n成熟 cohort 数: {mature_n} / {len(assessments)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
