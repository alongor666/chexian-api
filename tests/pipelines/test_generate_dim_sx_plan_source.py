"""SX organization plan source validation tests."""
import sys
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa

ROOT = Path(__file__).resolve().parents[2]
DIM_DIR = ROOT / "数据管理" / "warehouse" / "dim"
if str(DIM_DIR) not in sys.path:
    sys.path.insert(0, str(DIM_DIR))

from generate_dim_tables import build_sx_plan_from_local_source  # noqa: E402


class BuildSxPlanFromLocalSourceTest(unittest.TestCase):
    def _write_csv(self, text: str) -> Path:
        tmp = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".csv", delete=False)
        with tmp:
            tmp.write(text)
        return Path(tmp.name)

    def test_empty_source_fails_closed(self):
        path = self._write_csv("organization,plan_vehicle\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源为空"):
            build_sx_plan_from_local_source(path)

    def test_non_numeric_plan_vehicle_has_domain_error(self):
        path = self._write_csv("organization,plan_vehicle\n太原一部,not-a-number\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源存在非数值 plan_vehicle"):
            build_sx_plan_from_local_source(path)

    def test_missing_candidate_is_partial_and_does_not_fail(self):
        path = self._write_csv("organization,plan_vehicle\n太原一部,1234\n")
        out = build_sx_plan_from_local_source(path)
        contract = out.attrs["plan_contract"]
        self.assertEqual(contract["status"], "partial")
        self.assertIn("太原二部", contract["missing_orgs"])
        self.assertEqual(contract["excluded_units"], ["经代", "车商", "重客"])
        self.assertNotIn("其他", contract["eligible_orgs"])

    def test_unknown_org_fails_closed(self):
        path = self._write_csv("organization,plan_vehicle\n不存在机构,1\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源存在非候选机构"):
            build_sx_plan_from_local_source(path)

    def test_duplicate_org_fails_closed(self):
        path = self._write_csv("organization,plan_vehicle\n太原一部,1\n太原一部,2\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源存在重复三级机构"):
            build_sx_plan_from_local_source(path)

    def test_negative_and_non_finite_values_fail_closed(self):
        negative = self._write_csv("organization,plan_vehicle\n太原一部,-1\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源存在负计划值"):
            build_sx_plan_from_local_source(negative)
        infinite = self._write_csv("organization,plan_vehicle\n太原一部,inf\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源存在非有限 plan_vehicle"):
            build_sx_plan_from_local_source(infinite)

    def test_schema_drift_fails_closed(self):
        path = self._write_csv("organization,plan_vehicle,extra\n太原一部,1,x\n")
        with self.assertRaisesRegex(ValueError, "SX 计划源字段不符合契约"):
            build_sx_plan_from_local_source(path)

    def test_valid_source_builds_organization_plan_rows(self):
        path = self._write_csv("organization,plan_vehicle\n太原一部,1234\n")
        out = build_sx_plan_from_local_source(path, plan_year=2026)
        self.assertEqual(len(out), 1)
        self.assertEqual(out.loc[0, "level"], "organization")
        self.assertEqual(out.loc[0, "organization"], "太原一部")
        self.assertEqual(float(out.loc[0, "plan_vehicle"]), 1234.0)
        schema = pa.Table.from_pandas(out, preserve_index=False).schema
        self.assertTrue(pa.types.is_string(schema.field("business_no").type) or pa.types.is_large_string(schema.field("business_no").type))
        self.assertTrue(pa.types.is_string(schema.field("full_name").type) or pa.types.is_large_string(schema.field("full_name").type))
        self.assertTrue(pa.types.is_string(schema.field("team").type) or pa.types.is_large_string(schema.field("team").type))
        self.assertTrue(pa.types.is_float64(schema.field("plan_vehicle").type))
        self.assertTrue(pa.types.is_float64(schema.field("actual_vehicle").type))
        self.assertTrue(pa.types.is_int64(schema.field("plan_year").type))


if __name__ == "__main__":
    unittest.main()
