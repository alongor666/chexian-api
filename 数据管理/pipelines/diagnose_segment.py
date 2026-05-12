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
QUESTIONNAIRE = CODE_ROOT / "数据管理/knowledge/rules/segment-questionnaire.json"

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


def drill_large_cases_sql(where_clause: str, valuation_date: str, top_n: int = 10,
                          big_threshold: float = 200000.0) -> str:
    """Top N 大案明细：已决/未决金额拆分，默认阈值 20 万。"""
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
  ROUND(COALESCE(c.settled_amount, 0)/1e4, 1) AS 已决_万,
  ROUND(COALESCE(c.reserve_amount, 0)/1e4, 1) AS 未决_万,
  ROUND((COALESCE(c.settled_amount, 0) + COALESCE(c.reserve_amount, 0))/1e4, 1) AS 合计_万,
  CASE WHEN c.is_bodily_injury THEN '人伤' ELSE '物损' END AS 人伤,
  CASE WHEN c.settlement_time IS NOT NULL THEN '已结' ELSE '未结' END AS 状态
FROM read_parquet('{CLAIMS}', union_by_name := true) c
INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
WHERE c.accident_time <= {valuation_date}
  AND (COALESCE(c.settled_amount, 0) + COALESCE(c.reserve_amount, 0)) >= {big_threshold}
ORDER BY 合计_万 DESC NULLS LAST
LIMIT {top_n}
""".strip()


def drill_org_sql(where_clause: str, valuation_date: str) -> str:
    """机构画像下钻：按 org_level_3 矩阵展示满期赔付率+费用率+变动成本率。"""
    return f"""
WITH base AS (
  SELECT
    policy_no,
    ANY_VALUE(org_level_3) AS org,
    MIN(insurance_start_date) AS start_date,
    MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) AS term_days,
    SUM(premium) AS premium,
    SUM(COALESCE(fee_amount, 0)) AS fee
  FROM read_parquet('{POLICY}', union_by_name := true)
  WHERE {where_clause}
  GROUP BY policy_no
  HAVING SUM(premium) > 0 AND MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) > 0
),
b_earn AS (
  SELECT org, policy_no, premium, fee,
    premium * LEAST(
      GREATEST(0, DATE_DIFF('day', start_date, LEAST(start_date + term_days * INTERVAL 1 DAY, {valuation_date}))),
      term_days
    )::DOUBLE / term_days AS earned_premium
  FROM base
),
claims_agg AS (
  SELECT b.org,
    COUNT(DISTINCT c.claim_no) AS claim_cnt,
    SUM(CASE WHEN COALESCE(c.settled_amount, 0) + COALESCE(c.reserve_amount, 0) >= 200000 THEN 1 ELSE 0 END) AS big_cnt,
    SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
             ELSE COALESCE(c.reserve_amount, 0) END) AS total_loss
  FROM b_earn b
  LEFT JOIN read_parquet('{CLAIMS}', union_by_name := true) c
    ON c.policy_no = b.policy_no AND c.accident_time <= {valuation_date}
  GROUP BY b.org
)
SELECT
  COALESCE(b.org, '<空>') AS 机构,
  COUNT(DISTINCT b.policy_no) AS 保单数,
  ROUND(SUM(b.premium)/1e4, 1) AS 签单保费_万,
  ROUND(SUM(b.earned_premium)/1e4, 1) AS 满期保费_万,
  COALESCE(ca.claim_cnt, 0) AS 赔案数,
  COALESCE(ca.big_cnt, 0) AS 大案数,
  ROUND(COALESCE(ca.total_loss, 0)/1e4, 1) AS 已报告赔款_万,
  ROUND(SUM(b.fee)/1e4, 1) AS 费用金额_万,
  ROUND(COALESCE(ca.total_loss, 0) * 100.0 / NULLIF(SUM(b.earned_premium), 0), 1) AS 满期赔付率_pct,
  ROUND(SUM(b.fee) * 100.0 / NULLIF(SUM(b.premium), 0), 1) AS 费用率_pct,
  ROUND(
    COALESCE(ca.total_loss, 0) * 100.0 / NULLIF(SUM(b.earned_premium), 0)
    + SUM(b.fee) * 100.0 / NULLIF(SUM(b.premium), 0),
    1
  ) AS 变动成本率_pct
FROM b_earn b
LEFT JOIN claims_agg ca USING(org)
GROUP BY b.org, ca.claim_cnt, ca.big_cnt, ca.total_loss
ORDER BY 签单保费_万 DESC NULLS LAST
""".strip()


DRILL_REGISTRY = {
    "org_level_3": ("机构画像（满期赔付率+费用率+变动成本率）",
                    lambda w, v: drill_org_sql(w, v)),
    "vehicle_model": ("厂牌车型（件数 ≥20 Top15）",
                      lambda w, v: build_vehicle_model_drill_sql(POLICY, CLAIMS, w, v)),
    "accident_province": ("出险地点 Top20（省/市）",
                          lambda w, v: drill_location_sql(w, v)),
    "accident_month": ("事故月份趋势", lambda w, v: drill_month_sql(w, v)),
    "accident_hour": ("事故时段分布（一天 24 小时四分段）", lambda w, v: drill_hour_sql(w, v)),
    "accident_cause": ("事故原因 Top15（按赔款金额）", lambda w, v: drill_cause_sql(w, v)),
    "loss_category": ("损失类别分布", lambda w, v: drill_loss_category_sql(w, v)),
    "large_cases": ("Top10 大案（已决/未决拆分，阈值 20 万）",
                    lambda w, v: drill_large_cases_sql(w, v)),
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


# ────────── 交互问卷 ──────────

def _ask_single(prompt: str, options: list) -> "int | None":
    """单选。返回 0-based 索引，回车返回 None（视作默认/全部）。"""
    while True:
        raw = input(f"▶ [1-{len(options)}, 回车跳过]: ").strip()
        if not raw:
            return None
        try:
            idx = int(raw)
            if 1 <= idx <= len(options):
                return idx - 1
            print(f"  请输入 1~{len(options)} 之间的数字")
        except ValueError:
            print("  请输入数字")


def _ask_multi(prompt: str, options: list) -> list:
    """多选。返回 0-based 索引列表，回车返回 []（视作全部/默认）。"""
    while True:
        raw = input(f"▶ [逗号分隔编号, 回车=全部]: ").strip()
        if not raw:
            return []
        try:
            indices = [int(x.strip()) - 1 for x in raw.split(",") if x.strip()]
            if all(0 <= i < len(options) for i in indices):
                return indices
            print(f"  编号需在 1~{len(options)} 范围内")
        except ValueError:
            print("  格式错误（如 1,3,5）")


def run_interactive_mode(valuation_date: str):
    """
    引导式问卷：读 segment-questionnaire.json → 提问 → 返回 (start, end, where_clause, slug, drills)
    """
    from datetime import date as _date_cls
    today = _date_cls.today().isoformat()

    if not QUESTIONNAIRE.exists():
        print(f"[ERROR] 问卷文件不存在：{QUESTIONNAIRE}", file=sys.stderr)
        sys.exit(1)

    qdata = json.loads(QUESTIONNAIRE.read_text(encoding="utf-8"))
    questions_def = qdata["questions"]
    batches = qdata["batches"]
    dictionary = load_dictionary()

    start = end = None
    keywords: list = []
    raw_where_parts: list = []
    drills: list = DEFAULT_DRILLS.copy()
    slug_parts: list = []

    def _apply(opt: dict) -> None:
        kw = opt.get("keyword")
        where_raw = opt.get("where")
        tb = opt.get("triggers_batch")
        if kw:
            keywords.append(kw)
            slug_parts.append(opt["label"])
        elif where_raw:
            raw_where_parts.append(f"({where_raw})")
            slug_parts.append(opt["label"].split("（")[0].strip())
        if tb:
            slug_parts.append(opt["label"])  # needed for batch condition check

    for batch in batches:
        cond = batch.get("condition")
        if cond:
            needed = cond.get("contains_any", [])
            if not any(n in slug_parts for n in needed):
                continue

        print(f"\n{'━'*54}")
        print(f"  {batch['title']}")
        print(f"{'━'*54}")

        for qid in batch["questions"]:
            qdef = questions_def.get(qid)
            if not qdef:
                continue
            qtype = qdef["type"]
            opts = qdef.get("options", [])

            print(f"\n  【{qdef['prompt']}】")
            for i, opt in enumerate(opts, 1):
                note = f"  ← {opt['note']}" if opt.get("note") else ""
                print(f"    {i}. {opt['label']}{note}")

            if qid == "time_range":
                raw = input("▶ [1-4, 回车=近15个月]: ").strip()
                idx = None
                if raw:
                    try:
                        v = int(raw) - 1
                        if 0 <= v < len(opts):
                            idx = v
                    except ValueError:
                        pass
                if idx is None:
                    start, end = "2025-01-01", today
                    slug_parts.append("近15个月")
                elif opts[idx]["value"] == "custom":
                    custom = input("  输入日期范围（YYYY-MM-DD ~ YYYY-MM-DD）: ").strip()
                    ps = [p.strip() for p in custom.split("~")]
                    start = ps[0]
                    end = ps[1] if len(ps) >= 2 else today
                    slug_parts.append(f"{start}至{end}")
                else:
                    val = opts[idx]["value"]
                    start = val["start"]
                    end = val["end"].replace("__today__", today)
                    slug_parts.append(opts[idx]["label"].split("（")[0].strip())

            elif qtype in ("single_choice", "single_choice_or_custom"):
                chosen = _ask_single(qdef["prompt"], opts)
                if chosen is not None and opts[chosen].get("value") != "all":
                    _apply(opts[chosen])

            elif qtype == "multi_select":
                chosen_list = _ask_multi(qdef["prompt"], opts)
                for i in chosen_list:
                    _apply(opts[i])

            elif qtype == "checklist":
                chosen_list = _ask_multi(qdef["prompt"], opts)
                if qid == "drill_dims" and chosen_list:
                    drills = [opts[i]["value"] for i in chosen_list]

    # 组装 WHERE
    where_parts: list = []
    if keywords:
        kw_where, unresolved = resolve_keywords(keywords, dictionary)
        if unresolved:
            print(f"[ERROR] 关键词不在词典：{unresolved}", file=sys.stderr)
            sys.exit(1)
        if kw_where:
            where_parts.append(kw_where)
    where_parts.extend(raw_where_parts)

    where_clause = " AND ".join(where_parts) if where_parts else "1=1"
    # 去掉 slug 里来自 triggers_batch 的重复项（营业货车在 slug_parts 出现两次）
    seen: set = set()
    deduped = []
    for p in slug_parts:
        if p not in seen:
            seen.add(p)
            deduped.append(p)
    slug = "_".join(deduped) if deduped else "全段诊断"

    if start is None:
        start, end = "2025-01-01", today

    print(f"\n{'━'*54}")
    print(f"  ✅ 参数确认")
    print(f"{'━'*54}")
    print(f"  时间:  {start} ~ {end}")
    print(f"  WHERE: {where_clause}")
    print(f"  slug:  {slug}")
    print(f"  下钻:  {', '.join(drills)}")
    confirm = input("\n▶ 确认执行？[Y/n]: ").strip().lower()
    if confirm == "n":
        print("[ABORT] 用户取消")
        sys.exit(0)

    return start, end, where_clause, slug, drills


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


def _light_variable_cost(rate) -> str:
    """变动成本率亮灯：≤91% 🟢 / 91-94% 🟡 / >94% 🔴（来自 metric registry combined cost 阈值）"""
    if rate is None:
        return ""
    try:
        r = float(rate)
    except (TypeError, ValueError):
        return ""
    if r <= 91:
        return "🟢"
    if r <= 94:
        return "🟡"
    return "🔴"


def build_exec_summary_md(cohort_cols, cohort_rows, main_cols, main_rows,
                          org_cols, org_rows) -> str:
    """生成管理层摘要（业务规模 / 盈亏现状 / 风险机构 TOP3）。"""
    lines = ["## 0. 管理层摘要（执行层 5 分钟版）\n"]

    # —— 业务规模 ——
    if cohort_rows:
        c0 = dict(zip(cohort_cols, cohort_rows[0]))
        pol_cnt = c0.get("保单数", "—")
        premium = c0.get("保费_万", "—")
        lines.append(f"- **业务规模**：{pol_cnt:,} 单 / {premium} 万保费\n")

    # —— 盈亏现状（满期桩，变动成本率亮灯）——
    if main_rows and main_cols:
        eol = main_rows[-1]  # 满期桩
        row = dict(zip(main_cols, eol))
        lr = row.get("满期赔付率_pct")
        er = row.get("费用率_pct")
        vc = row.get("变动成本率_pct")
        if vc is not None:
            lines.append(
                f"- **盈亏现状（满期桩）**：满期赔付率 **{lr}%** + 费用率 **{er}%** = "
                f"**变动成本率 {vc}%** {_light_variable_cost(vc)}\n"
            )

    # —— 风险机构 TOP3（仅当 org_level_3 下钻存在）——
    if org_rows and org_cols:
        try:
            org_i = org_cols.index("机构")
            vc_i = org_cols.index("变动成本率_pct")
            pol_i = org_cols.index("保单数")
        except ValueError:
            org_i = vc_i = pol_i = None
        if vc_i is not None:
            qualified = [r for r in org_rows
                         if r[vc_i] is not None and (r[pol_i] or 0) >= 20]
            top3 = sorted(qualified, key=lambda r: r[vc_i], reverse=True)[:3]
            if top3:
                parts = [
                    f"{r[org_i]} {r[vc_i]:.1f}% {_light_variable_cost(r[vc_i])}"
                    for r in top3
                ]
                lines.append(
                    f"- **风险机构 TOP3（按变动成本率，保单 ≥20）**：{' / '.join(parts)}\n"
                )

    lines.append("> 亮灯：变动成本率 ≤91% 🟢 ｜ 91-94% 🟡 ｜ >94% 🔴\n")
    return "\n".join(lines)


def build_report(args, where_clause: str, resolved_from_keywords: bool) -> Path:
    con = duckdb.connect()
    valuation_date = f"DATE '{args.valuation_date}'"
    today = date.today().strftime("%Y-%m-%d")

    parts = [f"# 诊断报告｜{args.slug}\n"]
    parts.append(f"> **筛选**：`insurance_start_date ∈ [{args.start}, {args.end}]`")
    parts.append(f">\n> **WHERE**：`{where_clause}`")
    if resolved_from_keywords:
        parts.append(f">\n> **来源**：词典关键词 `{args.keywords}`")
    parts.append(f">\n> **估值日**:{args.valuation_date}  **报告生成**：{today}")
    parts.append(f">\n> **数据源**：`policy/current/*.parquet` + `claims_detail/claims_*.parquet`")
    parts.append(f">\n> **赔案锚定**：`accident_time`；**赔款**：已决 `settled_amount` + 未结 `reserve_amount`\n")

    # 把时间范围也拼进 WHERE
    full_where = (f"insurance_start_date BETWEEN DATE '{args.start}' AND DATE '{args.end}'"
                  f" AND ({where_clause})")

    print("[1/3] Cohort 概览...")
    c0, r0 = q(con, build_cohort_summary_sql(POLICY, full_where, args.start, args.end))

    print("[2/3] 主表四桩...")
    c1, r1 = q(con, build_main_table_sql(POLICY, CLAIMS, full_where, valuation_date))

    # 先跑 org_level_3 下钻（如果在用户的 drill 列表里），其结果用于管理层摘要
    drill_results: dict[str, tuple] = {}
    print(f"[3/3] 下钻 {len(args.drill)} 个维度...")
    for idx, drill_name in enumerate(args.drill, 1):
        if drill_name not in DRILL_REGISTRY:
            print(f"  [WARN] 未知下钻维度：{drill_name}，跳过")
            continue
        title, sql_fn = DRILL_REGISTRY[drill_name]
        print(f"  ({idx}) {drill_name} — {title}")
        cols, rows = q(con, sql_fn(full_where, valuation_date))
        drill_results[drill_name] = (title, cols, rows)

    # 管理层摘要（仅当 --exec-summary 时输出，放在最前）
    if getattr(args, "exec_summary", False):
        org_cols, org_rows = (None, None)
        if "org_level_3" in drill_results:
            _, org_cols, org_rows = drill_results["org_level_3"]
        parts.append(build_exec_summary_md(c0, r0, c1, r1, org_cols, org_rows))

    parts.append("## 1. Cohort 概览\n")
    parts.append(md_table(c0, r0))

    parts.append("\n## 2. 主表：保单年龄发展口径四桩\n")
    parts.append(md_table(c1, r1))
    parts.append("\n> 四桩 cohort 独立不等大（递减），**不是同一批车随时间递增成熟**。")
    parts.append("> 每桩 eligible = 该桩所需发展天数已过估值日的保单。满期=保单止期已过估值日。")
    parts.append("> 已赚保费 = 保费 × min(N, policy_term)/policy_term；已赚暴露 = min(N, policy_term)/365（年化）。")
    parts.append("> 变动成本率 = 满期赔付率（÷满期保费）+ 费用率（÷签单保费）；亮灯：≤91% 🟢 ｜ 91-94% 🟡 ｜ >94% 🔴。\n")

    section_idx = 2
    for drill_name in args.drill:
        if drill_name not in drill_results:
            continue
        title, cols, rows = drill_results[drill_name]
        section_idx += 1
        parts.append(f"\n## {section_idx}. 下钻：{title}\n")
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
    parser.add_argument("--start", default=None, help="起保日期下限（YYYY-MM-DD）；交互模式下由问卷填写，可省略")
    parser.add_argument("--end", default=None, help="起保日期上限（YYYY-MM-DD）；交互模式下由问卷填写，可省略")
    parser.add_argument("--where", help="SQL WHERE 子句（不含 insurance_start_date 范围）")
    parser.add_argument("--keywords", help="词典关键词，逗号分隔（如 '天然气,新车,牵引车,10吨以上'）")
    parser.add_argument("--slug", help="报告 slug（文件名前缀），未指定则用 keywords 拼接")
    parser.add_argument("--drill", default=",".join(DEFAULT_DRILLS),
                        help=f"下钻维度，逗号分隔。可选：{','.join(DRILL_REGISTRY.keys())}")
    parser.add_argument("--valuation-date", default="2026-04-21", help="估值日")
    parser.add_argument("--preset", default=None,
                        help="预设组合（来自 segment-dictionary.json:presets），自动注入 keywords/drill/start/end/slug")
    parser.add_argument("--exec-summary", dest="exec_summary", action="store_true",
                        help="报告头部追加管理层摘要（业务规模/盈亏亮灯/风险机构 TOP3）")
    parser.add_argument("--dry-run", action="store_true", help="只解析参数，不实际跑查询")
    parser.add_argument("--interactive", action="store_true",
                        help="交互式问卷模式：逐批提问构建筛选条件（当 --where/--keywords 均未指定时自动触发）")
    args = parser.parse_args()

    # —— preset 解析：从词典 presets 注入默认值（仅填充未显式指定的项）——
    if args.preset:
        dictionary = load_dictionary()
        presets = dictionary.get("presets", {})
        valid_presets = [k for k, v in presets.items() if isinstance(v, dict)]
        if args.preset not in presets or not isinstance(presets[args.preset], dict):
            print(f"[ERROR] 未知 preset：{args.preset}（可用：{valid_presets}）", file=sys.stderr)
            sys.exit(1)
        preset = presets[args.preset]
        if not args.keywords and not args.where:
            args.keywords = ",".join(preset.get("keywords", []))
        if args.drill == ",".join(DEFAULT_DRILLS) and preset.get("default_drills"):
            args.drill = ",".join(preset["default_drills"])
        if not args.start and preset.get("default_start"):
            args.start = preset["default_start"]
        if not args.end and preset.get("default_end"):
            args.end = preset["default_end"]
        if not args.slug:
            args.slug = args.preset
        if not args.exec_summary and preset.get("default_exec_summary"):
            args.exec_summary = True

    # --interactive 自动触发：需求模糊时（无 --where 且无 --keywords）
    if not args.where and not args.keywords:
        args.interactive = True

    if args.interactive:
        start, end, where_clause, slug, drill = run_interactive_mode(args.valuation_date)
        args.start = start
        args.end = end
        args.slug = slug
        args.drill = drill

        print(f"\n=== 诊断参数（问卷填充）===")
        print(f"  slug: {args.slug}")
        print(f"  时间: {args.start} ~ {args.end}")
        print(f"  WHERE: {where_clause}")
        print(f"  下钻: {args.drill}")
        print(f"  估值日: {args.valuation_date}")

        if args.dry_run:
            print("[DRY-RUN] 参数校验通过，未执行查询")
            return

        out_path = build_report(args, where_clause, False)
        print(f"\n[OK] 报告已落盘：{out_path}")
        print(f"     字符数 {len(out_path.read_text(encoding='utf-8')):,}")
        return

    args.drill = [d.strip() for d in args.drill.split(",") if d.strip()]

    if not args.start or not args.end:
        parser.error("非交互模式下 --start 和 --end 为必填参数")

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
