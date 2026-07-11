"""
2025 保单年度 深度分析 v2（修复 policy_no 批改重复 bug）

筛选：四川+燃油+非营业个人客车+主全+商业险NCD=0.8，已满期
保单年度：YEAR(insurance_start_date) = 2025

关键修复：
  CTE 先按 policy_no 去重（SUM(premium) 聚合批改金额），再 JOIN 赔案。

标准字段（每张表都输出）：
  车险分等级 | 保单件数 | 保费(万) | 自主系数(保费加权) | 件均保费(元)
  赔案件数 | 赔款(万) | 满期出险率 | 案均赔款(元) | 满期赔付率 | >5万占比

探索维度：
  A. 同期对比（1-4月起保，已满期）
  B. 成都(川A/G) vs 非成都
  C. insurance_grade
  D. 自主定价系数分档
  E. 成都 × 等级 交叉
  F. 月度起保
  G. 车龄分段（first_registration_date）
  H. 新车购置价分段
  I. 是否续保
  J. 是否过户车
  K. 出单终端（top）
  L. 经代机构（top）
  M. 三级机构
  N. 赔案类型构成（2024 vs 2025 同期）
  O. 赔款集中度 + Top 大案
"""
import sys
from pathlib import Path
import duckdb
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
_DM = ROOT / "数据管理"
if str(_DM) not in sys.path:
    sys.path.insert(0, str(_DM))  # 供 import pipelines.*（branch_paths SSOT · 801409 cutover 前置）
from pipelines.branch_paths import (  # noqa: E402
    PolicyCurrentLayoutError,
    policy_current_glob,
    resolve_province,
)

# 省份轴收窄（50d62e）：--province fail-closed 必填，禁全省混查（data-pipeline.md 红线）
import argparse  # noqa: E402
_ap = argparse.ArgumentParser(description="2025 保单年度深度分析 v2（NCD=0.8 专题）")
_ap.add_argument("--province", required=True,
                 help="省份代码（仅接受已注册省份如 SC/SX，缺省/未知即报错中止）")
try:
    PROVINCE = resolve_province(_ap.parse_args().province)
except PolicyCurrentLayoutError as e:
    raise SystemExit(f"❌ {e}")
POLICY_GLOB = policy_current_glob(ROOT / "数据管理/warehouse/fact/policy/current", PROVINCE, missing_ok=True)
CLAIMS_GLOB = "/Users/alongor666/Downloads/底层数据湖DUD/chexian-api/数据管理/warehouse/fact/claims_detail/claims_*.parquet"

con = duckdb.connect(":memory:")
# WHERE branch_code 是省份隔离保证（glob 收窄仅性能辅助）
con.execute(f"CREATE VIEW policy AS SELECT * FROM read_parquet('{POLICY_GLOB}', union_by_name=true) WHERE branch_code = '{PROVINCE}'")
con.execute(f"CREATE VIEW claims AS SELECT * FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true)")

LATEST = con.execute("SELECT MAX(CAST(policy_date AS DATE)) FROM policy").fetchone()[0]
print(f"# latest_policy_date = {LATEST}")


def build_sql(year: int, month_max: int | None = None):
    month_filter = f"AND MONTH(insurance_start_date) <= {month_max}" if month_max else ""
    return f"""
    WITH commercial_raw AS (
      SELECT *
      FROM policy
      WHERE plate_no LIKE '川%'
        AND is_nev = false
        AND customer_category = '非营业个人客车'
        AND coverage_combination = '主全'
        AND insurance_type = '商业保险'
        AND commercial_ncd = '0.8'
        AND YEAR(insurance_start_date) = {year}
        {month_filter}
        AND CAST(insurance_start_date AS DATE) + INTERVAL 1 YEAR <= DATE '{LATEST}'
    ),
    commercial_ins AS (
      -- 按 policy_no 去重：premium 聚合（处理批改），结构字段取 MAX
      SELECT
        policy_no,
        MAX(vehicle_frame_no)   AS vehicle_frame_no,
        SUM(premium)            AS premium,
        MAX(insurance_start_date) AS insurance_start_date,
        MAX(plate_no)           AS plate_no,
        MAX(insurance_grade)    AS insurance_grade,
        COALESCE(
          MAX(CASE WHEN premium > 0 THEN commercial_pricing_factor END),
          MAX(commercial_pricing_factor)
        ) AS commercial_pricing_factor,
        MAX(new_vehicle_price)  AS new_vehicle_price,
        MAX(first_registration_date) AS first_reg_date,
        MAX(is_new_car)         AS is_new_car,
        MAX(is_transfer)        AS is_transfer,
        MAX(is_renewal)         AS is_renewal,
        MAX(is_telemarketing)   AS is_telemarketing,
        MAX(terminal_source)    AS terminal_source,
        MAX(agent_name)         AS agent_name,
        MAX(org_level_3)        AS org_level_3,
        MAX(salesman_name)      AS salesman_name,
        MAX(insured_gender)     AS insured_gender,
        MAX(driver_age_group)   AS driver_age_group,
        MAX(seat_count)         AS seat_count,
        MAX(vehicle_model)      AS vehicle_model,
        YEAR(MAX(insurance_start_date))  AS start_year,
        MONTH(MAX(insurance_start_date)) AS start_month
      FROM commercial_raw
      GROUP BY policy_no
    ),
    target AS (
      SELECT DISTINCT vehicle_frame_no, start_year, plate_no,
             insurance_grade, commercial_pricing_factor,
             is_transfer, is_renewal, is_telemarketing,
             terminal_source, agent_name, org_level_3, salesman_name,
             insured_gender, driver_age_group, new_vehicle_price,
             first_reg_date
      FROM commercial_ins
    ),
    compulsory_raw AS (
      SELECT p.*, t.insurance_grade AS t_grade,
             t.commercial_pricing_factor AS t_pf, t.plate_no AS t_plate,
             t.is_transfer AS t_tr, t.is_renewal AS t_rn, t.is_telemarketing AS t_tel,
             t.terminal_source AS t_ts, t.agent_name AS t_ag,
             t.org_level_3 AS t_org, t.salesman_name AS t_sm,
             t.insured_gender AS t_gd, t.driver_age_group AS t_da,
             t.new_vehicle_price AS t_nvp, t.first_reg_date AS t_frd
      FROM policy p
      JOIN target t
        ON p.vehicle_frame_no = t.vehicle_frame_no
       AND YEAR(p.insurance_start_date) = t.start_year
      WHERE p.insurance_type = '交强险'
        AND p.coverage_combination = '主全'
        AND CAST(p.insurance_start_date AS DATE) + INTERVAL 1 YEAR <= DATE '{LATEST}'
    ),
    compulsory_ins AS (
      -- 交强险同样去重
      SELECT
        policy_no,
        MAX(vehicle_frame_no)   AS vehicle_frame_no,
        SUM(premium)            AS premium,
        MAX(insurance_start_date) AS insurance_start_date,
        MAX(t_plate)            AS plate_no,
        MAX(t_grade)            AS insurance_grade,
        MAX(t_pf)               AS commercial_pricing_factor,
        MAX(new_vehicle_price)  AS new_vehicle_price,
        MAX(t_frd)              AS first_reg_date,
        MAX(is_new_car)         AS is_new_car,
        MAX(t_tr)               AS is_transfer,
        MAX(t_rn)               AS is_renewal,
        MAX(t_tel)              AS is_telemarketing,
        MAX(t_ts)               AS terminal_source,
        MAX(t_ag)               AS agent_name,
        MAX(t_org)              AS org_level_3,
        MAX(t_sm)               AS salesman_name,
        MAX(t_gd)               AS insured_gender,
        MAX(t_da)               AS driver_age_group,
        MAX(seat_count)         AS seat_count,
        MAX(vehicle_model)      AS vehicle_model,
        YEAR(MAX(insurance_start_date))  AS start_year,
        MONTH(MAX(insurance_start_date)) AS start_month
      FROM compulsory_raw
      GROUP BY policy_no
    ),
    all_pol AS (
      SELECT *, 'commercial' AS bucket FROM commercial_ins
      UNION ALL
      SELECT *, 'compulsory' AS bucket FROM compulsory_ins
    ),
    claim_case AS (
      SELECT policy_no, claim_no,
             SUM(COALESCE(settled_amount,0)+COALESCE(pending_amount,0)) AS case_amt
      FROM claims GROUP BY policy_no, claim_no
    ),
    claims_agg AS (
      SELECT policy_no,
             COUNT(*) AS claim_count,
             SUM(case_amt) AS claim_amount,
             SUM(CASE WHEN case_amt > 10000 THEN 1 ELSE 0 END) AS cases_gt_10k,
             SUM(CASE WHEN case_amt > 50000 THEN 1 ELSE 0 END) AS cases_gt_50k,
             MAX(case_amt) AS max_case
      FROM claim_case GROUP BY policy_no
    ),
    joined AS (
      SELECT p.*,
             COALESCE(ca.claim_count, 0)  AS claim_count,
             COALESCE(ca.claim_amount, 0) AS claim_amount,
             COALESCE(ca.cases_gt_10k, 0) AS cases_gt_10k,
             COALESCE(ca.cases_gt_50k, 0) AS cases_gt_50k,
             COALESCE(ca.max_case, 0)     AS max_case
      FROM all_pol p
      LEFT JOIN claims_agg ca ON p.policy_no = ca.policy_no
    )
    SELECT * FROM joined
    """


def fetch(year, month_max=None):
    cur = con.execute(build_sql(year, month_max))
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


# ===== 聚合器（标准字段）=====
def new_agg():
    return {"policies":0,"premium":0.0,"pf_prem_w":0.0,"pf_w_sum":0.0,
            "claims":0,"amount":0.0,"g50":0}

def add_one(a, r):
    a["policies"] += 1
    prem = r["premium"] or 0
    a["premium"] += prem
    pf = r["commercial_pricing_factor"]
    # 保费加权自主系数（仅商业险有值；其他情况 pf 为 None → 跳过）
    if pf is not None and prem > 0:
        a["pf_prem_w"] += pf * prem
        a["pf_w_sum"]  += prem
    a["claims"] += r["claim_count"]
    a["amount"] += r["claim_amount"]
    a["g50"]    += r["cases_gt_50k"]

def fmt(a):
    p,prem,c,amt = a["policies"], a["premium"], a["claims"], a["amount"]
    return dict(
        policies=p,
        premium_wan=prem/10000,
        pf=(a["pf_prem_w"]/a["pf_w_sum"]) if a["pf_w_sum"]>0 else None,
        avg_prem=prem/p if p else 0,
        claims=c,
        amount_wan=amt/10000,
        incident=(c/p*100) if p else 0,
        avg_claim=(amt/c) if c else 0,
        loss_ratio=(amt/prem*100) if prem else 0,
        pct50=(a["g50"]/c*100) if c else 0,
    )

def row_md(label, a):
    f = fmt(a)
    pf_str = f"{f['pf']:.3f}" if f['pf'] is not None else "—"
    return (f"| {label} | {f['policies']:,} | {f['premium_wan']:,.1f} | {pf_str} | "
            f"{f['avg_prem']:,.0f} | {f['claims']:,} | {f['amount_wan']:,.1f} | "
            f"{f['incident']:.2f}% | {f['avg_claim']:,.0f} | {f['loss_ratio']:.1f}% | "
            f"{f['pct50']:.1f}% |")

HDR = ("| {dim} | 保单件数 | 保费(万) | 自主系数 | 件均保费(元) | "
       "赔案件数 | 赔款(万) | 满期出险率 | 案均赔款(元) | 满期赔付率 | >5万占比 |")
SEP = ("|------|---------:|---------:|--------:|-------------:|"
       "---------:|---------:|-----------:|-------------:|-----------:|---------:|")


def print_table(title, rows_iter, dim_fn, order_fn=None, min_n=1):
    print(f"\n### {title}\n")
    print(HDR.format(dim=title.split('.',1)[-1].strip().split(' ')[0] if ' ' in title else "维度"))
    print(SEP)
    groups = defaultdict(new_agg)
    total  = new_agg()
    for r in rows_iter:
        k = dim_fn(r)
        if k is None: continue
        add_one(groups[k], r)
        add_one(total, r)
    if order_fn:
        keys = sorted(groups.keys(), key=order_fn)
    else:
        keys = sorted(groups.keys(), key=lambda k: -groups[k]["policies"])
    # 合并过小组
    other = new_agg()
    for k in keys:
        a = groups[k]
        if a["policies"] < min_n:
            for kk in other: other[kk] += a[kk]
            continue
        print(row_md(f"**{k}**", a))
    if other["policies"] > 0:
        print(row_md(f"**其他(<{min_n})**", other))
    print(row_md("**合计**", total))


# ===== 拉数据 =====
rows_2025 = fetch(2025)
rows_2024_q = fetch(2024, month_max=4)
rows_2025_q = [r for r in rows_2025 if (r["start_month"] or 0) <= 4]  # 全等 rows_2025 因为 2025 只有 1-4 月满期

print(f"# 2025 明细行（去重后）: {len(rows_2025):,}")
print(f"# 2024 同期明细: {len(rows_2024_q):,}")


# ================= A. 2024 vs 2025 同期对比 =================
print("\n\n## A. 2024 vs 2025 同期对比（1-4 月起保，已满期）\n")
for bucket_name, bucket_key in [("车险整体", None), ("商业险","commercial"), ("交强险","compulsory")]:
    print(f"\n### {bucket_name}\n")
    print(HDR.format(dim="保险起期年"))
    print(SEP)
    for year, rows in [(2024, rows_2024_q), (2025, rows_2025)]:
        a = new_agg()
        for r in rows:
            if bucket_key and r["bucket"] != bucket_key: continue
            add_one(a, r)
        print(row_md(f"**{year}**", a))


# ================= B. 成都 vs 非成都 =================
def city(r): return "成都(川A/G)" if r["plate_no"] in ("川A","川G") else "其他四川"
print("\n\n## B. 2025 成都 vs 非成都\n")
for bucket_name, bucket_key in [("车险整体", None), ("商业险","commercial"), ("交强险","compulsory")]:
    sub = rows_2025 if bucket_key is None else [r for r in rows_2025 if r["bucket"]==bucket_key]
    print_table(f"B.{bucket_name}", sub, city,
                order_fn=lambda k: 0 if "成都" in k else 1)


# ================= C. insurance_grade =================
def grade(r): return r["insurance_grade"] or "未评级"
grade_order = {"A":0,"B":1,"C":2,"D":3,"E":4,"F":5,"G":6,"X":7,"未评级":8}
print("\n\n## C. 2025 insurance_grade\n")
for bucket_name, bucket_key in [("车险整体", None), ("商业险","commercial"), ("交强险","compulsory")]:
    sub = rows_2025 if bucket_key is None else [r for r in rows_2025 if r["bucket"]==bucket_key]
    print_table(f"C.{bucket_name}", sub, grade, order_fn=lambda k: grade_order.get(k,99))


# ================= D. 自主定价系数分档 =================
def pf_bin(r):
    pf = r["commercial_pricing_factor"]
    if pf is None: return None  # 交强险无此字段
    if pf < 0.75: return "<0.75（深折）"
    if pf < 0.85: return "0.75-0.85"
    if pf < 0.95: return "0.85-0.95"
    if pf < 1.05: return "0.95-1.05"
    if pf < 1.15: return "1.05-1.15"
    return "≥1.15"
pf_order = {"<0.75（深折）":0,"0.75-0.85":1,"0.85-0.95":2,"0.95-1.05":3,"1.05-1.15":4,"≥1.15":5}
print("\n\n## D. 2025 商车自主定价系数分档（含商业险 + 匹配的交强险）\n")
print_table("D.车险整体", rows_2025, pf_bin, order_fn=lambda k: pf_order.get(k,99))
print_table("D.商业险",
            [r for r in rows_2025 if r["bucket"]=="commercial"],
            pf_bin, order_fn=lambda k: pf_order.get(k,99))


# ================= E. 成都 × 等级 =================
print("\n\n## E. 2025 成都 × 评级（车险整体）\n")
for c in ("成都","非成都"):
    sub = [r for r in rows_2025 if (r["plate_no"] in ("川A","川G"))==(c=="成都")]
    print_table(f"E.{c}", sub, grade, order_fn=lambda k: grade_order.get(k,99))


# ================= F. 月度 =================
print("\n\n## F. 2025 月度起保（车险整体）\n")
print_table("F.按起保月", rows_2025,
            lambda r: f"{r['start_month']:02d}月",
            order_fn=lambda k: int(k[:2]))


# ================= G. 车龄 =================
def age_bin(r):
    fr = r["first_reg_date"]
    if not fr: return "未知"
    try:
        y = int(str(fr)[:4])
    except:
        return "未知"
    age = 2025 - y
    if age <= 0: return "新车(0年)"
    if age == 1: return "1年"
    if age == 2: return "2年"
    if age == 3: return "3年"
    if age <= 5: return "4-5年"
    if age <= 8: return "6-8年"
    if age <= 12:return "9-12年"
    return ">12年"
age_order = ["新车(0年)","1年","2年","3年","4-5年","6-8年","9-12年",">12年","未知"]
print("\n\n## G. 2025 车龄分段（车险整体）\n")
print_table("G.车龄", rows_2025, age_bin, order_fn=lambda k: age_order.index(k) if k in age_order else 99)


# ================= H. 新车购置价分段 =================
def price_bin(r):
    p = r["new_vehicle_price"]
    if not p or p <= 0: return "未知/0"
    if p < 5e4: return "<5万"
    if p < 10e4:return "5-10万"
    if p < 15e4:return "10-15万"
    if p < 20e4:return "15-20万"
    if p < 30e4:return "20-30万"
    if p < 50e4:return "30-50万"
    return "≥50万"
price_order = ["<5万","5-10万","10-15万","15-20万","20-30万","30-50万","≥50万","未知/0"]
print("\n\n## H. 2025 新车购置价分段（车险整体）\n")
print_table("H.购置价", rows_2025, price_bin, order_fn=lambda k: price_order.index(k) if k in price_order else 99)


# ================= I. 是否续保 =================
def renewal_fn(r):
    v = r["is_renewal"]
    if v is True: return "续保"
    if v is False: return "新保"
    return "未知"
print("\n\n## I. 2025 是否续保（车险整体）\n")
print_table("I.续保", rows_2025, renewal_fn,
            order_fn=lambda k: ["新保","续保","未知"].index(k))


# ================= J. 是否过户车 =================
def transfer_fn(r):
    v = r["is_transfer"]
    if v is True: return "过户车"
    if v is False: return "非过户"
    return "未知"
print("\n\n## J. 2025 是否过户车（车险整体）\n")
print_table("J.过户", rows_2025, transfer_fn,
            order_fn=lambda k: ["非过户","过户车","未知"].index(k))


# ================= K. 出单终端 =================
def terminal_fn(r):
    t = r["terminal_source"] or "未知"
    return t[:20]
print("\n\n## K. 2025 出单终端（车险整体）\n")
print_table("K.终端", rows_2025, terminal_fn, min_n=100)


# ================= L. 经代机构 TOP =================
def agent_fn(r):
    a = r["agent_name"] or "未知"
    # 只保留机构名称关键部分（去代码）
    return a[10:40] if len(a) > 10 else a
print("\n\n## L. 2025 经代机构（车险整体，≥100件）\n")
print_table("L.经代", rows_2025, agent_fn, min_n=100)


# ================= M. 三级机构 =================
print("\n\n## M. 2025 三级机构（车险整体，≥100件）\n")
print_table("M.三级机构", rows_2025, lambda r: r["org_level_3"] or "未知", min_n=100)


# ================= N. 赔案类型（2024 vs 2025 同期）=================
def fetch_cases(year, month_max):
    return con.execute(f"""
    WITH commercial_raw AS (
      SELECT policy_no, vehicle_frame_no, insurance_start_date
      FROM policy WHERE plate_no LIKE '川%' AND is_nev=false AND customer_category='非营业个人客车'
        AND coverage_combination='主全' AND insurance_type='商业保险' AND commercial_ncd='0.8'
        AND YEAR(insurance_start_date)={year} AND MONTH(insurance_start_date) <= {month_max}
        AND CAST(insurance_start_date AS DATE)+INTERVAL 1 YEAR <= DATE '{LATEST}'
    ),
    commercial_ins AS (
      SELECT DISTINCT policy_no, vehicle_frame_no FROM commercial_raw
    ),
    target AS (
      SELECT DISTINCT vehicle_frame_no, YEAR(MAX(insurance_start_date)) AS y
      FROM commercial_raw GROUP BY vehicle_frame_no
    ),
    compulsory AS (
      SELECT DISTINCT p.policy_no FROM policy p JOIN target t
        ON p.vehicle_frame_no=t.vehicle_frame_no AND YEAR(p.insurance_start_date)=t.y
      WHERE p.insurance_type='交强险' AND p.coverage_combination='主全'
        AND CAST(p.insurance_start_date AS DATE)+INTERVAL 1 YEAR <= DATE '{LATEST}'
    ),
    all_pol AS (SELECT policy_no FROM commercial_ins UNION ALL SELECT policy_no FROM compulsory)
    SELECT c.policy_no, c.claim_no,
           SUM(COALESCE(c.settled_amount,0)+COALESCE(c.pending_amount,0)) AS amt,
           STRING_AGG(DISTINCT c.loss_category, '|') AS loss_cat
    FROM claims c JOIN (SELECT DISTINCT policy_no FROM all_pol) a ON c.policy_no = a.policy_no
    GROUP BY c.policy_no, c.claim_no
    """).fetchall()

def classify_loss(cat):
    if not cat: return "未分类"
    if ("人员死亡" in cat) or ("人员重伤" in cat): return "重伤/死亡"
    if "人员轻伤" in cat: return "轻伤"
    has_veh  = ("本车车损" in cat) or ("第三者车损" in cat)
    has_prop = "第三者物损" in cat
    if has_veh and has_prop: return "车损+物损"
    if has_veh: return "纯车损"
    if has_prop:return "纯物损"
    return "其他"

print("\n\n## N. 赔案类型构成对比（2024 vs 2025 同期，1-4 月起保已满期）\n")
cases_24 = fetch_cases(2024, 4)
cases_25 = fetch_cases(2025, 4)
def loss_agg(cases):
    agg = defaultdict(lambda: [0, 0.0])
    for _, _, amt, cat in cases:
        k = classify_loss(cat); agg[k][0] += 1; agg[k][1] += amt or 0
    return agg
a24, a25 = loss_agg(cases_24), loss_agg(cases_25)
all_keys = ["重伤/死亡","轻伤","车损+物损","纯车损","纯物损","未分类","其他"]
print("| 赔案类型 | 2024案数 | 2024赔款(万) | 2024案均(元) | 2025案数 | 2025赔款(万) | 2025案均(元) | 案数Δ | 赔款Δ | 案均Δ |")
print("|------|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
tot24 = sum(a24[k][0] for k in a24); tot25 = sum(a25[k][0] for k in a25)
amt24 = sum(a24[k][1] for k in a24); amt25 = sum(a25[k][1] for k in a25)
for k in all_keys:
    c24, m24 = a24.get(k, [0,0]); c25, m25 = a25.get(k, [0,0])
    avg24 = m24/c24 if c24 else 0; avg25 = m25/c25 if c25 else 0
    dc = (c25-c24)/c24*100 if c24 else 0
    dm = (m25-m24)/m24*100 if m24 else 0
    da = (avg25-avg24)/avg24*100 if avg24 else 0
    if c24 == 0 and c25 == 0: continue
    print(f"| **{k}** | {c24:,} | {m24/10000:,.1f} | {avg24:,.0f} | {c25:,} | {m25/10000:,.1f} | {avg25:,.0f} | {dc:+.1f}% | {dm:+.1f}% | {da:+.1f}% |")
print(f"| **合计** | {tot24:,} | {amt24/10000:,.1f} | {amt24/tot24 if tot24 else 0:,.0f} | {tot25:,} | {amt25/10000:,.1f} | {amt25/tot25 if tot25 else 0:,.0f} | {(tot25-tot24)/tot24*100 if tot24 else 0:+.1f}% | {(amt25-amt24)/amt24*100 if amt24 else 0:+.1f}% | — |")


# ================= O. 赔款集中度 + Top N 大案 =================
print("\n\n## O. 2025 赔款集中度（验证大案驱动）\n")
SQL_CASES = f"""
WITH commercial_raw AS (
  SELECT policy_no, vehicle_frame_no
  FROM policy
  WHERE plate_no LIKE '川%' AND is_nev=false AND customer_category='非营业个人客车'
    AND coverage_combination='主全' AND insurance_type='商业保险' AND commercial_ncd='0.8'
    AND YEAR(insurance_start_date)=2025
    AND CAST(insurance_start_date AS DATE)+INTERVAL 1 YEAR <= DATE '{LATEST}'
),
commercial_ins AS (SELECT DISTINCT policy_no, vehicle_frame_no FROM commercial_raw),
target AS (SELECT DISTINCT vehicle_frame_no FROM commercial_raw),
compulsory AS (
  SELECT DISTINCT p.policy_no FROM policy p JOIN target t
    ON p.vehicle_frame_no=t.vehicle_frame_no
  WHERE p.insurance_type='交强险' AND p.coverage_combination='主全'
    AND YEAR(p.insurance_start_date)=2025
    AND CAST(p.insurance_start_date AS DATE)+INTERVAL 1 YEAR <= DATE '{LATEST}'
),
all_pol AS (SELECT policy_no FROM commercial_ins UNION SELECT policy_no FROM compulsory)
SELECT cc.claim_no, MIN(cc.policy_no) AS pno,
       MIN(cc.subject_plate_no) AS plate,
       SUM(COALESCE(cc.settled_amount,0)+COALESCE(cc.pending_amount,0)) AS amt,
       STRING_AGG(DISTINCT cc.loss_category, '|') AS loss_cat,
       MIN(cc.accident_city)  AS city,
       MIN(cc.claim_status)   AS status
FROM claims cc
JOIN all_pol ap ON cc.policy_no = ap.policy_no
GROUP BY cc.claim_no
HAVING SUM(COALESCE(cc.settled_amount,0)+COALESCE(cc.pending_amount,0)) > 0
ORDER BY amt DESC
"""
cases = con.execute(SQL_CASES).fetchall()
total_cases = len(cases)
total_amt = sum(c[3] for c in cases)
print(f"**去重后有效赔案**: {total_cases:,} 宗，总赔款 {total_amt/10000:,.1f} 万元")
print()
print("**Top 15 大案**：")
print("| # | 车牌 | 赔款(元) | 累计占比 | 事故城市 | 状态 | 赔案类型 |")
print("|--:|------|---------:|---------:|----------|------|----------|")
cum = 0
for i, c in enumerate(cases[:15], 1):
    cum += c[3]
    lc = (c[4] or "")[:40]
    print(f"| {i} | {c[2] or ''} | {c[3]:,.0f} | {cum/total_amt*100:.1f}% | {c[5] or ''} | {c[6] or ''} | {lc} |")

print("\n**集中度分位**：")
print("| Top N | 累计赔款(万) | 占比 |")
print("|--:|---------:|---------:|")
for n in [10, 20, 50, 100, 200, 500]:
    if n > total_cases: break
    s = sum(c[3] for c in cases[:n])
    print(f"| {n} | {s/10000:,.1f} | {s/total_amt*100:.1f}% |")
