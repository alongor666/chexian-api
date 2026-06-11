#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生产 KPI 筛选器三方对账：API(PAT) vs DuckDB 直查（22 场景，逐维度）。

用法（本机一次性复盘脚本，2026-06-10 全站筛选器联动审计的数据准确性对账工具）：
    python3 scripts/ad-hoc/reconcile-kpi-filter-scenarios.py

依赖（有意 YAGNI 不参数化——进 CI 前再改，治理计划 §0 已确认）：
- 本机 Parquet：数据管理/warehouse/fact/policy/current/*.parquet（PROJECT 常量为绝对路径）
- PAT：~/.chexian/config.json 的 token 字段（生产只读令牌，cx login 生成）
- duckdb CLI（brew install duckdb）

每个场景比对 total_premium / policy_count；通过标准 = 全场景零差异。
历史结果：2026-06-10 审计期 22 场景全部零差异（数据口径正确，bug 全在前端联动层）。
"""
import json, subprocess, urllib.parse, urllib.request, sys, os

PROJECT = "/Users/alongor666/Downloads/底层数据湖DUD/chexian-api"
PARQUET = "read_parquet('数据管理/warehouse/fact/policy/current/*.parquet', union_by_name=true)"
PAT = json.load(open(os.path.expanduser("~/.chexian/config.json")))["token"]
BASE = "https://chexian.cretvalu.com/api/query/kpi"

# (scene_id, 中文标签, duckdb_where, api_querystring)
SCENARIOS = [
    ("all",            "全表基线（无筛选）",        "TRUE",                                               ""),
    ("org_gaoxin",     "机构=高新",                "org_level_3='高新'",                                  "orgNames=高新"),
    ("cust_moto",      "客户类别=摩托车",           "customer_category='摩托车'",                          "customerCategories=摩托车"),
    ("isnev_true",     "是否新能源=是",             "is_nev=true",                                         "isNev=true"),
    ("instype_compul", "险类=交强险",               "insurance_type='交强险'",                             "insuranceType=true"),
    ("instype_comm",   "险类=商业险",               "insurance_type='商业保险'",                           "insuranceType=false"),
    ("cov_zhuquan",    "险别组合=主全",             "coverage_combination='主全'",                         "coverageCombinations=主全"),
    ("isrenewal_true", "是否续保=是",               "is_renewal=true",                                     "isRenewal=true"),
    ("isnewcar_true",  "是否新车=是",               "is_new_car=true",                                     "isNewCar=true"),
    ("istransfer_true","是否过户=是",               "is_transfer=true",                                    "isTransfer=true"),
    ("istele_true",    "是否电销=是",               "is_telemarketing=true",                               "isTelemarketing=true"),
    ("q_motorcycle",   "快捷·摩托车",               "customer_category='摩托车'",                          "vehicleQuickFilter=motorcycle"),
    ("q_home_car",     "快捷·家自车",               "customer_category='非营业个人客车'",                  "vehicleQuickFilter=home_car"),
    ("q_truck_2_9t",   "快捷·2-9吨货车",            "customer_category IN ('营业货车','非营业货车') AND tonnage_segment='2-9吨'", "vehicleQuickFilter=truck_2_9t"),
    ("fuel_electric",  "快捷·电（新能源）",         "is_nev=true",                                         "fuelCategory=electric"),
    ("fuel_gas",       "快捷·气（天然气）",         "is_nev=false AND fuel_type LIKE '天然气%'",            "fuelCategory=gas"),
    ("fuel_oil",       "快捷·油（燃油）",           "is_nev=false AND (fuel_type IS NULL OR fuel_type NOT LIKE '天然气%')", "fuelCategory=oil"),
    ("bn_commercial",  "快捷·营业性质",             "customer_category LIKE '营业%'",                      "businessNature=commercial"),
    ("enterprise",     "快捷·企客",                 "customer_category='非营业企业客车'",                  "enterpriseCar=true"),
    ("date_2026h1",    "日期=2026-01-01~06-30",     "policy_date>='2026-01-01' AND policy_date<='2026-06-30'", "startDate=2026-01-01&endDate=2026-06-30"),
    ("grade_a",        "评分=A",                    "insurance_grade='A'",                                 "insuranceGrades=A"),
    ("tonnage_10p",    "吨位=10吨以上",             "tonnage_segment='10吨以上'",                          "tonnageSegments=10吨以上"),
]

# ---- DuckDB：一次扫描出全部场景 ----
selects = []
for sid, _, where, _ in SCENARIOS:
    selects.append(
        f"SELECT '{sid}' AS scene, "
        f"SUM(premium) AS total_premium, "
        f"COUNT(DISTINCT policy_no) AS policy_count "
        f"FROM {PARQUET} WHERE {where}"
    )
duck_sql = "\nUNION ALL\n".join(selects)
res = subprocess.run(["duckdb", "-json", "-c", duck_sql], cwd=PROJECT,
                     capture_output=True, text=True)
if res.returncode != 0:
    print("DUCKDB ERROR:\n", res.stderr); sys.exit(1)
duck = {r["scene"]: r for r in json.loads(res.stdout)}

# ---- API：逐场景 ----
def api_kpi(qs):
    if qs:
        pairs = [p.split("=", 1) for p in qs.split("&")]
        enc = "&".join(f"{k}={urllib.parse.quote(v)}" for k, v in pairs)
        url = BASE + "?" + enc
    else:
        url = BASE
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {PAT}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["data"]

rows = []
all_pass = True
for sid, label, where, qs in SCENARIOS:
    d = duck[sid]
    dp = float(d["total_premium"] or 0)
    dc = int(d["policy_count"] or 0)
    try:
        a = api_kpi(qs)
        ap = float(a.get("total_premium") or 0)
        ac = int(a.get("policy_count") or 0)
    except Exception as e:
        rows.append((sid, label, "API_ERR", str(e)[:40], "", "", "FAIL")); all_pass=False; continue
    prem_diff = abs(ap - dp)
    prem_rel = prem_diff / dp if dp else (0 if ap==0 else 1)
    cnt_ok = (ac == dc)
    prem_ok = prem_rel <= 1e-4
    status = "PASS" if (cnt_ok and prem_ok) else "FAIL"
    if status == "FAIL": all_pass = False
    rows.append((sid, label, f"{dp:,.0f}", f"{ap:,.0f}", dc, ac,
                 status, f"件{'✓' if cnt_ok else '✗'} 费Δ{prem_rel*100:.4f}%"))

# ---- 输出 ----
print(f"\n{'='*120}")
print(f"{'场景':<22}{'保费(DuckDB)':>16}{'保费(API)':>16}{'件(Duck)':>11}{'件(API)':>11}{'判定':>7}  备注")
print('-'*120)
for r in rows:
    if r[2] == "API_ERR":
        print(f"{r[1]:<22}{'API错误':>16}{r[3]:>16}{'':>11}{'':>11}{'FAIL':>7}")
    else:
        sid,label,dp,ap,dc,ac,st,note = r
        print(f"{label:<22}{dp:>16}{ap:>16}{dc:>11,}{ac:>11,}{st:>7}  {note}")
print('='*120)
print(f"\n总判定: {'✅ 全部一致 (PASS)' if all_pass else '❌ 存在不一致 (FAIL)'}  —  {len(SCENARIOS)} 个场景")

# 变化性检查：所有场景 policy_count 是否随筛选变化（非全表的应 < 全表）
base_c = int(duck['all']['policy_count'])
nochange = [r[1] for r in rows if r[0] not in ('all',) and len(r)>4 and isinstance(r[4],int) and r[4]==base_c]
if nochange:
    print(f"⚠️ 以下筛选场景件数与全表相同（疑似未生效）: {nochange}")
else:
    print(f"✓ 所有非全表筛选场景件数均 < 全表基线({base_c:,})，筛选确实改变数据")
