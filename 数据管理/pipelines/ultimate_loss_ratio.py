#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
终极赔付率（Ultimate Loss Ratio）预测 — Snapshot-Constrained v1

方法: paid Chain Ladder + BF + Benktander，按 maturity 动态混合
数据: origin policy (endorsement_no IS NULL) + claims_detail (settlement_time)
口径: 赔款不含费用，排除摩托车

用法:
    # 全量预测
    python3 数据管理/pipelines/ultimate_loss_ratio.py

    # 指定维度
    python3 数据管理/pipelines/ultimate_loss_ratio.py --dimension customer_category

    # 全维度
    python3 数据管理/pipelines/ultimate_loss_ratio.py --all-dimensions

    # 回测
    python3 数据管理/pipelines/ultimate_loss_ratio.py --backtest

    # JSON 输出
    python3 数据管理/pipelines/ultimate_loss_ratio.py --output-json
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

import duckdb
import pandas as pd

# 确保 pipelines/ 在 sys.path 中
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ulr_triangle import (
    CLAIMS_PATH,
    POLICY_GLOB,
    build_closure_triangle,
    build_current_incurred_snapshot,
    build_earned_premium,
    build_paid_triangle,
)
from ulr_methods import (
    calc_cape_cod_lr,
    calc_cdfs,
    calc_paid_ldfs,
    dynamic_blend,
    estimate_tail,
    get_cdf_at_dev,
    get_maturity_dev,
    predict_bf,
    predict_benktander,
    predict_chain_ladder,
    select_ldfs,
)

# ── 常量 ──

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = REPO_ROOT / "数据管理" / "数据分析报告"
DEFAULT_COHORT_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
EXCLUDE_MOTO = "customer_category != '摩托车'"


# ============================================================================
# 核心预测流程
# ============================================================================

def run_prediction(
    con: duckdb.DuckDBPyConnection,
    valuation_date: str,
    cohort_years: list[int] | None = None,
    where_clause: str = EXCLUDE_MOTO,
) -> dict:
    """执行全量终极赔付率预测。

    Returns:
        完整预测结果 dict（可直接 JSON 序列化）
    """
    if cohort_years is None:
        cohort_years = DEFAULT_COHORT_YEARS

    print(f"\n{'='*60}")
    print(f"终极赔付率预测 — Snapshot-Constrained v1")
    print(f"评估日: {valuation_date}")
    print(f"Cohort 年份: {cohort_years}")
    print(f"{'='*60}\n")

    # ── Step 1: Current Incurred Snapshot ──
    print("Step 1/6: 构建 current incurred snapshot...")
    snapshot = build_current_incurred_snapshot(
        con, cohort_years, valuation_date, where_clause,
    )
    print(snapshot.to_string())
    print()

    # ── Step 2: Earned Premium ──
    print("Step 2/6: 计算 earned premium...")
    ep = build_earned_premium(con, cohort_years, valuation_date, where_clause)
    for yr, val in sorted(ep.items()):
        print(f"  {yr}: {val/1e4:,.0f} 万元")
    print()

    # ── Step 3: Paid Triangle ──
    print("Step 3/6: 构建 paid triangle (1-60 月)...")
    paid_tri = build_paid_triangle(
        con, cohort_years, dev_months=list(range(1, 61)),
        valuation_date=valuation_date, where_clause=where_clause,
    )
    # 筛掉全零列
    paid_tri = paid_tri.loc[:, (paid_tri != 0).any(axis=0)]
    print(f"  三角形尺寸: {paid_tri.shape[0]} cohorts × {paid_tri.shape[1]} dev months")
    # 打印赔付率三角形（paid / EP）
    lr_tri = paid_tri.copy()
    for yr in lr_tri.index:
        if yr in ep and ep[yr] > 0:
            lr_tri.loc[yr] = lr_tri.loc[yr] / ep[yr] * 100
    print("\n  Paid LR Triangle (%):")
    print(lr_tri.round(1).to_string())
    print()

    # ── Step 3.5: Closure Triangle (尾部诊断) ──
    print("Step 3.5/6: 构建 closure triangle (结案成熟度)...")
    closure_tri = build_closure_triangle(
        con, cohort_years, dev_months=list(range(1, 61)),
        valuation_date=valuation_date, where_clause=where_clause,
    )
    closure_tri = closure_tri.loc[:, (closure_tri != 0).any(axis=0)]
    # 计算结案率 = 累计已结案 / 该 cohort 总赔案数
    closure_rate_tri = closure_tri.copy()
    for yr in closure_rate_tri.index:
        total_claims = int(snapshot.loc[yr, "claim_count"]) if yr in snapshot.index else 0
        if total_claims > 0:
            closure_rate_tri.loc[yr] = closure_rate_tri.loc[yr] / total_claims * 100
    print(f"  Closure 三角形尺寸: {closure_tri.shape[0]} × {closure_tri.shape[1]}")
    # 打印各 cohort 在关键月份的结案率
    key_months = [m for m in [6, 12, 18, 24, 36, 48, 60] if m in closure_rate_tri.columns]
    if key_months:
        print(f"\n  Closure Rate (%) at key months:")
        print(closure_rate_tri[key_months].round(1).to_string())
    print()

    # ── Step 4: LDF → CDF → Tail ──
    print("Step 4/6: 计算 LDF / CDF / Tail...")
    all_ldfs = calc_paid_ldfs(paid_tri)
    ldfs = select_ldfs(all_ldfs, "volume_weighted")
    if not ldfs:
        print("  ⚠️ 无法计算 LDF，数据不足")
        return {"error": "Insufficient data for LDF calculation"}

    tail = estimate_tail(list(ldfs.values()), cap=1.005)
    cdfs = calc_cdfs(ldfs, tail)

    # 打印关键 LDF
    print(f"  Tail factor: {tail:.4f}")
    print(f"  Selected LDFs (volume weighted, top 15):")
    sorted_dev_keys = sorted(ldfs.keys())
    for d in sorted_dev_keys[:15]:
        print(f"    Month {d:>2} → {d+1:>2}: {ldfs[d]:.4f}")
    print()

    # ── Step 5: Predictions ──
    print("Step 5/6: 终极赔付率预测 (CL / BF / Benktander)...")

    # Chain Ladder
    cl_results = predict_chain_ladder(paid_tri, ep, cdfs, valuation_date)

    # Cape Cod prior
    cdfs_at_dev = {}
    current_paid_map = {}
    for yr in cohort_years:
        dev = get_maturity_dev(yr, valuation_date)
        cdfs_at_dev[yr] = get_cdf_at_dev(cdfs, dev)
        if yr in cl_results:
            current_paid_map[yr] = cl_results[yr]["current_paid"]

    mature_years = [y for y in [2021, 2022, 2023] if y in current_paid_map]
    cape_cod_prior = calc_cape_cod_lr(current_paid_map, ep, cdfs_at_dev, mature_years)
    print(f"  Cape Cod prior LR: {cape_cod_prior:.2%}")

    # BF
    bf_results = predict_bf(current_paid_map, ep, cape_cod_prior, cdfs_at_dev)

    # Benktander
    cl_lr_map = {yr: r["ultimate_lr"] for yr, r in cl_results.items()
                 if r.get("ultimate_lr") is not None}
    bk_results = predict_benktander(current_paid_map, ep, cape_cod_prior, cdfs_at_dev, cl_lr_map)

    # Dynamic blend
    blend_results = dynamic_blend(cl_results, bf_results, bk_results, ep, valuation_date)

    # ── Step 6: 打印结果 ──
    print("\n  === 终极赔付率预测结果 ===\n")
    print(f"  {'Cohort':>6} {'Maturity':>14} {'Paid LR%':>10} {'CL ULR%':>10} {'BF ULR%':>10} {'BK ULR%':>10} {'Blend%':>10} {'IBNR万':>10}")
    print(f"  {'-'*6:>6} {'-'*14:>14} {'-'*10:>10} {'-'*10:>10} {'-'*10:>10} {'-'*10:>10} {'-'*10:>10} {'-'*10:>10}")
    for yr in sorted(blend_results.keys()):
        r = blend_results[yr]
        snap = snapshot.loc[yr] if yr in snapshot.index else {}
        paid_lr = snap.get("current_paid_lr", "-")
        if isinstance(paid_lr, (int, float)):
            paid_lr = f"{paid_lr:.1f}"
        ibnr_wan = f"{r['ibnr_blend']/1e4:,.0f}" if r.get("ibnr_blend") else "-"
        print(f"  {yr:>6} {r['maturity']:>14} {paid_lr:>10} "
              f"{_fmt(r.get('ultimate_lr_cl')):>10} {_fmt(r.get('ultimate_lr_bf')):>10} "
              f"{_fmt(r.get('ultimate_lr_bk')):>10} {_fmt(r.get('ultimate_lr_blend')):>10} {ibnr_wan:>10}")
    print()

    # ── 构建输出 JSON ──
    output = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "valuation_date": valuation_date,
        "model_basis": "paid_chainladder_bf_dynamic",
        "data_limitations": [
            "No monthly case reserve snapshots — incurred CL not available",
            "Current incurred used only as valuation-date snapshot",
            f"Tail factor capped at 1.005, estimated at {tail:.4f}",
            "Excludes motorcycle (摩托车) — separate model exists",
        ],
        "triangle": {
            "paid_ldfs": {str(k): round(v, 5) for k, v in sorted(ldfs.items())},
            "paid_cdfs": {str(k): round(v, 4) for k, v in sorted(cdfs.items())[:12]},
            "tail": round(tail, 5),
            "cape_cod_prior_lr": round(cape_cod_prior * 100, 2),
        },
        "closure_rate": {
            str(yr): {str(m): round(float(closure_rate_tri.loc[yr, m]), 1)
                       for m in closure_rate_tri.columns
                       if yr in closure_rate_tri.index and not pd.isna(closure_rate_tri.loc[yr, m])}
            for yr in closure_rate_tri.index
        },
        "by_cohort_year": {},
        "snapshot": {},
    }

    for yr in sorted(blend_results.keys()):
        r = blend_results[yr]
        snap = snapshot.loc[yr] if yr in snapshot.index else {}
        output["by_cohort_year"][str(yr)] = {
            "earned_premium_wan": r.get("earned_premium_wan"),
            "current_paid_lr": float(snap.get("current_paid_lr", 0)) if isinstance(snap.get("current_paid_lr"), (int, float)) else None,
            "current_incurred_lr": float(snap.get("current_incurred_lr", 0)) if isinstance(snap.get("current_incurred_lr"), (int, float)) else None,
            "dev_month": r.get("dev_month"),
            "maturity": r.get("maturity"),
            "method_weights": r.get("method_weights"),
            "ultimate_lr_cl": r.get("ultimate_lr_cl"),
            "ultimate_lr_bf": r.get("ultimate_lr_bf"),
            "ultimate_lr_bk": r.get("ultimate_lr_bk"),
            "ultimate_lr_blend": r.get("ultimate_lr_blend"),
            "ibnr_wan": round(r["ibnr_blend"] / 1e4, 0) if r.get("ibnr_blend") else None,
            "uncertainty_flag": r.get("uncertainty_flag", False),
        }
        output["snapshot"][str(yr)] = {
            "policy_count": int(snap.get("policy_count", 0)) if isinstance(snap.get("policy_count"), (int, float)) else 0,
            "claim_count": int(snap.get("claim_count", 0)) if isinstance(snap.get("claim_count"), (int, float)) else 0,
        }

    return output


def _fmt(v):
    return f"{v:.1f}" if isinstance(v, (int, float)) and v is not None else "-"


# ============================================================================
# 回测
# ============================================================================

def run_backtest(con: duckdb.DuckDBPyConnection) -> dict:
    """滚动 valuation date 回测。

    用历史时点做预测，与最新快照的 current incurred 对比。
    """
    print("\n" + "=" * 60)
    print("回测验证 — 滚动 Valuation Date")
    print("=" * 60 + "\n")

    backtest_dates = [
        ("2023-12-31", [2021, 2022, 2023]),
        ("2024-12-31", [2021, 2022, 2023, 2024]),
        ("2025-12-31", [2021, 2022, 2023, 2024, 2025]),
    ]

    # 获取最新快照作为 "actual"
    latest_snapshot = build_current_incurred_snapshot(
        con, DEFAULT_COHORT_YEARS, "2026-04-05", EXCLUDE_MOTO,
    )

    results = {}
    for vd, years in backtest_dates:
        print(f"\n--- Valuation Date: {vd} ---")
        pred = run_prediction(con, vd, years, EXCLUDE_MOTO)
        if "error" in pred:
            continue

        results[vd] = {}
        for yr_str, pred_data in pred.get("by_cohort_year", {}).items():
            yr = int(yr_str)
            predicted = pred_data.get("ultimate_lr_blend")
            actual_current = float(latest_snapshot.loc[yr, "current_incurred_lr"]) if yr in latest_snapshot.index else None

            if predicted and actual_current:
                error_pp = predicted - actual_current
                results[vd][yr_str] = {
                    "predicted_ulr": predicted,
                    "actual_current_lr": actual_current,
                    "error_pp": round(error_pp, 2),
                }
                status = "✓" if abs(error_pp) < 6 else "✗"
                print(f"  {yr}: predicted={predicted:.1f}%, actual_current={actual_current:.1f}%, "
                      f"error={error_pp:+.1f}pp {status}")

    # MAPE — 仅计算在最新快照中已成熟(>=24m)的 cohort，排除当年不成熟 cohort
    mature_errors = []
    immature_errors = []
    for vd_data in results.values():
        for yr_str, yr_data in vd_data.items():
            yr = int(yr_str)
            if yr_data.get("error_pp") is None:
                continue
            # 在最新快照时点，该 cohort 是否已成熟(>=24m)
            from ulr_methods import get_maturity_dev
            latest_dev = get_maturity_dev(yr, "2026-04-05")
            if latest_dev >= 24:
                mature_errors.append(yr_data["error_pp"])
            else:
                immature_errors.append(yr_data["error_pp"])

    if mature_errors:
        mape = sum(abs(e) for e in mature_errors) / len(mature_errors)
        bias = sum(mature_errors) / len(mature_errors)
        print(f"\n  成熟 cohort (>=24m at latest):")
        print(f"    MAPE: {mape:.2f}pp ({len(mature_errors)} observations)")
        print(f"    Bias: {bias:+.2f}pp")
        print(f"    验证: {'PASS ✓' if mape < 6 else 'FAIL ✗'} (阈值 < 6pp)")
    if immature_errors:
        mape_imm = sum(abs(e) for e in immature_errors) / len(immature_errors)
        print(f"\n  不成熟 cohort (<24m, 仅供参考, 'actual' 也非终极):")
        print(f"    MAPE: {mape_imm:.2f}pp ({len(immature_errors)} observations)")
        print(f"    ⚠️ 高估预期 — paid CL 在低成熟度时放大噪声")

    return results


# ============================================================================
# 维度预测
# ============================================================================

def run_dimensions(
    con: duckdb.DuckDBPyConnection,
    valuation_date: str,
    dimension: str | None = None,
    global_result: dict | None = None,
) -> dict:
    """维度切片预测。"""
    from ulr_dimensions import (
        INDEPENDENT_DIMENSIONS,
        RELATIVITY_DIMENSIONS,
        calc_relativities,
        predict_all_dimensions,
        predict_independent_dimension,
    )

    # 从全局结果中提取先验
    if global_result and "triangle" in global_result:
        global_prior = global_result["triangle"].get("cape_cod_prior_lr", 65.0)
    else:
        global_prior = 65.0

    # 取全局混合终极 LR（用 2025 或最新年份）
    if global_result:
        cohort_data = global_result.get("by_cohort_year", {})
        latest_blend = None
        for yr in ["2025", "2024", "2023"]:
            if yr in cohort_data and cohort_data[yr].get("ultimate_lr_blend"):
                latest_blend = cohort_data[yr]["ultimate_lr_blend"]
                break
        global_ulr = latest_blend or global_prior
    else:
        global_ulr = global_prior

    print(f"\n维度切片预测 (global ULR = {global_ulr:.1f}%, prior = {global_prior:.1f}%)\n")

    if dimension:
        dims_to_run = [dimension]
    else:
        dims_to_run = INDEPENDENT_DIMENSIONS + RELATIVITY_DIMENSIONS

    dim_results = {}
    for dim in dims_to_run:
        if dim in INDEPENDENT_DIMENSIONS:
            df = predict_independent_dimension(
                con, dim, global_ulr, global_prior / 100.0,
                DEFAULT_COHORT_YEARS, valuation_date,
            )
        elif dim in RELATIVITY_DIMENSIONS:
            df = calc_relativities(
                con, dim, global_ulr, DEFAULT_COHORT_YEARS, valuation_date,
            )
        else:
            print(f"  ⚠️ 未知维度: {dim}")
            continue

        print(f"\n  === {dim} ===")
        print(df.to_string(index=False))
        dim_results[dim] = df.to_dict(orient="records")

    return dim_results


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="终极赔付率预测 — Snapshot-Constrained v1",
    )
    parser.add_argument("--valuation-date", default=date.today().isoformat(),
                        help="评估日 (YYYY-MM-DD)，默认今天")
    parser.add_argument("--dimension", help="指定维度 (如 customer_category)")
    parser.add_argument("--all-dimensions", action="store_true", help="全维度预测")
    parser.add_argument("--backtest", action="store_true", help="回测验证")
    parser.add_argument("--output-json", action="store_true", help="输出 JSON 文件")
    parser.add_argument("-o", "--output", help="输出文件路径 (默认自动生成)")

    args = parser.parse_args()

    con = duckdb.connect()

    # 全量预测
    result = run_prediction(con, args.valuation_date)
    if "error" in result:
        print(f"\n❌ 预测失败: {result['error']}")
        sys.exit(1)

    # 维度预测
    if args.all_dimensions or args.dimension:
        dim_results = run_dimensions(con, args.valuation_date, args.dimension, result)
        result["by_dimension"] = dim_results

    # 回测
    if args.backtest:
        bt_results = run_backtest(con)
        result["backtest"] = bt_results

    # JSON 输出
    if args.output_json or args.output:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = args.output or str(
            OUTPUT_DIR / f"终极赔付率预测_{args.valuation_date.replace('-', '')}.json"
        )
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2, default=str)
        print(f"\n✅ JSON 输出: {out_path}")

    # HTML 报告
    from ulr_report import generate_report
    html_path = generate_report(result)
    print(f"✅ HTML 报告: {html_path}")

    con.close()
    print("\n✅ 预测完成")


if __name__ == "__main__":
    main()
