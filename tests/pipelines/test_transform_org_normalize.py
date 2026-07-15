"""premium 域机构规范化新口径单测（BACKLOG 2026-07-15-user-e04971）

被测模块：数据管理/pipelines/org_normalize.py（从 transform.normalize_branch_org 下沉——
transform.py 模块级执行 argparse 无法被单测 import，参照 org_collapse.py 先例独立成模块；
transform.py 留薄 wrapper 读 BRANCH_CODE 后委托本模块）。

背景：山西 org_level_3 原口径把 经代/车商/重客 合并为「经代、车商、重客」
（SX.json org_to_unit 多对一，编码 0118010204 一对多到 4 个单元不可反推）。
2026-07-15 用户裁定：以源列「三级机构新」实际取值为准拆分，太原命名经
org_new_normalization 归一为现名（太原业务一部/二部 → 太原一部/二部）。

本文件锁定新口径五件事：
1. 「三级机构新」优先：归一后直接作为 org_level_3，用后 drop 不落 parquet
2. 行级回退：该列空值/「其他」→ 按「三级机构」编码列查 org_to_unit
3. 回退白名单守卫：回退结果不在 units（如已拆除的旧合并值）→ 保留「其他」，
   绝不产出退役值污染下游（实证：0118010203/0118010204 共 138 行会命中）
4. fail-closed：SX（配置已声明新口径）源整列缺失 → sys.exit(1)，
   防上游导出回退静默重回合并口径（B005 静默退化同款风险）
5. 未声明新口径的省份走旧路径（org_to_unit 全列映射）不受影响
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.org_normalize import normalize_branch_org_df  # noqa: E402

MAPPING_DIR = DATA_ROOT / "config" / "branch-org-mapping"

# SX.json 中的真实键（测试与生产同源）
CODED_TAIYUAN1 = "0118010109太原市鼎晨花园营销服务部（停用）"      # org_to_unit → 太原一部
CODED_RETIRED_BUCKET = "0118010204山西分公司本部（渠道重客）"       # org_to_unit → 旧合并值（已不在 units）
CODED_DATANG = "0118020103太原市大唐奥林匹克花园营销服务部（停用）"  # org_to_unit → 太原二部


def run_sx(df):
    return normalize_branch_org_df(df, "SX", MAPPING_DIR, env={})


class SxNewCaliberTest(unittest.TestCase):
    def test_new_column_preferred_and_normalized(self):
        df = pd.DataFrame({
            "三级机构新": ["太原业务一部", "太原业务二部", "晋中", "经代", "车商", "重客"],
            "三级机构": [CODED_TAIYUAN1] * 6,
        })
        out = run_sx(df)
        self.assertEqual(
            out["三级机构"].tolist(),
            ["太原一部", "太原二部", "晋中", "经代", "车商", "重客"],
        )
        self.assertNotIn("三级机构新", out.columns)

    def test_split_units_are_independent_values(self):
        """核心验收：经代/车商/重客 是三个独立值，不再合并。"""
        df = pd.DataFrame({
            "三级机构新": ["经代", "车商", "重客"],
            "三级机构": [CODED_RETIRED_BUCKET] * 3,
        })
        out = run_sx(df)
        self.assertEqual(out["三级机构"].nunique(), 3)
        self.assertNotIn("经代、车商、重客", set(out["三级机构"]))

    def test_other_rows_fall_back_via_coded_org(self):
        # 实证场景：2026-07-15 重导后 3,635 行「其他」的编码列是大唐奥林匹克（→太原二部）
        df = pd.DataFrame({
            "三级机构新": ["其他", "其他", "晋中"],
            "三级机构": [CODED_DATANG, CODED_TAIYUAN1, CODED_TAIYUAN1],
        })
        out = run_sx(df)
        self.assertEqual(out["三级机构"].tolist(), ["太原二部", "太原一部", "晋中"])

    def test_nan_and_blank_also_fall_back(self):
        df = pd.DataFrame({
            "三级机构新": [None, "  ", "运城"],
            "三级机构": [CODED_DATANG, CODED_TAIYUAN1, CODED_TAIYUAN1],
        })
        out = run_sx(df)
        self.assertEqual(out["三级机构"].tolist(), ["太原二部", "太原一部", "运城"])

    def test_fallback_to_retired_bucket_keeps_placeholder(self):
        """回退命中旧合并值（白名单外）→ 保留「其他」，不产出退役值（实证 138 行场景）。"""
        df = pd.DataFrame({
            "三级机构新": ["其他", "晋中"],
            "三级机构": [CODED_RETIRED_BUCKET, CODED_TAIYUAN1],
        })
        out = run_sx(df)
        self.assertEqual(out["三级机构"].tolist(), ["其他", "晋中"])
        self.assertNotIn("经代、车商、重客", set(out["三级机构"]))

    def test_fallback_unknown_code_keeps_placeholder(self):
        df = pd.DataFrame({
            "三级机构新": ["其他", "晋中"],
            "三级机构": ["9999不存在的编码机构", CODED_TAIYUAN1],
        })
        out = run_sx(df)
        self.assertEqual(out["三级机构"].tolist(), ["其他", "晋中"])

    def test_out_of_whitelist_new_value_preserved(self):
        """白名单外真实新值原样保留（告警不吞数据），供人工确认是否补 units。"""
        df = pd.DataFrame({
            "三级机构新": ["未来新单元X", "晋中"],
            "三级机构": [CODED_TAIYUAN1] * 2,
        })
        out = run_sx(df)
        self.assertEqual(out["三级机构"].tolist(), ["未来新单元X", "晋中"])

    def test_does_not_mutate_input(self):
        df = pd.DataFrame({
            "三级机构新": ["太原业务一部"],
            "三级机构": [CODED_TAIYUAN1],
        })
        run_sx(df)
        self.assertEqual(df["三级机构新"].tolist(), ["太原业务一部"])
        self.assertEqual(df["三级机构"].tolist(), [CODED_TAIYUAN1])

    def test_missing_new_column_hard_fails(self):
        """fail-closed：SX 源缺「三级机构新」整列 → sys.exit(1)（防静默退回合并口径）。"""
        df = pd.DataFrame({"三级机构": [CODED_TAIYUAN1] * 3})
        with self.assertRaises(SystemExit) as ctx:
            run_sx(df)
        self.assertEqual(ctx.exception.code, 1)

    def test_no_org_columns_noop(self):
        df = pd.DataFrame({"保费": [1.0]})
        out = run_sx(df)
        self.assertEqual(list(out.columns), ["保费"])


class LegacyPathTest(unittest.TestCase):
    """未声明 org_new_normalization 的省份（构造无该键的映射目录）走旧路径。"""

    def test_missing_mapping_file_keeps_values(self):
        df = pd.DataFrame({"三级机构": ["某机构"]})
        out = normalize_branch_org_df(df, "ZZ", MAPPING_DIR, env={})
        self.assertEqual(out["三级机构"].tolist(), ["某机构"])

    def test_legacy_full_column_mapping_without_new_caliber(self, tmp_name="XX"):
        import json as _json
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            cfg = {"units": ["单元A"], "org_to_unit": {"编码机构A": "单元A"}}
            (Path(td) / f"{tmp_name}.json").write_text(_json.dumps(cfg), encoding="utf-8")
            df = pd.DataFrame({"三级机构": ["编码机构A", "未知B"]})
            out = normalize_branch_org_df(df, tmp_name, Path(td), env={})
            self.assertEqual(out["三级机构"].tolist(), ["单元A", "未知B"])


if __name__ == "__main__":
    unittest.main()
