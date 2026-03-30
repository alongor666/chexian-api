"""
Excel → Parquet 转换：续保漏斗数据

用法:
  python3 scripts/convert_renewal_funnel.py
  python3 scripts/convert_renewal_funnel.py --input 数据管理/xxx.xlsx --output 数据管理/warehouse/fact/renewal/xxx.parquet
"""

import argparse
import pandas as pd
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# 默认路径（无参数时使用最新的交商同保续保文件）
DEFAULT_INPUT_DIR = PROJECT_ROOT / '数据管理'
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / '数据管理' / 'warehouse' / 'fact' / 'renewal'
DEFAULT_OUTPUT = DEFAULT_OUTPUT_DIR / 'renewal_funnel_2026q1.parquet'

# ── Excel 列名 → Parquet 列名 映射 ──
COLUMN_MAP = {
    '三级机构': 'org_level_3',
    '销售团队': 'team_name',
    '车架号': 'vehicle_frame_no',
    '保单号': 'policy_no',
    '车险分等级': 'insurance_grade',
    '报价清单-车险分等级': 'quoted_insurance_grade',
    '业务员': 'salesman_name',
    '起保日期': 'insurance_start_date',
    '保险止期': 'expiry_month',
    '是否报价': 'is_quoted',
    '续保报价业务员数': 'quote_salesman_count',
    '是否续保': 'renewal_policy_no_raw',
    '续保后业务员': 'renewed_salesman_name',
    '续保后保单号': 'renewed_policy_no',
    '客户类别3': 'customer_category',
    '吨位分段': 'tonnage_segment',
}

# 车险分等级排序（A最好，X最差）
GRADE_ORDER = {'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'X': 7}


def find_latest_input():
    """自动查找最新的交商同保续保 Excel 文件"""
    files = sorted(DEFAULT_INPUT_DIR.glob('交商同保续保_*.xlsx'), reverse=True)
    return files[0] if files else None


def normalize_policy_no(series):
    """标准化保单号：去除 .0 后缀、科学计数法还原"""
    result = series.astype(str).str.strip()
    result = result.replace({'nan': '', 'None': '', 'NaN': ''})
    # 科学计数法还原（如 6.1e+21 → 原始保单号字符串）
    def fix_sci(val):
        if val == '' or val == 'nan':
            return ''
        try:
            f = float(val)
            if f > 1e15:  # 保单号是大数字
                return f'{f:.0f}'
            return val
        except (ValueError, OverflowError):
            return val
    result = result.map(fix_sci)
    result = result.str.replace(r'\.0$', '', regex=True)
    return result.where(result != '', None)


def compute_grade_change(df):
    """计算车险分等级变化方向（成交时 vs 报价时）

    等级变好（数字变小）→ 自主定价系数降低 → 有利续保
    等级变差（数字变大）→ 自主定价系数升高 → 涨价风险
    """
    orig = df['insurance_grade'].map(GRADE_ORDER)
    quoted = df['quoted_insurance_grade'].map(GRADE_ORDER)

    conditions = [
        orig.isna() | quoted.isna(),   # 缺失
        orig == quoted,                  # 不变
        quoted < orig,                   # 变好（数字变小）
        quoted > orig,                   # 变差（数字变大）
    ]
    choices = ['unknown', 'unchanged', 'improved', 'worsened']
    df['grade_change'] = np.select(conditions, choices, default='unknown')
    return df


def main():
    parser = argparse.ArgumentParser(description='续保漏斗 Excel → Parquet 转换')
    parser.add_argument('--input', '-i', type=str, default=None, help='输入 Excel 文件路径')
    parser.add_argument('--output', '-o', type=str, default=str(DEFAULT_OUTPUT), help='输出 Parquet 文件路径')
    args = parser.parse_args()

    INPUT_FILE = Path(args.input) if args.input else find_latest_input()
    OUTPUT_FILE = Path(args.output)
    OUTPUT_DIR = OUTPUT_FILE.parent

    if not INPUT_FILE or not INPUT_FILE.exists():
        print(f'❌ 输入文件不存在: {INPUT_FILE}')
        return

    print(f'📖 读取 Excel: {INPUT_FILE.name}')
    df = pd.read_excel(INPUT_FILE, sheet_name=0, dtype={'是否续保': str, '续保后保单号': str})
    print(f'   原始行数: {len(df):,}, 列数: {len(df.columns)}')

    # 验证列名
    missing = set(COLUMN_MAP.keys()) - set(df.columns)
    if missing:
        print(f'⚠️  缺失列: {missing}')
        for m in missing:
            candidates = [c for c in df.columns if m in c or c in m]
            if candidates:
                print(f'   可能匹配: {m} → {candidates}')
        return

    # 重命名列
    df = df[list(COLUMN_MAP.keys())].rename(columns=COLUMN_MAP)

    # ── adminadmin 拆分 ──
    admin_mask = df['salesman_name'].astype(str).str.strip() == 'adminadmin'
    if admin_mask.sum() > 0:
        df.loc[admin_mask, 'salesman_name'] = 'admin' + df.loc[admin_mask, 'org_level_3'].astype(str) + '直接个代'
        print(f'   拆分 adminadmin: {admin_mask.sum():,} 条')

    # ── 保单号标准化 ──
    df['policy_no'] = normalize_policy_no(df['policy_no'])
    df['vehicle_frame_no'] = normalize_policy_no(df['vehicle_frame_no'])

    # ── 保险止期（到期月）→ 到期日期 ──
    # 起保日期是 2025 年，保险止期是到期月（1-12）
    df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce')
    df['expiry_month'] = pd.to_numeric(df['expiry_month'], errors='coerce').fillna(0).astype(int)

    # 到期日期 = 起保日期的年份 + 到期月的最后一天（商业车险一般 1 年期）
    def calc_end_date(row):
        start = row['insurance_start_date']
        month = row['expiry_month']
        if pd.isna(start) or month < 1 or month > 12:
            return pd.NaT
        # 到期年 = 起保年 + 1（1 年期保单）
        end_year = start.year + 1
        # 到期日 = 到期月的最后一天
        if month == 12:
            return pd.Timestamp(end_year, 12, 31)
        return pd.Timestamp(end_year, month + 1, 1) - pd.Timedelta(days=1)

    df['insurance_end_date'] = df.apply(calc_end_date, axis=1)
    df['insurance_start_month'] = df['insurance_start_date'].dt.strftime('%Y-%m').fillna('')

    # ── 是否续保（实际存储续保单号）──
    df['renewal_policy_no_raw'] = normalize_policy_no(df['renewal_policy_no_raw'])
    df['is_renewed'] = df['renewal_policy_no_raw'].notna() & (df['renewal_policy_no_raw'] != '')

    # 续保后保单号
    df['renewed_policy_no'] = normalize_policy_no(df['renewed_policy_no'])

    # ── 布尔字段 ──
    df['is_quoted'] = df['is_quoted'].map({'是': True, '否': False}).fillna(False)

    # ── 数值字段 ──
    df['quote_salesman_count'] = pd.to_numeric(df['quote_salesman_count'], errors='coerce').fillna(0).astype(int)

    # ── 字符串字段 ──
    str_cols = ['org_level_3', 'team_name', 'salesman_name', 'renewed_salesman_name',
                'insurance_grade', 'quoted_insurance_grade', 'customer_category', 'tonnage_segment']
    for col in str_cols:
        df[col] = df[col].fillna('').astype(str).str.strip()

    # ── 车险分等级变化（涨价/降价分析）──
    df = compute_grade_change(df)

    # ── 计算字段 ──

    # 自留标记
    df['is_self_retained'] = (
        df['is_renewed'] &
        (df['salesman_name'] != '') &
        (df['renewed_salesman_name'] != '') &
        (df['salesman_name'] == df['renewed_salesman_name'])
    )

    # 竞争强度
    df['competition_level'] = df['quote_salesman_count'].apply(
        lambda x: 'none' if x == 0 else ('exclusive' if x == 1 else 'competitive')
    )

    # ── 续保模式匹配（通过车架号关联，因为续保类型文件的保单号是2026年续保后保单号，不是2025年原保单号）──
    renewal_type_files = sorted(DEFAULT_INPUT_DIR.glob('续保业务类型匹配*.xlsx'), reverse=True)
    if renewal_type_files:
        rt_file = renewal_type_files[0]
        rt = pd.read_excel(rt_file, sheet_name=0)
        rt['车架号'] = rt['车架号'].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
        rt = rt.drop_duplicates(subset='车架号', keep='first')
        df = df.merge(
            rt[['车架号', '续保业务类型']].rename(columns={'车架号': 'vehicle_frame_no', '续保业务类型': 'renewal_mode'}),
            on='vehicle_frame_no', how='left'
        )
        df['renewal_mode'] = df['renewal_mode'].fillna('未分类')
        matched = (df['renewal_mode'] != '未分类').sum()
        print(f'   续保模式匹配: {matched:,}/{len(df):,} ({matched/len(df)*100:.1f}%)')
    else:
        df['renewal_mode'] = '未分类'
        print(f'   ⚠️ 未找到续保类型匹配文件')

    # ── 日期转为 date 类型 ──
    df['insurance_start_date'] = df['insurance_start_date'].dt.date
    df['insurance_end_date'] = df['insurance_end_date'].dt.date

    # ── 删除中间列 ──
    df = df.drop(columns=['renewal_policy_no_raw'], errors='ignore')

    # ── 输出 ──
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, str(OUTPUT_FILE), compression='snappy')

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f'\n✅ 输出: {OUTPUT_FILE.name} ({size_kb:.0f} KB)')
    print(f'   行数: {len(df):,}, 列数: {len(df.columns)}')

    # ── 验证 ──
    print(f'\n📊 数据验证:')
    renewed = df['is_renewed'].sum()
    quoted = df['is_quoted'].sum()
    print(f'   已报价: {quoted:,} ({quoted/len(df)*100:.1f}%)')
    print(f'   已续保: {renewed:,} ({renewed/len(df)*100:.1f}%)')
    if quoted > 0:
        print(f'   报价→续保转化率: {renewed/quoted*100:.1f}%')
    self_retained = df['is_self_retained'].sum()
    if renewed > 0:
        print(f'   自留续保: {self_retained:,} ({self_retained/renewed*100:.1f}%)')

    # 车险分等级变化
    grade_dist = df['grade_change'].value_counts()
    print(f'\n📊 车险分等级变化（成交→报价）:')
    for g, c in grade_dist.items():
        label = {'improved': '变好（降价）', 'worsened': '变差（涨价）',
                 'unchanged': '不变', 'unknown': '缺失'}.get(g, g)
        print(f'   {label}: {c:,} ({c/len(df)*100:.1f}%)')

    # 涨价客户的续保率
    worsened = df[df['grade_change'] == 'worsened']
    if len(worsened) > 0:
        wr = worsened['is_renewed'].sum()
        print(f'   涨价客户续保率: {wr}/{len(worsened)} ({wr/len(worsened)*100:.1f}%)')
    improved = df[df['grade_change'] == 'improved']
    if len(improved) > 0:
        ir = improved['is_renewed'].sum()
        print(f'   降价客户续保率: {ir}/{len(improved)} ({ir/len(improved)*100:.1f}%)')

    print(f'\n📊 机构续保率:')
    org_stats = df.groupby('org_level_3').agg(
        total=('policy_no', 'count'),
        renewed=('is_renewed', 'sum')
    ).assign(rate=lambda x: (x['renewed'] / x['total'] * 100).round(1))
    for _, row in org_stats.sort_values('rate', ascending=False).iterrows():
        print(f'   {row.name}: {row["total"]:,}单, 续保率{row["rate"]}%')

    print(f'\n📊 续保模式分布:')
    mode_stats = df.groupby('renewal_mode').agg(
        total=('policy_no', 'count'),
        renewed=('is_renewed', 'sum')
    ).assign(rate=lambda x: (x['renewed'] / x['total'] * 100).round(1))
    for _, row in mode_stats.iterrows():
        print(f'   {row.name}: {row["total"]:,}单, 续保率{row["rate"]}%')


if __name__ == '__main__':
    main()
