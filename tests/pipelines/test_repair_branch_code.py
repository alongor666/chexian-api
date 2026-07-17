"""维修资源域（repair）省份隔离单测 — branch_code 取自声明省，不再硬编码 'SC'。

被测：数据管理/pipelines/convert_repair.py（RepairConverter.transform_rows）
     + 数据管理/pipelines/base_converter.py（run() 解析 self._declared_branch）

修复的隔离漏洞：repair 域无 policy_no 列，不走 base_converter 6c registry 派生入口；
原先 transform_rows 硬编码 branch_code='SC'。山西维修源经 daily.mjs multi_file_merge 的
「单文件 + 无历史」短路路径（tmpFiles==1 && !hasHistory）直接落盘——该路径不经
merge_parquet.reapply_registry_derivations 纠正，导致 SX 隔离产物 branch_code 错标 'SC'。

本测试端到端跑 RepairConverter.run()（真实 xlsx → parquet），断言：
- `--branch-code SX`        → 产物 branch_code 全 'SX'
- `BRANCH_CODE=SX` env      → 产物 branch_code 全 'SX'（CLI 缺省时 env 兜底）
- 默认链路（无声明）        → 产物 branch_code 全 'SC'（四川逐字节等价）
- transform_rows 直接调用    → 默认 'SC'（无 run() 时类级默认 None 回退）
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.convert_repair import RepairConverter  # noqa: E402
from pipelines.derived_fields import assert_org_majority_branch  # noqa: E402


def _write_source_xlsx(path: Path, n: int = 3, orgs=None, with_org_col: bool = True) -> None:
    """写最小维修资源源 xlsx。

    orgs=None 且 with_org_col 时，归属中支默认填四川本部（满足必需列；样本量小于断言
    下限时断言本就跳过，不影响 branch_code 用例）。with_org_col=False 用于「上游改列名
    致必需列缺失」的负向用例。
    """
    cols = {
        "修理厂名称": [f"测试维修厂_{i:02d}有限公司" for i in range(n)],
        "统计时间": ["2026-06-01"] * n,
    }
    if with_org_col:
        cols["修理厂归属中支"] = orgs if orgs is not None else ["011001四川分公司（本部）"] * n
    pd.DataFrame(cols).to_excel(path, index=False, engine="openpyxl")


def _run_converter(xlsx: Path, out: Path, extra_argv=None) -> pd.DataFrame:
    """以 mock sys.argv 端到端跑 RepairConverter.run()，返回产物 DataFrame。

    一律传 --no-metadata 保持测试 hermetic（不写 data-sources.json）；与 branch_code
    逻辑正交，不影响断言。
    """
    argv = ["convert_repair.py", "-i", str(xlsx), "-o", str(out), "--no-metadata"]
    if extra_argv:
        argv.extend(extra_argv)
    with mock.patch.object(sys, "argv", argv):
        RepairConverter().run()
    return pd.read_parquet(out)


class RepairBranchCodeTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.xlsx = self.tmp / "20250601-20260628_03_维修资源.xlsx"
        self.out = self.tmp / "latest.parquet"
        _write_source_xlsx(self.xlsx, n=3)
        # 隔离 env：每个用例自管 BRANCH_CODE，避免外部环境串味
        self._saved_branch = os.environ.pop("BRANCH_CODE", None)

    def tearDown(self):
        if self._saved_branch is not None:
            os.environ["BRANCH_CODE"] = self._saved_branch
        else:
            os.environ.pop("BRANCH_CODE", None)
        self._tmp.cleanup()

    def test_branch_code_arg_sx_yields_sx(self):
        """--branch-code SX（短路路径会直接落此产物）→ branch_code 全 'SX'。"""
        df = _run_converter(self.xlsx, self.out, ["--branch-code", "SX"])
        self.assertEqual(set(df["branch_code"].unique()), {"SX"})
        self.assertEqual(len(df), 3)

    def test_branch_code_env_sx_yields_sx(self):
        """CLI 未给 --branch-code 但 BRANCH_CODE=SX env → branch_code 全 'SX'。"""
        os.environ["BRANCH_CODE"] = "SX"
        df = _run_converter(self.xlsx, self.out)
        self.assertEqual(set(df["branch_code"].unique()), {"SX"})

    def test_branch_code_arg_lowercase_normalized(self):
        """--branch-code sx 归一化为大写 'SX'（resolve_declared_branch upper）。"""
        df = _run_converter(self.xlsx, self.out, ["--branch-code", "sx"])
        self.assertEqual(set(df["branch_code"].unique()), {"SX"})

    def test_default_chain_yields_sc(self):
        """默认链路（无 --branch-code、无 BRANCH_CODE env）→ branch_code 全 'SC'（四川等价）。"""
        df = _run_converter(self.xlsx, self.out)
        self.assertEqual(set(df["branch_code"].unique()), {"SC"})

    def test_transform_rows_direct_default_sc(self):
        """直接调 transform_rows（无 run()）→ 类级默认 _declared_branch=None → 回退 'SC'。"""
        conv = RepairConverter()
        out = conv.transform_rows(pd.DataFrame({"repair_shop_name": ["甲修理厂", "乙修理厂"]}))
        self.assertEqual(set(out["branch_code"].unique()), {"SC"})


def _org_df(prefixes):
    """按前缀清单造带归属中支列的 df（prefixes 支持 None 表示空归属）。"""
    return pd.DataFrame({
        "org_level_3": [
            None if p is None else f"{p}01某某分公司" for p in prefixes
        ]
    })


class OrgMajorityBranchAssertTest(unittest.TestCase):
    """省份归属主体前缀断言 — 2026-07-16 跨省误收事故（山西账号导出按四川命名落盘）。

    判据 = 非空「修理厂归属中支」的主体前缀（四川 0110 / 山西 0118）。刻意不用
    「见异省编码即失败」（四川源合法含 0100 总公司 / 0108 无锡），也不用
    「修理厂所在省」（四川分公司在山西开的网点归属仍是 0110）。
    """

    def test_flipped_province_fails_fast(self):
        """声明 SC 但归属全是山西 0118 → fail-fast（本次事故的真实形态）。"""
        with self.assertRaises(SystemExit) as cm:
            assert_org_majority_branch(_org_df(["0118"] * 200), "org_level_3", "SC", "测试")
        self.assertEqual(cm.exception.code, 1)

    def test_flipped_province_reverse_direction_fails_fast(self):
        """反向：声明 SX 但归属全是四川 0110 → 同样 fail-fast。"""
        with self.assertRaises(SystemExit) as cm:
            assert_org_majority_branch(_org_df(["0110"] * 200), "org_level_3", "SX", "测试")
        self.assertEqual(cm.exception.code, 1)

    def test_matching_province_passes(self):
        """声明省与主体前缀一致 → 放行。"""
        assert_org_majority_branch(_org_df(["0110"] * 200), "org_level_3", "SC", "测试")
        assert_org_majority_branch(_org_df(["0118"] * 200), "org_level_3", "SX", "测试")

    def test_minority_foreign_codes_not_killed(self):
        """四川源合法含少量 0100 总公司 / 0108 无锡 → 主体仍是 0110，不得误杀。"""
        assert_org_majority_branch(
            _org_df(["0110"] * 198 + ["0100", "0108"]), "org_level_3", "SC", "测试"
        )

    def test_null_orgs_ignored_in_denominator(self):
        """空归属行（真实源约 9%）不参与判据，非空主体正确即放行。"""
        assert_org_majority_branch(
            _org_df(["0110"] * 150 + [None] * 100), "org_level_3", "SC", "测试"
        )

    def test_small_file_below_min_sample_skips(self):
        """整个文件都小（总行数 < 下限）→ 无从判定，告警跳过而非误判。"""
        assert_org_majority_branch(_org_df(["0118"] * 5), "org_level_3", "SC", "测试")

    def test_large_file_with_hollow_orgs_fails(self):
        """总行数够大却几乎全空归属 → 判据被掏空，fail-fast。

        codex 对抗审查 P1-3：否则「99 行非空 0118 + 10 万行空」能声明 SC 通过。
        """
        with self.assertRaises(SystemExit) as cm:
            assert_org_majority_branch(
                _org_df(["0118"] * 99 + [None] * 100_000), "org_level_3", "SC", "测试"
            )
        self.assertEqual(cm.exception.code, 1)

    def test_missing_column_skips(self):
        """无归属列 → 跳过（repair 域已把该列列为必需，缺列在 step 2 更早 abort；
        此路径供 brand 等无该列的 dim 表复用同一断言）。"""
        assert_org_majority_branch(pd.DataFrame({"repair_shop_name": ["甲"]}),
                                   "org_level_3", "SC", "测试")

    def test_mixed_province_below_floor_fails(self):
        """主体前缀正确但占比低于下限 → 半量混省，fail-fast。

        codex 对抗审查 P1-2：floor 若只告警，接近一半错省的数据仍会发布。
        实测四川主体占比 99.98%、山西 100%，离 80% 下限极远，硬闸不误杀。
        """
        with self.assertRaises(SystemExit) as cm:
            assert_org_majority_branch(
                _org_df(["0110"] * 120 + ["0118"] * 80), "org_level_3", "SC", "测试"
            )
        self.assertEqual(cm.exception.code, 1)

    def test_unregistered_province_fails_closed(self):
        """省配置缺 org_code_prefix → fail-closed，禁止静默放行未知省。"""
        with self.assertRaises(SystemExit) as cm:
            assert_org_majority_branch(_org_df(["0110"] * 200), "org_level_3", "ZZ", "测试")
        self.assertEqual(cm.exception.code, 1)


class RepairConverterOrgAssertE2ETest(unittest.TestCase):
    """端到端：坏源经 RepairConverter.run() 必须在写盘前中止，不留产物。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.xlsx = self.tmp / "20250601-20260716_03_维修资源.xlsx"
        self.out = self.tmp / "latest.parquet"
        self._saved_branch = os.environ.pop("BRANCH_CODE", None)

    def tearDown(self):
        if self._saved_branch is not None:
            os.environ["BRANCH_CODE"] = self._saved_branch
        else:
            os.environ.pop("BRANCH_CODE", None)
        self._tmp.cleanup()

    def test_shanxi_source_declared_sichuan_aborts_before_write(self):
        """山西数据按四川声明跑 → SystemExit(1) 且不产出 parquet。"""
        _write_source_xlsx(self.xlsx, n=200, orgs=["011801山西分公司（本部）"] * 200)
        with self.assertRaises(SystemExit) as cm:
            _run_converter(self.xlsx, self.out)
        self.assertEqual(cm.exception.code, 1)
        self.assertFalse(self.out.exists(), "坏源不得留下 parquet 产物")

    def test_sichuan_source_declared_sichuan_writes(self):
        """四川数据按四川声明跑 → 正常产出，branch_code 全 'SC'。"""
        _write_source_xlsx(self.xlsx, n=200, orgs=["011001四川分公司（本部）"] * 200)
        df = _run_converter(self.xlsx, self.out)
        self.assertEqual(set(df["branch_code"].unique()), {"SC"})
        self.assertEqual(len(df), 200)

    def test_missing_org_column_aborts_even_with_force(self):
        """上游改列名致归属列缺失 → 即便 --force 也 abort（不得静默跳过省份判据）。"""
        _write_source_xlsx(self.xlsx, n=200, with_org_col=False)
        with self.assertRaises(SystemExit) as cm:
            _run_converter(self.xlsx, self.out, ["--force"])
        self.assertEqual(cm.exception.code, 1)
        self.assertFalse(self.out.exists())


class MergedDimOrgAssertTest(unittest.TestCase):
    """合并产物复验 — codex 对抗审查 P1-1。

    分片各自通过断言 ≠ 合并去重后仍通过：重复的本省网点被 dedup 压掉、各分片唯一的
    外省网点全数保留时，主体前缀可能在合并后才翻转。断言须在 dim 表重赋常量处再跑一次。
    """

    def test_dedup_flipped_majority_fails_at_merge(self):
        """合并去重后主体翻转为外省 → _reassert_dim_branch_constant 阶段 fail-fast。"""
        from pipelines.merge_parquet import _reassert_dim_branch_constant
        flipped = _org_df(["0110"] * 100 + ["0118"] * 120)
        with self.assertRaises(SystemExit) as cm:
            _reassert_dim_branch_constant(flipped, "latest.parquet", "SC")
        self.assertEqual(cm.exception.code, 1)

    def test_clean_merge_still_passes(self):
        """合并产物主体前缀正确 → 照常赋常量，行为不变。"""
        from pipelines.merge_parquet import _reassert_dim_branch_constant
        out = _reassert_dim_branch_constant(_org_df(["0110"] * 200), "latest.parquet", "SC")
        self.assertEqual(set(out["branch_code"].unique()), {"SC"})

    def test_dim_without_org_column_unaffected(self):
        """无 org_level_3 列的 dim 表（brand 等）→ 断言跳过，既有行为零变化。"""
        from pipelines.merge_parquet import _reassert_dim_branch_constant
        out = _reassert_dim_branch_constant(
            pd.DataFrame({"brand_name": ["甲", "乙"]}), "brand.parquet", "SX")
        self.assertEqual(set(out["branch_code"].unique()), {"SX"})


if __name__ == "__main__":
    unittest.main()
