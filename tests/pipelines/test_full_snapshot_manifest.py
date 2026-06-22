import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
import sys

if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.full_snapshot_manifest import fingerprint, write_manifest


class FullSnapshotManifestTest(unittest.TestCase):
    def test_customer_flow_full_snapshot_contract(self):
        cfg = json.loads((ROOT / "数据管理/data-sources.json").read_text())
        domain = next(d for d in cfg["domains"] if d["id"] == "customer_flow")
        trigger = domain["trigger"]

        self.assertEqual(trigger["input_strategy"], "full_snapshot")
        self.assertEqual(trigger["snapshot_mode"], "full_batch_replace")
        self.assertTrue(trigger["required_same_batch"])
        self.assertEqual(
            trigger["input_globs"],
            [
                "????????_08_商业险续保流失公司.xlsx",
                "????????_09_商业险转保上年公司.xlsx",
            ],
        )
        self.assertGreaterEqual(trigger["validation"]["min_rows"], 180000)
        self.assertEqual(trigger["validation"]["min_date"], "2025-01-01")
        self.assertGreaterEqual(trigger["validation"]["require_non_null"]["previous_insurer"], 1)
        self.assertGreaterEqual(trigger["validation"]["require_non_null"]["next_insurer"], 1)

    def test_new_energy_claims_full_snapshot_contract(self):
        cfg = json.loads((ROOT / "数据管理/data-sources.json").read_text())
        domain = next(d for d in cfg["domains"] if d["id"] == "new_energy_claims")
        trigger = domain["trigger"]

        self.assertEqual(trigger["input_strategy"], "full_snapshot")
        self.assertEqual(trigger["snapshot_mode"], "full_batch_replace")
        self.assertTrue(trigger["required_same_batch"])
        self.assertEqual(trigger["input_globs"], ["????????_新能源_出险信息表.xlsx"])
        self.assertEqual(trigger["validation"]["date_column"], "report_time")
        self.assertGreaterEqual(trigger["validation"]["require_non_null"]["claim_no"], 1)

    def test_source_manifest_fingerprint_is_content_based(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            source = tmpdir / "20260524_新能源_出险信息表.xlsx"
            source.write_bytes(b"snapshot-content")
            manifest = tmpdir / "source-manifest.json"

            fp = fingerprint(source)
            write_manifest(manifest, "20260524", "new_energy_claims", [source])
            payload = json.loads(manifest.read_text())

        self.assertEqual(fp.sha256, payload["sources"][0]["sha256"])
        self.assertEqual(payload["batch_date"], "20260524")
        self.assertEqual(payload["domain_id"], "new_energy_claims")

    def test_raw_archive_handles_same_name_reexports(self):
        daily_source = (ROOT / "数据管理/daily.mjs").read_text()

        self.assertIn("archived_path", daily_source)
        self.assertIn("sha256File(dest) !== file.sha256", daily_source)
        self.assertIn("sha256.slice(0, 12)", daily_source)

    def test_cache_key_includes_shared_pipeline_dependencies(self):
        # 缓存键逻辑已抽到 lib/full-snapshot-cache-key.mjs（daily.mjs 顶层执行 main() 无法 import 单测）。
        cache_key_source = (DATA_ROOT / "lib/full-snapshot-cache-key.mjs").read_text()

        self.assertIn("fullSnapshotDependencyPaths", cache_key_source)
        self.assertIn("base_converter.py", cache_key_source)
        self.assertIn("etl_validation.py", cache_key_source)
        self.assertIn("parquet_utils.py", cache_key_source)

        # daily.mjs 须从 lib 导入并使用缓存键函数（接线未断）
        daily_source = (ROOT / "数据管理/daily.mjs").read_text()
        self.assertIn("buildFullSnapshotCacheKey", daily_source)
        self.assertIn("lib/full-snapshot-cache-key.mjs", daily_source)

    def test_cache_key_covers_policy_dir_content_and_extra_args(self):
        # PR #732 codex 发现：缓存键漏掉 --policy-dir 指向的 policy/current 内容指纹与 extraArgs，
        # 导致 new_energy_claims 在 policy 变化但 xlsx/batchDate 不变时命中陈旧快照。
        cache_key_source = (DATA_ROOT / "lib/full-snapshot-cache-key.mjs").read_text()
        self.assertIn("parsePolicyDir", cache_key_source)
        self.assertIn("collectPolicyInputFingerprints", cache_key_source)
        self.assertIn("policyInputs", cache_key_source)
        self.assertIn("--policy-dir", cache_key_source)

        # daily.mjs 调用处须把 extraArgs（含 --policy-dir）透传进缓存键
        daily_source = (ROOT / "数据管理/daily.mjs").read_text()
        self.assertIn("buildFullSnapshotCacheKey({ id, batchDate, sourceFingerprints, scriptPath, trigger, extraArgs })", daily_source)

    def test_full_snapshot_retention_is_enforced(self):
        daily_source = (ROOT / "数据管理/daily.mjs").read_text()

        self.assertIn("pruneFullSnapshotHistory", daily_source)
        self.assertIn("snapshot_retention_batches", daily_source)
        self.assertIn("source_retention_days", daily_source)


if __name__ == "__main__":
    unittest.main()
