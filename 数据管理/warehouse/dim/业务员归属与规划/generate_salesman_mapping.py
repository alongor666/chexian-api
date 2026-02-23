#!/usr/bin/env python3
"""
业务员归属关系生成脚本

从 2025 年和 2026 年销售人员保费计划文件中提取业务员归属数据，
整合成全量的业务员-团队-机构映射关系 JSON 文件。

输出格式：
{
  "salesman_mapping": [
    {
      "business_no": "业务员编号",
      "salesman_name": "业务员姓名",
      "full_name": "编号+姓名",
      "team": "所属团队",
      "organization": "三级机构",
      "car_insurance_plan_2026": 2026年车险保费计划（单位：万）
    }
  ],
  "statistics": {
    "total_salesmen": 业务员总数,
    "total_teams": 团队总数,
    "total_organizations": 机构总数,
    "sources": {
      "2026_plan_count": 2026年文件中提取的数量,
      "2025_actual_count": 2025年文件中提取的数量,
      "unique_count": 去重后唯一业务员数量
    }
  }
}
"""

import pandas as pd
import json
import argparse
from pathlib import Path
from typing import Dict, List


def load_salesman_data(file_path: str, year: str) -> pd.DataFrame:
    """
    加载销售人员数据

    Args:
        file_path: Excel 文件路径
        year: 年份标识（'2025' 或 '2026'）

    Returns:
        清理后的 DataFrame，包含机构、团队、业务员等字段
    """
    print(f"\n{'='*60}")
    print(f"加载 {year} 年数据: {file_path}")
    print(f"{'='*60}")

    # 读取 Excel 文件
    df = pd.read_excel(file_path, header=0)

    # 跳过第1行（子表头：车、财、人、合计）
    df = df.iloc[1:].reset_index(drop=True)

    # 删除全是 NaN 的行
    df = df.dropna(how='all')

    print(f"原始行数: {len(df)}")

    # 提取核心字段
    # 只要求业务员字段不为空，允许团队和机构为空
    df_valid = df[df['业务员'].notna()].copy()

    # 过滤掉包含"汇总"的行
    df_valid = df_valid[~df_valid['业务员'].str.contains('汇总', na=False)]

    print(f"有效业务员行数（去汇总后）: {len(df_valid)}")

    # 清理字段名
    df_clean = df_valid[['机构', '销售团队', '业务员']].copy()
    df_clean.columns = ['organization', 'team', 'salesman_full_name']

    # 填充空值（团队或机构可能为空）
    df_clean['organization'] = df_clean['organization'].fillna('未分配机构').str.strip()
    df_clean['team'] = df_clean['team'].fillna('未分配').str.strip()
    df_clean['salesman_full_name'] = df_clean['salesman_full_name'].str.strip()

    # 提取业务员编号和姓名
    # 格式类似：200048468肖照耀
    df_clean['business_no'] = df_clean['salesman_full_name'].str.extract(r'(\d+)')[0]
    df_clean['salesman_name'] = df_clean['salesman_full_name'].str.replace(r'^\d+', '', regex=True)

    # 如果 2026 年文件，提取车险保费计划
    if year == '2026':
        # Excel 文件结构：
        # 第0行：机构、销售团队、业务员、入司时间、26年保费计划、NaN、NaN、NaN、备注
        # 第1行：NaN、NaN、NaN、NaN、车、财、人、合计、NaN
        # 使用 header=0 读取后，列4=车（车险）、列5=财（财产险）、列6=人（人身险）、列7=合计

        # 重新读取文件以获取原始数据（header=None）
        df_raw = pd.read_excel(file_path, header=None)

        # 从原始数据中提取所有字段
        # 从第2行开始是数据（跳过第0行主表头和第1行子表头）
        raw_data = df_raw.iloc[2:].reset_index(drop=True)

        # 创建业务员姓名到车险计划的映射
        car_plan_mapping = {}
        for idx, row in raw_data.iterrows():
            full_name = str(row[2]) if pd.notna(row[2]) else None
            car_plan = row[4] if pd.notna(row[4]) else None

            if full_name and '汇总' not in full_name:
                car_plan_mapping[full_name] = car_plan

        # 将车险计划映射到 df_clean
        df_clean['car_insurance_plan_2026'] = df_clean['salesman_full_name'].map(car_plan_mapping)

        print(f"已提取车险保费计划数据")

    return df_clean


def merge_salesman_data(df_2025: pd.DataFrame, df_2026: pd.DataFrame) -> List[Dict]:
    """
    合并 2025 和 2026 年数据，去重并生成全量映射

    Args:
        df_2025: 2025 年数据
        df_2026: 2026 年数据

    Returns:
        业务员映射列表
    """
    print(f"\n{'='*60}")
    print("合并数据")
    print(f"{'='*60}")

    # 添加数据来源标记
    df_2025['source'] = '2025_actual'
    df_2026['source'] = '2026_plan'

    # 合并两个数据集
    df_all = pd.concat([df_2025, df_2026], ignore_index=True)

    print(f"合并前行数: {len(df_2025)} (2025) + {len(df_2026)} (2026) = {len(df_2025) + len(df_2026)}")
    print(f"合并后行数: {len(df_all)}")

    # 去重：以业务员编号为主键，保留 2026 年的数据（如果存在）
    df_unique = df_all.sort_values('source', ascending=False).drop_duplicates(
        subset=['business_no'], keep='first'
    )

    print(f"去重后唯一业务员数: {len(df_unique)}")

    # 转换为字典列表
    salesman_list = []

    for _, row in df_unique.iterrows():
        record = {
            'business_no': row['business_no'],
            'salesman_name': row['salesman_name'],
            'full_name': row['salesman_full_name'],
            'team': row['team'],
            'organization': row['organization'],
        }

        # 如果有 2026 年车险计划数据，添加到记录中
        if 'car_insurance_plan_2026' in row and pd.notna(row['car_insurance_plan_2026']):
            try:
                record['car_insurance_plan_2026'] = float(row['car_insurance_plan_2026'])
            except (ValueError, TypeError):
                pass

        salesman_list.append(record)

    # 按 full_name 排序
    salesman_list.sort(key=lambda x: x['full_name'])

    return salesman_list


def generate_statistics(salesman_list: List[Dict], df_2025: pd.DataFrame, df_2026: pd.DataFrame) -> Dict:
    """
    生成统计信息

    Args:
        salesman_list: 业务员映射列表
        df_2025: 2025 年数据
        df_2026: 2026 年数据

    Returns:
        统计信息字典
    """
    organizations = set(item['organization'] for item in salesman_list)
    teams = set(item['team'] for item in salesman_list)

    return {
        'total_salesmen': len(salesman_list),
        'total_teams': len(teams),
        'total_organizations': len(organizations),
        'organizations': sorted(list(organizations)),
        'teams': sorted(list(teams)),
        'sources': {
            '2026_plan_count': len(df_2026),
            '2025_actual_count': len(df_2025),
            'unique_count': len(salesman_list)
        }
    }


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="业务员归属关系生成工具")
    parser.add_argument('--plan-2026', type=str, help='2026年保费计划文件路径，如果不传会自动在目录下寻找')
    parser.add_argument('--actual-2025', type=str, help='2025年达成情况文件路径，如果不传会自动在目录下寻找')
    parser.add_argument('--out', dest='output', type=str, help='输出 JSON 文件路径')
    args = parser.parse_args()

    print("\n" + "="*60)
    print("业务员归属关系生成工具")
    print("="*60)

    # 默认使用脚本当前所在目录，而不是硬编码的绝对路径
    base_dir = Path(__file__).resolve().parent

    # 支持通过参数传入特定文件，例如最新下载的Excel文件
    file_2026 = Path(args.plan_2026) if args.plan_2026 else base_dir / '2026年销售人员分产品保费计划.xlsx'
    file_2025 = Path(args.actual_2025) if args.actual_2025 else base_dir / '2025年销售人员分产品保费计划达成情况.xlsx'
    output_file = Path(args.output) if args.output else base_dir / 'salesman_organization_mapping.json'

    # 检查文件是否存在
    if not file_2026.exists():
        print(f"\n❌ 错误: 文件不存在 - {file_2026}")
        return 1

    if not file_2025.exists():
        print(f"\n❌ 错误: 文件不存在 - {file_2025}")
        return 1

    # 加载数据
    df_2026 = load_salesman_data(str(file_2026), '2026')
    df_2025 = load_salesman_data(str(file_2025), '2025')

    # 合并数据
    salesman_list = merge_salesman_data(df_2025, df_2026)

    # 生成统计信息
    statistics = generate_statistics(salesman_list, df_2025, df_2026)

    # 构建最终输出
    output_data = {
        'salesman_mapping': salesman_list,
        'statistics': statistics
    }

    # 保存 JSON 文件
    print(f"\n{'='*60}")
    print("保存 JSON 文件")
    print(f"{'='*60}")

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"✅ 已保存到: {output_file}")

    # 打印统计信息
    print(f"\n{'='*60}")
    print("统计信息")
    print(f"{'='*60}")
    print(f"总业务员数: {statistics['total_salesmen']}")
    print(f"总团队数: {statistics['total_teams']}")
    print(f"总机构数: {statistics['total_organizations']}")
    print(f"\n数据来源:")
    print(f"  - 2026 年计划文件: {statistics['sources']['2026_plan_count']} 条")
    print(f"  - 2025 年达成文件: {statistics['sources']['2025_actual_count']} 条")
    print(f"  - 去重后唯一业务员: {statistics['sources']['unique_count']} 条")

    print(f"\n机构列表:")
    for org in statistics['organizations']:
        print(f"  - {org}")

    # 预览前 5 条数据
    print(f"\n{'='*60}")
    print("数据预览（前 5 条）")
    print(f"{'='*60}")
    for item in salesman_list[:5]:
        print(f"\n业务员: {item['full_name']}")
        print(f"  编号: {item['business_no']}")
        print(f"  团队: {item['team']}")
        print(f"  机构: {item['organization']}")
        if 'car_insurance_plan_2026' in item:
            print(f"  2026年车险计划: {item['car_insurance_plan_2026']}万")

    print(f"\n{'='*60}")
    print("✅ 完成！")
    print(f"{'='*60}\n")

    return 0


if __name__ == '__main__':
    exit(main())
