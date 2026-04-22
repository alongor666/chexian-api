#!/usr/bin/env python3
"""
通用车型细分经营诊断 — 保单年龄发展口径 + 可插拔下钻

输入：WHERE 子句（或词典关键词）+ 时间范围 + 下钻维度
输出：Markdown 报告（四桩主表 + 下钻表）落到 数据管理/数据分析报告/

用法：
  # 方式 A：直接传 WHERE
  python3 数据管理/pipelines/diagnose_segment.py \\
    --start 2025-01-01 --end 2026-04-20 \\
    --where "is_new_car=TRUE AND tonnage_segment='10吨以上' \\
             AND truck_type='牵引' AND fuel_type='天然气(NG/CNG/LNG)'" \\
    --slug "天然气新车牵引车10吨+" \\
    --drill vehicle_model,accident_province,accident_month,accident_cause,loss_category

  # 方式 B：用词典关键词（推荐）
  python3 数据管理/pipelines/diagnose_segment.py \\
    --start 2025-01-01 --end 2026-04-20 \\
    --keywords "天然气,新车,牵引车,10吨以上" \\
    --drill vehicle_model,accident_province,accident_month,accident_cause,loss_category

  # 不传 --drill 时默认包含全部 5 个维度
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

import duckdb

# 区分代码根（含脚本/词典）与数据根（含 parquet）。便于 worktree / 跨环境执行。
CODE_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT = Path(os.environ.get("CHEXIAN_DATA_ROOT") or CODE_ROOT)
REPO = DATA_ROOT  # 向后兼容
POLICY = f"{DATA_ROOT}/数据管理/warehouse/fact/policy/current/*.parquet"
CLAIMS = f"{DATA_ROOT}/数据管理/warehouse/fact/claims_detail/claims_*.parquet"
OUTDIR = CODE_ROOT / "数据管理/数据分析报告"
DICTIONARY = CODE_ROOT / "数据管理/knowledge/rules/segment-dictionary.json"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from policy_age_dev import (  # noqa: E402
    build_main_table_sql,
    build_cohort_summary_sql,
    build_vehicle_model_drill_sql,
)


# ────────── Drill SQL builders ──────────

def drill_location_sql(where_clause: str, valuation_date: str) -> str:
    return f"""
WITH policy_cohort AS (
  SELECT DISTINCT policy_no FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
)
SELECT
  COALESCE(c.accident_province, '<空>') AS 省,
  COALESCE(c.accident_city, '<空>') AS 市,
  COUNT(DISTINCT c.claim_no) AS 赔案数,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)
        / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元
FROM read_parquet('{CLAIMS}', union_by_name := true) c
INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
WHERE c.accident_time <= {valuation_date}
GROUP BY 省, 市
ORDER BY 赔款_万 DESC NULLS LAST
LIMIT 20
""".strip()


def drill_month_sql(where_clause: str, valuation_date: str) -> str:
    return f"""
WITH policy_cohort AS (
  SELECT DISTINCT policy_no FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
)
SELECT
  STRFTIME(c.accident_time, '%Y-%m') AS 事故月,
  COUNT(DISTINCT c.claim_no) AS 赔案数,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)
        / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元
FROM read_parquet('{CLAIMS}', union_by_name := true) c
INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
WHERE c.accident_time <= {valuation_date}
GROUP BY 事故月
ORDER BY 事故月
""".strip()


def drill_hour_sql(where_clause: str, valuation_date: str) -> str:
    return f"""
WITH policy_cohort AS (
  SELECT DISTINCT policy_no FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
),
claims_cohort AS (
  SELECT c.*, EXTRACT(HOUR FROM c.accident_time) AS hr
  FROM read_parquet('{CLAIMS}', union_by_name := true) c
  INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
  WHERE c.accident_time <= {valuation_date}
)
SELECT
  CASE
    WHEN hr < 6 THEN '00-06 凌晨'
    WHEN hr < 12 THEN '06-12 上午'
    WHEN hr < 18 THEN '12-18 下午'
    ELSE '18-24 晚间' END AS 时段,
  COUNT(DISTINCT claim_no) AS 赔案数,
  ROUND(SUM(CASE WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                 ELSE COALESCE(reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
  ROUND(SUM(CASE WHEN settlement_time IS NOT NULL THEN COALESCE(settled_amount, 0)
                 ELSE COALESCE(reserve_amount, 0) END)
        / NULLIF(COUNT(DISTINCT claim_no), 0), 0) AS 案均_元,
  ROUND(COUNT(DISTINCT claim_no) * 100.0 / SUM(COUNT(DISTINCT claim_no)) OVER (), 1) AS 占比_pct
FROM claims_cohort
GROUP BY 时段
ORDER BY 时段
""".strip()


def drill_cause_sql(where_clause: str, valuation_date: str) -> str:
    return f"""
WITH policy_cohort AS (
  SELECT DISTINCT policy_no FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
)
SELECT
  COALESCE(c.accident_cause, '<空>') AS 事故原因,
  COUNT(DISTINCT c.claim_no) AS 赔案数,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)
        / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元,
  ROUND(COUNT(DISTINCT c.claim_no) * 100.0
        / SUM(COUNT(DISTINCT c.claim_no)) OVER (), 1) AS 占赔案_pct
FROM read_parquet('{CLAIMS}', union_by_name := true) c
INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
WHERE c.accident_time <= {valuation_date}
GROUP BY 事故原因
ORDER BY 赔款_万 DESC NULLS LAST
LIMIT 15
""".strip()


def drill_loss_category_sql(where_clause: str, valuation_date: str) -> str:
    return f"""
WITH policy_cohort AS (
  SELECT DISTINCT policy_no FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
)
SELECT
  COALESCE(c.loss_category, '<空>') AS 损失类别,
  COUNT(DISTINCT c.claim_no) AS 赔案数,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
  ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                 ELSE COALESCE(c.reserve_amount, 0) END)
        / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元
FROM read_parquet('{CLAIMS}', union_by_name := true) c
INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
WHERE c.accident_time <= {valuation_date}
GROUP BY 损失类别
ORDER BY 赔款_万 DESC NULLS LAST
""".strip()


def drill_large_cases_sql(where_clause: str, valuation_date: str, top_n: int = 10) -> str:
    return f"""
WITH policy_cohort AS (
  SELECT DISTINCT policy_no FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
)
SELECT
  c.claim_no AS 赔案号,
  c.accident_time::DATE AS 事故日期,
  COALESCE(c.accident_province, '') || '/' || COALESCE(c.accident_city, '') AS 地点,
  COALESCE(c.accident_cause, '—') AS 原因,
  COALESCE(c.loss_category, '—') AS 类别,
  ROUND((CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
              ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
  CASE WHEN c.settlement_time IS NOT NULL THEN '已结' ELSE '未决' END AS 状态
FROM read_parquet('{CLAIMS}', union_by_name := true) c
INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
WHERE c.accident_time <= {valuation_date}
ORDER BY (CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
               ELSE COALESCE(c.reserve_amount, 0) END) DESC NULLS LAST
LIMIT {top_n}
""".strip()


DRILL_REGISTRY = {
    "vehicle_model": ("厂牌车型（件数 ≥20 Top15）",
                      lambda w, v: build_vehicle_model_drill_sql(POLICY, CLAIMS, w, v)),
    "accident_province": ("出险地点 Top20（省/市）",
                          lambda w, v: drill_location_sql(w, v)),
    "accident_month": ("事故月份趋势", lambda w, v: drill_month_sql(w, v)),
    "accident_hour": ("事故时段分布（一天 24 小时四分段）", lambda w, v: drill_hour_sql(w, v)),
    "accident_cause": ("事故原因 Top15（按赔款金额）", lambda w, v: drill_cause_sql(w, v)),
    "loss_category": ("损失类别分布", lambda w, v: drill_loss_category_sql(w, v)),
    "large_cases": ("Top10 大案", lambda w, v: drill_large_cases_sql(w, v)),
}

DEFAULT_DRILLS = ["vehicle_model", "accident_province", "accident_month",
                  "accident_hour", "accident_cause", "loss_category", "large_cases"]


# ────────── 词典解析 ──────────

def load_dictionary() -> dict:
    if not DICTIONARY.exists():
        return {"keywords": {}}
    return json.loads(DICTIONARY.read_text(encoding="utf-8"))


def resolve_keywords(keywords: list[str], dictionary: dict) -> tuple[str, list[str]]:
    """将关键词列表解析为 AND 拼接的 WHERE 子句。返回 (where, unresolved)"""
    entries = dictionary.get("keywords", {})
    parts = []
    unresolved = []
    for kw in keywords:
        kw = kw.strip()
        if not kw:
            continue
        if kw in entries:
            parts.append(f"({entries[kw]['where']})")
        else:
            unresolved.append(kw)
    return " AND ".join(parts), unresolved


# ────────── Markdown 组装 ──────────

def q(con, sql):
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    return cols, rows


def md_table(cols, rows):
    if not rows:
        return "_无数据_\n"
    out = ["| " + " | ".join(str(c) for c in cols) + " |",
           "|" + "|".join([":---"] * len(cols)) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if v is None else str(v) for v in r) + " |")
    return "\n".join(out)


def build_report(args, where_clause: str, resolved_from_keywords: bool) -> Path:
    con = duckdb.connect()
    valuation_date = f"DATE '{args.valuation_date}'"
    today = date.today().strftime("%Y-%m-%d")

    parts = [f"# 诊断报告｜{args.slug}\n"]
    parts.append(f"> **筛选**：`insurance_start_date ∈ [{args.start}, {args.end}]`")
    parts.append(f">\n> **WHERE**：`{where_clause}`")
    if resolved_from_keywords:
        parts.append(f">\n> **来源**：词典关键词 `{args.keywords}`")
    parts.append(f">\n> **估值日**：{args.valuation_date}  **报告生成**：{today}")
    parts.append(f">\n> **数据源**：`policy/current/*.parquet` + `claims_detail/claims_*.parquet`")
    parts.append(f">\n> **赔案锚定**：`accident_time`；**赔款**：已决 `settled_amount` + 未结 `reserve_amount`\n")

    # 把时间范围也拼进 WHERE
    full_where = (f"insurance_start_date BETWEEN DATE '{args.start}' AND DATE '{args.end}'"
                  f" AND ({where_clause})")

    print("[1/3] Cohort 概览...")
    c0, r0 = q(con, build_cohort_summary_sql(POLICY, full_where, args.start, args.end))

    parts.append("## 0. Cohort 概览\n")
    parts.append(md_table(c0, r0))

    print("[2/3] 主表四桩...")
    c1, r1 = q(con, build_main_table_sql(POLICY, CLAIMS, full_where, valuation_date))
    parts.append("\n## 1. 主表：保单年龄发展口径四桩\n")
    parts.append(md_table(c1, r1))
    parts.append("\n> 四桩 cohort 独立不等大（递减），**不是同一批车随时间递增成熟**。")
    parts.append("> 每桩 eligible = 该桩所需发展天数已过估值日的保单。满期=保单止期已过估值日。")
    parts.append("> 已赚保费 = 保费 × min(N, policy_term)/policy_term；已赚暴露 = min(N, policy_term)/365（年化）。\n")

    print(f"[3/3] 下钻 {len(args.drill)} 个维度...")
    for idx, drill_name in enumerate(args.drill, 1):
        if drill_name not in DRILL_REGISTRY:
            print(f"  [WARN] 未知下钻维度：{drill_name}，跳过")
            continue
        title, sql_fn = DRILL_REGISTRY[drill_name]
        print(f"  ({idx}) {drill_name} — {title}")
        cols, rows = q(con, sql_fn(full_where, valuation_date))
        parts.append(f"\n## {idx + 1}. 下钻：{title}\n")
        parts.append(md_table(cols, rows))

    parts.append("\n## 附：关键口径说明\n")
    parts.append("""
- **件数**：保单级去重（policy_no distinct），HAVING SUM(premium)>0 剔除纯退保单。
- **保费**：按保单净额聚合（含批改），单位万元。
- **已赚保费**：`premium × min(N, policy_term)/policy_term`，满期=全额。
- **已赚暴露**：`min(N, policy_term)/365`，年化可比。
- **赔案数**：claim_no distinct 且 accident_time 在观察窗口内（≤估值日）。
- **赔款（已报告）**：已结案取 `settled_amount`，未结案取 `reserve_amount`，两者不重复求和。
- **案均赔款** = 赔款 / 赔案数。
- **满期出险率** = 赔案数 / 已赚暴露（年化，单位 %）。
- **满期赔付率** = 已报告赔款 / 已赚保费（单位 %）。
""")

    OUTDIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTDIR / f"{args.slug}_经营诊断_{today.replace('-', '')}.md"
    out_path.write_text("\n".join(parts), encoding="utf-8")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="通用车型细分经营诊断（保单年龄发展口径）")
    parser.add_argument("--start", required=True, help="起保日期下限（YYYY-MM-DD）")
    parser.add_argument("--end", required=True, help="起保日期上限（YYYY-MM-DD）")
    parser.add_argument("--where", help="SQL WHERE 子句（不含 insurance_start_date 范围）")
    parser.add_argument("--keywords", help="词典关键词，逗号分隔（如 '天然气,新车,牵引车,10吨以上'）")
    parser.add_argument("--slug", help="报告 slug（文件名前缀），未指定则用 keywords 拼接")
    parser.add_argument("--drill", default=",".join(DEFAULT_DRILLS),
                        help=f"下钻维度，逗号分隔。可选：{','.join(DRILL_REGISTRY.keys())}")
    parser.add_argument("--valuation-date", default="2026-04-21", help="估值日")
    parser.add_argument("--dry-run", action="store_true", help="只解析参数，不实际跑查询")
    args = parser.parse_args()

    args.drill = [d.strip() for d in args.drill.split(",") if d.strip()]

    resolved_from_keywords = False
    if args.where and args.keywords:
        print("[ERROR] --where 与 --keywords 互斥，请择一", file=sys.stderr)
        sys.exit(1)
    if args.keywords:
        keywords = [k.strip() for k in args.keywords.split(",")]
        dictionary = load_dictionary()
        where_clause, unresolved = resolve_keywords(keywords, dictionary)
        if unresolved:
            print(f"[ERROR] 以下关键词不在词典里：{unresolved}")
            print(f"[ERROR] 请先补充到 {DICTIONARY}，或改用 --where 明确指定")
            sys.exit(1)
        if not args.slug:
            args.slug = "_".join(keywords)
        resolved_from_keywords = True
    elif args.where:
        where_clause = args.where
        if not args.slug:
            print("[ERROR] 使用 --where 时必须指定 --slug", file=sys.stderr)
            sys.exit(1)
    else:
        print("[ERROR] 必须指定 --where 或 --keywords 之一", file=sys.stderr)
        sys.exit(1)

    print(f"=== 诊断参数 ===")
    print(f"  slug: {args.slug}")
    print(f"  时间: {args.start} ~ {args.end}")
    print(f"  WHERE: {where_clause}")
    print(f"  下钻: {args.drill}")
    print(f"  估值日: {args.valuation_date}")
    print()

    if args.dry_run:
        print("[DRY-RUN] 参数校验通过，未执行查询")
        return

    out_path = build_report(args, where_clause, resolved_from_keywords)
    print(f"\n[OK] 报告已落盘：{out_path}")
    print(f"     字符数 {len(out_path.read_text(encoding='utf-8')):,}")


if __name__ == "__main__":
    main()
