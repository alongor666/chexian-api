#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性迁移脚本：将现有单体 Parquet 拆分为 3 个域

用法:
  python3 split_existing.py                          # 使用默认 current/ 中的文件
  python3 split_existing.py -i path/to/file.parquet  # 指定输入文件
  python3 split_existing.py --dry-run                # 只统计，不写文件

输出:
  warehouse/fact/policy/daily/YYYY-MM-DD.parquet   ← Policy 域（按签单日期分区）
  warehouse/fact/claims/latest.parquet             ← Claims 域（赔付+费用）
  warehouse/fact/quotes/latest.parquet             ← Quotes 域（报价状态）
"""

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# ── 域字段定义 ──

# Claims 域：保单号 + 车架号 + 赔付费用字段
CLAIMS_FIELDS = ['保单号', '车架号', '赔案件数', '已报告赔款', '费用金额']

# Quotes 域：续保单号 + 签单日期（作为报价日期）
QUOTES_FIELDS = ['续保单号', '签单日期']

# Policy 域排除的字段（由 Claims/Quotes 域承载）
POLICY_EXCLUDE = {'是否报价', '赔案件数', '已报告赔款', '费用金额'}


def parse_args():
    parser = argparse.ArgumentParser(description='拆分单体 Parquet 为 3 个数据域')
    parser.add_argument('-i', '--input', type=str, default=None,
                        help='输入 Parquet 文件路径（默认自动扫描 current/）')
    parser.add_argument('--dry-run', action='store_true',
                        help='只统计不写文件')
    return parser.parse_args()


def find_source_parquet():
    """自动扫描 current/ 目录找到源 Parquet"""
    current_dir = Path(__file__).resolve().parent.parent / 'warehouse/fact/policy/current'
    if not current_dir.exists():
        return None
    parquets = sorted(current_dir.glob('每日数据*.parquet'), key=lambda p: p.name, reverse=True)
    return parquets[0] if parquets else None


def split_policy_domain(df, output_dir, dry_run=False):
    """按签单日期分区输出 Policy 域"""
    policy_cols = [c for c in df.columns if c not in POLICY_EXCLUDE]
    df_policy = df[policy_cols].copy()

    # 确保签单日期为 datetime
    df_policy['签单日期'] = pd.to_datetime(df_policy['签单日期'], errors='coerce')

    # 去掉签单日期为空的行
    null_dates = df_policy['签单日期'].isna().sum()
    if null_dates > 0:
        print(f'  ⚠️  {null_dates:,} 行签单日期为空，归入 _unknown.parquet')

    df_valid = df_policy[df_policy['签单日期'].notna()]
    df_null = df_policy[df_policy['签单日期'].isna()]

    # 按日期分组
    df_valid['_date'] = df_valid['签单日期'].dt.date
    grouped = df_valid.groupby('_date')
    date_count = len(grouped)

    print(f'  Policy 域: {len(df_valid):,} 行 → {date_count} 个日期分区, {len(policy_cols)} 列')

    if dry_run:
        # 显示日期范围
        dates = sorted(df_valid['_date'].unique())
        print(f'  日期范围: {dates[0]} ~ {dates[-1]}')
        return date_count

    output_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for date_val, group in grouped:
        out_path = output_dir / f'{date_val}.parquet'
        group_out = group.drop(columns=['_date'])
        table = pa.Table.from_pandas(group_out, preserve_index=False)
        pq.write_table(table, out_path, compression='snappy')
        written += 1

    # 空日期单独写
    if len(df_null) > 0:
        out_path = output_dir / '_unknown.parquet'
        table = pa.Table.from_pandas(df_null, preserve_index=False)
        pq.write_table(table, out_path, compression='snappy')
        written += 1

    print(f'  ✅ 写入 {written} 个文件到 {output_dir}')
    return written


def split_claims_domain(df, output_path, dry_run=False):
    """输出 Claims 域（赔付+费用），按保单号聚合去重"""
    existing = [c for c in CLAIMS_FIELDS if c in df.columns]
    df_claims = df[existing].copy()

    # 按保单号聚合（同一保单可能有多条记录：原单+批改）
    agg_cols = [c for c in ['赔案件数', '已报告赔款', '费用金额'] if c in df_claims.columns]
    group_keys = [c for c in ['保单号'] if c in df_claims.columns]

    if group_keys and agg_cols:
        # 车架号取第一个非空值
        agg_dict = {c: 'sum' for c in agg_cols}
        if '车架号' in df_claims.columns:
            agg_dict['车架号'] = 'first'
        df_claims = df_claims.groupby(group_keys, as_index=False).agg(agg_dict)

    # 只保留有赔付或费用数据的行
    has_data = (
        (df_claims.get('赔案件数', 0) != 0) |
        (df_claims.get('已报告赔款', 0) != 0) |
        (df_claims.get('费用金额', 0) != 0)
    )
    df_claims = df_claims[has_data]

    print(f'  Claims 域: {len(df_claims):,} 行（按保单号聚合，有赔付/费用数据）, {len(existing)} 列')

    if dry_run:
        return len(df_claims)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df_claims, preserve_index=False)
    pq.write_table(table, output_path, compression='snappy')
    print(f'  ✅ 写入 {output_path}')
    return len(df_claims)


def split_quotes_domain(df, output_path, dry_run=False):
    """输出 Quotes 域（报价状态）"""
    # 筛选 是否报价=True 且 续保单号 非空
    if '是否报价' not in df.columns:
        print('  ⚠️  无 是否报价 字段，跳过 Quotes 域')
        return 0

    mask = (df['是否报价'] == True)
    df_quoted = df[mask].copy()

    existing = [c for c in QUOTES_FIELDS if c in df_quoted.columns]
    df_quotes = df_quoted[existing].copy()

    # 去掉续保单号为空的行，并按续保单号去重
    if '续保单号' in df_quotes.columns:
        df_quotes = df_quotes[df_quotes['续保单号'].notna() & (df_quotes['续保单号'] != '')]
        df_quotes = df_quotes.drop_duplicates(subset=['续保单号'], keep='first')

    print(f'  Quotes 域: {len(df_quotes):,} 行（是否报价=True，续保单号非空且去重）, {len(existing)} 列')

    if dry_run:
        return len(df_quotes)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df_quotes, preserve_index=False)
    pq.write_table(table, output_path, compression='snappy')
    print(f'  ✅ 写入 {output_path}')
    return len(df_quotes)


def verify_join(daily_dir, claims_path, quotes_path, original_count):
    """验证 JOIN 后数据一致性"""
    print(f'\n{"="*60}')
    print('🔍 验证数据一致性')
    print(f'{"="*60}')

    # 统计 daily/ 总行数
    daily_total = 0
    for f in sorted(daily_dir.glob('*.parquet')):
        t = pq.read_table(f)
        daily_total += t.num_rows
    print(f'  Policy daily 总行数: {daily_total:,}')

    # Claims
    if claims_path.exists():
        t = pq.read_table(claims_path)
        print(f'  Claims 行数: {t.num_rows:,}')

    # Quotes
    if quotes_path.exists():
        t = pq.read_table(quotes_path)
        print(f'  Quotes 行数: {t.num_rows:,}')

    # 对比
    if daily_total == original_count:
        print(f'  ✅ Policy 域行数 ({daily_total:,}) = 原始行数 ({original_count:,})')
    else:
        print(f'  ⚠️  Policy 域行数 ({daily_total:,}) ≠ 原始行数 ({original_count:,})，差异 {abs(daily_total - original_count):,}')


def main():
    args = parse_args()

    print('=' * 60)
    print('📦 单体 Parquet → 3 域拆分')
    print('=' * 60)

    # 1. 找到源文件
    if args.input:
        source = Path(args.input)
    else:
        source = find_source_parquet()

    if source is None or not source.exists():
        print(f'❌ 找不到源 Parquet 文件')
        sys.exit(1)

    print(f'源文件: {source}')
    if args.dry_run:
        print('模式: DRY RUN（只统计不写文件）')

    # 2. 读取
    start = time.perf_counter()
    df = pd.read_parquet(source)
    elapsed = time.perf_counter() - start
    print(f'读取完成: {len(df):,} 行 × {len(df.columns)} 列 ({elapsed:.1f}s)')
    original_count = len(df)

    # 3. 输出路径
    base_dir = Path(__file__).resolve().parent.parent / 'warehouse/fact'
    daily_dir = base_dir / 'policy/daily'
    claims_path = base_dir / 'claims/latest.parquet'
    quotes_path = base_dir / 'quotes/latest.parquet'

    print(f'\n输出目录:')
    print(f'  Policy → {daily_dir}')
    print(f'  Claims → {claims_path}')
    print(f'  Quotes → {quotes_path}')
    print()

    # 4. 拆分
    start = time.perf_counter()
    split_policy_domain(df, daily_dir, args.dry_run)
    split_claims_domain(df, claims_path, args.dry_run)
    split_quotes_domain(df, quotes_path, args.dry_run)
    elapsed = time.perf_counter() - start
    print(f'\n拆分耗时: {elapsed:.1f}s')

    # 5. 验证
    if not args.dry_run:
        verify_join(daily_dir, claims_path, quotes_path, original_count)

    print(f'\n{"="*60}')
    print('✅ 完成！')
    print(f'{"="*60}')


if __name__ == '__main__':
    main()
