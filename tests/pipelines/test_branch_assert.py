"""省份隔离 · 出口零信任断言单测（防线④）。

被测模块：数据管理/pipelines/branch_assert.py
语义：数据出门前强制体检——DISTINCT branch_code ≤ 1（单省）才放行，
跨省（>1）即 fail-closed 抛 BranchIsolationError 中止。无 branch_code 列时
从 policy_no[:3] 按 fields.json mapping（610→SC / 618→SX）派生省份。

覆盖 architect 评审指出的 fail-closed 漏洞：
- 漏洞 A：policy_no 前缀未命中 mapping 不得静默丢弃
- 漏洞 B：branch_code 列存在但含 NULL 不得当空集合放行
"""
import os
import unittest
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.branch_assert import (  # noqa: E402
    BranchIsolationError,
    assert_single_branch,
    derive_branches,
    get_branch_mapping,
    get_branch_prefix_length,
    is_national_view,
)


class TestGetBranchMapping(unittest.TestCase):
    def test_reads_mapping_from_fields_json_ssot(self):
        """mapping 唯一事实源 = fields.json branch_code.derivation.mapping。"""
        m = get_branch_mapping()
        self.assertEqual(m["610"], "SC")
        self.assertEqual(m["618"], "SX")

    def test_mapping_is_readonly(self):
        """缓存返回只读视图，防外部静默污染（code-review HIGH-2）。"""
        m = get_branch_mapping()
        with self.assertRaises(TypeError):
            m["999"] = "XX"

    def test_prefix_length_read_from_fields_json(self):
        """prefixLength 读 fields.json SSOT 而非从键长推导（code-review HIGH-1）。"""
        self.assertEqual(get_branch_prefix_length(), 3)


class TestDeriveBranches(unittest.TestCase):
    def test_branch_code_column_single(self):
        df = pd.DataFrame({"branch_code": ["SC", "SC", "SC"]})
        self.assertEqual(derive_branches(df), {"SC"})

    def test_branch_code_column_mixed(self):
        df = pd.DataFrame({"branch_code": ["SC", "SX"]})
        self.assertEqual(derive_branches(df), {"SC", "SX"})

    def test_derived_from_policy_no_single(self):
        df = pd.DataFrame({"policy_no": ["6100001", "6100002"]})
        self.assertEqual(derive_branches(df), {"SC"})

    def test_derived_from_policy_no_mixed(self):
        # 核心场景：sync 企微 df 无 branch_code 列，610(SC)+618(SX) 混入
        df = pd.DataFrame({"policy_no": ["6100001", "6180001"]})
        self.assertEqual(derive_branches(df), {"SC", "SX"})

    def test_branch_code_preferred_over_policy_no(self):
        # 两列都在：branch_code 列优先（更权威），不重复从 policy_no 派生
        df = pd.DataFrame({"branch_code": ["SC", "SC"], "policy_no": ["6100001", "6100002"]})
        self.assertEqual(derive_branches(df), {"SC"})

    def test_branch_code_column_only_no_policy_no_passes(self):
        # architect 边界：有 branch_code 列、无 policy_no 列 → 第 1 段命中
        df = pd.DataFrame({"branch_code": ["SX", "SX"]})
        self.assertEqual(derive_branches(df), {"SX"})

    def test_empty_df_returns_empty_set(self):
        df = pd.DataFrame({"policy_no": pd.Series([], dtype=str)})
        self.assertEqual(derive_branches(df), set())

    # ---- fail-closed 漏洞 A：未知 policy_no 前缀不得静默丢弃 ----
    def test_unknown_policy_no_prefix_raises(self):
        df = pd.DataFrame({"policy_no": ["9990001", "6100002"]})
        with self.assertRaises(BranchIsolationError):
            derive_branches(df)

    def test_null_policy_no_raises(self):
        df = pd.DataFrame({"policy_no": ["6100001", None]})
        with self.assertRaises(BranchIsolationError):
            derive_branches(df)

    # ---- fail-closed 漏洞 B：branch_code 列含 NULL 不得当空集合放行 ----
    def test_branch_code_column_all_null_raises(self):
        df = pd.DataFrame({"branch_code": [None, None]})
        with self.assertRaises(BranchIsolationError):
            derive_branches(df)

    def test_branch_code_column_partial_null_raises(self):
        df = pd.DataFrame({"branch_code": ["SC", None], "policy_no": ["6100001", "6100002"]})
        with self.assertRaises(BranchIsolationError):
            derive_branches(df)

    # ---- 未知 branch_code 值（非 SC/SX）fail-closed ----
    def test_unknown_branch_code_value_raises(self):
        df = pd.DataFrame({"branch_code": ["SC", "XX"]})
        with self.assertRaises(BranchIsolationError):
            derive_branches(df)

    def test_no_branch_code_no_policy_no_raises(self):
        df = pd.DataFrame({"foo": [1, 2]})
        with self.assertRaises(BranchIsolationError):
            derive_branches(df)


class TestAssertSingleBranch(unittest.TestCase):
    def test_single_branch_passes(self):
        df = pd.DataFrame({"branch_code": ["SC", "SC"]})
        assert_single_branch(df, context="unit")  # 不抛即通过

    def test_single_branch_derived_passes(self):
        df = pd.DataFrame({"policy_no": ["6100001", "6100002"]})
        assert_single_branch(df, context="unit")

    def test_single_row_passes(self):
        df = pd.DataFrame({"policy_no": ["6100001"]})
        assert_single_branch(df, context="unit")

    def test_empty_df_passes(self):
        df = pd.DataFrame({"policy_no": pd.Series([], dtype=str)})
        assert_single_branch(df, context="unit")

    def test_mixed_with_column_raises(self):
        df = pd.DataFrame({"branch_code": ["SC", "SX"]})
        with self.assertRaises(BranchIsolationError):
            assert_single_branch(df, context="unit")

    def test_mixed_derived_from_policy_no_raises(self):
        # 直接复现已实证缺口：企微邮政表混入 SX(618) 进四川(610)
        df = pd.DataFrame({"policy_no": ["6100001", "6180001"]})
        with self.assertRaises(BranchIsolationError):
            assert_single_branch(df, context="postal sync")

    def test_allow_national_passes_mixed(self):
        # 超管全国视图显式声明 → 放行
        df = pd.DataFrame({"branch_code": ["SC", "SX"]})
        assert_single_branch(df, allow_national=True, context="national admin")

    def test_default_is_fail_closed(self):
        # 不传 allow_national → 默认单省（fail-closed）
        df = pd.DataFrame({"branch_code": ["SC", "SX"]})
        with self.assertRaises(BranchIsolationError):
            assert_single_branch(df)

    def test_context_appears_in_error_message(self):
        df = pd.DataFrame({"branch_code": ["SC", "SX"]})
        with self.assertRaises(BranchIsolationError) as cm:
            assert_single_branch(df, context="postal sync")
        self.assertIn("postal sync", str(cm.exception))


class TestIsNationalView(unittest.TestCase):
    def test_province_all_is_national(self):
        self.assertTrue(is_national_view({"PROVINCE": "ALL"}))
        self.assertTrue(is_national_view({"PROVINCE": "all"}))
        self.assertTrue(is_national_view({"PROVINCE": " All "}))

    def test_other_values_not_national(self):
        self.assertFalse(is_national_view({"PROVINCE": "SC"}))
        self.assertFalse(is_national_view({}))
        self.assertFalse(is_national_view({"PROVINCE": ""}))

    def test_assert_never_reads_env_implicitly(self):
        # fail-closed 红线：即便 env PROVINCE=ALL，assert 默认不放行混省
        # （env 解析只在调用方显式 allow_national=is_national_view() 时生效）
        df = pd.DataFrame({"branch_code": ["SC", "SX"]})
        os.environ["PROVINCE"] = "ALL"
        try:
            with self.assertRaises(BranchIsolationError):
                assert_single_branch(df, context="unit")
        finally:
            del os.environ["PROVINCE"]


if __name__ == "__main__":
    unittest.main()
