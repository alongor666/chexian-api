#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将Excel文件转换为parquet格式 - 优化版本 V2
适配新数据源：业务员车险签单清单_20241201至20260108.xlsx

主要改进：
1. 字段重命名：
   - 签单/批改保费含税 → 保费
   - 险别 → 险别组合
2. 新增字段：
   - 是否可续：根据批改类型判断（包含"解除合同"或"退保"为不可续）
3. 保留字段（名字不变）：
   - 批单号、是否交商统保、商车自主定价系数、批改类型
4. 提供两种模式：合并模式（保留唯一保单）vs 全量模式（保留所有记录）
5. 优化去重逻辑：提供基于不同主键的去重策略
6. 增加数据质量报告
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import json
import argparse
import sys

# 默认配置（可通过命令行参数覆盖）
DEFAULT_INPUT_FILE = Path("/Users/xuechenglong/Downloads/车险签单报价数据20260127_已匹配.xlsx")
DEFAULT_OUTPUT_FILE = Path("/Users/xuechenglong/Downloads/01-正开发Git项目/chexianYJFX/数据管理/warehouse/fact/policy/车险保单综合明细表0127.parquet")
DEFAULT_OUTPUT_MODE = "merged"  # "merged" = 合并批改记录（推荐）, "full" = 保留所有记录
QUALITY_REPORT_FILE = Path("./数据分析报告/转换质量报告.json")

def parse_args():
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description='将Excel文件转换为Parquet格式（车险保单数据专用）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 使用默认配置
  python3 Excel转Parquet_完整版.py

  # 指定输入输出文件
  python3 Excel转Parquet_完整版.py -i 新数据.xlsx -o 输出.parquet

  # 使用全量模式（保留批改记录）
  python3 Excel转Parquet_完整版.py -i 数据.xlsx -m full
        """
    )
    parser.add_argument('-i', '--input', type=str, help='输入Excel文件路径')
    parser.add_argument('-o', '--output', type=str, help='输出Parquet文件路径')
    parser.add_argument('-m', '--mode', choices=['merged', 'full'], default='merged',
                        help='处理模式: merged=合并批改记录(默认), full=保留所有记录')
    return parser.parse_args()

# 解析命令行参数
args = parse_args()
INPUT_FILE = Path(args.input) if args.input else DEFAULT_INPUT_FILE
OUTPUT_FILE = Path(args.output) if args.output else DEFAULT_OUTPUT_FILE
OUTPUT_MODE = args.mode

def analyze_data_quality(df, stage="原始数据"):
    """分析数据质量并生成报告"""
    print(f"\n{'='*80}")
    print(f"📊 数据质量分析 - {stage}")
    print(f"{'='*80}")

    report = {
        "stage": stage,
        "timestamp": datetime.now().isoformat(),
        "basic_stats": {
            "rows": len(df),
            "columns": len(df.columns),
            "column_names": list(df.columns)
        },
        "field_quality": {}
    }

    print(f"📋 基本统计:")
    print(f"   行数: {len(df):,}")
    print(f"   列数: {len(df.columns)}")

    # 分析关键字段的质量
    critical_fields = ['保单号', '业务员', '三级机构', '签单日期', '保险起期', '险类', '险别组合', '保费', '是否可续']

    for field in critical_fields:
        if field in df.columns:
            null_count = df[field].isna().sum()
            null_rate = null_count / len(df) * 100
            unique_count = df[field].nunique()

            print(f"\n   {field}:")
            print(f"      空值数: {null_count:,} ({null_rate:.2f}%)")
            print(f"      唯一值数: {unique_count:,}")

            report["field_quality"][field] = {
                "null_count": int(null_count),
                "null_rate": float(null_rate),
                "unique_count": int(unique_count)
            }

    # 保存报告
    if stage == "原始数据":
        QUALITY_REPORT_FILE.parent.mkdir(exist_ok=True)
        with open(QUALITY_REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    return report

def process_premium_field(df):
    """处理保费字段：将 '签单/批改保费含税' 或 '签单/批改保费' 重命名为 '保费'"""
    print(f"\n{'='*80}")
    print(f"💰 处理保费字段")
    print(f"{'='*80}")

    # 优先检查新字段名
    if '签单/批改保费' in df.columns:
        print("   发现字段: '签单/批改保费'")
        print(f"   数据类型: {df['签单/批改保费'].dtype}")
        print(f"   空值数: {df['签单/批改保费'].isna().sum():,}")
        print(f"   前5个值: {df['签单/批改保费'].head().tolist()}")

        # 重命名
        df['保费'] = df['签单/批改保费']
        print(f"   ✅ 已重命名为 '保费'")
    elif '签单/批改保费含税' in df.columns:
        print("   发现字段: '签单/批改保费含税'")
        print(f"   数据类型: {df['签单/批改保费含税'].dtype}")
        print(f"   空值数: {df['签单/批改保费含税'].isna().sum():,}")
        print(f"   前5个值: {df['签单/批改保费含税'].head().tolist()}")

        # 重命名
        df['保费'] = df['签单/批改保费含税']
        print(f"   ✅ 已重命名为 '保费'")
    elif '保费' in df.columns:
        print("   ✅ 字段 '保费' 已存在")
    else:
        print("   ⚠️  警告: 未找到保费相关字段")
        df['保费'] = 0.0  # 默认值

    # 统计保费总额
    if '保费' in df.columns:
        total_premium = df['保费'].sum()
        print(f"   保费总额: {total_premium:,.2f} 元")

    return df

def process_renewal_status(df):
    """处理是否续保字段和续保单号字段"""
    print(f"\n{'='*80}")
    print(f"🔄 处理是否续保字段和续保单号字段")
    print(f"{'='*80}")

    # 1. 检查是否有独立的"续保单号"列
    if '续保单号' in df.columns:
        # 清理续保单号：去除空字符串、nan等无效值
        df['续保单号'] = df['续保单号'].apply(
            lambda x: x if (pd.notna(x) and str(x).strip() != '' and str(x).lower() != 'nan') else None
        )
        valid_renewal_no_count = df['续保单号'].notna().sum()
        print(f"   ✅ 找到续保单号字段: {valid_renewal_no_count:,} 条有效续保单号 ({valid_renewal_no_count/len(df)*100:.2f}%)")

        # 根据续保单号设置"是否续保"（续保单号不为空则为True）
        df['是否续保'] = df['续保单号'].notna()
        print(f"   ✅ 是否续保逻辑：续保单号不为空 = True")

    # 2. 如果没有独立的"续保单号"列，检查"是否续保"列的内容
    elif '是否续保' in df.columns:
        print(f"   找到'是否续保'字段，检查内容类型...")

        # 检查"是否续保"列的值是否看起来像保单号（长度>10的字符串）
        sample_values = df['是否续保'].dropna().head(100).astype(str)
        looks_like_policy_no = sample_values.str.len().mean() > 10

        if looks_like_policy_no:
            # "是否续保"列实际存储的是续保单号
            print(f"   ⚠️  '是否续保'列实际存储的是续保单号（保单号格式）")
            print(f"   原始值分布（前10）:\n{df['是否续保'].value_counts(dropna=False).head(10)}")

            # 将"是否续保"列重命名/复制为"续保单号"
            df['续保单号'] = df['是否续保'].apply(
                lambda x: x if (pd.notna(x) and str(x).strip() != '' and str(x).lower() != 'nan') else None
            )
            valid_renewal_no_count = df['续保单号'].notna().sum()
            print(f"   ✅ 将'是否续保'转换为'续保单号': {valid_renewal_no_count:,} 条 ({valid_renewal_no_count/len(df)*100:.2f}%)")

            # 重新生成布尔值的"是否续保"
            df['是否续保'] = df['续保单号'].notna()
            print(f"   ✅ 重新生成布尔值'是否续保': 续保单号不为空 = True")
        else:
            # "是否续保"列存储的是布尔值
            print(f"   '是否续保'列是布尔值类型")
            df['是否续保'] = df['是否续保'].notna() & (df['是否续保'] != '') & (df['是否续保'] != 'nan')
            df['续保单号'] = None
            print(f"   ⚠️  未找到续保单号数据，续保单号列设为空")

    else:
        # 既没有"续保单号"也没有"是否续保"
        print("   ⚠️  未找到续保相关字段")
        df['是否续保'] = False
        df['续保单号'] = None

    renewal_count = df['是否续保'].sum()
    print(f"   续保记录（布尔值）: {renewal_count:,} ({renewal_count/len(df)*100:.2f}%)")

    return df

def process_coverage_combination(df):
    """重命名险别字段为险别组合"""
    print(f"\n{'='*80}")
    print(f"📦 重命名险别字段为险别组合")
    print(f"{'='*80}")

    if '险别' not in df.columns:
        print("   ⚠️  未找到 '险别' 字段")
        df['险别组合'] = '未知'
        return df

    print(f"   原始险别分布:")
    print(df['险别'].value_counts().head(10).to_string())

    # 直接重命名字段
    df['险别组合'] = df['险别']

    print(f"\n   ✅ 已将 '险别' 重命名为 '险别组合'")
    print(f"   险别组合分布:")
    print(df['险别组合'].value_counts().head(10).to_string())

    return df

def process_renewable_status(df):
    """处理是否可续字段：根据批改类型判断"""
    print(f"\n{'='*80}")
    print(f"♻️  处理是否可续字段")
    print(f"{'='*80}")

    if '批改类型' not in df.columns:
        print("   ⚠️  未找到 '批改类型' 字段，默认全部为可续")
        df['是否可续'] = True
        return df

    print(f"   批改类型分布:")
    print(df['批改类型'].value_counts(dropna=False).head(10).to_string())

    # 判断是否可续：批改类型包含"解除合同"或"退保"为不可续，其他为可续
    def is_renewable(batch_type):
        if pd.isna(batch_type):
            return True  # 空值默认可续
        batch_str = str(batch_type)
        # 包含"解除合同"或"退保"则为不可续
        if '解除合同' in batch_str or '退保' in batch_str:
            return False
        return True  # 其他情况可续

    df['是否可续'] = df['批改类型'].apply(is_renewable)

    renewable_count = df['是否可续'].sum()
    non_renewable_count = len(df) - renewable_count

    print(f"\n   可续保记录: {renewable_count:,} ({renewable_count/len(df)*100:.2f}%)")
    print(f"   不可续保记录: {non_renewable_count:,} ({non_renewable_count/len(df)*100:.2f}%)")

    # 显示不可续保的批改类型分布
    non_renewable_df = df[~df['是否可续']]
    if len(non_renewable_df) > 0:
        print(f"\n   不可续保的批改类型分布:")
        print(non_renewable_df['批改类型'].value_counts().to_string())

    return df

def process_telesales(df):
    """处理是否电销字段"""
    print(f"\n{'='*80}")
    print(f"📞 处理是否电销字段")
    print(f"{'='*80}")

    if '终端来源' not in df.columns:
        print("   ⚠️  未找到 '终端来源' 字段")
        df['是否电销'] = False
        return df

    print(f"   终端来源分布 (TOP 10):")
    print(df['终端来源'].value_counts().head(10).to_string())

    # 判断是否电销：0110开头或包含"融合销售"
    df['是否电销'] = df['终端来源'].astype(str).str.startswith('0110') | \
                     df['终端来源'].astype(str).str.contains('融合销售', na=False)

    telesales_count = df['是否电销'].sum()
    print(f"\n   电销记录: {telesales_count:,} ({telesales_count/len(df)*100:.2f}%)")

    return df

def process_boolean_fields(df):
    """处理布尔字段"""
    print(f"\n{'='*80}")
    print(f"☑️  处理布尔字段")
    print(f"{'='*80}")

    boolean_fields = {
        '是否新能源': '新能源车辆',
        '是否过户车': '过户车辆'
    }

    for field, label in boolean_fields.items():
        if field not in df.columns:
            continue

        print(f"\n   处理 {field}:")
        print(f"      原始值分布: {df[field].value_counts().to_dict()}")

        # 转换为布尔值
        df[field] = df[field].astype(str).map({
            'True': True, 'true': True, '是': True, '1': True,
            'False': False, 'false': False, '否': False, '0': False
        }).fillna(False)

        count = df[field].sum()
        print(f"      ✅ {label}: {count:,} ({count/len(df)*100:.2f}%)")

    return df

def process_new_car_status(df):
    """处理是否新车字段"""
    print(f"\n{'='*80}")
    print(f"🚗 处理是否新车字段")
    print(f"{'='*80}")

    if '是否新车' not in df.columns:
        print("   ⚠️  未找到 '是否新车' 字段")
        df['是否新车'] = False
        return df

    print(f"   原始值分布: {df['是否新车'].value_counts().to_dict()}")

    # N新车 = True, 其他 = False
    df['是否新车'] = df['是否新车'] == 'N新车'

    new_car_count = df['是否新车'].sum()
    print(f"   ✅ 新车: {new_car_count:,} ({new_car_count/len(df)*100:.2f}%)")

    return df

def process_new_fields(df):
    """处理新增字段"""
    print(f"\n{'='*80}")
    print(f"🆕 处理新增字段")
    print(f"{'='*80}")

    # 1. 处理车架号
    if '车架号' in df.columns:
        print(f"\n   处理车架号:")
        print(f"      数据类型: {df['车架号'].dtype}")
        print(f"      空值数: {df['车架号'].isna().sum():,}")
        print(f"      唯一值数: {df['车架号'].nunique():,}")
        # 重命名为车架号
        df['车架号'] = df['车架号'].astype(str)
        print(f"      ✅ 车架号字段处理完成")

    # 2. 处理是否报价
    if '是否报价' in df.columns:
        print(f"\n   处理是否报价:")
        print(f"      原始值分布: {df['是否报价'].value_counts().to_dict()}")
        
        # 转换为布尔值
        df['是否报价'] = df['是否报价'].astype(str).map({
            '是': True, 'True': True, '1': True,
            '否': False, 'False': False, '0': False
        }).fillna(False)
        
        quote_count = df['是否报价'].sum()
        print(f"      ✅ 报价记录: {quote_count:,} ({quote_count/len(df)*100:.2f}%)")

    # 3. 处理赔案件数（整数）
    if '案件数' in df.columns:
        print(f"\n   处理赔案件数:")
        print(f"      原始数据类型: {df['案件数'].dtype}")
        print(f"      空值数: {df['案件数'].isna().sum():,}")
        
        # 转换为整数，空值填充为0
        df['赔案件数'] = pd.to_numeric(df['案件数'], errors='coerce').fillna(0).astype('int64')
        
        avg_cases = df['赔案件数'].mean()
        print(f"      ✅ 赔案件数: 平均值 {avg_cases:.2f}, 整数类型")

    # 4. 处理已报告赔款
    if '赔款合计' in df.columns:
        print(f"\n   处理已报告赔款:")
        print(f"      原始数据类型: {df['赔款合计'].dtype}")
        print(f"      空值数: {df['赔款合计'].isna().sum():,}")
        
        # 转换为数值，空值填充为0
        df['已报告赔款'] = pd.to_numeric(df['赔款合计'], errors='coerce').fillna(0.0)
        
        total_claims = df['已报告赔款'].sum()
        print(f"      ✅ 已报告赔款: 总计 {total_claims:,.2f} 元")

    # 5. 处理费用金额
    if '总费用金额' in df.columns:
        print(f"\n   处理费用金额:")
        print(f"      原始数据类型: {df['总费用金额'].dtype}")
        print(f"      空值数: {df['总费用金额'].isna().sum():,}")
        
        # 转换为数值，空值填充为0
        df['费用金额'] = pd.to_numeric(df['总费用金额'], errors='coerce').fillna(0.0)
        
        total_fees = df['费用金额'].sum()
        print(f"      ✅ 费用金额: 总计 {total_fees:,.2f} 元")

    # 6. 处理续保模式
    if '续保业务类型' in df.columns:
        print(f"\n   处理续保模式:")
        print(f"      原始值分布: {df['续保业务类型'].value_counts().to_dict()}")
        
        # 重命名并保留原值（电续、自留、兜底）
        df['续保模式'] = df['续保业务类型'].astype(str)
        
        # 统计各种模式
        mode_counts = df['续保模式'].value_counts()
        print(f"      ✅ 续保模式分布:")
        for mode, count in mode_counts.items():
            print(f"         {mode}: {count:,} ({count/len(df)*100:.2f}%)")

    # 7. 处理车险分等级（字符串等级：A-G/X，保留原值）
    if '车险分等级' in df.columns:
        print(f"\n   处理车险分等级:")
        print(f"      原始值分布: {df['车险分等级'].value_counts(dropna=False).head(10).to_dict()}")
        df['车险分等级'] = df['车险分等级'].where(df['车险分等级'].notna(), None)
        grade_count = df['车险分等级'].notna().sum()
        print(f"      ✅ 车险分等级: {grade_count:,} 条有值 ({grade_count/len(df)*100:.2f}%)")

    # 8. 处理小货车评分（字符串等级：A-E/X）
    if '小货车评分' in df.columns:
        print(f"\n   处理小货车评分:")
        df['小货车评分'] = df['小货车评分'].where(df['小货车评分'].notna(), None)
        score_count = df['小货车评分'].notna().sum()
        print(f"      ✅ 小货车评分: {score_count:,} 条有值 ({score_count/len(df)*100:.2f}%)")

    # 9. 处理大货车评分（字符串等级：A-E/X）
    if '大货车评分' in df.columns:
        print(f"\n   处理大货车评分:")
        df['大货车评分'] = df['大货车评分'].where(df['大货车评分'].notna(), None)
        score_count = df['大货车评分'].notna().sum()
        print(f"      ✅ 大货车评分: {score_count:,} 条有值 ({score_count/len(df)*100:.2f}%)")

    # 10. 处理交叉销售标识（布尔值：是→True，否→False）
    if '交叉销售标识' in df.columns:
        print(f"\n   处理交叉销售标识:")
        print(f"      原始值分布: {df['交叉销售标识'].value_counts().to_dict()}")
        df['交叉销售标识'] = df['交叉销售标识'].astype(str).map({'是': True, '否': False}).fillna(False)
        cross_sell_count = df['交叉销售标识'].sum()
        print(f"      ✅ 交叉销售: {cross_sell_count:,} ({cross_sell_count/len(df)*100:.2f}%)")

    # 11. 处理交叉销售保费-驾意（数值，重命名去连字符）
    if '交叉销售保费-驾意' in df.columns:
        print(f"\n   处理交叉销售保费-驾意:")
        df['交叉销售保费_驾意'] = pd.to_numeric(df['交叉销售保费-驾意'], errors='coerce').fillna(0.0)
        total = df['交叉销售保费_驾意'].sum()
        print(f"      ✅ 交叉销售保费_驾意: 总计 {total:,.2f} 元")

    return df

def process_dates(df):
    """处理日期字段：转换为标准的 datetime64 格式"""
    print(f"\n{'='*80}")
    print(f"📅 处理日期字段")
    print(f"{'='*80}")

    date_fields = ['签单日期', '保险起期']

    for field in date_fields:
        if field not in df.columns:
            continue

        print(f"\n   处理 {field}:")
        print(f"      原始数据类型: {df[field].dtype}")

        # 转换为日期格式 (datetime64[ns])
        df[field] = pd.to_datetime(df[field], errors='coerce')

        # 检查转换失败的记录
        failed_count = df[field].isna().sum()
        if failed_count > 0:
            print(f"      ⚠️  {failed_count:,} 条记录转换失败")

        # 保持为 datetime64 格式（不转换为字符串）
        print(f"      转换后数据类型: {df[field].dtype}")

        # 统计日期范围
        valid_dates = df[field].dropna()
        if len(valid_dates) > 0:
            min_date = valid_dates.min()
            max_date = valid_dates.max()
            print(f"      日期范围: {min_date.strftime('%Y-%m-%d')} 至 {max_date.strftime('%Y-%m-%d')}")

    return df

def handle_duplicate_records(df):
    """处理重复记录"""
    print(f"\n{'='*80}")
    print(f"🔍 处理重复记录")
    print(f"{'='*80}")

    if OUTPUT_MODE == "full":
        print("   模式: 全量模式 - 保留所有记录（包括批改记录）")
        return df

    # 合并模式：按保单号去重
    print("   模式: 合并模式 - 合并批改记录")

    # 统计重复情况
    policy_counts = df['保单号'].value_counts()
    duplicated_policies = policy_counts[policy_counts > 1]

    print(f"\n   保单号统计:")
    print(f"      总记录数: {len(df):,}")
    print(f"      唯一保单数: {len(df['保单号'].unique()):,}")
    print(f"      重复保单数: {len(duplicated_policies):,}")
    print(f"      重复记录数: {duplicated_policies.sum():,}")

    if len(duplicated_policies) > 0:
        print(f"\n   重复最多的保单 (TOP 5):")
        for policy, count in duplicated_policies.head(5).items():
            print(f"      {policy}: {count} 次")

        # 在去重前，先对数值型累加字段按保单号求和
        agg_cols = ['保费', '已报告赔款', '费用金额', '赔案件数', '交叉销售保费_驾意']
        valid_agg_cols = [c for c in agg_cols if c in df.columns]
        
        if valid_agg_cols:
            for c in valid_agg_cols:
                df[c] = pd.to_numeric(df[c], errors='coerce').fillna(0)
            agg_df = df.groupby('保单号')[valid_agg_cols].sum().reset_index()

        # 去重策略：保留第一条记录
        print(f"\n   去重策略: 保留第一条记录，数值型字段累加汇总")
        df_dedup = df.drop_duplicates(subset=['保单号'], keep='first')

        if valid_agg_cols:
            df_dedup = df_dedup.drop(columns=valid_agg_cols)
            df_dedup = df_dedup.merge(agg_df, on='保单号', how='left')

        print(f"   去重前: {len(df):,} 行")
        print(f"   去重后: {len(df_dedup):,} 行")
        print(f"   丢失: {len(df) - len(df_dedup):,} 行 ({(len(df) - len(df_dedup))/len(df)*100:.2f}%)")

        return df_dedup
    else:
        print("   ✅ 无重复保单，无需去重")
        return df

def finalize_schema(df):
    """最终化数据结构：选择保留的字段、排序"""
    print(f"\n{'='*80}")
    print(f"🎯 最终化数据结构")
    print(f"{'='*80}")

    # 定义核心字段（必须保留）
    core_fields = [
        '保单号',
        '续保单号',  # ✅ 添加续保单号字段（用于续保率分析）
        '业务员',
        '三级机构',
        '签单日期',
        '保险起期',
        '险类',
        '险别组合',
        '保费',
        '是否续保',
        '是否可续',
        '是否新车',
        '是否新能源',
        '是否过户车',
        '是否电销',
        '终端来源',
        '客户类别',
        '厂牌车型',
        '吨位分段',
        '新车购置价'
    ]

    # 新增字段（如果存在）
    optional_fields = [
        '批单号',
        '批改类型',
        '商车自主定价系数',
        '是否交商统保',
        '车架号',
        '是否报价',
        '赔案件数',
        '已报告赔款',
        '费用金额',
        '续保模式',
        '车险分等级',
        '小货车评分',
        '大货车评分',
        '交叉销售标识',
        '交叉销售保费_驾意'
    ]

    # 选择存在的字段
    final_fields = [f for f in core_fields if f in df.columns]

    # 添加可选字段
    for field in optional_fields:
        if field in df.columns:
            final_fields.append(field)
            print(f"   ✅ 保留可选字段: {field}")

    # 按字段顺序重新排列
    df_final = df[final_fields]

    print(f"\n   最终字段数: {len(df_final.columns)}")
    print(f"   最终记录数: {len(df_final):,}")

    return df_final

def save_to_parquet(df, output_path):
    """保存为 Parquet 格式"""
    print(f"\n{'='*80}")
    print(f"💾 保存为 Parquet 格式")
    print(f"{'='*80}")

    print(f"   输出文件: {output_path}")
    print(f"   记录数: {len(df):,}")
    print(f"   字段数: {len(df.columns)}")

    # 显示数据类型
    print(f"\n   数据类型:")
    for col in df.columns:
        print(f"      {col}: {df[col].dtype}")

    # 保存
    df.to_parquet(output_path, index=False)
    print(f"\n   ✅ 成功保存到: {output_path}")

    # 验证
    df_verify = pd.read_parquet(output_path)
    print(f"   ✅ 验证成功: {len(df_verify):,} 条记录")

def main():
    """主函数"""
    print("="*80)
    print("🚀 Excel 转 Parquet 优化脚本 V2")
    print("="*80)
    print(f"输入文件: {INPUT_FILE}")
    print(f"输出文件: {OUTPUT_FILE}")
    print(f"处理模式: {OUTPUT_MODE}")
    print(f"运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if not INPUT_FILE.exists():
        print(f"\n❌ 错误: 输入文件不存在")
        return

    # 1. 加载数据
    print(f"\n{'='*80}")
    print(f"📂 加载数据")
    print(f"{'='*80}")
    df = pd.read_excel(INPUT_FILE)
    print(f"✅ 加载成功: {len(df):,} 行 × {len(df.columns)} 列")

    # 2. 分析原始数据质量
    analyze_data_quality(df, "原始数据")

    # 3. 处理保费字段
    df = process_premium_field(df)

    # 4. 处理续保标志
    df = process_renewal_status(df)

    # 5. 重命名险别为险别组合
    df = process_coverage_combination(df)

    # 6. 处理是否可续标志
    df = process_renewable_status(df)

    # 7. 处理电销标志
    df = process_telesales(df)

    # 8. 处理布尔字段
    df = process_boolean_fields(df)

    # 9. 处理新车标志
    df = process_new_car_status(df)

    # 9.5. 处理新增字段
    df = process_new_fields(df)

    # 10. 处理日期字段
    df = process_dates(df)

    # 11. 处理重复记录
    df = handle_duplicate_records(df)

    # 12. 最终化数据结构
    df = finalize_schema(df)

    # 13. 分析最终数据质量
    analyze_data_quality(df, "最终数据")

    # 14. 保存为 Parquet
    save_to_parquet(df, OUTPUT_FILE)

    print(f"\n{'='*80}")
    print("✅ 转换完成！")
    print(f"{'='*80}")

if __name__ == "__main__":
    main()
