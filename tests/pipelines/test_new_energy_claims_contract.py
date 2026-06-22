import tempfile
import unittest
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
import sys

if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.convert_new_energy_claims import (
    build_new_energy_claims_dataframe,
    enrich_org_level_3_from_policy,
)


def _write_policy_parquet(path: Path, rows: list[dict]) -> None:
    """写一个最小化 policy Parquet fixture（只含 VIN JOIN 所需字段）。"""
    df = pd.DataFrame(rows)
    pq.write_table(pa.Table.from_pandas(df), path)


class NewEnergyClaimsContractTest(unittest.TestCase):
    def test_builds_minimal_new_energy_claims_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            source = tmpdir / "20260524_新能源_出险信息表.xlsx"
            pd.DataFrame(
                [
                    {
                        "报案时间": "2026-01-07",
                        "报案号": "R1",
                        "车架号": "VIN1",
                        "整案是否结案": "否",
                        "立案金额rmb": "8007.2",
                        "业务结案赔款": "",
                        "业务结案金额": "",
                        "责任系数": "30",
                    },
                    {
                        "报案时间": "2026-01-08",
                        "报案号": "R2",
                        "车架号": "VIN2",
                        "整案是否结案": "是",
                        "立案金额rmb": "100",
                        "业务结案赔款": "80",
                        "业务结案金额": "",
                        "责任系数": "100",
                    },
                ]
            ).to_excel(source, index=False)

            df = build_new_energy_claims_dataframe([source])

        self.assertEqual(len(df), 2)
        self.assertEqual(
            list(df.columns),
            [
                "report_time",
                "policy_no",
                "claim_no",
                "vehicle_frame_no",
                "plate_no",
                "org_level_3",
                "claim_status",
                "settled_amount",
                "reserve_amount",
                "source_batch_date",
            ],
        )
        r1 = df[df["claim_no"] == "R1"].iloc[0]
        self.assertEqual(r1["vehicle_frame_no"], "VIN1")
        self.assertEqual(r1["claim_status"], "未业务结案")
        self.assertAlmostEqual(r1["reserve_amount"], 8007.2)
        self.assertEqual(r1["source_batch_date"], "20260524")

        r2 = df[df["claim_no"] == "R2"].iloc[0]
        self.assertEqual(r2["claim_status"], "已业务结案")
        self.assertAlmostEqual(r2["settled_amount"], 80.0)


class OrgLevel3EnrichTest(unittest.TestCase):
    """
    测试 enrich_org_level_3_from_policy：通过 vehicle_frame_no 关联 policy 回填 org_level_3。
    """

    def _make_claims_df(self, rows: list[dict]) -> pd.DataFrame:
        """构造最小 claims DataFrame（模拟 build_new_energy_claims_dataframe 输出）。"""
        default = {
            "report_time": pd.Timestamp("2026-01-07"),
            "policy_no": None,
            "claim_no": "R0",
            "vehicle_frame_no": None,
            "plate_no": None,
            "org_level_3": None,
            "claim_status": "未业务结案",
            "settled_amount": None,
            "reserve_amount": 100.0,
            "source_batch_date": "20260607",
        }
        records = [{**default, **r} for r in rows]
        return pd.DataFrame(records)

    # ── 测试 1：policy_dir=None，函数不改 org_level_3 ──────────────────────────
    def test_no_policy_dir_returns_unchanged(self):
        df = self._make_claims_df([
            {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
        ])
        result = enrich_org_level_3_from_policy(df, policy_dir=None)
        # 不改变行数、不改变列结构
        self.assertEqual(len(result), 1)
        self.assertIn("org_level_3", result.columns)
        # org_level_3 保持 None
        self.assertTrue(pd.isna(result.iloc[0]["org_level_3"]))

    # ── 测试 2：提供 policy_dir，成功回填 ─────────────────────────────────────
    def test_enriches_org_level_3_via_vin_join(self):
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy_part1.parquet",
                [
                    {"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司"},
                    {"vehicle_frame_no": "VIN2", "org_level_3": "绵阳分公司"},
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
                {"claim_no": "R2", "vehicle_frame_no": "VIN2", "org_level_3": None},
                {"claim_no": "R3", "vehicle_frame_no": "VIN_UNKNOWN", "org_level_3": None},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(result.loc[result["claim_no"] == "R1", "org_level_3"].iloc[0], "成都分公司")
        self.assertEqual(result.loc[result["claim_no"] == "R2", "org_level_3"].iloc[0], "绵阳分公司")
        # 未命中行 org_level_3 应为 None / NaN（不报错）
        r3_val = result.loc[result["claim_no"] == "R3", "org_level_3"].iloc[0]
        self.assertTrue(pd.isna(r3_val))

    # ── 测试 3：一车架号多保单时取一致 org（去重）────────────────────────────────
    def test_dedup_vin_with_consistent_org(self):
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    # 同一 VIN，两条保单，org 一致
                    {"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司"},
                    {"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司"},
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        # 不会因笛卡尔积而产生多行
        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["org_level_3"], "成都分公司")

    # ── 测试 4：一车架号多保单 org 不一致时，取最后出现的一条（确定性，不爆炸）──
    def test_dedup_vin_with_conflicting_org_picks_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    # 同一 VIN，两条保单，org 不同（如跨年续保机构变更）
                    {"vehicle_frame_no": "VIN1", "org_level_3": "旧机构"},
                    {"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司"},
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        # 不爆炸（行数必须保持 1）
        self.assertEqual(len(result), 1)
        # org_level_3 被回填为某个非空值
        self.assertFalse(pd.isna(result.iloc[0]["org_level_3"]))

    # ── 测试 5：policy_dir 不存在，优雅降级不抛异常 ─────────────────────────────
    def test_missing_policy_dir_graceful_fallback(self):
        df = self._make_claims_df([
            {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
        ])
        result = enrich_org_level_3_from_policy(df, policy_dir="/nonexistent/path/policy")
        self.assertEqual(len(result), 1)
        # org_level_3 未被回填（None/NaN），不抛异常
        self.assertTrue(pd.isna(result.iloc[0]["org_level_3"]))

    # ── 测试 6：源 Excel 含三级机构列时直接使用，不被 policy JOIN 覆盖 ──────────
    def test_existing_org_level_3_preserved_if_present(self):
        """若 Excel 里已有三级机构，policy JOIN 不应覆盖（Excel 值优先）。"""
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [{"vehicle_frame_no": "VIN1", "org_level_3": "policy侧机构"}],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": "excel侧机构"},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        # Excel 中已有非空 org_level_3，不被 policy JOIN 覆盖
        self.assertEqual(result.iloc[0]["org_level_3"], "excel侧机构")

    # ── 测试 7：build_new_energy_claims_dataframe 集成——传入 policy_dir 端到端 ──
    def test_end_to_end_build_with_policy_dir(self):
        """
        测试 build_new_energy_claims_dataframe 接受 policy_dir 参数后
        可正确将 org_level_3 从 policy 回填到最终输出。
        """
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            source = tmpdir / "20260607_新能源_出险信息表.xlsx"
            pd.DataFrame([
                {
                    "报案时间": "2026-03-01",
                    "报案号": "CLAIM001",
                    "车架号": "VINTEST001",
                    "整案是否结案": "否",
                    "立案金额rmb": "5000",
                },
            ]).to_excel(source, index=False)

            policy_dir = tmpdir / "policy"
            policy_dir.mkdir()
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [{"vehicle_frame_no": "VINTEST001", "org_level_3": "测试分公司"}],
            )

            df = build_new_energy_claims_dataframe(
                [source], policy_dir=str(policy_dir)
            )

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["org_level_3"], "测试分公司")


if __name__ == "__main__":
    unittest.main()
