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


if __name__ == "__main__":
    unittest.main()
