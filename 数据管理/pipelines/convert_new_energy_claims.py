#!/usr/bin/env python3
"""新能源出险信息表 Excel → new_energy_claims/latest.parquet."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.etl_validation import PLACEHOLDER_STRS, load_excel_all_sheets, verify_non_empty
from pipelines.parquet_utils import write_parquet_with_metadata


OUTPUT_COLUMNS = [
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
]

CN_TO_EN = {
    "报案时间": "report_time",
    "报案号": "claim_no",
    "保单号": "policy_no",
    "车架号": "vehicle_frame_no",
    "车牌号": "plate_no",
    "标的车牌": "plate_no",
    "三级机构": "org_level_3",
    "整案是否结案": "claim_status",
    "分险种案件状态": "claim_status_detail",
    "业务结案赔款": "settled_amount",
    "业务结案金额": "settled_amount",
    "立案金额rmb": "reserve_amount",
    "立案金额": "reserve_amount",
}

REQUIRED_COLUMNS = ["报案时间", "报案号"]
STR_FORCE_COLS = {"报案号": str, "保单号": str, "车架号": str, "车牌号": str, "标的车牌": str}


def extract_batch_date(path: Path) -> str | None:
    match = re.match(r"^(\d{8})_", path.name)
    return match.group(1) if match else None


def normalize_claim_status(value: object) -> object:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if text in PLACEHOLDER_STRS:
        return None
    if text == "是":
        return "已业务结案"
    if text == "否":
        return "未业务结案"
    return text


def coalesce_duplicate_columns(df: pd.DataFrame) -> pd.DataFrame:
    """rename 后同一英文列可能来自多个中文金额列，取每行第一个非空值。"""
    result = pd.DataFrame(index=df.index)
    for col in dict.fromkeys(df.columns):
        same = df.loc[:, df.columns == col]
        if same.shape[1] == 1:
            result[col] = same.iloc[:, 0]
        else:
            result[col] = same.bfill(axis=1).iloc[:, 0]
    return result


def build_new_energy_claims_dataframe(input_files: list[Path]) -> pd.DataFrame:
    frames = []
    for input_file in input_files:
        raw = load_excel_all_sheets(
            input_file,
            dtype=STR_FORCE_COLS,
            required_columns=REQUIRED_COLUMNS,
        ).copy()
        raw.columns = raw.columns.str.strip()
        missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
        if missing:
            raise ValueError(f"{input_file.name} 缺少必须列: {missing}; 实际列: {list(raw.columns)}")

        rename_map = {k: v for k, v in CN_TO_EN.items() if k in raw.columns}
        df = raw.rename(columns=rename_map)
        df = coalesce_duplicate_columns(df)
        df = df[[c for c in df.columns if c in set(CN_TO_EN.values())]].copy()
        for col in OUTPUT_COLUMNS:
            if col not in df.columns:
                df[col] = pd.NA

        df["report_time"] = pd.to_datetime(df["report_time"], errors="coerce")
        df["claim_no"] = df["claim_no"].astype("string").str.strip().replace(PLACEHOLDER_STRS, None)
        for col in ("policy_no", "vehicle_frame_no", "plate_no", "org_level_3"):
            df[col] = df[col].astype("string").str.strip().replace(PLACEHOLDER_STRS, None)
        df["claim_status"] = df["claim_status"].map(normalize_claim_status)
        df["settled_amount"] = pd.to_numeric(df["settled_amount"], errors="coerce")
        df["reserve_amount"] = pd.to_numeric(df["reserve_amount"], errors="coerce")
        df["source_batch_date"] = extract_batch_date(input_file)
        frames.append(df[OUTPUT_COLUMNS])
        print(f"   产物: {input_file.name} → {len(df):,} 行 × {len(OUTPUT_COLUMNS)} 列")

    if not frames:
        raise ValueError("未提供新能源出险输入文件")

    df = pd.concat(frames, ignore_index=True)
    before = len(df)
    df = df[df["report_time"].notna()].copy()
    if len(df) < before:
        print(f"   过滤无 report_time: {before - len(df):,} 行")

    before = len(df)
    has_business_key = df["claim_no"].notna() | df["policy_no"].notna()
    df = df[has_business_key].copy()
    if len(df) < before:
        print(f"   过滤无 claim_no/policy_no: {before - len(df):,} 行")

    df = df.drop_duplicates(subset=["claim_no", "policy_no", "report_time"], keep="last")
    return df[OUTPUT_COLUMNS].sort_values(["report_time", "claim_no"]).reset_index(drop=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="新能源出险信息表 → Parquet")
    parser.add_argument("-i", "--input", nargs="+", required=True, help="输入 Excel 文件")
    parser.add_argument("-o", "--output", required=True, help="输出 Parquet 文件")
    parser.add_argument("--no-metadata", action="store_true", help="兼容 daily.mjs manifest 流程")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_files = [Path(p).resolve() for p in args.input]
    output_file = Path(args.output).resolve()

    print("=" * 80)
    print("📋 新能源出险信息表 → Parquet")
    print("=" * 80)
    for input_file in input_files:
        print(f"   输入: {input_file.name}")

    df = build_new_energy_claims_dataframe(input_files)
    print("\n   === 数据概览 ===")
    print(f"   记录数: {len(df):,}")
    print(f"   唯一报案/赔案号: {df['claim_no'].nunique():,}")
    print(f"   报案时间: {df['report_time'].min()} ~ {df['report_time'].max()}")
    print(f"   立案金额合计: {df['reserve_amount'].sum(skipna=True):,.2f}")

    write_parquet_with_metadata(
        df,
        output_file,
        source_file=", ".join(str(p) for p in input_files),
        processing_mode="convert_new_energy_claims",
    )
    verify = pd.read_parquet(output_file)
    verify_non_empty(verify)
    print(f"\n   输出: {output_file} ({output_file.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")
    print("=" * 80)
    print("✅ 完成")


if __name__ == "__main__":
    main()
