#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""率值指标 + 多维组合筛选对账：API(PAT) vs DuckDB（72 指标项，含组合筛选）。

用法（本机一次性复盘脚本，2026-06-10 全站筛选器联动审计的数据准确性对账工具）：
    python3 scripts/ad-hoc/reconcile-kpi-rates-combos.py --province SC

依赖（有意 YAGNI 不参数化——进 CI 前再改，治理计划 §0 已确认）：
- 本机 Parquet：数据管理/warehouse/fact/policy/current/*.parquet（PROJECT 常量为绝对路径）
- PAT：~/.chexian/config.json 的 token 字段（生产只读令牌，cx login 生成）
- duckdb CLI（brew install duckdb）

覆盖率值指标（满期赔付率等比值类）与多维组合筛选场景；通过标准 = 全项零差异。
历史结果：2026-06-10 审计期 72 指标项全部零差异。
"""
import json, subprocess, urllib.parse, urllib.request, os, sys

PROJECT = "/Users/alongor666/Downloads/底层数据湖DUD/chexian-api"
from pathlib import Path as _Path
if PROJECT + "/数据管理" not in sys.path:
    sys.path.insert(0, PROJECT + "/数据管理")  # 供 import pipelines.*（branch_paths SSOT · 801409 cutover 前置）
from pipelines.branch_paths import (  # noqa: E402
    PolicyCurrentLayoutError,
    policy_current_glob,
    resolve_province,
)

# 省份轴收窄（50d62e）：--province fail-closed 必填，禁全省混查（data-pipeline.md 红线）
import argparse  # noqa: E402
_ap = argparse.ArgumentParser(description="率值指标 + 多维组合筛选对账（API vs DuckDB）")
_ap.add_argument("--province", required=True,
                 help="省份代码（仅接受已注册省份如 SC/SX，缺省/未知即报错中止）")
try:
    PROVINCE = resolve_province(_ap.parse_args().province)
except PolicyCurrentLayoutError as e:
    raise SystemExit(f"❌ {e}")
_POLICY_GLOB = policy_current_glob(_Path(PROJECT) / "数据管理/warehouse/fact/policy/current", PROVINCE, missing_ok=True)
# WHERE branch_code 是省份隔离保证（glob 收窄仅性能辅助）
PARQUET = f"(SELECT * FROM read_parquet('{_POLICY_GLOB}', union_by_name=true) WHERE branch_code = '{PROVINCE}')"
PAT = json.load(open(os.path.expanduser("~/.chexian/config.json")))["token"]
BASE = "https://chexian.cretvalu.com/api/query/kpi"

QUALITY = ("((is_nev = false AND (customer_category LIKE '%非营业个人%' OR customer_category LIKE '%企业%' "
           "OR customer_category LIKE '%机关%')) OR (customer_category LIKE '%货车%' "
           "AND tonnage_segment IN ('1吨以下', '2-9吨')))")

# 指标: (字段名, DuckDB 表达式, 是否计数型)
METRICS = [
    ("total_premium", "SUM(premium)", False),
    ("policy_count", "COUNT(DISTINCT policy_no)", True),
    ("org_count", "COUNT(DISTINCT org_level_3)", True),
    ("salesman_count", "COUNT(DISTINCT salesman_name)", True),
    ("transfer_rate", "COUNT(CASE WHEN is_transfer THEN 1 END)*1.0/NULLIF(COUNT(*),0)", False),
    ("telesales_rate", "COUNT(CASE WHEN is_telemarketing THEN 1 END)*1.0/NULLIF(COUNT(*),0)", False),
    ("renewal_rate", "COUNT(CASE WHEN is_renewal THEN 1 END)*1.0/NULLIF(COUNT(*),0)", False),
    ("commercial_rate", "SUM(CASE WHEN insurance_type='商业保险' THEN premium ELSE 0 END)*1.0/NULLIF(SUM(premium),0)", False),
    ("nev_rate", "COUNT(CASE WHEN is_nev THEN 1 END)*1.0/NULLIF(COUNT(*),0)", False),
    ("new_car_rate", "COUNT(CASE WHEN is_new_car THEN 1 END)*1.0/NULLIF(COUNT(*),0)", False),
    ("commercial_insurance_rate", "COUNT(CASE WHEN insurance_type LIKE '%商业%' THEN 1 END)*1.0/NULLIF(COUNT(CASE WHEN insurance_type='交强险' THEN 1 END),0)", False),
    ("quality_business_rate", f"COUNT(CASE WHEN {QUALITY} THEN 1 END)*1.0/NULLIF(COUNT(*),0)", False),
]

SCENARIOS = [
    ("all",    "全表基线",                       "TRUE", ""),
    ("gaoxin", "机构=高新",                       "org_level_3='高新'", "orgNames=高新"),
    ("moto",   "客户类别=摩托车",                  "customer_category='摩托车'", "customerCategories=摩托车"),
    ("isnev",  "是否新能源=是",                    "is_nev=true", "isNev=true"),
    ("combo1", "组合：高新 ∩ 新能源",             "org_level_3='高新' AND is_nev=true", "orgNames=高新&isNev=true"),
    ("combo2", "组合：家自车∩交强∩新车",          "customer_category='非营业个人客车' AND insurance_type='交强险' AND is_new_car=true",
                "customerCategories=非营业个人客车&insuranceType=true&isNewCar=true"),
]

# DuckDB：一次扫描全部场景
cols = ", ".join(f"{expr} AS {name}" for name, expr, _ in METRICS)
selects = [f"SELECT '{sid}' AS scene, {cols} FROM {PARQUET} WHERE {where}" for sid,_,where,_ in SCENARIOS]
res = subprocess.run(["duckdb","-json","-c","\nUNION ALL\n".join(selects)], cwd=PROJECT, capture_output=True, text=True)
if res.returncode != 0:
    print("DUCKDB ERR\n", res.stderr); sys.exit(1)
duck = {r["scene"]: r for r in json.loads(res.stdout)}

def api_kpi(qs):
    if qs:
        pairs=[p.split("=",1) for p in qs.split("&")]
        url=BASE+"?"+"&".join(f"{k}={urllib.parse.quote(v)}" for k,v in pairs)
    else: url=BASE
    req=urllib.request.Request(url, headers={"Authorization":f"Bearer {PAT}"})
    with urllib.request.urlopen(req,timeout=30) as r: return json.load(r)["data"]

all_pass=True
for sid,label,where,qs in SCENARIOS:
    d=duck[sid]; a=api_kpi(qs)
    print(f"\n■ {label}   [{qs or '无筛选'}]")
    fails=[]
    for name,_,is_count in METRICS:
        dv=d.get(name); av=a.get(name)
        if dv is None: dv=0
        if av is None: av=0
        dv=float(dv); av=float(av)
        if is_count:
            ok = int(round(dv))==int(round(av))
        else:
            ok = abs(av-dv) <= max(1e-4*abs(dv), 1e-6)
        if not ok: fails.append(name); all_pass=False
        flag="✓" if ok else "✗ FAIL"
        if name in ("total_premium",):
            print(f"   {name:<26} Duck={dv:>16,.0f}  API={av:>16,.0f}  {flag}")
        elif is_count:
            print(f"   {name:<26} Duck={int(dv):>16,}  API={int(av):>16,}  {flag}")
        else:
            print(f"   {name:<26} Duck={dv:>16.6f}  API={av:>16.6f}  {flag}")
    if fails: print(f"   ⚠️ 不一致: {fails}")

print(f"\n{'='*60}\n总判定: {'✅ 全部一致 (PASS)' if all_pass else '❌ 存在不一致'}  —  {len(SCENARIOS)} 场景 × {len(METRICS)} 指标 = {len(SCENARIOS)*len(METRICS)} 项")
