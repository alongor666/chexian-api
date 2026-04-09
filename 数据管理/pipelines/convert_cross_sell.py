#!/usr/bin/env python3
"""
交叉销售清单 Excel → cross_sell/latest.parquet

独立交叉销售数据（从签单清单中移出），每行 = 一个保单的驾意险交叉销售记录。

用法：
  python3 convert_cross_sell.py -i 03_交叉销售_家自车_23年至今.xlsx -o warehouse/fact/cross_sell/latest.parquet
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
    '三级机构': 'org_level_3',
    '业务员': 'salesman_name',
    '保单号': 'policy_no',
    '签单日期': 'policy_date',
    '车架号': 'vehicle_frame_no',
    '客户类别3': 'customer_category',
    '险别': 'coverage_combination',
    '交叉销售标识-驾意': 'is_cross_sell',
    '交叉销售保费-驾意': 'cross_sell_premium_driver',
}

REQUIRED_COLUMNS = ['保单号', '交叉销售标识-驾意']
STR_FORCE_COLS = {'保单号': str, '车架号': str}


def parse_args():
    parser = argparse.ArgumentParser(description='交叉销售清单 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 交叉销售清单 → Parquet")
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

    # 签单日期
    if 'policy_date' in df.columns:
        df['policy_date'] = pd.to_datetime(df['policy_date'], errors='coerce')
        print(f"   签单日期: {df['policy_date'].min()} ~ {df['policy_date'].max()}")

    # 交叉销售标识 → BOOLEAN
    if 'is_cross_sell' in df.columns:
        df['is_cross_sell'] = df['is_cross_sell'].astype(str).str.strip().map(to_bool)
        cross_count = df['is_cross_sell'].sum()
        print(f"   交叉销售: {cross_count:,}/{len(df):,} ({safe_pct(cross_count, len(df)):.1f}%)")

    # 交叉销售保费 → DOUBLE
    if 'cross_sell_premium_driver' in df.columns:
        df['cross_sell_premium_driver'] = pd.to_numeric(df['cross_sell_premium_driver'], errors='coerce').fillna(0.0)

    # 字符串字段标准化
    for col in ['policy_no', 'vehicle_frame_no']:
        if col in df.columns:
            df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)

    # ── 去重：按保单号去重 ──
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
    if 'is_cross_sell' in df.columns:
        print(f"   有驾意险: {df['is_cross_sell'].sum():,}")
    if 'cross_sell_premium_driver' in df.columns:
        total_prem = df['cross_sell_premium_driver'].sum()
        print(f"   驾意险保费合计: {total_prem:,.0f} 元")

    # ── 输出 Parquet ──
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_cross_sell",
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

    # ── 验证 ──
    verify = pd.read_parquet(output_file)
    verify_non_empty(verify)
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列")

    print(f"{'='*80}")
    print(f"✅ 完成")


if __name__ == '__main__':
    main()
