#!/usr/bin/env python3
"""
厂牌明细 Excel → dim/brand/latest.parquet

品牌维度表：车辆型号 → 品牌/车系/分类映射，供分析按品牌维度下钻。

用法：
  python3 convert_brand_dim.py -i 06_厂牌明细.xlsx -o warehouse/dim/brand/latest.parquet
"""

import argparse
import sys
import pandas as pd
from pathlib import Path

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

# ── 字段映射：中文 → 英文 snake_case ──

CN_TO_EN = {
    '生产厂家': 'manufacturer',
    '车辆型号（上传平台）': 'vehicle_model_code',
    '厂牌车型名称': 'vehicle_model_name',
    '品牌': 'brand',
    '年款': 'model_year',
    '车系名称': 'series_name',
    '新车型分类名称': 'vehicle_class',
    '车船税减免标识': 'tax_exempt_flag',
    '吨位数': 'tonnage_value',
    '整备质量': 'curb_weight',
    '座位数': 'seat_count',
    '风险类型': 'risk_type',
    '车辆类型': 'vehicle_origin',
    '有无abs': 'has_abs',
    '变速器类型': 'transmission_type',
}

REQUIRED_COLUMNS = ['厂牌车型名称']


def parse_args():
    parser = argparse.ArgumentParser(description='厂牌明细 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 厂牌明细 → Parquet (品牌维度表)")
    print(f"{'='*80}")
    print(f"   输入: {input_file.name}")

    from pipelines.etl_validation import validate_input_path, validate_output_path, verify_non_empty, safe_pct, to_bool, PLACEHOLDER_STRS
    input_file = validate_input_path(str(input_file))
    output_file = validate_output_path(str(output_file))

    # ── 加载（自动合并多 sheet）──
    from pipelines.etl_validation import load_excel_all_sheets
    df = load_excel_all_sheets(input_file, required_columns=REQUIRED_COLUMNS)

    # ── Schema 契约 ──
    df.columns = df.columns.str.strip()
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        print(f"   ❌ 缺少必须列: {missing}")
        print(f"      实际列: {list(df.columns)}")
        sys.exit(1)

    # ── 列名重命名 ──
    rename_cols = {k: v for k, v in CN_TO_EN.items() if k in df.columns}
    df = df.rename(columns=rename_cols)
    extra_cols = [c for c in df.columns if c not in CN_TO_EN.values()]
    if extra_cols:
        print(f"   ⚠ 未映射列（已丢弃）: {extra_cols}")
        df = df[[c for c in df.columns if c in CN_TO_EN.values()]]
    print(f"   列名重命名: {len(rename_cols)}/{len(CN_TO_EN)} 列")

    # ── 类型转换 ──

    # 数值字段
    for col in ['tonnage_value', 'curb_weight', 'seat_count']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # 字符串标准化
    for col in ['vehicle_model_code', 'vehicle_model_name', 'brand', 'series_name', 'manufacturer']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace(PLACEHOLDER_STRS, None)

    # ── 去重：按 vehicle_model_code（厂牌编码唯一） ──
    if 'vehicle_model_code' in df.columns:
        before = len(df)
        df = df.drop_duplicates(subset=['vehicle_model_code'], keep='first')
        if len(df) < before:
            print(f"   去重: {before - len(df):,} 行（按 vehicle_model_code）")

    # ── 统计 ──
    print(f"\n   === 数据概览 ===")
    print(f"   车型数: {len(df):,}")
    if 'brand' in df.columns:
        print(f"   品牌数: {df['brand'].nunique()}")
        top_brands = df['brand'].value_counts().head(10)
        print(f"   TOP10 品牌: {top_brands.to_dict()}")
    if 'vehicle_class' in df.columns:
        print(f"   车型分类: {df['vehicle_class'].value_counts().to_dict()}")

    # ── 输出 Parquet ──
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_brand_dim",
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

    # ── 验证 ──
    verify = pd.read_parquet(output_file)
    verify_non_empty(verify)
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")

    print(f"{'='*80}")
    print(f"✅ 完成")


if __name__ == '__main__':
    main()
