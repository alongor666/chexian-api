#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
过户车出险地点异常分析脚本 v2.0

聚焦非营业客车过户车的出险地点、出险经过，识别假资料/挂靠欺诈。
赔案严格限制在保单期间内（方案 A：起保日 ≤ 出险日 ≤ 止保日）。

数据源:
  - 保单: warehouse/fact/policy/current/*.parquet
  - 赔案: warehouse/fact/claims_detail/claims_*.parquet
  - 车牌归属: warehouse/dim/plate_region/latest.parquet

使用:
    python3 数据管理/pipelines/diagnose_transfer_location.py
    python3 数据管理/pipelines/diagnose_transfer_location.py --year 2025
    python3 数据管理/pipelines/diagnose_transfer_location.py --sections 1,5,8

板块:
    1  过户车 vs 非过户车异地出险率
    2  车牌归属地异地出险率排名
    3  异地出险流向（归属地→出险地）
    4  承保机构异地出险
    5  异地出险区县集中度（欺诈热点）
    6  多城市出险车辆（流窜模式）
    7  异地 vs 本地赔案特征
    8  出险原因与出险经过分析
    9  外省车牌过户车专项
    10 诊断总结与风险发现
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb"); sys.exit(1)


# ── 路径 ──────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
POLICY_GLOB = str(SCRIPT_DIR.parent / "warehouse/fact/policy/current/*.parquet")
CLAIMS_PATH = str(SCRIPT_DIR.parent / "warehouse/fact/claims_detail/claims_*.parquet")
PLATE_DIM   = str(SCRIPT_DIR.parent / "warehouse/dim/plate_region/latest.parquet")
OUT_DIR     = str(SCRIPT_DIR.parent / "数据分析报告")

# ── SQL 片段 ──────────────────────────────────────────────────────
CITY_EXTRACT  = "REGEXP_EXTRACT(c.accident_city, '[^0-9]+')"
CLAIM_AMT     = (
    "CASE WHEN c.settlement_time IS NOT NULL THEN COALESCE(c.settled_amount, 0) "
    "ELSE COALESCE(c.reserve_amount, 0) END"
)
IS_LOCAL      = "plate_city = accident_city_name"

# 0E：分支省份参数化（默认 '四川' 保持兼容；main() 按 --branch 覆盖）
BRANCH_PROVINCE = '四川'
IS_INPROV     = f"plate_province = '{BRANCH_PROVINCE}'"
IS_INPROV_RMT = f"plate_province = '{BRANCH_PROVINCE}' AND plate_city != accident_city_name"
IS_OUTPROV    = f"plate_province != '{BRANCH_PROVINCE}'"
LOC_TYPE = f"""CASE
    WHEN {IS_LOCAL} THEN '本地'
    WHEN {IS_INPROV_RMT} THEN '本省异地'
    WHEN {IS_OUTPROV} THEN '外省'
    ELSE '未知' END"""


def _override_branch(province: str):
    """0E：main() 启动时根据 --branch 覆盖 4 个分支相关全局常量。

    Python 模块全局变量延迟绑定：sX() 函数在执行时读取最新值。
    LOC_TYPE 含 IS_INPROV_RMT/IS_OUTPROV 嵌套 f-string，必须整体重算。
    """
    global BRANCH_PROVINCE, IS_INPROV, IS_INPROV_RMT, IS_OUTPROV, LOC_TYPE
    BRANCH_PROVINCE = province
    IS_INPROV     = f"plate_province = '{province}'"
    IS_INPROV_RMT = f"plate_province = '{province}' AND plate_city != accident_city_name"
    IS_OUTPROV    = f"plate_province != '{province}'"
    LOC_TYPE = f"""CASE
    WHEN {IS_LOCAL} THEN '本地'
    WHEN {IS_INPROV_RMT} THEN '本省异地'
    WHEN {IS_OUTPROV} THEN '外省'
    ELSE '未知' END"""


# ── 格式化 & 亮灯 ────────────────────────────────────────────────
def fw(v): return "-" if v is None else f"{v:,.1f}"
def fp(v): return "-" if v is None else f"{v:.1f}%"
def fi(v): return "-" if v is None else f"{int(v):,d}"

TH_REMOTE = (25, 35, 45)
TH_RATIO  = (1.3, 1.8, 2.5)

def light(v, th, higher_worse=True):
    if v is None: return ""
    a, b, c = th
    if higher_worse:
        return " 🔴" if v > c else " 🟡" if v > b else " 🔵" if v > a else " 🟢"
    return " 🔴" if v < c else " 🟡" if v < b else " 🔵" if v < a else " 🟢"


# ── Report ────────────────────────────────────────────────────────
class Report:
    def __init__(self):
        self.lines = []
    def add(self, t=""):
        self.lines.append(t)
    def save(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text("\n".join(self.lines) + "\n", encoding="utf-8")
        print(f"✅ {path}")


# ── 基础 CTE ─────────────────────────────────────────────────────
def cte(year_filter, *, transfer_only=True):
    """保单 JOIN 赔案 JOIN 车牌维度。赔案严格限保单期间内。"""
    tf = "AND p.is_transfer = true" if transfer_only else ""
    return f"""
    WITH joined AS (
        SELECT
            p.vehicle_frame_no, p.plate_no, p.is_transfer,
            dim.province AS plate_province, dim.city AS plate_city,
            {CITY_EXTRACT} AS accident_city_name,
            p.org_level_3, p.premium,
            p.insurance_start_date, p.insurance_end_date, p.policy_date,
            c.accident_time, c.accident_city, c.accident_district,
            {CLAIM_AMT} AS claim_amount,
            c.is_bodily_injury, c.accident_cause, c.accident_description,
            c.settled_amount, c.reserve_amount
        FROM read_parquet('{POLICY_GLOB}', union_by_name=true) p
        LEFT JOIN read_parquet('{PLATE_DIM}') dim ON p.plate_no = dim.plate_prefix
        JOIN read_parquet('{CLAIMS_PATH}') c ON p.vehicle_frame_no = c.vehicle_frame_no
        WHERE p.customer_category = '非营业个人客车' {tf}
          AND {year_filter}
          AND c.accident_city IS NOT NULL AND p.plate_no IS NOT NULL
          AND c.accident_time::DATE >= p.insurance_start_date::DATE
          AND c.accident_time::DATE <= p.insurance_end_date::DATE
    )"""


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 1 — 过户车 vs 非过户车异地出险率                          ║
# ╚═══════════════════════════════════════════════════════════════╝
def s01_overview_compare(con, rpt, yf):
    rpt.add("## 1. 过户车 vs 非过户车异地出险率对比\n")
    r = con.execute(f"""
    {cte(yf, transfer_only=False)}
    SELECT
        CASE WHEN is_transfer THEN '过户车' ELSE '非过户车' END,
        COUNT(*),
        COUNT(CASE WHEN {IS_LOCAL} THEN 1 END),
        COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END),
        COUNT(CASE WHEN {IS_OUTPROV} THEN 1 END),
        ROUND(SUM(claim_amount)/COUNT(*), 0),
        ROUND(SUM(CASE WHEN {IS_INPROV_RMT} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END),0), 0),
        ROUND(SUM(CASE WHEN {IS_LOCAL} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_LOCAL} THEN 1 END),0), 0)
    FROM joined WHERE plate_province IS NOT NULL
    GROUP BY is_transfer ORDER BY is_transfer DESC
    """).fetchall()
    rpt.add("| 指标 | 过户车 | 非过户车 | 差异 |")
    rpt.add("|:---|---:|---:|---:|")
    if len(r) == 2:
        t, n = r[0], r[1]
        tr = t[3]/t[1]*100; nr = n[3]/n[1]*100
        rpt.add(f"| 总赔案数 | {fi(t[1])} | {fi(n[1])} | - |")
        rpt.add(f"| 省内异地出险率 | {fp(tr)} | {fp(nr)} | **+{tr-nr:.1f}pp**{light(tr-nr,(3,5,8))} |")
        rpt.add(f"| 外省车牌占比 | {fp(t[4]/t[1]*100)} | {fp(n[4]/n[1]*100)} | - |")
        rpt.add(f"| 异地案均 | {fi(t[6])} | {fi(n[6])} | {t[6]/n[6]:.2f}x |")
        rpt.add(f"| 本地案均 | {fi(t[7])} | {fi(n[7])} | {t[7]/n[7]:.2f}x |")
        ratio = t[6]/t[7] if t[7] else 0
        rpt.add(f"| 异地/本地案均比 | **{ratio:.2f}x** | {n[6]/n[7]:.2f}x | - |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 2 — 车牌归属地异地出险率排名                              ║
# ╚═══════════════════════════════════════════════════════════════╝
def s02_plate_ranking(con, rpt, yf):
    rpt.add("## 2. 车牌归属地异地出险率排名（川牌）\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT plate_no, plate_city, COUNT(*),
        COUNT(CASE WHEN {IS_LOCAL} THEN 1 END),
        COUNT(CASE WHEN plate_city!=accident_city_name THEN 1 END),
        ROUND(COUNT(CASE WHEN plate_city!=accident_city_name THEN 1 END)*100.0/COUNT(*),1),
        ROUND(SUM(CASE WHEN {IS_LOCAL} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_LOCAL} THEN 1 END),0),0),
        ROUND(SUM(CASE WHEN plate_city!=accident_city_name THEN claim_amount END)/NULLIF(COUNT(CASE WHEN plate_city!=accident_city_name THEN 1 END),0),0),
        ROUND(SUM(CASE WHEN plate_city!=accident_city_name THEN claim_amount END)/10000,1)
    FROM joined WHERE {IS_INPROV} GROUP BY 1,2 HAVING COUNT(*)>=20 ORDER BY 6 DESC
    """).fetchall()
    rpt.add("| 车牌 | 归属城市 | 总赔案 | 本地 | 异地 | 异地率 | 本地案均 | 异地案均 | 倍率 | 异地赔款(万) |")
    rpt.add("|:---|:---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for row in r:
        ratio = row[7]/row[6] if row[6] and row[6]>0 else 0
        rpt.add(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | {fp(row[5])}{light(row[5],TH_REMOTE)} | {fi(row[6])} | {fi(row[7])} | {ratio:.1f}x{light(ratio,TH_RATIO)} | {fw(row[8])} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 3 — 异地出险流向                                         ║
# ╚═══════════════════════════════════════════════════════════════╝
def s03_flow(con, rpt, yf):
    rpt.add("## 3. 异地出险流向（车牌归属地→实际出险地）\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT plate_city, accident_city_name, COUNT(*),
        ROUND(SUM(claim_amount)/10000,1), ROUND(SUM(claim_amount)/COUNT(*),0),
        COUNT(CASE WHEN is_bodily_injury THEN 1 END),
        ROUND(COUNT(CASE WHEN is_bodily_injury THEN 1 END)*100.0/COUNT(*),1)
    FROM joined WHERE {IS_INPROV} AND plate_city!=accident_city_name
    GROUP BY 1,2 HAVING COUNT(*)>=10 ORDER BY 3 DESC LIMIT 25
    """).fetchall()
    rpt.add("| 归属地 | 出险地 | 赔案 | 赔款(万) | 案均 | 人伤 | 人伤率 |")
    rpt.add("|:---|:---|---:|---:|---:|---:|---:|")
    for row in r:
        rpt.add(f"| {row[0]} | {row[1]} | {row[2]} | {fw(row[3])} | {fi(row[4])} | {row[5]} | {fp(row[6])} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 4 — 承保机构异地出险                                      ║
# ╚═══════════════════════════════════════════════════════════════╝
def s04_org(con, rpt, yf):
    rpt.add("## 4. 承保机构异地出险分析\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT org_level_3, COUNT(*),
        COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END),
        ROUND(COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END)*100.0/COUNT(*),1),
        ROUND(SUM(CASE WHEN {IS_LOCAL} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_LOCAL} THEN 1 END),0),0),
        ROUND(SUM(CASE WHEN {IS_INPROV_RMT} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END),0),0),
        ROUND(SUM(CASE WHEN {IS_INPROV_RMT} THEN claim_amount END)/10000,1)
    FROM joined WHERE {IS_INPROV} GROUP BY 1 HAVING COUNT(*)>=20 ORDER BY 4 DESC
    """).fetchall()
    rpt.add("| 机构 | 总赔案 | 异地赔案 | 异地率 | 本地案均 | 异地案均 | 倍率 | 异地赔款(万) |")
    rpt.add("|:---|---:|---:|---:|---:|---:|---:|---:|")
    for row in r:
        ratio = row[5]/row[4] if row[4] and row[4]>0 else 0
        rpt.add(f"| {row[0]} | {row[1]} | {row[2]} | {fp(row[3])}{light(row[3],TH_REMOTE)} | {fi(row[4])} | {fi(row[5])} | {ratio:.1f}x{light(ratio,TH_RATIO)} | {fw(row[6])} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 5 — 异地出险区县集中度（欺诈热点）                         ║
# ╚═══════════════════════════════════════════════════════════════╝
def s05_district_hotspot(con, rpt, yf):
    rpt.add("## 5. 异地出险区县集中度（欺诈热点）\n")
    rpt.add("> 少量车牌前缀 + 高案均 + 高人伤率 = 高风险区县\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT accident_city_name, REGEXP_EXTRACT(accident_district,'[^0-9]+'),
        COUNT(*), COUNT(DISTINCT plate_no),
        ROUND(SUM(claim_amount)/10000,1), ROUND(SUM(claim_amount)/COUNT(*),0),
        COUNT(CASE WHEN is_bodily_injury THEN 1 END),
        ROUND(COUNT(CASE WHEN is_bodily_injury THEN 1 END)*100.0/COUNT(*),1)
    FROM joined WHERE {IS_INPROV} AND plate_city!=accident_city_name AND accident_district IS NOT NULL
    GROUP BY 1,2 HAVING COUNT(*)>=10 ORDER BY 3 DESC LIMIT 25
    """).fetchall()
    rpt.add("| 出险城市 | 区县 | 异地赔案 | 车牌数 | 赔款(万) | 案均 | 人伤 | 人伤率 | 风险 |")
    rpt.add("|:---|:---|---:|---:|---:|---:|---:|---:|:---:|")
    for row in r:
        risk = "🔴" if row[5]>=20000 or row[7]>=25 else "🟡" if row[5]>=10000 or row[7]>=15 or (row[3]<=3 and row[2]>=30) else ""
        rpt.add(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {fw(row[4])} | {fi(row[5])} | {row[6]} | {fp(row[7])} | {risk} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 6 — 多城市出险车辆（流窜模式）                             ║
# ╚═══════════════════════════════════════════════════════════════╝
def s06_multi_city(con, rpt, yf):
    rpt.add("## 6. 多城市出险车辆（流窜出险模式）\n")
    agg = con.execute(f"""
    {cte(yf)}, multi AS (
        SELECT vehicle_frame_no, plate_no, plate_city, org_level_3,
            COUNT(*) n, COUNT(DISTINCT accident_city_name) cities,
            SUM(claim_amount) amt, COUNT(CASE WHEN is_bodily_injury THEN 1 END) bodily
        FROM joined WHERE {IS_INPROV}
        GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT accident_city_name)>=2
    ) SELECT COUNT(*), SUM(n), ROUND(SUM(amt)/10000,1), ROUND(AVG(n),1), ROUND(AVG(cities),1), SUM(bodily) FROM multi
    """).fetchone()
    rpt.add(f"| 统计项 | 值 |"); rpt.add("|:---|---:|")
    rpt.add(f"| 多城市出险车辆 | {fi(agg[0])} |")
    rpt.add(f"| 赔案总数 | {fi(agg[1])} |")
    rpt.add(f"| 赔款合计(万) | {fw(agg[2])} |")
    rpt.add(f"| 均赔案/车 | {agg[3]} |")
    rpt.add(f"| 均城市/车 | {agg[4]} |")
    rpt.add(f"| 人伤赔案 | {fi(agg[5])} |"); rpt.add("")

    rpt.add("### TOP 15 高风险车辆\n")
    rows = con.execute(f"""
    {cte(yf)}
    SELECT SUBSTRING(vehicle_frame_no,1,6)||'***', plate_no, plate_city, org_level_3,
        COUNT(*), COUNT(DISTINCT accident_city_name), ROUND(SUM(claim_amount)/10000,1),
        COUNT(CASE WHEN plate_city!=accident_city_name THEN 1 END),
        COUNT(CASE WHEN is_bodily_injury THEN 1 END),
        STRING_AGG(DISTINCT accident_city_name,'→')
    FROM joined WHERE {IS_INPROV}
    GROUP BY vehicle_frame_no, plate_no, plate_city, org_level_3
    HAVING COUNT(DISTINCT accident_city_name)>=2 ORDER BY SUM(claim_amount) DESC LIMIT 15
    """).fetchall()
    rpt.add("| VIN | 车牌 | 归属 | 机构 | 赔案 | 城市 | 赔款(万) | 异地 | 人伤 | 轨迹 |")
    rpt.add("|:---|:---|:---|:---|---:|---:|---:|---:|---:|:---|")
    for r in rows:
        rpt.add(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {fw(r[6])} | {r[7]} | {r[8]} | {r[9]} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 7 — 异地 vs 本地赔案特征对比                              ║
# ╚═══════════════════════════════════════════════════════════════╝
def s07_claim_profile(con, rpt, yf):
    rpt.add("## 7. 异地 vs 本地赔案特征对比\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT {LOC_TYPE}, COUNT(*), ROUND(SUM(claim_amount)/COUNT(*),0),
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY claim_amount),0),
        COUNT(CASE WHEN is_bodily_injury THEN 1 END),
        ROUND(COUNT(CASE WHEN is_bodily_injury THEN 1 END)*100.0/COUNT(*),1),
        ROUND(COUNT(CASE WHEN EXTRACT(HOUR FROM accident_time) BETWEEN 0 AND 5 THEN 1 END)*100.0/NULLIF(COUNT(accident_time),0),1),
        ROUND(COUNT(CASE WHEN EXTRACT(DOW FROM accident_time) IN (0,6) THEN 1 END)*100.0/NULLIF(COUNT(accident_time),0),1),
        ROUND(SUM(claim_amount)/10000,1)
    FROM joined WHERE plate_province IS NOT NULL GROUP BY 1 ORDER BY 3 DESC
    """).fetchall()
    rpt.add("| 类型 | 赔案 | 案均 | 中位数 | 人伤 | 人伤率 | 深夜率 | 周末率 | 赔款(万) |")
    rpt.add("|:---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for row in r:
        rpt.add(f"| {row[0]} | {fi(row[1])} | {fi(row[2])} | {fi(row[3])} | {row[4]} | {fp(row[5])} | {fp(row[6])} | {fp(row[7])} | {fw(row[8])} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 8 — 出险原因与出险经过分析                                 ║
# ╚═══════════════════════════════════════════════════════════════╝
def s08_cause_description(con, rpt, yf):
    rpt.add("## 8. 出险原因与出险经过分析\n")

    # 8a: 出险原因 × 本地/异地
    rpt.add("### 8.1 出险原因分布（本地 vs 异地）\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT accident_cause, {LOC_TYPE} AS loc,
        COUNT(*), ROUND(SUM(claim_amount)/COUNT(*),0),
        COUNT(CASE WHEN is_bodily_injury THEN 1 END)
    FROM joined WHERE plate_province IS NOT NULL AND accident_cause IS NOT NULL
    GROUP BY 1,2 HAVING COUNT(*)>=5 ORDER BY 1,2
    """).fetchall()
    # pivot: cause → {本地: (cnt, avg), 本省异地: ...}
    from collections import defaultdict
    pivot = defaultdict(dict)
    for cause, loc, cnt, avg, bodily in r:
        pivot[cause][loc] = (cnt, avg, bodily)
    # 按总赔案排序
    sorted_causes = sorted(pivot.keys(), key=lambda c: sum(v[0] for v in pivot[c].values()), reverse=True)

    rpt.add("| 出险原因 | 本地(件/案均) | 本省异地(件/案均) | 异地案均倍率 |")
    rpt.add("|:---|---:|---:|---:|")
    for cause in sorted_causes[:12]:
        d = pivot[cause]
        loc = d.get("本地", (0, 0, 0))
        rmt = d.get("本省异地", (0, 0, 0))
        ratio = rmt[1] / loc[1] if loc[1] and loc[1] > 0 and rmt[1] else 0
        r_str = f"{ratio:.1f}x{light(ratio, TH_RATIO)}" if ratio > 0 else "-"
        rpt.add(f"| {cause} | {loc[0]:,}/{fi(loc[1])} | {rmt[0]:,}/{fi(rmt[1])} | {r_str} |")
    rpt.add("")

    # 8b: 异地高额赔案的出险经过样本（脱敏）
    rpt.add("### 8.2 异地高额赔案出险经过样本\n")
    rpt.add("> 案均 ≥ 2 万元的异地赔案，按赔款降序取 TOP 15\n")
    rows = con.execute(f"""
    {cte(yf)}
    SELECT
        SUBSTRING(vehicle_frame_no,1,5)||'****' AS vin,
        plate_city, accident_city_name, org_level_3,
        accident_cause,
        CASE WHEN LENGTH(accident_description) > 60
             THEN SUBSTRING(accident_description,1,60)||'…'
             ELSE accident_description END AS desc_short,
        ROUND(claim_amount,0) AS amt,
        CASE WHEN is_bodily_injury THEN '是' ELSE '否' END AS bodily,
        accident_time::DATE AS dt
    FROM joined
    WHERE {IS_INPROV} AND plate_city!=accident_city_name AND claim_amount>=20000
    ORDER BY claim_amount DESC LIMIT 15
    """).fetchall()
    rpt.add("| VIN | 归属 | 出险地 | 机构 | 原因 | 赔款 | 人伤 | 日期 | 出险经过 |")
    rpt.add("|:---|:---|:---|:---|:---|---:|:---|:---|:---|")
    for r in rows:
        desc = (r[5] or "").replace("|", "\\|").replace("\n", " ")
        rpt.add(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {fi(r[6])} | {r[7]} | {r[8]} | {desc} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 9 — 外省车牌过户车专项                                    ║
# ╚═══════════════════════════════════════════════════════════════╝
def s09_outprov(con, rpt, yf):
    rpt.add("## 9. 外省车牌过户车出险分析\n")
    rpt.add("> 外省车牌在川投保过户车，出险地在原省份 → 可能异地挂靠\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT plate_no, plate_province, plate_city, accident_city_name, org_level_3,
        COUNT(*), ROUND(SUM(claim_amount)/10000,1), ROUND(SUM(claim_amount)/COUNT(*),0),
        COUNT(CASE WHEN is_bodily_injury THEN 1 END)
    FROM joined WHERE {IS_OUTPROV} AND plate_province IS NOT NULL
    GROUP BY 1,2,3,4,5 HAVING COUNT(*)>=3 ORDER BY 6 DESC LIMIT 25
    """).fetchall()
    rpt.add("| 车牌 | 归属省 | 归属市 | 出险地 | 机构 | 赔案 | 赔款(万) | 案均 | 人伤 |")
    rpt.add("|:---|:---|:---|:---|:---|---:|---:|---:|---:|")
    for row in r:
        rpt.add(f"| {row[0]} | {row[1]} | {row[2]} | {row[3]} | {row[4]} | {row[5]} | {fw(row[6])} | {fi(row[7])} | {row[8]} |")
    rpt.add("")


# ╔═══════════════════════════════════════════════════════════════╗
# ║  板块 10 — 诊断总结                                            ║
# ╚═══════════════════════════════════════════════════════════════╝
def s10_summary(con, rpt, yf):
    rpt.add("## 10. 诊断总结与风险发现\n")
    r = con.execute(f"""
    {cte(yf)}
    SELECT
        ROUND(COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END)*100.0/COUNT(*),1),
        ROUND(SUM(CASE WHEN {IS_INPROV_RMT} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_INPROV_RMT} THEN 1 END),0),0),
        ROUND(SUM(CASE WHEN {IS_LOCAL} THEN claim_amount END)/NULLIF(COUNT(CASE WHEN {IS_LOCAL} THEN 1 END),0),0),
        ROUND(SUM(CASE WHEN {IS_INPROV_RMT} THEN claim_amount END)/10000,1),
        (SELECT COUNT(*) FROM (SELECT vehicle_frame_no FROM joined WHERE {IS_INPROV} GROUP BY 1 HAVING COUNT(DISTINCT accident_city_name)>=2)),
        COUNT(CASE WHEN {IS_OUTPROV} THEN 1 END),
        ROUND(SUM(CASE WHEN {IS_OUTPROV} THEN claim_amount END)/10000,1)
    FROM joined WHERE plate_province IS NOT NULL
    """).fetchone()
    rate, rmt_avg, loc_avg, rmt_total, multi, op_cnt, op_total = r
    ratio = rmt_avg/loc_avg if loc_avg else 0

    rpt.add("### 风险信号\n")
    if rate >= 25:    rpt.add(f"- 🔴 **异地出险率偏高**: {fp(rate)}")
    if ratio >= 1.3:  rpt.add(f"- 🔴 **异地案均异常**: {fi(rmt_avg)} 是本地 {fi(loc_avg)} 的 **{ratio:.1f}x**")
    if multi >= 100:   rpt.add(f"- 🟡 **多城市出险**: {multi}辆车在 2+ 城市出险")
    if op_cnt >= 20:   rpt.add(f"- 🟡 **外省车牌**: {op_cnt}件赔案，{fw(op_total)}万")
    rpt.add(f"- 省内异地赔款合计 **{fw(rmt_total)}万**\n")

    rpt.add("### 建议下一步\n")
    rpt.add("1. **高风险区县**: 汶川/安岳/射洪等高案均高人伤区县逐案现场核实")
    rpt.add("2. **多城市流窜**: 对板块 6 标记车辆赔案链做全链路审核")
    rpt.add("3. **机构核保**: 关注异地/本地案均倍率 ≥ 2x 的机构核保规则")
    rpt.add("4. **外省车牌**: 核查出险地在原省份的案件资料真实性")
    rpt.add("5. **出险经过**: 板块 8 高额赔案经过描述逐案审核")
    rpt.add("")


# ── 注册表 ────────────────────────────────────────────────────────
SECTIONS = {
    1:  ("过户车 vs 非过户车异地出险率",  s01_overview_compare),
    2:  ("车牌归属地异地出险率排名",      s02_plate_ranking),
    3:  ("异地出险流向",                  s03_flow),
    4:  ("承保机构异地出险",              s04_org),
    5:  ("异地出险区县集中度",            s05_district_hotspot),
    6:  ("多城市出险车辆",                s06_multi_city),
    7:  ("异地 vs 本地赔案特征",          s07_claim_profile),
    8:  ("出险原因与出险经过",            s08_cause_description),
    9:  ("外省车牌过户车专项",            s09_outprov),
    10: ("诊断总结与风险发现",            s10_summary),
}

# ── main ──────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="过户车出险地点异常分析")
    ap.add_argument("--year", type=int, default=2025)
    ap.add_argument("--sections", type=str, default=None, help="逗号分隔，如 1,5,8")
    ap.add_argument("--branch", type=str, default='四川',
                    help="分公司省份中文名（默认 '四川'；多分公司启用后传 '山西' 等）")
    args = ap.parse_args()

    # 0E：先按 --branch 覆盖 IS_INPROV / IS_INPROV_RMT / IS_OUTPROV / LOC_TYPE 等全局常量
    _override_branch(args.branch)

    yf = f"YEAR(p.policy_date) = {args.year}"
    selected = {int(x) for x in args.sections.split(",") if x.strip()} if args.sections else set(SECTIONS)

    print(f"📊 过户车出险地点分析 — {args.year}年 板块 {sorted(selected)}")
    con = duckdb.connect()
    dim_n = con.execute(f"SELECT COUNT(*) FROM read_parquet('{PLATE_DIM}')").fetchone()[0]
    print(f"   车牌维度表: {dim_n}条 | 赔案限保单期间内（方案A）\n")

    rpt = Report()
    rpt.add(f"# 非营业客车过户车出险地点异常分析\n")
    rpt.add(f"> **年度**: {args.year} | **生成**: {datetime.now().strftime('%Y-%m-%d %H:%M')} | **车牌维度**: {dim_n}条")
    rpt.add(f"> **口径**: 赔案严格限保单期间内（起保日 ≤ 出险日 ≤ 止保日）\n")

    for sid in sorted(selected):
        if sid in SECTIONS:
            label, fn = SECTIONS[sid]
            print(f"  → {sid}. {label}")
            fn(con, rpt, yf)

    out = f"{OUT_DIR}/过户车出险地点分析_{args.year}_{datetime.now().strftime('%Y-%m-%d')}.md"
    rpt.save(out)
    con.close()

if __name__ == "__main__":
    main()
