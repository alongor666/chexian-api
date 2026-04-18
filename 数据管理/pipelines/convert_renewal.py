#!/usr/bin/env python3
"""
续保清单（套单）Excel → renewal/latest.parquet

续保跟踪数据：每行 = 一个应续保单，标记是否已续保。

用法：
  python3 convert_renewal.py -i 05_续保清单_套单.xlsx -o warehouse/fact/renewal/latest.parquet
"""

import sys
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.base_converter import BaseConverter
from pipelines.etl_validation import PLACEHOLDER_STRS, safe_pct


class RenewalConverter(BaseConverter):
    def get_domain_id(self) -> str:
        return "renewal_v2"

    def get_title(self) -> str:
        return "续保清单（套单）→ Parquet"

    def get_cn_to_en(self) -> dict:
        return {
            "应续保单号": "source_policy_no",
            "车架号": "vehicle_frame_no",
            "三级机构": "org_level_3",
            "业务员": "salesman_name",
            "起保日": "insurance_start_date",
            "到期日": "insurance_end_date",
            "到期月": "expiry_month",
            "报价时间": "quote_time",
            "已续保单号": "renewed_policy_no",
        }

    def get_required_columns(self) -> list:
        return ["应续保单号"]

    def get_str_force_cols(self) -> dict:
        return {"应续保单号": str, "车架号": str, "已续保单号": str}

    def get_required_non_null_cols(self) -> list:
        return ["source_policy_no"]

    def transform_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        for col in ("insurance_start_date", "insurance_end_date", "quote_time"):
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce")
        if "insurance_end_date" in df.columns:
            valid = int(df["insurance_end_date"].notna().sum())
            print(
                f"   到期日: {df['insurance_end_date'].min()} ~ {df['insurance_end_date'].max()}"
                f" ({valid:,} 有值)"
            )
        for col in ("source_policy_no", "vehicle_frame_no", "renewed_policy_no"):
            if col in df.columns:
                df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)
        if "renewed_policy_no" in df.columns:
            df["is_renewed"] = df["renewed_policy_no"].notna()
            n = int(df["is_renewed"].sum())
            print(f"   已续保: {n:,}/{len(df):,} ({safe_pct(n, len(df)):.1f}%)")
        return df

    def post_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        print("\n   === 数据概览 ===")
        print(f"   记录数: {len(df):,}")
        if "org_level_3" in df.columns:
            print(f"   机构数: {df['org_level_3'].nunique()}")
        if "expiry_month" in df.columns:
            print(f"   到期月分布: {df['expiry_month'].value_counts().head(5).to_dict()}")


if __name__ == "__main__":
    RenewalConverter().run()
