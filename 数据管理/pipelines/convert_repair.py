#!/usr/bin/env python3
"""
维修资源 Excel → dim/repair/latest.parquet

维修厂合作数据：合作状态、核损金额、换件折扣率、签单净保费。

用法：
  python3 convert_repair.py -i 07_维修资源.xlsx -o warehouse/dim/repair/latest.parquet
"""

import sys
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.base_converter import BaseConverter
from pipelines.etl_validation import PLACEHOLDER_STRS, safe_pct, to_bool


class RepairConverter(BaseConverter):
    def get_domain_id(self) -> str:
        return "repair_resource"

    def get_title(self) -> str:
        return "维修资源 → Parquet"

    def get_cn_to_en(self) -> dict:
        return {
            "统计时间": "report_date",
            "修理厂归属中支": "org_level_3",
            "当天合作状态": "cooperation_status",
            "渠道类型": "channel_type",
            "修理厂名称": "repair_shop_name",
            "是否4S店": "is_4s_shop",
            "修理厂所在省": "province",
            "修理厂所在市": "city",
            "修理厂所在区": "district",
            "核损金额": "damage_assessment_amount",
            "换件折扣率": "parts_discount_rate",
            "签单净保费": "net_premium",
        }

    def get_required_columns(self) -> list:
        return ["修理厂名称"]

    def get_str_force_cols(self) -> dict:
        return {}

    def get_required_non_null_cols(self) -> list:
        return ["repair_shop_name"]

    def transform_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        if "report_date" in df.columns:
            df["report_date"] = pd.to_datetime(df["report_date"], errors="coerce")
            valid = int(df["report_date"].notna().sum())
            print(
                f"   统计时间: {df['report_date'].min()} ~ {df['report_date'].max()}"
                f" ({valid:,} 有值)"
            )
        if "is_4s_shop" in df.columns:
            df["is_4s_shop"] = df["is_4s_shop"].astype(str).str.strip().map(to_bool)
            n = int(df["is_4s_shop"].sum())
            print(f"   4S店: {n:,}/{len(df):,} ({safe_pct(n, len(df)):.1f}%)")
        for col in ("damage_assessment_amount", "net_premium", "parts_discount_rate"):
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        for col in ("repair_shop_name", "cooperation_status", "channel_type",
                    "province", "city", "district"):
            if col in df.columns:
                df[col] = df[col].astype(str).str.strip().replace(PLACEHOLDER_STRS, None)
        # 派生：shop_code 前 8 位编码（.claude/shared-memory/repair_source_field_mapping.md §1.1）
        if "repair_shop_name" in df.columns:
            df["shop_code"] = df["repair_shop_name"].apply(
                lambda s: s[:8] if pd.notna(s) and isinstance(s, str) and len(s) >= 8 else None
            )
            uniq_shops = df["repair_shop_name"].nunique()
            uniq_codes = df["shop_code"].nunique()
            print(f"   shop_code 编码: 网点 {uniq_shops:,} → 编码 {uniq_codes:,}（差异 {uniq_shops - uniq_codes} 表示同编码多名称）")
        return df

    def post_write_hook(self, df: pd.DataFrame, output_file: Path) -> None:
        print("\n   === 数据概览 ===")
        print(f"   记录数: {len(df):,}")
        print(f"   修理厂数: {df['repair_shop_name'].nunique():,}")
        if "org_level_3" in df.columns:
            print(f"   机构数: {df['org_level_3'].nunique()}")
        if "cooperation_status" in df.columns:
            print(f"   合作状态: {df['cooperation_status'].value_counts().to_dict()}")
        if "damage_assessment_amount" in df.columns:
            print(f"   核损金额合计: {df['damage_assessment_amount'].sum() / 1e4:,.0f} 万元")


if __name__ == "__main__":
    RepairConverter().run()
