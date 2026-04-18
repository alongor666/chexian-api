#!/usr/bin/env python3
"""
交叉销售清单 Excel → cross_sell/latest.parquet

独立交叉销售数据（从签单清单中移出），每行 = 一个保单的驾意险交叉销售记录。

用法：
  python3 convert_cross_sell.py -i 03_交叉销售_家自车_23年至今.xlsx -o warehouse/fact/cross_sell/latest.parquet
"""

import sys
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.base_converter import BaseConverter
from pipelines.etl_validation import PLACEHOLDER_STRS, safe_pct, to_bool


class CrossSellConverter(BaseConverter):
    def get_domain_id(self) -> str:
        return "cross_sell"

    def get_title(self) -> str:
        return "交叉销售清单 → Parquet"

    def get_cn_to_en(self) -> dict:
        return {
            "三级机构": "org_level_3",
            "业务员": "salesman_name",
            "保单号": "policy_no",
            "签单日期": "policy_date",
            "车架号": "vehicle_frame_no",
            "客户类别3": "customer_category",
            "险别": "coverage_combination",
            "交叉销售标识-驾意": "is_cross_sell",
            "交叉销售保费-驾意": "cross_sell_premium_driver",
        }

    def get_required_columns(self) -> list:
        return ["保单号", "交叉销售标识-驾意"]

    def get_str_force_cols(self) -> dict:
        return {"保单号": str, "车架号": str}

    def get_dedup_key(self):
        return "policy_no"

    def transform_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        if "policy_date" in df.columns:
            df["policy_date"] = pd.to_datetime(df["policy_date"], errors="coerce")
            print(f"   签单日期: {df['policy_date'].min()} ~ {df['policy_date'].max()}")
        if "is_cross_sell" in df.columns:
            df["is_cross_sell"] = df["is_cross_sell"].astype(str).str.strip().map(to_bool)
            n = int(df["is_cross_sell"].sum())
            print(f"   交叉销售: {n:,}/{len(df):,} ({safe_pct(n, len(df)):.1f}%)")
        if "cross_sell_premium_driver" in df.columns:
            df["cross_sell_premium_driver"] = pd.to_numeric(
                df["cross_sell_premium_driver"], errors="coerce"
            ).fillna(0.0)
        for col in ("policy_no", "vehicle_frame_no"):
            if col in df.columns:
                df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)
        return df

    def post_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        print("\n   === 数据概览 ===")
        print(f"   记录数: {len(df):,}")
        print(f"   唯一保单: {df['policy_no'].nunique():,}")
        if "is_cross_sell" in df.columns:
            print(f"   有驾意险: {int(df['is_cross_sell'].sum()):,}")
        if "cross_sell_premium_driver" in df.columns:
            print(f"   驾意险保费合计: {df['cross_sell_premium_driver'].sum():,.0f} 元")


if __name__ == "__main__":
    CrossSellConverter().run()
