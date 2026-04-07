#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR 精算方法层 — Paid Chain Ladder / BF / Benktander / Cape Cod / Tail Factor

纯 Python + numpy，不依赖 DuckDB。
所有函数接收 pd.DataFrame 或 dict，返回 dict。

v1 Snapshot-Constrained：不做伪历史 incurred CL。
"""

import numpy as np
import pandas as pd


# ============================================================================
# 1. Link Development Factors (LDF)
# ============================================================================

def calc_paid_ldfs(
    triangle: pd.DataFrame,
    methods: list[str] | None = None,
) -> dict[str, dict[int, float]]:
    """从 paid triangle 计算 monthly LDF。

    Args:
        triangle: index=cohort_year, columns=dev_month (int), values=cumulative paid.
                  NaN 表示该窗口不可用。
        methods: 要计算的加权方式列表，默认三种。

    Returns:
        {'volume_weighted': {dev_month: ldf, ...}, 'simple_avg': {...}, 'recent_3yr': {...}}
    """
    if methods is None:
        methods = ["volume_weighted", "simple_avg", "recent_3yr"]

    dev_cols = sorted(c for c in triangle.columns if isinstance(c, (int, np.integer)))
    result: dict[str, dict[int, float]] = {m: {} for m in methods}

    for i in range(len(dev_cols) - 1):
        d_from, d_to = dev_cols[i], dev_cols[i + 1]
        # 取有值的 cohort pair
        mask = triangle[d_from].notna() & triangle[d_to].notna() & (triangle[d_from] > 0)
        pairs = triangle.loc[mask, [d_from, d_to]]
        if pairs.empty:
            continue

        if "volume_weighted" in methods:
            result["volume_weighted"][d_from] = pairs[d_to].sum() / pairs[d_from].sum()

        if "simple_avg" in methods:
            individual = pairs[d_to] / pairs[d_from]
            result["simple_avg"][d_from] = individual.mean()

        if "recent_3yr" in methods:
            recent = pairs.tail(3)
            if len(recent) >= 2:
                result["recent_3yr"][d_from] = recent[d_to].sum() / recent[d_from].sum()

    return result


def select_ldfs(
    all_ldfs: dict[str, dict[int, float]],
    primary: str = "volume_weighted",
) -> dict[int, float]:
    """从多种方法中选择一套 LDF。默认 volume_weighted。"""
    return dict(all_ldfs.get(primary, {}))


# ============================================================================
# 2. Tail Factor
# ============================================================================

def estimate_tail(ldfs_or_values, cap: float = 1.005) -> float:
    """指数拟合外推 LDF 衰减趋势，硬上限 cap。

    对 (LDF - 1) 序列做对数线性回归，外推至收敛。
    若数据不足（<3 个点）或拟合失败，返回保守默认值。

    Args:
        ldfs_or_values: dict[int, float] 或 list[float]
    """
    if isinstance(ldfs_or_values, dict):
        sorted_devs = sorted(ldfs_or_values.keys())
        values = [ldfs_or_values[d] for d in sorted_devs]
    else:
        values = list(ldfs_or_values)

    excesses = [v - 1.0 for v in values if v > 1.0]

    if len(excesses) < 3:
        return min(1.002, cap)  # 保守默认

    ln_excess = np.log(np.array(excesses))
    x = np.arange(len(ln_excess))
    try:
        slope, intercept = np.polyfit(x, ln_excess, 1)
    except (np.linalg.LinAlgError, ValueError):
        return min(1.002, cap)

    if slope >= 0:
        return min(1.002, cap)  # 非递减，无法外推

    tail = 1.0
    for i in range(len(excesses), len(excesses) + 60):
        next_excess = np.exp(intercept + slope * i)
        if next_excess < 1e-6:
            break
        tail *= (1.0 + next_excess)

    return min(tail, cap)


# ============================================================================
# 3. Cumulative Development Factors (CDF)
# ============================================================================

def calc_cdfs(ldfs_selected: dict[int, float], tail: float = 1.005) -> dict[int, float]:
    """CDF[k] = LDF[k] × LDF[k+1] × ... × LDF[last] × tail。

    Returns:
        {dev_month: cdf_from_that_dev_to_ultimate}
    """
    sorted_devs = sorted(ldfs_selected.keys(), reverse=True)
    cdfs: dict[int, float] = {}
    cum = tail
    for d in sorted_devs:
        cum *= ldfs_selected[d]
        cdfs[d] = cum
    return cdfs


def get_maturity_dev(cohort_year: int, valuation_date_str: str) -> int:
    """计算某 cohort 在 valuation date 的发展月数。"""
    from datetime import date
    vd = date.fromisoformat(valuation_date_str) if isinstance(valuation_date_str, str) else valuation_date_str
    year_start = date(cohort_year, 1, 1)
    months = (vd.year - year_start.year) * 12 + (vd.month - year_start.month)
    return max(months, 0)


def get_cdf_at_dev(cdfs: dict[int, float], dev_month: int) -> float:
    """获取某发展月的 CDF。若 dev_month 超出已计算范围，用最近的或 tail。"""
    if dev_month in cdfs:
        return cdfs[dev_month]
    sorted_devs = sorted(cdfs.keys())
    if not sorted_devs:
        return 1.0
    if dev_month < sorted_devs[0]:
        return cdfs[sorted_devs[0]]  # 比最早发展月还年轻
    if dev_month > sorted_devs[-1]:
        return 1.0  # 已超过最大发展月，接近终极
    # 插值：找最近的较小 dev
    lower = max(d for d in sorted_devs if d <= dev_month)
    return cdfs[lower]


# ============================================================================
# 4. Chain Ladder Prediction
# ============================================================================

def predict_chain_ladder(
    paid_triangle: pd.DataFrame,
    earned_premium: dict[int, float],
    cdfs: dict[int, float],
    valuation_date: str = "2026-04-05",
) -> dict[int, dict]:
    """Paid Chain Ladder: ultimate_paid = latest_cumulative_paid × CDF。

    Returns:
        {cohort_year: {
            current_paid, cdf, ultimate_paid, ultimate_lr,
            ibnr (= ultimate_paid - current_paid),
            dev_month (当前发展月)
        }}
    """
    results = {}
    for yr in paid_triangle.index:
        ep = earned_premium.get(yr, 0)
        if ep <= 0:
            continue
        # 找最新有值的发展月
        row = paid_triangle.loc[yr].dropna()
        if row.empty:
            continue
        latest_dev = max(row.index)
        current_paid = row[latest_dev]
        cdf = get_cdf_at_dev(cdfs, latest_dev)
        ultimate_paid = current_paid * cdf
        results[yr] = {
            "current_paid": current_paid,
            "dev_month": int(latest_dev),
            "cdf": round(cdf, 4),
            "ultimate_paid": ultimate_paid,
            "ultimate_lr": round(ultimate_paid / ep * 100, 2) if ep > 0 else None,
            "ibnr": ultimate_paid - current_paid,
        }
    return results


# ============================================================================
# 5. Cape Cod Prior LR
# ============================================================================

def calc_cape_cod_lr(
    current_paid: dict[int, float],
    earned_premium: dict[int, float],
    cdfs_at_dev: dict[int, float],
    mature_years: list[int] | None = None,
) -> float:
    """Cape Cod prior LR = Σ(current_paid) / Σ(EP × paid-up-fraction)。

    paid-up-fraction = 1 / CDF_at_current_dev。
    仅用成熟 cohort 估计以避免不成熟年份拉偏。

    Args:
        current_paid: {cohort_year: cumulative_paid_at_valuation}
        earned_premium: {cohort_year: earned_premium}
        cdfs_at_dev: {cohort_year: cdf_at_current_dev_month}
        mature_years: 用于估计 prior 的年份列表，默认全部
    """
    if mature_years is None:
        mature_years = list(current_paid.keys())

    numerator = sum(current_paid.get(yr, 0) for yr in mature_years)
    denominator = sum(
        earned_premium.get(yr, 0) * (1.0 / cdfs_at_dev.get(yr, 1.0))
        for yr in mature_years
    )
    if denominator <= 0:
        return 0.65  # 保守默认

    return numerator / denominator


# ============================================================================
# 6. Bornhuetter-Ferguson
# ============================================================================

def predict_bf(
    current_paid: dict[int, float],
    earned_premium: dict[int, float],
    prior_lr: float,
    cdfs_at_dev: dict[int, float],
) -> dict[int, dict]:
    """BF: ultimate = current_paid + EP × prior_LR × unpaid_fraction。

    unpaid_fraction = 1 - 1/CDF。

    Returns:
        {cohort_year: {current_paid, prior_lr, unpaid_fraction, bf_ibnr, ultimate_paid, ultimate_lr}}
    """
    results = {}
    for yr in current_paid:
        ep = earned_premium.get(yr, 0)
        cp = current_paid[yr]
        cdf = cdfs_at_dev.get(yr, 1.0)
        unpaid = 1.0 - 1.0 / cdf if cdf > 0 else 0.0
        bf_ibnr = ep * prior_lr * unpaid
        ultimate = cp + bf_ibnr
        results[yr] = {
            "current_paid": cp,
            "prior_lr": round(prior_lr, 4),
            "unpaid_fraction": round(unpaid, 4),
            "bf_ibnr": bf_ibnr,
            "ultimate_paid": ultimate,
            "ultimate_lr": round(ultimate / ep * 100, 2) if ep > 0 else None,
        }
    return results


# ============================================================================
# 7. Benktander (Iterated BF)
# ============================================================================

def predict_benktander(
    current_paid: dict[int, float],
    earned_premium: dict[int, float],
    prior_lr: float,
    cdfs_at_dev: dict[int, float],
    cl_ultimate_lr: dict[int, float],
) -> dict[int, dict]:
    """Benktander: 用 paid-up fraction 作为 CL/BF 的混合权重。

    Z = 1/CDF (paid-up fraction，越成熟越大)
    blended_lr = Z × cl_ultimate_lr + (1-Z) × prior_lr
    ultimate = current_paid + (1 - Z) × blended_lr × EP
    """
    results = {}
    for yr in current_paid:
        ep = earned_premium.get(yr, 0)
        cp = current_paid[yr]
        cdf = cdfs_at_dev.get(yr, 1.0)
        z = 1.0 / cdf if cdf > 0 else 1.0  # paid-up fraction
        cl_lr = cl_ultimate_lr.get(yr, prior_lr)
        blended_lr = z * (cl_lr / 100.0) + (1.0 - z) * prior_lr
        bk_ibnr = ep * blended_lr * (1.0 - z)
        ultimate = cp + bk_ibnr
        results[yr] = {
            "current_paid": cp,
            "z_paid_up": round(z, 4),
            "blended_prior_lr": round(blended_lr, 4),
            "bk_ibnr": bk_ibnr,
            "ultimate_paid": ultimate,
            "ultimate_lr": round(ultimate / ep * 100, 2) if ep > 0 else None,
        }
    return results


# ============================================================================
# 8. Dynamic Blend (by maturity)
# ============================================================================

MATURITY_WEIGHTS = {
    "mature":         {"cl": 0.7, "bf": 0.2, "benktander": 0.1},  # dev >= 24m
    "mid_mature":     {"cl": 0.4, "bf": 0.3, "benktander": 0.3},  # 12-24m
    "immature":       {"cl": 0.1, "bf": 0.5, "benktander": 0.4},  # 3-12m
    "very_immature":  {"cl": 0.0, "bf": 1.0, "benktander": 0.0},  # < 3m
}


def classify_maturity(dev_month: int) -> str:
    """按发展月数分类成熟度。"""
    if dev_month >= 24:
        return "mature"
    if dev_month >= 12:
        return "mid_mature"
    if dev_month >= 6:
        return "immature"
    return "very_immature"  # < 6 months: BF-only


def dynamic_blend(
    cl_results: dict[int, dict],
    bf_results: dict[int, dict],
    bk_results: dict[int, dict],
    earned_premium: dict[int, float],
    valuation_date: str = "2026-04-05",
) -> dict[int, dict]:
    """按 maturity 动态混合三种方法的终极赔付率。

    Returns:
        {cohort_year: {
            maturity, method_weights,
            ultimate_lr_cl, ultimate_lr_bf, ultimate_lr_bk,
            ultimate_lr_blend, ultimate_paid_blend, ibnr_blend,
            current_paid, earned_premium_wan, uncertainty_flag
        }}
    """
    results = {}
    all_years = set(cl_results) | set(bf_results) | set(bk_results)

    for yr in sorted(all_years):
        dev = get_maturity_dev(yr, valuation_date)
        maturity = classify_maturity(dev)
        weights = MATURITY_WEIGHTS[maturity]
        ep = earned_premium.get(yr, 0)

        lr_cl = cl_results.get(yr, {}).get("ultimate_lr")
        lr_bf = bf_results.get(yr, {}).get("ultimate_lr")
        lr_bk = bk_results.get(yr, {}).get("ultimate_lr")

        # 混合（跳过 None）
        blend_num = 0.0
        blend_den = 0.0
        for key, lr_val in [("cl", lr_cl), ("bf", lr_bf), ("benktander", lr_bk)]:
            w = weights[key]
            if lr_val is not None and w > 0:
                blend_num += w * lr_val
                blend_den += w
        blend_lr = round(blend_num / blend_den, 2) if blend_den > 0 else None

        cp = cl_results.get(yr, bf_results.get(yr, {})).get("current_paid", 0)
        ultimate_paid = ep * (blend_lr / 100.0) if blend_lr and ep > 0 else None
        ibnr = (ultimate_paid - cp) if ultimate_paid is not None else None

        results[yr] = {
            "cohort_year": yr,
            "dev_month": dev,
            "maturity": maturity,
            "method_weights": weights,
            "ultimate_lr_cl": lr_cl,
            "ultimate_lr_bf": lr_bf,
            "ultimate_lr_bk": lr_bk,
            "ultimate_lr_blend": blend_lr,
            "current_paid": cp,
            "earned_premium_wan": round(ep / 1e4, 1) if ep else 0,
            "ultimate_paid_blend": ultimate_paid,
            "ibnr_blend": ibnr,
            "uncertainty_flag": maturity in ("immature", "very_immature"),
        }
    return results
