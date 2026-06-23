import tempfile
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
import sys

if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.convert_customer_flow import build_customer_flow_dataframe


class CustomerFlowSplitProductsTest(unittest.TestCase):
    def test_coalesces_loss_and_prior_company_products(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            loss_file = tmpdir / "20260523_08_商业险续保流失公司.xlsx"
            prior_file = tmpdir / "20260523_09_商业险转保上年公司.xlsx"

            # 多省 P3-B：policy_no 必须 '610...' 前缀以便 branch_code 派生通过
            #   strict_non_null/assertDeclaredBranch 守卫（SC 默认 declared_branch='SC'）。
            #   早先固定串 'P1'/'P2'/'P3' 在 prefix_map 派生下会 NULL→fail-fast，故改为模拟生产前缀。
            P1 = "61020260100000001"
            P2 = "61020250100000002"
            P3 = "61020260100000003"
            pd.DataFrame(
                [
                    {
                        "保单号": P1,
                        "保险起期": "2026-01-01",
                        "车架号": "VIN1",
                        "次年保险公司": "中国平安财产保险股份有限公司",
                    },
                    {
                        "保单号": P2,
                        "保险起期": "2025-01-02",
                        "车架号": "VIN2",
                        "次年保险公司": "",
                    },
                ]
            ).to_excel(loss_file, index=False)
            pd.DataFrame(
                [
                    {
                        "车架号": "VIN1",
                        "保单号": P1,
                        "保险起期": "2026-01-01",
                        "保险止期": "2026-12-31",
                        "上年承保主体": "中国人民财产保险股份有限公司",
                    },
                    {
                        "车架号": "VIN3",
                        "保单号": P3,
                        "保险起期": "2026-01-03",
                        "保险止期": "2027-01-02",
                        "上年承保主体": "中国太平洋财产保险股份有限公司",
                    },
                ]
            ).to_excel(prior_file, index=False)

            df = build_customer_flow_dataframe([loss_file, prior_file])

        self.assertEqual(len(df), 3)
        # 多省 P3-B：build_customer_flow_dataframe 在 final snapshot 之前派生 branch_code
        # → 6 列含 branch_code；08/09 part snapshot 保持源 5 列（不参与本断言）。
        self.assertEqual(
            list(df.columns),
            [
                "policy_no",
                "insurance_start_date",
                "vehicle_frame_no",
                "previous_insurer",
                "next_insurer",
                "branch_code",
            ],
        )
        # 全 SC 派生（policy_no 全 610... 前缀；映射 fields.json branch_code:610→SC）
        self.assertTrue((df["branch_code"] == "SC").all())

        p1 = df[df["policy_no"] == P1].iloc[0]
        self.assertEqual(p1["vehicle_frame_no"], "VIN1")
        self.assertEqual(p1["previous_insurer"], "中国人民财产保险股份有限公司")
        self.assertEqual(p1["next_insurer"], "中国平安财产保险股份有限公司")

        p2 = df[df["policy_no"] == P2].iloc[0]
        self.assertTrue(pd.isna(p2["previous_insurer"]))
        self.assertTrue(pd.isna(p2["next_insurer"]))


if __name__ == "__main__":
    unittest.main()
