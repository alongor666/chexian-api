"""P3-D quote_etl.derive_branch_code 边界单测

quotes 报价表 policy_no NULL 占比 92.5%（B255 数据质量问题），因此 branch_code
派生不能复用 derived_fields.py 的 strictNonNull/assertDeclaredBranch guarded helper
（会因 NULL 比例触发 fail-fast）。quote_etl 走「内联 + warn 模式」自管校验：

- 非缺失行：policy_no[:3] 必须 ∈ mapping.keys()（610/618），未命中前缀 fail-fast
- 非缺失派生值：必须 ⊆ {declared_branch}（防喂错省 / 混省），不符 fail-fast
- 缺失行：fillna(declared_branch)（≡ loader selectUnionWithBranchCode 旧"列缺失
  注入部署省常量"兜底；防 RLS 漏行）
- declared_branch：必须 ∈ mapping.values()（白名单），非法 fail-fast
- df 必须含 'policy_no' 列：schema 退化防线，缺列 fail-fast

codex 闸-1（P0/P1）修订后落地的契约。
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.quote_etl import derive_branch_code  # noqa: E402


class DeriveBranchCodeTest(unittest.TestCase):
    """10 个边界用例覆盖 P0/P1 全部约束。"""

    def test_sc_full_notnull_passes(self):
        df = pd.DataFrame({"policy_no": ["6100001", "6100002", "6100003"]})
        out = derive_branch_code(df, declared_branch="SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])
        self.assertEqual(out["branch_code"].isna().sum(), 0)

    def test_sc_with_null_policy_no_fillna_declared(self):
        # 5 SC 派生 + 5 NULL 兜底 → branch_code 全 SC
        df = pd.DataFrame({"policy_no": ["6100001"] * 5 + [None] * 5})
        out = derive_branch_code(df, declared_branch="SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC"] * 10)

    def test_sx_gated_full_notnull_passes(self):
        df = pd.DataFrame({"policy_no": ["6180001", "6180002"]})
        out = derive_branch_code(df, declared_branch="SX")
        self.assertEqual(out["branch_code"].tolist(), ["SX", "SX"])

    def test_mixed_province_fail_fast(self):
        # 混省（610+618）声明 SC → 派生省 {SC,SX} != {SC} → exit 1
        df = pd.DataFrame({"policy_no": ["6100001", "6180001", "6100002"]})
        with self.assertRaises(SystemExit) as cm:
            derive_branch_code(df, declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_unknown_prefix_fail_fast(self):
        # P0 核心修复：未知 prefix (999) → 不是 NULL 兜底，必须 fail-fast
        # 修复前 .map(mapping) → NaN → dropna 后空集 → 误以为"全合规"被静默兜底为 declared
        df = pd.DataFrame({"policy_no": ["9990001", "9990002"]})
        with self.assertRaises(SystemExit) as cm:
            derive_branch_code(df, declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_unknown_prefix_mixed_with_null_fail_fast(self):
        # P0 边界：未知 prefix 与 NULL 混合，未知行必须仍触发 fail-fast
        # 不能因 NULL 行存在而宽松通过
        df = pd.DataFrame({"policy_no": ["9990001", None, None, "9990002"]})
        with self.assertRaises(SystemExit) as cm:
            derive_branch_code(df, declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_all_null_policy_no_fillna_declared(self):
        # 全 NULL 边界：无任何派生证据，纯兜底 declared_branch
        df = pd.DataFrame({"policy_no": [None, None, None]})
        out = derive_branch_code(df, declared_branch="SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC"])

    def test_declared_branch_whitelist_fail_fast(self):
        # P1.2：declared_branch 必须 ∈ fields.json mapping.values()（白名单）
        # 防止 BRANCH_CODE=GD 全 NULL 时兜底全部为 GD（绕过派生省不符校验）
        df = pd.DataFrame({"policy_no": [None, None]})
        with self.assertRaises(SystemExit) as cm:
            derive_branch_code(df, declared_branch="GD")
        self.assertEqual(cm.exception.code, 1)

    def test_missing_policy_no_column_fail_fast(self):
        # P1.4：df 缺 policy_no 列（schema 退化）→ 不允许 KeyError 隐式失败，显式 exit 1
        df = pd.DataFrame({"vehicle_frame_no": ["VIN001"]})
        with self.assertRaises(SystemExit) as cm:
            derive_branch_code(df, declared_branch="SC")
        self.assertEqual(cm.exception.code, 1)

    def test_etl_astype_str_nan_treated_as_null(self):
        # quotes ETL 链路用 astype(str) 转换 → NaN 变 'nan' 字符串。
        # derive_branch_code 必须把 'nan'/'None'/'' 视作"缺失"走兜底，不能当作未知前缀触发 fail-fast。
        df = pd.DataFrame({"policy_no": ["6100001", "nan", "None", ""]})
        out = derive_branch_code(df, declared_branch="SC")
        self.assertEqual(out["branch_code"].tolist(), ["SC", "SC", "SC", "SC"])


if __name__ == "__main__":
    unittest.main()
