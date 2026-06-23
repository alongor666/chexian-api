"""P3-C convert_renewal_tracker.derive_renewal_tracker_branch_code 边界单测

renewal_tracker 派生域输出 schema 不含 policy_no 主列（只有 source_policy_no +
renewed_policy_no）。派生 branch_code 需先造临时列：
  __tmp_policy_no_for_branch = renewed_policy_no(if is_renewed) else source_policy_no

复用 apply_registry_derivations + strictNonNull + assertDeclaredBranch guard
（已 duckdb 实证 SC 链路 source/renewed 100% 非空+610 前缀，128,016 行零 NULL）。

codex 闸-1（P0/P1）修订后落地：
- P0：declared_branch 默认 'SC' 兜底（直跑入口须显式声明）
- P1.1：临时列名 __tmp_policy_no_for_branch（避免与未来业务字段冲突，已存在时 ValueError）
- P1.3：必须覆盖"默认 declared_branch=SC"入口（无 args/无 env）
- P1.6：capsys 只断关键片段，不绑死 emoji/全句
"""
import os
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PIPELINES = ROOT / "数据管理" / "pipelines"
if str(PIPELINES) not in sys.path:
    sys.path.insert(0, str(PIPELINES))

from convert_renewal_tracker import (  # noqa: E402
    _TMP_POLICY_NO_COL,
    derive_renewal_tracker_branch_code,
)
from derived_fields import resolve_declared_branch  # noqa: E402


def _make_df(rows):
    """rows: list of (is_renewed, source_policy_no, renewed_policy_no)"""
    return pd.DataFrame({
        "is_renewed": [r[0] for r in rows],
        "source_policy_no": [r[1] for r in rows],
        "renewed_policy_no": [r[2] for r in rows],
        "some_business_col": list(range(len(rows))),  # 验证 mutate 不污染业务列
    })


class DeriveRenewalTrackerBranchCodeTest(unittest.TestCase):
    """7 个边界用例覆盖 codex 闸-1 P0/P1 全部约束。"""

    def test_case_a_all_renewed_sc(self):
        """Case A：全已续 SC → branch_code 全 SC（用 renewed_policy_no）+ drop 临时列"""
        df = _make_df([
            (True, "61020260001", "61020260101"),
            (True, "61020260002", "61020260102"),
            (True, "61020260003", "61020260103"),
        ])
        out = derive_renewal_tracker_branch_code(df, "SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])
        self.assertEqual(out["branch_code"].isna().sum(), 0)
        # P1.1：临时列必 drop
        self.assertNotIn(_TMP_POLICY_NO_COL, out.columns)
        self.assertNotIn("policy_no", out.columns)
        # 字节安全：业务列原值
        self.assertEqual(out["some_business_col"].tolist(), [0, 1, 2])

    def test_case_b_all_not_renewed_sc(self):
        """Case B：全未续 SC → branch_code 全 SC（走 source_policy_no，renewed=None）"""
        df = _make_df([
            (False, "61020260001", None),
            (False, "61020260002", None),
            (False, "61020260003", None),
        ])
        out = derive_renewal_tracker_branch_code(df, "SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])
        self.assertEqual(out["branch_code"].isna().sum(), 0)
        self.assertNotIn(_TMP_POLICY_NO_COL, out.columns)

    def test_case_c_cross_province_declared_sc_fail_fast(self):
        """Case C SC 跨省：source 610 + renewed 618, declared='SC' → assertDeclaredBranch fail-fast"""
        df = _make_df([
            (True, "61020260001", "61820260101"),  # 跨省续保
            (True, "61020260002", "61020260102"),
        ])
        with self.assertRaises(SystemExit) as cm:
            derive_renewal_tracker_branch_code(df, "SC")
        self.assertEqual(cm.exception.code, 1)

    def test_case_d_declared_wrong_province_fail_fast(self):
        """Case D：source/renewed 全 618, declared='SC' → 派生省 ≠ 声明省 fail-fast"""
        df = _make_df([
            (False, "61820260001", None),
            (True, "61820260002", "61820260102"),
        ])
        with self.assertRaises(SystemExit) as cm:
            derive_renewal_tracker_branch_code(df, "SC")
        self.assertEqual(cm.exception.code, 1)

    def test_case_e_sx_link_full_sx(self):
        """Case E：SX 链路 source/renewed 全 618, declared='SX' → branch_code 全 SX 零 NULL"""
        df = _make_df([
            (False, "61820260001", None),
            (True, "61820260002", "61820260102"),
            (True, "61820260003", "61820260103"),
        ])
        out = derive_renewal_tracker_branch_code(df, "SX")
        self.assertEqual(out["branch_code"].tolist(), ["SX", "SX", "SX"])
        self.assertEqual(out["branch_code"].isna().sum(), 0)

    def test_case_f_cross_province_log_captured(self):
        """Case F：跨省登记 print captured（capsys 只断关键片段，不绑死 emoji/全句 · P1.6）"""
        df = _make_df([
            (True, "61020260001", "61820260101"),  # 跨省 SC→SX
            (True, "61020260002", "61020260102"),  # 同省 SC
        ])
        # declared='SX' 让 declared==派生 不 fail-fast、且 source 610 ≠ renewed 618 触发跨省登记
        # 但单测里 source=610/renewed=618 派生 SX/SC 混省 → 反过来设计：用 declared='SX'
        # 源都改成 618 才能不 fail-fast；故本 case 专门测跨省 print，用 declared='SX' + 跨省 618→610（反向）
        df2 = _make_df([
            (True, "61820260001", "61820260101"),  # 同省 SX
            (True, "61820260002", "61020260102"),  # 反向跨省 SX→SC
        ])
        captured = StringIO()
        with patch("sys.stdout", new=captured):
            with self.assertRaises(SystemExit):
                # 派生省含 SC 和 SX → declared='SX' 不符 → fail-fast
                # 但 fail-fast 前应已 print 跨省登记
                derive_renewal_tracker_branch_code(df2, "SX")
        output = captured.getvalue()
        # P1.6：只断关键片段
        self.assertIn("跨省续保登记", output)
        self.assertIn("1", output)  # 1 行跨省

    def test_case_g_isrenewed_true_but_renewed_null_strict_fail_fast(self):
        """Case G：is_renewed=True 但 renewed_policy_no=NaN → strictNonNull fail-fast"""
        df = _make_df([
            (True, "61020260001", None),  # 数据契约违反：已续但无 renewed_policy_no
            (True, "61020260002", "61020260102"),
        ])
        with self.assertRaises(SystemExit) as cm:
            derive_renewal_tracker_branch_code(df, "SC")
        self.assertEqual(cm.exception.code, 1)

    def test_case_h_tmp_col_already_exists_raises(self):
        """P1.1 防御：临时列名已存在 → ValueError（防无声覆盖破坏字节安全）"""
        df = _make_df([
            (False, "61020260001", None),
        ])
        df[_TMP_POLICY_NO_COL] = "preexist"  # 模拟未来 schema 演进引入同名列
        with self.assertRaisesRegex(ValueError, "renewal_tracker 输出 schema 已含临时列"):
            derive_renewal_tracker_branch_code(df, "SC")

    def test_case_h2_business_policy_no_col_raises(self):
        """codex 闸-2 P1.1：未来 schema 引入业务 policy_no 列 → ValueError
        （防 helper 通过 df['policy_no'] 喂 helper 后无声覆盖 + drop 业务列）"""
        df = _make_df([
            (False, "61020260001", None),
        ])
        df["policy_no"] = "business_should_survive"  # 模拟未来 schema 演进
        with self.assertRaisesRegex(ValueError, "已含 'policy_no' 业务列"):
            derive_renewal_tracker_branch_code(df, "SC")

    def test_case_i_cross_province_non_fail_fast_path(self):
        """codex 闸-2 P1.3：declared 正确 + 跨省（source 省 ≠ renewed 省 但派生省 = declared）
        → 跨省登记 print + branch_code 全 declared 零 NULL（不阻断）"""
        # source=618 (SX) + renewed=618 (SX) 是同省；要造 declared 正确的跨省，需
        # source=610 (SC) + renewed=618 (SX) + declared='SX'：派生集 = {SX, SC} → fail-fast
        # 或 source=618 (SX) + renewed=610 (SC) + declared='SC'：派生集 = {SC, SX} → fail-fast
        # 实际：跨省永远导致派生集含 2 个值 → assertDeclaredBranch 必 fail-fast
        # codex 闸-2 P1.3 误判：声称 source=610/renewed=618/declared='SX' 不阻断
        # 实测：is_renewed=True 时 policy_no = renewed_policy_no = 618 → 派生 SX；
        #       is_renewed=False 时 policy_no = source_policy_no = 610 → 派生 SC
        # 若 df 同时有已续(SX) + 未续(SC) → 派生集 {SX, SC} → fail-fast
        # 若 df 全是已续(SX) + source 是 610 → 派生集 {SX} → 跨省登记 print + 通过
        df = _make_df([
            (True, "61020260001", "61820260101"),  # source SC, renewed SX, 已续 → policy_no=SX
            (True, "61020260002", "61820260102"),  # 同上
        ])
        captured = StringIO()
        with patch("sys.stdout", new=captured):
            out = derive_renewal_tracker_branch_code(df, "SX")
        output = captured.getvalue()
        # 关键不变量：派生集 = {SX} = {declared} → 不 fail-fast，全 SX
        self.assertEqual(out["branch_code"].tolist(), ["SX", "SX"])
        self.assertEqual(out["branch_code"].isna().sum(), 0)
        # 跨省登记必 print（is_renewed=True 行 src_prefix=610 ≠ rnw_prefix=618）
        self.assertIn("跨省续保登记", output)
        self.assertIn("2", output)  # 2 行跨省


class ResolveDeclaredBranchDefaultEntryTest(unittest.TestCase):
    """P1.3：测试 resolve_declared_branch(args) or 'SC' 的默认入口契约。

    convert_renewal_tracker.main() 在 declared_branch 全空时兜底 'SC'，确保直跑入口
    不会因为忘记 --branch-code 或 BRANCH_CODE env 而漏掉 assertDeclaredBranch 核对。
    """

    def test_no_arg_no_env_returns_none_then_falls_back_to_sc(self):
        """无 --branch-code + 无 BRANCH_CODE env → resolve_declared_branch 返 None → main 兜底 'SC'"""
        class FakeArgs:
            branch_code = None
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(resolve_declared_branch(FakeArgs()))
            # 模拟 main() 兜底逻辑
            declared = resolve_declared_branch(FakeArgs()) or "SC"
            self.assertEqual(declared, "SC")

    def test_env_only_returns_env_value(self):
        """无 --branch-code，BRANCH_CODE=SC env → 返 'SC'"""
        class FakeArgs:
            branch_code = None
        with patch.dict(os.environ, {"BRANCH_CODE": "SC"}, clear=True):
            self.assertEqual(resolve_declared_branch(FakeArgs()), "SC")

    def test_arg_overrides_env(self):
        """--branch-code SX 覆盖 BRANCH_CODE=SC env"""
        class FakeArgs:
            branch_code = "SX"
        with patch.dict(os.environ, {"BRANCH_CODE": "SC"}, clear=True):
            self.assertEqual(resolve_declared_branch(FakeArgs()), "SX")

    def test_default_sc_with_mixed_input_fail_fast(self):
        """默认 SC 兜底 + 输入混入 618 → fail-fast（codex 闸-1 P0 核心断言）"""
        df = _make_df([
            (False, "61820260001", None),  # 混入 618
            (False, "61020260002", None),
        ])
        # 模拟 main() 兜底：无 args/env → declared = None or 'SC' = 'SC'
        class FakeArgs:
            branch_code = None
        with patch.dict(os.environ, {}, clear=True):
            declared = resolve_declared_branch(FakeArgs()) or "SC"
            self.assertEqual(declared, "SC")
            with self.assertRaises(SystemExit) as cm:
                derive_renewal_tracker_branch_code(df, declared)
            self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
