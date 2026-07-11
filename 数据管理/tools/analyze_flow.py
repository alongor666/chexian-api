#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
客户来源去向 自助分析工具

用法（--province 必填，fail-closed 只接受已注册省份，见 data-pipeline.md 省份隔离红线）:
    # 单省全板块
    python3 数据管理/tools/analyze_flow.py --province SC

    # 2026年营业货车10吨以上
    python3 数据管理/tools/analyze_flow.py --province SC --category 营业货车 --tonnage 10吨以上 --year 2026

    # 聚焦主全+交三
    python3 数据管理/tools/analyze_flow.py --province SC --coverage 主全,交三

    # 只看转入（从竞品转来华安）
    python3 数据管理/tools/analyze_flow.py --province SC --direction inbound

    # 只看流向华农和中意
    python3 数据管理/tools/analyze_flow.py --province SC --insurer 华农,中意

    # 选择板块
    python3 数据管理/tools/analyze_flow.py --province SC --sections summary,insurer,org

    # 指定机构
    python3 数据管理/tools/analyze_flow.py --province SC --org 天府,新都

    # 流失归因（评级对比 + 四象限 + 渠道/业务员归因）
    python3 数据管理/tools/analyze_flow.py --province SC --sections loss --direction outbound

    # 个人客车流失归因
    python3 数据管理/tools/analyze_flow.py --province SC --category 非营业个人客车 --sections loss

板块: summary, insurer, org, coverage, tonnage, risk, premium, trend, loss
"""

import argparse
import sys
import unicodedata
from pathlib import Path
from datetime import datetime

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb"); sys.exit(1)

# ── 路径 ──

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))  # 供 import pipelines.*（branch_paths SSOT）
from pipelines.branch_paths import (  # noqa: E402
    PolicyCurrentLayoutError,
    policy_current_glob,
    resolve_province,
)
_WAREHOUSE = _PROJECT_ROOT / 'warehouse'
_CF_PATH = _WAREHOUSE / 'fact' / 'customer_flow' / 'latest.parquet'
_POLICY_DIR = _WAREHOUSE / 'fact' / 'policy' / 'current'
_QUOTES_PATH = _WAREHOUSE / 'fact' / 'quotes' / 'latest.parquet'

ALL_SECTIONS = ['summary', 'insurer', 'org', 'coverage', 'tonnage', 'risk', 'premium', 'trend', 'loss']

# ── 终端格式化 ──

def _dw(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in ('W', 'F') else 1 for c in str(s))

def _pad(s: str, w: int) -> str:
    s = str(s); return s + ' ' * max(0, w - _dw(s))

def _print_table(title: str, rows: list, headers: list, aligns: list | None = None):
    if not rows:
        print(f"\n   {title}\n   （无数据）"); return
    if not aligns:
        aligns = ['l'] * len(headers)
    widths = [max(_dw(h), max((_dw(str(r[i])) for r in rows), default=0)) + 2
              for i, h in enumerate(headers)]
    print(f"\n   {title}")
    hdr = '   '
    sep = '   '
    for i, h in enumerate(headers):
        hdr += str(h).rjust(widths[i]) if aligns[i] == 'r' else _pad(h, widths[i])
        sep += '-' * widths[i]
    print(hdr)
    print(sep)
    for r in rows:
        line = '   '
        for i, v in enumerate(r):
            line += str(v).rjust(widths[i]) if aligns[i] == 'r' else _pad(str(v), widths[i])
        print(line)

def _banner(text: str, char: str = '='):
    print(f"\n{char * 80}")
    print(f"   {text}")
    print(f"{char * 80}")

def _sub_banner(text: str):
    _banner(text, '─')

# ── 参数解析 ──

def parse_args():
    p = argparse.ArgumentParser(description='客户来源去向自助分析')
    p.add_argument('--province', required=True,
                   help='省份代码（fail-closed：仅接受已注册省份如 SC/SX，缺省/未知即报错中止；'
                        'data-pipeline.md「省份数据隔离」红线）')
    p.add_argument('--category', help='客户类别筛选（逗号分隔）')
    p.add_argument('--tonnage', help='吨位段筛选（如 10吨以上）')
    p.add_argument('--year', type=int, help='保单年度（按保险起期）')
    p.add_argument('--coverage', help='险别组合筛选（逗号分隔，如 主全,交三）')
    p.add_argument('--direction', choices=['inbound', 'outbound', 'all'], default='all',
                   help='inbound=转入, outbound=流出, all=全部')
    p.add_argument('--insurer', help='聚焦保险公司（逗号分隔，模糊匹配，如 华农,中意）')
    p.add_argument('--org', help='机构筛选（逗号分隔）')
    p.add_argument('--expire-from', help='到期日期起（YYYY-MM-DD），按 insurance_end_date 筛选')
    p.add_argument('--expire-to', help='到期日期止（YYYY-MM-DD），按 insurance_end_date 筛选')
    p.add_argument('--sections', default=','.join(ALL_SECTIONS),
                   help=f'板块选择（逗号分隔，可选: {", ".join(ALL_SECTIONS)}）')
    p.add_argument('--top', type=int, default=10, help='TOP N 条数（默认 10）')
    return p.parse_args()

# ── 数据加载 ──

def _is_expire_mode(args) -> bool:
    """是否为到期模式（按 insurance_end_date 筛选）"""
    return bool(getattr(args, 'expire_from', None) or getattr(args, 'expire_to', None))


def _load_quotes(con: duckdb.DuckDBPyConnection):
    """加载报价表（用于 loss 板块评级对比）"""
    if _QUOTES_PATH.exists():
        con.execute(f"""
            CREATE TABLE quotes AS
            SELECT vehicle_frame_no AS q_vin,
                   insurance_grade AS quote_grade
            FROM read_parquet('{_QUOTES_PATH}')
            WHERE insurance_grade IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no ORDER BY quote_time DESC) = 1
        """)
    else:
        con.execute("CREATE TABLE quotes (q_vin VARCHAR, quote_grade VARCHAR)")


def _build_category_conditions(args) -> list[str]:
    """构建通用筛选条件（客户类别/吨位/险别/机构）"""
    conditions = []
    if args.category:
        cats = [c.strip() for c in args.category.split(',')]
        cat_list = ', '.join(f"'{c}'" for c in cats)
        conditions.append(f"customer_category IN ({cat_list})")
    if args.tonnage:
        conditions.append(f"tonnage_segment = '{args.tonnage}'")
    if args.coverage:
        covs = [c.strip() for c in args.coverage.split(',')]
        cov_list = ', '.join(f"'{c}'" for c in covs)
        conditions.append(f"coverage_combination IN ({cov_list})")
    if args.org:
        orgs = [o.strip() for o in args.org.split(',')]
        org_list = ', '.join(f"'{o}'" for o in orgs)
        conditions.append(f"org_level_3 IN ({org_list})")
    return conditions


def load_data(con: duckdb.DuckDBPyConnection, args, province: str):
    """加载并关联数据，返回筛选后的表名 'flow'。

    province 已经 resolve_province fail-closed 校验（仅已注册省份）；
    glob 收窄仅是性能辅助，WHERE branch_code 才是隔离保证（data-pipeline.md 红线）。
    """
    _policy_glob = policy_current_glob(_POLICY_DIR, province, missing_ok=True)
    con.execute(f"""
        CREATE TABLE policy AS
        SELECT * FROM read_parquet('{_policy_glob}', union_by_name=true)
        WHERE branch_code = '{province}'
    """)
    _load_quotes(con)

    # ── 到期模式：直接从 policy 表筛选，用 VIN 匹配续保 ──
    if _is_expire_mode(args):
        expire_from = getattr(args, 'expire_from', None) or '1900-01-01'
        expire_to = getattr(args, 'expire_to', None) or '2099-12-31'

        conditions = _build_category_conditions(args)
        conditions.append(f"insurance_end_date >= '{expire_from}'")
        conditions.append(f"insurance_end_date <= '{expire_to}'")
        if args.year:
            conditions.append(f"YEAR(insurance_start_date) = {args.year}")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        con.execute(f"""
            CREATE TABLE expired AS
            SELECT policy_no, vehicle_frame_no, insurance_start_date,
                   insurance_end_date, org_level_3, customer_category,
                   coverage_combination, premium, tonnage_value, tonnage_segment,
                   truck_type, commercial_pricing_factor, insurance_grade,
                   salesman_name, agent_name,
                   is_renewal, is_transfer, is_nev, insurance_type,
                   plate_no, insured_gender, driver_age_group
            FROM policy {where}
        """)

        # 次年续保 VIN 集合
        con.execute("""
            CREATE TABLE renewed_vins AS
            SELECT DISTINCT vehicle_frame_no
            FROM policy
            WHERE insurance_start_date >= (
                SELECT MIN(insurance_end_date) FROM expired
            )
        """)

        # 构建 flow 表，用 next_insurer='(流失)' 标记未续保
        con.execute("""
            CREATE TABLE base AS
            SELECT e.*,
                   CAST(NULL AS VARCHAR) AS previous_insurer,
                   CASE WHEN r.vehicle_frame_no IS NULL THEN '(流失)' ELSE NULL END AS next_insurer,
                   q.quote_grade
            FROM expired e
            LEFT JOIN renewed_vins r ON e.vehicle_frame_no = r.vehicle_frame_no
            LEFT JOIN quotes q ON e.vehicle_frame_no = q.q_vin
        """)

        # 到期模式只看流失（direction 默认 outbound）
        if args.direction == 'inbound':
            con.execute("CREATE TABLE flow AS SELECT * FROM base WHERE next_insurer IS NULL")
        elif args.direction == 'outbound':
            con.execute("CREATE TABLE flow AS SELECT * FROM base WHERE next_insurer IS NOT NULL")
        else:
            con.execute("CREATE TABLE flow AS SELECT * FROM base")

        total = con.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
        return total

    # ── 标准模式：通过 customer_flow 关联（customer_flow 也带 branch_code 列，同层过滤）──
    con.execute(f"""
        CREATE TABLE cf AS SELECT * FROM read_parquet('{_CF_PATH}')
        WHERE branch_code = '{province}'
    """)

    con.execute("""
        CREATE TABLE base AS
        SELECT cf.policy_no, cf.insurance_start_date,
               cf.previous_insurer, cf.next_insurer, cf.vehicle_frame_no,
               p.org_level_3, p.customer_category, p.coverage_combination,
               p.premium, p.tonnage_value, p.tonnage_segment, p.truck_type,
               p.commercial_pricing_factor, p.insurance_grade,
               p.salesman_name, p.agent_name,
               p.is_renewal, p.is_transfer, p.is_nev, p.insurance_type,
               p.plate_no, p.insured_gender, p.driver_age_group,
               q.quote_grade
        FROM cf
        LEFT JOIN policy p ON cf.policy_no = p.policy_no
        LEFT JOIN quotes q ON cf.vehicle_frame_no = q.q_vin
    """)

    conditions = _build_category_conditions(args)
    if args.year:
        conditions.append(f"YEAR(insurance_start_date) = {args.year}")
    if args.direction == 'inbound':
        conditions.append("previous_insurer IS NOT NULL")
    elif args.direction == 'outbound':
        conditions.append("next_insurer IS NOT NULL")
    if args.insurer:
        insurers = [i.strip() for i in args.insurer.split(',')]
        insurer_conds = []
        for ins in insurers:
            insurer_conds.append(f"(previous_insurer LIKE '%{ins}%' OR next_insurer LIKE '%{ins}%')")
        conditions.append(f"({' OR '.join(insurer_conds)})")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    con.execute(f"CREATE TABLE flow AS SELECT * FROM base {where}")

    total = con.execute("SELECT COUNT(*) FROM flow").fetchone()[0]
    return total

# ── 板块实现 ──

def section_summary(con, args, top_n):
    """总量摘要"""
    _banner("Summary — 总量摘要")
    row = con.execute("""
        SELECT COUNT(*) AS total,
               COALESCE(SUM(premium), 0) AS total_prem,
               ROUND(COALESCE(AVG(premium), 0), 0) AS avg_prem,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound,
               COUNT(*) FILTER (WHERE next_insurer IS NOT NULL) AS outbound,
               COUNT(*) FILTER (WHERE previous_insurer IS NULL AND next_insurer IS NULL) AS neutral
        FROM flow
    """).fetchone()
    total, total_prem, avg_prem, inbound, outbound, neutral = row

    print(f"\n   总保单数:        {total:>10,}")
    print(f"   保费合计:        {total_prem/10000:>10,.1f} 万")
    print(f"   件均保费:        {avg_prem:>10,.0f} 元†")
    print()
    if _is_expire_mode(args):
        renewed = neutral  # next_insurer IS NULL = 续保
        lost = outbound    # next_insurer = '(流失)'
        if total:
            print(f"   续保（次年仍在华安）:     {renewed:>8,}  ({renewed*100/total:.1f}%)")
            print(f"   流失（次年未续保）:       {lost:>8,}  ({lost*100/total:.1f}%)")
    else:
        if total:
            print(f"   有上年承保主体（转入）:   {inbound:>8,}  ({inbound*100/total:.1f}%)")
            print(f"   有次年保险公司（流出）:   {outbound:>8,}  ({outbound*100/total:.1f}%)")
            print(f"   无流向标记:               {neutral:>8,}  ({neutral*100/total:.1f}%)")

    # 续保/过户/新能源
    row2 = con.execute("""
        SELECT COUNT(*) FILTER (WHERE is_renewal = true),
               COUNT(*) FILTER (WHERE is_transfer = true),
               COUNT(*) FILTER (WHERE is_nev = true),
               COUNT(*)
        FROM flow
    """).fetchone()
    if row2[3] > 0:
        print(f"\n   续保: {row2[0]:,} ({row2[0]*100/row2[3]:.1f}%) | "
              f"过户: {row2[1]:,} ({row2[1]*100/row2[3]:.1f}%) | "
              f"新能源: {row2[2]:,} ({row2[2]*100/row2[3]:.1f}%)")


def section_insurer(con, args, top_n):
    """竞品保险公司分析"""
    _banner("Insurer — 竞品保险公司")

    # 转入来源
    inbound = con.execute("SELECT COUNT(*) FROM flow WHERE previous_insurer IS NOT NULL").fetchone()[0]
    if inbound > 0:
        rows = con.execute(f"""
            SELECT SUBSTRING(previous_insurer, 1, 10) AS insurer,
                   COUNT(*) AS cnt,
                   ROUND(SUM(premium)/10000, 1) AS prem,
                   ROUND(AVG(premium), 0) AS avg_p
            FROM flow WHERE previous_insurer IS NOT NULL
            GROUP BY previous_insurer ORDER BY cnt DESC LIMIT {top_n}
        """).fetchall()
        _print_table(f"转入来源 TOP {top_n}（上年承保主体，{inbound:,} 单）", rows,
                     ['上年承保主体', '条数', '保费', '件均†'], ['l', 'r', 'r', 'r'])

    # 流出去向
    outbound = con.execute("SELECT COUNT(*) FROM flow WHERE next_insurer IS NOT NULL").fetchone()[0]
    if outbound > 0:
        rows = con.execute(f"""
            SELECT SUBSTRING(next_insurer, 1, 10) AS insurer,
                   COUNT(*) AS cnt,
                   ROUND(SUM(premium)/10000, 1) AS prem,
                   ROUND(AVG(premium), 0) AS avg_p
            FROM flow WHERE next_insurer IS NOT NULL
            GROUP BY next_insurer ORDER BY cnt DESC LIMIT {top_n}
        """).fetchall()
        _print_table(f"流出去向 TOP {top_n}（次年保险公司，{outbound:,} 单）", rows,
                     ['次年保险公司', '条数', '保费', '件均†'], ['l', 'r', 'r', 'r'])

    if inbound == 0 and outbound == 0:
        print("\n   无转入或流出记录")


def section_org(con, args, top_n):
    """机构分布"""
    _banner("Org — 机构分布")

    rows = con.execute(f"""
        SELECT COALESCE(org_level_3, '未关联') AS org,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               ROUND(AVG(premium), 0) AS avg_p,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound,
               COUNT(*) FILTER (WHERE next_insurer IS NOT NULL) AS outbound
        FROM flow
        GROUP BY org ORDER BY prem DESC LIMIT {top_n}
    """).fetchall()
    _print_table("机构分布", rows,
                 ['机构', '条数', '保费', '件均†', '转入', '流出'],
                 ['l', 'r', 'r', 'r', 'r', 'r'])


def section_coverage(con, args, top_n):
    """险别组合"""
    _banner("Coverage — 险别组合")

    rows = con.execute("""
        SELECT COALESCE(coverage_combination, '未关联') AS cov,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               ROUND(AVG(premium), 0) AS avg_p,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound,
               COUNT(*) FILTER (WHERE next_insurer IS NOT NULL) AS outbound
        FROM flow
        GROUP BY cov ORDER BY cnt DESC
    """).fetchall()
    _print_table("险别组合", rows,
                 ['险别组合', '条数', '保费', '件均†', '转入', '流出'],
                 ['l', 'r', 'r', 'r', 'r', 'r'])


def section_tonnage(con, args, top_n):
    """吨位细分（仅货车有意义）"""
    has_tonnage = con.execute(
        "SELECT COUNT(*) FROM flow WHERE tonnage_segment IS NOT NULL"
    ).fetchone()[0]
    if has_tonnage == 0:
        return  # 非货车无吨位数据，静默跳过

    _banner("Tonnage — 吨位细分")

    # 按 tonnage_segment
    rows = con.execute("""
        SELECT tonnage_segment AS seg, COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               ROUND(AVG(premium), 0) AS avg_p,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound,
               COUNT(*) FILTER (WHERE next_insurer IS NOT NULL) AS outbound
        FROM flow WHERE tonnage_segment IS NOT NULL
        GROUP BY seg
        ORDER BY CASE seg
            WHEN '1吨以下' THEN 1 WHEN '1-2吨' THEN 2 WHEN '2-9吨' THEN 3
            WHEN '9-10吨' THEN 4 WHEN '10吨以上' THEN 5 ELSE 6 END
    """).fetchall()
    _print_table("吨位段分布", rows,
                 ['吨位段', '条数', '保费', '件均†', '转入', '流出'],
                 ['l', 'r', 'r', 'r', 'r', 'r'])

    # 10吨以上细分（千克→吨）
    has_10t = con.execute(
        "SELECT COUNT(*) FROM flow WHERE tonnage_segment = '10吨以上'"
    ).fetchone()[0]
    if has_10t > 0:
        rows = con.execute("""
            SELECT CASE
                     WHEN tonnage_value/1000 < 15 THEN '10-14吨'
                     WHEN tonnage_value/1000 < 20 THEN '15-19吨'
                     WHEN tonnage_value/1000 < 31 THEN '20-30吨'
                     WHEN tonnage_value/1000 < 40 THEN '31-39吨'
                     ELSE '≥ 40吨'
                   END AS seg,
                   COUNT(*) AS cnt,
                   ROUND(SUM(premium)/10000, 1) AS prem,
                   ROUND(AVG(premium), 0) AS avg_p
            FROM flow
            WHERE tonnage_segment = '10吨以上' AND tonnage_value IS NOT NULL
            GROUP BY seg ORDER BY MIN(tonnage_value)
        """).fetchall()
        _print_table("10吨以上细分", rows,
                     ['吨位段', '条数', '保费', '件均†'], ['l', 'r', 'r', 'r'])

    # 货车类型
    rows = con.execute(f"""
        SELECT COALESCE(truck_type, '未知') AS tt, COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               ROUND(AVG(premium), 0) AS avg_p
        FROM flow WHERE truck_type IS NOT NULL
        GROUP BY tt ORDER BY cnt DESC LIMIT {top_n}
    """).fetchall()
    if rows:
        _print_table("货车类型", rows,
                     ['货车类型', '条数', '保费', '件均†'], ['l', 'r', 'r', 'r'])


def section_risk(con, args, top_n):
    """风险等级 + 定价系数"""
    _banner("Risk — 风险等级 + 定价系数")

    # 风险等级
    rows = con.execute("""
        SELECT COALESCE(insurance_grade, '无评级') AS grade,
               COUNT(*) AS cnt,
               ROUND(AVG(premium), 0) AS avg_p,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound
        FROM flow
        GROUP BY grade ORDER BY grade
    """).fetchall()
    _print_table("风险等级", rows,
                 ['等级', '条数', '件均†', '转入'], ['l', 'r', 'r', 'r'])

    # 定价系数分段
    rows = con.execute("""
        SELECT CASE
                 WHEN commercial_pricing_factor IS NULL THEN '无系数'
                 WHEN commercial_pricing_factor < 0.8 THEN '< 0.80'
                 WHEN commercial_pricing_factor < 1.0 THEN '0.80-0.99'
                 WHEN commercial_pricing_factor < 1.2 THEN '1.00-1.19'
                 WHEN commercial_pricing_factor < 1.35 THEN '1.20-1.34'
                 WHEN commercial_pricing_factor < 1.5 THEN '1.35-1.49'
                 ELSE '≥ 1.50'
               END AS seg,
               COUNT(*) AS cnt,
               ROUND(AVG(premium), 0) AS avg_p
        FROM flow
        GROUP BY seg ORDER BY seg
    """).fetchall()
    _print_table("自主定价系数", rows,
                 ['系数区间', '条数', '件均†'], ['l', 'r', 'r'])


def section_premium(con, args, top_n):
    """保费分段"""
    _banner("Premium — 保费分段")

    rows = con.execute("""
        SELECT CASE
                 WHEN premium < 1000 THEN '< 1000'
                 WHEN premium < 2000 THEN '1000-2000'
                 WHEN premium < 3000 THEN '2000-3000'
                 WHEN premium < 5000 THEN '3000-5000'
                 WHEN premium < 8000 THEN '5000-8000'
                 WHEN premium < 12000 THEN '8000-12000'
                 WHEN premium < 20000 THEN '12000-20000'
                 ELSE '≥ 20000'
               END AS seg,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               ROUND(AVG(premium), 0) AS avg_p,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound,
               COUNT(*) FILTER (WHERE next_insurer IS NOT NULL) AS outbound
        FROM flow WHERE premium IS NOT NULL
        GROUP BY seg ORDER BY MIN(premium)
    """).fetchall()
    _print_table("保费分段", rows,
                 ['保费区间', '条数', '保费', '段内件均†', '转入', '流出'],
                 ['l', 'r', 'r', 'r', 'r', 'r'])


def section_trend(con, args, top_n):
    """保险起期月度趋势"""
    _banner("Trend — 保险起期月度趋势")

    rows = con.execute("""
        SELECT STRFTIME(insurance_start_date, '%Y-%m') AS month,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               COUNT(*) FILTER (WHERE previous_insurer IS NOT NULL) AS inbound,
               COUNT(*) FILTER (WHERE next_insurer IS NOT NULL) AS outbound
        FROM flow WHERE insurance_start_date IS NOT NULL
        GROUP BY month ORDER BY month
    """).fetchall()
    _print_table("保险起期月度", rows,
                 ['月份', '条数', '保费', '转入', '流出'],
                 ['l', 'r', 'r', 'r', 'r'])


# ── 评级序（A 最优 → X 最差，无评级等同 X）──

_GRADE_ORDER = {'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'X': 8}

def _grade_rank(g: str | None) -> int:
    """返回评级序号，无评级/X 视为 8"""
    if not g or g == '无评级':
        return 8
    return _GRADE_ORDER.get(g, 8)


def _grade_change(prev: str | None, quote: str | None) -> str:
    """判定评级变化：优化 / 持平 / 恶化"""
    pr, qr = _grade_rank(prev), _grade_rank(quote)
    if qr < pr:
        return '优化'
    elif qr == pr:
        return '持平'
    else:
        return '恶化'


def _loss_type(change: str, quote_grade: str | None) -> str:
    """流失性质四象限决策树"""
    is_abc = quote_grade in ('A', 'B', 'C')
    if change == '恶化' and not is_abc:
        return '主动提价'
    elif change == '恶化' and is_abc:
        return '目标流失'
    elif is_abc:
        return '优质流失'
    else:
        return '高风险留不住'


def section_loss(con, args, top_n):
    """流失归因（评级对比法）"""
    outbound = con.execute(
        "SELECT COUNT(*) FROM flow WHERE next_insurer IS NOT NULL"
    ).fetchone()[0]
    if outbound == 0:
        _banner("Loss — 流失归因")
        print("\n   ⚠ 当前筛选条件下无流出记录（保单可能尚未到期）")
        return

    _banner("Loss — 流失归因（评级对比法）")

    # 注册 UDF
    con.create_function('grade_change', _grade_change, [str, str], str)
    con.create_function('loss_type_fn', _loss_type, [str, str], str)

    # 构建流失分析表（COALESCE 避免 UDF 遇 NULL 返 NULL）
    con.execute("""
        CREATE TABLE loss_detail AS
        SELECT *,
               COALESCE(insurance_grade, '无评级') AS prev_grade,
               COALESCE(quote_grade, '无评级') AS q_grade,
               grade_change(
                   COALESCE(insurance_grade, '无评级'),
                   COALESCE(quote_grade, '无评级')
               ) AS grade_shift,
               loss_type_fn(
                   grade_change(
                       COALESCE(insurance_grade, '无评级'),
                       COALESCE(quote_grade, '无评级')
                   ),
                   COALESCE(quote_grade, '无评级')
               ) AS loss_cat
        FROM flow
        WHERE next_insurer IS NOT NULL
    """)

    total_loss = con.execute("SELECT COUNT(*) FROM loss_detail").fetchone()[0]
    has_both = con.execute(
        "SELECT COUNT(*) FROM loss_detail WHERE insurance_grade IS NOT NULL AND quote_grade != '无评级'"
    ).fetchone()[0]

    print(f"\n   流出总量: {total_loss:,} 单")
    print(f"   可评级对比: {has_both:,} 单 ({has_both*100/total_loss:.1f}%)")

    # ── 1. 四象限汇总 ──
    _sub_banner("四象限分类")
    rows = con.execute("""
        SELECT loss_cat,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               ROUND(AVG(premium), 0) AS avg_p
        FROM loss_detail
        GROUP BY loss_cat
        ORDER BY CASE loss_cat
            WHEN '主动提价' THEN 1 WHEN '目标流失' THEN 2
            WHEN '优质流失' THEN 3 WHEN '高风险留不住' THEN 4 END
    """).fetchall()
    labels = {'主动提价': '预期行为，风控主动加价',
              '目标流失': '⚠ 评级恶化但仍属ABC，应争取',
              '优质流失': '⚠ 不该丢的好客户',
              '高风险留不住': '风险高且未改善，影响可控'}
    print()
    for cat, cnt, prem, avg_p in rows:
        pct = cnt * 100 / total_loss
        desc = labels.get(cat or '未分类', '')
        cat_display = cat or '未分类'
        prem_v = prem or 0
        avg_v = avg_p or 0
        print(f"   {cat_display:<10}  {cnt:>6,} 单  {pct:>5.1f}%  {prem_v:>7} 万  件均 {avg_v:>6,.0f}  {desc}")

    # ── 2. 评级变化矩阵 ──
    _sub_banner("评级变化分布（上年 → 报价）")
    rows = con.execute("""
        SELECT grade_shift,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem
        FROM loss_detail
        GROUP BY grade_shift
        ORDER BY CASE grade_shift WHEN '优化' THEN 1 WHEN '持平' THEN 2 WHEN '恶化' THEN 3 END
    """).fetchall()
    _print_table("评级变化", rows,
                 ['变化', '件数', '保费(万)'], ['l', 'r', 'r'])

    # ── 3. 按客户类别 × 四象限 ──
    _sub_banner("客户类别 × 流失性质")
    rows = con.execute(f"""
        SELECT COALESCE(customer_category, '未知') AS cat, loss_cat,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem
        FROM loss_detail
        GROUP BY cat, loss_cat
        HAVING COUNT(*) >= 5
        ORDER BY cat, CASE loss_cat
            WHEN '主动提价' THEN 1 WHEN '目标流失' THEN 2
            WHEN '优质流失' THEN 3 WHEN '高风险留不住' THEN 4 END
    """).fetchall()
    _print_table("客户类别 × 性质", rows,
                 ['客户类别', '流失性质', '件数', '保费(万)'],
                 ['l', 'l', 'r', 'r'])

    # ── 4. 流出去向 × 四象限（到期模式无具体去向，跳过）──
    if _is_expire_mode(args):
        _sub_banner("流向保司（到期模式）")
        print("\n   ⚠ 到期模式通过 VIN 匹配判断续保/流失，无竞品去向信息")
    else:
        _sub_banner(f"流向保司 TOP {top_n} × 流失性质")
        rows = con.execute(f"""
            WITH ranked AS (
                SELECT SUBSTRING(next_insurer, 1, 10) AS dest,
                       loss_cat, COUNT(*) AS cnt,
                       ROUND(SUM(premium)/10000, 1) AS prem
                FROM loss_detail
                GROUP BY dest, loss_cat
            ),
            top_dest AS (
                SELECT dest FROM ranked GROUP BY dest ORDER BY SUM(cnt) DESC LIMIT {top_n}
            )
            SELECT r.dest, r.loss_cat, r.cnt, r.prem
            FROM ranked r JOIN top_dest t ON r.dest = t.dest
            ORDER BY (SELECT SUM(cnt) FROM ranked r2 WHERE r2.dest = r.dest) DESC,
                     CASE r.loss_cat WHEN '主动提价' THEN 1 WHEN '目标流失' THEN 2
                                     WHEN '优质流失' THEN 3 WHEN '高风险留不住' THEN 4 END
        """).fetchall()
        _print_table("去向 × 性质", rows,
                     ['流向保司', '流失性质', '件数', '保费(万)'],
                     ['l', 'l', 'r', 'r'])

    # ── 5. 上年业务员归因 ──
    _sub_banner(f"上年业务员 TOP {top_n}（流失归因）")
    rows = con.execute(f"""
        SELECT COALESCE(salesman_name, '未分配') AS sm,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               COUNT(*) FILTER (WHERE loss_cat = '目标流失') AS target_loss,
               COUNT(*) FILTER (WHERE loss_cat = '优质流失') AS quality_loss
        FROM loss_detail
        GROUP BY sm
        ORDER BY cnt DESC
        LIMIT {top_n}
    """).fetchall()
    _print_table("业务员流失归因", rows,
                 ['业务员', '流失总量', '保费(万)', '目标流失', '优质流失'],
                 ['l', 'r', 'r', 'r', 'r'])

    # ── 6. 上年渠道（经代）归因 ──
    has_agent = con.execute(
        "SELECT COUNT(*) FROM loss_detail WHERE agent_name IS NOT NULL"
    ).fetchone()[0]
    if has_agent > 0:
        _sub_banner(f"上年渠道（经代）TOP {top_n}（流失归因）")
        rows = con.execute(f"""
            SELECT COALESCE(agent_name, '直销') AS ag,
                   COUNT(*) AS cnt,
                   ROUND(SUM(premium)/10000, 1) AS prem,
                   COUNT(*) FILTER (WHERE loss_cat = '目标流失') AS target_loss,
                   COUNT(*) FILTER (WHERE loss_cat = '优质流失') AS quality_loss
            FROM loss_detail
            GROUP BY ag
            ORDER BY cnt DESC
            LIMIT {top_n}
        """).fetchall()
        _print_table("渠道流失归因", rows,
                     ['经代/渠道', '流失总量', '保费(万)', '目标流失', '优质流失'],
                     ['l', 'r', 'r', 'r', 'r'])

    # ── 7. 上年机构归因 ──
    _sub_banner(f"上年机构流失归因")
    rows = con.execute("""
        SELECT COALESCE(org_level_3, '未知') AS org,
               COUNT(*) AS cnt,
               ROUND(SUM(premium)/10000, 1) AS prem,
               COUNT(*) FILTER (WHERE loss_cat = '目标流失') AS target_loss,
               COUNT(*) FILTER (WHERE loss_cat = '优质流失') AS quality_loss,
               ROUND(100.0 * (COUNT(*) FILTER (WHERE loss_cat IN ('目标流失', '优质流失')))
                     / COUNT(*), 1) AS regret_pct
        FROM loss_detail
        GROUP BY org
        ORDER BY cnt DESC
    """).fetchall()
    _print_table("机构流失归因", rows,
                 ['机构', '流失总量', '保费(万)', '目标流失', '优质流失', '可惜率%'],
                 ['l', 'r', 'r', 'r', 'r', 'r'])

    # 清理
    con.execute("DROP TABLE IF EXISTS loss_detail")


# ── 板块注册表 ──

SECTION_MAP = {
    'summary': section_summary,
    'insurer': section_insurer,
    'org': section_org,
    'coverage': section_coverage,
    'tonnage': section_tonnage,
    'risk': section_risk,
    'premium': section_premium,
    'trend': section_trend,
    'loss': section_loss,
}

# ── 主入口 ──

def main():
    args = parse_args()
    try:
        province = resolve_province(args.province)
    except PolicyCurrentLayoutError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(2)
    sections = [s.strip() for s in args.sections.split(',')]
    invalid = [s for s in sections if s not in SECTION_MAP]
    if invalid:
        print(f"❌ 未知板块: {invalid}，可选: {ALL_SECTIONS}")
        sys.exit(1)

    # 筛选条件摘要
    filters = [f"省份={province}"]
    if args.category: filters.append(f"客户类别={args.category}")
    if args.tonnage: filters.append(f"吨位段={args.tonnage}")
    if args.year: filters.append(f"年度={args.year}")
    if args.coverage: filters.append(f"险别={args.coverage}")
    if args.direction != 'all': filters.append(f"方向={args.direction}")
    if args.insurer: filters.append(f"聚焦={args.insurer}")
    if args.org: filters.append(f"机构={args.org}")
    expire_from = getattr(args, 'expire_from', None)
    expire_to = getattr(args, 'expire_to', None)
    if expire_from or expire_to:
        filters.append(f"到期={expire_from or '*'}~{expire_to or '*'}")
    filter_desc = ' | '.join(filters) if filters else '全量'

    print(f"\n{'═' * 80}")
    print(f"   客户来源去向分析")
    print(f"   筛选: {filter_desc}")
    print(f"   时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"   板块: {', '.join(sections)}")
    print(f"{'═' * 80}")

    con = duckdb.connect()
    total = load_data(con, args, province)

    if total == 0:
        print("\n   ⚠ 筛选条件下无数据")
        con.close()
        return

    for sec in sections:
        SECTION_MAP[sec](con, args, args.top)

    print(f"\n{'═' * 80}")
    print(f"   备注: 保费†单位为元（件均/段内件均），汇总列单位为万元")
    print(f"{'═' * 80}\n")

    con.close()


if __name__ == '__main__':
    main()
