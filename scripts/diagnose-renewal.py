#!/usr/bin/env python3
"""
续保率数据诊断脚本

用途：诊断为什么续保率为空
"""

import pandas as pd
from pathlib import Path

# 读取 Parquet 文件
parquet_file = Path(__file__).parent.parent / "签单清洗" / "优化处理后的业务数据_v2.parquet"

print("📊 开始诊断续保率数据...\n")
print(f"读取文件: {parquet_file}\n")

df = pd.read_parquet(parquet_file)

print("=" * 60)
print("1. 数据基本信息")
print("=" * 60)
print(f"总行数: {len(df)}")
print(f"总列数: {len(df.columns)}\n")

print("=" * 60)
print("2. 列名列表")
print("=" * 60)
print(df.columns.tolist())
print()

print("=" * 60)
print("3. 起保年份分布")
print("=" * 60)
if '保险起期' in df.columns:
    df['保险起期'] = pd.to_datetime(df['保险起期'])
    df['起保年份'] = df['保险起期'].dt.year
    year_dist = df['起保年份'].value_counts().sort_index()
    print(year_dist)
else:
    print("⚠️  找不到'保险起期'列")
print()

print("=" * 60)
print("4. 续保单号字段统计")
print("=" * 60)
if '续保单号' in df.columns:
    total = len(df)
    has_value = df['续保单号'].notna().sum()
    has_valid = (df['续保单号'].notna() & (df['续保单号'] != '')).sum()
    print(f"总记录数: {total}")
    print(f"续保单号非空: {has_value} ({has_value/total*100:.2f}%)")
    print(f"续保单号有效（非空且非空字符串）: {has_valid} ({has_valid/total*100:.2f}%)")
else:
    print("⚠️  找不到'续保单号'列")
print()

print("=" * 60)
print("5. 续保单号样本数据（前10条）")
print("=" * 60)
if '续保单号' in df.columns:
    sample = df[df['续保单号'].notna() & (df['续保单号'] != '')][
        ['保单号', '续保单号', '保险起期', '起保年份']
    ].head(10)
    if len(sample) > 0:
        print(sample.to_string())
    else:
        print("⚠️  没有找到有效的续保单号数据")
else:
    print("⚠️  找不到'续保单号'列")
print()

print("=" * 60)
print("6. 2024-2025年续保匹配测试")
print("=" * 60)
if '续保单号' in df.columns and '保单号' in df.columns and '起保年份' in df.columns:
    # 2024年起保的保单
    policies_2024 = df[df['起保年份'] == 2024][['保单号', '保险起期']].head(100)

    # 2025年起保的保单（有续保单号）
    policies_2025 = df[
        (df['起保年份'] == 2025) &
        (df['续保单号'].notna()) &
        (df['续保单号'] != '')
    ][['保单号', '续保单号', '保险起期']].head(100)

    print(f"2024年起保保单数（前100）: {len(policies_2024)}")
    print(f"2025年起保有续保单号的保单数（前100）: {len(policies_2025)}")

    if len(policies_2024) > 0 and len(policies_2025) > 0:
        # 尝试匹配
        matched = policies_2025.merge(
            policies_2024,
            left_on='续保单号',
            right_on='保单号',
            how='left',
            suffixes=('_2025', '_2024')
        )
        matched_count = matched['保单号_2024'].notna().sum()
        print(f"成功匹配的续保单数: {matched_count} / {len(policies_2025)}")

        if matched_count > 0:
            print("\n匹配样本（前5条）:")
            print(matched[matched['保单号_2024'].notna()].head(5).to_string())
    else:
        print("⚠️  2024或2025年数据不足，无法测试匹配")
else:
    print("⚠️  缺少必要的列进行匹配测试")
print()

print("=" * 60)
print("7. 诊断结论")
print("=" * 60)

# 判断问题
if '续保单号' not in df.columns:
    print("❌ 数据中没有'续保单号'列")
elif (df['续保单号'].notna() & (df['续保单号'] != '')).sum() == 0:
    print("❌ '续保单号'列全是空值")
elif '起保年份' in df.columns:
    years = df['起保年份'].unique()
    if 2025 not in years and 2026 not in years:
        print(f"⚠️  数据中没有2025或2026年的起保日期，实际年份: {sorted(years)}")
        print("💡 建议：将 targetYear 设置为数据中实际存在的年份")
else:
    print("✅ 数据结构看起来正常，需要进一步检查SQL查询逻辑")

print("\n✅ 诊断完成")
