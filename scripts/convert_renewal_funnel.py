"""
Excel → Parquet 转换：续保漏斗数据

数据源：交商同保续保_*.xlsx
输出：数据管理/warehouse/fact/renewal/renewal_funnel_2026q1.parquet

用法:
  python3 scripts/convert_renewal_funnel.py
  python3 scripts/convert_renewal_funnel.py -i 数据管理/xxx.xlsx -o 数据管理/warehouse/fact/renewal/xxx.parquet
"""

import argparse
import pandas as pd
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = PROJECT_ROOT / '数据管理'
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / '数据管理' / 'warehouse' / 'fact' / 'renewal'
DEFAULT_OUTPUT = DEFAULT_OUTPUT_DIR / 'renewal_funnel_2026q1.parquet'

# ── 列名映射（兼容新旧两版 Excel）──
# 新版（0330）：应续保单号、上年-风险等级、报价人数、已续保单号、起保月
# 旧版（0329）：保单号、车险分等级、续保报价业务员数、是否续保、报价清单-车险分等级、销售团队
COLUMN_ALIASES = {
    'policy_no':              ['应续保单号', '保单号'],
    'insurance_grade':        ['上年-风险等级', '车险分等级'],
    'quote_salesman_count':   ['报价人数', '续保报价业务员数'],
    'renewal_policy_no_raw':  ['已续保单号', '是否续保'],
    'start_month':            ['起保月'],
    'org_level_3':            ['三级机构'],
    'salesman_name':          ['业务员'],
    'customer_category':      ['客户类别3'],
    'tonnage_segment':        ['吨位分段'],
    'vehicle_frame_no':       ['车架号'],
    'is_quoted':              ['是否报价'],
    'insurance_start_date':   ['起保日期'],
    'expiry_date_raw':        ['保险止期'],
    'renewed_salesman_name':  ['续保后业务员'],
    'renewed_policy_no':      ['续保后保单号'],
    # 旧版独有（可选）
    'team_name':              ['销售团队'],
    'quoted_insurance_grade': ['报价清单-车险分等级'],
}

GRADE_ORDER = {'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'X': 8}


def find_latest_input():
    files = sorted(DEFAULT_INPUT_DIR.glob('交商同保续保_*.xlsx'), reverse=True)
    return files[0] if files else None


def resolve_columns(df):
    """根据实际列名自动匹配映射"""
    mapping = {}
    for target, candidates in COLUMN_ALIASES.items():
        for c in candidates:
            if c in df.columns:
                mapping[c] = target
                break
    return mapping


def normalize_policy_no(series):
    result = series.astype(str).str.strip()
    result = result.replace({'nan': '', 'None': '', 'NaN': ''})
    def fix_sci(val):
        if val == '' or val == 'nan':
            return ''
        try:
            f = float(val)
            if f > 1e15:
                return f'{f:.0f}'
            return val
        except (ValueError, OverflowError):
            return val
    result = result.map(fix_sci)
    result = result.str.replace(r'\.0$', '', regex=True)
    return result.where(result != '', None)


def parse_expiry_date(df):
    """解析保险止期字段 — 兼容两种格式：
    - 新版：'MM-DD' 字符串（如 '01-20'、'12-31'）→ 起保年+1 年的 MM-DD
    - 旧版：整数 1-12（到期月）→ 起保年+1 年到期月最后一天
    """
    start_dates = pd.to_datetime(df['insurance_start_date'], errors='coerce')
    raw = df['expiry_date_raw'].astype(str).str.strip()

    # 检测格式：包含'-'说明是 MM-DD 格式
    is_mmdd = raw.str.match(r'^\d{2}-\d{2}$')

    results = pd.Series([pd.NaT] * len(df), index=df.index)

    # MM-DD 格式
    mmdd_mask = is_mmdd & start_dates.notna()
    if mmdd_mask.any():
        end_year = start_dates[mmdd_mask].dt.year + 1
        date_str = end_year.astype(str) + '-' + raw[mmdd_mask]
        results[mmdd_mask] = pd.to_datetime(date_str, format='%Y-%m-%d', errors='coerce')

    # 整数月份格式（旧版兼容）
    int_mask = ~is_mmdd & start_dates.notna()
    if int_mask.any():
        months = pd.to_numeric(raw[int_mask], errors='coerce').fillna(0).astype(int)
        for idx in months[months.between(1, 12)].index:
            start = start_dates[idx]
            month = months[idx]
            end_year = start.year + 1
            if month == 12:
                results[idx] = pd.Timestamp(end_year, 12, 31)
            else:
                results[idx] = pd.Timestamp(end_year, month + 1, 1) - pd.Timedelta(days=1)

    return results


def main():
    parser = argparse.ArgumentParser(description='续保漏斗 Excel → Parquet')
    parser.add_argument('-i', '--input', type=str, default=None)
    parser.add_argument('-o', '--output', type=str, default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    INPUT_FILE = Path(args.input) if args.input else find_latest_input()
    OUTPUT_FILE = Path(args.output)

    if not INPUT_FILE or not INPUT_FILE.exists():
        print(f'❌ 输入文件不存在: {INPUT_FILE}')
        return

    print(f'{"="*80}')
    print(f'📖 续保漏斗转换: {INPUT_FILE.name}')
    print(f'{"="*80}')

    # 强制字符串读取保单号列
    str_cols = {}
    for c in ['是否续保', '续保后保单号', '已续保单号', '应续保单号', '保单号']:
        str_cols[c] = str
    df = pd.read_excel(INPUT_FILE, sheet_name=0, dtype=str_cols)
    print(f'   原始: {len(df):,} 行 × {len(df.columns)} 列')
    print(f'   列名: {list(df.columns)}')

    # ── 自动列名映射 ──
    col_map = resolve_columns(df)
    mapped = set(col_map.values())
    df = df.rename(columns=col_map)
    print(f'   映射: {len(col_map)} 列')

    # ── adminadmin 拆分 ──
    if 'salesman_name' in df.columns and 'org_level_3' in df.columns:
        mask = df['salesman_name'].astype(str).str.strip() == 'adminadmin'
        if mask.sum() > 0:
            df.loc[mask, 'salesman_name'] = 'admin' + df.loc[mask, 'org_level_3'].astype(str) + '直接个代'
            print(f'   adminadmin 拆分: {mask.sum():,} 条')

    # ── 保单号标准化 ──
    for col in ['policy_no', 'vehicle_frame_no', 'renewal_policy_no_raw', 'renewed_policy_no']:
        if col in df.columns:
            df[col] = normalize_policy_no(df[col])

    # ── 日期字段 ──
    if 'insurance_start_date' in df.columns:
        df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce')
        print(f'   起保日期: {df["insurance_start_date"].min()} ~ {df["insurance_start_date"].max()}')

    # 保险止期 → 到期日期
    if 'expiry_date_raw' in df.columns:
        df['insurance_end_date'] = parse_expiry_date(df)
        valid = df['insurance_end_date'].notna().sum()
        print(f'   到期日期解析: {valid:,}/{len(df):,} ({valid/len(df)*100:.1f}%)')

    # 起保月
    if 'start_month' in df.columns:
        df['insurance_start_month'] = df['start_month'].astype(str).str.strip()
    elif 'insurance_start_date' in df.columns:
        df['insurance_start_month'] = df['insurance_start_date'].dt.strftime('%Y-%m').fillna('')

    # ── 续保状态 ──
    if 'renewal_policy_no_raw' in df.columns:
        df['is_renewed'] = df['renewal_policy_no_raw'].notna() & (df['renewal_policy_no_raw'] != '')
    if 'renewed_policy_no' in df.columns:
        df['renewed_policy_no'] = normalize_policy_no(df['renewed_policy_no'])

    # ── 布尔/数值字段 ──
    if 'is_quoted' in df.columns:
        df['is_quoted'] = df['is_quoted'].map({'是': True, '否': False}).fillna(False)
    if 'quote_salesman_count' in df.columns:
        df['quote_salesman_count'] = pd.to_numeric(df['quote_salesman_count'], errors='coerce').fillna(0).astype(int)

    # ── 字符串字段清理 ──
    str_fields = ['org_level_3', 'team_name', 'salesman_name', 'renewed_salesman_name',
                  'insurance_grade', 'quoted_insurance_grade', 'customer_category', 'tonnage_segment']
    for col in str_fields:
        if col in df.columns:
            df[col] = df[col].fillna('').astype(str).str.strip()

    # ── 团队匹配（通过映射表：业务员→团队+机构）──
    mapping_file = PROJECT_ROOT / '数据管理' / 'warehouse' / 'dim' / '业务员归属与规划' / 'salesman_organization_mapping.json'
    if mapping_file.exists():
        import json
        with open(mapping_file, 'r') as f:
            mapping_data = json.load(f)
        sm = pd.DataFrame(mapping_data['salesman_mapping'])
        # 用 full_name（工号+姓名）匹配业务员字段
        sm_dedup = sm.drop_duplicates(subset='full_name', keep='first')
        sm_lookup = sm_dedup.set_index('full_name')[['team', 'organization']].to_dict('index')

        matched = 0
        for idx, row in df.iterrows():
            name = row.get('salesman_name', '')
            if name and name in sm_lookup:
                df.at[idx, 'team_name'] = sm_lookup[name]['team']
                matched += 1
        if 'team_name' not in df.columns:
            df['team_name'] = ''
        df['team_name'] = df['team_name'].fillna('').astype(str)
        print(f'   团队匹配: {matched:,}/{len(df):,} ({matched/len(df)*100:.1f}%)')
    else:
        if 'team_name' not in df.columns:
            df['team_name'] = ''
        print(f'   ⚠️ 映射表不存在: {mapping_file.name}')

    # ── 车险分等级变化（仅旧版有 quoted_insurance_grade）──
    if 'quoted_insurance_grade' in df.columns and 'insurance_grade' in df.columns:
        orig = df['insurance_grade'].map(GRADE_ORDER)
        quoted = df['quoted_insurance_grade'].map(GRADE_ORDER)
        conditions = [
            orig.isna() | quoted.isna(),
            orig == quoted,
            quoted < orig,
            quoted > orig,
        ]
        df['grade_change'] = np.select(conditions, ['unknown', 'unchanged', 'improved', 'worsened'], default='unknown')
    else:
        # 新版没有报价时等级，标记为不可用
        df['grade_change'] = 'unavailable'

    # ── 计算字段 ──
    if 'is_renewed' in df.columns:
        df['is_self_retained'] = (
            df['is_renewed'] &
            (df.get('salesman_name', '') != '') &
            (df.get('renewed_salesman_name', '') != '') &
            (df['salesman_name'] == df['renewed_salesman_name'])
        )
    if 'quote_salesman_count' in df.columns:
        df['competition_level'] = df['quote_salesman_count'].apply(
            lambda x: 'none' if x == 0 else ('exclusive' if x == 1 else 'competitive')
        )

    # ── 续保模式匹配（车架号关联）──
    renewal_type_files = sorted(DEFAULT_INPUT_DIR.glob('续保业务类型匹配*.xlsx'), reverse=True)
    if renewal_type_files and 'vehicle_frame_no' in df.columns:
        rt_file = renewal_type_files[0]
        rt = pd.read_excel(rt_file, sheet_name=0)
        if '车架号' in rt.columns:
            rt['车架号'] = rt['车架号'].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
            rt = rt.drop_duplicates(subset='车架号', keep='first')
            df = df.merge(
                rt[['车架号', '续保业务类型']].rename(columns={'车架号': 'vehicle_frame_no', '续保业务类型': 'renewal_mode'}),
                on='vehicle_frame_no', how='left'
            )
            matched = (df.get('renewal_mode', '') != '').sum() - (df.get('renewal_mode') == '未分类').sum()
            df['renewal_mode'] = df['renewal_mode'].fillna('未分类')
            matched = (df['renewal_mode'] != '未分类').sum()
            print(f'   续保模式匹配: {matched:,}/{len(df):,} ({matched/len(df)*100:.1f}%)')
        else:
            df['renewal_mode'] = '未分类'
            print(f'   ⚠️ 续保类型文件无车架号列')
    else:
        df['renewal_mode'] = '未分类'
        if not renewal_type_files:
            print(f'   ⚠️ 未找到续保类型匹配文件')

    # ── 日期转 date 类型 ──
    for col in ['insurance_start_date', 'insurance_end_date']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce').dt.date

    # ── 清理中间列 ──
    drop_cols = ['renewal_policy_no_raw', 'expiry_date_raw', 'start_month']
    df = df.drop(columns=[c for c in drop_cols if c in df.columns], errors='ignore')

    # ── 输出 ──
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, str(OUTPUT_FILE), compression='snappy')

    size_mb = OUTPUT_FILE.stat().st_size / 1024 / 1024
    print(f'\n✅ 输出: {OUTPUT_FILE.name} ({size_mb:.1f} MB)')
    print(f'   行数: {len(df):,}, 列数: {len(df.columns)}')

    # ── 统计 ──
    print(f'\n📊 核心指标:')
    total = len(df)
    quoted = df['is_quoted'].sum() if 'is_quoted' in df.columns else 0
    renewed = df['is_renewed'].sum() if 'is_renewed' in df.columns else 0
    print(f'   应续保单: {total:,}')
    print(f'   已报价: {quoted:,} ({quoted/total*100:.1f}%)')
    print(f'   已续保: {renewed:,} ({renewed/total*100:.1f}%)')
    if quoted > 0:
        print(f'   报价→续保: {renewed/quoted*100:.1f}%')
    if renewed > 0 and 'is_self_retained' in df.columns:
        sr = df['is_self_retained'].sum()
        print(f'   自留续保: {sr:,} ({sr/renewed*100:.1f}%)')

    # 等级变化
    if 'grade_change' in df.columns and df['grade_change'].iloc[0] != 'unavailable':
        print(f'\n📊 车险分等级变化:')
        for g, c in df['grade_change'].value_counts().items():
            label = {'improved': '变好（降价）', 'worsened': '变差（涨价）',
                     'unchanged': '不变', 'unknown': '缺失', 'unavailable': '无数据'}.get(g, g)
            print(f'   {label}: {c:,} ({c/total*100:.1f}%)')

    # 机构
    if 'org_level_3' in df.columns and 'is_renewed' in df.columns:
        print(f'\n📊 机构续保率:')
        org = df.groupby('org_level_3').agg(total=('policy_no', 'count'), renewed=('is_renewed', 'sum'))
        org['rate'] = (org['renewed'] / org['total'] * 100).round(1)
        for _, r in org.sort_values('rate', ascending=False).iterrows():
            print(f'   {r.name}: {r["total"]:,}单, 续保率{r["rate"]}%')

    # 续保模式
    if 'renewal_mode' in df.columns:
        print(f'\n📊 续保模式:')
        mode = df.groupby('renewal_mode').agg(total=('policy_no', 'count'), renewed=('is_renewed', 'sum'))
        mode['rate'] = (mode['renewed'] / mode['total'] * 100).round(1)
        for _, r in mode.iterrows():
            print(f'   {r.name}: {r["total"]:,}单, 续保率{r["rate"]}%')


if __name__ == '__main__':
    main()
