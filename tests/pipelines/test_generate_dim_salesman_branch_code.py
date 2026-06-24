"""generate_dim_tables.build_salesman_table branch_code 落列单测（ADR G3 多省）。

证明（codex 闸-1 P2.2 一致性）：生产者 build_salesman_table 把 branch_code='SC' 作为
**末尾列**追加、615/全行单省 SC、不改动既有业务列 —— 与手工 in-place 物化
（materialize_branch_code_special / arrow append_column）产物 schema 一致：
[10 业务列…] + branch_code。

运行时 loadDimParquet 以「SalesmanDim 含 branch_code 列」判定 multiProvince=true
（server/src/services/duckdb-domain-loaders.ts），故本列是 multiProvince + 分省 RLS 的硬前置。
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DIM_DIR = ROOT / "数据管理" / "warehouse" / "dim"
if str(DIM_DIR) not in sys.path:
    sys.path.insert(0, str(DIM_DIR))

from generate_dim_tables import (  # noqa: E402
    SALESMAN_BRANCH_CODE,
    build_salesman_table,
)

# build_salesman_table 以 salesman_list 为主表的 10 个业务列（顺序即 latest.parquet 列序）
EXPECTED_BUSINESS_COLS = [
    "business_no", "salesman_name", "full_name", "position", "team",
    "organization", "hire_date", "status", "leave_date", "tenure_months",
]


def _salesman_list(rows):
    """rows: list of dict（至少含 full_name/business_no/salesman_name）。"""
    base = {c: [] for c in EXPECTED_BUSINESS_COLS}
    for r in rows:
        for c in EXPECTED_BUSINESS_COLS:
            base[c].append(r.get(c))
    return pd.DataFrame(base)


def _empty_plan(cols):
    return pd.DataFrame({c: [] for c in cols})


class BuildSalesmanTableBranchCodeTest(unittest.TestCase):
    def _build(self, salesman_list):
        plan_cols = ["full_name", "business_no", "salesman_name", "team",
                     "organization", "hire_date"]
        plan_2025 = _empty_plan(plan_cols)
        plan_2026 = _empty_plan(["full_name", "business_no", "salesman_name",
                                 "team", "organization"])
        return build_salesman_table(salesman_list, plan_2025, plan_2026)

    def test_branch_code_is_last_column_all_sc(self):
        """branch_code 为末尾列 + 全 'SC' + 既有 10 业务列原样保留。"""
        sl = _salesman_list([
            {"business_no": "200048468", "salesman_name": "肖照耀",
             "full_name": "200048468肖照耀", "position": "客户经理",
             "team": "团队A", "organization": "天府", "hire_date": "2024-01-01",
             "status": "在职", "leave_date": None, "tenure_months": 12},
            {"business_no": "200048259", "salesman_name": "刘婷",
             "full_name": "200048259刘婷", "position": None,
             "team": "团队B", "organization": "高新", "hire_date": None,
             "status": "在职", "leave_date": None, "tenure_months": 5},
        ])
        out = self._build(sl)
        cols = list(out.columns)
        # 末尾列 = branch_code
        self.assertEqual(cols[-1], "branch_code")
        # 既有业务列原样、顺序不变（branch_code 仅追加）
        self.assertEqual(cols[:-1], EXPECTED_BUSINESS_COLS)
        # 全行单省 SC、零 NULL
        self.assertEqual(sorted(out["branch_code"].unique().tolist()), ["SC"])
        self.assertEqual(int(out["branch_code"].isna().sum()), 0)
        self.assertEqual(len(out), 2)

    def test_branch_code_constant_matches_module_const(self):
        """落列值 == 模块常量 SALESMAN_BRANCH_CODE（防漂移）。"""
        self.assertEqual(SALESMAN_BRANCH_CODE, "SC")
        sl = _salesman_list([
            {"business_no": "1", "salesman_name": "甲", "full_name": "1甲",
             "position": None, "team": "T", "organization": "O",
             "hire_date": None, "status": "在职", "leave_date": None,
             "tenure_months": 1},
        ])
        out = self._build(sl)
        self.assertTrue((out["branch_code"] == SALESMAN_BRANCH_CODE).all())


if __name__ == "__main__":
    unittest.main()
