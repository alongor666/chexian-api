"""Schema 契约 fail-fast 单测（backlog FIND-004 · 卡 2026-07-12-claude-0e75be）。

背景：此前只有 premium 域（transform.py finalize_schema）在源出现未声明字段时 sys.exit(1)；
brand / repair / cross_sell / customer_flow 等标准域对未映射列只 print 告警后**静默丢弃**，
上游悄改字段会被吞掉、口径悄悄失真无人察觉。本次把拦截下沉到共享核
`enforce_schema_contract` + base_converter step 3 + customer_flow 自有路径。

被测：
- pipelines.etl_validation.enforce_schema_contract（premium 与标准域共用的单一拦截核）
- pipelines.base_converter.BaseConverter.run() step 3（brand/repair/cross_sell 走此路径）
- pipelines.convert_customer_flow.build_customer_flow_dataframe（override run() 的自有路径）

锁定两条路径 + 逃生阀：
- 注入未声明源列 → sys.exit(1)（非零退出，列出该字段）
- 正常源数据（列全在映射/忽略清单内）→ ETL 通过、产出 parquet
- --force / force=True → 未声明列仅告警、不退出
- get_explicitly_ignored_columns 声明的列 → 放行且不落盘

全部合成数据（tmp xlsx / 内存 DataFrame），不依赖 warehouse parquet。
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

from pipelines.etl_validation import enforce_schema_contract  # noqa: E402
from pipelines.convert_repair import RepairConverter  # noqa: E402
from pipelines.convert_customer_flow import (  # noqa: E402
    build_customer_flow_dataframe,
)


# ── 1. 共享拦截核（premium + 标准域单一实现） ──


class EnforceSchemaContractTest(unittest.TestCase):
    def _df(self):
        return pd.DataFrame({"a": [1, None], "b": [2, 2], "c": [3, 3]})

    def test_clean_passes(self):
        """所有列都已知 → 返回空、不退出。"""
        self.assertEqual(enforce_schema_contract(self._df(), {"a", "b", "c"}), [])

    def test_unknown_column_exits_nonzero(self):
        """出现未知列（c）→ sys.exit(1)。"""
        with self.assertRaises(SystemExit) as cm:
            enforce_schema_contract(self._df(), {"a", "b"})
        self.assertEqual(cm.exception.code, 1)

    def test_ignored_column_passes(self):
        """未知列在 ignored 清单内 → 放行。"""
        self.assertEqual(enforce_schema_contract(self._df(), {"a", "b"}, {"c"}), [])

    def test_force_reports_but_no_exit(self):
        """force=True → 仅返回未知列、不退出（调试逃生阀）。"""
        self.assertEqual(
            enforce_schema_contract(self._df(), {"a", "b"}, force=True), ["c"]
        )


# ── 2. base_converter step 3（brand/repair/cross_sell 走此路径，以 repair 端到端） ──


def _write_repair_xlsx(path: Path, extra_col: bool = False, n: int = 3) -> None:
    """写最小维修资源源 xlsx；extra_col=True 时注入一个未声明列「幽灵列」。"""
    data = {
        "修理厂名称": [f"测试维修厂_{i:02d}有限公司" for i in range(n)],
        "统计时间": ["2026-06-01"] * n,
    }
    if extra_col:
        data["幽灵列"] = [f"上游悄改_{i}" for i in range(n)]
    pd.DataFrame(data).to_excel(path, index=False, engine="openpyxl")


class _RepairIgnoresGhost(RepairConverter):
    """测试用子类：把「幽灵列」声明为显式忽略，验证放行 + 不落盘。"""

    def get_explicitly_ignored_columns(self) -> list:
        return ["幽灵列"]


class BaseConverterSchemaContractTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.xlsx = self.tmp / "20250601-20260628_03_维修资源.xlsx"
        self.out = self.tmp / "latest.parquet"
        self._saved_branch = os.environ.pop("BRANCH_CODE", None)

    def tearDown(self):
        if self._saved_branch is not None:
            os.environ["BRANCH_CODE"] = self._saved_branch
        else:
            os.environ.pop("BRANCH_CODE", None)
        self._tmp.cleanup()

    def _run(self, converter, extra_argv=None) -> pd.DataFrame:
        argv = ["convert_repair.py", "-i", str(self.xlsx), "-o", str(self.out),
                "--no-metadata"]
        if extra_argv:
            argv.extend(extra_argv)
        with mock.patch.object(sys, "argv", argv):
            converter.run()
        return pd.read_parquet(self.out)

    def test_clean_source_passes(self):
        """正常源（仅映射列）→ ETL 通过、产出 parquet。"""
        _write_repair_xlsx(self.xlsx, extra_col=False)
        df = self._run(RepairConverter())
        self.assertEqual(len(df), 3)
        self.assertIn("repair_shop_name", df.columns)

    def test_undeclared_column_exits_nonzero(self):
        """注入未声明列「幽灵列」→ sys.exit(1)，不产出 parquet。"""
        _write_repair_xlsx(self.xlsx, extra_col=True)
        with self.assertRaises(SystemExit) as cm:
            self._run(RepairConverter())
        self.assertEqual(cm.exception.code, 1)

    def test_force_bypasses_and_drops(self):
        """--force → 未声明列仅告警、ETL 通过，且「幽灵列」不落盘。"""
        _write_repair_xlsx(self.xlsx, extra_col=True)
        df = self._run(RepairConverter(), ["--force"])
        self.assertEqual(len(df), 3)
        self.assertNotIn("幽灵列", df.columns)

    def test_explicitly_ignored_passes_and_drops(self):
        """converter 声明忽略「幽灵列」→ 放行、ETL 通过，且该列不落盘。"""
        _write_repair_xlsx(self.xlsx, extra_col=True)
        df = self._run(_RepairIgnoresGhost())
        self.assertEqual(len(df), 3)
        self.assertNotIn("幽灵列", df.columns)


# ── 3. customer_flow 自有路径（override run()，不经 base_converter step 3） ──


def _write_cf_xlsx(path: Path, cols: dict) -> None:
    pd.DataFrame(cols).to_excel(path, index=False, engine="openpyxl")


class CustomerFlowSchemaContractTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._saved_branch = os.environ.pop("BRANCH_CODE", None)

    def tearDown(self):
        if self._saved_branch is not None:
            os.environ["BRANCH_CODE"] = self._saved_branch
        else:
            os.environ.pop("BRANCH_CODE", None)
        self._tmp.cleanup()

    def _base_cols(self, n=3):
        # policy_no 前缀 610 → 派生 branch_code=SC（与默认 declared_branch 一致）
        return {
            "保单号": [f"610{i:09d}" for i in range(n)],
            "保险起期": ["2026-01-01"] * n,
            "车架号": [f"VIN{i:014d}" for i in range(n)],
            "次年保险公司": ["华安"] * n,
        }

    def test_declared_ignored_insurance_end_date_passes(self):
        """09 源含已声明忽略的「保险止期」→ ETL 通过，且不落盘。"""
        cols = self._base_cols()
        cols["保险止期"] = ["2026-12-31"] * 3
        f = self.tmp / "20260608_09_商业险转保上年公司.xlsx"
        _write_cf_xlsx(f, cols)
        df = build_customer_flow_dataframe([f])
        self.assertEqual(len(df), 3)
        self.assertNotIn("insurance_end_date", df.columns)
        self.assertNotIn("保险止期", df.columns)

    def test_undeclared_column_exits_nonzero(self):
        """注入未声明列「幽灵列」→ sys.exit(1)。"""
        cols = self._base_cols()
        cols["幽灵列"] = ["上游悄改"] * 3
        f = self.tmp / "20260608_08_商业险续保流失公司.xlsx"
        _write_cf_xlsx(f, cols)
        with self.assertRaises(SystemExit) as cm:
            build_customer_flow_dataframe([f])
        self.assertEqual(cm.exception.code, 1)

    def test_force_bypasses(self):
        """force=True → 未声明列仅告警、ETL 通过。"""
        cols = self._base_cols()
        cols["幽灵列"] = ["上游悄改"] * 3
        f = self.tmp / "20260608_08_商业险续保流失公司.xlsx"
        _write_cf_xlsx(f, cols)
        df = build_customer_flow_dataframe([f], force=True)
        self.assertEqual(len(df), 3)
        self.assertNotIn("幽灵列", df.columns)


if __name__ == "__main__":
    unittest.main()
