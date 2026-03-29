"""
Excel → Parquet 转换：续保漏斗数据

用法:
  python3 scripts/convert_renewal_funnel.py
  python3 scripts/convert_renewal_funnel.py --input 数据管理/xxx.xlsx --output 数据管理/warehouse/fact/renewal/xxx.parquet
"""

import argparse
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# 默认路径（无参数时使用）
DEFAULT_INPUT = PROJECT_ROOT / '数据管理' / '交商同保续保_26单1-4月20260328.xlsx'
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
    '到期日期': 'insurance_end_date',
    '起保月': 'insurance_start_month',
    '是否报价': 'is_quoted',
    '续保报价业务员数': 'quote_salesman_count',
    '是否续保': 'is_renewed',
    '续保后业务员': 'renewed_salesman_name',
    '续保后保单号': 'renewed_policy_no',
    '客户类别3': 'customer_category',
    '吨位分段': 'tonnage_segment',
}


def main():
    parser = argparse.ArgumentParser(description='续保漏斗 Excel → Parquet 转换')
    parser.add_argument('--input', '-i', type=str, default=str(DEFAULT_INPUT), help='输入 Excel 文件路径')
    parser.add_argument('--output', '-o', type=str, default=str(DEFAULT_OUTPUT), help='输出 Parquet 文件路径')
    args = parser.parse_args()

    INPUT_FILE = Path(args.input)
    OUTPUT_FILE = Path(args.output)
    OUTPUT_DIR = OUTPUT_FILE.parent

    if not INPUT_FILE.exists():
        print(f'❌ 输入文件不存在: {INPUT_FILE}')
        return

    print(f'📖 读取 Excel: {INPUT_FILE}')
    df = pd.read_excel(INPUT_FILE, sheet_name=0)
    print(f'   原始行数: {len(df)}, 列数: {len(df.columns)}')
    print(f'   原始列名: {list(df.columns)}')

    # 验证列名
    missing = set(COLUMN_MAP.keys()) - set(df.columns)
    if missing:
        print(f'⚠️  缺失列: {missing}')
        # 尝试模糊匹配
        for m in missing:
            candidates = [c for c in df.columns if m in c or c in m]
            if candidates:
                print(f'   可能匹配: {m} → {candidates}')
        return

    # 重命名列
    df = df[list(COLUMN_MAP.keys())].rename(columns=COLUMN_MAP)

    # ── 类型转换 ──

    # 保单号：去除 .0 后缀
    import sys
    sys.path.insert(0, str(PROJECT_ROOT / '数据管理' / 'pipelines'))
    from utils import normalize_policy_no
    df['policy_no'] = normalize_policy_no(df['policy_no'])
    df['vehicle_frame_no'] = normalize_policy_no(df['vehicle_frame_no'])

    # 布尔字段
    df['is_quoted'] = df['is_quoted'].map({'是': True, '否': False}).fillna(False)
    df['is_renewed'] = df['is_renewed'].notna()  # 非空 = 已续保

    # 日期字段
    df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce').dt.date
    df['insurance_end_date'] = pd.to_datetime(df['insurance_end_date'], errors='coerce').dt.date

    # 数值字段
    df['quote_salesman_count'] = pd.to_numeric(df['quote_salesman_count'], errors='coerce').fillna(0).astype(int)

    # 字符串字段清洗
    str_cols = ['org_level_3', 'team_name', 'salesman_name', 'renewed_salesman_name',
                'insurance_grade', 'quoted_insurance_grade', 'customer_category',
                'tonnage_segment', 'insurance_start_month', 'renewed_policy_no']
    for col in str_cols:
        df[col] = df[col].fillna('').astype(str).str.strip()

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

    # 续保模式（自留/兜底）
    renewal_type_file = PROJECT_ROOT / '数据管理' / '续保业务类型匹配更新至2026年5月.xlsx'
    if renewal_type_file.exists():
        rt = pd.read_excel(renewal_type_file, sheet_name=0)
        rt['保单号'] = rt['保单号'].astype(str).str.replace(r'\.0$', '', regex=True).str.strip()
        rt = rt.drop_duplicates(subset='保单号', keep='first')
        df = df.merge(rt[['保单号', '续保业务类型']].rename(columns={'保单号': 'policy_no', '续保业务类型': 'renewal_mode'}), on='policy_no', how='left')
        df['renewal_mode'] = df['renewal_mode'].fillna('未分类')
        print(f'   续保模式匹配: {(df["renewal_mode"] != "未分类").sum()}/{len(df)} ({(df["renewal_mode"] != "未分类").sum()/len(df)*100:.1f}%)')
    else:
        df['renewal_mode'] = '未分类'
        print(f'   ⚠️ 续保类型文件不存在: {renewal_type_file}')

    # ── 输出 ──
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, str(OUTPUT_FILE), compression='snappy')

    print(f'\n✅ 输出: {OUTPUT_FILE}')
    print(f'   行数: {len(df)}')
    print(f'   列数: {len(df.columns)}')
    print(f'   文件大小: {OUTPUT_FILE.stat().st_size / 1024:.1f} KB')

    # ── 验证 ──
    print(f'\n📊 数据验证:')
    print(f'   总保单: {len(df)}')
    renewed = df['is_renewed'].sum()
    quoted = df['is_quoted'].sum()
    print(f'   已报价: {quoted} ({quoted/len(df)*100:.1f}%)')
    print(f'   已续保: {renewed} ({renewed/len(df)*100:.1f}%)')
    print(f'   报价→续保转化率: {renewed/quoted*100:.1f}%' if quoted > 0 else '   报价→续保转化率: N/A')
    self_retained = df['is_self_retained'].sum()
    print(f'   自留续保: {self_retained} ({self_retained/renewed*100:.1f}%)' if renewed > 0 else '   自留续保: N/A')

    print(f'\n📊 机构续保率:')
    org_stats = df.groupby('org_level_3').agg(
        total=('policy_no', 'count'),
        renewed=('is_renewed', 'sum')
    ).assign(rate=lambda x: (x['renewed'] / x['total'] * 100).round(1))
    for _, row in org_stats.sort_values('rate', ascending=False).iterrows():
        print(f'   {row.name}: {row["total"]}单, 续保率{row["rate"]}%')

    print(f'\n📊 续保模式分布:')
    mode_stats = df.groupby('renewal_mode').agg(
        total=('policy_no', 'count'),
        renewed=('is_renewed', 'sum')
    ).assign(rate=lambda x: (x['renewed'] / x['total'] * 100).round(1))
    for _, row in mode_stats.iterrows():
        print(f'   {row.name}: {row["total"]}单, 续保率{row["rate"]}%')

    print(f'\n📊 竞争强度分布:')
    comp = df['competition_level'].value_counts()
    for level, count in comp.items():
        print(f'   {level}: {count} ({count/len(df)*100:.1f}%)')

    # ── 机构一致性校验（与 PolicyFact 交叉检查）──
    policy_dir = PROJECT_ROOT / '数据管理' / 'warehouse' / 'fact' / 'policy' / 'current'
    if policy_dir.exists():
        try:
            import pyarrow.dataset as ds
            pf_table = ds.dataset(str(policy_dir), format='parquet').to_table(columns=['三级机构'])
            pf_orgs = set(pf_table.column('三级机构').to_pylist())
            rf_orgs = set(df['org_level_3'].unique()) - {''}
            only_in_rf = rf_orgs - pf_orgs
            only_in_pf = pf_orgs - rf_orgs
            if only_in_rf:
                print(f'\n⚠️  续保漏斗独有机构（PolicyFact 中不存在）: {only_in_rf}')
            if only_in_pf:
                print(f'\n📋 PolicyFact 独有机构（续保漏斗中不存在）: {only_in_pf}')
            if not only_in_rf and not only_in_pf:
                print(f'\n✅ 机构名称一致性: 通过（{len(rf_orgs)} 个机构完全匹配）')
        except Exception as e:
            print(f'\n⚠️  机构一致性校验跳过: {e}')


if __name__ == '__main__':
    main()
