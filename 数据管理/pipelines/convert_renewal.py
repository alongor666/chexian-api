#!/usr/bin/env python3
"""
续保清单（套单）Excel → renewal/latest.parquet

续保跟踪数据：每行 = 一个应续保单，标记是否已续保。

用法：
  python3 convert_renewal.py -i 05_续保清单_套单.xlsx -o warehouse/fact/renewal/latest.parquet
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
    '应续保单号': 'source_policy_no',
    '车架号': 'vehicle_frame_no',
    '三级机构': 'org_level_3',
    '业务员': 'salesman_name',
    '起保日': 'insurance_start_date',
    '到期日': 'insurance_end_date',
    '到期月': 'expiry_month',
    '报价时间': 'quote_time',
    '已续保单号': 'renewed_policy_no',
}

REQUIRED_COLUMNS = ['应续保单号']
STR_FORCE_COLS = {'应续保单号': str, '车架号': str, '已续保单号': str}


def parse_args():
    parser = argparse.ArgumentParser(description='续保清单 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 续保清单（套单）→ Parquet")
    print(f"{'='*80}")
    print(f"   输入: {input_file.name}")

    from pipelines.etl_validation import validate_input_path, validate_output_path, verify_non_empty, safe_pct, to_bool, PLACEHOLDER_STRS
    input_file = validate_input_path(str(input_file))
    output_file = validate_output_path(str(output_file))

    # ── 加载 ──
    df = pd.read_excel(input_file, dtype=STR_FORCE_COLS)
    print(f"   加载: {len(df):,} 行 × {len(df.columns)} 列")

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

    # 日期字段
    for col in ['insurance_start_date', 'insurance_end_date', 'quote_time']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')

    if 'insurance_end_date' in df.columns:
        valid = df['insurance_end_date'].notna().sum()
        print(f"   到期日: {df['insurance_end_date'].min()} ~ {df['insurance_end_date'].max()} ({valid:,} 有值)")

    # 字符串字段标准化
    for col in ['source_policy_no', 'vehicle_frame_no', 'renewed_policy_no']:
        if col in df.columns:
            df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)

    # ── 派生字段 ──
    # is_renewed = 已续保单号非空
    if 'renewed_policy_no' in df.columns:
        df['is_renewed'] = df['renewed_policy_no'].notna()
        renewed_count = df['is_renewed'].sum()
        print(f"   已续保: {renewed_count:,}/{len(df):,} ({safe_pct(renewed_count, len(df)):.1f}%)")

    # ── 过滤无效行 ──
    before = len(df)
    df = df[df['source_policy_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无保单号: {before - len(df):,} 行")

    # ── 统计 ──
    print(f"\n   === 数据概览 ===")
    print(f"   记录数: {len(df):,}")
    if 'org_level_3' in df.columns:
        print(f"   机构数: {df['org_level_3'].nunique()}")
    if 'expiry_month' in df.columns:
        print(f"   到期月分布: {df['expiry_month'].value_counts().head(5).to_dict()}")

    # ── 输出 Parquet ──
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_renewal",
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
