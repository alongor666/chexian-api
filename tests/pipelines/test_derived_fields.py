import unittest
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.derived_fields import apply_derived_fields

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
        with self.assertRaises(SystemExit):
            apply_derived_fields(_df(["6100001"]), [BRANCH_RULE], declared_branch="SX")

    def test_unmapped_prefix_null_fail_fast(self):
        # 未命中前缀(999) → NULL → strictNonNull fail-fast
        with self.assertRaises(SystemExit):
            apply_derived_fields(_df(["9990001"]), [BRANCH_RULE], declared_branch=None)

    def test_mixed_province_exits(self):
        # 混省（610+618）声明 SC → 派生省 {SC,SX} != {SC} → exit 1
        with self.assertRaises(SystemExit):
            apply_derived_fields(_df(["6100001", "6180002"]), [BRANCH_RULE], declared_branch="SC")

    def test_missing_source_column_guarded_exits(self):
        # 源列缺失 + 强校验 → exit 1（codex 闸-1 P1-1）
        with self.assertRaises(SystemExit):
            apply_derived_fields(pd.DataFrame({"other": [1]}), [BRANCH_RULE], declared_branch="SC")

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


if __name__ == "__main__":
    unittest.main()
