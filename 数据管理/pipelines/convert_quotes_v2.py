#!/usr/bin/env python3
"""
报价清单（商业险）Excel → quotes/latest.parquet

全新格式 25 列报价清单，替换旧版 convert_quotes.py（旧版处理 商业险续转保报价*.xlsx）。

用法：
  python3 convert_quotes_v2.py -i 04_报价清单_商业险.xlsx -o warehouse/fact/quotes/latest.parquet
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
    '车架号': 'vehicle_frame_no',
    '险类': 'insurance_type',
    '三级机构': 'org_level_3',
    '客户类别': 'customer_category',
    '货车吨位分段': 'tonnage_segment',
    '保单号': 'policy_no',
    '车牌号': 'plate_no',
    '报价时间': 'quote_time',
    '保险起期': 'insurance_start_date',
    '续转保': 'renewal_status',
    '是否过户车': 'is_transfer',
    '是否新能源车': 'is_nev',
    '是否电销': 'is_telemarketing',
    '是否承保': 'is_underwritten',
    '险别组合': 'coverage_combination',
    '车险分等级': '_grade_1',
    '小货车评分': '_grade_2',
    '大货车评分': '_grade_3',
    '交通风险评分等级': 'traffic_risk_grade',
    '业务员': 'salesman_name',
    '纯风险保费': 'pure_risk_premium',
    '商业险NCD': 'commercial_ncd',
    'NCD保费': 'ncd_premium',
    '自主定价系数': 'commercial_pricing_factor',
    '最终报价': 'final_quote_premium',
}

REQUIRED_COLUMNS = ['车架号', '报价时间']
STR_FORCE_COLS = {'车架号': str, '保单号': str, '车牌号': str}


def parse_args():
    parser = argparse.ArgumentParser(description='报价清单（商业险）→ Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 报价清单（商业险）→ Parquet (v2 格式)")
    print(f"{'='*80}")
    print(f"   输入: {input_file.name}")

    from pipelines.etl_validation import validate_input_path, validate_output_path, verify_non_empty, safe_pct, to_bool, PLACEHOLDER_STRS
    input_file = validate_input_path(str(input_file))
    output_file = validate_output_path(str(output_file))

    # ── 加载 ──
    df = pd.read_excel(input_file, dtype=STR_FORCE_COLS)
    print(f"   加载: {len(df):,} 行 × {len(df.columns)} 列")
    print(f"   源列: {list(df.columns)}")

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

    # ── 风险等级 COALESCE 合并 ──
    grade_cols = ['_grade_1', '_grade_2', '_grade_3']
    existing_grades = [c for c in grade_cols if c in df.columns]
    if existing_grades:
        df['insurance_grade'] = df[existing_grades[0]]
        for c in existing_grades[1:]:
            df['insurance_grade'] = df['insurance_grade'].fillna(df[c])
        df = df.drop(columns=existing_grades)
        valid_grades = df['insurance_grade'].notna().sum()
        print(f"   风险等级合并: {valid_grades:,}/{len(df):,} ({safe_pct(valid_grades, len(df)):.1f}%)")

    # ── 类型转换 ──

    # 日期/时间字段
    if 'quote_time' in df.columns:
        df['quote_time'] = pd.to_datetime(df['quote_time'], errors='coerce')
        valid = df['quote_time'].notna().sum()
        print(f"   报价时间: {df['quote_time'].min()} ~ {df['quote_time'].max()} ({valid:,} 有值)")

    if 'insurance_start_date' in df.columns:
        df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce')

    # 布尔字段
    for col in ['is_transfer', 'is_nev', 'is_telemarketing', 'is_underwritten']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().map(to_bool)

    if 'is_underwritten' in df.columns:
        uw_count = df['is_underwritten'].sum()
        print(f"   已承保: {uw_count:,}/{len(df):,} ({safe_pct(uw_count, len(df)):.1f}%)")

    # 数值字段
    for col in ['pure_risk_premium', 'ncd_premium', 'commercial_pricing_factor',
                'final_quote_premium', 'commercial_ncd']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # 字符串字段标准化
    for col in ['vehicle_frame_no', 'policy_no', 'plate_no']:
        if col in df.columns:
            df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)

    # ── 过滤无效行 ──
    before = len(df)
    df = df[df['vehicle_frame_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无车架号: {before - len(df):,} 行")

    # ── 统计 ──
    print(f"\n   === 数据概览 ===")
    print(f"   记录数: {len(df):,}")
    print(f"   唯一车架号: {df['vehicle_frame_no'].nunique():,}")
    if 'renewal_status' in df.columns:
        print(f"   续转保分布: {df['renewal_status'].value_counts().to_dict()}")
    if 'customer_category' in df.columns:
        print(f"   客户类别TOP5: {df['customer_category'].value_counts().head(5).to_dict()}")
    if 'final_quote_premium' in df.columns:
        total = df['final_quote_premium'].sum()
        print(f"   最终报价合计: {total/1e8:.2f} 亿元")

    # ── 输出 Parquet ──
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_quotes_v2",
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
