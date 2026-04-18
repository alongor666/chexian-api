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
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path
from datetime import datetime
import json
import argparse
import sys
import time

# Excel 引擎（calamine 比 openpyxl 快 5-10x；与 etl_validation.EXCEL_ENGINE 保持同步）
EXCEL_ENGINE = 'calamine'

# 默认配置（可通过命令行参数覆盖）
DEFAULT_INPUT_FILE = Path("/Users/xuechenglong/Downloads/车险签单报价数据20260127_已匹配.xlsx")
DEFAULT_OUTPUT_FILE = Path("/Users/xuechenglong/Downloads/01-正开发Git项目/chexianYJFX/数据管理/warehouse/fact/policy/车险保单综合明细表0127.parquet")
DEFAULT_OUTPUT_MODE = "full"  # "full" = 保留所有记录（分析默认）, "merged" = 显式合并批改记录
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
    parser.add_argument('-m', '--mode', choices=['merged', 'full'], default='full',
                        help='处理模式: full=保留所有记录(默认), merged=合并批改记录')
    parser.add_argument('-r', '--renewal-source', type=str, help='续保业务类型源文件路径（可选）')
    parser.add_argument('--domain', choices=['policy', 'claims', 'quotes', 'all'],
                        default='all', help='输出域: policy(排除赔付费用报价), claims(赔付+费用), quotes(报价), all(默认全量)')
    parser.add_argument('--after-date', type=str, default=None,
                        help='增量模式：只保留签单日期 > 此日期的记录（格式 YYYY-MM-DD 或 YYYYMMDD）')
    parser.add_argument('--force', action='store_true',
                        help='跳过 Schema 契约检查（仅调试用，生产禁止）')
    return parser.parse_args()

# 解析命令行参数
args = parse_args()
INPUT_FILE = Path(args.input) if args.input else DEFAULT_INPUT_FILE
OUTPUT_FILE = Path(args.output) if args.output else DEFAULT_OUTPUT_FILE
OUTPUT_MODE = args.mode
RENEWAL_SOURCE_FILE = Path(args.renewal_source) if args.renewal_source else None
DOMAIN = args.domain          # 输出域: policy/claims/quotes/all
AFTER_DATE = args.after_date  # 增量截止日期

POLICY_KEY_ALIASES = ['保单号', '保单号码', '保单编号', '保单']

# ── 新格式列名 → 标准内部列名映射 ──
# transform.py 全程使用标准名处理，新格式输入在管道最前端统一重命名
NEW_FORMAT_RENAMES = {
    '签单保费': '保费',
    '交商同保': '是否交商统保',
    '客户源类型': '客户源',
    '是否新能源车': '是否新能源',
    '自主定价系数': '商车自主定价系数',
    '厂牌车型名称': '厂牌车型',
    '客户类别3': '客户类别',
    '是否过户': '是否过户车',
    '交强险NCD分组': '交强险NCD',
}

def normalize_input_columns(df):
    """将新格式列名映射为标准内部列名，使下游处理函数无需修改"""
    rename_map = {k: v for k, v in NEW_FORMAT_RENAMES.items() if k in df.columns and v not in df.columns}
    if rename_map:
        df = df.rename(columns=rename_map)
        print(f"\n   🔄 新格式列名标准化: {len(rename_map)} 列")
        for old_name, new_name in rename_map.items():
            print(f"      {old_name} → {new_name}")
    # 24-26 重复列去重：高速风险等级出现两次，pandas 自动后缀 .1
    if '高速风险等级.1' in df.columns:
        df = df.drop(columns=['高速风险等级.1'])
        print(f"      去除重复列: 高速风险等级.1")
    return df
RENEWAL_TYPE_ALIASES = ['续保业务类型', '续保类型', '业务类型', '续保分类']

def first_existing_column(columns, candidates):
    """返回第一个存在于列集合中的候选列名"""
    column_set = set(columns)
    for name in candidates:
        if name in column_set:
            return name
    return None

def normalize_policy_series(series):
    """标准化保单号，避免匹配失败"""
    normalized = series.astype(str).str.strip()
    normalized = normalized.replace({'': np.nan, 'nan': np.nan, 'None': np.nan})
    normalized = normalized.str.replace(r'\.0$', '', regex=True)
    return normalized

def load_target_excel(input_file, dtype_map):
    """加载目标 Excel，自动合并可用工作表"""
    start_ts = time.perf_counter()
    sheet_data = pd.read_excel(input_file, sheet_name=None, dtype=dtype_map, engine=EXCEL_ENGINE)
    if isinstance(sheet_data, pd.DataFrame):
        elapsed = time.perf_counter() - start_ts
        print(f"✅ 加载成功: {len(sheet_data):,} 行 × {len(sheet_data.columns)} 列（{elapsed:.2f}s）")
        return sheet_data

    valid_frames = []
    base_columns = None
    headerless_sheets = []
    for sheet_name, sheet_df in sheet_data.items():
        if not isinstance(sheet_df, pd.DataFrame) or sheet_df.empty:
            continue
        key_column = first_existing_column(sheet_df.columns, POLICY_KEY_ALIASES)
        if key_column is None:
            headerless_sheets.append(sheet_name)
            continue
        if base_columns is None:
            base_columns = list(sheet_df.columns)
        valid_frames.append(sheet_df)
        print(f"   读取工作表: {sheet_name}，行数: {len(sheet_df):,}")

    if base_columns is not None and headerless_sheets:
        for sheet_name in headerless_sheets:
            raw_sheet = pd.read_excel(input_file, sheet_name=sheet_name, header=None, engine=EXCEL_ENGINE)
            if raw_sheet.empty:
                continue
            n_cols = raw_sheet.shape[1]
            n_base = len(base_columns)
            if n_cols > n_base:
                print(f"   ⚠ 跳过续表 {sheet_name}：列数 {n_cols} > 基准 {n_base}")
                continue
            if n_cols < n_base:
                # 续表列数少于基准（源系统导出续表时末尾列缺失）→ NaN 填充
                for i in range(n_cols, n_base):
                    raw_sheet[i] = np.nan
                print(f"   读取续表: {sheet_name}，行数: {len(raw_sheet):,}（补 {n_base - n_cols} 列 NaN）")
            else:
                print(f"   读取续表: {sheet_name}，行数: {len(raw_sheet):,}")
            raw_sheet.columns = base_columns
            key_column = first_existing_column(raw_sheet.columns, POLICY_KEY_ALIASES)
            if key_column is None:
                continue
            valid_frames.append(raw_sheet)

    if not valid_frames:
        raise ValueError("未找到包含保单号字段的工作表")

    if len(valid_frames) == 1:
        df = valid_frames[0]
    else:
        df = pd.concat(valid_frames, ignore_index=True)

    elapsed = time.perf_counter() - start_ts
    print(f"✅ 加载成功: {len(df):,} 行 × {len(df.columns)} 列（{elapsed:.2f}s）")
    return df

def merge_renewal_type_from_source(df, renewal_source_file):
    """把续保业务类型从源文件匹配到主数据"""
    if renewal_source_file is None:
        print("   未提供续保源文件，跳过续保业务类型匹配")
        return df

    if not renewal_source_file.exists():
        print(f"   ⚠️  续保源文件不存在，跳过匹配: {renewal_source_file}")
        return df

    print(f"   续保源文件: {renewal_source_file}")
    source_columns = pd.read_excel(renewal_source_file, nrows=0, engine=EXCEL_ENGINE).columns.tolist()
    source_key_col = first_existing_column(source_columns, POLICY_KEY_ALIASES)
    source_type_col = first_existing_column(source_columns, RENEWAL_TYPE_ALIASES)
    target_key_col = first_existing_column(df.columns, POLICY_KEY_ALIASES)

    if source_key_col is None or source_type_col is None or target_key_col is None:
        print("   ⚠️  续保匹配列未找到，跳过匹配")
        return df

    start_ts = time.perf_counter()
    source_df = pd.read_excel(
        renewal_source_file,
        usecols=[source_key_col, source_type_col],
        dtype={source_key_col: str, source_type_col: str},
        engine=EXCEL_ENGINE,
    )
    source_df[source_key_col] = normalize_policy_series(source_df[source_key_col])
    source_df[source_type_col] = source_df[source_type_col].astype(str).str.strip()
    source_df = source_df.dropna(subset=[source_key_col]).drop_duplicates(subset=[source_key_col], keep='last')
    source_mapping = source_df.set_index(source_key_col)[source_type_col]

    target_key_series = normalize_policy_series(df[target_key_col])
    existing_series = df['续保业务类型'] if '续保业务类型' in df.columns else pd.Series([None] * len(df), index=df.index)
    mapped_series = target_key_series.map(source_mapping)
    if mapped_series.notna().sum() == 0 and '是否续保' in df.columns:
        alt_key_series = normalize_policy_series(df['是否续保'])
        mapped_series = alt_key_series.map(source_mapping)
    df['续保业务类型'] = existing_series.where(existing_series.notna() & (existing_series.astype(str).str.strip() != ''), mapped_series)

    matched_rows = df['续保业务类型'].notna().sum()
    elapsed = time.perf_counter() - start_ts
    print(f"   ✅ 续保业务类型匹配完成: {matched_rows:,}/{len(df):,}（{elapsed:.2f}s）")
    return df

def normalize_identifier_columns(df):
    """标准化标识字段类型"""
    columns = ['保单号', '续保单号', '批单号', '车架号', '车牌号码']
    for column in columns:
        if column not in df.columns:
            continue
        normalized = df[column].astype(str).str.strip()
        normalized = normalized.replace({'': np.nan, 'nan': np.nan, 'None': np.nan})
        normalized = normalized.str.replace(r'\.0$', '', regex=True)
        df[column] = normalized.where(normalized.notna(), None)
    return df

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
        renewal_no = df['续保单号'].astype(str).str.strip()
        renewal_no = renewal_no.replace({'': np.nan, 'nan': np.nan, 'None': np.nan})
        df['续保单号'] = renewal_no.where(renewal_no.notna(), None)
        valid_renewal_no_count = df['续保单号'].notna().sum()
        print(f"   ✅ 找到续保单号字段: {valid_renewal_no_count:,} 条有效续保单号 ({valid_renewal_no_count/len(df)*100:.2f}%)")

        # 根据续保单号设置"是否续保"（续保单号不为空则为True）
        df['是否续保'] = df['续保单号'].notna()
        print(f"   ✅ 是否续保逻辑：续保单号不为空 = True")

    # 2. 如果没有独立的"续保单号"列，检查"是否续保"列的内容
    elif '是否续保' in df.columns:
        print(f"   找到'是否续保'字段，检查内容类型...")

        # 更智能的判断：检查是否有数字/保单号格式的值（长度>=10或包含数字）
        def is_policy_number_format(val):
            if pd.isna(val):
                return False
            s = str(val).strip().lower()
            if s in ('', 'nan', 'none', '是', '否', 'true', 'false'):
                return False
            # 保单号通常是长数字串或包含数字
            has_digits = any(c.isdigit() for c in s)
            is_long = len(s) >= 10
            return has_digits and is_long

        # 检查是否有保单号格式的值
        sample_values = df['是否续保'].dropna().head(100)
        has_policy_format = sample_values.apply(is_policy_number_format).any()

        if has_policy_format:
            # "是否续保"列实际存储的是续保单号
            print(f"   ⚠️  '是否续保'列实际存储的是续保单号（保单号格式）")
            print(f"   原始值分布（前10）:\n{df['是否续保'].value_counts(dropna=False).head(10)}")

            # 将"是否续保"列重命名/复制为"续保单号"
            policy_mask = df['是否续保'].astype(str).map(is_policy_number_format)
            df['续保单号'] = df['是否续保'].astype(str).str.strip().where(policy_mask, None)
            valid_renewal_no_count = df['续保单号'].notna().sum()
            print(f"   ✅ 将'是否续保'转换为'续保单号': {valid_renewal_no_count:,} 条 ({valid_renewal_no_count/len(df)*100:.2f}%)")

            # 重新生成布尔值的"是否续保"
            df['是否续保'] = df['续保单号'].notna()
            print(f"   ✅ 重新生成布尔值'是否续保': 续保单号不为空 = True")
        else:
            # "是否续保"列存储的是布尔值
            print(f"   '是否续保'列是布尔值类型")
            yes_values = {'是', 'true', '1', 'yes'}
            df['是否续保'] = df['是否续保'].astype(str).str.strip().str.lower().isin(yes_values)
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

    if '险别组合' in df.columns:
        print("   ✅ '险别组合' 字段已存在（新格式）")
        return df

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
        print("   ⚠️  未找到 '批改类型' 字段（新格式无此字段），是否可续设为 NULL")
        df['是否可续'] = None
        return df

    print(f"   批改类型分布:")
    print(df['批改类型'].value_counts(dropna=False).head(10).to_string())

    batch_type = df['批改类型'].astype(str)
    non_renewable_mask = batch_type.str.contains('解除合同|退保', regex=True, na=False)
    df['是否可续'] = ~non_renewable_mask

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
        
        # 派生续保模式并删除源列（避免 rename 后残留中文列名）
        df['续保模式'] = df['续保业务类型'].astype(str)
        df.drop(columns=['续保业务类型'], inplace=True)

        # 统计各种模式
        mode_counts = df['续保模式'].value_counts()
        print(f"      ✅ 续保模式分布:")
        for mode, count in mode_counts.items():
            print(f"         {mode}: {count:,} ({count/len(df)*100:.2f}%)")

    # 7. 合并车险风险等级（三字段互斥：车险分等级/小货车评分/大货车评分 → 车险风险等级）
    grade_sources = ['车险分等级', '小货车评分', '大货车评分']
    for col in grade_sources:
        if col not in df.columns:
            df[col] = None
        else:
            df[col] = df[col].where(df[col].notna(), None)
    print(f"\n   合并车险风险等级（COALESCE: 车险分等级 > 小货车评分 > 大货车评分）:")
    df['车险风险等级'] = df['车险分等级'].fillna(df['小货车评分']).fillna(df['大货车评分'])
    grade_count = df['车险风险等级'].notna().sum()
    print(f"      ✅ 车险风险等级: {grade_count:,} 条有值 ({grade_count/len(df)*100:.2f}%)")
    print(f"      值分布: {df['车险风险等级'].value_counts(dropna=False).head(10).to_dict()}")
    df.drop(columns=grade_sources, inplace=True, errors='ignore')

    # 10. 处理交叉销售标识（布尔值：是→True，否→False）
    cross_sell_col = None
    if '交叉销售标识' in df.columns:
        cross_sell_col = '交叉销售标识'
    elif '交叉销售标识-驾意' in df.columns:
        cross_sell_col = '交叉销售标识-驾意'

    if cross_sell_col:
        print(f"\n   处理交叉销售标识:")
        print(f"      原始值分布: {df[cross_sell_col].value_counts().to_dict()}")
        df['交叉销售标识'] = df[cross_sell_col].astype(str).map({'是': True, '否': False}).fillna(False)
        cross_sell_count = df['交叉销售标识'].sum()
        print(f"      ✅ 交叉销售: {cross_sell_count:,} ({cross_sell_count/len(df)*100:.2f}%)")

    # 11. 处理交叉销售保费-驾意（数值，重命名去连字符）
    if '交叉销售保费-驾意' in df.columns:
        print(f"\n   处理交叉销售保费-驾意:")
        df['交叉销售保费_驾意'] = pd.to_numeric(df['交叉销售保费-驾意'], errors='coerce').fillna(0.0)
        total = df['交叉销售保费_驾意'].sum()
        print(f"      ✅ 交叉销售保费_驾意: 总计 {total:,.2f} 元")

    # 12. 处理三者保额
    if '三者保额' in df.columns:
        print(f"\n   处理三者保额:")
        df['三者保额'] = pd.to_numeric(df['三者保额'], errors='coerce').fillna(0.0)
        avg_val = df['三者保额'].mean()
        print(f"      ✅ 三者保额: 平均值 {avg_val:,.2f}")

    # 13. 处理司机保额
    if '司机保额' in df.columns:
        print(f"\n   处理司机保额:")
        df['司机保额'] = pd.to_numeric(df['司机保额'], errors='coerce').fillna(0.0)
        avg_val = df['司机保额'].mean()
        print(f"      ✅ 司机保额: 平均值 {avg_val:,.2f}")

    # 14. 处理乘客险保额
    if '乘客险保额' in df.columns:
        print(f"\n   处理乘客险保额:")
        df['乘客险保额'] = pd.to_numeric(df['乘客险保额'], errors='coerce').fillna(0.0)
        avg_val = df['乘客险保额'].mean()
        print(f"      ✅ 乘客险保额: 平均值 {avg_val:,.2f}")

    # 15. 处理车牌号码（只保留前2位）
    if '车牌号码' in df.columns:
        print(f"\n   处理车牌号码:")
        print(f"      数据类型: {df['车牌号码'].dtype}")
        print(f"      空值数: {df['车牌号码'].isna().sum():,}")
        df['车牌号码'] = df['车牌号码'].astype(str).str[:2].where(df['车牌号码'].notna(), None)
        sample_vals = df['车牌号码'].dropna().head(3).tolist()
        print(f"      示例值: {sample_vals}")
        print(f"      ✅ 车牌号码字段处理完成(保留前2位)")

    # 16. 处理座位数（整数）
    if '座位数' in df.columns:
        print(f"\n   处理座位数:")
        print(f"      原始数据类型: {df['座位数'].dtype}")
        print(f"      空值数: {df['座位数'].isna().sum():,}")
        df['座位数'] = pd.to_numeric(df['座位数'], errors='coerce').fillna(0).astype('int64')
        dist = df['座位数'].value_counts().head(10).to_dict()
        print(f"      ✅ 座位数分布 (TOP10): {dist}")

    # 17. 处理代理人/经纪人 → 经代名（重命名）
    if '代理人/经纪人' in df.columns:
        print(f"\n   处理代理人/经纪人:")
        print(f"      原始数据类型: {df['代理人/经纪人'].dtype}")
        print(f"      空值数: {df['代理人/经纪人'].isna().sum():,}")
        # 重命名为经代名
        df['经代名'] = df['代理人/经纪人'].astype(str).where(df['代理人/经纪人'].notna(), None)
        unique_count = df['经代名'].nunique()
        print(f"      ✅ '代理人/经纪人' → '经代名': {unique_count} 个唯一值")

    # 18. 处理客户源（字符串，保留原值）
    if '客户源' in df.columns:
        print(f"\n   处理客户源:")
        print(f"      原始数据类型: {df['客户源'].dtype}")
        print(f"      空值数: {df['客户源'].isna().sum():,}")
        df['客户源'] = df['客户源'].astype(str).where(df['客户源'].notna(), None)
        value_counts = df['客户源'].value_counts().head(10).to_dict()
        print(f"      ✅ 客户源分布 (TOP10): {value_counts}")

    # 19. 处理被保险人年龄分组（字符串，保留原值）
    if '被保险人年龄分组' in df.columns:
        print(f"\n   处理被保险人年龄分组:")
        print(f"      原始数据类型: {df['被保险人年龄分组'].dtype}")
        print(f"      空值数: {df['被保险人年龄分组'].isna().sum():,}")
        df['被保险人年龄分组'] = df['被保险人年龄分组'].astype(str).where(df['被保险人年龄分组'].notna(), None)
        value_counts = df['被保险人年龄分组'].value_counts().head(10).to_dict()
        print(f"      ✅ 被保险人年龄分组分布 (TOP10): {value_counts}")

    # 20. 处理燃料种类（字符串，保留原值；旧数据有，新数据无此字段）
    if '燃料种类' in df.columns:
        print(f"\n   处理燃料种类:")
        print(f"      原始数据类型: {df['燃料种类'].dtype}")
        print(f"      空值数: {df['燃料种类'].isna().sum():,}")
        df['燃料种类'] = df['燃料种类'].astype(str).where(df['燃料种类'].notna(), None)
        value_counts = df['燃料种类'].value_counts().head(10).to_dict()
        print(f"      ✅ 燃料种类分布 (TOP10): {value_counts}")
    else:
        print(f"\n   ⚠️ 源数据无 '燃料种类' 字段，跳过")

    # 21. 处理初次登记年月（字符串，保留原值或 可计算车龄）
    if '初次登记年月' in df.columns:
        print(f"\n   处理初次登记年月:")
        print(f"      原始数据类型: {df['初次登记年月'].dtype}")
        print(f"      空值数: {df['初次登记年月'].isna().sum():,}")
        df['初次登记年月'] = df['初次登记年月'].astype(str).where(df['初次登记年月'].notna(), None)
        value_counts = df['初次登记年月'].value_counts().head(10).to_dict()
        print(f"      ✅ 初次登记年月分布 (TOP10): {value_counts}")

    # ── 新格式字段（21-23/24-26）──

    # 22. 被保险人性别（字符串）
    if '被保险人性别' in df.columns:
        print(f"\n   处理被保险人性别:")
        df['被保险人性别'] = df['被保险人性别'].astype(str).where(df['被保险人性别'].notna(), None)
        dist = df['被保险人性别'].value_counts().to_dict()
        print(f"      ✅ 性别分布: {dist}")

    # 23. 货车类型（字符串）
    if '货车类型' in df.columns:
        print(f"\n   处理货车类型:")
        df['货车类型'] = df['货车类型'].astype(str).where(df['货车类型'].notna(), None)
        non_null = df['货车类型'].notna().sum()
        print(f"      ✅ 货车类型: {non_null:,} 条有值")

    # 24. 吨位数（数值）
    if '吨位数' in df.columns:
        print(f"\n   处理吨位数:")
        df['吨位数'] = pd.to_numeric(df['吨位数'], errors='coerce')
        non_null = df['吨位数'].notna().sum()
        print(f"      ✅ 吨位数: {non_null:,} 条有值")

    # 25. 无赔款优待记录（字符串）
    if '无赔款优待记录' in df.columns:
        print(f"\n   处理无赔款优待记录:")
        df['无赔款优待记录'] = df['无赔款优待记录'].astype(str).where(df['无赔款优待记录'].notna(), None)
        non_null = df['无赔款优待记录'].notna().sum()
        print(f"      ✅ 无赔款优待记录: {non_null:,} 条有值")

    # 26. 交强险NCD（字符串）
    if '交强险NCD' in df.columns:
        print(f"\n   处理交强险NCD:")
        df['交强险NCD'] = df['交强险NCD'].astype(str).where(df['交强险NCD'].notna(), None)
        non_null = df['交强险NCD'].notna().sum()
        print(f"      ✅ 交强险NCD: {non_null:,} 条有值")

    # 27. 商业险NCD（字符串）
    if '商业险NCD' in df.columns:
        print(f"\n   处理商业险NCD:")
        df['商业险NCD'] = df['商业险NCD'].astype(str).where(df['商业险NCD'].notna(), None)
        non_null = df['商业险NCD'].notna().sum()
        print(f"      ✅ 商业险NCD: {non_null:,} 条有值")

    # 28. 高速风险等级（字符串）
    if '高速风险等级' in df.columns:
        print(f"\n   处理高速风险等级:")
        df['高速风险等级'] = df['高速风险等级'].astype(str).where(df['高速风险等级'].notna(), None)
        non_null = df['高速风险等级'].notna().sum()
        print(f"      ✅ 高速风险等级: {non_null:,} 条有值")

    # 29. 车险分分数（数值，24-26用）
    if '车险分分数' in df.columns:
        print(f"\n   处理车险分分数:")
        df['车险分分数'] = pd.to_numeric(df['车险分分数'], errors='coerce')
        non_null = df['车险分分数'].notna().sum()
        print(f"      ✅ 车险分分数: {non_null:,} 条有值")

    return df

def split_admin_account(df):
    """拆分 adminadmin 系统账号为按三级机构的虚拟业务员。

    adminadmin 是各机构共用的系统账号，出单时挂在不同三级机构下。
    将 业务员='adminadmin' 的记录按 三级机构 拆分为 'admin{三级机构}直接个代'。
    例：admin乐山直接个代、admin天府直接个代。
    """
    if '业务员' not in df.columns or '三级机构' not in df.columns:
        return df

    mask = df['业务员'].astype(str).str.strip() == 'adminadmin'
    count = mask.sum()
    if count == 0:
        return df

    print(f"\n{'='*80}")
    print(f"👤 拆分 adminadmin 系统账号")
    print(f"{'='*80}")
    print(f"   匹配记录: {count:,} 条")

    orgs = df.loc[mask, '三级机构'].value_counts()
    print(f"   涉及机构: {len(orgs)} 个")
    for org, cnt in orgs.items():
        print(f"      {org}: {cnt:,} 条 → admin{org}直接个代")

    df.loc[mask, '业务员'] = 'admin' + df.loc[mask, '三级机构'].astype(str) + '直接个代'

    print(f"   ✅ 拆分完成")
    return df

def process_dates(df):
    """处理日期字段：转换为标准的 datetime64 格式

    关键重命名：源数据"缴费日期"→ Parquet"签单日期"（保持后端 policy_date 映射不变）
    源数据的原"签单日期"已重命名为"提核日期"，作为独立字段保留。
    """
    print(f"\n{'='*80}")
    print(f"📅 处理日期字段")
    print(f"{'='*80}")

    # 缴费日期 → 签单日期（保持 Parquet 列名与后端映射一致）
    if '缴费日期' in df.columns:
        if '签单日期' in df.columns:
            print("   ⚠️  同时存在'签单日期'和'缴费日期'，'签单日期'已重命名为'提核日期'")
            if '提核日期' not in df.columns:
                df['提核日期'] = df['签单日期']
                print("   ✅ 原'签单日期' → '提核日期'")
        df['签单日期'] = df['缴费日期']
        print("   ✅ '缴费日期' → '签单日期'（供 policy_date 映射使用）")

    date_fields = ['签单日期', '保险起期', '提核日期', '保险止期']

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
    """最终化数据结构：根据 DOMAIN 参数选择保留的字段"""
    print(f"\n{'='*80}")
    print(f"🎯 最终化数据结构 (域: {DOMAIN})")
    print(f"{'='*80}")

    # ── 域模式：claims（赔付+费用）──
    if DOMAIN == 'claims':
        claims_fields = ['保单号', '车架号', '赔案件数', '已报告赔款', '费用金额']
        final_fields = [f for f in claims_fields if f in df.columns]
        df_final = df[final_fields].copy()
        # 按保单号聚合去重（同一保单可能有多条记录：原单+批改）
        agg_cols = [c for c in ['赔案件数', '已报告赔款', '费用金额'] if c in df_final.columns]
        if agg_cols:
            agg_dict = {c: 'sum' for c in agg_cols}
            if '车架号' in df_final.columns:
                agg_dict['车架号'] = 'first'
            df_final = df_final.groupby('保单号', as_index=False).agg(agg_dict)
        # 只保留有赔付或费用数据的行
        has_data = (
            (df_final.get('赔案件数', pd.Series(0)) != 0) |
            (df_final.get('已报告赔款', pd.Series(0)) != 0) |
            (df_final.get('费用金额', pd.Series(0)) != 0)
        )
        df_final = df_final[has_data]
        print(f"   Claims 域: {len(df_final):,} 行（按保单号聚合去重）, {len(final_fields)} 列")
        return df_final

    # ── 域模式：quotes（报价状态）──
    if DOMAIN == 'quotes':
        # 只保留 是否报价=True 且 续保单号非空
        if '是否报价' in df.columns:
            df = df[df['是否报价'] == True].copy()
        quotes_fields = ['续保单号', '签单日期']
        final_fields = [f for f in quotes_fields if f in df.columns]
        df_final = df[final_fields].copy()
        if '续保单号' in df_final.columns:
            df_final = df_final[df_final['续保单号'].notna() & (df_final['续保单号'] != '')]
            df_final = df_final.drop_duplicates(subset=['续保单号'], keep='first')
        print(f"   Quotes 域: {len(df_final):,} 行（续保单号去重）, {len(final_fields)} 列")
        return df_final

    # ── 域模式：policy（排除赔付/费用/报价）或 all（全量兼容）──
    policy_exclude = {'是否报价', '赔案件数', '已报告赔款', '费用金额'} if DOMAIN == 'policy' else set()

    # ── 字段列表从 etl_fields.json 读取（由 field-registry codegen 生成）──
    etl_fields_path = Path(__file__).resolve().parent / 'etl_fields.json'
    try:
        with open(etl_fields_path) as f:
            etl_fields = json.load(f)
        core_fields = etl_fields['core_fields']
        optional_fields = etl_fields['optional_fields']
    except (FileNotFoundError, json.JSONDecodeError, KeyError) as e:
        print(f"   ❌ etl_fields.json 读取失败: {e}")
        print(f"      → 运行 node scripts/field-registry/generate.mjs 重新生成")
        sys.exit(1)

    final_fields = [f for f in core_fields if f in df.columns and f not in policy_exclude]
    for field in optional_fields:
        if field in df.columns and field not in policy_exclude:
            final_fields.append(field)
            print(f"   ✅ 保留可选字段: {field}")

    # ── Schema 契约：检测未处理字段 ──
    # 显式忽略列表从 shard-config.json 读取（单一事实源，git 跟踪可审计）
    config_path = Path(__file__).resolve().parent.parent / 'shard-config.json'
    try:
        with open(config_path) as f:
            shard_config = json.load(f)
        explicitly_ignored = set(shard_config.get('explicitly_ignored_fields', {}).keys())
    except (FileNotFoundError, json.JSONDecodeError):
        print("   ⚠️ shard-config.json 读取失败，Schema 契约使用空忽略列表")
        explicitly_ignored = set()
    all_known = set(final_fields) | set(core_fields) | set(optional_fields) | explicitly_ignored
    unknown_cols = [c for c in df.columns if c not in all_known]
    if unknown_cols:
        print(f"\n   ❌ Schema 契约违反：以下 {len(unknown_cols)} 个源字段未被处理也未被显式忽略：")
        for col in unknown_cols:
            sample = df[col].dropna().head(3).tolist()
            print(f"      ❓ '{col}' (非空率 {df[col].notna().mean():.1%}, 示例: {sample})")
        print(f"      → 必须在 finalize_schema() 的 optional_fields 或 explicitly_ignored 中声明")
        print(f"      → 使用 --force 跳过此检查（仅用于调试）")
        if not getattr(args, 'force', False):
            sys.exit(1)

    df_final = df[final_fields]

    print(f"\n   最终字段数: {len(df_final.columns)}")
    print(f"   最终记录数: {len(df_final):,}")

    return df_final

def save_to_parquet(df, output_path):
    """保存为 Parquet 格式"""
    print(f"\n{'='*80}")
    print(f"💾 保存为 Parquet 格式")
    print(f"{'='*80}")

    # ── 列名英文化：中文 → 英文 snake_case（从 codegen 产物读取映射）──
    etl_fields_path = Path(__file__).resolve().parent / 'etl_fields.json'
    try:
        with open(etl_fields_path) as f:
            cn_to_en = json.load(f).get('cn_to_en_mapping', {})
        rename_map = {k: v for k, v in cn_to_en.items() if k in df.columns}
        if rename_map:
            df = df.rename(columns=rename_map)
            print(f"   列名英文化: {len(rename_map)}/{len(df.columns)} 列已重命名")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"   ⚠️ cn_to_en_mapping 读取失败，保留中文列名: {e}")

    print(f"   输出文件: {output_path}")
    print(f"   记录数: {len(df):,}")
    print(f"   字段数: {len(df.columns)}")

    # 显示数据类型
    print(f"\n   数据类型:")
    for col in df.columns:
        print(f"      {col}: {df[col].dtype}")

    # 确保输出目录存在（防止 clone 后目录缺失）
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # 统一 L1 metadata 写出
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_path,
        source_file=str(INPUT_FILE.name),
        processing_mode=str(OUTPUT_MODE),
    )
    print(f"\n   ✅ 成功保存到: {output_path}")

    # 验证（仅读元数据，不回载全量数据）
    import pyarrow.parquet as pq
    row_count = pq.read_metadata(output_path).num_rows
    print(f"   ✅ 验证成功: {row_count:,} 条记录")

def update_quick_reference(row_count, col_count):
    """同步更新 QUICK_REFERENCE.md 的数据规模行"""
    import re
    qr_path = Path(__file__).resolve().parent.parent / "knowledge" / "QUICK_REFERENCE.md"
    if not qr_path.exists():
        return
    try:
        text = qr_path.read_text(encoding='utf-8')
        row_k = f"~{round(row_count / 10000)} 万条"
        new_line = f"**更新**: {datetime.now().strftime('%Y-%m-%d')} | **数据规模**: {row_k} / {col_count} 字段 | **分片**: 4 个 Parquet（policy/current/）"
        text = re.sub(
            r'\*\*更新\*\*:.*?\*\*分片\*\*:.*',
            new_line,
            text,
            count=1
        )
        qr_path.write_text(text, encoding='utf-8')
        print(f"   📝 QUICK_REFERENCE.md 已同步: {row_k} / {col_count} 字段")
    except Exception as e:
        print(f"   ⚠️ QUICK_REFERENCE.md 同步失败: {e}")


def main():
    """主函数"""
    print("="*80)
    print("🚀 Excel 转 Parquet 优化脚本 V2")
    print("="*80)
    print(f"输入文件: {INPUT_FILE}")
    print(f"输出文件: {OUTPUT_FILE}")
    print(f"处理模式: {OUTPUT_MODE}")
    print(f"续保源文件: {RENEWAL_SOURCE_FILE if RENEWAL_SOURCE_FILE else '未提供'}")
    print(f"运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    if not INPUT_FILE.exists():
        print(f"\n❌ 错误: 输入文件不存在")
        return

    # 1. 加载数据
    print(f"\n{'='*80}")
    print(f"📂 加载数据")
    print(f"{'='*80}")

    # 强制字符串读取可能包含大数字的列（保单号等），避免科学计数法溢出
    str_columns = ['保单号', '是否续保', '续保单号', '车架号', '批单号']
    dtype_map = {col: str for col in str_columns}
    df = load_target_excel(INPUT_FILE, dtype_map)
    df = normalize_input_columns(df)
    df = merge_renewal_type_from_source(df, RENEWAL_SOURCE_FILE)
    df = normalize_identifier_columns(df)

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

    # 9.8 拆分 adminadmin 系统账号为虚拟业务员
    df = split_admin_account(df)

    # 10. 处理日期字段
    df = process_dates(df)

    # 10.5 增量过滤：只保留签单日期 > after_date 的记录
    if AFTER_DATE:
        cutoff = pd.to_datetime(AFTER_DATE)
        before_count = len(df)
        df = df[df['签单日期'] > cutoff].copy()
        print(f"\n{'='*80}")
        print(f"📅 增量过滤: 签单日期 > {cutoff.strftime('%Y-%m-%d')}")
        print(f"   过滤前: {before_count:,} 行")
        print(f"   过滤后: {len(df):,} 行（增量 {len(df):,} 条）")
        print(f"{'='*80}")
        if len(df) == 0:
            print("   ⚠️  无增量数据，跳过输出")
            return

    # 11. 处理重复记录
    df = handle_duplicate_records(df)

    # 12. 最终化数据结构
    df = finalize_schema(df)

    # 13. 分析最终数据质量
    analyze_data_quality(df, "最终数据")

    # 14. 保存为 Parquet
    save_to_parquet(df, OUTPUT_FILE)

    # 15. 同步更新 QUICK_REFERENCE.md 的数据规模（仅 policy 域）
    if DOMAIN in ('policy', 'all'):
        update_quick_reference(len(df), len(df.columns))

    # 16. 更新 data-sources.json（非 policy 域，policy 由 daily.mjs 汇总更新）
    if DOMAIN in ('claims', 'quotes'):
        try:
            from pipelines.data_sources_updater import update_data_sources
            domain_map = {'claims': 'claims', 'quotes': 'quotes_status'}
            update_data_sources(domain_map[DOMAIN], row_count=len(df), field_count=len(df.columns))
        except Exception as e:
            print(f"  ⚠️ data-sources.json 更新跳过: {e}")

    print(f"\n{'='*80}")
    print("✅ 转换完成！")
    print(f"{'='*80}")

if __name__ == "__main__":
    main()
