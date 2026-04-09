#!/usr/bin/env python3
"""
客户来源去向 Excel → customer_flow/latest.parquet

客户转保/流失分析数据：上年承保主体 → 华安 → 次年保险公司。

用法：
  python3 convert_customer_flow.py -i 08_客户来源去向.xlsx -o warehouse/fact/customer_flow/latest.parquet
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
    '保单号': 'policy_no',
    '保险起期': 'insurance_start_date',
    '车架号': 'vehicle_frame_no',
    '整备质量': 'curb_weight',
    '续航里程分组': 'range_group',
    '上年承保主体': 'previous_insurer',
    '次年保险公司': 'next_insurer',
}

REQUIRED_COLUMNS = ['保单号']
STR_FORCE_COLS = {'保单号': str, '车架号': str}


def parse_args():
    parser = argparse.ArgumentParser(description='客户来源去向 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 客户来源去向 → Parquet")
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

    # 保险起期
    if 'insurance_start_date' in df.columns:
        df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce')
        valid = df['insurance_start_date'].notna().sum()
        print(f"   保险起期: {df['insurance_start_date'].min()} ~ {df['insurance_start_date'].max()} ({valid:,} 有值)")

    # 整备质量 → DOUBLE
    if 'curb_weight' in df.columns:
        df['curb_weight'] = pd.to_numeric(df['curb_weight'], errors='coerce')

    # 字符串字段标准化
    for col in ['policy_no', 'vehicle_frame_no', 'previous_insurer', 'next_insurer', 'range_group']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace(PLACEHOLDER_STRS, None)

    # ── 去重：按保单号去重（不按车架号，因为车辆每年投保） ──
    before = len(df)
    df = df.drop_duplicates(subset=['policy_no'], keep='first')
    if len(df) < before:
        print(f"   去重: {before - len(df):,} 行（按 policy_no）")

    # ── 过滤无效行 ──
    before = len(df)
    df = df[df['policy_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无保单号: {before - len(df):,} 行")

    # ── 统计 ──
    print(f"\n   === 数据概览 ===")
    print(f"   记录数: {len(df):,}")
    print(f"   唯一保单: {df['policy_no'].nunique():,}")

    if 'previous_insurer' in df.columns:
        has_prev = df['previous_insurer'].notna().sum()
        print(f"   有上年承保主体: {has_prev:,} ({safe_pct(has_prev, len(df)):.1f}%)")
        top_prev = df['previous_insurer'].value_counts().head(10)
        print(f"   上年承保主体TOP10: {top_prev.to_dict()}")

    if 'next_insurer' in df.columns:
        has_next = df['next_insurer'].notna().sum()
        print(f"   有次年保险公司: {has_next:,} ({safe_pct(has_next, len(df)):.1f}%)")
        top_next = df['next_insurer'].value_counts().head(10)
        print(f"   次年保险公司TOP10: {top_next.to_dict()}")

    # ── 输出 Parquet ──
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_customer_flow",
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
