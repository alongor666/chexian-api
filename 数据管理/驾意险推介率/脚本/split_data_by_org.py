#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按机构拆分驾意险数据

功能：
1. 读取最新数据
2. 确定最新日期和连续14天范围
3. 按三级机构拆分数据
4. 导出为CSV文件

输出字段：
- 缴费日期（签单日期）
- 三级机构
- 车架号
- 保费（车险签单保费）
- 交叉销售保费_驾意（驾意险签单保费）
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

# 配置
SCRIPT_DIR = Path(__file__).parent.parent

if str(SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR.parent))  # 供 import pipelines.*（branch_paths SSOT · 801409 cutover 前置）
from pipelines.branch_paths import policy_current_files  # noqa: E402
CONFIG = {
    'data_source': SCRIPT_DIR.parent / 'warehouse/fact/policy/current',
    'output_dir': SCRIPT_DIR / '机构数据',
    'days_to_extract': 14
}


def find_latest_parquet():
    """查找最新的 Parquet 文件"""
    data_dir = CONFIG['data_source']
    if not data_dir.exists():
        raise FileNotFoundError(f"数据目录不存在: {data_dir}")
    
    # 双布局自适应（branch_paths SSOT）：四川驾意险分机构拆分，取 SC 分片（扁平/子目录自动路由）
    parquet_files = [Path(p) for p in policy_current_files(data_dir, 'SC')]
    if not parquet_files:
        raise FileNotFoundError(f"未找到 Parquet 文件: {data_dir}")
    
    # 优先选择"每日数据"
    daily_files = [f for f in parquet_files if '每日数据' in f.name]
    if daily_files:
        return sorted(daily_files)[-1]
    
    return sorted(parquet_files)[-1]


def get_latest_date_range(df):
    """获取数据中的最新日期和连续14天范围"""
    date_col = None
    for col in ['签单日期', 'policy_date']:
        if col in df.columns:
            date_col = col
            break
    if date_col is None:
        raise ValueError('未找到签单日期列')

    df[date_col] = pd.to_datetime(df[date_col])
    
    latest_date = df[date_col].max().date()
    
    # 计算14天前的日期
    start_date = latest_date - timedelta(days=CONFIG['days_to_extract'] - 1)
    
    return start_date, latest_date, date_col


def split_by_org(parquet_path):
    """按机构拆分数据"""
    print(f'📂 读取数据文件: {parquet_path.name}')
    
    # 读取 Parquet 文件
    df = pd.read_parquet(parquet_path)
    
    # 获取日期范围
    start_date, end_date, date_col = get_latest_date_range(df)
    print(f'📅 数据日期范围: {start_date} 至 {end_date}（连续{CONFIG["days_to_extract"]}天）')
    
    df[date_col] = pd.to_datetime(df[date_col])
    df_filtered = df[
        (df[date_col].dt.date >= start_date) &
        (df[date_col].dt.date <= end_date)
    ]

    quote_col = None
    for col in ['是否报价', 'is_quote']:
        if col in df_filtered.columns:
            quote_col = col
            break
    if quote_col is not None:
        df_filtered = df_filtered[df_filtered[quote_col] == False]

    insurance_col = None
    for col in ['险类', 'insurance_type']:
        if col in df_filtered.columns:
            insurance_col = col
            break
    if insurance_col is not None:
        df_filtered = df_filtered[df_filtered[insurance_col] == '商业保险']
    
    print(f'✓ 筛选到 {len(df_filtered)} 条记录（最近{CONFIG["days_to_extract"]}天）')
    
    # 选择需要的字段
    org_col = '三级机构' if '三级机构' in df_filtered.columns else 'org_level_3'
    vin_col = '车架号' if '车架号' in df_filtered.columns else 'vehicle_frame_no'
    premium_col = '保费' if '保费' in df_filtered.columns else '签单/批改保费'

    cross_premium_col = None
    for col in ['交叉销售保费-驾意', '交叉销售保费_驾意']:
        if col in df_filtered.columns:
            cross_premium_col = col
            break
    if cross_premium_col is None:
        raise ValueError('未找到交叉销售保费列')

    output_columns = [
        date_col,
        org_col,
        vin_col,
        premium_col,
        cross_premium_col
    ]
    
    # 检查字段是否存在
    missing_cols = [col for col in output_columns if col not in df_filtered.columns]
    if missing_cols:
        print(f'⚠️  缺少字段: {missing_cols}')
        print(f'可用字段: {list(df_filtered.columns)}')
        return
    
    # 按机构分组
    orgs = df_filtered[org_col].unique()
    print(f'📊 找到 {len(orgs)} 个机构: {", ".join(sorted(orgs))}\n')
    
    # 确保输出目录存在
    CONFIG['output_dir'].mkdir(parents=True, exist_ok=True)
    
    # 拆分并导出
    file_list = []
    for org in sorted(orgs):
        org_data = df_filtered[df_filtered[org_col] == org][output_columns]
        
        # 生成文件名
        filename = f"{org}_{start_date.strftime('%Y%m%d')}_{end_date.strftime('%Y%m%d')}.csv"
        filepath = CONFIG['output_dir'] / filename
        
        # 导出 CSV
        org_data.to_csv(filepath, index=False, encoding='utf-8-sig')
        
        file_list.append({
            '机构': org,
            '文件名': filename,
            '记录数': len(org_data),
            '路径': str(filepath.relative_to(SCRIPT_DIR))
        })
        
        print(f'  ✓ {org}: {len(org_data):4d} 条记录 → {filename}')
    
    return file_list, start_date, end_date


def main():
    """主函数"""
    print('🚀 按机构拆分驾意险数据...\n')
    
    try:
        # 1. 查找最新数据文件
        parquet_path = find_latest_parquet()
        
        # 2. 拆分数据
        file_list, start_date, end_date = split_by_org(parquet_path)
        
        # 3. 生成汇总文件
        summary = {
            '数据源': parquet_path.name,
            '数据范围': f'{start_date} 至 {end_date}',
            '机构数量': len(file_list),
            '总记录数': sum(f['记录数'] for f in file_list),
            '生成时间': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            '文件列表': file_list
        }
        
        # 保存汇总
        import json
        summary_path = CONFIG['output_dir'] / '数据拆分汇总.json'
        with open(summary_path, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        
        print(f'\n✅ 数据拆分完成！')
        print(f'📄 汇总文件: {summary_path.name}')
        print(f'📁 输出目录: {CONFIG["output_dir"]}')
        print(f'\n统计信息:')
        print(f'  - 机构数量: {len(file_list)}')
        print(f'  - 总记录数: {sum(f["记录数"] for f in file_list)}')
        print(f'  - 日期范围: {start_date} ~ {end_date}')
        
        sys.exit(0)
        
    except Exception as e:
        print(f'❌ 数据拆分失败: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
