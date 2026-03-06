#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
驾乘险推介率日报生成器

功能：
1. 读取最近15天的数据
2. 筛选条件：险种大类 = 商业险
3. 按三级机构分组统计：
   - 推介率 = driver_count / auto_count * 100（车架号去重）
   - 驾乘险件均保费 = driver_premium / driver_policy_count
   - 驾乘险件数 = driver_policy_count
4. 输出 Markdown + CSV 格式

指标口径（与项目定义一致）：
- auto_count: 车险承保车辆数（去重车架号）
- driver_count: 驾乘险承保车辆数（去重车架号）
- driver_policy_count: 驾乘险保单件数
- driver_premium: 驾乘险保费
- auto_premium: 车险保费
"""

import os
import sys
import json
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

# 配置
SCRIPT_DIR = Path(__file__).parent
CONFIG = {
    'data_path': SCRIPT_DIR / 'warehouse/fact/policy/current',
    'output_path': SCRIPT_DIR / '数据分析报告',
    'days_to_analyze': 15,  # 改为15天
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


def query_data(parquet_path, days=15):
    """查询最近N天的驾乘险数据（商业险）"""
    # 读取 Parquet 文件
    df = pd.read_parquet(parquet_path)
    
    # 打印列名，便于调试
    print(f"   数据列: {list(df.columns)[:10]}...")
    
    # 转换日期
    df['签单日期'] = pd.to_datetime(df['签单日期'])
    
    # 筛选最近N天 + 商业险
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days)
    
    # 筛选条件
    filter_condition = (
        (df['签单日期'].dt.date >= start_date) &
        (df['签单日期'].dt.date < end_date) &
        (df['是否报价'] == False)  # 排除报价记录
    )
    
    # 筛选商业险（险类 = 商业保险）
    if '险类' in df.columns:
        filter_condition &= (df['险类'] == '商业保险')
        print(f"   ✓ 筛选条件: 险类 = 商业保险")
    
    df = df[filter_condition]
    
    print(f"   ✓ 筛选后记录数: {len(df)}")
    
    # 按三级机构和日期分组统计（使用车架号去重）
    # auto_count: 车险承保车辆数（去重车架号）
    # driver_count: 驾乘险承保车辆数（去重车架号）
    # driver_policy_count: 驾乘险保单件数
    # driver_premium: 驾乘险保费
    # auto_premium: 车险保费
    
    # 检查交叉销售标识列名
    cross_sell_col = None
    for col in ['交叉销售标识', 'is_cross_sell', '驾乘险标识']:
        if col in df.columns:
            cross_sell_col = col
            break
    
    if cross_sell_col is None:
        print(f"   ⚠ 未找到交叉销售标识列，可用列: {list(df.columns)}")
        raise ValueError("未找到交叉销售标识列")
    
    print(f"   ✓ 使用交叉销售标识列: {cross_sell_col}")
    
    # 检查车架号列名
    vin_col = None
    for col in ['车架号', 'vin', 'VIN']:
        if col in df.columns:
            vin_col = col
            break
    
    if vin_col is None:
        print(f"   ⚠ 未找到车架号列，使用保单号代替")
        vin_col = '保单号'
    
    print(f"   ✓ 使用车架号列: {vin_col}")
    
    # 分组统计
    daily_stats = df.groupby([df['三级机构'], df['签单日期'].dt.date]).agg(
        auto_count=(vin_col, 'nunique'),  # 车险承保车辆数（车架号去重）
        driver_count=(vin_col, lambda x: x[df.loc[x.index, cross_sell_col] == True].nunique()),  # 驾乘险承保车辆数
        driver_policy_count=('保单号', lambda x: x[df.loc[x.index, cross_sell_col] == True].nunique()),  # 驾乘险保单件数
        driver_premium=('保费', lambda x: x[df.loc[x.index, cross_sell_col] == True].sum()),  # 驾乘险保费
        auto_premium=('保费', 'sum')  # 车险保费
    ).reset_index()
    
    # 重命名列
    daily_stats.columns = ['三级机构', '日期', 'auto_count', 'driver_count', 
                           'driver_policy_count', 'driver_premium', 'auto_premium']
    
    # 计算指标
    daily_stats['推介率'] = (daily_stats['driver_count'] / daily_stats['auto_count'] * 100).round(2)
    daily_stats['驾乘险件均保费'] = (daily_stats['driver_premium'] / daily_stats['driver_policy_count']).round(2)
    daily_stats['车险件均保费'] = (daily_stats['auto_premium'] / daily_stats['auto_count']).round(2)
    
    # 处理无穷大和NaN
    daily_stats = daily_stats.replace([float('inf'), float('-inf')], 0)
    daily_stats = daily_stats.fillna(0)
    
    # 排序
    daily_stats = daily_stats.sort_values(['三级机构', '日期'])
    
    return daily_stats.to_dict('records')


def organize_by_org(data):
    """按机构组织数据"""
    org_data = {}
    
    for row in data:
        org = row['三级机构']
        date = row['日期']
        
        if org not in org_data:
            org_data[org] = {
                'dates': [],
                '推介率': {},
                '驾乘险件均保费': {},
                'driver_policy_count': {}
            }
        
        if date not in org_data[org]['dates']:
            org_data[org]['dates'].append(date)
        
        org_data[org]['推介率'][date] = row['推介率'] or 0
        org_data[org]['驾乘险件均保费'][date] = row['驾乘险件均保费'] or 0
        org_data[org]['driver_policy_count'][date] = int(row['driver_policy_count'] or 0)
    
    # 排序日期
    for org in org_data:
        org_data[org]['dates'].sort()
    
    return org_data


def generate_analysis(org_data):
    """生成分析结论"""
    analyses = []
    orgs = list(org_data.keys())
    
    # 1. 计算整体趋势（按真实分子/分母汇总，避免机构均值直接相加失真）
    all_dates = set()
    for org in orgs:
        all_dates.update(org_data[org]['dates'])
    sorted_dates = sorted(all_dates)

    if len(sorted_dates) >= 7:
        last7_days = sorted_dates[-7:]
        prev7_days = sorted_dates[-14:-7] if len(sorted_dates) >= 14 else []

        df = pd.DataFrame([
            {
                '三级机构': org,
                '日期': date,
                '推介率': org_data[org]['推介率'].get(date, 0),
                '驾乘险件均保费': org_data[org]['驾乘险件均保费'].get(date, 0),
                'driver_policy_count': org_data[org]['driver_policy_count'].get(date, 0)
            }
            for org in orgs for date in org_data[org]['dates']
        ])

        last7_df = df[df['日期'].isin(last7_days)]
        prev7_df = df[df['日期'].isin(prev7_days)] if prev7_days else pd.DataFrame()

        last7_rate = last7_df['推介率'].mean() if not last7_df.empty else 0
        last7_premium = last7_df[last7_df['driver_policy_count'] > 0]['驾乘险件均保费'].mean() if not last7_df.empty else 0
        last7_count = int(last7_df['driver_policy_count'].sum()) if not last7_df.empty else 0

        if not prev7_df.empty:
            prev7_rate = prev7_df['推介率'].mean()
            prev7_premium = prev7_df[prev7_df['driver_policy_count'] > 0]['驾乘险件均保费'].mean()
            prev7_count = int(prev7_df['driver_policy_count'].sum())

            rate_change = last7_rate - prev7_rate
            premium_change = last7_premium - prev7_premium
            count_change = last7_count - prev7_count

            analyses.append({
                'type': '整体趋势',
                'content': f"最近7天对比前7天：推介率{'上升' if rate_change > 0 else '下降'} {abs(rate_change):.2f}%，"
                          f"驾乘险件均保费{'上升' if premium_change > 0 else '下降'} {abs(premium_change):.0f}元，"
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
    table += '| 三级机构 | ' + ' | '.join([
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
                elif metric == '驾乘险件均保费':
                    table += f' {value:.0f} |'
                else:
                    table += f' {int(value)} |'
            else:
                table += ' - |'
        table += '\n'
    
    return table


def generate_csv(data):
    """生成 CSV 数据"""
    # CSV 表头
    csv = '三级机构,日期,auto_count,driver_count,driver_policy_count,driver_premium,auto_premium,推介率,驾乘险件均保费,车险件均保费\n'
    
    # CSV 数据行
    for row in data:
        csv += f'"{row["三级机构"]}",{row["日期"]},{row["auto_count"]},{row["driver_count"]},{row["driver_policy_count"]},{row["driver_premium"]},{row["auto_premium"]},{row["推介率"]},{row["驾乘险件均保费"]},{row["车险件均保费"]}\n'
    
    return csv


def generate_report(data, analyses, org_data):
    """生成完整日报"""
    # 使用昨天的日期（因为不可能有今天的数据）
    yesterday = datetime.now() - timedelta(days=1)
    date_str = yesterday.strftime('%Y年%m月%d日')
    data_cutoff = yesterday.strftime('%Y-%m-%d')
    
    report = f"# 驾乘险推介率日报\n\n"
    report += f"**报告日期**: {date_str}\n"
    report += f"**分析周期**: 最近 {CONFIG['days_to_analyze']} 天\n"
    report += f"**数据截止**: {data_cutoff}\n"
    report += f"**筛选条件**: 险类 = 商业保险\n\n"
    
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
    report += "- 推介率 = driver_count / auto_count × 100%（车架号去重）\n"
    report += "- 目标：推介率应保持在 30% 以上\n"
    report += "- 优秀机构：推介率 > 40%\n\n"
    
    # 2.2 驾乘险件均保费
    report += "### 2.2 驾乘险件均保费分析\n\n"
    report += "驾乘险件均保费反映了驾乘险保单的价值。件均保费高，说明业务员推荐的驾乘险保障更全面。\n\n"
    report += "**关键指标**：\n"
    report += "- 驾乘险件均保费 = driver_premium / driver_policy_count\n"
    report += "- 基准：件均保费 > 200 元\n\n"
    
    # 2.3 驾乘险件数
    report += "### 2.3 驾乘险件数分析\n\n"
    report += "驾乘险件数直接反映了交叉销售的绝对成果。件数越多，说明驾乘险销售业绩越好。\n\n"
    report += "**关键指标**：\n"
    report += "- 驾乘险件数 = driver_policy_count\n"
    report += "- 增长目标：环比增长 > 5%\n\n"
    
    # 三、数据表格
    report += "## 三、详细数据表格\n\n"
    
    report += generate_table('驾乘险推介率 (%)', org_data, '推介率')
    report += '\n\n'
    
    report += generate_table('驾乘险件均保费 (元)', org_data, '驾乘险件均保费')
    report += '\n\n'
    
    report += generate_table('驾乘险件数', org_data, 'driver_policy_count')
    report += '\n\n'
    
    report += "---\n\n"
    report += f"**报告生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    report += "**数据来源**: 车险保单综合明细表（商业保险）\n"
    report += "**生成工具**: OpenClaw 自动化日报系统\n"
    
    return report


def _trend_arrow(delta, threshold=0.3):
    """趋势箭头"""
    if delta > threshold:
        return '↑'
    if delta < -threshold:
        return '↓'
    return '→'


def build_feishu_card_payload(data):
    """构建飞书卡片 payload（基于真实字段计算）"""
    df = pd.DataFrame(data)
    if df.empty:
        return None

    df['日期'] = pd.to_datetime(df['日期'])
    daily = (
        df.groupby('日期', as_index=False)
        .agg(
            auto_count=('auto_count', 'sum'),
            driver_count=('driver_count', 'sum'),
            driver_policy_count=('driver_policy_count', 'sum'),
            driver_premium=('driver_premium', 'sum')
        )
        .sort_values('日期')
    )

    daily['推介率'] = (daily['driver_count'] / daily['auto_count'] * 100).fillna(0).round(2)
    daily['驾乘险件均保费'] = (daily['driver_premium'] / daily['driver_policy_count']).fillna(0).round(2)

    if len(daily) >= 7:
        last7 = daily.tail(7)
        last7_rate = (last7['driver_count'].sum() / last7['auto_count'].sum() * 100) if last7['auto_count'].sum() else 0
        last7_avg_premium = (last7['driver_premium'].sum() / last7['driver_policy_count'].sum()) if last7['driver_policy_count'].sum() else 0
        last7_count = int(last7['driver_policy_count'].sum())

        if len(daily) >= 14:
            prev7 = daily.iloc[-14:-7]
            prev7_rate = (prev7['driver_count'].sum() / prev7['auto_count'].sum() * 100) if prev7['auto_count'].sum() else 0
            prev7_avg_premium = (prev7['driver_premium'].sum() / prev7['driver_policy_count'].sum()) if prev7['driver_policy_count'].sum() else 0
            prev7_count = int(prev7['driver_policy_count'].sum())
        else:
            prev7_rate = last7_rate
            prev7_avg_premium = last7_avg_premium
            prev7_count = last7_count
    else:
        last_day = daily.tail(1)
        last7_rate = float(last_day['推介率'].iloc[0])
        last7_avg_premium = float(last_day['驾乘险件均保费'].iloc[0])
        last7_count = int(last_day['driver_policy_count'].iloc[0])
        prev7_rate = last7_rate
        prev7_avg_premium = last7_avg_premium
        prev7_count = last7_count

    rate_delta = round(last7_rate - prev7_rate, 2)
    premium_delta = round(last7_avg_premium - prev7_avg_premium, 2)
    count_delta = last7_count - prev7_count

    latest_date = df['日期'].max()
    latest_org = (
        df[df['日期'] == latest_date][['三级机构', '推介率', '驾乘险件均保费', 'driver_policy_count']]
        .sort_values('推介率', ascending=False)
    )

    good_orgs = latest_org.head(5)
    bad_orgs = latest_org.tail(5).sort_values('推介率', ascending=True)

    def fmt_org_lines(sub_df):
        lines = []
        for _, row in sub_df.iterrows():
            lines.append(
                f"- {row['三级机构']}｜推介率 {row['推介率']:.2f}%｜件均 {row['驾乘险件均保费']:.0f} 元｜件数 {int(row['driver_policy_count'])}"
            )
        return '\n'.join(lines) if lines else '- 暂无数据'

    start_date = daily['日期'].min().strftime('%Y-%m-%d')
    end_date = daily['日期'].max().strftime('%Y-%m-%d')
    report_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    return {
        "msg_type": "interactive",
        "card": {
            "header": {
                "template": "blue",
                "title": {
                    "tag": "plain_text",
                    "content": f"驾乘险推介率日报｜{report_date}"
                }
            },
            "elements": [
                {
                    "tag": "markdown",
                    "content": (
                        "**最近7天 vs 前7天**\n"
                        f"- 推介率：**{last7_rate:.2f}%** {_trend_arrow(rate_delta)} ({rate_delta:+.2f}pct)\n"
                        f"- 件均保费：**{last7_avg_premium:.0f} 元** {_trend_arrow(premium_delta, threshold=5)} ({premium_delta:+.0f}元)\n"
                        f"- 驾乘险件数：**{last7_count}** {_trend_arrow(count_delta, threshold=5)} ({count_delta:+d})"
                    )
                },
                {"tag": "hr"},
                {
                    "tag": "markdown",
                    "content": "**问题机构 Top5（按最新日推介率）**\n" + fmt_org_lines(bad_orgs)
                },
                {
                    "tag": "markdown",
                    "content": "**优秀机构 Top5（按最新日推介率）**\n" + fmt_org_lines(good_orgs)
                },
                {"tag": "hr"},
                {
                    "tag": "markdown",
                    "content": f"数据范围：{start_date} ~ {end_date}\\n口径：排除报价记录；险类=商业保险；按签单日期统计"
                }
            ]
        }
    }


def main():
    """主函数"""
    print('🚀 驾乘险推介率日报生成器启动...\n')
    
    try:
        # 1. 查找最新数据文件
        print('📂 查找最新数据文件...')
        parquet_path = find_latest_parquet()
        print(f'   ✓ 数据文件: {parquet_path.name}')
        
        # 2. 查询数据
        print(f'📈 查询最近{CONFIG["days_to_analyze"]}天数据（商业险）...')
        data = query_data(parquet_path, CONFIG['days_to_analyze'])
        print(f'   ✓ 查询到 {len(data)} 条记录')
        
        if not data:
            print('❌ 未查询到数据，请检查数据源')
            sys.exit(1)
        
        # 3. 组织数据
        print('🔄 组织数据结构...')
        org_data = organize_by_org(data)
        print(f'   ✓ {len(org_data)} 个三级机构')
        
        # 4. 生成分析
        print('💡 生成分析结论...')
        analyses = generate_analysis(org_data)
        
        # 5. 生成报告
        print('📝 生成日报...')
        report = generate_report(data, analyses, org_data)
        
        # 6. 生成 CSV
        print('📊 生成 CSV 数据...')
        csv = generate_csv(data)

        # 7. 生成飞书卡片 payload
        print('🧩 生成飞书卡片 JSON...')
        feishu_card = build_feishu_card_payload(data)

        # 8. 保存文件（使用昨天的日期）
        output_dir = CONFIG['output_path']
        output_dir.mkdir(parents=True, exist_ok=True)

        yesterday = datetime.now() - timedelta(days=1)
        date_str = yesterday.strftime('%Y-%m-%d')
        report_file = output_dir / f"驾乘险推介率日报_{date_str}.md"
        csv_file = output_dir / f"驾乘险推介率数据_{date_str}.csv"
        card_file = output_dir / f"驾乘险推介率卡片_{date_str}.json"

        report_file.write_text(report, encoding='utf-8')
        csv_file.write_text(csv, encoding='utf-8')
        if feishu_card:
            card_file.write_text(json.dumps(feishu_card, ensure_ascii=False, indent=2), encoding='utf-8')

        print(f'\n✅ 日报生成成功！')
        print(f'📄 Markdown: {report_file}')
        print(f'📊 CSV数据: {csv_file}')
        if feishu_card:
            print(f'🧩 飞书卡片: {card_file}')
        print('')
        
        # 8. 输出到控制台
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
