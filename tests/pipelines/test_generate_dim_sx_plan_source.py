"""SX organization plan source validation tests."""
import sys
import tempfile
import unittest
from pathlib import Path

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

    def test_valid_source_builds_organization_plan_rows(self):
        path = self._write_csv("organization,plan_vehicle\n太原一部,1234\n")
        out = build_sx_plan_from_local_source(path, plan_year=2026)
        self.assertEqual(len(out), 1)
        self.assertEqual(out.loc[0, "level"], "organization")
        self.assertEqual(out.loc[0, "organization"], "太原一部")
        self.assertEqual(float(out.loc[0, "plan_vehicle"]), 1234.0)


if __name__ == "__main__":
    unittest.main()
