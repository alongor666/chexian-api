#!/usr/bin/env python3
"""
提取业务员保费计划数据

从2025/2026年销售人员保费计划Excel文件中提取：
- 业务员姓名
- 所属团队
- 所属机构
- 保费计划（分产品：车险、财险、人险、合计）

生成标准化Parquet文件用于后续分析。
"""

import pandas as pd
import numpy as np
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

def read_salesman_plan_with_multiheader(file_path: str, year: int) -> pd.DataFrame:
    """
    读取业务员保费计划文件（处理多层列名）

    Args:
        file_path: Excel文件路径
        year: 年份（2025或2026）

    Returns:
        标准化的DataFrame
    """
    print(f"\n{'='*60}")
    print(f"读取 {year}年 数据文件")
    print(f"{'='*60}")

    # 读取原始数据
    df_raw = pd.read_excel(file_path)

    print(f"原始数据: {df_raw.shape}")

    # 获取产品分类行（第一行）
    products = df_raw.iloc[0].fillna('').tolist()
    print(f"产品分类: {products}")

    # 从第二行开始读取数据
    df = df_raw.iloc[1:].reset_index(drop=True).copy()

    # 手动映射列名
    # 2025: 机构,销售团队,业务员,入司时间,本年在岗时间,25年保费计划(x4),25年实际保费收入(x4),保费达成率(x4)
    # 2026: 机构,销售团队,业务员,入司时间,26年保费计划(x4)

    new_columns = []
    col_idx = 0

    # 基础字段
    base_fields_2025 = ['org_name', 'team_name', 'salesman_name', 'entry_date', 'months_in_service']
    base_fields_2026 = ['org_name', 'team_name', 'salesman_name', 'entry_date']

    base_fields = base_fields_2025 if year == 2025 else base_fields_2026

    for i in range(len(base_fields)):
        new_columns.append(base_fields[i])
        col_idx += 1

    # 保费计划字段（车、财、人、合计）
    plan_fields = ['plan_vehicle', 'plan_property', 'plan_life', 'plan_total']
    for field in plan_fields:
        new_columns.append(field)
        col_idx += 1

    # 实际保费字段（仅2025年有）
    if year == 2025:
        actual_fields = ['actual_vehicle', 'actual_property', 'actual_life', 'actual_total']
        for field in actual_fields:
            new_columns.append(field)
            col_idx += 1

        # 达成率字段（仅2025年有）
        rate_fields = ['rate_vehicle', 'rate_property', 'rate_life', 'rate_total']
        for field in rate_fields:
            new_columns.append(field)
            col_idx += 1

    # 确保列数匹配
    while len(new_columns) < len(df.columns):
        new_columns.append(f'col_{len(new_columns)}')

    df.columns = new_columns[:len(df.columns)]

    print(f"重命名后的列名: {list(df.columns)}")

    # 清理数据
    df = df[df['salesman_name'].notna()].copy()
    df['salesman_name'] = df['salesman_name'].astype(str).str.strip()

    # 提取业务员编号（如果有的话）
    df['salesman_id'] = df['salesman_name'].str.extract(r'(\d+)')

    # 转换数值列
    numeric_cols = [
        'plan_vehicle', 'plan_property', 'plan_life', 'plan_total',
        'actual_vehicle', 'actual_property', 'actual_life', 'actual_total',
        'rate_vehicle', 'rate_property', 'rate_life', 'rate_total',
        'months_in_service'
    ]

    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # 添加年份标识
    df['plan_year'] = year

    print(f"\n处理后数据: {df.shape}")
    print(f"有效业务员数: {df['salesman_name'].nunique()}")
    print(f"\n数据样例（前3行）:")
    print(df[['salesman_name', 'team_name', 'org_name', 'plan_total']].head(3))

    return df

def merge_and_standardize_data() -> pd.DataFrame:
    """合并并标准化2025和2026年数据"""
    base_path = Path("/Users/xuechenglong/Downloads/01-公司开发项目/chexianYJFX/数据管理/一线计划")

    files = {
        2025: "2025年销售人员分产品保费计划达成情况.xlsx",
        2026: "2026年销售人员分产品保费计划.xlsx"
    }

    all_data = []

    for year, filename in files.items():
        file_path = base_path / filename
        if file_path.exists():
            df = read_salesman_plan_with_multiheader(str(file_path), year)
            if df is not None and len(df) > 0:
                all_data.append(df)
        else:
            print(f"⚠️  文件不存在: {file_path}")

    if not all_data:
        print("❌ 没有读取到任何数据")
        return None

    # 合并数据
    df_merged = pd.concat(all_data, ignore_index=True)

    print(f"\n{'='*60}")
    print(f"合并后数据: {df_merged.shape}")
    print(f"总业务员数: {df_merged['salesman_name'].nunique()}")
    print(f"团队数: {df_merged['team_name'].nunique()}")
    print(f"机构数: {df_merged['org_name'].nunique()}")

    # 生成标准化输出
    output_columns = [
        'salesman_name',
        'salesman_id',
        'team_name',
        'org_name',
        'entry_date',
        'plan_year',
        'plan_vehicle',
        'plan_property',
        'plan_life',
        'plan_total',
    ]

    # 如果是2025年数据，添加实际保费和达成率
    extra_cols = [
        'actual_vehicle',
        'actual_property',
        'actual_life',
        'actual_total',
        'rate_vehicle',
        'rate_property',
        'rate_life',
        'rate_total',
        'months_in_service'
    ]

    for col in extra_cols:
        if col in df_merged.columns:
            output_columns.append(col)

    # 确保列存在
    output_columns = [col for col in output_columns if col in df_merged.columns]
    df_output = df_merged[output_columns].copy()

    print(f"\n输出字段: {output_columns}")

    return df_output

def main():
    """主函数"""
    print("="*60)
    print("业务员保费计划数据提取工具")
    print("="*60)

    # 读取并合并数据
    df_final = merge_and_standardize_data()

    if df_final is None or len(df_final) == 0:
        print("❌ 没有数据可保存")
        return

    # 保存为Parquet
    output_dir = Path("/Users/xuechenglong/Downloads/01-公司开发项目/chexianYJFX/数据管理")
    output_file = output_dir / "业务员保费计划标准化数据.parquet"

    df_final.to_parquet(output_file, index=False, compression='snappy')

    print(f"\n{'='*60}")
    print(f"✅ 数据提取完成！")
    print(f"📄 文件保存至: {output_file}")
    print(f"📊 总记录数: {len(df_final)}")
    print(f"👥 业务员数: {df_final['salesman_name'].nunique()}")
    print(f"🏢 机构数: {df_final['org_name'].nunique()}")
    print(f"👥 团队数: {df_final['team_name'].nunique()}")

    # 保存为CSV（方便查看）
    csv_file = output_dir / "业务员保费计划标准化数据.csv"
    df_final.to_csv(csv_file, index=False, encoding='utf-8-sig')
    print(f"📄 CSV文件: {csv_file}")

    # 数据统计
    print(f"\n{'='*60}")
    print("📈 数据统计")
    print(f"{'='*60}")

    if 'plan_total' in df_final.columns:
        print(f"\n按年份统计:")
        year_stats = df_final.groupby('plan_year')['plan_total'].agg(['count', 'sum', 'mean'])
        print(year_stats)

        print(f"\n按机构统计（2026年计划）:")
        df_2026 = df_final[df_final['plan_year'] == 2026]
        if len(df_2026) > 0:
            org_stats = df_2026.groupby('org_name')['plan_total'].agg(['count', 'sum']).sort_values('sum', ascending=False)
            print(org_stats)

    print(f"\n{'='*60}")

if __name__ == "__main__":
    main()
