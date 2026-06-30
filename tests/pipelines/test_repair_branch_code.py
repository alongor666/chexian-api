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


def _write_source_xlsx(path: Path, n: int = 3) -> None:
    """写最小维修资源源 xlsx（仅必须列 修理厂名称 + 统计时间）。"""
    df = pd.DataFrame(
        {
            "修理厂名称": [f"测试维修厂_{i:02d}有限公司" for i in range(n)],
            "统计时间": ["2026-06-01"] * n,
        }
    )
    df.to_excel(path, index=False, engine="openpyxl")


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


if __name__ == "__main__":
    unittest.main()
