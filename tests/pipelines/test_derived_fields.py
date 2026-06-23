import argparse
import os
import unittest
from pathlib import Path
import sys
from unittest import mock

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.derived_fields import (
    apply_derived_fields,
    apply_registry_derivations,
    resolve_declared_branch,
)

# branch_code：prefix_map + 强校验（strictNonNull + assertDeclaredBranch）
BRANCH_RULE = {
    "id": "branch_code",
    "derived": True,
    "derivation": {
        "type": "prefix_map",
        "source": "policy_no",
        "prefixLength": 3,
        "mapping": {"610": "SC", "618": "SX"},
        "defaultValue": None,
        "strictNonNull": True,
        "assertDeclaredBranch": True,
    },
}
# compulsory_ncd_factor：无 guard flag 的 prefix_map，未命中应允许为 NULL（行为不变对照组）
NCD_RULE = {
    "id": "compulsory_ncd_factor",
    "derived": True,
    "derivation": {
        "type": "prefix_map",
        "source": "compulsory_ncd",
        "prefixLength": 2,
        "mapping": {"A0": 1.0, "A3": 0.7},
        "defaultValue": None,
    },
}


def _df(policy_nos):
    return pd.DataFrame({"policy_no": list(policy_nos)})


class DerivedFieldsTest(unittest.TestCase):
    def test_sc_derives_sc(self):
        df = apply_derived_fields(_df(["6100001", "6100002"]), [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(df["branch_code"].tolist(), ["SC", "SC"])

    def test_sx_derives_sx_declared_match(self):
        df = apply_derived_fields(_df(["6180001", "6180002"]), [BRANCH_RULE], declared_branch="SX")
        self.assertEqual(df["branch_code"].tolist(), ["SX", "SX"])

    def test_declared_mismatch_exits(self):
        # SC 的 policy_no 但声明 SX → 喂错省 → exit 1
        # P3-A codex 闸-1 P2 采纳：断言 exception.code == 1（区分 sys.exit(1) 与其它退出码）
        with self.assertRaises(SystemExit) as cm:
            apply_derived_fields(_df(["6100001"]), [BRANCH_RULE], declared_branch="SX")
        self.assertEqual(cm.exception.code, 1)

    def test_unmapped_prefix_null_fail_fast(self):
        # 未命中前缀(999) → NULL → strictNonNull fail-fast
        with self.assertRaises(SystemExit) as cm:
            apply_derived_fields(_df(["9990001"]), [BRANCH_RULE], declared_branch=None)
        self.assertEqual(cm.exception.code, 1)

    def test_mixed_province_exits(self):
        # 混省（610+618）声明 SC → 派生省 {SC,SX} != {SC} → exit 1
        with self.assertRaises(SystemExit) as cm:
            apply_derived_fields(_df(["6100001", "6180002"]), [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_missing_source_column_guarded_exits(self):
        # 源列缺失 + 强校验 → exit 1（codex 闸-1 P1-1）
        with self.assertRaises(SystemExit) as cm:
            apply_derived_fields(pd.DataFrame({"other": [1]}), [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_sc_default_chain_no_declared(self):
        # SC 默认链路：无声明省 → 跳过 assertDeclaredBranch；strictNonNull 仍通过
        df = apply_derived_fields(_df(["6100001"]), [BRANCH_RULE], declared_branch=None)
        self.assertEqual(df["branch_code"].tolist(), ["SC"])

    def test_unguarded_prefix_map_allows_null(self):
        # compulsory_ncd_factor 无 guard flag：未命中 → NULL，不 fail-fast（行为不变）
        out = apply_derived_fields(pd.DataFrame({"compulsory_ncd": ["A0", "Z9"]}), [NCD_RULE])
        vals = out["compulsory_ncd_factor"].tolist()
        self.assertEqual(vals[0], 1.0)
        self.assertTrue(pd.isna(vals[1]))


class ResolveDeclaredBranchTest(unittest.TestCase):
    """P3-A helper: resolve_declared_branch — CLI > env > None, 大小写归一化。

    需求来自 P3-A codex 闸-1 P2 补强：单测覆盖 env-only / CLI priority / unset 返回 None。
    """

    def _args(self, branch_code=None):
        ns = argparse.Namespace()
        ns.branch_code = branch_code
        return ns

    def test_cli_priority_over_env_and_lowercase_normalized(self):
        # CLI 'sx' + env 'SC' → 'SX'（CLI 优先 + 归一化大写）
        with mock.patch.dict(os.environ, {'BRANCH_CODE': 'SC'}, clear=False):
            self.assertEqual(resolve_declared_branch(self._args('sx')), 'SX')

    def test_env_only_when_cli_absent(self):
        # CLI 缺 + env 'sx' → 'SX'（env 兜底 + 归一化）
        with mock.patch.dict(os.environ, {'BRANCH_CODE': 'sx'}, clear=False):
            self.assertEqual(resolve_declared_branch(self._args(None)), 'SX')

    def test_unset_returns_none(self):
        # 都不设 → None（不触发 assertDeclaredBranch）
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(resolve_declared_branch(self._args(None)))

    def test_empty_string_normalized_to_none(self):
        # CLI='', env='' → 空字符串 .strip().upper() = '' → or 短路 None
        with mock.patch.dict(os.environ, {'BRANCH_CODE': ''}, clear=False):
            self.assertIsNone(resolve_declared_branch(self._args('')))

    def test_args_without_branch_code_attr(self):
        # getattr 兜底：args 无 branch_code 属性也不崩
        ns = argparse.Namespace()  # 无 branch_code
        with mock.patch.dict(os.environ, {'BRANCH_CODE': 'sc'}, clear=False):
            self.assertEqual(resolve_declared_branch(ns), 'SC')


class ApplyRegistryDerivationsTest(unittest.TestCase):
    """P3-A helper: apply_registry_derivations — 读真实 fields.json + 物化派生。

    需求来自 P3-A codex 闸-1 P2 补强：单测锁住「不会误新增 premium-only 字段」
    （compulsory_ncd_factor 在 claims schema 无 compulsory_ncd 列时跳过、不报错）。
    """

    def test_sc_full_pipeline_with_real_registry(self):
        # 真实 fields.json + SC policy_no → branch_code 全 'SC'；compulsory_ncd_factor
        # 因 df 无 compulsory_ncd 源列 + 非 guarded → 跳过不报错（不误新增列）。
        df = pd.DataFrame({"policy_no": ["6100001", "6100002", "6100003"]})
        out = apply_registry_derivations(df, declared_branch="SC")
        self.assertIn("branch_code", out.columns)
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])
        # premium-only 字段 compulsory_ncd_factor 不应误新增到 claims schema
        self.assertNotIn("compulsory_ncd_factor", out.columns)

    def test_mixed_province_declared_sc_fails(self):
        # 真实 registry + 混省 + declared SC → branch_code assertDeclaredBranch fail
        df = pd.DataFrame({"policy_no": ["6100001", "6180001"]})
        with self.assertRaises(SystemExit) as cm:
            apply_registry_derivations(df, declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_missing_policy_no_with_guarded_field_fails(self):
        # 真实 registry + df 无 policy_no 列 → branch_code guarded 源列缺失 fail-fast
        df = pd.DataFrame({"other": [1, 2]})
        with self.assertRaises(SystemExit) as cm:
            apply_registry_derivations(df, declared_branch=None)
        self.assertEqual(cm.exception.code, 1)


from pipelines.backfill_derived_fields import apply_derivation as _backfill_apply


class BackfillGuardTest(unittest.TestCase):
    """通用 backfill 一律拒绝强校验字段（branch_code），交 transform.py / Phase 4（codex 闸-2 P1）。"""

    def test_backfill_skips_guarded_field(self):
        # 强校验字段一律 skip（不处理/不写回），四象限全 skip；不杀整轮、不影响其它字段
        for df, force in [
            (_df(["6100001"]), True),
            (_df(["6100001"]), False),
            (pd.DataFrame({"policy_no": ["6100001"], "branch_code": ["SC"]}), False),
            (pd.DataFrame({"other": [1]}), True),
        ]:
            out, status = _backfill_apply(df, BRANCH_RULE, force=force)
            self.assertIn("skip", status)
        # 不存在 branch_code 列的输入不应被新增该列
        out, _ = _backfill_apply(_df(["6100001"]), BRANCH_RULE, force=True)
        self.assertNotIn("branch_code", out.columns)

    def test_backfill_unguarded_field_derives(self):
        # 非强校验字段（compulsory_ncd_factor）行为不变：派生 + 允许未命中 NULL
        out, status = _backfill_apply(pd.DataFrame({"compulsory_ncd": ["A0", "Z9"]}), NCD_RULE, force=True)
        self.assertEqual(out["compulsory_ncd_factor"].tolist()[0], 1.0)
        self.assertTrue(pd.isna(out["compulsory_ncd_factor"].tolist()[1]))

    def test_backfill_unguarded_idempotent_skip(self):
        # 非强校验字段已存在 + 无 --force → 幂等 skip（行为不变）
        df = pd.DataFrame({"compulsory_ncd": ["A0"], "compulsory_ncd_factor": [1.0]})
        out, status = _backfill_apply(df, NCD_RULE, force=False)
        self.assertIn("skip", status)


# ════════════════════════════════════════════════════════════════════════════
# P3-B cross_sell + customer_flow 派生化新增场景（base_converter 入口语义）
# ════════════════════════════════════════════════════════════════════════════


class BaseConverterEntryGuardTest(unittest.TestCase):
    """模拟 base_converter.py:177 6c 段的派生入口逻辑：
    · 'policy_no' in df.columns（cross_sell/customer_flow）→ 派生 + 守卫
    · 'policy_no' not in df.columns（repair/brand）→ 安静跳过
    """

    def test_cross_sell_full_sc_passes(self):
        """cross_sell 全 SC 派生：declared_branch='SC' + 610... 前缀 → 通过且全 SC"""
        df = _df(["6101001", "6102002", "6103003"])
        out = apply_derived_fields(df, [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])
        self.assertEqual(int(out["branch_code"].notna().sum()), 3)

    def test_customer_flow_full_sc_passes(self):
        """customer_flow 全 SC 派生：与 cross_sell 同语义（共享 helper）"""
        df = _df(["61020260100000001", "61020250100000002", "61020260100000003"])
        out = apply_derived_fields(df, [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])

    def test_dim_table_without_policy_no_skipped_at_entry(self):
        """dim 表（repair/brand）无 policy_no 列 → base_converter 入口必须跳过派生入口；
        若误调 apply_registry_derivations 直接传 dim df，derived_fields.py:60-66 会因
        guarded(branch_code) 源列缺失 fail-fast。该测试断言：base_converter 必须在 entry 守卫
        （'policy_no' in df.columns），不能让 dim 表 df 进派生。
        """
        dim_df = pd.DataFrame({
            "repair_shop_name": ["A 厂", "B 厂"],
            "report_date": ["2026-01-01", "2026-01-02"],
        })
        # 模拟 base_converter 入口判断
        if 'policy_no' in dim_df.columns:
            self.fail("dim_df 不应有 policy_no 列")
        # 直接验证：若强行进派生，会 fail-fast（这是 base_converter 必须守卫的根因）
        with self.assertRaises(SystemExit) as cm:
            apply_derived_fields(dim_df, [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_sc_default_link_blocks_mixed_provinces(self):
        """SC 默认链路（declared_branch='SC'，base_converter 入口 `or 'SC'` 兜底）必须
        fail-fast 拦截混省（混 610 + 618 行）—— codex 闸-1 P1-1 关键防线。
        """
        mixed_df = _df(["6100001", "6180002", "6100003"])
        with self.assertRaises(SystemExit) as cm:
            apply_derived_fields(mixed_df, [BRANCH_RULE], declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)


class TransformPyRetrofitTest(unittest.TestCase):
    """transform.py:1094-1108 retrofit 后的行为契约：
    · SystemExit（fail-fast）必须冒泡，不被异常边界吞
    · 仅 FileNotFoundError / JSONDecodeError 触发 skip 派生
    （codex 闸-1 P2-1：transform.py 异常边界保持原语义）
    """

    def test_helper_propagates_systemexit_on_mixed(self):
        """混省 → apply_registry_derivations 内部 sys.exit(1) 必须冒泡；
        transform.py 的 try/except 不应吞 SystemExit。
        """
        mixed_df = _df(["6100001", "6180002"])
        with self.assertRaises(SystemExit):
            apply_registry_derivations(mixed_df, "SC")

    def test_resolve_declared_branch_sc_fallback(self):
        """SC 默认链路：CLI/env 全空时 resolve_declared_branch 返回 None，
        transform.py 用 `or 'SC'` 兜底（与 base_converter:188 同语义）。
        """
        ns = argparse.Namespace(branch_code=None)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('BRANCH_CODE', None)
            self.assertIsNone(resolve_declared_branch(ns))
        # 调用方期望 `or 'SC'` 转换 → 派生
        df = apply_derived_fields(_df(["6100001"]), [BRANCH_RULE], declared_branch=resolve_declared_branch(ns) or 'SC')
        self.assertEqual(df["branch_code"].tolist(), ["SC"])


class MergeParquetReapplyTest(unittest.TestCase):
    """merge_parquet.reapply_registry_derivations 行为契约（codex 闸-2 P1）：
    模拟 cross_sell merge_with_history 场景——旧 latest（无 branch_code 列）+ 新 tmp（已
    派生 branch_code）合并后 union_by_name 给旧行补 NULL，必须 re-derive 覆盖恢复全列非空。
    """

    def test_reapply_covers_null_from_history_merge(self):
        import tempfile

        from pipelines.merge_parquet import reapply_registry_derivations

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "cross_sell_merged.parquet"
            # 模拟 union_by_name 产物：旧行 branch_code=NULL，新行=SC（policy_no 全 610 前缀）
            df = pd.DataFrame({
                "policy_no": ["6100001", "6100002", "6100003", "6100004"],
                "branch_code": [None, None, "SC", "SC"],
            })
            df.to_parquet(out, index=False)
            reapply_registry_derivations(out, "SC")
            df2 = pd.read_parquet(out)
            self.assertEqual(int(df2["branch_code"].isna().sum()), 0)
            self.assertTrue((df2["branch_code"] == "SC").all())

    def test_reapply_fails_on_unknown_prefix(self):
        """re-derive 后若 policy_no 含未知前缀 → strict_non_null fail-fast（与 ETL 同语义）"""
        import tempfile

        from pipelines.merge_parquet import reapply_registry_derivations

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "bad_prefix.parquet"
            pd.DataFrame({"policy_no": ["6100001", "999XXX"]}).to_parquet(out, index=False)
            with self.assertRaises(SystemExit):
                reapply_registry_derivations(out, "SC")


if __name__ == "__main__":
    unittest.main()
