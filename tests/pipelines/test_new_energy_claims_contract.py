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
    """写一个最小化 policy Parquet fixture。

    必须包含 insurance_start_date（timestamp）+ policy_no（varchar）+
    vehicle_frame_no + org_level_3，与生产 policy parquet schema 保持一致。
    SQL 中 ORDER BY insurance_start_date/policy_no 要求这两列存在；缺列
    会触发 Binder Error（fail-fast），测试 fixture 须符合真实 schema。
    """
    # 为未提供 insurance_start_date/policy_no 的行注入默认值（兼容旧测试调用方）
    ts_default = pd.Timestamp("2025-01-01")
    pn_default = "P0000"
    normalized = []
    for i, row in enumerate(rows):
        r = dict(row)
        r.setdefault("insurance_start_date", ts_default)
        r.setdefault("policy_no", f"{pn_default}_{i:04d}")
        normalized.append(r)
    df = pd.DataFrame(normalized)
    # 确保 insurance_start_date 为 datetime64（pyarrow timestamp 兼容）
    if "insurance_start_date" in df.columns:
        df["insurance_start_date"] = pd.to_datetime(df["insurance_start_date"])
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
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "成都分公司",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025_VIN1",
                    },
                    {
                        "vehicle_frame_no": "VIN2",
                        "org_level_3": "绵阳分公司",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025_VIN2",
                    },
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
                    # 同一 VIN，两条保单，org 一致（如同年多批改）
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "成都分公司",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025_A",
                    },
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "成都分公司",
                        "insurance_start_date": pd.Timestamp("2025-06-01"),
                        "policy_no": "P2025_B",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        # 不会因笛卡尔积而产生多行
        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["org_level_3"], "成都分公司")

    # ── 测试 4：一车架号多保单 org 不一致时，取最新 insurance_start_date 保单的 org（确定性，不爆炸）──
    def test_dedup_vin_with_conflicting_org_picks_latest_policy(self):
        """
        同一车架号跨年续保机构变更场景：insurance_start_date 较晚的保单代表最新机构归属。
        修复前使用 ROW_NUMBER()（物理存储序），机构变更时静默归错机构。
        修复后按 insurance_start_date DESC 排序，始终取最新保单 org_level_3。
        """
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    # 同一 VIN，两条保单，insurance_start_date 不同，org 不同
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "旧机构",
                        "insurance_start_date": pd.Timestamp("2024-01-01"),
                        "policy_no": "P2024",
                    },
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "最新机构",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        # 不爆炸（行数必须保持 1）
        self.assertEqual(len(result), 1)
        # 必须取最新保单（insurance_start_date 最大）的 org_level_3
        self.assertEqual(result.iloc[0]["org_level_3"], "最新机构")

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
                [
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "policy侧机构",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025",
                    },
                ],
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
                [
                    {
                        "vehicle_frame_no": "VINTEST001",
                        "org_level_3": "测试分公司",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "PTEST001",
                    },
                ],
            )

            df = build_new_energy_claims_dataframe(
                [source], policy_dir=str(policy_dir)
            )

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["org_level_3"], "测试分公司")

    # ── 测试 9：policy parquet 缺 schema 列时抛 RuntimeError，禁止静默退化 ────────
    def test_schema_binder_error_raises_not_silenced(self):
        """
        policy parquet 缺少 insurance_start_date 或 policy_no 时（ETL bug），
        DuckDB 会抛 Binder Error；修复后 except 必须重新抛出为 RuntimeError，
        禁止静默吞掉后继续输出退化的 org_level_3。
        """
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            # 故意写一个缺少 insurance_start_date 和 policy_no 的 parquet（schema 不合约定）
            df_broken = pd.DataFrame([
                {"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司"},
            ])
            pq.write_table(pa.Table.from_pandas(df_broken), policy_dir / "broken.parquet")

            df_claims = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": None},
            ])

            with self.assertRaises(RuntimeError) as ctx:
                enrich_org_level_3_from_policy(df_claims, policy_dir=str(policy_dir))

        self.assertIn("schema", str(ctx.exception).lower())

    # ── 测试 8：VIN 大小写/空格混合时仍能命中（P2-2 规范化）────────────────────
    def test_vin_case_insensitive_join(self):
        """
        claims 侧 VIN 含小写或前后空格时，UPPER+TRIM 规范化后仍能与 policy 侧命中。
        """
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {
                        "vehicle_frame_no": "ABC123XYZ",  # policy 侧全大写
                        "org_level_3": "成都分公司",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025",
                    },
                ],
            )

            df = self._make_claims_df([
                # claims 侧含小写和空格
                {"claim_no": "R1", "vehicle_frame_no": " abc123xyz ", "org_level_3": None},
            ])
            result = enrich_org_level_3_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["org_level_3"], "成都分公司")
        # 原始 vehicle_frame_no 列保持不变（不被 UPPER+TRIM 污染）
        self.assertEqual(result.iloc[0]["vehicle_frame_no"], " abc123xyz ")


if __name__ == "__main__":
    unittest.main()
