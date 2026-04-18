#!/usr/bin/env python3
"""
厂牌明细 Excel → dim/brand/latest.parquet

品牌维度表：车辆型号 → 品牌/车系/分类映射，供分析按品牌维度下钻。

用法：
  python3 convert_brand_dim.py -i 06_厂牌明细.xlsx -o warehouse/dim/brand/latest.parquet
"""

import sys
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.base_converter import BaseConverter
from pipelines.etl_validation import PLACEHOLDER_STRS


class BrandDimConverter(BaseConverter):
    def get_domain_id(self) -> str:
        return "brand"

    def get_title(self) -> str:
        return "厂牌明细 → Parquet (品牌维度表)"

    def get_cn_to_en(self) -> dict:
        return {
            "生产厂家": "manufacturer",
            "车辆型号（上传平台）": "vehicle_model_code",
            "厂牌车型名称": "vehicle_model_name",
            "品牌": "brand",
            "年款": "model_year",
            "车系名称": "series_name",
            "新车型分类名称": "vehicle_class",
            "车船税减免标识": "tax_exempt_flag",
            "吨位数": "tonnage_value",
            "整备质量": "curb_weight",
            "座位数": "seat_count",
            "风险类型": "risk_type",
            "车辆类型": "vehicle_origin",
            "有无abs": "has_abs",
            "变速器类型": "transmission_type",
        }

    def get_required_columns(self) -> list:
        return ["厂牌车型名称"]

    def get_str_force_cols(self) -> dict:
        return {}

    def get_dedup_key(self):
        return "vehicle_model_code"

    def transform_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        for col in ("tonnage_value", "curb_weight", "seat_count"):
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        for col in ("vehicle_model_code", "vehicle_model_name", "brand",
                    "series_name", "manufacturer"):
            if col in df.columns:
                df[col] = df[col].astype(str).str.strip().replace(PLACEHOLDER_STRS, None)
        return df

    def post_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        print("\n   === 数据概览 ===")
        print(f"   车型数: {len(df):,}")
        if "brand" in df.columns:
            print(f"   品牌数: {df['brand'].nunique()}")
            print(f"   TOP10 品牌: {df['brand'].value_counts().head(10).to_dict()}")
        if "vehicle_class" in df.columns:
            print(f"   车型分类: {df['vehicle_class'].value_counts().to_dict()}")


if __name__ == "__main__":
    BrandDimConverter().run()
