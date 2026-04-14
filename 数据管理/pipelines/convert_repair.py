#!/usr/bin/env python3
"""
维修资源 Excel → dim/repair/latest.parquet

维修厂合作数据：合作状态、核损金额、换件折扣率、签单净保费。

用法：
  python3 convert_repair.py -i 07_维修资源.xlsx -o warehouse/dim/repair/latest.parquet
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
    '统计时间': 'report_date',
    '修理厂归属中支': 'org_level_3',
    '当天合作状态': 'cooperation_status',
    '渠道类型': 'channel_type',
    '修理厂名称': 'repair_shop_name',
    '是否4S店': 'is_4s_shop',
    '修理厂所在省': 'province',
    '修理厂所在市': 'city',
    '修理厂所在区': 'district',
    '核损金额': 'damage_assessment_amount',
    '换件折扣率': 'parts_discount_rate',
    '签单净保费': 'net_premium',
}

REQUIRED_COLUMNS = ['修理厂名称']


def parse_args():
    parser = argparse.ArgumentParser(description='维修资源 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 维修资源 → Parquet")
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

    # 统计时间
    if 'report_date' in df.columns:
        df['report_date'] = pd.to_datetime(df['report_date'], errors='coerce')
        valid = df['report_date'].notna().sum()
        print(f"   统计时间: {df['report_date'].min()} ~ {df['report_date'].max()} ({valid:,} 有值)")

    # 是否4S店 → BOOLEAN
    if 'is_4s_shop' in df.columns:
        df['is_4s_shop'] = df['is_4s_shop'].astype(str).str.strip().map(to_bool)
        count_4s = df['is_4s_shop'].sum()
        print(f"   4S店: {count_4s:,}/{len(df):,} ({safe_pct(count_4s, len(df)):.1f}%)")

    # 金额字段 → DOUBLE
    for col in ['damage_assessment_amount', 'net_premium']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # 折扣率 → DOUBLE
    if 'parts_discount_rate' in df.columns:
        df['parts_discount_rate'] = pd.to_numeric(df['parts_discount_rate'], errors='coerce')

    # 字符串标准化
    for col in ['repair_shop_name', 'cooperation_status', 'channel_type', 'province', 'city', 'district']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace(PLACEHOLDER_STRS, None)

    # ── 过滤无效行 ──
    before = len(df)
    df = df[df['repair_shop_name'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无名称: {before - len(df):,} 行")

    # ── 统计 ──
    print(f"\n   === 数据概览 ===")
    print(f"   记录数: {len(df):,}")
    print(f"   修理厂数: {df['repair_shop_name'].nunique():,}")
    if 'org_level_3' in df.columns:
        print(f"   机构数: {df['org_level_3'].nunique()}")
    if 'cooperation_status' in df.columns:
        print(f"   合作状态: {df['cooperation_status'].value_counts().to_dict()}")
    if 'damage_assessment_amount' in df.columns:
        total = df['damage_assessment_amount'].sum()
        print(f"   核损金额合计: {total/1e4:,.0f} 万元")

    # ── 输出 Parquet ──
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_repair",
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
