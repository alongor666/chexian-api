#!/usr/bin/env python3
"""
商业险续转保报价 Excel → quotes/latest.parquet

独立报价数据源，字段结构与主数据 Excel 不同。
包含：报价时间、三级机构、业务员、车架号、续保情况、是否承保、险别组合、折后保费等。

用法：
  python3 convert_quotes.py -i 商业险续转保报价*.xlsx -o warehouse/fact/quotes/latest.parquet
"""

import argparse
import pandas as pd
import numpy as np
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(description='商业险续转保报价 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()

def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 商业险续转保报价 → Parquet")
    print(f"{'='*80}")
    print(f"   输入: {input_file.name}")

    df = pd.read_excel(input_file)
    print(f"   加载: {len(df):,} 行 × {len(df.columns)} 列")

    # 标准化报价时间
    if '报价时间' in df.columns:
        df['报价时间'] = pd.to_datetime(df['报价时间'], errors='coerce')
        print(f"   报价时间: {df['报价时间'].min()} ~ {df['报价时间'].max()}")

    # 拆分 adminadmin 系统账号
    if '业务员' in df.columns and '三级机构' in df.columns:
        mask = df['业务员'].astype(str).str.strip() == 'adminadmin'
        if mask.sum() > 0:
            df.loc[mask, '业务员'] = 'admin' + df.loc[mask, '三级机构'].astype(str) + '直接个代'
            print(f"   拆分 adminadmin: {mask.sum():,} 条")

    # 字段标准化（对齐 policy Parquet 列名）
    rename_map = {
        '车牌号': '车牌号码',
        '货车吨位分段': '吨位分段',
        '是否新能源车': '是否新能源',
        '自主定价系数': '商车自主定价系数',
    }
    df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns}, inplace=True)
    renamed = [f'{k}→{v}' for k, v in rename_map.items() if v in df.columns]
    if renamed:
        print(f"   字段标准化: {', '.join(renamed)}")

    # 风险等级 COALESCE 合并（对齐 transform.py 逻辑）
    grade_cols = ['车险分等级', '小货车评分', '大货车评分']
    existing_grades = [c for c in grade_cols if c in df.columns]
    if existing_grades:
        df['车险风险等级'] = df[existing_grades[0]]
        for c in existing_grades[1:]:
            df['车险风险等级'] = df['车险风险等级'].fillna(df[c])
        drop_grades = [c for c in existing_grades if c != '车险风险等级']
        if drop_grades:
            df.drop(columns=drop_grades, inplace=True)
        valid_grades = df['车险风险等级'].notna().sum()
        print(f"   风险等级合并: {valid_grades:,}/{len(df):,} ({valid_grades/len(df)*100:.1f}%)")

    # 标准化数值字段
    for col in ['折前保费', '折后保费', 'NCD基数', 'NCD系数', '商车自主定价系数']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)

    # 保存（统一 L1 metadata）
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_quotes",
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"   输出: {output_file} ({size_mb:.1f} MB)")

    # 验证
    verify = pd.read_parquet(output_file)
    print(f"   验证: {len(verify):,} 行 ✅")

    # 统计
    if '续保情况' in df.columns:
        print(f"   续保情况: {df['续保情况'].value_counts().to_dict()}")
    if '是否承保' in df.columns:
        print(f"   是否承保: {df['是否承保'].value_counts().to_dict()}")

    print(f"{'='*80}")
    print(f"✅ 完成")

if __name__ == '__main__':
    main()
