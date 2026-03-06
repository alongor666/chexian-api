#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
驾乘险推介率日报生成器

功能：
1. 读取最近14天的数据
2. 按三级机构分组统计：
   - 驾乘险推介率 = 有驾乘险的保单数 / 总保单数 * 100
   - 件均保费 = 总保费 / 总件数
   - 驾乘险件数 = 有驾乘险的保单数
3. 生成结构化日报（结论先行 + 分论点 + 3个表格）
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

# 配置
SCRIPT_DIR = Path(__file__).parent
CONFIG = {
    'data_path': SCRIPT_DIR / 'warehouse/fact/policy/current',
    'output_path': SCRIPT_DIR / '数据分析报告',
    'days_to_analyze': 14,
    'timezone': 'Asia/Shanghai'
}


def find_latest_parquet():
    """查找最新的 Parquet 文件"""
    data_dir = CONFIG['data_path']
    if not data_dir.exists():
        raise FileNotFoundError(f"数据目录不存在: {data_dir}")
    
    parquet_files = list(data_dir.glob('*.parquet'))
    if not parquet_files:
        raise FileNotFoundError(f"未找到 Parquet 文件: {data_dir}")
    
    # 优先选择"每日数据"
    daily_files = [f for f in parquet_files if '每日数据' in f.name]
    if daily_files:
        return sorted(daily_files)[-1]
    
    return sorted(parquet_files)[-1]


def query_data(parquet_path, days=14):
    """查询最近N天的驾乘险数据"""
    # 读取 Parquet 文件
    df = pd.read_parquet(parquet_path)
    
    # 转换日期
    df['签单日期'] = pd.to_datetime(df['签单日期'])
    
    # 筛选最近N天
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days)
    
    df = df[
        (df['签单日期'].dt.date >= start_date) &
        (df['签单日期'].dt.date < end_date) &
        (df['是否报价'] == False)  # 排除报价记录
    ]
    
    # 按机构和日期分组统计
    daily_stats = df.groupby([df['三级机构'], df['签单日期'].dt.date]).agg({
        '保单号': 'nunique',
        '交叉销售标识': lambda x: (x == True).sum(),
        '保费': 'sum'
    }).reset_index()
    
    # 重命名列
    daily_stats.columns = ['机构', '日期', '总件数', '驾乘险件数', '总保费']
    
    # 计算推介率和件均保费
    daily_stats['推介率'] = (daily_stats['驾乘险件数'] / daily_stats['总件数'] * 100).round(2)
    daily_stats['件均保费'] = (daily_stats['总保费'] / daily_stats['总件数']).round(2)
    
    # 排序
    daily_stats = daily_stats.sort_values(['机构', '日期'])
    
    return daily_stats.to_dict('records')


def organize_by_org(data):
    """按机构组织数据"""
    org_data = {}
    
    for row in data:
        org = row['机构']
        date = row['日期']
        
        if org not in org_data:
            org_data[org] = {
                'dates': [],
                '推介率': {},
                '件均保费': {},
                '驾乘险件数': {}
            }
        
        if date not in org_data[org]['dates']:
            org_data[org]['dates'].append(date)
        
        org_data[org]['推介率'][date] = row['推介率'] or 0
        org_data[org]['件均保费'][date] = row['件均保费'] or 0
        org_data[org]['驾乘险件数'][date] = int(row['驾乘险件数'] or 0)
    
    # 排序日期
    for org in org_data:
        org_data[org]['dates'].sort()
    
    return org_data


def generate_analysis(org_data):
    """生成分析结论"""
    analyses = []
    orgs = list(org_data.keys())
    
    # 1. 计算整体趋势
    all_dates = set()
    for org in orgs:
        all_dates.update(org_data[org]['dates'])
    sorted_dates = sorted(all_dates)
    
    if len(sorted_dates) >= 7:
        last7_days = sorted_dates[-7:]
        prev7_days = sorted_dates[-14:-7] if len(sorted_dates) >= 14 else []
        
        # 计算最近7天平均值
        last7_avg = {'rate': 0, 'premium': 0, 'count': 0}
        prev7_avg = {'rate': 0, 'premium': 0, 'count': 0}
        
        for org in orgs:
            for date in last7_days:
                if date in org_data[org]['推介率']:
                    last7_avg['rate'] += org_data[org]['推介率'][date]
                    last7_avg['premium'] += org_data[org]['件均保费'][date]
                    last7_avg['count'] += org_data[org]['驾乘险件数'][date]
            
            if prev7_days:
                for date in prev7_days:
                    if date in org_data[org]['推介率']:
                        prev7_avg['rate'] += org_data[org]['推介率'][date]
                        prev7_avg['premium'] += org_data[org]['件均保费'][date]
                        prev7_avg['count'] += org_data[org]['驾乘险件数'][date]
        
        if prev7_days and prev7_avg['rate'] > 0:
            rate_change = last7_avg['rate'] - prev7_avg['rate']
            premium_change = last7_avg['premium'] - prev7_avg['premium']
            count_change = last7_avg['count'] - prev7_avg['count']
            
            analyses.append({
                'type': '整体趋势',
                'content': f"最近7天对比前7天：推介率{'上升' if rate_change > 0 else '下降'} {abs(rate_change):.2f}%，" +
                          f"件均保费{'上升' if premium_change > 0 else '下降'} {abs(premium_change):.0f}元，" +
                          f"驾乘险件数{'增加' if count_change > 0 else '减少'} {abs(count_change)}件"
            })
    
    # 2. 识别问题机构（推介率低于平均水平）
    avg_rates = {}
    for org in orgs:
        rates = list(org_data[org]['推介率'].values())
        avg_rates[org] = sum(rates) / len(rates) if rates else 0
    
    overall_avg = sum(avg_rates.values()) / len(avg_rates) if avg_rates else 0
    problem_orgs = sorted(
        [(org, rate) for org, rate in avg_rates.items() if rate < overall_avg * 0.8],
        key=lambda x: x[1]
    )
    
    if problem_orgs:
        analyses.append({
            'type': '问题机构',
            'content': f"推介率偏低的机构：{', '.join([f'{org}({rate:.2f}%)' for org, rate in problem_orgs])}。" +
                      "建议重点关注培训与激励措施。"
        })
    
    # 3. 识别优秀机构
    top_orgs = sorted(
        [(org, rate) for org, rate in avg_rates.items() if rate > overall_avg * 1.2],
        key=lambda x: x[1],
        reverse=True
    )[:3]
    
    if top_orgs:
        analyses.append({
            'type': '优秀机构',
            'content': f"推介率领先的机构：{', '.join([f'{org}({rate:.2f}%)' for org, rate in top_orgs])}。" +
                      "建议总结推广优秀经验。"
        })
    
    return analyses


def generate_table(title, org_data, metric):
    """生成 Markdown 表格"""
    orgs = sorted(org_data.keys())
    all_dates = set()
    
    for org in orgs:
        all_dates.update(org_data[org]['dates'])
    
    sorted_dates = sorted(all_dates)
    
    # 表头
    table = f"### {title}\n\n"
    table += '| 机构 | ' + ' | '.join([
        f"{d.month}/{d.day}" for d in sorted_dates
    ]) + ' |\n'
    
    table += '|------' + '|------' * len(sorted_dates) + '|\n'
    
    # 表体
    for org in orgs:
        table += f'| {org} |'
        for date in sorted_dates:
            value = org_data[org][metric].get(date)
            if value is not None:
                if metric == '推介率':
                    table += f' {value:.2f}% |'
                elif metric == '件均保费':
                    table += f' {value:.0f} |'
                else:
                    table += f' {int(value)} |'
            else:
                table += ' - |'
        table += '\n'
    
    return table


def generate_report(data, analyses, org_data):
    """生成完整日报"""
    today = datetime.now()
    date_str = today.strftime('%Y年%m月%d日')
    
    report = f"# 驾乘险推介率日报\n\n"
    report += f"**报告日期**: {date_str}\n"
    report += f"**分析周期**: 最近 {CONFIG['days_to_analyze']} 天\n"
    report += f"**数据截止**: {today.strftime('%Y-%m-%d')}\n\n"
    
    report += "---\n\n"
    
    # 一、结论先行
    report += "## 一、核心结论\n\n"
    for idx, analysis in enumerate(analyses, 1):
        report += f"### {idx}. {analysis['type']}\n\n"
        report += f"{analysis['content']}\n\n"
    
    # 二、分论点详解
    report += "## 二、详细分析\n\n"
    
    # 2.1 驾乘险推介率
    report += "### 2.1 驾乘险推介率分析\n\n"
    report += "驾乘险推介率反映了业务员向客户推荐驾乘险的积极性和能力。推介率越高，说明交叉销售工作越到位。\n\n"
    report += "**关键指标**：\n"
    report += "- 推介率 = 驾乘险保单数 / 总保单数 × 100%\n"
    report += "- 目标：推介率应保持在 30% 以上\n"
    report += "- 优秀机构：推介率 > 40%\n\n"
    
    # 2.2 件均保费
    report += "### 2.2 件均保费分析\n\n"
    report += "件均保费反映了车险业务的质量和规模。件均保费高，说明业务员承保的车辆价值较高或保障更全面。\n\n"
    report += "**关键指标**：\n"
    report += "- 件均保费 = 总保费 / 总件数\n"
    report += "- 基准：件均保费 > 3000 元\n"
    report += "- 优质业务：件均保费 > 4000 元\n\n"
    
    # 2.3 驾乘险件数
    report += "### 2.3 驾乘险件数分析\n\n"
    report += "驾乘险件数直接反映了交叉销售的绝对成果。件数越多，说明驾乘险销售业绩越好。\n\n"
    report += "**关键指标**：\n"
    report += "- 驾乘险件数 = 有驾乘险标识的保单数量\n"
    report += "- 日均目标：根据机构规模差异\n"
    report += "- 增长目标：环比增长 > 5%\n\n"
    
    # 三、数据表格
    report += "## 三、详细数据表格\n\n"
    
    report += generate_table('驾乘险推介率 (%)', org_data, '推介率')
    report += '\n\n'
    
    report += generate_table('件均保费 (元)', org_data, '件均保费')
    report += '\n\n'
    
    report += generate_table('驾乘险件数', org_data, '驾乘险件数')
    report += '\n\n'
    
    report += "---\n\n"
    report += f"**报告生成时间**: {today.strftime('%Y-%m-%d %H:%M:%S')}\n"
    report += "**数据来源**: 车险保单综合明细表\n"
    report += "**生成工具**: OpenClaw 自动化日报系统\n"
    
    return report


def main():
    """主函数"""
    print('🚀 驾乘险推介率日报生成器启动...\n')
    
    try:
        # 1. 查找最新数据文件
        print('📂 查找最新数据文件...')
        parquet_path = find_latest_parquet()
        print(f'   ✓ 数据文件: {parquet_path.name}')
        
        # 2. 查询数据
        print(f'📈 查询最近{CONFIG["days_to_analyze"]}天数据...')
        data = query_data(parquet_path, CONFIG['days_to_analyze'])
        print(f'   ✓ 查询到 {len(data)} 条记录')
        
        if not data:
            print('❌ 未查询到数据，请检查数据源')
            sys.exit(1)
        
        # 3. 组织数据
        print('🔄 组织数据结构...')
        org_data = organize_by_org(data)
        print(f'   ✓ {len(org_data)} 个机构')
        
        # 4. 生成分析
        print('💡 生成分析结论...')
        analyses = generate_analysis(org_data)
        
        # 5. 生成报告
        print('📝 生成日报...')
        report = generate_report(data, analyses, org_data)
        
        # 6. 保存报告
        output_dir = CONFIG['output_path']
        output_dir.mkdir(parents=True, exist_ok=True)
        
        output_file = output_dir / f"驾乘险推介率日报_{datetime.now().strftime('%Y-%m-%d')}.md"
        output_file.write_text(report, encoding='utf-8')
        
        print(f'\n✅ 日报生成成功！')
        print(f'📄 文件路径: {output_file}\n')
        
        # 7. 输出到控制台
        print('=' * 80)
        print(report)
        print('=' * 80)
        
        sys.exit(0)
        
    except Exception as e:
        print(f'❌ 生成日报失败: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
