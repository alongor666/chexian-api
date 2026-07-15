"""机构维度塌缩检测单测（ETL 出口守卫 · 纯函数）。

被测模块：数据管理/pipelines/org_collapse.py

背景（缺口 B005-2026-07-09）：上游山西 01 签单「定稿」导出在 2026-07-01~04 退化，
`三级机构` 列坍缩为全「其他」（274,207 行仅 1 个 distinct 值）。transform.py 的
normalize_branch_org 对「其他」执行 org_map.get('其他','其他') = 原样保留，ETL 照常
产出 parquet 无任何告警 → SX 近月保单 org_level_3 全「其他」静默持续 5+ 天。

本测试锁定「一个关键分析维度归一化后坍缩成单一占位值 → 告警/失败」的判定逻辑。
参照 claims-freshness（纯函数 + 阈值边界三件套）。
"""
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.org_collapse import (  # noqa: E402
    DEFAULT_ORG_COLLAPSE_THRESHOLD,
    DEFAULT_ORG_PLACEHOLDERS,
    OrgDimensionCollapseError,
    evaluate_org_collapse,
    is_org_placeholder,
    org_collapse_should_fail,
    resolve_org_collapse_threshold,
)


class TestIsOrgPlaceholder(unittest.TestCase):
    def test_placeholder_values(self):
        for v in ["其他", "  其他 ", None, "", "   ", "nan", "NaN", "None",
                  "NULL", "null", float("nan")]:
            with self.subTest(v=v):
                self.assertTrue(is_org_placeholder(v), f"{v!r} 应判为占位值")

    def test_real_org_names_are_not_placeholders(self):
        # 含 2026-07-15 拆分后的新单元（经代/车商/重客）与已退役旧合并值（历史 parquet 仍可能出现）
        for v in ["太原一部", "太原二部", "大同", "运城", "经代", "车商", "重客", "经代、车商、重客"]:
            with self.subTest(v=v):
                self.assertFalse(is_org_placeholder(v), f"{v!r} 是真实机构名，不应判为占位值")


class TestEvaluateOrgCollapse(unittest.TestCase):
    def test_all_other_collapses_the_real_incident(self):
        """真实事故：274,207 行全「其他」→ 必须判定塌缩。"""
        v = evaluate_org_collapse({"其他": 274207})
        self.assertTrue(v.collapsed)
        self.assertEqual(v.total, 274207)
        self.assertEqual(v.distinct, 1)
        self.assertEqual(v.dominant_value, "其他")
        self.assertAlmostEqual(v.dominant_share, 1.0)
        self.assertAlmostEqual(v.placeholder_share, 1.0)

    def test_healthy_multi_org_not_collapsed(self):
        """正常 SX 13 经营单元分布（2026-07-15 经代/车商/重客 拆分后口径）→ 不塌缩。"""
        counts = {
            "太原一部": 4000, "太原二部": 3500,
            "经代": 1800, "车商": 1000, "重客": 200,
            "大同": 1200, "阳泉": 900, "长治": 800, "晋城": 700,
            "晋中": 650, "运城": 600, "临汾": 550, "吕梁": 500,
            "其他": 120,  # 少量兜底，合法
        }
        v = evaluate_org_collapse(counts)
        self.assertFalse(v.collapsed)
        self.assertEqual(v.distinct, 14)
        self.assertLess(v.placeholder_share, 0.05)

    def test_legit_single_org_concentration_not_collapsed(self):
        """合法机构集中：100% 集中在真实机构名 → 不塌缩（占位约束防误报）。"""
        v = evaluate_org_collapse({"太原一部": 100000})
        self.assertFalse(v.collapsed)
        self.assertEqual(v.dominant_value, "太原一部")
        self.assertAlmostEqual(v.dominant_share, 1.0)
        self.assertAlmostEqual(v.placeholder_share, 0.0)

    # ── 阈值边界三件套（默认阈值 0.95）──
    def test_boundary_exactly_at_threshold_collapses(self):
        """占位占比恰好 == 阈值 → 塌缩（>= 边界含等号）。"""
        v = evaluate_org_collapse({"其他": 95, "太原一部": 5})  # 0.95
        self.assertAlmostEqual(v.placeholder_share, 0.95)
        self.assertTrue(v.collapsed)

    def test_boundary_just_below_threshold_not_collapsed(self):
        v = evaluate_org_collapse({"其他": 94, "太原一部": 6})  # 0.94
        self.assertAlmostEqual(v.placeholder_share, 0.94)
        self.assertFalse(v.collapsed)

    def test_boundary_just_above_threshold_collapses(self):
        v = evaluate_org_collapse({"其他": 96, "太原一部": 4})  # 0.96
        self.assertAlmostEqual(v.placeholder_share, 0.96)
        self.assertTrue(v.collapsed)

    def test_null_bucket_is_placeholder(self):
        v = evaluate_org_collapse({None: 100})
        self.assertTrue(v.collapsed)
        self.assertIsNone(v.dominant_value)
        self.assertAlmostEqual(v.placeholder_share, 1.0)

    def test_nan_key_treated_as_placeholder(self):
        """pandas value_counts(dropna=False) 产出 NaN 桶 → 视为占位（免脆弱预转换）。"""
        v = evaluate_org_collapse({float("nan"): 100})
        self.assertTrue(v.collapsed)
        self.assertIsNone(v.dominant_value)

    def test_empty_string_is_placeholder(self):
        v = evaluate_org_collapse({"": 100})
        self.assertTrue(v.collapsed)

    def test_split_placeholder_mass_aggregates(self):
        """占位质量在 其他/NULL 间拆分：单一主值仅 60% 但合计 98% → 塌缩。

        证明聚合占位口径严格优于「单一主值 ≥ 阈值」字面口径。
        """
        v = evaluate_org_collapse({"其他": 60, None: 38, "太原一部": 2})
        self.assertAlmostEqual(v.dominant_share, 0.60)  # 单一主值不足阈值
        self.assertAlmostEqual(v.placeholder_share, 0.98)
        self.assertTrue(v.collapsed)

    def test_whitespace_variants_merge_into_canonical_key(self):
        """' 其他 ' 与 '其他' 归并为同一规范键。"""
        v = evaluate_org_collapse({" 其他 ": 50, "其他": 50})
        self.assertEqual(v.distinct, 1)
        self.assertEqual(v.dominant_value, "其他")
        self.assertTrue(v.collapsed)

    def test_empty_distribution_not_collapsed(self):
        """空分布（0 行）→ 不塌缩、不崩溃（无数据 ≠ 塌缩）。"""
        v = evaluate_org_collapse({})
        self.assertFalse(v.collapsed)
        self.assertEqual(v.total, 0)
        self.assertEqual(v.distinct, 0)
        self.assertIsNone(v.dominant_value)
        self.assertAlmostEqual(v.placeholder_share, 0.0)

    def test_zero_counts_ignored(self):
        """计数为 0 的键不计入分布。"""
        v = evaluate_org_collapse({"其他": 0, "太原一部": 100})
        self.assertEqual(v.distinct, 1)
        self.assertFalse(v.collapsed)

    def test_custom_threshold(self):
        """可传入更宽松阈值。"""
        counts = {"其他": 90, "太原一部": 10}  # 0.90
        self.assertFalse(evaluate_org_collapse(counts).collapsed)  # 默认 0.95
        self.assertTrue(evaluate_org_collapse(counts, threshold=0.90).collapsed)

    def test_accepts_iterable_of_pairs(self):
        """counts 也接受 (value, count) 对的可迭代。"""
        v = evaluate_org_collapse([("其他", 95), ("太原一部", 5)])
        self.assertTrue(v.collapsed)


class TestResolveThreshold(unittest.TestCase):
    def test_default_when_unset(self):
        self.assertEqual(resolve_org_collapse_threshold({}), DEFAULT_ORG_COLLAPSE_THRESHOLD)

    def test_reads_env_fraction(self):
        self.assertAlmostEqual(
            resolve_org_collapse_threshold({"ORG_COLLAPSE_WARN_THRESHOLD": "0.9"}), 0.9
        )

    def test_invalid_or_out_of_range_falls_back_to_default(self):
        for bad in ["abc", "", "1.5", "0", "-0.2", "2"]:
            with self.subTest(bad=bad):
                self.assertEqual(
                    resolve_org_collapse_threshold({"ORG_COLLAPSE_WARN_THRESHOLD": bad}),
                    DEFAULT_ORG_COLLAPSE_THRESHOLD,
                )


class TestShouldFail(unittest.TestCase):
    def test_defaults_to_warn_only(self):
        self.assertFalse(org_collapse_should_fail({}))
        self.assertFalse(org_collapse_should_fail({"ORG_COLLAPSE_FAIL": "0"}))
        self.assertFalse(org_collapse_should_fail({"ORG_COLLAPSE_FAIL": "false"}))

    def test_truthy_upgrades_to_fail(self):
        for truthy in ["1", "true", "TRUE", "yes", "on"]:
            with self.subTest(truthy=truthy):
                self.assertTrue(org_collapse_should_fail({"ORG_COLLAPSE_FAIL": truthy}))


class TestModuleContract(unittest.TestCase):
    def test_default_placeholders_include_other(self):
        self.assertIn("其他", DEFAULT_ORG_PLACEHOLDERS)

    def test_error_is_runtime_error(self):
        self.assertTrue(issubclass(OrgDimensionCollapseError, RuntimeError))


if __name__ == "__main__":
    unittest.main()
