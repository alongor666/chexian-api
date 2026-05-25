import tempfile
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
import sys

if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.convert_new_energy_claims import build_new_energy_claims_dataframe


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


if __name__ == "__main__":
    unittest.main()
