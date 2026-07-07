"""
非营业个人客车 · 年轻驾驶人（年龄＜24岁 / 24岁≤年龄＜28岁）多维经营分析

按用户需求：
  - 时间：2021-2026 每年 + 累计 共 7 个时间块
  - 维度（独立切片，5 张维度组）：
      1) 险类 insurance_type           （交强险 / 商业保险）
      2) 新旧车 is_new_car             （新车 / 旧车）
      3) 是否新能源 is_nev             （新能源 / 燃油）
      4) 险别组合 coverage_combination （单交 / 交三 / 主全 / 其他）
      5) 车牌归属地 plate_prefix       （川A/川B/…，Top15 + 其他）
  - 指标：件数 / 保费(万) / 满期赔付率(%) / 满期出险率(%) /
          费用率(%) / 变动成本率(%) / 商车自主系数（交强险不填）
  - 估值日：今天

口径与项目 metric registry 一致：
  - 保单级 SUM(premium) 去重批改，HAVING SUM(premium)>0
  - earned_premium = premium * earned_days / policy_term （闰年感知）
  - earned_exposure = earned_days / 365
  - 赔款 = SUM(settled_amount + reserve_amount)；案数 = COUNT(DISTINCT claim_no)
  - 满期赔付率 = 赔款 / earned_premium
  - 满期出险率 = 赔案数 / earned_exposure （年化 %）
  - 费用率 = fee_amount / premium
  - 变动成本率 = 满期赔付率 + 费用率
  - 商车自主系数 = SUM(commercial_pricing_factor * premium) / SUM(premium) （仅商业保险）
"""

from __future__ import annotations
import datetime as dt
from collections import defaultdict
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[2]
_DM = ROOT / "数据管理"
if str(_DM) not in sys.path:
    sys.path.insert(0, str(_DM))  # 供 import pipelines.*（branch_paths SSOT · 801409 cutover 前置）
from pipelines.branch_paths import policy_current_glob  # noqa: E402
# 双布局自适应（branch_paths SSOT）：跨省全量读（一次性复盘脚本，行为等价）
POLICY_GLOB = policy_current_glob(ROOT / "数据管理/warehouse/fact/policy/current", missing_ok=True)
CLAIMS_GLOB = str(ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")
REPORT_DIR = ROOT / "数据管理/数据分析报告"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

VALUATION = dt.date.today().isoformat()
YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
TIME_COLS = [str(y) for y in YEARS] + ["累计"]

AGE_GROUPS = ["年龄＜24岁", "24岁≤年龄＜28岁"]
AGE_LABEL = {"年龄＜24岁": "<24岁", "24岁≤年龄＜28岁": "24-28岁"}

PLATE_TO_CITY = {
    "川A": "成都", "川B": "绵阳", "川C": "自贡", "川D": "攀枝花",
    "川E": "泸州", "川F": "德阳", "川G": "内江", "川H": "乐山",
    "川J": "资阳", "川K": "宜宾", "川L": "南充", "川M": "达州",
    "川Q": "成都(川Q)", "川R": "巴中", "川S": "雅安", "川T": "眉山",
    "川U": "广安", "川V": "凉山", "川W": "广元", "川X": "遂宁",
    "川Y": "阿坝", "川Z": "甘孜",
}

con = duckdb.connect(":memory:")
con.execute(f"CREATE VIEW policy AS SELECT * FROM read_parquet('{POLICY_GLOB}', union_by_name=true)")
con.execute(f"CREATE VIEW claims AS SELECT * FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true)")


# ============================================================
# 拉数据：保单级去重 + 关联赔案聚合
# ============================================================

CORE_SQL = f"""
WITH base AS (
  SELECT
    policy_no,
    insurance_type,
    coverage_combination,
    driver_age_group              AS age_grp,
    is_new_car,
    is_nev,
    SUBSTR(plate_no, 1, 2)        AS plate_prefix,
    plate_no,
    YEAR(MIN(insurance_start_date)) AS start_year,
    MIN(insurance_start_date)     AS start_date,
    SUM(premium)                  AS premium,
    SUM(fee_amount)               AS fee_amount,
    COALESCE(
      MAX(CASE WHEN premium > 0 THEN commercial_pricing_factor END),
      MAX(commercial_pricing_factor)
    )                             AS pricing_factor
  FROM policy
  WHERE customer_category = '非营业个人客车'
    AND driver_age_group IN ('年龄＜24岁', '24岁≤年龄＜28岁')
    AND YEAR(insurance_start_date) BETWEEN 2021 AND 2026
  GROUP BY policy_no, insurance_type, coverage_combination, age_grp,
           is_new_car, is_nev, plate_prefix, plate_no
  HAVING SUM(premium) > 0
),
enriched AS (
  SELECT *,
    DATEDIFF('day', start_date, start_date + INTERVAL 1 YEAR) AS policy_term,
    LEAST(
      GREATEST(DATEDIFF('day', start_date, DATE '{VALUATION}'), 0),
      DATEDIFF('day', start_date, start_date + INTERVAL 1 YEAR)
    ) AS earned_days
  FROM base
),
final_pol AS (
  SELECT *,
    premium * CAST(earned_days AS DOUBLE) / NULLIF(CAST(policy_term AS DOUBLE), 0) AS earned_premium,
    CAST(earned_days AS DOUBLE) / 365.0 AS earned_exposure
  FROM enriched
),
claim_case AS (
  -- 项目标准口径：已结案用 settled_amount，未结案用 reserve_amount（含 IBNR）
  SELECT policy_no, claim_no,
         SUM(
           CASE WHEN settlement_time IS NOT NULL
                THEN COALESCE(settled_amount, 0)
                ELSE COALESCE(reserve_amount, 0)
           END
         ) AS case_amt
  FROM claims
  WHERE accident_time <= DATE '{VALUATION}'
  GROUP BY policy_no, claim_no
),
claims_agg AS (
  SELECT policy_no,
         COUNT(*)        AS claim_count,
         SUM(case_amt)   AS claim_amount
  FROM claim_case
  GROUP BY policy_no
)
SELECT
  p.policy_no, p.start_year,
  p.insurance_type, p.coverage_combination,
  p.age_grp, p.is_new_car, p.is_nev,
  p.plate_prefix,
  p.premium, p.fee_amount, p.pricing_factor,
  p.earned_premium, p.earned_exposure,
  COALESCE(c.claim_count, 0)  AS claim_count,
  COALESCE(c.claim_amount, 0) AS claim_amount
FROM final_pol p
LEFT JOIN claims_agg c ON p.policy_no = c.policy_no
"""


def fetch_rows():
    print(f"[query] valuation={VALUATION}, fetching policies...")
    cur = con.execute(CORE_SQL)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    print(f"[query] got {len(rows)} policies")
    return rows


# ============================================================
# 聚合器：保单聚合后产出 7 项指标
# ============================================================

def new_agg():
    return {
        "policies": 0,
        "premium": 0.0,
        "fee_amount": 0.0,
        "earned_premium": 0.0,
        "earned_exposure": 0.0,
        "claim_count": 0,
        "claim_amount": 0.0,
        "pf_w_num": 0.0,   # SUM(factor * premium) for 商业险
        "pf_w_den": 0.0,   # SUM(premium) for 商业险
    }


def add_row(a, r):
    a["policies"] += 1
    a["premium"] += r["premium"] or 0
    a["fee_amount"] += r["fee_amount"] or 0
    a["earned_premium"] += r["earned_premium"] or 0
    a["earned_exposure"] += r["earned_exposure"] or 0
    a["claim_count"] += r["claim_count"] or 0
    a["claim_amount"] += r["claim_amount"] or 0
    if r["insurance_type"] == "商业保险":
        pf = r["pricing_factor"]
        prem = r["premium"] or 0
        if pf is not None and prem > 0:
            a["pf_w_num"] += pf * prem
            a["pf_w_den"] += prem


def kpi(a, *, is_compulsory: bool = False):
    """返回 7 个指标的字典。"""
    prem = a["premium"]
    ep = a["earned_premium"]
    ee = a["earned_exposure"]
    loss = a["claim_amount"]
    fee = a["fee_amount"]
    cnt = a["claim_count"]

    loss_ratio = (loss / ep * 100) if ep > 0 else None
    incident_rate = (cnt / ee * 100) if ee > 0 else None
    fee_ratio = (fee / prem * 100) if prem > 0 else None
    vcr = (loss_ratio + fee_ratio) if (loss_ratio is not None and fee_ratio is not None) else None
    factor = (a["pf_w_num"] / a["pf_w_den"]) if a["pf_w_den"] > 0 else None
    if is_compulsory:
        factor = None  # 交强险不填

    return {
        "policies": a["policies"],
        "premium_wan": prem / 10000,
        "loss_ratio": loss_ratio,
        "incident_rate": incident_rate,
        "fee_ratio": fee_ratio,
        "vcr": vcr,
        "factor": factor,
    }


# ============================================================
# 多维分组
# ============================================================

def dim_value(row, dim: str):
    if dim == "insurance_type":
        return row["insurance_type"]
    if dim == "is_new_car":
        return "新车" if row["is_new_car"] else "旧车"
    if dim == "is_nev":
        return "新能源" if row["is_nev"] else "燃油"
    if dim == "coverage_combination":
        return row["coverage_combination"] or "未知"
    if dim == "plate_prefix":
        return row["plate_prefix"] or "其他"
    raise ValueError(dim)


def aggregate(rows):
    """
    返回结构：
      result[dim][age][value][time_block] = agg
    time_block 含 "2021".."2026" 和 "累计"
    """
    result = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(new_agg))))
    dims = ["insurance_type", "is_new_car", "is_nev", "coverage_combination", "plate_prefix"]
    for r in rows:
        age = r["age_grp"]
        if age not in AGE_GROUPS:
            continue
        year = int(r["start_year"])
        if year < 2021 or year > 2026:
            continue
        for dim in dims:
            val = dim_value(r, dim)
            add_row(result[dim][age][val][str(year)], r)
            add_row(result[dim][age][val]["累计"], r)
    return result


# ============================================================
# 报告渲染
# ============================================================

def fmt_int(v):
    if v is None:
        return "-"
    return f"{v:,}"


def fmt_money(v):
    if v is None or v == 0:
        return "-"
    return f"{v:,.1f}"


def fmt_pct(v):
    if v is None:
        return "-"
    return f"{v:.2f}%"


def fmt_vcr(v):
    """变动成本率带亮灯：≤91% 🟢 / 91-94% 🟡 / >94% 🔴"""
    if v is None:
        return "-"
    if v <= 91:
        light = "🟢"
    elif v <= 94:
        light = "🟡"
    else:
        light = "🔴"
    return f"{light} {v:.2f}%"


def fmt_factor(v):
    if v is None:
        return "-"
    return f"{v:.3f}"


METRIC_DEFS = [
    ("policies", "保单件数", fmt_int),
    ("premium_wan", "保费(万元)", fmt_money),
    ("loss_ratio", "满期赔付率", fmt_pct),
    ("incident_rate", "满期出险率(年化)", fmt_pct),
    ("fee_ratio", "费用率", fmt_pct),
    ("vcr", "变动成本率", fmt_vcr),
    ("factor", "商车自主系数", fmt_factor),
]


def render_metric_table(values_for_dim: dict, dim: str, value_order: list[str], metric_key: str, fmt):
    """渲染一张指标子表，行 = age × value，列 = 时间块"""
    header = "| 年龄段 | " + ("险类" if dim == "insurance_type" else
                              "新/旧" if dim == "is_new_car" else
                              "新能源" if dim == "is_nev" else
                              "险别组合" if dim == "coverage_combination" else
                              "归属地") + " | " + " | ".join(TIME_COLS) + " |"
    sep = "|" + "|".join(["---"] * (2 + len(TIME_COLS))) + "|"
    lines = [header, sep]
    for age in AGE_GROUPS:
        for val in value_order:
            cells = []
            for tb in TIME_COLS:
                a = values_for_dim.get(age, {}).get(val, {}).get(tb)
                if a is None or a["policies"] == 0:
                    cells.append("-")
                    continue
                is_compulsory = (dim == "insurance_type" and val == "交强险")
                k = kpi(a, is_compulsory=is_compulsory)
                cells.append(fmt(k[metric_key]))
            lines.append(f"| {AGE_LABEL[age]} | {val} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def determine_plate_topn(result, n=15):
    """按累计件数（所有年龄合并）取 Top N 车牌前缀。"""
    counts = defaultdict(int)
    for age in AGE_GROUPS:
        per_age = result["plate_prefix"].get(age, {})
        for val, by_time in per_age.items():
            cum = by_time.get("累计")
            if cum:
                counts[val] += cum["policies"]
    sorted_vals = sorted(counts.items(), key=lambda x: -x[1])
    top = [v for v, _ in sorted_vals[:n]]
    return top, [v for v, _ in sorted_vals[n:]]


def collapse_plate_others(result, top: list[str], others: list[str]):
    """把非 Top 前缀合并到 '其他'。"""
    if not others:
        return
    for age in AGE_GROUPS:
        per_age = result["plate_prefix"].get(age, {})
        new_per_age: dict = {}
        for val, by_time in per_age.items():
            target_key = val if val in top else "其他"
            tgt = new_per_age.setdefault(target_key, {})
            for tb, a in by_time.items():
                if tb not in tgt:
                    tgt[tb] = new_agg()
                for k, v in a.items():
                    tgt[tb][k] += v
        result["plate_prefix"][age] = new_per_age


def collect_value_order(result, dim):
    """收集 dim 下所有维度值，按累计件数降序。"""
    counts = defaultdict(int)
    for age in AGE_GROUPS:
        for val, by_time in result[dim].get(age, {}).items():
            cum = by_time.get("累计")
            if cum:
                counts[val] += cum["policies"]
    return [v for v, _ in sorted(counts.items(), key=lambda x: -x[1])]


def render_dim_section(result, dim, title):
    """渲染一个维度的所有 7 张指标表。"""
    value_order = collect_value_order(result, dim)
    if dim == "plate_prefix":
        # 给前缀加注释
        def label(p):
            city = PLATE_TO_CITY.get(p)
            return f"{p}（{city}）" if city else p
        # 但 collapse 后会有"其他"，保留原值
        result_dim_disp = {}
        for age in AGE_GROUPS:
            new_age = {}
            for val, by_time in result[dim].get(age, {}).items():
                new_age[label(val)] = by_time
            result_dim_disp[age] = new_age
        # 重排 value_order
        new_value_order = [label(v) for v in value_order]
        values_for_dim = result_dim_disp
        value_order = new_value_order
    else:
        values_for_dim = result[dim]

    lines = [f"## {title}\n"]
    for key, name, fmt in METRIC_DEFS:
        lines.append(f"\n### {name}\n")
        lines.append(render_metric_table(values_for_dim, dim, value_order, key, fmt))
        lines.append("")
    return "\n".join(lines)


def render_report(result):
    # plate top15
    top, others = determine_plate_topn(result, n=15)
    collapse_plate_others(result, top, others)

    parts = []
    parts.append(f"# 非营业个人客车 · 年轻驾驶人多维经营分析\n")
    parts.append(f"**估值日**：{VALUATION}\n")
    parts.append(f"**口径**：起期分年（2021-2026），保单级去重批改副本；earned_premium 闰年感知；")
    parts.append(f"赔款 = CASE WHEN settled THEN settled_amount ELSE reserve_amount（含 IBNR）；满期出险率年化（赔案数/已赚暴露）；")
    parts.append(f"商车自主系数按保费加权（仅商业保险计入，交强险不填）。\n")
    parts.append(f"**年龄分组**：被保险人年龄分组（driver_age_group）共 2 组：<24岁、24-28岁。\n")
    parts.append(f"**亮灯**：变动成本率 ≤91% 🟢 / 91-94% 🟡 / >94% 🔴。\n")
    parts.append("---\n")

    parts.append(render_dim_section(result, "insurance_type", "维度 1：分险类（交强险 / 商业保险）"))
    parts.append(render_dim_section(result, "is_new_car", "维度 2：分新/旧车（is_new_car）"))
    parts.append(render_dim_section(result, "is_nev", "维度 3：分是否新能源（is_nev）"))
    parts.append(render_dim_section(result, "coverage_combination", "维度 4：分险别组合（单交/交三/主全）"))
    parts.append(render_dim_section(result, "plate_prefix", "维度 5：分车牌归属地（Top15 + 其他）"))

    return "\n".join(parts)


# ============================================================
# main
# ============================================================

def main():
    rows = fetch_rows()
    result = aggregate(rows)
    md = render_report(result)
    out = REPORT_DIR / f"young_driver_multi_dim_{VALUATION}.md"
    out.write_text(md, encoding="utf-8")
    print(f"[done] report written: {out}")
    print(f"[done] size: {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
