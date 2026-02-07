#!/usr/bin/env python3
"""
续保率分析脚本（修复版）

功能：
1. 计算 2025年1月1日至1月8日每天的保单件数和已续保件数
2. 生成续保率分析报表
3. 生成续保明细表格（包含所有字段）

续保逻辑：
- 2025年1月上旬起保的保单 = 应续保单
- 在 2026年保单中查找续保单号字段匹配的保单 = 已续保单
- 续保率 = 已续保单数 / 应续保单数

使用方法：
python3 scripts/generate-renewal-analysis.py
"""

import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
import sys

# 文件路径配置
DATA_FILE = Path(__file__).parent.parent / "签单清洗/优化处理后的业务数据_v2.parquet"
OUTPUT_FILE = Path(__file__).parent.parent / "续保率分析-2025年1月上旬.xlsx"

# 分析日期范围
START_DATE = "2025-01-01"
END_DATE = "2025-01-08"


def load_data():
    """加载 Parquet 数据文件"""
    print("=" * 60)
    print("续保率分析脚本（修复版）")
    print("=" * 60)
    print(f"分析日期范围: {START_DATE} 至 {END_DATE}")
    print(f"数据文件: {DATA_FILE}")
    print(f"输出文件: {OUTPUT_FILE}")
    print()

    print("1. 加载数据文件...")
    try:
        df = pd.read_parquet(DATA_FILE)
        print(f"✅ 数据加载成功，共 {len(df)} 条记录")
        print(f"   列数: {len(df.columns)}")
        return df
    except Exception as e:
        print(f"❌ 数据加载失败: {e}")
        sys.exit(1)


def preprocess_data(df):
    """数据预处理"""
    print("\n2. 数据预处理...")

    # 显示数据列名
    print(f"   数据列: {list(df.columns)}")

    # 标准化列名（去除前后空格，转换为小写）
    df.columns = df.columns.str.strip().str.lower()

    # 处理日期字段
    date_cols = [col for col in df.columns if 'date' in col.lower() or '日期' in col or '期' in col]
    print(f"\n   日期字段: {date_cols}")

    # 转换日期字段
    for col in date_cols:
        try:
            df[col] = pd.to_datetime(df[col])
            if col == '保险起期':
                print(f"   ✅ 转换起保日期字段: {col}")
        except Exception as e:
            pass

    # 标准化起保日期字段
    df['起保日期_标准化'] = pd.to_datetime(df['保险起期'])

    return df


def calculate_daily_renewal(df):
    """计算每日续保率"""
    print("\n3. 计算每日续保率...")

    # 识别列名
    policy_no_col = '保单号' if '保单号' in df.columns else 'policy_no'
    renewal_no_col = '续保单号' if '续保单号' in df.columns else 'renewal_policy_no'
    start_date_col = '保险起期' if '保险起期' in df.columns else '起保日期'

    print(f"   使用列名:")
    print(f"   - 保单号: {policy_no_col}")
    print(f"   - 续保单号: {renewal_no_col}")
    print(f"   - 起保日期: {start_date_col}")

    # 筛选 2025年1月1日至1月8日的保单（这些是应续保的"旧保单"）
    mask_2025 = (df['起保日期_标准化'] >= START_DATE) & (df['起保日期_标准化'] <= END_DATE)
    policies_2025 = df[mask_2025].copy()

    print(f"\n   2025年1月上旬保单数（应续保单）: {len(policies_2025)}")

    # 筛选 2026年保单（用于匹配续保情况）
    mask_2026 = df['起保日期_标准化'].dt.year == 2026
    policies_2026 = df[mask_2026].copy()

    print(f"   2026年保单数（续保保单池）: {len(policies_2026)}")

    # 续保率计算逻辑：
    # 2025年保单在 2026年的保单中，如果续保单号字段指向2025年保单号，则表示已续保
    if renewal_no_col in policies_2026.columns:
        # 获取 2026 年保单的续保单号集合（这些是 2025 年的保单号）
        renewed_policy_nos_2026 = set(policies_2026[renewal_no_col].dropna().unique())
        print(f"   2026年保单中的续保单号数量: {len(renewed_policy_nos_2026)}")

        # 标记 2025 年保单的续保状态
        policies_2025['是否续保'] = policies_2025[policy_no_col].isin(renewed_policy_nos_2026)
        renewed_count = policies_2025['是否续保'].sum()
        print(f"   已续保的保单数: {renewed_count}")
    else:
        policies_2025['是否续保'] = False
        print(f"   ⚠️  警告: 未找到续保单号列 '{renewal_no_col}'")
        renewed_policy_nos_2026 = set()

    # 创建 2026 年保单的映射（用于获取续保保单的起保日期）
    policies_2026_map = {}
    if renewal_no_col in policies_2026.columns:
        # 续保单号 -> 2026年保单信息
        for _, p2026 in policies_2026.iterrows():
            old_policy_no = p2026[renewal_no_col]
            if pd.notna(old_policy_no) and old_policy_no != '':
                if old_policy_no not in policies_2026_map:
                    policies_2026_map[old_policy_no] = []
                policies_2026_map[old_policy_no].append(p2026)

    # 按日期分组统计
    daily_stats = []
    for date in pd.date_range(START_DATE, END_DATE):
        date_str = date.strftime('%Y-%m-%d')
        day_mask = policies_2025['起保日期_标准化'].dt.date == date.date()
        day_policies = policies_2025[day_mask]

        total_count = len(day_policies)
        renewed_count = day_policies['是否续保'].sum()
        renewal_rate = (renewed_count / total_count * 100) if total_count > 0 else 0

        daily_stats.append({
            '起保日期': date_str,
            '总保单件数': total_count,
            '已续保件数': int(renewed_count),
            '续保率_百分比': round(renewal_rate, 2)
        })

    daily_df = pd.DataFrame(daily_stats)

    print(f"\n   每日续保率统计:")
    print("   " + "-" * 60)
    for _, row in daily_df.iterrows():
        print(f"   {row['起保日期']}: 总件数={row['总保单件数']}, "
              f"已续保={row['已续保件数']}, 续保率={row['续保率_百分比']}%")
    print("   " + "-" * 60)

    return policies_2025, policies_2026, policies_2026_map, daily_df


def generate_renewal_details(policies_2025, policies_2026, policies_2026_map):
    """生成续保明细"""
    print("\n4. 生成续保明细...")

    # 识别列名
    policy_no_col = '保单号' if '保单号' in policies_2025.columns else 'policy_no'
    renewal_no_col = '续保单号' if '续保单号' in policies_2026.columns else 'renewal_policy_no'
    start_date_col = '保险起期'

    # 生成续保明细
    details = []
    for _, policy in policies_2025.iterrows():
        old_policy_no = policy[policy_no_col]  # 2025年保单号（旧保单）

        # 查找这个保单在 2026 年的续保保单
        renewal_policies = policies_2026_map.get(old_policy_no, [])

        # 获取起保日期
        start_date_value = policy[start_date_col]
        start_date_str = pd.to_datetime(start_date_value).strftime('%Y-%m-%d') if pd.notna(start_date_value) else ''

        # 构建明细记录
        detail = {
            '2025年保单号': old_policy_no,
            '2025年起保日期': start_date_str,
            '2026年起保日期': '',
            '2026年保单号': '',
            '保费': policy.get('保费', policy.get('premium', 0)),
            '客户类别': policy.get('客户类别', policy.get('customer_category', '')),
            '险类': policy.get('险类', policy.get('insurance_type', '')),
            '吨位分段': policy.get('吨位分段', policy.get('tonnage_segment', '')),
            '是否新能源': '是' if str(policy.get('是否新能源', policy.get('is_nev', ''))) in ['是', 'True', 'true', '1'] else '否',
            '是否过户': '是' if str(policy.get('是否过户车', policy.get('是否过户', policy.get('is_transfer', '')))) in ['是', 'True', 'true', '1'] else '否',
            '是否新车': '是' if str(policy.get('是否新车', policy.get('is_new_car', ''))) in ['是', 'True', 'true', '1'] else '否',
            '是否电销': '是' if str(policy.get('是否电销', policy.get('is_telemarketing', ''))) in ['是', 'True', 'true', '1'] else '否',
            '续保状态': '已续保' if policy.get('是否续保', False) else '未续保',
            '业务员': policy.get('业务员', policy.get('salesman_name', '')),
            '机构': policy.get('三级机构', policy.get('机构', policy.get('org_level_3', '')))
        }

        # 如果找到续保保单，填写续保信息
        if len(renewal_policies) > 0:
            # 取第一个续保保单（如果有多个续保，取第一个）
            renewal_policy = renewal_policies[0]
            detail['2026年保单号'] = renewal_policy[policy_no_col]
            renewal_start_date = renewal_policy[start_date_col]
            if pd.notna(renewal_start_date):
                detail['2026年起保日期'] = pd.to_datetime(renewal_start_date).strftime('%Y-%m-%d')

        details.append(detail)

    details_df = pd.DataFrame(details)

    # 按日期和续保状态排序
    details_df = details_df.sort_values(['2025年起保日期', '续保状态', '2025年保单号'])

    # 续保状态汇总
    renewed_count = (details_df['续保状态'] == '已续保').sum()
    not_renewed_count = (details_df['续保状态'] == '未续保').sum()

    print(f"   续保明细记录数: {len(details_df)}")
    print(f"   - 已续保: {renewed_count} 件")
    print(f"   - 未续保: {not_renewed_count} 件")

    return details_df


def export_to_excel(daily_df, details_df):
    """导出到 Excel"""
    print("\n5. 导出 Excel 文件...")

    try:
        with pd.ExcelWriter(OUTPUT_FILE, engine='openpyxl') as writer:
            # 工作表1：续保率分析
            daily_df.to_excel(writer, sheet_name='续保率分析', index=False)

            # 工作表2：续保明细
            details_df.to_excel(writer, sheet_name='续保明细', index=False)

        print(f"✅ Excel 文件已生成: {OUTPUT_FILE}")
        print(f"   文件大小: {OUTPUT_FILE.stat().st_size / 1024 / 1024:.2f} MB")

        return True
    except Exception as e:
        print(f"❌ Excel 导出失败: {e}")
        print(f"   提示: 请确保已安装 openpyxl: pip install openpyxl")
        return False


def main():
    """主函数"""
    try:
        # 加载数据
        df = load_data()

        # 数据预处理
        df = preprocess_data(df)

        # 计算每日续保率
        policies_2025, policies_2026, policies_2026_map, daily_df = calculate_daily_renewal(df)

        # 生成续保明细
        details_df = generate_renewal_details(policies_2025, policies_2026, policies_2026_map)

        # 导出到 Excel
        success = export_to_excel(daily_df, details_df)

        if success:
            print("\n" + "=" * 60)
            print("✅ 续保率分析完成！")
            print("=" * 60)
            print(f"\n输出文件: {OUTPUT_FILE}")
            print("\n说明:")
            print("- 2025年保单: 应续保的旧保单（2025年1月1日-1月8日起保）")
            print("- 2026年保单: 续保后的新保单")
            print("- 已续保: 2025年保单在2026年找到了续保保单")
            print("- 续保率 = 已续保件数 / 总保单件数")
            print("\n建议下一步:")
            print("1. 打开 Excel 文件查看详细数据")
            print("2. 使用数据透视表进行多维度分析")
            print("3. 生成图表展示续保率趋势")
        else:
            sys.exit(1)

    except Exception as e:
        print(f"\n❌ 脚本执行失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
