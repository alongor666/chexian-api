#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
驾意险推介率日报生成器

功能：
1. 读取最近14天的数据
2. 筛选条件：险类 = 商业保险（如有）
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
    
    parquet_files = list(data_dir.glob('*.parquet'))
    if not parquet_files:
        raise FileNotFoundError(f"未找到 Parquet 文件: {data_dir}")
    
    # 优先选择"每日数据"
    daily_files = [f for f in parquet_files if '每日数据' in f.name]
    if daily_files:
        return sorted(daily_files)[-1]
    
    return sorted(parquet_files)[-1]


def query_data(parquet_path, days=14):
    """查询最近N天的驾意险数据"""
    df = cast(pd.DataFrame, pd.read_parquet(parquet_path))

    date_col = None
    for col in ['签单日期', 'policy_date']:
        if col in df.columns:
            date_col = col
            break
    if date_col is None:
        raise ValueError('未找到签单日期列')

    df[date_col] = pd.to_datetime(df[date_col])

    latest_date = df[date_col].max().date()
    start_date = latest_date - timedelta(days=days - 1)

    df = df[
        (df[date_col].dt.date >= start_date) &
        (df[date_col].dt.date <= latest_date)
    ]

    quote_col = None
    for col in ['是否报价', 'is_quote']:
        if col in df.columns:
            quote_col = col
            break
    if quote_col is not None:
        # 排除报价记录（True 为报价，False/None 为非报价）
        df = df[df[quote_col] != True]

    insurance_col = None
    for col in ['险类', 'insurance_type']:
        if col in df.columns:
            insurance_col = col
            break
    if insurance_col is not None:
        df = df[df[insurance_col] == '商业保险']

    cross_sell_col = None
    for col in ['交叉销售标识', 'is_cross_sell', '驾意险标识']:
        if col in df.columns:
            cross_sell_col = col
            break
    if cross_sell_col is None:
        raise ValueError('未找到交叉销售标识列')

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

    daily_stats = df.groupby([df[org_col], df[date_col].dt.date]).agg(
        auto_count=(vin_col, 'nunique'),
        driver_count=(vin_col, lambda x: x[df.loc[x.index, cross_sell_col] == True].nunique()),
        driver_policy_count=(policy_col, lambda x: x[df.loc[x.index, cross_sell_col] == True].nunique()),
        driver_premium=(premium_col, lambda x: x[df.loc[x.index, cross_sell_col] == True].sum()),
        auto_premium=(premium_col, 'sum')
    ).reset_index()

    daily_stats.columns = [
        '三级机构',
        '日期',
        'auto_count',
        'driver_count',
        'driver_policy_count',
        'driver_premium',
        'auto_premium'
    ]

    # 确保数值列为正确的数据类型
    for col in ['auto_count', 'driver_count', 'driver_policy_count', 'driver_premium', 'auto_premium']:
        daily_stats[col] = pd.to_numeric(daily_stats[col], errors='coerce').fillna(0)

    daily_stats['推介率'] = (daily_stats['driver_count'] / daily_stats['auto_count'] * 100).round(2)
    daily_stats['驾意险件均保费'] = (daily_stats['driver_premium'] / daily_stats['driver_policy_count']).round(2)
    daily_stats['车险件均保费'] = (daily_stats['auto_premium'] / daily_stats['auto_count']).round(2)

    daily_stats = daily_stats.replace([float('inf'), float('-inf')], 0)
    daily_stats = daily_stats.fillna(0)
    daily_stats = daily_stats.sort_values(['三级机构', '日期'])

    return daily_stats.to_dict('records'), latest_date


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
                '驾意险件均保费': {},
                'driver_policy_count': {},
                'driver_count_by_date': {},   # 绝对值：驾意险件数（用于正确计算期间汇总推介率）
                'auto_count_by_date': {},     # 绝对值：车险件数（推介率分母）
            }

        if date not in org_data[org]['dates']:
            org_data[org]['dates'].append(date)

        org_data[org]['推介率'][date] = row['推介率'] or 0
        org_data[org]['驾意险件均保费'][date] = row['驾意险件均保费'] or 0
        org_data[org]['driver_policy_count'][date] = int(row['driver_policy_count'] or 0)
        org_data[org]['driver_count_by_date'][date] = int(row.get('driver_count') or 0)
        org_data[org]['auto_count_by_date'][date] = int(row.get('auto_count') or 0)
    
    # 排序日期
    for org in org_data:
        org_data[org]['dates'].sort()
    
    return org_data


def generate_analysis(data, org_data):
    """生成分析结论"""
    analyses = []
    orgs = list(org_data.keys())
    
    df = pd.DataFrame(data)
    if not df.empty:
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

        if len(daily) >= 7:
            last7 = daily.tail(7)
            prev7 = daily.iloc[-14:-7] if len(daily) >= 14 else pd.DataFrame()

            last7_rate = (last7['driver_count'].sum() / last7['auto_count'].sum() * 100) if last7['auto_count'].sum() else 0
            last7_premium = (last7['driver_premium'].sum() / last7['driver_policy_count'].sum()) if last7['driver_policy_count'].sum() else 0
            last7_count = int(last7['driver_policy_count'].sum())

            if not prev7.empty:
                prev7_rate = (prev7['driver_count'].sum() / prev7['auto_count'].sum() * 100) if prev7['auto_count'].sum() else 0
                prev7_premium = (prev7['driver_premium'].sum() / prev7['driver_policy_count'].sum()) if prev7['driver_policy_count'].sum() else 0
                prev7_count = int(prev7['driver_policy_count'].sum())

                rate_change = last7_rate - prev7_rate
                premium_change = last7_premium - prev7_premium
                count_change = last7_count - prev7_count

                analyses.append({
                    'type': '整体趋势',
                    'content': f"最近7天对比前7天：推介率{'上升' if rate_change > 0 else '下降'} {abs(rate_change):.2f}%，"
                              f"驾意险件均保费{'上升' if premium_change > 0 else '下降'} {abs(premium_change):.0f}元，"
                              f"驾意险件数{'增加' if count_change > 0 else '减少'} {abs(count_change)}件"
                })
    
    # 2. 识别问题机构（推介率低于平均水平）
    # 治理规则：基于绝对值（驾意件数/车险件数）重算，禁止对子项率值做算术平均
    avg_rates = {}
    for org in orgs:
        if 'driver_count_by_date' not in org_data[org]:
            raise KeyError(f"org_data['{org}'] 缺少 driver_count_by_date，请确保 organize_by_org() 已更新")
        total_driver = sum(org_data[org]['driver_count_by_date'].values())
        total_auto = sum(org_data[org]['auto_count_by_date'].values())
        avg_rates[org] = (total_driver / total_auto * 100) if total_auto else 0

    all_driver = sum(sum(org_data[org]['driver_count_by_date'].values()) for org in orgs)
    all_auto = sum(sum(org_data[org]['auto_count_by_date'].values()) for org in orgs)
    overall_avg = (all_driver / all_auto * 100) if all_auto else 0
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
                elif metric == '驾意险件均保费':
                    table += f' {value:.0f} |'
                else:
                    table += f' {int(value)} |'
            else:
                table += ' - |'
        table += '\n'
    
    return table


def generate_report(data, analyses, org_data, latest_date):
    """生成完整日报"""
    date_str = latest_date.strftime('%Y年%m月%d日')
    
    report = f"# 驾意险推介率日报\n\n"
    report += f"**报告日期**: {date_str}\n"
    report += f"**分析周期**: 最近 {CONFIG['days_to_analyze']} 天\n"
    report += f"**数据截止**: {latest_date.strftime('%Y-%m-%d')}\n"
    report += "**筛选条件**: 险类 = 商业保险\n\n"
    
    report += "---\n\n"
    
    # 一、结论先行
    report += "## 一、核心结论\n\n"
    for idx, analysis in enumerate(analyses, 1):
        report += f"### {idx}. {analysis['type']}\n\n"
        report += f"{analysis['content']}\n\n"
    
    # 二、分论点详解
    report += "## 二、详细分析\n\n"
    
    # 2.1 驾意险推介率
    report += "### 2.1 驾意险推介率分析\n\n"
    report += "驾意险推介率反映了业务员向客户推荐驾意险的积极性和能力。推介率越高，说明交叉销售工作越到位。\n\n"
    report += "**关键指标**：\n"
    report += "- 推介率 = driver_count / auto_count × 100%（车架号去重）\n"
    report += "- 目标：推介率应保持在 30% 以上\n"
    report += "- 优秀机构：推介率 > 40%\n\n"
    
    # 2.2 件均保费
    report += "### 2.2 驾意险件均保费分析\n\n"
    report += "驾意险件均保费反映了驾意险保单的价值。件均保费高，说明业务员推荐的驾意险保障更全面。\n\n"
    report += "**关键指标**：\n"
    report += "- 驾意险件均保费 = driver_premium / driver_policy_count\n"
    report += "- 基准：件均保费 > 200 元\n\n"
    
    # 2.3 驾意险件数
    report += "### 2.3 驾意险件数分析\n\n"
    report += "驾意险件数直接反映了交叉销售的绝对成果。件数越多，说明驾意险销售业绩越好。\n\n"
    report += "**关键指标**：\n"
    report += "- 驾意险件数 = driver_policy_count\n"
    report += "- 日均目标：根据机构规模差异\n"
    report += "- 增长目标：环比增长 > 5%\n\n"
    
    # 三、数据表格
    report += "## 三、详细数据表格\n\n"
    
    report += generate_table('驾意险推介率 (%)', org_data, '推介率')
    report += '\n\n'
    
    report += generate_table('驾意险件均保费 (元)', org_data, '驾意险件均保费')
    report += '\n\n'
    
    report += generate_table('驾意险件数', org_data, 'driver_policy_count')
    report += '\n\n'
    
    report += "---\n\n"
    report += f"**报告生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    report += "**数据来源**: 车险保单综合明细表\n"
    report += "**生成工具**: OpenClaw 自动化日报系统\n"
    
    return report


def generate_csv(data):
    csv = '三级机构,日期,auto_count,driver_count,driver_policy_count,driver_premium,auto_premium,推介率,驾意险件均保费,车险件均保费\n'
    for row in data:
        csv += (
            f'"{row["三级机构"]}",{row["日期"]},{row["auto_count"]},{row["driver_count"]},'
            f'{row["driver_policy_count"]},{row["driver_premium"]},{row["auto_premium"]},'
            f'{row["推介率"]},{row["驾意险件均保费"]},{row["车险件均保费"]}\n'
        )
    return csv


def _trend_arrow(delta, threshold=0.3):
    if delta > threshold:
        return '↑'
    if delta < -threshold:
        return '↓'
    return '→'


def build_feishu_card_payload(data):
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
    daily['驾意险件均保费'] = (daily['driver_premium'] / daily['driver_policy_count']).fillna(0).round(2)

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
        last7_avg_premium = float(last_day['驾意险件均保费'].iloc[0])
        last7_count = int(last_day['driver_policy_count'].iloc[0])
        prev7_rate = last7_rate
        prev7_avg_premium = last7_avg_premium
        prev7_count = last7_count

    rate_delta = round(last7_rate - prev7_rate, 2)
    premium_delta = round(last7_avg_premium - prev7_avg_premium, 2)
    count_delta = last7_count - prev7_count

    latest_date = df['日期'].max()
    latest_org = (
        df[df['日期'] == latest_date][['三级机构', '推介率', '驾意险件均保费', 'driver_policy_count']]
        .sort_values('推介率', ascending=False)
    )

    good_orgs = latest_org.head(5)
    bad_orgs = latest_org.tail(5).sort_values('推介率', ascending=True)

    def fmt_org_lines(sub_df):
        lines = []
        for _, row in sub_df.iterrows():
            lines.append(
                f"- {row['三级机构']}｜推介率 {row['推介率']:.2f}%｜件均 {row['驾意险件均保费']:.0f} 元｜件数 {int(row['driver_policy_count'])}"
            )
        return '\n'.join(lines) if lines else '- 暂无数据'

    start_date = daily['日期'].min().strftime('%Y-%m-%d')
    end_date = daily['日期'].max().strftime('%Y-%m-%d')
    report_date = latest_date.strftime('%Y-%m-%d')

    return {
        "msg_type": "interactive",
        "card": {
            "header": {
                "template": "blue",
                "title": {
                    "tag": "plain_text",
                    "content": f"驾意险推介率日报｜{report_date}"
                }
            },
            "elements": [
                {
                    "tag": "markdown",
                    "content": (
                        "**最近7天 vs 前7天**\n"
                        f"- 推介率：**{last7_rate:.2f}%** {_trend_arrow(rate_delta)} ({rate_delta:+.2f}pct)\n"
                        f"- 件均保费：**{last7_avg_premium:.0f} 元** {_trend_arrow(premium_delta, threshold=5)} ({premium_delta:+.0f}元)\n"
                        f"- 驾意险件数：**{last7_count}** {_trend_arrow(count_delta, threshold=5)} ({count_delta:+d})"
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
    print('🚀 驾意险推介率日报生成器启动...\n')
    
    try:
        # 1. 查找最新数据文件
        print('📂 查找最新数据文件...')
        parquet_path = find_latest_parquet()
        print(f'   ✓ 数据文件: {parquet_path.name}')
        
        # 2. 查询数据（返回数据和最新日期）
        print(f'📈 查询最近{CONFIG["days_to_analyze"]}天数据...')
        data, latest_date = query_data(parquet_path, CONFIG['days_to_analyze'])
        print(f'   ✓ 查询到 {len(data)} 条记录')
        print(f'   ✓ 数据截止日期: {latest_date}')
        
        if not data:
            print('❌ 未查询到数据，请检查数据源')
            sys.exit(1)
        
        # 3. 组织数据
        print('🔄 组织数据结构...')
        org_data = organize_by_org(data)
        print(f'   ✓ {len(org_data)} 个机构')
        
        # 4. 生成分析
        print('💡 生成分析结论...')
        analyses = generate_analysis(data, org_data)
        
        # 5. 生成报告
        print('📝 生成日报...')
        report = generate_report(data, analyses, org_data, latest_date)
        
        # 6. 保存报告（基于数据的最新日期）
        output_dir = CONFIG['output_path']
        output_dir.mkdir(parents=True, exist_ok=True)
        
        date_str = latest_date.strftime('%Y-%m-%d')
        output_file = output_dir / f"驾意险推介率日报_{date_str}.md"
        csv_file = output_dir / f"驾意险推介率数据_{date_str}.csv"
        card_file = output_dir / f"驾意险推介率卡片_{date_str}.json"

        output_file.write_text(report, encoding='utf-8')
        csv_file.write_text(generate_csv(data), encoding='utf-8')
        card_payload = build_feishu_card_payload(data)
        if card_payload:
            card_file.write_text(json.dumps(card_payload, ensure_ascii=False, indent=2), encoding='utf-8')
        
        print(f'\n✅ 日报生成成功！')
        print(f'📄 文件路径: {output_file}')
        print(f'📊 CSV数据: {csv_file}')
        if card_payload:
            print(f'🧩 飞书卡片: {card_file}')
        print(f'📅 数据日期: {latest_date}\n')
        
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
