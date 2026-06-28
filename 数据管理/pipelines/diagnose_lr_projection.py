#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
车险整体满期赔付率 burning-cost 平移预测（可复用版）
====================================================

用历史 N 年保单的 4 维 cell 满期赔付率，平移到预测年起保保单的对应 cell，
再加权得到预测年车险整体（全险种合计）预期满期赔付率。

4 维：客户类别 × is_nev × 标准四分类（新车/旧车过户/旧车非过户续保/旧车非过户转保）× 险别组合（主全/交三/单交）
Fallback：4 维 cell 满期保费 < 阈值 → 逐级降到 3 维 → 2 维 → 1 维 → 整体
Override：CSV (4 维完整 + LR) 覆盖 fallback

用法（默认：历史 2023-2025、预测 2026、阈值 500 万 或 5000 台）:
  python3 diagnose_lr_projection.py
  python3 diagnose_lr_projection.py --overrides 数据管理/inputs/lr_projection_overrides.csv

跨年度复用（如 2027 预测）:
  python3 diagnose_lr_projection.py --hist-years 2024-2026 --proj-year 2027
  python3 diagnose_lr_projection.py --threshold-premium-wan 300 --threshold-vehicle 3000
"""

from __future__ import annotations
import argparse
import hashlib
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(SCRIPT_DIR))

from diagnose_common import (  # type: ignore
    GLOB, CLAIMS_GLOB, BRANCH_CODE, fw, fp, light, TH_LR, escape_sql
)

# ============================================================================
# 常量
# ============================================================================

DEFAULT_HIST_YEARS = [2023, 2024, 2025]
DEFAULT_PROJ_YEAR = 2026

# 小样本阈值：满期保费 ≥ N 万元 OR 车辆台数 ≥ M 台（以低者为准 = 达任一即合格）
# 每一级 fallback（4d/3d/2d/1d）都用同阈值判断，达不到继续降级，避免极端值
DEFAULT_THRESHOLD_PREMIUM_WAN = 500.0
DEFAULT_THRESHOLD_VEHICLE = 5000

OUTPUT_BASE = PROJECT_ROOT / "数据管理/数据分析报告"
RUN_DATE = date.today().strftime("%Y-%m-%d")

# JSON 副本 schema 版本(差异桥与下游消费契约)
SCHEMA_VERSION = "2.0"

# 保留的险别组合（'主全'/'交三'/'单交'），排除 '未知'/'其他'
COVERAGE_FILTER = "coverage_combination IN ('主全','交三','单交')"

# 11 类客户（按 src/shared/config/customer-categories.ts 全集；数据里实际出现的按 cnt 排）
CUSTOMER_CATEGORIES_FULL = [
    "非营业个人客车", "摩托车", "非营业货车", "非营业企业客车",
    "营业货车", "营业出租租赁", "特种车", "营业公路客运",
    "挂车", "非营业机关客车", "营业城市公交",
]

VEHICLE_TYPE_4 = ["新车", "旧车过户", "旧车非过户续保", "旧车非过户转保"]
COVERAGE_3 = ["主全", "交三", "单交"]


# ============================================================================
# SQL 片段
# ============================================================================

# 闰年感知保险期限（365/366 天）
POLICY_TERM = "DATE_DIFF('day', insurance_start_date, insurance_start_date + INTERVAL 1 YEAR)"

def earned_days_as_of(d: str) -> str:
    """earned_days 截至指定日期"""
    return (f"LEAST(GREATEST(DATE_DIFF('day', insurance_start_date, DATE '{d}'), 0), "
            f"{POLICY_TERM})")

def earned_premium_as_of(d: str) -> str:
    return f"premium * CAST({earned_days_as_of(d)} AS DOUBLE) / CAST({POLICY_TERM} AS DOUBLE)"

# 标准四分类（用户标准优先级：新车 > 过户 > 续保 > 转保）
VEHICLE_TYPE_4_SQL = """
CASE
  WHEN COALESCE(is_new_car, FALSE) THEN '新车'
  WHEN COALESCE(is_transfer, FALSE) THEN '旧车过户'
  WHEN COALESCE(is_renewal, FALSE) THEN '旧车非过户续保'
  ELSE '旧车非过户转保'
END
""".strip()


# ============================================================================
# 跑批参数哈希(差异桥与可审计的语义指纹)
# ============================================================================

def compute_run_params_hash(
    proj_year: int,
    hist_years: list[int],
    hist_as_of: str,
    threshold_premium_wan: float,
    threshold_vehicle: int,
    overrides_path: Path | None,
) -> str:
    """SHA256 摘要,只含**影响模型结果**的语义参数。

    显式排除:snapshot_tag / output_dir / verbose 等运行时参数。
    overrides 用文件内容 SHA256 表示,文件路径变化但内容不变时哈希仍稳定。
    """
    overrides_sha = None
    if overrides_path and overrides_path.exists():
        overrides_sha = hashlib.sha256(overrides_path.read_bytes()).hexdigest()

    payload = {
        "proj_year": proj_year,
        "hist_years": sorted(hist_years),
        "hist_as_of": hist_as_of,
        "threshold_premium_wan": float(threshold_premium_wan),
        "threshold_vehicle": int(threshold_vehicle),
        "overrides_content_sha256": overrides_sha,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


# ============================================================================
# 视图构建
# ============================================================================

def build_views(
    con: duckdb.DuckDBPyConnection,
    hist_as_of: str,
    hist_years: list[int],
    proj_year: int,
) -> None:
    """在 DuckDB 内建分析视图。

    - v_claims_agg: 按 policy_no 聚合赔款(claim_no 多级 tie-breaker 去重 + report_time 估值截止)
    - v_policy_base_dedup: 统一保单去重视图(供历史与预测年派生,口径对齐 policy-dedup.ts)
    - v_policy_hist: 历史 N 年保单 + 派生维度 + 满期保费(截至 hist_as_of)
    - v_policy_proj: 预测年起保保单 + 满期保费(截至 proj_year-12-31)

    口径与项目主分支 `server/src/sql/shared/policy-dedup.ts` 严格对齐(B252 / B287)。
    完整对账见 `开发文档/reviews/2026-05-11-lr-hardening-baseline-diff.md`。
    """
    proj_eoy = f"{proj_year}-12-31"

    # 赔案侧:估值截止 + 多级 tie-breaker(护栏,保证差异桥可信)
    con.execute(f"""
        CREATE OR REPLACE VIEW v_claims_agg AS
        SELECT policy_no,
               COUNT(DISTINCT claim_no) AS claim_cases,
               SUM(CASE WHEN settlement_time IS NOT NULL
                          AND settlement_time <= TIMESTAMP '{hist_as_of} 23:59:59'
                        THEN COALESCE(settled_amount, 0)
                        ELSE COALESCE(reserve_amount, 0) END) AS reported_claims
        FROM (SELECT DISTINCT ON (claim_no) *
              FROM read_parquet('{CLAIMS_GLOB}', union_by_name=true)
              WHERE report_time <= TIMESTAMP '{hist_as_of} 23:59:59'
              ORDER BY claim_no, report_time DESC,
                       settlement_time DESC NULLS LAST,
                       payment_time DESC NULLS LAST)
        GROUP BY policy_no
    """)

    # 保单侧:统一去重基础视图
    # 字段清单对齐 server/src/sql/shared/policy-dedup.ts:
    #   GROUP BY policy_no, CAST(insurance_start_date AS DATE)
    #   HAVING SUM(premium) > 0  (排除全退保/负向批改)
    #   premium SUM(批改净额); 其他字段 ANY_VALUE(批改通常不改)
    con.execute(f"""
        CREATE OR REPLACE VIEW v_policy_base_dedup AS
        SELECT
            policy_no,
            CAST(insurance_start_date AS DATE) AS insurance_start_date,
            SUM(premium) AS premium,
            ANY_VALUE(customer_category) AS customer_category,
            ANY_VALUE(is_nev) AS is_nev,
            ANY_VALUE(is_new_car) AS is_new_car,
            ANY_VALUE(is_transfer) AS is_transfer,
            ANY_VALUE(is_renewal) AS is_renewal,
            ANY_VALUE(coverage_combination) AS coverage_combination,
            ANY_VALUE(vehicle_frame_no) AS vehicle_frame_no
        FROM read_parquet('{GLOB}', union_by_name=true)
        WHERE insurance_start_date IS NOT NULL
          -- 省份隔离（data-pipeline.md 红线）：policy/current/ 混放 SC+SX 文件，
          -- 裸 glob 会把外省保单计入分母，但 claims 仅含本省（SX 赔案在 validation/SX/），
          -- 不过滤将系统性稀释满期赔付率。branch_code 由 ETL 注入、BRANCH_CODE 已在
          -- diagnose_common.branch_paths 做 fail-closed 校验（SC/SX）。对齐 #840 多省路由收口。
          AND branch_code = '{BRANCH_CODE}'
          AND {COVERAGE_FILTER}
        GROUP BY policy_no, CAST(insurance_start_date AS DATE)
        HAVING SUM(premium) > 0
    """)

    con.execute(f"""
        CREATE OR REPLACE VIEW v_policy_hist AS
        SELECT
            p.customer_category,
            p.is_nev,
            {VEHICLE_TYPE_4_SQL} AS vehicle_type_4,
            p.coverage_combination,
            p.premium,
            p.policy_no,
            COALESCE(NULLIF(TRIM(CAST(p.vehicle_frame_no AS VARCHAR)), ''), p.policy_no) AS vehicle_key,
            {earned_premium_as_of(hist_as_of)} AS earned_premium,
            COALESCE(c.reported_claims, 0) AS reported_claims
        FROM v_policy_base_dedup p
        LEFT JOIN v_claims_agg c ON p.policy_no = c.policy_no
        WHERE YEAR(p.insurance_start_date) IN ({", ".join(str(y) for y in hist_years)})
    """)

    con.execute(f"""
        CREATE OR REPLACE VIEW v_policy_proj AS
        SELECT
            p.customer_category,
            p.is_nev,
            {VEHICLE_TYPE_4_SQL} AS vehicle_type_4,
            p.coverage_combination,
            p.premium,
            p.insurance_start_date,
            {earned_premium_as_of(proj_eoy)} AS earned_premium_full,
            {earned_premium_as_of(hist_as_of)} AS earned_premium_signed
        FROM v_policy_base_dedup p
        WHERE YEAR(p.insurance_start_date) = {proj_year}
    """)


def build_historical_lr(con: duckdb.DuckDBPyConnection) -> dict[str, pd.DataFrame]:
    """构建各级 fallback 历史赔付率。返回 dict: 4d/3d/2d/1d/0d → DataFrame。"""
    dfs = {}

    dfs["4d"] = con.execute("""
        SELECT customer_category, is_nev, vehicle_type_4, coverage_combination,
               SUM(reported_claims) AS hist_claims,
               SUM(earned_premium) AS hist_earned,
               COUNT(DISTINCT vehicle_key) AS hist_vehicle_count,
               SUM(reported_claims) / NULLIF(SUM(earned_premium), 0) AS lr
        FROM v_policy_hist
        GROUP BY 1,2,3,4
    """).fetchdf()

    dfs["3d"] = con.execute("""
        SELECT customer_category, is_nev, vehicle_type_4,
               SUM(reported_claims) / NULLIF(SUM(earned_premium), 0) AS lr,
               SUM(earned_premium) AS hist_earned,
               COUNT(DISTINCT vehicle_key) AS hist_vehicle_count
        FROM v_policy_hist
        GROUP BY 1,2,3
    """).fetchdf()

    dfs["2d"] = con.execute("""
        SELECT customer_category, is_nev,
               SUM(reported_claims) / NULLIF(SUM(earned_premium), 0) AS lr,
               SUM(earned_premium) AS hist_earned,
               COUNT(DISTINCT vehicle_key) AS hist_vehicle_count
        FROM v_policy_hist
        GROUP BY 1,2
    """).fetchdf()

    dfs["1d"] = con.execute("""
        SELECT customer_category,
               SUM(reported_claims) / NULLIF(SUM(earned_premium), 0) AS lr,
               SUM(earned_premium) AS hist_earned,
               COUNT(DISTINCT vehicle_key) AS hist_vehicle_count
        FROM v_policy_hist
        GROUP BY 1
    """).fetchdf()

    dfs["0d"] = con.execute("""
        SELECT SUM(reported_claims) / NULLIF(SUM(earned_premium), 0) AS lr,
               SUM(earned_premium) AS hist_earned
        FROM v_policy_hist
    """).fetchdf()

    return dfs


def build_proj_year_projection(
    con: duckdb.DuckDBPyConnection,
    proj_year: int,
) -> tuple[pd.DataFrame, float, str]:
    """构建预测年已签 4 维 cell + 全年外推 scale_factor。

    Returns:
        df_signed: 已签的 4 维 cell（含 earned_premium_signed / earned_premium_full）
        scale_factor: 12 / 已签月数
        max_start_date: 已签最晚起保日
    """
    df_signed = con.execute("""
        SELECT customer_category, is_nev, vehicle_type_4, coverage_combination,
               SUM(earned_premium_signed) AS earned_premium_signed,
               SUM(earned_premium_full) AS earned_premium_full
        FROM v_policy_proj
        GROUP BY 1,2,3,4
    """).fetchdf()

    # 用 max(insurance_start_date)(起保日)算外推系数
    # 已赚保费按起保日累计,外推基准也应该按起保日:max(起保日) - proj_year-01-01 即"已签业务覆盖的起保区间"
    # 关键:必须从 v_policy_proj 读(而非原始 parquet),保证与 df_signed 同一总体——
    #   1) 已过滤主全/交三/单交;
    #   2) dedup/cutoff/final 阶段经 v_policy_base_dedup 剔除净额≤0 保单,
    #      若读原始 parquet 会让 max_start_date 落在已被去重的"幽灵"保单上,
    #      高估 days_in、低估 scale_factor。
    max_date_row = con.execute(f"""
        SELECT MAX(insurance_start_date)::DATE AS d,
               DATE_DIFF('day', DATE '{proj_year}-01-01', MAX(insurance_start_date)::DATE) AS days_in
        FROM v_policy_proj
    """).fetchone()

    # P1 守护：预测年无数据时 MAX 返回 NULL，给出明确错误而非 TypeError
    if max_date_row is None or max_date_row[0] is None:
        raise SystemExit(
            f"[ERROR] {proj_year} 年无符合 coverage_combination IN ('主全','交三','单交') 的起保保单。\n"
            f"  请确认：1) 数据已加载到 {proj_year} 年 2) coverage_combination 字段非空\n"
            f"  跨年场景常见原因：--proj-year 设置过早，数据尚未到位"
        )

    max_start_date = str(max_date_row[0])
    days_in = max(int(max_date_row[1]), 1)
    months_in = days_in / 30.4
    scale_factor = 12.0 / months_in if months_in > 0 else 1.0

    return df_signed, scale_factor, max_start_date


# ============================================================================
# Fallback & Override 决策
# ============================================================================

def apply_fallback_and_overrides(
    df_proj: pd.DataFrame,
    hist: dict[str, pd.DataFrame],
    scale_factor: float,
    overrides: pd.DataFrame | None,
    threshold_premium: float,
    threshold_vehicle: int,
) -> pd.DataFrame:
    """合并预测年 cell 与历史 LR / fallback / overrides，决策最终 expected_lr。"""

    # 4d JOIN
    df = df_proj.merge(
        hist["4d"].rename(columns={"lr": "lr_4d", "hist_claims": "hist_claims_4d",
                                    "hist_earned": "hist_earned_4d",
                                    "hist_vehicle_count": "hist_vehicle_count_4d"}),
        on=["customer_category", "is_nev", "vehicle_type_4", "coverage_combination"],
        how="left",
    )

    # 3d JOIN（去险别组合）—— 带 hist_earned 和 hist_vehicle_count 用于阈值判断
    df = df.merge(
        hist["3d"].rename(columns={"lr": "lr_3d", "hist_earned": "hist_earned_3d",
                                    "hist_vehicle_count": "hist_vehicle_count_3d"}),
        on=["customer_category", "is_nev", "vehicle_type_4"],
        how="left",
    )

    # 2d JOIN（去四分类）
    df = df.merge(
        hist["2d"].rename(columns={"lr": "lr_2d", "hist_earned": "hist_earned_2d",
                                    "hist_vehicle_count": "hist_vehicle_count_2d"}),
        on=["customer_category", "is_nev"], how="left",
    )

    # 1d JOIN（去能源）
    df = df.merge(
        hist["1d"].rename(columns={"lr": "lr_1d", "hist_earned": "hist_earned_1d",
                                    "hist_vehicle_count": "hist_vehicle_count_1d"}),
        on=["customer_category"], how="left",
    )

    # 0d（车险整体常数）
    lr_overall = float(hist["0d"]["lr"].iloc[0]) if not hist["0d"].empty else 0.0
    df["lr_overall"] = lr_overall

    # Override JOIN
    if overrides is not None and not overrides.empty:
        df = df.merge(
            overrides[["customer_category", "is_nev", "vehicle_type_4",
                       "coverage_combination", "expected_lr"]]
                .rename(columns={"expected_lr": "override_lr"}),
            on=["customer_category", "is_nev", "vehicle_type_4", "coverage_combination"],
            how="left",
        )
    else:
        df["override_lr"] = None

    # 决策：每层都用同阈值(保费≥threshold_premium OR 车数≥threshold_vehicle)，达不到逐级降级
    # override > 4d 达标 > 3d 达标 > 2d 达标 > 1d 达标 > overall
    for lvl in ["4d", "3d", "2d", "1d"]:
        df[f"hist_earned_{lvl}"] = df[f"hist_earned_{lvl}"].fillna(0)
        df[f"hist_vehicle_count_{lvl}"] = df[f"hist_vehicle_count_{lvl}"].fillna(0).astype(int)
        df[f"qualified_{lvl}"] = (
            (df[f"hist_earned_{lvl}"] >= threshold_premium)
            | (df[f"hist_vehicle_count_{lvl}"] >= threshold_vehicle)
        )

    # 保持 sample_sufficient 列向后兼容（指 4d 是否达标）
    df["sample_sufficient"] = df["qualified_4d"]

    def decide(row):
        if pd.notna(row["override_lr"]):
            return row["override_lr"], "override"
        if row["qualified_4d"] and pd.notna(row["lr_4d"]):
            return row["lr_4d"], "4d_original"
        if row["qualified_3d"] and pd.notna(row["lr_3d"]):
            return row["lr_3d"], "3d_fallback"
        if row["qualified_2d"] and pd.notna(row["lr_2d"]):
            return row["lr_2d"], "2d_fallback"
        if row["qualified_1d"] and pd.notna(row["lr_1d"]):
            return row["lr_1d"], "1d_fallback"
        return row["lr_overall"], "overall"

    decisions = df.apply(decide, axis=1, result_type="expand")
    df["applied_lr"] = decisions[0]
    df["fallback_level"] = decisions[1]

    # 预测年全年外推满期保费
    df["earned_premium_full_year"] = df["earned_premium_full"] * scale_factor

    # 预测赔款
    df["projected_claims"] = df["earned_premium_full_year"] * df["applied_lr"]

    return df


# ============================================================================
# 报告生成
# ============================================================================

def aggregate_by_dim(df: pd.DataFrame, dim_cols: list[str]) -> pd.DataFrame:
    """按指定维度聚合：先 SUM 分子分母再除"""
    g = df.groupby(dim_cols, dropna=False).agg(
        earned_premium_full_year=("earned_premium_full_year", "sum"),
        projected_claims=("projected_claims", "sum"),
        cell_count=("applied_lr", "size"),
    ).reset_index()
    g["expected_lr"] = g["projected_claims"] / g["earned_premium_full_year"]
    return g


def render_md_table_dim(df: pd.DataFrame, dim_col: str, dim_label: str) -> str:
    """按一个维度渲染 Markdown 表格"""
    lines = [
        f"| {dim_label} | 满期保费(万) | 预测赔款(万) | 满期赔付率 | 亮灯 |",
        "|---|---:|---:|---:|---|",
    ]
    for _, r in df.iterrows():
        lr_pct = r["expected_lr"] * 100
        lines.append(
            f"| {r[dim_col]} | {fw(r['earned_premium_full_year']/10000)} | "
            f"{fw(r['projected_claims']/10000)} | {fp(lr_pct)} | "
            f"{light(lr_pct, TH_LR, higher_worse=True)} |"
        )
    return "\n".join(lines)


def render_top_cells_table(df: pd.DataFrame, top_n: int, ascending: bool) -> str:
    """Top N 高/低赔付率 cell 表格（按 2026 满期保费 > 50 万过滤防小样本噪声）"""
    sub = df[df["earned_premium_full_year"] >= 500000].copy()
    sub = sub.sort_values("applied_lr", ascending=ascending).head(top_n)
    lines = [
        "| # | 客户类别 | 能源 | 四分类 | 险别 | 满期保费(万) | 预测赔款(万) | 赔付率 | 来源 |",
        "|---:|---|---|---|---|---:|---:|---:|---|",
    ]
    for i, (_, r) in enumerate(sub.iterrows(), 1):
        nev_label = "新能源" if r["is_nev"] else "燃油"
        lr_pct = r["applied_lr"] * 100
        lines.append(
            f"| {i} | {r['customer_category']} | {nev_label} | {r['vehicle_type_4']} | "
            f"{r['coverage_combination']} | {fw(r['earned_premium_full_year']/10000)} | "
            f"{fw(r['projected_claims']/10000)} | {fp(lr_pct)} | {r['fallback_level']} |"
        )
    return "\n".join(lines)


def compute_structure_attribution(
    df: pd.DataFrame,
    con: duckdb.DuckDBPyConnection,
) -> pd.DataFrame:
    """各维度结构变化对 ΔLR 的边际贡献（一阶 Shapley 近似）。

    contrib_D = Σ_d (proj_share[d] - hist_share[d]) × hist_lr[d]

    四个维度独立测算，合计 ≈ 总 ΔLR（差异 = 二阶交互项 + override 影响）。
    """
    rows = []
    DIMS = [
        ("客户类别", "customer_category"),
        ("能源类型", "is_nev"),
        ("四分类", "vehicle_type_4"),
        ("险别组合", "coverage_combination"),
    ]
    for label, dim_col in DIMS:
        hist_dim = con.execute(f"""
            SELECT {dim_col} AS k,
                   SUM(earned_premium) AS earned,
                   SUM(reported_claims) / NULLIF(SUM(earned_premium), 0) AS lr
            FROM v_policy_hist
            GROUP BY 1
        """).fetchdf()
        hist_total = float(hist_dim["earned"].sum())
        if hist_total <= 0:
            rows.append({"dim_label": label, "dim_col": dim_col, "contrib_pp": 0.0})
            continue
        hist_dim["share"] = hist_dim["earned"] / hist_total

        proj_g = df.groupby(dim_col, dropna=False).agg(
            proj_earned=("earned_premium_full_year", "sum")
        ).reset_index().rename(columns={dim_col: "k"})
        proj_total = float(proj_g["proj_earned"].sum())
        proj_g["proj_share"] = proj_g["proj_earned"] / proj_total if proj_total > 0 else 0

        merged = pd.merge(
            hist_dim[["k", "lr", "share"]],
            proj_g[["k", "proj_share"]],
            on="k", how="outer",
        ).fillna(0)
        merged["contrib_pp"] = (merged["proj_share"] - merged["share"]) * merged["lr"] * 100
        rows.append({
            "dim_label": label,
            "dim_col": dim_col,
            "contrib_pp": float(merged["contrib_pp"].sum()),
        })

    return pd.DataFrame(rows)


def render_report(
    df: pd.DataFrame,
    df_no_override: pd.DataFrame,
    hist: dict[str, pd.DataFrame],
    scale_factor: float,
    max_start_date: str,
    overrides_used: int,
    hist_as_of: str,
    hist_years: list[int],
    proj_year: int,
    threshold_premium_wan: float,
    threshold_vehicle: int,
    attribution: pd.DataFrame,
) -> str:
    """渲染完整 Markdown 报告（结论先行版，11 板块 + 附录）。"""

    total_premium = df["earned_premium_full_year"].sum() / 10000  # 万元
    total_claims = df["projected_claims"].sum() / 10000
    overall_lr = (df["projected_claims"].sum() / df["earned_premium_full_year"].sum()) * 100

    overall_lr_no_ov = (df_no_override["projected_claims"].sum()
                       / df_no_override["earned_premium_full_year"].sum()) * 100

    hist_overall_lr = float(hist["0d"]["lr"].iloc[0]) * 100
    hist_earned_wan = float(hist["0d"]["hist_earned"].iloc[0]) / 10000

    fallback_stats = df["fallback_level"].value_counts().to_dict()
    total_cells = len(df)
    delta_vs_hist = overall_lr - hist_overall_lr

    # 4d_original 保费覆盖率（数据可信度信号 R4）
    prem_4d = df[df["fallback_level"] == "4d_original"]["earned_premium_full_year"].sum() / 10000
    coverage_4d_pct = prem_4d / total_premium * 100 if total_premium > 0 else 0

    # R3: 高影响 cell 警报阈值（保费 ≥ 200 万 + LR 偏离整体）
    HIGH_IMPACT_PREMIUM = 2_000_000
    high_lr_threshold = TH_LR[2] / 100  # 一般→关注 阈值
    low_lr_threshold = TH_LR[0] / 100   # 优秀→良好 阈值

    hist_label = f"{hist_years[0]}-{hist_years[-1]}" if len(hist_years) > 1 else str(hist_years[0])
    hist_year_word = f"{len(hist_years)} 年"

    lines = []

    # Header
    lines.append(f"# {proj_year} 车险整体满期赔付率平移预测\n")
    lines.append(
        f"**运行日期**: {RUN_DATE} · **历史窗口**: {hist_label} {hist_year_word} · "
        f"**{proj_year} 最晚起保日**: {max_start_date} · **全年外推系数**: {scale_factor:.3f}\n"
    )

    # 板块 1: 结论先行（含 R4 数据可信度 + R5 重跑判据）
    lr_light = light(overall_lr, TH_LR, higher_worse=True)
    lines.append("## 1. 结论先行\n")
    lines.append(
        f"- **{proj_year} 全年预期车险整体满期赔付率 = {fp(overall_lr)}{lr_light}**\n"
        f"- 预期满期保费 {fw(total_premium)} 万元 · 预期已报告赔款 {fw(total_claims)} 万元\n"
        f"- vs 历史 {hist_label} 整体 {fp(hist_overall_lr)}"
        f"（满期保费 {fw(hist_earned_wan)} 万元）: **{delta_vs_hist:+.2f} pp** "
        f"（结构归因详见板块 2）\n"
        f"- **数据可信度**: 4d_original 覆盖 **{coverage_4d_pct:.1f}%** 满期保费 "
        f"（{fallback_stats.get('4d_original', 0)}/{total_cells} cell）\n"
    )
    if overrides_used > 0:
        diff = overall_lr - overall_lr_no_ov
        lines.append(
            f"- **Override 影响**: 仅自动 fallback {fp(overall_lr_no_ov)} → "
            f"应用 {overrides_used} 行 override 后 {fp(overall_lr)} ({diff:+.2f} pp)\n"
        )
    lines.append(
        f"- **何时重跑**: ① 数据月度更新后 ② 单 cell 实际 cohort 满期 LR 与历史偏离 ≥ 5 pp"
        f"（候选 override 升级） ③ Override CSV 修订后 ④ Fallback 阈值或历史窗口调整后\n"
    )

    # 板块 2: 业务结构变化归因（R2）
    contrib_total = float(attribution["contrib_pp"].sum())
    residual = delta_vs_hist - contrib_total
    lines.append(
        f"\n## 2. 业务结构变化归因（{proj_year} vs {hist_label}，一阶 Shapley 近似）\n"
    )
    lines.append(
        f"\n实际 ΔLR = **{delta_vs_hist:+.2f} pp**。按维度边际拆解"
        f"（contrib_D = Σ (proj_share − hist_share) × hist_lr_D）:\n"
    )
    lines.append("| 维度 | 边际贡献 ΔLR | 解读 |")
    lines.append("|---|---:|---|")
    for _, r in attribution.iterrows():
        c = float(r["contrib_pp"])
        if c > 0.05:
            reading = "↑ 该维度结构变化推高整体 LR"
        elif c < -0.05:
            reading = "↓ 该维度结构变化压低整体 LR"
        else:
            reading = "≈ 该维度结构变化对整体 LR 影响可忽略"
        lines.append(f"| {r['dim_label']} | {c:+.2f} pp | {reading} |")
    lines.append(f"| **一阶合计** | **{contrib_total:+.2f} pp** | — |")
    if overrides_used > 0:
        override_effect = overall_lr - overall_lr_no_ov
        interaction = residual - override_effect
        lines.append(
            f"| Override 显式介入 | {override_effect:+.2f} pp | {overrides_used} 行业务 override（详见板块 1） |"
        )
        lines.append(
            f"| 维度间二阶交互项 | {interaction:+.2f} pp | 残差，无法归到单一维度的联动效应 |"
        )
    else:
        lines.append(
            f"| 维度间二阶交互项 | {residual:+.2f} pp | 残差，维度间联动效应 |"
        )

    # 板块 3-6: 按维度
    by_cust = aggregate_by_dim(df, ["customer_category"]).sort_values(
        "earned_premium_full_year", ascending=False)
    lines.append("\n\n## 3. 按客户类别（11 行）\n")
    lines.append(render_md_table_dim(by_cust, "customer_category", "客户类别"))

    by_nev = aggregate_by_dim(df, ["is_nev"]).copy()
    by_nev["energy"] = by_nev["is_nev"].map({True: "新能源", False: "燃油"})
    lines.append("\n\n## 4. 按能源类型\n")
    lines.append(render_md_table_dim(by_nev, "energy", "能源"))

    by_vt = aggregate_by_dim(df, ["vehicle_type_4"]).copy()
    by_vt["vehicle_type_4"] = pd.Categorical(by_vt["vehicle_type_4"],
                                              categories=VEHICLE_TYPE_4, ordered=True)
    by_vt = by_vt.sort_values("vehicle_type_4")
    lines.append("\n\n## 5. 按标准四分类\n")
    lines.append(render_md_table_dim(by_vt, "vehicle_type_4", "四分类"))

    by_cov = aggregate_by_dim(df, ["coverage_combination"]).copy()
    by_cov["coverage_combination"] = pd.Categorical(by_cov["coverage_combination"],
                                                      categories=COVERAGE_3, ordered=True)
    by_cov = by_cov.sort_values("coverage_combination")
    lines.append("\n\n## 6. 按险别组合\n")
    lines.append(render_md_table_dim(by_cov, "coverage_combination", "险别组合"))

    # 板块 7: 高影响警报 cell（R3）
    high_impact = df[
        (df["earned_premium_full_year"] >= HIGH_IMPACT_PREMIUM)
        & (df["applied_lr"] >= high_lr_threshold)
    ].sort_values("earned_premium_full_year", ascending=False)
    lines.append(
        f"\n\n## 7. 高影响警报 cell（保费 ≥ {HIGH_IMPACT_PREMIUM/10000:.0f} 万 × "
        f"LR ≥ {high_lr_threshold*100:.0f}%）\n"
    )
    if len(high_impact) == 0:
        lines.append("\n_无 cell 同时满足高保费 + 高赔付，整体风险结构健康。_\n")
    else:
        lines.append("\n这些 cell 对整体 LR 影响最大（保费体量 × LR 偏离），优先关注：\n")
        lines.append(render_top_cells_table(high_impact, len(high_impact), ascending=False))

    # 板块 8: 高效益支柱 cell（R3）
    high_value = df[
        (df["earned_premium_full_year"] >= HIGH_IMPACT_PREMIUM)
        & (df["applied_lr"] <= low_lr_threshold)
    ].sort_values("earned_premium_full_year", ascending=False)
    lines.append(
        f"\n\n## 8. 高效益支柱 cell（保费 ≥ {HIGH_IMPACT_PREMIUM/10000:.0f} 万 × "
        f"LR ≤ {low_lr_threshold*100:.0f}%）\n"
    )
    if len(high_value) == 0:
        lines.append("\n_无 cell 同时满足高保费 + 低赔付。_\n")
    else:
        lines.append("\n这些 cell 是利润支柱，应保持市场份额：\n")
        lines.append(render_top_cells_table(high_value, len(high_value), ascending=True))

    # 板块 9-10: 单维 Top 10（原 7-8）
    lines.append(
        f"\n\n## 9. Top 10 高 LR cell（单维排序，{proj_year} 满期保费 ≥ 50 万）\n"
    )
    lines.append(render_top_cells_table(df, 10, ascending=False))

    lines.append(
        f"\n\n## 10. Top 10 低 LR cell（单维排序，{proj_year} 满期保费 ≥ 50 万）\n"
    )
    lines.append(render_top_cells_table(df, 10, ascending=True))

    # 板块 11: Fallback 详细分布
    lines.append("\n\n## 11. Fallback 兜底详细分布\n")
    lines.append(f"\n共 {total_cells} 个 {proj_year} cell（实际出现）。各级使用情况:\n")
    for level in ["4d_original", "3d_fallback", "2d_fallback", "1d_fallback", "overall", "override"]:
        cnt = fallback_stats.get(level, 0)
        pct = cnt / total_cells * 100 if total_cells > 0 else 0
        prem = df[df["fallback_level"] == level]["earned_premium_full_year"].sum() / 10000
        prem_pct = prem / total_premium * 100 if total_premium > 0 else 0
        lines.append(f"- **{level}**: {cnt} cell ({pct:.1f}%), "
                    f"满期保费 {fw(prem)} 万元 ({prem_pct:.1f}%)")

    # 附录: 方法论与局限性（R1 — 从第 1 节降到末位）
    lines.append("\n\n---\n\n## 附录: 方法论与局限性\n")
    lines.append("\n### A.1 方法论\n")
    lines.append(
        f"- **目标**: 用 {hist_label} {hist_year_word}历史 4 维 cell 满期赔付率，"
        f"平移到 {proj_year} 起保保单同 cell，预测 {proj_year} 全年车险整体满期赔付率\n"
        "- **4 维交叉**: 客户类别(11) × is_nev(2) × 标准四分类(4) × 险别组合(3) = 最多 264 cell\n"
        "- **标准四分类**: 新车 > 旧车过户 > 旧车非过户续保 > 旧车非过户转保（优先级）\n"
        "- **险别组合**: 主全 / 交三 / 单交（已排除 coverage_combination='未知'/'其他'）\n"
        "- **整体口径**: 全险种合计算一个率，先 SUM 分子分母再除（禁加权平均）\n"
        f"- **Fallback**: 每一级 cell 都需满足 满期保费 ≥ {threshold_premium_wan:.0f} 万元 "
        f"OR 车辆台数 ≥ {threshold_vehicle} 台（达任一即合格），"
        f"否则逐级降维 4→3→2→1→整体，避免极端值\n"
        f"- **Override**: 共 {overrides_used} 行用户提供的预期 LR 覆盖了自动 fallback\n"
        f"- **{proj_year} 全年预估**: 已签数据线性外推 × {scale_factor:.3f}\n"
        "- **结构归因**: 一阶 Shapley 近似 — 维度 D 的贡献 ="
        " Σ (proj_share − hist_share) × hist_lr_D；二阶交互项归入残差\n"
    )
    lines.append("\n### A.2 局限性\n")
    lines.append(
        f"\n1. **线性外推假设**: {proj_year} 全年预估使用最晚起保日 {max_start_date} 的业务结构 × "
        f"{scale_factor:.3f}（按起保日累计，与已赚保费口径一致），忽略季节性（如年末新车上险高峰）"
        f"\n2. **赔付率稳定假设**: cell 级 LR 沿用 {hist_label} {hist_year_word}合计，"
        "不含通胀、法规、产品费率变化的影响"
        "\n3. **'未知'险别组合排除**: 历史中 coverage_combination='未知' 的保单（约 17%）已被剔除，"
        f"若 {proj_year} 仍有未知，需重新处理"
        "\n4. **业务介入接口**: 对存在已知偏离的 cell（如新能源主全风险上行、"
        "某客户类别赔付率结构性变化），请在 `lr_projection_overrides.csv` 中提供 expected_lr 覆盖"
        f"\n5. **历史窗口估值时点**: 历史保费分母满期截至 {hist_as_of}，"
        f"对 {hist_years[-1]} 年起保保单（部分未满 1 年）的分子分母为同步口径"
        "\n6. **归因残差**: 一阶 Shapley 加总 ≠ 总 ΔLR，残差含二阶交互项与 Override 影响"
    )

    return "\n".join(lines)


# ============================================================================
# CSV 输出
# ============================================================================

def export_csvs(df: pd.DataFrame, output_dir: Path, proj_year: int) -> None:
    """输出 cell 明细 + 按维度汇总"""

    # 1. 明细
    detail_cols = [
        "customer_category", "is_nev", "vehicle_type_4", "coverage_combination",
        "hist_claims_4d", "hist_earned_4d", "hist_vehicle_count_4d", "lr_4d",
        "sample_sufficient",
        "lr_3d", "lr_2d", "lr_1d", "lr_overall", "override_lr",
        "fallback_level", "applied_lr",
        "earned_premium_signed", "earned_premium_full", "earned_premium_full_year",
        "projected_claims",
    ]
    df[detail_cols].to_csv(output_dir / f"{proj_year}_LR_cells_detail.csv",
                            index=False, encoding="utf-8-sig")

    # 2. 维度汇总（一个文件多个 sheet 替代品：合并 4 张表加 dim 列）
    summaries = []
    for dim_col, dim_label in [
        ("customer_category", "客户类别"),
        ("is_nev", "能源类型"),
        ("vehicle_type_4", "四分类"),
        ("coverage_combination", "险别组合"),
    ]:
        g = aggregate_by_dim(df, [dim_col]).copy()
        g["维度"] = dim_label
        g["维度值"] = g[dim_col].astype(str)
        if dim_col == "is_nev":
            g["维度值"] = g[dim_col].map({True: "新能源", False: "燃油"})
        g = g[["维度", "维度值", "earned_premium_full_year",
              "projected_claims", "expected_lr", "cell_count"]]
        summaries.append(g)
    pd.concat(summaries, ignore_index=True).to_csv(
        output_dir / f"{proj_year}_LR_summary_by_dim.csv", index=False, encoding="utf-8-sig"
    )


# ============================================================================
# 主入口
# ============================================================================

def export_summary_json(
    df: pd.DataFrame,
    df_no_override: pd.DataFrame,
    hist: dict[str, pd.DataFrame],
    attribution: pd.DataFrame,
    overrides_used: int,
    scale_factor: float,
    max_start_date: str,
    hist_as_of: str,
    hist_years: list[int],
    proj_year: int,
    output_dir: Path,
    threshold_premium_wan: float,
    threshold_vehicle: int,
    run_params_hash: str = "",
) -> None:
    """落机器可读 JSON 副本 — 供企微推送 / AI 总结 / Dashboard 集成。"""

    total_premium = float(df["earned_premium_full_year"].sum())
    total_claims = float(df["projected_claims"].sum())
    overall_lr = total_claims / total_premium if total_premium > 0 else 0
    overall_lr_no_ov = float(
        df_no_override["projected_claims"].sum()
        / df_no_override["earned_premium_full_year"].sum()
    ) if df_no_override["earned_premium_full_year"].sum() > 0 else 0
    hist_overall_lr = float(hist["0d"]["lr"].iloc[0])

    fallback_stats = df["fallback_level"].value_counts().to_dict()
    prem_4d = float(df[df["fallback_level"] == "4d_original"]["earned_premium_full_year"].sum())
    coverage_4d_pct = prem_4d / total_premium * 100 if total_premium > 0 else 0

    HIGH_IMPACT_PREMIUM = 2_000_000
    high_lr_threshold = TH_LR[2] / 100
    low_lr_threshold = TH_LR[0] / 100

    def by_dim(dim_col: str, label_map: dict | None = None) -> list[dict]:
        g = aggregate_by_dim(df, [dim_col])
        out = []
        for _, r in g.iterrows():
            k = r[dim_col]
            label = label_map.get(k, str(k)) if label_map else (
                bool(k) if isinstance(k, bool) else str(k)
            )
            out.append({
                "key": label,
                "earned_premium_full_year_wan": float(r["earned_premium_full_year"] / 10000),
                "projected_claims_wan": float(r["projected_claims"] / 10000),
                "expected_lr": float(r["expected_lr"]),
                "cell_count": int(r["cell_count"]),
            })
        return out

    def cell_dict(r: pd.Series) -> dict:
        return {
            "customer_category": r["customer_category"],
            "is_nev": bool(r["is_nev"]),
            "vehicle_type_4": r["vehicle_type_4"],
            "coverage_combination": r["coverage_combination"],
            "earned_premium_full_year_wan": float(r["earned_premium_full_year"] / 10000),
            "applied_lr": float(r["applied_lr"]),
            "fallback_level": str(r["fallback_level"]),
        }

    high_impact = df[
        (df["earned_premium_full_year"] >= HIGH_IMPACT_PREMIUM)
        & (df["applied_lr"] >= high_lr_threshold)
    ].sort_values("earned_premium_full_year", ascending=False)
    high_value = df[
        (df["earned_premium_full_year"] >= HIGH_IMPACT_PREMIUM)
        & (df["applied_lr"] <= low_lr_threshold)
    ].sort_values("earned_premium_full_year", ascending=False)

    summary = {
        "schema_version": SCHEMA_VERSION,
        "run_params_hash": run_params_hash,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "proj_year": proj_year,
        "as_of": hist_as_of,
        "run_date": RUN_DATE,
        "hist_years": hist_years,
        "max_start_date": max_start_date,
        "scale_factor": float(scale_factor),
        "thresholds": {
            "premium_wan": float(threshold_premium_wan),
            "vehicle": int(threshold_vehicle),
            "high_impact_premium_wan": HIGH_IMPACT_PREMIUM / 10000,
            "high_lr_threshold": high_lr_threshold,
            "low_lr_threshold": low_lr_threshold,
        },
        "overall": {
            "lr": overall_lr,
            "lr_no_override": overall_lr_no_ov,
            "hist_lr": hist_overall_lr,
            "delta_pp_vs_hist": (overall_lr - hist_overall_lr) * 100,
            "earned_premium_full_year_wan": total_premium / 10000,
            "projected_claims_wan": total_claims / 10000,
            "data_quality_4d_coverage_pct": coverage_4d_pct,
        },
        "overrides_applied": overrides_used,
        "attribution": [
            {
                "dim": r["dim_col"],
                "dim_label": r["dim_label"],
                "contrib_pp": float(r["contrib_pp"]),
            }
            for _, r in attribution.iterrows()
        ],
        "by_customer_category": by_dim("customer_category"),
        "by_energy": by_dim("is_nev", {True: "新能源", False: "燃油"}),
        "by_vehicle_type_4": by_dim("vehicle_type_4"),
        "by_coverage": by_dim("coverage_combination"),
        "high_impact_alerts": [cell_dict(r) for _, r in high_impact.iterrows()],
        "high_value_cells": [cell_dict(r) for _, r in high_value.iterrows()],
        "fallback_distribution": {
            level: {
                "cell_count": int(fallback_stats.get(level, 0)),
                "earned_premium_wan": float(
                    df[df["fallback_level"] == level]["earned_premium_full_year"].sum() / 10000
                ),
            }
            for level in ["4d_original", "3d_fallback", "2d_fallback",
                          "1d_fallback", "overall", "override"]
        },
    }

    (output_dir / f"{proj_year}_LR_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def parse_hist_years(s: str) -> list[int]:
    """解析 --hist-years 参数：'2023-2025' 或 '2022,2023,2024' → [2023,2024,2025]"""
    s = s.strip()
    if "-" in s:
        a, b = s.split("-", 1)
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in s.split(",")]


def main():
    parser = argparse.ArgumentParser(description="车险整体满期赔付率 burning-cost 平移预测")
    parser.add_argument("--overrides", type=Path, default=None,
                        help="用户 override CSV 路径（4 维 + expected_lr）")
    parser.add_argument("--as-of", type=str, default=date.today().strftime("%Y-%m-%d"),
                        help="历史保单满期截止日期（默认今日）")
    parser.add_argument("--hist-years", type=str,
                        default=f"{DEFAULT_HIST_YEARS[0]}-{DEFAULT_HIST_YEARS[-1]}",
                        help=f"历史窗口（默认 {DEFAULT_HIST_YEARS[0]}-{DEFAULT_HIST_YEARS[-1]}）"
                             f"，支持 '2023-2025' 或 '2022,2023,2024'")
    parser.add_argument("--proj-year", type=int, default=DEFAULT_PROJ_YEAR,
                        help=f"预测年份（默认 {DEFAULT_PROJ_YEAR}）")
    parser.add_argument("--threshold-premium-wan", type=float,
                        default=DEFAULT_THRESHOLD_PREMIUM_WAN,
                        help=f"小样本阈值-满期保费（万元，默认 {DEFAULT_THRESHOLD_PREMIUM_WAN:.0f}）")
    parser.add_argument("--threshold-vehicle", type=int,
                        default=DEFAULT_THRESHOLD_VEHICLE,
                        help=f"小样本阈值-车辆台数（默认 {DEFAULT_THRESHOLD_VEHICLE}）")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="输出目录（默认 数据管理/数据分析报告/{proj_year}_LR_平移预测_{date}/）")
    parser.add_argument("--snapshot-tag", type=str, default=None,
                        help="产物命名隔离标签(不影响模型结果,不进入 run_params_hash)")
    args = parser.parse_args()

    hist_years = parse_hist_years(args.hist_years)
    proj_year = args.proj_year
    threshold_premium = args.threshold_premium_wan * 10000
    threshold_vehicle = args.threshold_vehicle

    # snapshot_tag 仅影响产物路径(不进入 run_params_hash),用于隔离同一日期下多次跑批
    snapshot_suffix = f"_{args.snapshot_tag}" if args.snapshot_tag else ""
    output_dir = args.output_dir or (
        OUTPUT_BASE / f"{proj_year}_LR_平移预测_{RUN_DATE}{snapshot_suffix}"
    )

    # 跑批参数哈希(只含语义参数,排除 snapshot_tag/output_dir)
    run_params_hash = compute_run_params_hash(
        proj_year=proj_year,
        hist_years=hist_years,
        hist_as_of=args.as_of,
        threshold_premium_wan=args.threshold_premium_wan,
        threshold_vehicle=threshold_vehicle,
        overrides_path=args.overrides,
    )

    print(f"[INFO] 开始 {proj_year} LR 平移预测分析")
    print(f"[INFO] 历史窗口: {hist_years}; 历史保单满期截至: {args.as_of}")
    print(f"[INFO] 小样本阈值: 满期保费 ≥ {args.threshold_premium_wan:.0f} 万 "
          f"OR 车辆 ≥ {threshold_vehicle} 台")
    if args.snapshot_tag:
        print(f"[INFO] 快照标签: {args.snapshot_tag}")
    print(f"[INFO] 参数哈希: {run_params_hash[:16]}…")
    print(f"[INFO] 输出目录: {output_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()

    # Step 1: 视图
    print(f"[INFO] Step 1/5: 构建视图…")
    build_views(con, args.as_of, hist_years, proj_year)

    # Step 2: 历史 LR（含各级 fallback）
    hist_label = (f"{hist_years[0]}-{hist_years[-1]}"
                  if len(hist_years) > 1 else str(hist_years[0]))
    print(f"[INFO] Step 2/5: 计算 {hist_label} 历史赔付率（4 维 + 4 级 fallback）…")
    hist = build_historical_lr(con)
    print(f"[INFO]   - 4d cells: {len(hist['4d'])}, 3d: {len(hist['3d'])}, "
          f"2d: {len(hist['2d'])}, 1d: {len(hist['1d'])}")
    print(f"[INFO]   - 整体 LR: {float(hist['0d']['lr'].iloc[0])*100:.2f}%")

    # Step 3: 预测年已签 + 全年外推
    print(f"[INFO] Step 3/5: 构建 {proj_year} 已签 cell + 全年外推 scale factor…")
    df_proj, scale_factor, max_start_date = build_proj_year_projection(con, proj_year)
    print(f"[INFO]   - {proj_year} 已签 cells: {len(df_proj)}")
    print(f"[INFO]   - 最晚起保日: {max_start_date}, 全年外推系数: {scale_factor:.3f}")

    # Step 4: Override + Fallback 决策
    print(f"[INFO] Step 4/5: 应用 Fallback 与 Override…")
    overrides_df = None
    overrides_used = 0
    if args.overrides and args.overrides.exists():
        overrides_df = pd.read_csv(args.overrides, comment="#", encoding="utf-8-sig")
        overrides_df = overrides_df.dropna(subset=["expected_lr"])

        # P2 守护：4D key 必须唯一，否则 left-join 会复制目标 cell 行，扭曲全年保费/赔款/LR
        key_cols = ["customer_category", "is_nev", "vehicle_type_4", "coverage_combination"]
        dup_mask = overrides_df.duplicated(subset=key_cols, keep=False)
        if dup_mask.any():
            dup_rows = overrides_df[dup_mask][key_cols + ["expected_lr"]]
            raise SystemExit(
                f"[ERROR] overrides CSV 含重复 4D key（会导致 merge 后行复制扭曲结果），请去重后重试:\n"
                f"{dup_rows.to_string(index=False)}"
            )

        overrides_used = len(overrides_df)
        print(f"[INFO]   - 加载 overrides: {overrides_used} 行（4D key 唯一性已校验）")

    df = apply_fallback_and_overrides(
        df_proj, hist, scale_factor, overrides_df, threshold_premium, threshold_vehicle,
    )
    df_no_override = apply_fallback_and_overrides(
        df_proj, hist, scale_factor, None, threshold_premium, threshold_vehicle,
    )

    fb_summary = df["fallback_level"].value_counts().to_dict()
    print(f"[INFO]   - Fallback 分布: {fb_summary}")

    # Step 4.5: 业务结构变化归因
    print(f"[INFO] Step 4.5/5: 计算业务结构变化归因…")
    attribution = compute_structure_attribution(df, con)

    # Step 5: 输出
    print(f"[INFO] Step 5/5: 生成 CSV / JSON / Markdown 报告…")
    export_csvs(df, output_dir, proj_year)

    md_content = render_report(
        df, df_no_override, hist, scale_factor, max_start_date,
        overrides_used, args.as_of,
        hist_years, proj_year, args.threshold_premium_wan, threshold_vehicle,
        attribution,
    )
    (output_dir / f"{proj_year}_LR_平移预测_报告.md").write_text(md_content, encoding="utf-8")

    export_summary_json(
        df, df_no_override, hist, attribution, overrides_used,
        scale_factor, max_start_date, args.as_of,
        hist_years, proj_year, output_dir,
        args.threshold_premium_wan, threshold_vehicle,
        run_params_hash=run_params_hash,
    )

    overall_lr = (df["projected_claims"].sum() / df["earned_premium_full_year"].sum()) * 100
    print(f"\n[DONE] {proj_year} 全年预期车险整体满期赔付率 = {overall_lr:.2f}%")
    print(f"[DONE] 产物:")
    print(f"  - {output_dir / f'{proj_year}_LR_cells_detail.csv'}")
    print(f"  - {output_dir / f'{proj_year}_LR_summary_by_dim.csv'}")
    print(f"  - {output_dir / f'{proj_year}_LR_summary.json'}")
    print(f"  - {output_dir / f'{proj_year}_LR_平移预测_报告.md'}")


if __name__ == "__main__":
    main()
