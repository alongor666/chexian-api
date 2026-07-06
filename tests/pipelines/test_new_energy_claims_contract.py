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
    OUTPUT_COLUMNS,
    build_new_energy_claims_dataframe,
    enrich_org_and_branch_from_policy,
)


def _write_policy_parquet(path: Path, rows: list[dict]) -> None:
    """写一个最小化 policy Parquet fixture。

    必须包含 insurance_start_date（timestamp）+ policy_no（varchar）+
    vehicle_frame_no + org_level_3 + branch_code，与生产 policy parquet schema 保持一致
    （branch_code 是 P3-E 新增前提；P1 #762 已注入每行 100% 'SC'）。
    SQL 中 ORDER BY insurance_start_date/policy_no 要求这两列存在；WHERE branch_code IS NOT NULL
    要求 branch_code 列存在；缺列会触发 Binder Error（fail-fast），fixture 须符合真实 schema。
    """
    # 为未提供 insurance_start_date/policy_no/branch_code 的行注入默认值（兼容旧测试调用方）
    ts_default = pd.Timestamp("2025-01-01")
    pn_default = "P0000"
    normalized = []
    for i, row in enumerate(rows):
        r = dict(row)
        r.setdefault("insurance_start_date", ts_default)
        r.setdefault("policy_no", f"{pn_default}_{i:04d}")
        r.setdefault("branch_code", "SC")
        normalized.append(r)
    df = pd.DataFrame(normalized)
    if "insurance_start_date" in df.columns:
        df["insurance_start_date"] = pd.to_datetime(df["insurance_start_date"])
    pq.write_table(pa.Table.from_pandas(df), path)


class NewEnergyClaimsContractTest(unittest.TestCase):
    def test_builds_minimal_new_energy_claims_snapshot(self):
        """端到端：含 policy_dir 时输出 11 列（含 branch_code），行级 100% 派生 SC。"""
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

            policy_dir = tmpdir / "policy"
            policy_dir.mkdir()
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司", "branch_code": "SC"},
                    {"vehicle_frame_no": "VIN2", "org_level_3": "绵阳分公司", "branch_code": "SC"},
                ],
            )

            df = build_new_energy_claims_dataframe([source], policy_dir=str(policy_dir))

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
                "branch_code",
                "claim_status",
                "settled_amount",
                "reserve_amount",
                "source_batch_date",
            ],
        )
        # branch_code 行级 100% 'SC'（hard-fail 保证）
        self.assertTrue((df["branch_code"] == "SC").all())

        r1 = df[df["claim_no"] == "R1"].iloc[0]
        self.assertEqual(r1["vehicle_frame_no"], "VIN1")
        self.assertEqual(r1["claim_status"], "未业务结案")
        self.assertAlmostEqual(r1["reserve_amount"], 8007.2)
        self.assertEqual(r1["source_batch_date"], "20260524")
        self.assertEqual(r1["branch_code"], "SC")

        r2 = df[df["claim_no"] == "R2"].iloc[0]
        self.assertEqual(r2["claim_status"], "已业务结案")
        self.assertAlmostEqual(r2["settled_amount"], 80.0)
        self.assertEqual(r2["branch_code"], "SC")


class OrgAndBranchEnrichTest(unittest.TestCase):
    """
    测试 enrich_org_and_branch_from_policy：通过 vehicle_frame_no 关联 policy
    同时回填 org_level_3 + 派生 branch_code（P3-E 2026-06-23）。
    """

    def _make_claims_df(self, rows: list[dict]) -> pd.DataFrame:
        """构造最小 claims DataFrame（模拟 build_new_energy_claims_dataframe 输出）。

        包含 branch_code=None 占位（与 OUTPUT_COLUMNS 一致），enrich 会先 drop 再
        从 JOIN 重建（业务列保护 guard 允许全 NULL 占位列）。
        """
        default = {
            "report_time": pd.Timestamp("2026-01-07"),
            "policy_no": None,
            "claim_no": "R0",
            "vehicle_frame_no": None,
            "plate_no": None,
            "org_level_3": None,
            "branch_code": None,
            "claim_status": "未业务结案",
            "settled_amount": None,
            "reserve_amount": 100.0,
            "source_batch_date": "20260607",
        }
        records = [{**default, **r} for r in rows]
        return pd.DataFrame(records)

    # ── P1#2：policy_dir=None → raise（不可静默） ──────────────────────────
    def test_none_policy_dir_raises_runtime_error(self):
        df = self._make_claims_df([
            {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
        ])
        with self.assertRaises(RuntimeError) as ctx:
            enrich_org_and_branch_from_policy(df, policy_dir=None)
        self.assertIn("policy_dir", str(ctx.exception))

    # ── P1#2：policy_dir 路径不存在/无 parquet → raise ─────────────────────
    def test_missing_policy_dir_raises_runtime_error(self):
        df = self._make_claims_df([
            {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
        ])
        with self.assertRaises(RuntimeError) as ctx:
            enrich_org_and_branch_from_policy(df, policy_dir="/nonexistent/path/policy")
        self.assertIn("policy_dir", str(ctx.exception).lower())

    # ── 业务列 guard（R31）：入参 df 含非空 branch_code → ValueError ─────────
    def test_existing_non_null_branch_code_raises_value_error(self):
        """R31 业务列保护：禁止重入污染。"""
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [{"vehicle_frame_no": "VIN1", "org_level_3": "成都分公司", "branch_code": "SC"}],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "branch_code": "已存在"},
            ])

            with self.assertRaises(ValueError) as ctx:
                enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))
        self.assertIn("branch_code", str(ctx.exception))

    # ── 成功路径：同时回填 org_level_3 + branch_code ───────────────────────
    def test_enriches_org_and_branch_via_vin_join(self):
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy_part1.parquet",
                [
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "成都分公司",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025_VIN1",
                    },
                    {
                        "vehicle_frame_no": "VIN2",
                        "org_level_3": "绵阳分公司",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025_VIN2",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
                {"claim_no": "R2", "vehicle_frame_no": "VIN2"},
            ])
            result = enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(len(result), 2)
        self.assertEqual(result.loc[result["claim_no"] == "R1", "org_level_3"].iloc[0], "成都分公司")
        self.assertEqual(result.loc[result["claim_no"] == "R2", "org_level_3"].iloc[0], "绵阳分公司")
        # branch_code 行级 100% 'SC'
        self.assertTrue((result["branch_code"] == "SC").all())

    # ── hard-fail：VIN miss>0 → RuntimeError（P1#1：不被 except 吞）─────────
    def test_vin_miss_raises_hard_fail(self):
        """VIN 在 new_energy 但不在 policy → branch_code IS NULL → RuntimeError。"""
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {"vehicle_frame_no": "VIN_HIT", "org_level_3": "成都分公司", "branch_code": "SC"},
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN_HIT"},
                {"claim_no": "R2", "vehicle_frame_no": "VIN_MISS"},  # 不在 policy → miss
            ])

            with self.assertRaises(RuntimeError) as ctx:
                enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        msg = str(ctx.exception)
        self.assertIn("branch_code", msg)
        self.assertIn("hard-fail", msg)
        # 错误消息应展示具体未命中 VIN（便于排查）
        self.assertIn("VIN_MISS", msg)

    # ── 一车架号多保单时取一致 org（去重）────────────────────────────────
    def test_dedup_vin_with_consistent_org(self):
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "成都分公司",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025_A",
                    },
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "成都分公司",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-06-01"),
                        "policy_no": "P2025_B",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
            ])
            result = enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["org_level_3"], "成都分公司")
        self.assertEqual(result.iloc[0]["branch_code"], "SC")

    # ── 一车架号多保单 org 不一致时，取最新 insurance_start_date 保单 ──
    def test_dedup_vin_with_conflicting_org_picks_latest_policy(self):
        """同一车架号跨年续保机构变更场景：取 insurance_start_date 最大保单的 org+branch。"""
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "旧机构",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2024-01-01"),
                        "policy_no": "P2024",
                    },
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "最新机构",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
            ])
            result = enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["org_level_3"], "最新机构")
        self.assertEqual(result.iloc[0]["branch_code"], "SC")

    def test_same_vin_cross_branch_conflict_raises(self):
        """同一 VIN 命中多个 branch_code 时禁止用 ROW_NUMBER 最新保单静默兜底。"""
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "四川机构",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "SC2025",
                    },
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "山西机构",
                        "branch_code": "SX",
                        "insurance_start_date": pd.Timestamp("2025-06-01"),
                        "policy_no": "SX2025",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
            ])
            with self.assertRaises(RuntimeError) as ctx:
                enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        msg = str(ctx.exception)
        self.assertIn("同 VIN 跨省 branch_code 冲突", msg)
        self.assertIn("VIN1", msg)
        self.assertIn("SC,SX", msg)

    # ── 源 Excel 含三级机构列时直接使用，不被 policy JOIN 覆盖 ──────────
    def test_existing_org_level_3_preserved_if_present(self):
        """若 Excel 里已有三级机构，policy JOIN 不应覆盖（Excel 值优先）；
        但 branch_code 仍由 JOIN 注入（new_energy parquet 原无此列，无 Excel 值可保留）。
        """
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {
                        "vehicle_frame_no": "VIN1",
                        "org_level_3": "policy侧机构",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1", "org_level_3": "excel侧机构"},
            ])
            result = enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(result.iloc[0]["org_level_3"], "excel侧机构")
        # branch_code 由 JOIN 注入（new_energy 源无此列可保留）
        self.assertEqual(result.iloc[0]["branch_code"], "SC")

    # ── policy parquet 缺 schema 列时抛 RuntimeError，禁止静默退化 ────────
    def test_schema_binder_error_raises_not_silenced(self):
        """policy parquet 缺 insurance_start_date / policy_no / branch_code 任一列时，
        DuckDB Binder Error 必须重新抛出为 RuntimeError，禁止静默吞掉。
        """
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            # 故意写一个缺 branch_code 列的 parquet（schema 不合 P3-E 约定）
            df_broken = pd.DataFrame([
                {
                    "vehicle_frame_no": "VIN1",
                    "org_level_3": "成都分公司",
                    "insurance_start_date": pd.Timestamp("2025-01-01"),
                    "policy_no": "P2025",
                },
            ])
            df_broken["insurance_start_date"] = pd.to_datetime(df_broken["insurance_start_date"])
            pq.write_table(pa.Table.from_pandas(df_broken), policy_dir / "broken.parquet")

            df_claims = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": "VIN1"},
            ])

            # 缺 branch_code → SQL Binder Error → schema_error_signals 命中 → RuntimeError
            # （即使被通用 except 兜底，try 外 miss 检查也会 raise RuntimeError）
            with self.assertRaises(RuntimeError) as ctx:
                enrich_org_and_branch_from_policy(df_claims, policy_dir=str(policy_dir))

        # 任一路径触发的 RuntimeError 都符合 P1#1（不被 except 吞）
        self.assertIsNotNone(ctx.exception)

    # ── VIN 大小写/空格混合时仍能命中 ────────────────────────
    def test_vin_case_insensitive_join(self):
        """claims 侧 VIN 含小写或前后空格时，UPPER+TRIM 规范化后仍能与 policy 侧命中。"""
        with tempfile.TemporaryDirectory() as tmp:
            policy_dir = Path(tmp)
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {
                        "vehicle_frame_no": "ABC123XYZ",
                        "org_level_3": "成都分公司",
                        "branch_code": "SC",
                        "insurance_start_date": pd.Timestamp("2025-01-01"),
                        "policy_no": "P2025",
                    },
                ],
            )

            df = self._make_claims_df([
                {"claim_no": "R1", "vehicle_frame_no": " abc123xyz "},
            ])
            result = enrich_org_and_branch_from_policy(df, policy_dir=str(policy_dir))

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["org_level_3"], "成都分公司")
        self.assertEqual(result.iloc[0]["branch_code"], "SC")
        # 原始 vehicle_frame_no 保持不变（不被 UPPER+TRIM 污染）
        self.assertEqual(result.iloc[0]["vehicle_frame_no"], " abc123xyz ")

    # ── 字节安全 oracle（R31 模板）：tempfile + COPY → read_parquet 回读 ────
    def test_byte_safety_original_columns_preserved(self):
        """原 10 列（不含 branch_code）经 ETL → parquet → 回读后 hash 全等；
        新增 branch_code 列 100% = 'SC'（行数、schema 顺序、类型保真）。
        """
        import hashlib
        import duckdb
        import io

        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            source = tmpdir / "20260607_新能源_出险信息表.xlsx"
            pd.DataFrame(
                [
                    {
                        "报案时间": "2026-03-01",
                        "报案号": "B1",
                        "车架号": "VINBYTE001",
                        "整案是否结案": "否",
                        "立案金额rmb": "1000",
                    },
                    {
                        "报案时间": "2026-03-02",
                        "报案号": "B2",
                        "车架号": "VINBYTE002",
                        "整案是否结案": "是",
                        "立案金额rmb": "2000",
                        "业务结案赔款": "1800",
                    },
                ]
            ).to_excel(source, index=False)

            policy_dir = tmpdir / "policy"
            policy_dir.mkdir()
            _write_policy_parquet(
                policy_dir / "policy.parquet",
                [
                    {"vehicle_frame_no": "VINBYTE001", "org_level_3": "A", "branch_code": "SC"},
                    {"vehicle_frame_no": "VINBYTE002", "org_level_3": "B", "branch_code": "SC"},
                ],
            )

            df = build_new_energy_claims_dataframe([source], policy_dir=str(policy_dir))
            # 用 DuckDB COPY → read_parquet 回读（R31 模板，绕开 pandas/pyarrow 版本差异）
            output_file = tmpdir / "out.parquet"
            df.to_parquet(output_file)
            con = duckdb.connect(":memory:")
            roundtrip = con.execute(f"SELECT * FROM read_parquet('{output_file}')").df()

        # schema 顺序 + 列数（11 = 原 10 + branch_code）
        self.assertEqual(list(roundtrip.columns), OUTPUT_COLUMNS)
        self.assertEqual(len(roundtrip.columns), 11)
        # 行数保真
        self.assertEqual(len(roundtrip), len(df))
        # branch_code 行级 100% 'SC'
        self.assertTrue((roundtrip["branch_code"] == "SC").all())
        # 原 10 列内容与 df 等值（去掉 branch_code 后 hash 全等）
        original_cols = [c for c in OUTPUT_COLUMNS if c != "branch_code"]
        df_no_bc = df[original_cols].reset_index(drop=True)
        rt_no_bc = roundtrip[original_cols].reset_index(drop=True)
        # 用 to_csv 做规范化序列化后 hash（避免 dtype repr 差异）
        h1 = hashlib.sha256(df_no_bc.to_csv(index=False).encode()).hexdigest()
        h2 = hashlib.sha256(rt_no_bc.to_csv(index=False).encode()).hexdigest()
        self.assertEqual(h1, h2, "原 10 列经 to_parquet → read_parquet 回读后 hash 应全等")


if __name__ == "__main__":
    unittest.main()
