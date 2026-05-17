#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ULR 终极赔付率预测模型单元测试
使用 pytest，覆盖 4 个核心场景：
  1. Origin Policy 去重验证（DuckDB 内存表）
  2. LDF 单调递减 + tail cap 生效
  3. Maturity 权重切换
  4. 双阈值可信度收缩
"""

import sys
import os

# 确保 pipelines 目录在 sys.path 中
_PIPELINES_DIR = os.path.dirname(os.path.abspath(__file__))
if _PIPELINES_DIR not in sys.path:
    sys.path.insert(0, _PIPELINES_DIR)

import numpy as np
import pandas as pd
import pytest
import duckdb

from ulr_methods import (
    calc_paid_ldfs,
    calc_cdfs,
    estimate_tail,
    classify_maturity,
    dynamic_blend,
    MATURITY_WEIGHTS,
    predict_chain_ladder,
    predict_bf,
    predict_benktander,
)
from ulr_dimensions import credibility_blend
from ulr_triangle import build_current_incurred_snapshot
from ulr_v1_maturity import compute_cohort_maturity


# ============================================================================
# Test 1: Origin Policy 去重验证（endorsement_no IS NULL 过滤）
# ============================================================================

class TestOriginPolicyDedup:
    """验证批改单（endorsement_no 非空）不会重复放大保单计数。"""

    def setup_method(self):
        """每个测试方法前创建内存 DuckDB 连接及临时表。"""
        self.con = duckdb.connect(":memory:")
        # 构造内存临时表：
        #   policy_no P001 + P002 是原始保单（endorsement_no IS NULL）
        #   policy_no P001 有一条批改记录（endorsement_no = 'E001'）
        self.con.execute("""
            CREATE TABLE mock_policy AS
            SELECT
                policy_no,
                endorsement_no,
                CAST('2025-01-01' AS DATE) AS insurance_start_date,
                1000.0 AS premium,
                '非营业家用车' AS customer_category,
                '主全' AS coverage_combination,
                'A'   AS insurance_grade,
                '成都中支' AS org_level_3,
                false AS is_nev,
                false AS is_new_car,
                true  AS is_renewal,
                '其他' AS tonnage_segment
            FROM (VALUES
                ('P001', NULL),
                ('P002', NULL),
                ('P001', 'E001')
            ) AS t(policy_no, endorsement_no)
        """)

    def teardown_method(self):
        self.con.close()

    def test_origin_policy_filters_endorsements(self):
        """endorsement_no IS NULL 过滤后，同一 claim_no 不因批改记录重复。"""
        result = self.con.execute("""
            SELECT COUNT(*) AS cnt
            FROM mock_policy
            WHERE endorsement_no IS NULL
        """).fetchone()

        assert result[0] == 2, (
            f"原始保单应恰好 2 条，但得到 {result[0]} 条。"
            "批改记录（endorsement_no 非空）不得计入 origin policy。"
        )

    def test_no_duplicate_policy_no(self):
        """过滤后，policy_no 无重复（每张原始保单只计一次）。"""
        result = self.con.execute("""
            SELECT COUNT(DISTINCT policy_no) AS uniq_cnt
            FROM mock_policy
            WHERE endorsement_no IS NULL
        """).fetchone()

        assert result[0] == 2, (
            f"去重后应有 2 个唯一保单号，得到 {result[0]}。"
        )

    def test_with_endorsement_total_rows(self):
        """含批改记录时全表有 3 行，验证测试数据构造正确。"""
        result = self.con.execute("SELECT COUNT(*) FROM mock_policy").fetchone()
        assert result[0] == 3


# ============================================================================
# Test 2: LDF 单调递减 + tail cap 生效
# ============================================================================

class TestLDFMonotonicAndTailCap:
    """验证 paid triangle 上 LDF 递减性质及 tail factor 上限。"""

    @pytest.fixture(autouse=True)
    def setup_triangle(self):
        """构造一个简单的 paid triangle，LDF 序列自然递减。"""
        # cohort × dev_month，赔付额设计为 LDF 从高到低
        # dev 12→24: LDF ≈ 1.30
        # dev 24→36: LDF ≈ 1.15
        # dev 36→48: LDF ≈ 1.05
        # dev 48→60: LDF ≈ 1.02
        data = {
            12:  [100, 110, 120, 130],
            24:  [130, 143, 156, 169],  # ×1.30
            36:  [150, 164, 179, 194],  # ×1.15 approx
            48:  [157, 172, 188, 204],  # ×1.05 approx
            60:  [160, 175, 192, 208],  # ×1.02 approx
        }
        self.triangle = pd.DataFrame(
            data,
            index=[2020, 2021, 2022, 2023],
        )
        self.triangle.index.name = "cohort_year"

    def test_volume_weighted_ldfs_exist(self):
        """calc_paid_ldfs 应返回 volume_weighted LDF 字典，且键数量正确。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        # 4 个相邻 dev 对 → 4 个 LDF 值
        assert len(vw) == 4, f"期望 4 个 LDF，得到 {len(vw)}"

    def test_ldfs_are_greater_than_one(self):
        """所有 LDF > 1（赔付额单调增长）。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        for dev, ldf in vw.items():
            assert ldf > 1.0, f"dev={dev} 的 LDF={ldf:.4f} 应 > 1"

    def test_volume_weighted_ldfs_are_decreasing(self):
        """LDF 序列应单调递减（早期 dev 发展快，后期收敛）。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        sorted_devs = sorted(vw.keys())
        for i in range(len(sorted_devs) - 1):
            d1, d2 = sorted_devs[i], sorted_devs[i + 1]
            assert vw[d1] >= vw[d2], (
                f"LDF 序列不单调递减：dev={d1} LDF={vw[d1]:.4f} < dev={d2} LDF={vw[d2]:.4f}"
            )

    def test_tail_respects_cap(self):
        """estimate_tail 返回值 <= cap（默认 1.005）。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        cap = 1.005
        tail = estimate_tail(vw, cap=cap)
        assert tail <= cap, f"tail={tail:.6f} 超过 cap={cap}"
        assert tail >= 1.0, f"tail={tail:.6f} 不应 < 1.0"

    def test_tail_with_custom_cap(self):
        """自定义 cap=1.003 时，tail 不超过该上限。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        cap = 1.003
        tail = estimate_tail(vw, cap=cap)
        assert tail <= cap, f"tail={tail:.6f} 超过自定义 cap={cap}"

    def test_cdfs_are_decreasing(self):
        """CDF 序列应单调递减：越早的 dev_month，CDF 越大（距终极更远）。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        tail = estimate_tail(vw)
        cdfs = calc_cdfs(vw, tail)

        sorted_devs = sorted(cdfs.keys())  # 从小到大
        for i in range(len(sorted_devs) - 1):
            d1, d2 = sorted_devs[i], sorted_devs[i + 1]
            assert cdfs[d1] >= cdfs[d2], (
                f"CDF 序列不单调递减：dev={d1} CDF={cdfs[d1]:.4f} < dev={d2} CDF={cdfs[d2]:.4f}"
            )

    def test_cdfs_all_greater_than_one(self):
        """所有 CDF > 1（仍有未报 IBNR 需发展到终极）。"""
        all_ldfs = calc_paid_ldfs(self.triangle)
        vw = all_ldfs["volume_weighted"]
        tail = estimate_tail(vw)
        cdfs = calc_cdfs(vw, tail)
        for dev, cdf in cdfs.items():
            assert cdf > 1.0, f"dev={dev} 的 CDF={cdf:.4f} 应 > 1.0"


# ============================================================================
# Test 3: Maturity 分类 + dynamic_blend 对 very_immature 只用 BF
# ============================================================================

class TestMaturityClassificationAndBlend:
    """验证 classify_maturity 阈值正确，且 very_immature 仅使用 BF 方法。"""

    def test_classify_mature(self):
        """dev_month >= 24 → 'mature'"""
        assert classify_maturity(60) == "mature"
        assert classify_maturity(24) == "mature"

    def test_classify_mid_mature(self):
        """12 <= dev_month < 24 → 'mid_mature'"""
        assert classify_maturity(15) == "mid_mature"
        assert classify_maturity(12) == "mid_mature"
        assert classify_maturity(23) == "mid_mature"

    def test_classify_immature(self):
        """6 <= dev_month < 12 → 'immature'"""
        assert classify_maturity(8) == "immature"
        assert classify_maturity(6) == "immature"
        assert classify_maturity(11) == "immature"

    def test_classify_very_immature(self):
        """dev_month < 6 → 'very_immature'"""
        assert classify_maturity(3) == "very_immature"
        assert classify_maturity(0) == "very_immature"
        assert classify_maturity(5) == "very_immature"

    def test_very_immature_weights_cl_is_zero(self):
        """MATURITY_WEIGHTS['very_immature']['cl'] 必须为 0。"""
        weights = MATURITY_WEIGHTS["very_immature"]
        assert weights["cl"] == 0.0, (
            f"very_immature 的 CL 权重应为 0，得到 {weights['cl']}"
        )

    def test_very_immature_weights_bf_is_one(self):
        """MATURITY_WEIGHTS['very_immature']['bf'] 必须为 1.0（纯 BF）。"""
        weights = MATURITY_WEIGHTS["very_immature"]
        assert weights["bf"] == 1.0, (
            f"very_immature 的 BF 权重应为 1.0，得到 {weights['bf']}"
        )

    def test_dynamic_blend_very_immature_uses_bf_only(self):
        """dynamic_blend 对 very_immature cohort，混合 LR 应等于 BF 的 LR。"""
        # 构造一个 cohort_year，使其 dev_month < 6
        # valuation_date 距 cohort 年初只有 3 个月
        cohort_year = 2026
        valuation_date = "2026-04-05"  # cohort 2026 在此日期 dev ≈ 3 个月

        cl_results = {cohort_year: {"ultimate_lr": 80.0, "current_paid": 500}}
        bf_results = {cohort_year: {"ultimate_lr": 65.0, "current_paid": 500}}
        bk_results = {cohort_year: {"ultimate_lr": 70.0, "current_paid": 500}}
        earned_premium = {cohort_year: 10_000_000}

        blend = dynamic_blend(
            cl_results, bf_results, bk_results, earned_premium, valuation_date
        )

        row = blend[cohort_year]
        assert row["maturity"] == "very_immature", (
            f"cohort 2026 在 2026-04-05 应为 very_immature，得到 {row['maturity']}"
        )
        # CL 权重 = 0，因此混合 LR 只来自 BF（bf=1.0, bk=0.0）
        assert row["ultimate_lr_blend"] == pytest.approx(65.0, abs=0.1), (
            f"very_immature 混合 LR 应 ≈ BF LR (65.0)，得到 {row['ultimate_lr_blend']}"
        )

    def test_mature_blend_uses_cl_dominated(self):
        """mature cohort (dev >= 24)，混合 LR 应被 CL 主导（CL 权重 = 0.7）。"""
        cohort_year = 2022
        valuation_date = "2026-04-05"  # dev ≈ 51 个月 → mature

        cl_lr, bf_lr, bk_lr = 72.0, 60.0, 65.0
        cl_results = {cohort_year: {"ultimate_lr": cl_lr, "current_paid": 5000}}
        bf_results = {cohort_year: {"ultimate_lr": bf_lr, "current_paid": 5000}}
        bk_results = {cohort_year: {"ultimate_lr": bk_lr, "current_paid": 5000}}
        earned_premium = {cohort_year: 50_000_000}

        blend = dynamic_blend(
            cl_results, bf_results, bk_results, earned_premium, valuation_date
        )

        row = blend[cohort_year]
        assert row["maturity"] == "mature"
        # 手动计算期望混合值: 0.7×72 + 0.2×60 + 0.1×65 = 50.4+12+6.5 = 68.9
        expected = 0.7 * cl_lr + 0.2 * bf_lr + 0.1 * bk_lr
        assert row["ultimate_lr_blend"] == pytest.approx(expected, abs=0.1), (
            f"mature 混合 LR 期望 {expected:.1f}，得到 {row['ultimate_lr_blend']}"
        )


# ============================================================================
# Test 4: 双阈值可信度收缩
# ============================================================================

class TestCredibilityBlend:
    """验证 credibility_blend 的双阈值逻辑。"""

    def test_very_small_policy_count_returns_global(self):
        """n_policies < 100 时，Z=0，直接回退全局 LR。"""
        blended, z = credibility_blend(
            segment_lr=90.0,
            global_lr=65.0,
            n_policies=50,   # < 100
            n_claims=200,
        )
        assert z == 0.0, f"n_policies=50 时 Z 应为 0，得到 {z}"
        assert blended == pytest.approx(65.0), (
            f"Z=0 时混合 LR 应等于 global_lr=65.0，得到 {blended}"
        )

    def test_small_claim_count_returns_global(self):
        """n_claims < 30 时，Z=0，直接回退全局 LR。"""
        blended, z = credibility_blend(
            segment_lr=85.0,
            global_lr=65.0,
            n_policies=10_000,  # 足够
            n_claims=20,        # < 30
        )
        assert z == 0.0, f"n_claims=20 时 Z 应为 0，得到 {z}"
        assert blended == pytest.approx(65.0), (
            f"Z=0 时混合 LR 应等于 global_lr=65.0，得到 {blended}"
        )

    def test_both_thresholds_met_z_gt_half(self):
        """n_policies=5000, n_claims=300 时，Z > 0.5（足够可信）。"""
        blended, z = credibility_blend(
            segment_lr=75.0,
            global_lr=65.0,
            n_policies=5000,
            n_claims=300,
        )
        assert z > 0.5, f"大样本时 Z 应 > 0.5，得到 {z:.4f}"

    def test_z_zero_blended_equals_global(self):
        """Z=0 时，blended_lr 必须严格等于 global_lr，与 segment_lr 无关。"""
        global_lr = 65.0
        for seg_lr in [50.0, 80.0, 100.0]:
            blended, z = credibility_blend(
                segment_lr=seg_lr,
                global_lr=global_lr,
                n_policies=10,  # 触发极小样本回退
                n_claims=5,
            )
            assert z == 0.0
            assert blended == pytest.approx(global_lr), (
                f"segment_lr={seg_lr} 时 Z=0，blended 应={global_lr}，得到 {blended}"
            )

    def test_blended_is_between_segment_and_global(self):
        """当 0 < Z < 1 时，blended_lr 应在 [global_lr, segment_lr] 之间。"""
        seg_lr, global_lr = 80.0, 65.0
        blended, z = credibility_blend(
            segment_lr=seg_lr,
            global_lr=global_lr,
            n_policies=3000,
            n_claims=150,
        )
        assert 0.0 < z < 1.0, f"Z 应在 (0, 1) 之间，得到 {z}"
        lower = min(seg_lr, global_lr)
        upper = max(seg_lr, global_lr)
        assert lower <= blended <= upper, (
            f"blended={blended:.2f} 应在 [{lower}, {upper}] 之间"
        )

    def test_large_sample_z_approaches_one(self):
        """极大样本时 Z 接近 1（高度可信，几乎不收缩）。"""
        _, z = credibility_blend(
            segment_lr=75.0,
            global_lr=65.0,
            n_policies=1_000_000,
            n_claims=100_000,
        )
        assert z > 0.9, f"极大样本时 Z 应接近 1，得到 {z:.4f}"


# ============================================================================
# Test 5: Claims amount semantics（已决/未决二选一）
# ============================================================================

def _build_ulr_claim_semantics_fixtures(tmp_path):
    """构造一张已结案 + 一张未结案赔案，已结案 reserve 不得进入 pending。"""
    policy_path = tmp_path / "policy.parquet"
    claims_path = tmp_path / "claims.parquet"

    pd.DataFrame([
        {
            "policy_no": "P001",
            "endorsement_no": None,
            "insurance_start_date": pd.Timestamp("2024-01-01"),
            "premium": 10_000.0,
            "customer_category": "非营业个人客车",
            "coverage_combination": "主全",
            "insurance_grade": "A",
            "org_level_3": "成都",
            "is_nev": False,
            "is_new_car": False,
            "is_renewal": True,
            "tonnage_segment": "其他",
        },
    ]).to_parquet(policy_path, index=False)

    pd.DataFrame([
        {
            "policy_no": "P001",
            "claim_no": "C_SETTLED",
            "settlement_time": pd.Timestamp("2024-06-01"),
            "settled_amount": 100.0,
            "reserve_amount": 1_000.0,
            "settled_vehicle_amount": 100.0,
            "settled_bodily_amount": 0.0,
            "reserve_vehicle_amount": 1_000.0,
            "reserve_bodily_amount": 0.0,
            "reserve_property_amount": 0.0,
        },
        {
            "policy_no": "P001",
            "claim_no": "C_PENDING",
            "settlement_time": pd.NaT,
            "settled_amount": 50.0,
            "reserve_amount": 200.0,
            "settled_vehicle_amount": 50.0,
            "settled_bodily_amount": 0.0,
            "reserve_vehicle_amount": 200.0,
            "reserve_bodily_amount": 0.0,
            "reserve_property_amount": 0.0,
        },
    ]).to_parquet(claims_path, index=False)

    return policy_path, claims_path


def test_current_pending_excludes_settled_claim_reserve(tmp_path):
    """current_pending 是未决分项，只能取未结案 reserve，不能泄漏已结案 reserve。"""
    con = duckdb.connect(":memory:")
    policy_path, claims_path = _build_ulr_claim_semantics_fixtures(tmp_path)

    result = build_current_incurred_snapshot(
        con,
        [2024],
        valuation_date="2024-12-31",
        policy_glob=str(policy_path),
        claims_path=str(claims_path),
    )

    row = result.loc[2024]
    assert row["current_pending"] == pytest.approx(200.0)
    assert row["current_incurred"] == pytest.approx(300.0)


def test_maturity_pending_excludes_settled_claim_reserve(tmp_path):
    """maturity 的 pending_all 同样只统计未结案 reserve。"""
    con = duckdb.connect(":memory:")
    policy_path, claims_path = _build_ulr_claim_semantics_fixtures(tmp_path)

    rows = compute_cohort_maturity(
        con,
        "2024-12-31",
        [2024],
        policy_glob=str(policy_path),
        claims_path=str(claims_path),
    )

    assert rows[0]["pending_all"] == pytest.approx(200.0)
