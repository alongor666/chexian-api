#!/usr/bin/env python3
"""
天然气新车牵引车10吨以上 经营诊断

筛选口径：
  insurance_start_date BETWEEN 2025-01-01 AND 2026-04-20
  AND is_new_car = TRUE
  AND tonnage_segment = '10吨以上'
  AND vehicle_model LIKE '%牵引%'
  AND fuel_type = '天然气(NG/CNG/LNG)'

产出：
  - 主表：90/180/270/满期 四桩发展指标
  - 下钻：厂牌车型 / 出险地点 / 时间段 / 出险经过
  - Markdown 报告落到 数据管理/数据分析报告/

用法： python3 数据管理/pipelines/diagnose_lng_tractor.py
"""
from datetime import date
from pathlib import Path
import duckdb

try:  # 数据管理 在 sys.path
    from pipelines.branch_paths import policy_current_glob
except ImportError:  # pipelines 目录在 sys.path（直跑脚本惯例）
    from branch_paths import policy_current_glob

REPO = Path(__file__).resolve().parent.parent.parent
# 双布局自适应（branch_paths SSOT）。注意：本脚本历史即为裸全量读（未按省过滤），
# 布局适配保持行为等价；混省口径问题另行治理（memory fact-current-mixes-sc-sx-bare-glob）。
_POLICY_GLOB = policy_current_glob(
    REPO / "数据管理/warehouse/fact/policy/current", missing_ok=True
)
POLICY = f"read_parquet('{_POLICY_GLOB}', union_by_name := true)"
CLAIMS = f"read_parquet('{REPO}/数据管理/warehouse/fact/claims_detail/claims_*.parquet', union_by_name := true)"
OUTDIR = REPO / "数据管理/数据分析报告"
VALUATION = "DATE '2026-04-21'"

BASE = """
  insurance_start_date BETWEEN DATE '2025-01-01' AND DATE '2026-04-20'
  AND is_new_car = TRUE
  AND tonnage_segment = '10吨以上'
  AND vehicle_model LIKE '%牵引%'
  AND fuel_type = '天然气(NG/CNG/LNG)'
"""


def q(con, sql):
    rows = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    return cols, rows


def md_table(cols, rows, aligns=None):
    if aligns is None:
        aligns = [":---"] * len(cols)
    out = ["| " + " | ".join(cols) + " |", "|" + "|".join(aligns) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if v is None else str(v) for v in r) + " |")
    return "\n".join(out)


def fmt_num(v, decimals=0):
    if v is None:
        return ""
    if decimals == 0:
        return f"{v:,.0f}"
    return f"{v:,.{decimals}f}"


def build_main_table(con):
    sql = f"""
    WITH base AS (
      SELECT policy_no,
        MIN(insurance_start_date) AS start_date,
        MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) AS term_days,
        SUM(premium) AS premium
      FROM {POLICY} WHERE {BASE}
      GROUP BY policy_no
      HAVING SUM(premium) > 0
         AND MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) > 0
    ),
    stages AS (
      SELECT * FROM (VALUES
        ('90天', 90, 1), ('180天', 180, 2), ('270天', 270, 3), ('满期', NULL, 4)
      ) AS t(stage, days_param, ord)
    ),
    policy_stage AS (
      SELECT s.stage, s.ord, s.days_param, b.policy_no, b.start_date, b.term_days, b.premium,
        CASE WHEN s.days_param IS NULL THEN b.start_date + b.term_days * INTERVAL 1 DAY
             ELSE b.start_date + LEAST(s.days_param, b.term_days) * INTERVAL 1 DAY END AS window_end,
        CASE WHEN s.days_param IS NULL THEN b.start_date + b.term_days * INTERVAL 1 DAY <= {VALUATION}
             ELSE b.start_date + s.days_param * INTERVAL 1 DAY <= {VALUATION} END AS eligible,
        CASE WHEN s.days_param IS NULL THEN b.term_days / 365.0
             ELSE LEAST(s.days_param, b.term_days) / 365.0 END AS earned_exposure,
        CASE WHEN s.days_param IS NULL THEN b.premium
             ELSE b.premium * LEAST(s.days_param, b.term_days)::DOUBLE / b.term_days END AS earned_premium
      FROM base b CROSS JOIN stages s
    ),
    eligible_policies AS (SELECT * FROM policy_stage WHERE eligible = TRUE),
    claims_agg AS (
      SELECT ep.stage, ep.ord,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        SUM(CASE WHEN c.settlement_time IS NOT NULL AND c.settlement_time <= {VALUATION}
                 THEN COALESCE(c.settled_amount, 0) ELSE COALESCE(c.reserve_amount, 0) END) AS total_loss
      FROM eligible_policies ep
      LEFT JOIN {CLAIMS} c
        ON c.policy_no = ep.policy_no
       AND c.accident_time >= ep.start_date
       AND c.accident_time <  ep.window_end
       AND c.accident_time <= {VALUATION}
      GROUP BY ep.stage, ep.ord
    )
    SELECT ep.ord, ep.stage,
      COUNT(DISTINCT ep.policy_no) AS 件数,
      ROUND(SUM(ep.premium)/1e4, 2) AS 保费_万,
      ROUND(SUM(ep.earned_premium)/1e4, 2) AS 已赚保费_万,
      ROUND(SUM(ep.earned_exposure), 2) AS 已赚暴露,
      COALESCE(ca.claim_count, 0) AS 赔案数,
      ROUND(COALESCE(ca.total_loss, 0)/1e4, 2) AS 已报告赔款_万,
      ROUND(COALESCE(ca.total_loss, 0) / NULLIF(ca.claim_count, 0), 0) AS 案均赔款_元,
      ROUND(COALESCE(ca.claim_count, 0) * 100.0 / NULLIF(SUM(ep.earned_exposure), 0), 2) AS 满期出险率_pct,
      ROUND(COALESCE(ca.total_loss, 0) * 100.0 / NULLIF(SUM(ep.earned_premium), 0), 2) AS 满期赔付率_pct
    FROM eligible_policies ep
    LEFT JOIN claims_agg ca USING(ord, stage)
    GROUP BY ep.ord, ep.stage, ca.claim_count, ca.total_loss
    ORDER BY ep.ord
    """
    return q(con, sql)


def build_cohort_summary(con):
    sql = f"""
    WITH base AS (
      SELECT policy_no, MIN(insurance_start_date) AS sd,
        MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) AS td,
        SUM(premium) AS prem
      FROM {POLICY} WHERE {BASE} GROUP BY policy_no
      HAVING SUM(premium) > 0 AND MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) > 0
    )
    SELECT COUNT(*) AS 保单数, ROUND(SUM(prem)/1e4, 2) AS 保费_万,
      MIN(sd)::DATE AS 最早起期, MAX(sd)::DATE AS 最晚起期,
      SUM(CASE WHEN sd < DATE '2026-01-01' THEN 1 ELSE 0 END) AS 起保2025,
      SUM(CASE WHEN sd >= DATE '2026-01-01' THEN 1 ELSE 0 END) AS 起保2026
    FROM base
    """
    return q(con, sql)


def build_vehicle_model_drill(con):
    """按厂牌车型分组，计算整体累计赔付率（到估值日）"""
    sql = f"""
    WITH base AS (
      SELECT policy_no, MIN(vehicle_model) AS model,
        MIN(insurance_start_date) AS start_date,
        MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) AS term_days,
        SUM(premium) AS premium
      FROM {POLICY} WHERE {BASE} GROUP BY policy_no
      HAVING SUM(premium) > 0 AND MAX(DATE_DIFF('day', insurance_start_date, insurance_end_date)) > 0
    ),
    with_earned AS (
      SELECT *,
        LEAST(DATE_DIFF('day', start_date, {VALUATION}), term_days) AS observed_days
      FROM base
    ),
    claims AS (
      SELECT b.policy_no,
        COUNT(DISTINCT c.claim_no) AS claim_count,
        SUM(CASE WHEN c.settlement_time IS NOT NULL AND c.settlement_time <= {VALUATION}
                 THEN COALESCE(c.settled_amount, 0) ELSE COALESCE(c.reserve_amount, 0) END) AS loss
      FROM with_earned b
      LEFT JOIN {CLAIMS} c
        ON c.policy_no = b.policy_no
       AND c.accident_time >= b.start_date
       AND c.accident_time <= {VALUATION}
      GROUP BY b.policy_no
    )
    SELECT b.model AS 厂牌车型,
      COUNT(DISTINCT b.policy_no) AS 件数,
      ROUND(SUM(b.premium)/1e4, 1) AS 保费_万,
      ROUND(SUM(b.premium * b.observed_days::DOUBLE / b.term_days)/1e4, 1) AS 已赚保费_万,
      COALESCE(SUM(cl.claim_count), 0) AS 赔案数,
      ROUND(COALESCE(SUM(cl.loss), 0)/1e4, 1) AS 已报告赔款_万,
      ROUND(COALESCE(SUM(cl.loss), 0) / NULLIF(SUM(cl.claim_count), 0), 0) AS 案均_元,
      ROUND(COALESCE(SUM(cl.loss), 0) * 100.0 / NULLIF(SUM(b.premium * b.observed_days::DOUBLE / b.term_days), 0), 1) AS 满期赔付率_pct,
      ROUND(COALESCE(SUM(cl.claim_count), 0) * 100.0
            / NULLIF(SUM(b.observed_days::DOUBLE / 365), 0), 1) AS 满期出险率_pct
    FROM with_earned b
    LEFT JOIN claims cl USING(policy_no)
    GROUP BY b.model
    HAVING COUNT(DISTINCT b.policy_no) >= 20
    ORDER BY 件数 DESC
    LIMIT 15
    """
    return q(con, sql)


def build_location_drill(con):
    """按事故省/市下钻"""
    sql = f"""
    WITH policy_cohort AS (
      SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE}
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
    FROM {CLAIMS} c
    INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
    WHERE c.accident_time <= {VALUATION}
    GROUP BY c.accident_province, c.accident_city
    ORDER BY 赔款_万 DESC NULLS LAST
    LIMIT 20
    """
    return q(con, sql)


def build_time_drill(con):
    """按事故月份 + 事故时段（hour of day）"""
    # 月度
    sql_month = f"""
    WITH policy_cohort AS (SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE})
    SELECT
      STRFTIME(c.accident_time, '%Y-%m') AS 事故月,
      COUNT(DISTINCT c.claim_no) AS 赔案数,
      ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
      ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END)
            / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元
    FROM {CLAIMS} c INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
    WHERE c.accident_time <= {VALUATION}
    GROUP BY 事故月 ORDER BY 事故月
    """
    # 时段（0-6 凌晨 / 6-12 上午 / 12-18 下午 / 18-24 晚间）
    sql_hour = f"""
    WITH policy_cohort AS (SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE}),
    claims_cohort AS (
      SELECT c.*, EXTRACT(HOUR FROM c.accident_time) AS hr
      FROM {CLAIMS} c INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
      WHERE c.accident_time <= {VALUATION}
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
    FROM claims_cohort GROUP BY 时段 ORDER BY 时段
    """
    return q(con, sql_month), q(con, sql_hour)


def build_cause_drill(con):
    """按事故原因 + 损失类别"""
    sql_cause = f"""
    WITH policy_cohort AS (SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE})
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
    FROM {CLAIMS} c INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
    WHERE c.accident_time <= {VALUATION}
    GROUP BY c.accident_cause
    ORDER BY 赔款_万 DESC NULLS LAST LIMIT 15
    """
    sql_cat = f"""
    WITH policy_cohort AS (SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE})
    SELECT
      COALESCE(c.loss_category, '<空>') AS 损失类别,
      COUNT(DISTINCT c.claim_no) AS 赔案数,
      ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
      ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END)
            / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元
    FROM {CLAIMS} c INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
    WHERE c.accident_time <= {VALUATION}
    GROUP BY c.loss_category
    ORDER BY 赔款_万 DESC NULLS LAST
    """
    # 高频描述（案件描述文本的 top 短语）
    sql_desc = f"""
    WITH policy_cohort AS (SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE})
    SELECT
      COALESCE(c.accident_description, '<空>') AS 事故描述,
      COUNT(DISTINCT c.claim_no) AS 赔案数,
      ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
      ROUND(SUM(CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                     ELSE COALESCE(c.reserve_amount, 0) END)
            / NULLIF(COUNT(DISTINCT c.claim_no), 0), 0) AS 案均_元
    FROM {CLAIMS} c INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
    WHERE c.accident_time <= {VALUATION}
    GROUP BY c.accident_description
    ORDER BY 赔款_万 DESC NULLS LAST LIMIT 12
    """
    return q(con, sql_cause), q(con, sql_cat), q(con, sql_desc)


def build_large_cases(con):
    """Top10 大案"""
    sql = f"""
    WITH policy_cohort AS (SELECT DISTINCT policy_no FROM {POLICY} WHERE {BASE})
    SELECT
      c.claim_no AS 赔案号,
      c.accident_time::DATE AS 事故日期,
      COALESCE(c.accident_province, '') || '/' || COALESCE(c.accident_city, '') AS 地点,
      COALESCE(c.accident_cause, '—') AS 原因,
      COALESCE(c.loss_category, '—') AS 类别,
      ROUND((CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                  ELSE COALESCE(c.reserve_amount, 0) END)/1e4, 1) AS 赔款_万,
      CASE WHEN c.settlement_time IS NOT NULL THEN '已结' ELSE '未决' END AS 状态
    FROM {CLAIMS} c INNER JOIN policy_cohort p ON c.policy_no = p.policy_no
    WHERE c.accident_time <= {VALUATION}
    ORDER BY (CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0)
                   ELSE COALESCE(c.reserve_amount, 0) END) DESC NULLS LAST
    LIMIT 10
    """
    return q(con, sql)


def main():
    con = duckdb.connect()

    print("[1/7] Cohort 概览...")
    cols0, rows0 = build_cohort_summary(con)

    print("[2/7] 主表（四桩发展）...")
    cols1, rows1 = build_main_table(con)

    print("[3/7] 下钻厂牌车型...")
    cols2, rows2 = build_vehicle_model_drill(con)

    print("[4/7] 下钻出险地点...")
    cols3, rows3 = build_location_drill(con)

    print("[5/7] 下钻时间段...")
    (cols4m, rows4m), (cols4h, rows4h) = build_time_drill(con)

    print("[6/7] 下钻出险经过...")
    (cols5, rows5), (cols6, rows6), (cols7, rows7) = build_cause_drill(con)

    print("[7/7] Top10 大案...")
    cols8, rows8 = build_large_cases(con)

    # 组装 Markdown
    today = date.today().strftime("%Y-%m-%d")
    parts = []
    parts.append(f"# 诊断报告｜2025-2026 天然气新车牵引车 10 吨以上 经营分析\n")
    parts.append(f"> **筛选**：`insurance_start_date ∈ [2025-01-01, 2026-04-20]` ∩ `is_new_car=TRUE` ∩ `tonnage_segment='10吨以上'` ∩ `vehicle_model LIKE '%牵引%'` ∩ `fuel_type='天然气(NG/CNG/LNG)'`")
    parts.append(f"> **估值日**：2026-04-21  **报告生成**：{today}")
    parts.append(f"> **数据源**：`policy/current/*.parquet` + `claims_detail/claims_*.parquet`")
    parts.append(f"> **赔案锚定**：`accident_time`；**赔款口径**：已决=`settled_amount`，未结案=`reserve_amount`\n")

    parts.append("## 0. Cohort 概览\n")
    parts.append(md_table(cols0, rows0))

    parts.append("\n## 1. 主表：保单年龄发展口径四桩\n")
    parts.append(md_table(cols1, rows1))
    parts.append("\n> 说明：四桩 cohort 独立不等大（递减），**不是同一批车随时间递增成熟**。")
    parts.append("> 每桩 eligible = 该桩所需发展天数已过估值日的保单。满期=保单止期已过估值日。")
    parts.append("> 已赚保费 = 保费 × min(N, policy_term)/policy_term；已赚暴露 = min(N, policy_term)/365（年化）。\n")

    parts.append("\n## 2. 下钻：厂牌车型（件数 ≥20 且按件数降序 Top15）\n")
    parts.append(md_table(cols2, rows2))
    parts.append("\n> 赔付率/出险率按**累计口径**：每单 observed_days = min(距估值日天数, policy_term)，赔案取 accident_time ≤ 估值日全部。\n")

    parts.append("\n## 3. 下钻：出险地点 Top20（省/市）\n")
    parts.append(md_table(cols3, rows3))

    parts.append("\n## 4. 下钻：时间段\n")
    parts.append("### 4.1 事故月份趋势\n")
    parts.append(md_table(cols4m, rows4m))
    parts.append("\n### 4.2 事故时段分布（一天 24 小时四分段）\n")
    parts.append(md_table(cols4h, rows4h))

    parts.append("\n## 5. 下钻：出险经过\n")
    parts.append("### 5.1 事故原因 Top15（按赔款金额）\n")
    parts.append(md_table(cols5, rows5))
    parts.append("\n### 5.2 损失类别分布\n")
    parts.append(md_table(cols6, rows6))
    parts.append("\n### 5.3 事故描述 Top12（按赔款金额）\n")
    parts.append(md_table(cols7, rows7))

    parts.append("\n## 6. Top10 大案\n")
    parts.append(md_table(cols8, rows8))

    parts.append("\n## 附：关键口径说明\n")
    parts.append("""
- **件数**：保单级去重（policy_no distinct），按 SUM(premium)>0 HAVING 剔除纯退保单。
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
    out_path = OUTDIR / f"天然气新车牵引车10吨+_经营诊断_{today.replace('-', '')}.md"
    out_path.write_text("\n".join(parts), encoding="utf-8")

    print()
    print(f"[OK] 报告已落盘：{out_path}")
    print(f"     行数约 {sum(len(p.splitlines()) for p in parts)} 行  |  字符数 {sum(len(p) for p in parts):,}")

    # 也打印主表到控制台
    print()
    print("=" * 100)
    print("主表（四桩发展指标）")
    print("=" * 100)
    print("| " + " | ".join(cols1) + " |")
    print("|" + "|".join(["---"] * len(cols1)) + "|")
    for r in rows1:
        print("| " + " | ".join("" if v is None else str(v) for v in r) + " |")


if __name__ == "__main__":
    main()
