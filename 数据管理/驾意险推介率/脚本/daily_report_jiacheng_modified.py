#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
驾意险推介率日报生成器

读取 warehouse/fact/policy/current/ 全部分片，
使用 cross_sell_premium_driver / is_cross_sell 真实字段计算推介率。
"""

import sys
import json
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

# 配置
SCRIPT_DIR = Path(__file__).parent.parent
CONFIG = {
    'data_path': SCRIPT_DIR.parent / 'warehouse/fact/policy/current',
    'cross_sell_path': SCRIPT_DIR.parent / 'warehouse/fact/cross_sell/latest.parquet',
    'output_path': SCRIPT_DIR / '输出',
    'days_to_analyze': 14,
    'timezone': 'Asia/Shanghai'
}


def find_parquet_files():
    """查找 current/ 下所有 Parquet 分片文件"""
    data_dir = CONFIG['data_path']
    if not data_dir.exists():
        raise FileNotFoundError(f"数据目录不存在: {data_dir}")

    parquet_files = sorted(data_dir.glob('*.parquet'))
    if not parquet_files:
        raise FileNotFoundError(f"未找到 Parquet 文件: {data_dir}")

    return parquet_files


def query_data(parquet_files, days=14):
    """查询最近N天的驾意险数据（JOIN cross_sell 域获取真实字段）"""
    df = pd.concat([pd.read_parquet(f) for f in parquet_files], ignore_index=True)

    date_col = 'policy_date'
    vin_col = 'vehicle_frame_no'
    org_col = 'org_level_3'
    premium_col = 'premium'

    df[date_col] = pd.to_datetime(df[date_col])
    latest_date = df[date_col].max().date()
    start_date = latest_date - timedelta(days=days - 1)
    df = df[(df[date_col].dt.date >= start_date) & (df[date_col].dt.date <= latest_date)]

    # 筛选商业保险（推介率分母口径：主全+交三，排除纯交强/单交）
    if 'insurance_type' in df.columns:
        df = df[df['insurance_type'] == '商业保险']

    required_cols = [vin_col, org_col, premium_col, 'policy_no']
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        raise ValueError(f'缺少必需列: {missing_cols}')

    # JOIN 交叉销售域（8域拆分架构：cross_sell 独立于 PolicyFact）
    cs_path = CONFIG['cross_sell_path']
    if cs_path.exists():
        cs = pd.read_parquet(cs_path, columns=['policy_no', 'is_cross_sell', 'cross_sell_premium_driver'])
        cs['cross_sell_premium_driver'] = pd.to_numeric(
            cs['cross_sell_premium_driver'], errors='coerce'
        ).fillna(0)
        df = df.merge(cs, on='policy_no', how='left')
        df['is_cross_sell'] = df['is_cross_sell'].fillna(False)
        df['cross_sell_premium_driver'] = df['cross_sell_premium_driver'].fillna(0)
        # 口径对齐 server getCrossSellCondition()：用 is_cross_sell 布尔标识，非保费金额
        df['_is_driver'] = df['is_cross_sell'] == True
        driver_premium_col = 'cross_sell_premium_driver'
    else:
        raise FileNotFoundError(f'交叉销售数据不存在: {cs_path}')

    df['_date'] = df[date_col].dt.date

    # 全量统计（按机构+日期）
    all_stats = df.groupby([org_col, '_date']).agg(
        auto_count=(vin_col, 'nunique'),
        auto_premium=(premium_col, 'sum'),
    ).reset_index()

    # 驾意险子集统计
    driver_df = df[df['_is_driver']]
    driver_stats = driver_df.groupby([org_col, '_date']).agg(
        driver_count=(vin_col, 'nunique'),
        driver_premium=(driver_premium_col, 'sum'),
    ).reset_index()

    # 合并
    daily_stats = all_stats.merge(driver_stats, on=[org_col, '_date'], how='left')
    daily_stats.rename(columns={org_col: '三级机构', '_date': '日期'}, inplace=True)

    daily_stats['driver_count'] = daily_stats['driver_count'].fillna(0).astype(int)
    daily_stats['driver_premium'] = daily_stats['driver_premium'].fillna(0)
    daily_stats['driver_policy_count'] = daily_stats['driver_count']

    for col in ['auto_count', 'auto_premium']:
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
                'driver_count_by_date': {},
                'auto_count_by_date': {},
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
    
    # 识别问题机构
    avg_rates = {}
    for org in orgs:
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
            'content': f"推介率偏低的机构：{', '.join([f'{org}({rate:.2f}%)' for org, rate in problem_orgs])}。"
                      "建议重点关注培训与激励措施。"
        })
    
    # 识别优秀机构
    top_orgs = sorted(
        [(org, rate) for org, rate in avg_rates.items() if rate > overall_avg * 1.2],
        key=lambda x: x[1],
        reverse=True
    )[:3]
    
    if top_orgs:
        analyses.append({
            'type': '优秀机构',
            'content': f"推介率领先的机构：{', '.join([f'{org}({rate:.2f}%)' for org, rate in top_orgs])}。"
                      "建议总结推广优秀经验。"
        })
    
    return analyses


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
    report += "驾意险推介率反映了业务员向客户推荐驾意险的积极性和能力。\n\n"
    report += "**口径**: 推介率 = 驾意险推介件数 / 商业险出单件数（车架号去重）\n"
    report += "**目标**: 推介率应保持在 30% 以上\n\n"
    
    # 2.2 件均保费
    report += "### 2.2 驾意险件均保费分析\n\n"
    report += "驾意险件均保费反映了驾意险保单的价值。\n\n"
    report += "**口径**: 驾意险件均保费 = 驾意险总保费 / 驾意险推介件数\n"
    report += "**基准**: 件均保费 > 200 元\n\n"
    
    # 三、数据表格
    report += "## 三、详细数据表格\n\n"
    
    # 生成推介率表格
    orgs = sorted(org_data.keys())
    all_dates = set()
    for org in orgs:
        all_dates.update(org_data[org]['dates'])
    sorted_dates = sorted(all_dates)
    
    report += "### 驾意险推介率 (%)\n\n"
    report += '| 三级机构 | ' + ' | '.join([
        f"{d.month}/{d.day}" for d in sorted_dates
    ]) + ' |\n'
    report += '|------' + '|------' * len(sorted_dates) + '|\n'
    
    for org in orgs:
        report += f'| {org} |'
        for date in sorted_dates:
            value = org_data[org]['推介率'].get(date)
            if value is not None:
                report += f' {value:.2f}% |'
            else:
                report += ' - |'
        report += '\n'
    
    report += '\n\n'
    
    # 生成件均保费表格
    report += "### 驾意险件均保费 (元)\n\n"
    report += '| 三级机构 | ' + ' | '.join([
        f"{d.month}/{d.day}" for d in sorted_dates
    ]) + ' |\n'
    report += '|------' + '|------' * len(sorted_dates) + '|\n'
    
    for org in orgs:
        report += f'| {org} |'
        for date in sorted_dates:
            value = org_data[org]['驾意险件均保费'].get(date)
            if value is not None:
                report += f' {value:.0f} |'
            else:
                report += ' - |'
        report += '\n'
    
    report += '\n\n'
    
    report += "---\n\n"
    report += f"**报告生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    report += "**数据来源**: 车险保单综合明细表\n"
    report += "**生成工具**: OpenClaw 自动化日报系统（适配版）\n"
    
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
                        f"- 推介率：**{last7_rate:.2f}%** {'↑' if rate_delta > 0 else '↓' if rate_delta < 0 else '→'} ({rate_delta:+.2f}pct)\n"
                        f"- 件均保费：**{last7_avg_premium:.0f} 元** {'↑' if premium_delta > 0 else '↓' if premium_delta < 0 else '→'} ({premium_delta:+.0f}元)\n"
                        f"- 驾意险件数：**{last7_count}** {'↑' if count_delta > 0 else '↓' if count_delta < 0 else '→'} ({count_delta:+d})"
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
        print('📂 查找数据文件...')
        parquet_files = find_parquet_files()
        print(f'   ✓ 数据文件: {len(parquet_files)} 个分片')
        
        # 2. 查询数据
        print(f'📈 查询最近{CONFIG["days_to_analyze"]}天数据...')
        data, latest_date = query_data(parquet_files, CONFIG['days_to_analyze'])
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
        
        # 6. 保存报告
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