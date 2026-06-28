#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
过户车多维度交叉诊断脚本 v1.0

5年合并分析（不分年度），支持单维度 + 多维度交叉分析。

使用:
    python3 数据管理/pipelines/diagnose_transfer_merged.py
    python3 数据管理/pipelines/diagnose_transfer_merged.py --sections 1,2,3

版本: 1.0.0
作者: @claude
日期: 2026-04-01
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb"); sys.exit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_common import (
    GLOB, kpi_select, escape_sql, joined_source,
    fw, fp, fi, fc, light,
    TH_VC, TH_MR, TH_LR, TH_IR, TH_AC_CARGO,
    POLICY_TERM, EARNED_DAYS, EARNED,
    branch_paths,
)
from diagnose_report import Report


# ============================================================================
# 路径常量（使用 current 目录）
# ============================================================================
import os as _os
_BRANCH_CODE = (_os.environ.get("BRANCH_CODE") or "SC").strip() or "SC"
_PATHS = branch_paths(_BRANCH_CODE)
GLOB_CURRENT = _PATHS["policy_glob"]
BRAND_DIM = str(Path(__file__).resolve().parent.parent / "warehouse/dim/brand/latest.parquet")
BRAND_KEY_EXPR = (
    "COALESCE(NULLIF(TRIM(b.brand), ''), '未知品牌') || '_' || "
    "COALESCE(NULLIF(TRIM(b.vehicle_class), ''), '未知车型分类')"
)
OUT_DIR = str(Path(__file__).resolve().parent.parent / "数据分析报告")

# ============================================================================
# 车龄计算 SQL
# ============================================================================
# 车龄 = policy_date年份 - 初次登记年份
VEHICLE_AGE_EXPR = """
    CASE
        WHEN first_registration_date IS NULL OR first_registration_date = '' THEN NULL
        ELSE
            YEAR(policy_date) - CAST(SUBSTRING(first_registration_date, 1, 4) AS INT)
    END
"""

# 车龄分段
VEHICLE_AGE_BUCKET = """
    CASE
        WHEN {vehicle_age} IS NULL THEN '未知'
        WHEN {vehicle_age} <= 3 THEN '3年及以下'
        WHEN {vehicle_age} <= 6 THEN '4-6年'
        WHEN {vehicle_age} <= 10 THEN '7-10年'
        ELSE '10年以上'
    END
"""

# 车价分段
PRICE_BUCKET = """
    CASE
        WHEN new_vehicle_price < 100000 THEN '10万以下'
        WHEN new_vehicle_price < 200000 THEN '10-20万'
        WHEN new_vehicle_price < 500000 THEN '20-50万'
        ELSE '50万以上'
    END
"""


# ============================================================================
# 基础筛选条件
# ============================================================================
BASE_FILTER = "customer_category = '非营业个人客车' AND is_transfer = true"


def parse_ids(s: str) -> set:
    """解析逗号分隔的板块 ID"""
    return {int(x.strip()) for x in s.split(",") if x.strip()}


def section_01_overview(ctx, rpt, silent=False):
    """板块 1: 整体经营概况（5年合并）"""
    con = ctx.con

    result = con.execute(f"""
    SELECT
            COUNT(*) as total_records,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as total_premium_wan,
            SUM(premium * {POLICY_TERM})/10000/365 as avg_daily_premium,
            SUM(reported_claims)/10000 as total_claims_wan,
            SUM(claim_cases) as total_claim_cases,
            SUM({EARNED})/10000 as total_earned_premium_wan,
            SUM(fee_amount)/10000 as total_fee_wan,
            AVG(commercial_pricing_factor) as avg_pricing_coeff,
            MIN(policy_date)::DATE as min_date,
            MAX(policy_date)::DATE as max_date
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
    """).fetchone()

    data = {
        "total_records": result[0],
        "policy_count": result[1],
        "total_premium_wan": result[2],
        "total_claims_wan": result[4],
        "total_claim_cases": result[5],
        "total_earned_premium_wan": result[6],
        "total_fee_wan": result[7],
        "avg_pricing_coeff": result[8],
        "min_date": str(result[9]),
        "max_date": str(result[10]),
    }

    # 计算率值指标
    if result[6] and result[6] > 0:
        data["loss_ratio"] = (result[4] or 0) / result[6] * 100
        data["expense_ratio"] = (result[7] or 0) / result[2] * 100
        data["vc_ratio"] = data["loss_ratio"] + data["expense_ratio"]
        data["earned_margin"] = result[6] * (1 - data["loss_ratio"]/100 - data["expense_ratio"]/100)
    else:
        data["loss_ratio"] = data["expense_ratio"] = data["vc_ratio"] = 0
        data["earned_margin"] = 0

    if result[5] and result[5] > 0:
        data["avg_claim"] = (result[4] or 0) / result[5] * 10000  # 转换为元
    else:
        data["avg_claim"] = 0

    if result[1] and result[1] > 0:
        data["incident_rate"] = con.execute(f"""
            SELECT SUM(claim_cases * {POLICY_TERM} / NULLIF({EARNED_DAYS}, 0)) / COUNT(DISTINCT policy_no) * 100
            FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
            WHERE {BASE_FILTER}
        """).fetchone()[0] or 0
    else:
        data["incident_rate"] = 0

    if not silent:
        rpt.add("## 1. 整体经营概况（5年合并）\n")
        rpt.add(f"> **数据范围**: {data['min_date']} ~ {data['max_date']}\n")
        rpt.add(f"> **保单数**: {data['policy_count']:,} | **总premium**: {data['total_premium_wan']:.1f}万元\n")
        rpt.add()
        rpt.add("| 指标 | 值 | 亮灯 |")
        rpt.add("|:---|---:|:---:|")
        rpt.add(f"| 总premium(万元) | {fw(data['total_premium_wan'])} | - |")
        rpt.add(f"| 满期premium(万元) | {fw(data['total_earned_premium_wan'])} | - |")
        rpt.add(f"| 满期赔付率 | {fp(data['loss_ratio'])} | {light(data['loss_ratio'], TH_LR)} |")
        rpt.add(f"| 费用率 | {fp(data['expense_ratio'])} | - |")
        rpt.add(f"| 变动成本率 | {fp(data['vc_ratio'])} | {light(data['vc_ratio'], TH_VC)} |")
        rpt.add(f"| 边际贡献额(万元) | {fw(data['earned_margin'])} | {light(100-data['vc_ratio'], TH_MR)} |")
        rpt.add(f"| 案均赔款(元) | {fi(data['avg_claim'])}† | {light(data['avg_claim'], TH_AC_CARGO)} |")
        rpt.add(f"| 满期出险率 | {fp(data['incident_rate'])} | {light(data['incident_rate'], TH_IR)} |")
        rpt.add(f"| 商车定价系数 | {fc(data['avg_pricing_coeff'])} | - |")
        rpt.add()
        rpt.add("> † 案均赔款 = reported_claims / claim_cases\n")

    return data


def section_02_brand(ctx, rpt, silent=False):
    """板块 2: 品牌维度"""
    con = ctx.con
    src = joined_source(con)

    # 检查品牌维度表
    if not Path(BRAND_DIM).exists():
        if not silent:
            rpt.add("## 2. 品牌维度\n")
            rpt.add("> ⚠️ 品牌维度表不存在，使用vehicle_model前缀提取品牌\n")
        # 使用vehicle_model前缀提取品牌（修复转义序列）
        brand_sql = f"""
            SELECT
                REGEXP_EXTRACT(p.vehicle_model, '^([\u4e00-\u9fff][\u4e00-\u9fff\\-]*)', 1) as brand,
                COUNT(DISTINCT p.policy_no) as policy_count,
                SUM(p.premium)/10000 as written_premium,
                SUM({EARNED})/10000 as earned_premium,
                SUM(p.reported_claims)/10000 as reported_claims,
                SUM(p.claim_cases) as claim_cases,
                SUM({EARNED}) * (1 - SUM(p.reported_claims)/NULLIF(SUM({EARNED}), 0) - SUM(p.fee_amount)/NULLIF(SUM(p.premium), 0))/10000 as earned_margin
            FROM {src} p
            WHERE {BASE_FILTER} AND p.vehicle_model IS NOT NULL
            GROUP BY 1
            HAVING COUNT(DISTINCT policy_no) >= 100
            ORDER BY written_premium DESC
        """
    else:
        brand_sql = f"""
            SELECT
                {BRAND_KEY_EXPR} as brand,
                COUNT(DISTINCT p.policy_no) as policy_count,
                SUM(p.premium)/10000 as written_premium,
                SUM({EARNED})/10000 as earned_premium,
                SUM(p.reported_claims)/10000 as reported_claims,
                SUM(p.claim_cases) as claim_cases,
                SUM({EARNED}) * (1 - SUM(p.reported_claims)/NULLIF(SUM({EARNED}), 0) - SUM(p.fee_amount)/NULLIF(SUM(p.premium), 0))/10000 as earned_margin
            FROM {src} p
            LEFT JOIN read_parquet('{BRAND_DIM}') b ON p.vehicle_model = b.vehicle_model_name
            WHERE {BASE_FILTER}
            GROUP BY 1
            HAVING COUNT(DISTINCT p.policy_no) >= 100
            ORDER BY written_premium DESC
        """

    result = con.execute(brand_sql).fetchall()

    data = {"brands": []}
    for row in result:
        brand_data = {
            "brand": row[0],
            "policy_count": row[1],
            "written_premium": row[2],
            "earned_premium": row[3],
            "reported_claims": row[4],
            "claim_cases": row[5],
            "earned_margin": row[6],
        }
        # 计算率值
        if row[3] and row[3] > 0:
            brand_data["loss_ratio"] = (row[4] or 0) / row[3] * 100
        else:
            brand_data["loss_ratio"] = 0
        if row[5] and row[5] > 0:
            brand_data["avg_claim"] = (row[4] or 0) / row[5] * 10000  # 转换为元
        else:
            brand_data["avg_claim"] = 0
        data["brands"].append(brand_data)

    if not silent:
        rpt.add("## 2. 品牌×车型分类维度（保单≥100）\n")
        rpt.add("| 品牌_车型分类 | 保单数 | premium(万) | 赔付率 | 案均赔款† | 边际贡献(万) |")
        rpt.add("|:---|---:|---:|---:|---:|---:|")
        for b in data["brands"][:20]:
            rpt.add(
                f"| {b['brand']} "
                f"| {fi(b['policy_count'])} "
                f"| {fw(b['written_premium'])} "
                f"| {fp(b['loss_ratio'])}{light(b['loss_ratio'], TH_LR)} "
                f"| {fi(b['avg_claim'])}{light(b['avg_claim'], TH_AC_CARGO)} "
                f"| {fw(b['earned_margin'])} |"
            )
        rpt.add()
        rpt.add("> † 案均赔款单位为元\n")

    return data


def section_03_vehicle_age(ctx, rpt, silent=False):
    """板块 3: 车龄维度"""
    con = ctx.con

    vehicle_age_expr = VEHICLE_AGE_EXPR.format(vehicle_age=VEHICLE_AGE_EXPR.split("AS")[0].strip())

    result = con.execute(f"""
        SELECT
            {VEHICLE_AGE_BUCKET.format(vehicle_age=VEHICLE_AGE_EXPR)} as age_bucket,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases,
            SUM({EARNED}) * (1 - SUM(reported_claims)/NULLIF(SUM({EARNED}), 0) - SUM(fee_amount)/NULLIF(SUM(premium), 0))/10000 as earned_margin
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
        GROUP BY age_bucket
        ORDER BY
            CASE age_bucket
                WHEN '3年及以下' THEN 1
                WHEN '4-6年' THEN 2
                WHEN '7-10年' THEN 3
                WHEN '10年以上' THEN 4
                ELSE 5
            END
    """).fetchall()

    data = {"ages": []}
    for row in result:
        age_data = {
            "age_bucket": row[0],
            "policy_count": row[1],
            "written_premium": row[2],
            "earned_premium": row[3],
            "reported_claims": row[4],
            "claim_cases": row[5],
            "earned_margin": row[6],
        }
        if row[3] and row[3] > 0:
            age_data["loss_ratio"] = (row[4] or 0) / row[3] * 100
        else:
            age_data["loss_ratio"] = 0
        if row[5] and row[5] > 0:
            age_data["avg_claim"] = (row[4] or 0) / row[5] * 10000  # 转换为元
        else:
            age_data["avg_claim"] = 0
        data["ages"].append(age_data)

    if not silent:
        rpt.add("## 3. 车龄维度\n")
        rpt.add("| 车龄分段 | 保单数 | premium(万) | 赔付率 | 案均赔款† | 边际贡献(万) |")
        rpt.add("|:---|---:|---:|---:|---:|---:|")
        for a in data["ages"]:
            rpt.add(
                f"| {a['age_bucket']} "
                f"| {fi(a['policy_count'])} "
                f"| {fw(a['written_premium'])} "
                f"| {fp(a['loss_ratio'])}{light(a['loss_ratio'], TH_LR)} "
                f"| {fi(a['avg_claim'])}{light(a['avg_claim'], TH_AC_CARGO)} "
                f"| {fw(a['earned_margin'])} |"
            )
        rpt.add()

    return data


def section_04_price(ctx, rpt, silent=False):
    """板块 4: 车价维度"""
    con = ctx.con

    result = con.execute(f"""
        SELECT
            {PRICE_BUCKET} as price_bucket,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases,
            AVG(new_vehicle_price)/10000 as avg_price,
            SUM({EARNED}) * (1 - SUM(reported_claims)/NULLIF(SUM({EARNED}), 0) - SUM(fee_amount)/NULLIF(SUM(premium), 0))/10000 as earned_margin
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER} AND new_vehicle_price > 0
        GROUP BY price_bucket
        ORDER BY
            CASE price_bucket
                WHEN '10万以下' THEN 1
                WHEN '10-20万' THEN 2
                WHEN '20-50万' THEN 3
                ELSE 4
            END
    """).fetchall()

    data = {"prices": []}
    for row in result:
        price_data = {
            "price_bucket": row[0],
            "policy_count": row[1],
            "written_premium": row[2],
            "earned_premium": row[3],
            "reported_claims": row[4],
            "claim_cases": row[5],
            "avg_price": row[6],
            "earned_margin": row[7],
        }
        if row[3] and row[3] > 0:
            price_data["loss_ratio"] = (row[4] or 0) / row[3] * 100
        else:
            price_data["loss_ratio"] = 0
        if row[5] and row[5] > 0:
            price_data["avg_claim"] = (row[4] or 0) / row[5] * 10000  # 转换为元
        else:
            price_data["avg_claim"] = 0
        data["prices"].append(price_data)

    if not silent:
        rpt.add("## 4. 车价维度\n")
        rpt.add("| 车价分段 | 保单数 | 均价(万) | premium(万) | 赔付率 | 案均赔款† | 边际贡献(万) |")
        rpt.add("|:---|---:|---:|---:|---:|---:|---:|")
        for p in data["prices"]:
            rpt.add(
                f"| {p['price_bucket']} "
                f"| {fi(p['policy_count'])} "
                f"| {fw(p['avg_price'])} "
                f"| {fw(p['written_premium'])} "
                f"| {fp(p['loss_ratio'])}{light(p['loss_ratio'], TH_LR)} "
                f"| {fi(p['avg_claim'])}{light(p['avg_claim'], TH_AC_CARGO)} "
                f"| {fw(p['earned_margin'])} |"
            )
        rpt.add()

    return data


def section_05_org(ctx, rpt, silent=False):
    """板块 5: org_level_3维度"""
    con = ctx.con

    result = con.execute(f"""
        SELECT
            org_level_3 as org,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases,
            SUM({EARNED}) * (1 - SUM(reported_claims)/NULLIF(SUM({EARNED}), 0) - SUM(fee_amount)/NULLIF(SUM(premium), 0))/10000 as earned_margin
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
        GROUP BY org_level_3
        ORDER BY written_premium DESC
    """).fetchall()

    data = {"orgs": []}
    for row in result:
        org_data = {
            "org": row[0],
            "policy_count": row[1],
            "written_premium": row[2],
            "earned_premium": row[3],
            "reported_claims": row[4],
            "claim_cases": row[5],
            "earned_margin": row[6],
        }
        if row[3] and row[3] > 0:
            org_data["loss_ratio"] = (row[4] or 0) / row[3] * 100
        else:
            org_data["loss_ratio"] = 0
        if row[5] and row[5] > 0:
            org_data["avg_claim"] = (row[4] or 0) / row[5] * 10000  # 转换为元
        else:
            org_data["avg_claim"] = 0
        data["orgs"].append(org_data)

    if not silent:
        rpt.add("## 5. org_level_3维度\n")
        rpt.add("| 机构 | 保单数 | premium(万) | 赔付率 | 案均赔款† | 边际贡献(万) |")
        rpt.add("|:---|---:|---:|---:|---:|---:|")
        for o in data["orgs"]:
            rpt.add(
                f"| {o['org']} "
                f"| {fi(o['policy_count'])} "
                f"| {fw(o['written_premium'])} "
                f"| {fp(o['loss_ratio'])}{light(o['loss_ratio'], TH_LR)} "
                f"| {fi(o['avg_claim'])}{light(o['avg_claim'], TH_AC_CARGO)} "
                f"| {fw(o['earned_margin'])} |"
            )
        rpt.add()

    return data


def section_06_insurance(ctx, rpt, silent=False):
    """板块 6: insurance_type/coverage_combination维度"""
    con = ctx.con

    # insurance_type分布
    insurance_result = con.execute(f"""
        SELECT
            insurance_type as insurance_type,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
        GROUP BY insurance_type
        ORDER BY written_premium DESC
    """).fetchall()

    # coverage_combination分布
    combo_result = con.execute(f"""
        SELECT
            coverage_combination as combo,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
        GROUP BY coverage_combination
        ORDER BY written_premium DESC
    """).fetchall()

    data = {"insurance_types": [], "combos": []}

    for row in insurance_result:
        ins_data = {
            "insurance_type": row[0],
            "policy_count": row[1],
            "written_premium": row[2],
            "earned_premium": row[3],
            "reported_claims": row[4],
            "claim_cases": row[5],
        }
        if row[3] and row[3] > 0:
            ins_data["loss_ratio"] = (row[4] or 0) / row[3] * 100
        else:
            ins_data["loss_ratio"] = 0
        if row[5] and row[5] > 0:
            ins_data["avg_claim"] = (row[4] or 0) / row[5] * 10000  # 转换为元
        else:
            ins_data["avg_claim"] = 0
        data["insurance_types"].append(ins_data)

    for row in combo_result:
        combo_data = {
            "combo": row[0],
            "policy_count": row[1],
            "written_premium": row[2],
            "earned_premium": row[3],
            "reported_claims": row[4],
            "claim_cases": row[5],
        }
        if row[3] and row[3] > 0:
            combo_data["loss_ratio"] = (row[4] or 0) / row[3] * 100
        else:
            combo_data["loss_ratio"] = 0
        if row[5] and row[5] > 0:
            combo_data["avg_claim"] = (row[4] or 0) / row[5] * 10000  # 转换为元
        else:
            combo_data["avg_claim"] = 0
        data["combos"].append(combo_data)

    if not silent:
        rpt.add("## 6. insurance_type/coverage_combination维度\n")

        rpt.add("### 6.1 insurance_type分布\n")
        rpt.add("| insurance_type | 保单数 | premium(万) | 赔付率 | 案均赔款† |")
        rpt.add("|:---|---:|---:|---:|---:|")
        for ins in data["insurance_types"]:
            rpt.add(
                f"| {ins['insurance_type']} "
                f"| {fi(ins['policy_count'])} "
                f"| {fw(ins['written_premium'])} "
                f"| {fp(ins['loss_ratio'])}{light(ins['loss_ratio'], TH_LR)} "
                f"| {fi(ins['avg_claim'])} |"
            )
        rpt.add()

        rpt.add("### 6.2 coverage_combination分布\n")
        rpt.add("| coverage_combination | 保单数 | premium(万) | 赔付率 | 案均赔款† |")
        rpt.add("|:---|---:|---:|---:|---:|")
        for c in data["combos"]:
            rpt.add(
                f"| {c['combo']} "
                f"| {fi(c['policy_count'])} "
                f"| {fw(c['written_premium'])} "
                f"| {fp(c['loss_ratio'])}{light(c['loss_ratio'], TH_LR)} "
                f"| {fi(c['avg_claim'])} |"
            )
        rpt.add()

    return data


def section_07_brand_org(ctx, rpt, silent=False):
    """板块 7: 品牌×机构交叉分析（多维度）"""
    con = ctx.con
    src = joined_source(con)

    # 品牌 Top 10 × 机构
    if not Path(BRAND_DIM).exists():
        brand_field = r"REGEXP_EXTRACT(vehicle_model, '^([\u4e00-\u9fff][\u4e00-\u9fff\\-]*)', 1)"
    else:
        brand_field = BRAND_KEY_EXPR

    join_clause = f"LEFT JOIN read_parquet('{BRAND_DIM}') b ON p.vehicle_model = b.vehicle_model_name" if Path(BRAND_DIM).exists() else ""

    result = con.execute(f"""
        SELECT
            {brand_field} as brand,
            org_level_3 as org,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases
        FROM {src} p
        {join_clause}
        WHERE {BASE_FILTER}
        GROUP BY 1, org_level_3
        HAVING COUNT(DISTINCT policy_no) >= 50
        ORDER BY written_premium DESC
        LIMIT 30
    """).fetchall()

    data = {"cross": []}
    for row in result:
        cross_data = {
            "brand": row[0],
            "org": row[1],
            "policy_count": row[2],
            "written_premium": row[3],
            "earned_premium": row[4],
            "reported_claims": row[5],
            "claim_cases": row[6],
        }
        if row[4] and row[4] > 0:
            cross_data["loss_ratio"] = (row[5] or 0) / row[4] * 100
        else:
            cross_data["loss_ratio"] = 0
        if row[6] and row[6] > 0:
            cross_data["avg_claim"] = (row[5] or 0) / row[6]
        else:
            cross_data["avg_claim"] = 0
        data["cross"].append(cross_data)

    if not silent:
        rpt.add("## 7. 品牌×车型分类×机构交叉分析（保单≥50）\n")
        rpt.add("> **发现风险组合**: 关注高赔付率 + 高案均赔款的组合\n")
        rpt.add()
        rpt.add("| 品牌_车型分类 | 机构 | 保单数 | premium(万) | 赔付率 | 案均赔款† |")
        rpt.add("|:---|:---|---:|---:|---:|---:|")
        for c in data["cross"]:
            rpt.add(
                f"| {c['brand']} "
                f"| {c['org']} "
                f"| {fi(c['policy_count'])} "
                f"| {fw(c['written_premium'])} "
                f"| {fp(c['loss_ratio'])}{light(c['loss_ratio'], TH_LR)} "
                f"| {fi(c['avg_claim'])}{light(c['avg_claim'], TH_AC_CARGO)} |"
            )
        rpt.add()

    return data


def section_08_price_combo(ctx, rpt, silent=False):
    """板块 8: 车价×coverage_combination交叉分析（多维度）"""
    con = ctx.con

    result = con.execute(f"""
        SELECT
            {PRICE_BUCKET} as price_bucket,
            coverage_combination as combo,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER} AND new_vehicle_price > 0
        GROUP BY price_bucket, coverage_combination
        HAVING COUNT(DISTINCT policy_no) >= 50
        ORDER BY written_premium DESC
    """).fetchall()

    data = {"cross": []}
    for row in result:
        cross_data = {
            "price_bucket": row[0],
            "combo": row[1],
            "policy_count": row[2],
            "written_premium": row[3],
            "earned_premium": row[4],
            "reported_claims": row[5],
            "claim_cases": row[6],
        }
        if row[4] and row[4] > 0:
            cross_data["loss_ratio"] = (row[5] or 0) / row[4] * 100
        else:
            cross_data["loss_ratio"] = 0
        if row[6] and row[6] > 0:
            cross_data["avg_claim"] = (row[5] or 0) / row[6]
        else:
            cross_data["avg_claim"] = 0
        data["cross"].append(cross_data)

    if not silent:
        rpt.add("## 8. 车价×coverage_combination交叉分析（保单≥50）\n")
        rpt.add("> **风险发现**: 高车价+全险组合的赔付情况\n")
        rpt.add()
        rpt.add("| 车价分段 | coverage_combination | 保单数 | premium(万) | 赔付率 | 案均赔款† |")
        rpt.add("|:---|:---|---:|---:|---:|---:|")
        for c in data["cross"]:
            rpt.add(
                f"| {c['price_bucket']} "
                f"| {c['combo']} "
                f"| {fi(c['policy_count'])} "
                f"| {fw(c['written_premium'])} "
                f"| {fp(c['loss_ratio'])}{light(c['loss_ratio'], TH_LR)} "
                f"| {fi(c['avg_claim'])}{light(c['avg_claim'], TH_AC_CARGO)} |"
            )
        rpt.add()

    return data


def section_09_age_insurance(ctx, rpt, silent=False):
    """板块 9: 车龄×insurance_type交叉分析（多维度）"""
    con = ctx.con

    result = con.execute(f"""
        SELECT
            {VEHICLE_AGE_BUCKET.format(vehicle_age=VEHICLE_AGE_EXPR)} as age_bucket,
            insurance_type as insurance_type,
            COUNT(DISTINCT policy_no) as policy_count,
            SUM(premium)/10000 as written_premium,
            SUM({EARNED})/10000 as earned_premium,
            SUM(reported_claims)/10000 as reported_claims,
            SUM(claim_cases) as claim_cases
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
        GROUP BY age_bucket, insurance_type
        HAVING COUNT(DISTINCT policy_no) >= 50
        ORDER BY written_premium DESC
    """).fetchall()

    data = {"cross": []}
    for row in result:
        cross_data = {
            "age_bucket": row[0],
            "insurance_type": row[1],
            "policy_count": row[2],
            "written_premium": row[3],
            "earned_premium": row[4],
            "reported_claims": row[5],
            "claim_cases": row[6],
        }
        if row[4] and row[4] > 0:
            cross_data["loss_ratio"] = (row[5] or 0) / row[4] * 100
        else:
            cross_data["loss_ratio"] = 0
        if row[6] and row[6] > 0:
            cross_data["avg_claim"] = (row[5] or 0) / row[6]
        else:
            cross_data["avg_claim"] = 0
        data["cross"].append(cross_data)

    if not silent:
        rpt.add("## 9. 车龄×insurance_type交叉分析（保单≥50）\n")
        rpt.add("> **风险发现**: 老旧车+商业险的赔付特征\n")
        rpt.add()
        rpt.add("| 车龄分段 | insurance_type | 保单数 | premium(万) | 赔付率 | 案均赔款† |")
        rpt.add("|:---|:---|---:|---:|---:|---:|")
        for c in data["cross"]:
            rpt.add(
                f"| {c['age_bucket']} "
                f"| {c['insurance_type']} "
                f"| {fi(c['policy_count'])} "
                f"| {fw(c['written_premium'])} "
                f"| {fp(c['loss_ratio'])}{light(c['loss_ratio'], TH_LR)} "
                f"| {fi(c['avg_claim'])}{light(c['avg_claim'], TH_AC_CARGO)} |"
            )
        rpt.add()

    return data


def section_10_summary(ctx, rpt, collected, silent=False):
    """板块 10: 诊断总结"""
    if silent:
        return {}

    rpt.add("## 10. 诊断总结与风险发现\n")

    # 从收集的数据中提取关键发现
    insights = []

    # 1. 整体风险评估
    if 1 in collected:
        overview = collected[1]
        vc = overview.get("vc_ratio", 0)
        if vc > TH_VC[2]:  # 危险阈值
            insights.append(f"🔴 **整体风险**: 变动成本率 {vc:.1f}% 处于危险区间")
        elif vc > TH_VC[1]:  # 预警阈值
            insights.append(f"🟡 **整体风险**: 变动成本率 {vc:.1f}% 处于预警区间")
        else:
            insights.append(f"🟢 **整体健康**: 变动成本率 {vc:.1f}% 处于正常区间")

    # 2. 品牌风险
    if 2 in collected:
        brands = collected[2].get("brands", [])
        high_risk_brands = [b for b in brands if b.get("loss_ratio", 0) > 70]
        if high_risk_brands:
            brand_names = ", ".join([b["brand"] for b in high_risk_brands[:3]])
            insights.append(f"🔴 **品牌风险**: {brand_names} 赔付率超过70%")

    # 3. 车龄风险
    if 3 in collected:
        ages = collected[3].get("ages", [])
        for a in ages:
            if a.get("avg_claim", 0) > 8000 and a["age_bucket"] != "未知":
                insights.append(f"🟡 **车龄风险**: {a['age_bucket']} 案均赔款 {a['avg_claim']:.0f}元")

    # 4. 车价风险
    if 4 in collected:
        prices = collected[4].get("prices", [])
        for p in prices:
            if p.get("loss_ratio", 0) > 70:
                insights.append(f"🟡 **车价风险**: {p['price_bucket']} 赔付率 {p['loss_ratio']:.1f}%")

    # 5. 机构风险
    if 5 in collected:
        orgs = collected[5].get("orgs", [])
        high_risk_orgs = [o for o in orgs if o.get("loss_ratio", 0) > 70]
        if high_risk_orgs:
            org_names = ", ".join([o["org"] for o in high_risk_orgs[:3]])
            insights.append(f"🟡 **机构风险**: {org_names} 赔付率超过70%")

    # 6. 多维度交叉风险
    if 7 in collected:
        cross = collected[7].get("cross", [])
        high_risk_cross = [c for c in cross if c.get("loss_ratio", 0) > 80]
        if high_risk_cross:
            cross_names = ", ".join([f"{c['brand']}×{c['org']}" for c in high_risk_cross[:3]])
            insights.append(f"🔴 **交叉风险**: {cross_names} 赔付率超过80%")

    # 输出发现
    if insights:
        for insight in insights:
            rpt.add(f"- {insight}\n")
    else:
        rpt.add("- 🟢 **整体风险可控**: 各维度指标均在正常范围内\n")

    rpt.add()
    rpt.add("### 建议下一步\n")
    rpt.add("1. **风险下钻**: 对高风险维度进行更细粒度分析（如品牌→车型→salesman_name）\n")
    rpt.add("2. **定价策略**: 考虑对高风险组合调整定价系数\n")
    rpt.add("3. **承保政策**: 优化核保规则，限制高风险业务\n")
    rpt.add("4. **续保策略**: 关注高价值低风险客户的续保留存\n")

    return {"insights": insights}


# ============================================================================
# 板块注册表
# ============================================================================
SECTION_REGISTRY = {
    1: section_01_overview,
    2: section_02_brand,
    3: section_03_vehicle_age,
    4: section_04_price,
    5: section_05_org,
    6: section_06_insurance,
    7: section_07_brand_org,
    8: section_08_price_combo,
    9: section_09_age_insurance,
    10: section_10_summary,
}

SECTION_NAMES = {
    1: "整体经营概况",
    2: "品牌维度",
    3: "车龄维度",
    4: "车价维度",
    5: "org_level_3",
    6: "insurance_type/coverage_combination",
    7: "品牌×机构交叉",
    8: "车价×险别交叉",
    9: "车龄×insurance_type交叉",
    10: "诊断总结",
}

ALL_SECTION_IDS = sorted(SECTION_REGISTRY.keys())


class RunContext:
    """运行上下文"""
    def __init__(self, con):
        self.con = con


def main():
    parser = argparse.ArgumentParser(description="过户车多维度交叉诊断 v1.0")
    parser.add_argument("--sections", default=None, help="仅运行指定板块，如: 1,2,7")
    parser.add_argument("--skip", default=None, help="跳过指定板块")
    parser.add_argument("--no-summary", action="store_true", help="跳过诊断总结")
    parser.add_argument("--output", default=OUT_DIR, help="输出目录")
    args = parser.parse_args()

    # 解析板块选择
    if args.sections:
        requested = parse_ids(args.sections)
    elif args.skip:
        skip_ids = parse_ids(args.skip)
        requested = set(ALL_SECTION_IDS) - skip_ids
    else:
        requested = set(ALL_SECTION_IDS)

    if args.no_summary:
        requested.discard(10)
    if not requested:
        print("❌ 至少需要运行一个板块"); sys.exit(1)

    # DuckDB 连接
    con = duckdb.connect()
    ctx = RunContext(con)

    # 获取元数据
    meta = con.execute(f"""
        SELECT MAX(policy_date)::DATE, COUNT(DISTINCT policy_no)::INT, COUNT(*)::INT
        FROM read_parquet('{GLOB_CURRENT}', union_by_name=true)
        WHERE {BASE_FILTER}
    """).fetchone()
    max_date, total_pol, total_rec = meta

    if total_pol == 0:
        print(f"\n❌ 筛选条件未命中任何保单，无法生成诊断报告。"); sys.exit(1)

    print(f"\n🔍 诊断: 非营业个人客车过户车（5年合并）")
    print(f"   {total_pol:,} 保单 | {total_rec:,} 记录 | 最新policy_date {max_date}")
    if requested != set(ALL_SECTION_IDS):
        names = [f"{sid}.{SECTION_NAMES[sid]}" for sid in sorted(requested)]
        print(f"   📋 板块: {', '.join(names)}")

    # 生成报告
    rpt = Report()
    rpt.add("# 非营业个人客车过户车经营诊断报告（5年合并）\n")
    rpt.add(f"> **数据范围**: 2021-01-01 ~ {max_date} | **保单数**: {total_pol:,}\n")
    rpt.add()

    collected = {}
    for sid in sorted(requested):
        section_fn = SECTION_REGISTRY[sid]
        print(f"   ⏳ 运行板块 {sid}.{SECTION_NAMES[sid]}...")
        try:
            # 板块 10 需要传入 collected 参数
            if sid == 10:
                result = section_fn(ctx, rpt, collected, silent=False)
            else:
                result = section_fn(ctx, rpt, silent=False)
            collected[sid] = result
        except Exception as e:
            rpt.add(f"\n> ⚠️ 板块 {sid} 执行失败: {e}\n")
            print(f"      ❌ 失败: {e}")

    # 保存报告
    from pathlib import Path as PathLib
    out_dir = PathLib(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"过户车诊断_5年合并_{max_date}.md"
    out_path = out_dir / fname
    out_path.write_text("\n".join(rpt.lines), encoding="utf-8")

    print(f"\n✅ 报告已保存: {out_path}")


if __name__ == "__main__":
    main()
