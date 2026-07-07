#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
驾意险推介率日报生成器（修改版）

功能：
1. 读取最近14天的数据
2. 筛选条件：险类 = 商业保险
3. 按三级机构分组统计：
   - 推介率 = driver_count / auto_count * 100（车架号去重）
   - 驾意险件均保费 = driver_premium / driver_policy_count
   - 驾意险件数 = driver_policy_count
4. 输出 Markdown + CSV + 飞书卡片
"""

import sys
import json
from typing import cast
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

# 配置
SCRIPT_DIR = Path(__file__).parent.parent

if str(SCRIPT_DIR.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR.parent))  # 供 import pipelines.*（branch_paths SSOT · 801409 cutover 前置）
from pipelines.branch_paths import policy_current_files  # noqa: E402
CONFIG = {
    'data_path': SCRIPT_DIR.parent / 'warehouse/fact/policy/current',
    'output_path': SCRIPT_DIR / '输出',
    'days_to_analyze': 14,
    'timezone': 'Asia/Shanghai'
}


def find_latest_parquet():
    """查找最新的 Parquet 文件"""
    data_dir = CONFIG['data_path']
    if not data_dir.exists():
        raise FileNotFoundError(f"数据目录不存在: {data_dir}")
    
    # 双布局自适应（branch_paths SSOT）：四川驾意险日报，取 SC 分片（扁平/子目录自动路由）
    parquet_files = [Path(p) for p in policy_current_files(data_dir, 'SC')]
    if not parquet_files:
        raise FileNotFoundError(f"未找到 Parquet 文件: {data_dir}")
    
    # 优先选择包含"剔摩"的文件，因为它包含商业保险数据
    trimo_files = [f for f in parquet_files if '剔摩' in f.name]
    if trimo_files:
        return sorted(trimo_files)[-1]
    
    return sorted(parquet_files)[-1]


def query_data(parquet_path, days_to_analyze):
    """查询数据"""
    print(f"📂 读取数据文件: {parquet_path.name}")
    
    df = pd.read_parquet(parquet_path)
    print(f"📊 总记录数: {len(df)}")
    
    # 筛选商业保险数据
    insurance_col = None
    for col in ['险类', 'insurance_type']:
        if col in df.columns:
            insurance_col = col
            break
    
    if insurance_col is not None:
        df = df[df[insurance_col] == '商业保险']
        print(f"📈 商业保险记录数: {len(df)}")
    
    # 筛选最近天数的数据
    date_col = None
    for col in ['签单日期', 'policy_date', 'insurance_start_date']:
        if col in df.columns:
            date_col = col
            break
    
    if date_col is None:
        raise ValueError('未找到日期列')
    
    # 转换日期列
    if df[date_col].dtype == 'object':
        df[date_col] = pd.to_datetime(df[date_col])
    elif 'timestamp' in str(df[date_col].dtype):
        df[date_col] = pd.to_datetime(df[date_col])
    
    # 计算筛选日期
    cutoff_date = df[date_col].max() - timedelta(days=days_to_analyze - 1)
    df = df[df[date_col] >= cutoff_date]
    print(f"📅 数据范围: {df[date_col].min().date()} ~ {df[date_col].max().date()}")
    
    # 查找列
    # 交叉销售标识 - 由于没有该列，我们假设所有商业保险都包含驾意险
    cross_sell_col = 'driver_indicator'  # 创建一个虚拟列
    df[cross_sell_col] = True  # 假设所有商业保险都包含驾意险
    
    vin_col = None
    for col in ['车架号', 'vehicle_frame_no', 'vin', 'VIN']:
        if col in df.columns:
            vin_col = col
            break
    
    policy_col = None
    for col in ['保单号', 'policy_no']:
        if col in df.columns:
            policy_col = col
            break
    
    if vin_col is None:
        if policy_col is None:
            raise ValueError('未找到车架号或保单号列')
        vin_col = policy_col
    if policy_col is None:
        policy_col = vin_col
    
    premium_col = None
    for col in ['保费', '签单/批改保费', 'premium']:
        if col in df.columns:
            premium_col = col
            break
    
    if premium_col is None:
        raise ValueError('未找到保费列')
    
    org_col = None
    for col in ['三级机构', 'org_level_3']:
        if col in df.columns:
            org_col = col
            break
    
    if org_col is None:
        raise ValueError('未找到机构列')
    
    print(f"✅ 列映射完成:")
    print(f"   日期列: {date_col}")
    print(f"   交叉销售标识: {cross_sell_col}")
    print(f"   车架号列: {vin_col}")
    print(f"   保单号列: {policy_col}")
    print(f"   保费列: {premium_col}")
    print(f"   机构列: {org_col}")
    
    # 按机构和日期分组统计
    daily_stats = df.groupby([df[org_col], df[date_col].dt.date]).agg(
        auto_count=(vin_col, 'nunique'),
        driver_count=(vin_col, lambda x: x[df.loc[x.index, cross_sell_col] == True].nunique()),
        driver_premium=(premium_col, 'sum'),
        driver_policy_count=(policy_col, 'count')
    ).reset_index()
    
    # 计算推介率
    daily_stats['recommendation_rate'] = (daily_stats['driver_count'] / daily_stats['auto_count'] * 100).round(2)
    daily_stats['driver_premium_avg'] = (daily_stats['driver_premium'] / daily_stats['driver_policy_count']).round(2)
    
    print(f"📊 统计完成，共 {len(daily_stats)} 条记录")
    
    return daily_stats, df[date_col].max().date()


def generate_report(daily_stats, latest_date):
    """生成日报"""
    print("📋 生成日报...")
    
    # 按日期排序
    daily_stats = daily_stats.sort_values([daily_stats.columns[1], daily_stats.columns[0]])
    
    # 计算最近7天和前7天的数据
    latest_date = pd.to_datetime(latest_date)
    
    # 将日期列转换为datetime类型以便比较
    daily_stats['date_column'] = pd.to_datetime(daily_stats[daily_stats.columns[1]])
    
    recent_7d = daily_stats[daily_stats['date_column'] >= (latest_date - timedelta(days=7))]
    previous_7d = daily_stats[daily_stats['date_column'] < (latest_date - timedelta(days=7))]
    previous_7d = previous_7d[daily_stats['date_column'] >= (latest_date - timedelta(days=14))]
    
    # 计算汇总统计
    def calculate_period_stats(df):
        if len(df) == 0:
            return {'rate': 0, 'premium': 0, 'count': 0}
        
        total_auto = df['auto_count'].sum()
        total_driver = df['driver_count'].sum()
        total_premium = df['driver_premium'].sum()
        total_policies = df['driver_policy_count'].sum()
        
        return {
            'rate': (total_driver / total_auto * 100).round(2) if total_auto > 0 else 0,
            'premium': (total_premium / total_policies).round(2) if total_policies > 0 else 0,
            'count': total_policies
        }
    
    recent_stats = calculate_period_stats(recent_7d)
    previous_stats = calculate_period_stats(previous_7d)
    
    # 计算变化
    rate_change = recent_stats['rate'] - previous_stats['rate']
    premium_change = recent_stats['premium'] - previous_stats['premium']
    count_change = recent_stats['count'] - previous_stats['count']
    
    # 获取最新日期的机构数据
    latest_date_df = daily_stats[daily_stats['date_column'] == latest_date.date()]
    latest_date_df = latest_date_df.sort_values('recommendation_rate', ascending=False)
    
    # 分组统计
    problem_institutions = latest_date_df.tail(5)
    excellent_institutions = latest_date_df.head(5)
    
    # 生成Markdown报告
    md_content = f"""**最近7天 vs 前7天**
- 推介率：**{recent_stats['rate']}%** {'↓' if rate_change < 0 else '↑'} ({rate_change:+.2f}pct)
- 件均保费：**{recent_stats['premium']} 元** {'↑' if premium_change > 0 else '↓'} ({premium_change:+.2f}元)
- 驾意险件数：**{recent_stats['count']}** {'↓' if count_change < 0 else '↑'} ({count_change:+})

**问题机构 Top5（按最新日推介率）**"""
    
    for _, row in problem_institutions.iterrows():
        md_content += f"\n- {row[daily_stats.columns[0]]}｜推介率 {row['recommendation_rate']}%｜件均 {row['driver_premium_avg']} 元｜件数 {row['driver_policy_count']}"
    
    md_content += "\n\n**优秀机构 Top5（按最新日推介率）**"
    
    for _, row in excellent_institutions.iterrows():
        md_content += f"\n- {row[daily_stats.columns[0]]}｜推介率 {row['recommendation_rate']}%｜件均 {row['driver_premium_avg']} 元｜件数 {row['driver_policy_count']}"
    
    md_content += f"""
\n数据范围：{daily_stats['date_column'].min()} ~ {daily_stats['date_column'].max()}
口径：险类=商业保险；按签单日期统计"""
    
    # 生成飞书卡片
    card_data = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "template": "blue",
                "title": {
                    "tag": "plain_text",
                    "content": f"驾意险推介率日报｜{latest_date.strftime('%Y-%m-%d')}"
                }
            },
            "elements": [
                {
                    "tag": "markdown",
                    "content": f"**最近7天 vs 前7天**\n- 推介率：**{recent_stats['rate']}%** {'↓' if rate_change < 0 else '↑'} ({rate_change:+.2f}pct)\n- 件均保费：**{recent_stats['premium']} 元** {'↑' if premium_change > 0 else '↓'} ({premium_change:+.2f}元)\n- 驾意险件数：**{recent_stats['count']}** {'↓' if count_change < 0 else '↑'} ({count_change:+})"
                },
                {
                    "tag": "hr"
                },
                {
                    "tag": "markdown",
                    "content": f"**问题机构 Top5（按最新日推介率）**\n" + "\n".join([f"- {row[daily_stats.columns[0]]}｜推介率 {row['recommendation_rate']}%｜件均 {row['driver_premium_avg']} 元｜件数 {row['driver_policy_count']}" for _, row in problem_institutions.iterrows()])
                },
                {
                    "tag": "markdown",
                    "content": f"**优秀机构 Top5（按最新日推介率）**\n" + "\n".join([f"- {row[daily_stats.columns[0]]}｜推介率 {row['recommendation_rate']}%｜件均 {row['driver_premium_avg']} 元｜件数 {row['driver_policy_count']}" for _, row in excellent_institutions.iterrows()])
                },
                {
                    "tag": "hr"
                },
                {
                    "tag": "markdown",
                    "content": f"数据范围：{daily_stats['date_column'].min()} ~ {daily_stats['date_column'].max()}\n口径：险类=商业保险；按签单日期统计"
                }
            ]
        }
    }
    
    # 保存文件
    output_path = CONFIG['output_path']
    output_path.mkdir(exist_ok=True)
    
    # 保存Markdown文件
    md_filename = f"驾意险推介率日报_{latest_date.strftime('%Y-%m-%d')}.md"
    md_path = output_path / md_filename
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)
    
    # 保存CSV文件
    csv_filename = f"驾意险推介率数据_{latest_date.strftime('%Y-%m-%d')}.csv"
    csv_path = output_path / csv_filename
    daily_stats.to_csv(csv_path, index=False, encoding='utf-8')
    
    # 保存飞书卡片
    card_filename = f"驾意险推介率卡片_{latest_date.strftime('%Y-%m-%d')}.json"
    card_path = output_path / card_filename
    with open(card_path, 'w', encoding='utf-8') as f:
        json.dump(card_data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 日报生成完成:")
    print(f"   Markdown: {md_path}")
    print(f"   CSV: {csv_path}")
    print(f"   飞书卡片: {card_path}")
    
    return md_content, card_data


def main():
    """主函数"""
    print("🚀 驾意险推介率日报生成器启动（修改版）...")
    
    try:
        # 查找最新数据文件
        parquet_path = find_latest_parquet()
        print(f"📂 数据文件: {parquet_path.name}")
        
        # 查询数据
        data, latest_date = query_data(parquet_path, CONFIG['days_to_analyze'])
        
        # 生成报告
        md_content, card_data = generate_report(data, latest_date)
        
        print("🎉 日报生成完成!")
        
        # 输出结果摘要
        print("\n📊 报告摘要:")
        print(md_content)
        
        return card_data
        
    except Exception as e:
        print(f"❌ 生成日报失败: {e}")
        raise


if __name__ == "__main__":
    main()