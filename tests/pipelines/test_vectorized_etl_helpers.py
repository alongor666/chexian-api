import unittest
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.convert_claims_detail import derive_subject_shop_code, extract_policy_year_series
from pipelines.quote_etl import split_salesman_columns


class VectorizedEtlHelpersTest(unittest.TestCase):
    def test_split_salesman_columns_matches_legacy_cases(self):
        raw = pd.Series(["110031100周凡丁", "张三", None, " 200012345李四 "])

        salesman_no, salesman_name = split_salesman_columns(raw)

        self.assertEqual(salesman_no.tolist(), ["110031100", "", "", "200012345"])
        self.assertEqual(salesman_name.tolist(), ["周凡丁", "张三", "", "李四"])

    def test_extract_policy_year_series_uses_policy_no_positions(self):
        raw = pd.Series(["ABCDEF123452026XYZ", "short", None, "ABCDEF123452031XYZ"])

        years = extract_policy_year_series(raw)

        self.assertEqual(years.tolist(), [2026, None, None, None])

    def test_derive_subject_shop_code_keeps_first_eight_chars(self):
        raw = pd.Series(["12345678维修厂", "1234567", None, " 87654321门店 "])

        codes = derive_subject_shop_code(raw)

        self.assertEqual(codes.tolist(), ["12345678", None, None, "87654321"])


if __name__ == "__main__":
    unittest.main()
