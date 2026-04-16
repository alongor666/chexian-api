#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
已赚premium按月末计算脚本（聚合版）

功能: 基于车险保单明细，计算2026年各月末的累计已赚premium
输出: 按org_level_3×insurance_type×月末聚合的数据（适合前端展示）
口径: 监管 1/365 口径下的一年封顶规则
版本: v2.2（聚合输出）
日期: 2026-01-17

字段映射说明:
    - policy_no (policy_no) → 实际列名: "policy_no"
    - insurance_type (line_type) → 实际列名: "insurance_type"（交强险/商业保险）
    - premium (premium) → 实际列名: "premium"
    - fee_amount (fee_amount) → 实际列名: "fee_amount"
    - insurance_start_date (effective_date) → 实际列名: "insurance_start_date"
"""

import pandas as pd
import numpy as np
from datetime import datetime
from pathlib import Path
import warnings

warnings.filterwarnings('ignore')


# ============================================================================
# 第一部分：核心计算函数（向量化版本）
# ============================================================================

def compute_elapsed_days_vectorized(effective_dates: pd.Series,
                                    as_of_date: pd.Timestamp) -> pd.Series:
    """
    【向量化版本】计算截至统计时点的有效天数

    监管 1/365 口径下的一年封顶规则：
    - 若统计时点在起保日之前，有效天数 = 0（尚未起保）
    - 若自然日差超过365天，有效天数 = 365（一年封顶）
    - 否则有效天数 = 自然日差
    """
    raw_days = (as_of_date - effective_dates).dt.days
    elapsed_days = raw_days.clip(lower=0, upper=365)
    return elapsed_days


def compute_earned_premium_vectorized(df: pd.DataFrame) -> pd.DataFrame:
    """
    【向量化版本】计算已赚premium各组成部分

    公式分解（严格按三段公式实现）：
        1. 首日费用部分: first_day_part = P × F × α
        2. 时间分摊部分: time_part = P × (1 - F) × (E / 365)
        3. 累计已赚premium: earned_premium_cum = first_day_part + time_part
    """
    # 费用率 F = fee_amount / premium
    df['fee_rate'] = df['fee_amount'] / df['premium']
    df.loc[df['premium'] == 0, 'fee_rate'] = 0

    # insurance_type系数 α（固定映射）
    df['line_factor'] = df['line_type'].map({
        '交强险': 0.82,
        '商业保险': 0.94
    }).fillna(0)

    # 保险年度天数（固定为365天）
    term_days = 365

    # 首日费用部分 = P × F × α
    df['first_day_part'] = df['premium'] * df['fee_rate'] * df['line_factor']

    # 时间分摊部分 = P × (1 - F) × (E / 365)
    df['time_part'] = df['premium'] * (1 - df['fee_rate']) * (df['elapsed_days'] / term_days)

    # 累计已赚premium
    df['earned_premium_cum'] = df['first_day_part'] + df['time_part']

    return df


def generate_month_end_dates(year: int) -> list:
    """程序化生成指定年份的自然月末日期序列"""
    month_ends = []
    for month in range(1, 13):
        if month == 12:
            month_end = pd.Timestamp(f'{year}-12-31')
        else:
            next_month = pd.Timestamp(f'{year}-{month+1:02d}-01')
            month_end = next_month - pd.Timedelta(days=1)
        month_ends.append(month_end)
    return month_ends


# ============================================================================
# 主流程
# ============================================================================

def main():
    """
    主流程（聚合版）：
    1. 读取 parquet 文件
    2. 按月末分批计算
    3. 按org_level_3×insurance_type×月末聚合
    4. 输出精简的聚合结果
    """
    print("=" * 80)
    print("已赚premium按月末计算程序 v2.2（聚合输出版）")
    print("口径: 监管 1/365 口径，一年封顶规则")
    print("=" * 80)

    # ---- Step 1: 读取数据 ----
    print("\n[Step 1/5] 读取数据文件...")

    script_dir = Path(__file__).parent
    input_path = script_dir.parent / "保单明细" / "车险保单综合明细表.parquet"

    if not input_path.exists():
        print(f"  错误: 文件不存在 - {input_path}")
        return

    df = pd.read_parquet(input_path)
    print(f"  ✓ 成功读取 {len(df):,} 条记录")

    # ---- Step 2: 字段映射与数据清洗 ----
    print("\n[Step 2/5] 字段映射与数据清洗...")

    df_clean = df[[
        'policy_no', 'insurance_type', 'premium', 'fee_amount', 'insurance_start_date', 'org_level_3'
    ]].copy()

    df_clean.columns = [
        'policy_no', 'line_type', 'premium', 'fee_amount', 'effective_date', 'org_name'
    ]

    # 数据清洗
    df_clean = df_clean[
        (df_clean['premium'] > 0) &
        (df_clean['line_type'].isin(['交强险', '商业保险'])) &
        (df_clean['effective_date'].notna())
    ].copy()

    print(f"  ✓ 清洗后记录数: {len(df_clean):,}")

    # ---- Step 3: 分批计算并聚合 ----
    print("\n[Step 3/5] 分批计算已赚premium...")

    month_ends = generate_month_end_dates(2026)
    agg_results = []

    for i, month_end in enumerate(month_ends, 1):
        print(f"  处理 {month_end.strftime('%Y-%m-%d')} ({i}/{len(month_ends)})...", end='')

        df_month = df_clean.copy()
        df_month['as_of_date'] = month_end

        # 计算有效天数
        df_month['elapsed_days'] = compute_elapsed_days_vectorized(
            df_month['effective_date'], month_end
        )

        # 计算已赚premium
        df_month = compute_earned_premium_vectorized(df_month)

        # 按org_level_3×insurance_type聚合
        agg = df_month.groupby(['org_name', 'line_type']).agg({
            'policy_no': 'count',                    # 保单数量
            'premium': 'sum',                        # 原始premium合计
            'fee_amount': 'sum',                     # fee_amount合计
            'first_day_part': 'sum',                 # 首日费用部分合计
            'time_part': 'sum',                      # 时间分摊部分合计
            'earned_premium_cum': 'sum',             # 累计已赚premium合计
            'line_factor': 'first'                   # insurance_type系数（取第一个，都一样）
        }).reset_index()

        agg['as_of_date'] = month_end
        agg['fee_rate_avg'] = agg['fee_amount'] / agg['premium']  # 平均费用率

        agg_results.append(agg)
        print(f" ✓")

    # 合并所有月份
    df_agg = pd.concat(agg_results, ignore_index=True)

    # 重命名列
    df_agg.rename(columns={'policy_no': 'policy_count'}, inplace=True)

    print(f"\n  ✓ 聚合后总记录数: {len(df_agg):,}")

    # ---- Step 4: 输出结果 ----
    print("\n[Step 4/5] 输出结果...")

    # 调整列顺序
    output_columns = [
        'org_name',              # org_level_3
        'line_type',             # insurance_type
        'as_of_date',            # 统计月末
        'policy_count',          # 保单数量
        'premium',               # 原始premium
        'fee_amount',            # fee_amount
        'fee_rate_avg',          # 平均费用率
        'line_factor',           # insurance_type系数
        'first_day_part',        # 首日费用部分
        'time_part',             # 时间分摊部分
        'earned_premium_cum'     # 累计已赚premium
    ]

    df_output = df_agg[output_columns].copy()

    # 按机构、insurance_type、月末排序
    df_output = df_output.sort_values(['org_name', 'line_type', 'as_of_date'])

    # 输出CSV
    output_path = script_dir / "已赚premium按月末计算结果_聚合.csv"
    df_output.to_csv(output_path, index=False, encoding='utf-8-sig')
    print(f"  ✓ 输出文件: {output_path}")
    print(f"  ✓ 输出记录数: {len(df_output):,}")

    # ---- Step 5: 验证与汇总 ----
    print("\n[Step 5/5] 验证与汇总...")

    # 汇总统计
    print("\n" + "=" * 80)
    print("汇总统计")
    print("=" * 80)

    # 按月末汇总
    monthly_summary = df_output.groupby('as_of_date').agg({
        'earned_premium_cum': 'sum',
        'premium': 'sum',
        'policy_count': 'sum'
    }).reset_index()

    print(f"\n  {'月末日期':<12} {'累计已赚premium':>18} {'原始premium':>18} {'保单数':>10}")
    print("  " + "-" * 60)
    for _, row in monthly_summary.iterrows():
        print(f"  {row['as_of_date'].strftime('%Y-%m-%d'):<12} "
              f"{row['earned_premium_cum']:>18,.2f} "
              f"{row['premium']:>18,.2f} "
              f"{int(row['policy_count']):>10,}")

    # 按机构汇总（取12月末数据）
    print("\n  按org_level_3统计（2026-12-31）:")
    dec_data = df_output[df_output['as_of_date'] == '2026-12-31']
    org_summary = dec_data.groupby('org_name')['earned_premium_cum'].sum().sort_values(ascending=False)
    for org, earned in org_summary.items():
        print(f"    {org}: {earned:,.2f} 元")

    # 按insurance_type汇总
    print("\n  按insurance_type统计（2026-12-31）:")
    for line_type in ['交强险', '商业保险']:
        line_data = dec_data[dec_data['line_type'] == line_type]
        print(f"    {line_type}: {line_data['earned_premium_cum'].sum():,.2f} 元")

    print("\n" + "=" * 80)
    print("✓ 所有任务完成!")
    print("=" * 80)

    # 打印输出文件大小
    file_size = output_path.stat().st_size / 1024
    print(f"\n  输出文件大小: {file_size:.1f} KB")


if __name__ == '__main__':
    main()
