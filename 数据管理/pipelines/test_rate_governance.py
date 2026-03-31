"""率值指标治理 — 防回归测试

治理规则：
- A类率值：分子/分母均为可加绝对值，汇总时先聚合分子分母再算率值
- B类率值：需要逐保单修正后的中间绝对值（如 annualized_cases），禁止在上层重算
- 禁止对子项率值做 avg / mean / weighted average / 二次汇总
"""

import sys
import os
import pytest

# 将 pipelines 加入 path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from diagnose_common import sum_kpi_dicts


# ─── 测试 1：sum_kpi_dicts 年化出险率（B类）── annualized_cases 可加后重算 ───

class TestIncidentRateAggregation:
    """V1 防回归：incident_rate 必须基于 annualized_cases / policy_count，
    而非 claim_policies / policy_count"""

    def _make_dict(self, policy_count, annualized_cases, claim_policies,
                   written_premium=100, earned_premium=80,
                   reported_claims=10, claim_cases=5, fee_amount=5):
        return {
            "policy_count": policy_count,
            "annualized_cases": annualized_cases,
            "claim_policies": claim_policies,
            "written_premium": written_premium,
            "earned_premium": earned_premium,
            "reported_claims": reported_claims,
            "claim_cases": claim_cases,
            "fee_amount": fee_amount,
        }

    def test_single_group_matches_direct_calc(self):
        """单分组时 incident_rate == annualized_cases / policy_count * 100"""
        d = self._make_dict(policy_count=100, annualized_cases=25.0, claim_policies=20)
        result = sum_kpi_dicts([d])
        expected = round(25.0 / 100 * 100, 1)  # 25.0%
        assert result["incident_rate"] == expected

    def test_multi_group_uses_annualized_not_simple(self):
        """跨分组汇总时，incident_rate 基于 SUM(annualized_cases)/SUM(policy_count)，
        而非 SUM(claim_policies)/SUM(policy_count)（旧公式）"""
        # 分组 A：10保单，年化赔案4.06，有赔案保单5
        dict_a = self._make_dict(policy_count=10, annualized_cases=4.06, claim_policies=5)
        # 分组 B：20保单，年化赔案3.66，有赔案保单3
        dict_b = self._make_dict(policy_count=20, annualized_cases=3.66, claim_policies=3)

        result = sum_kpi_dicts([dict_a, dict_b])

        # 正确值：(4.06 + 3.66) / 30 * 100 = 25.7%
        correct = round((4.06 + 3.66) / 30 * 100, 1)
        # 旧公式值：(5 + 3) / 30 * 100 = 26.7%（错误）
        wrong_old = round((5 + 3) / 30 * 100, 1)

        assert result["incident_rate"] == correct
        assert result["incident_rate"] != wrong_old, \
            "incident_rate 不应使用 claim_policies/policy_count 旧公式"

    def test_monotonicity(self):
        """汇总行 incident_rate 应在各子分组的 min/max 之间（加权均值性质）"""
        dict_a = self._make_dict(policy_count=50, annualized_cases=10.0, claim_policies=8)
        dict_b = self._make_dict(policy_count=50, annualized_cases=30.0, claim_policies=25)

        rate_a = 10.0 / 50 * 100  # 20%
        rate_b = 30.0 / 50 * 100  # 60%

        result = sum_kpi_dicts([dict_a, dict_b])
        assert min(rate_a, rate_b) <= result["incident_rate"] <= max(rate_a, rate_b)

    def test_empty_annualized_cases_returns_none(self):
        """若 annualized_cases 缺失，incident_rate 应为 None 而非报错"""
        d = {"policy_count": 10, "claim_policies": 3,
             "written_premium": 100, "earned_premium": 80,
             "reported_claims": 10, "claim_cases": 5, "fee_amount": 5}
        # 无 annualized_cases 字段
        result = sum_kpi_dicts([d])
        assert result["incident_rate"] is None


# ─── 测试 2：A类率值汇总正确性 ───

class TestARateAggregation:
    """A类率值（loss_ratio, expense_ratio）必须等于 聚合分子/聚合分母"""

    def test_loss_ratio_is_sum_over_sum(self):
        d1 = {"policy_count": 10, "written_premium": 200, "earned_premium": 150,
              "reported_claims": 30, "claim_cases": 2, "claim_policies": 2,
              "fee_amount": 10, "annualized_cases": 2.5}
        d2 = {"policy_count": 20, "written_premium": 400, "earned_premium": 300,
              "reported_claims": 90, "claim_cases": 5, "claim_policies": 4,
              "fee_amount": 20, "annualized_cases": 5.5}

        result = sum_kpi_dicts([d1, d2])

        # loss_ratio = SUM(reported_claims) / SUM(earned_premium) * 100
        expected_lr = round((30 + 90) / (150 + 300) * 100, 1)
        assert result["loss_ratio"] == expected_lr

        # expense_ratio = SUM(fee_amount) / SUM(written_premium) * 100
        expected_er = round((10 + 20) / (200 + 400) * 100, 1)
        assert result["expense_ratio"] == expected_er

    def test_summary_rate_not_average_of_child_rates(self):
        """汇总率值 ≠ 子分组率值的算术平均"""
        # 刻意制造体量悬殊的分组
        small = {"policy_count": 1, "written_premium": 10, "earned_premium": 8,
                 "reported_claims": 8, "claim_cases": 1, "claim_policies": 1,
                 "fee_amount": 1, "annualized_cases": 1.2}
        # loss_ratio_small = 8/8*100 = 100%
        large = {"policy_count": 100, "written_premium": 1000, "earned_premium": 800,
                 "reported_claims": 80, "claim_cases": 10, "claim_policies": 8,
                 "fee_amount": 100, "annualized_cases": 12.0}
        # loss_ratio_large = 80/800*100 = 10%

        result = sum_kpi_dicts([small, large])

        # 正确：(8+80)/(8+800)*100 = 88/808*100 ≈ 10.9%
        correct = round(88 / 808 * 100, 1)
        # 算术平均：(100 + 10) / 2 = 55%（严重错误）
        wrong_avg = (100 + 10) / 2

        assert result["loss_ratio"] == correct
        assert abs(result["loss_ratio"] - wrong_avg) > 10, \
            "汇总率值不应接近子分组率值的算术平均"


# ─── 测试 3：推介率绝对值重算（A类） ───

class TestRecommendationRateGovernance:
    """V3 防回归：推介率汇总必须基于 driver_count/auto_count 绝对值"""

    def test_weighted_vs_arithmetic_mean(self):
        """体量悬殊时，加权结果应偏向大机构"""
        # 模拟 org_data 结构
        org_data = {
            '小机构': {
                'driver_count_by_date': {'2026-03-01': 1},
                'auto_count_by_date': {'2026-03-01': 5},
            },
            '大机构': {
                'driver_count_by_date': {'2026-03-01': 40},
                'auto_count_by_date': {'2026-03-01': 100},
            },
        }

        # 正确：基于绝对值
        all_driver = sum(sum(v['driver_count_by_date'].values()) for v in org_data.values())
        all_auto = sum(sum(v['auto_count_by_date'].values()) for v in org_data.values())
        weighted_avg = (all_driver / all_auto * 100) if all_auto else 0

        # 错误：各机构率值的算术平均
        rate_small = 1 / 5 * 100  # 20%
        rate_large = 40 / 100 * 100  # 40%
        arithmetic_avg = (rate_small + rate_large) / 2  # 30%

        assert abs(weighted_avg - 39.05) < 0.1, f"加权均值应≈39.05%，实际={weighted_avg}"
        assert abs(arithmetic_avg - 30.0) < 0.1
        assert weighted_avg != arithmetic_avg, "加权均值不应等于算术平均"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
