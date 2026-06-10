#!/usr/bin/env python3
"""
报价转化数据 ETL：04_报价清单 Excel → 拆分业务员 → JOIN 团队 → Parquet

支持多文件输入（按时间拆分的报价清单自动合并）。

用法:
  python3 数据管理/pipelines/quote_etl.py -i "04_报价清单_A.xlsx" "04_报价清单_B.xlsx"
  python3 数据管理/pipelines/quote_etl.py  # 自动检测 数据管理/ 目录下 04_报价清单_*.xlsx
"""

import argparse
import json
import re
import sys
from pathlib import Path

import duckdb
import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

# ── 33列 CN→EN 映射（04_报价清单格式）──

CN_TO_EN = {
    '报价时间': 'quote_time',
    '车架号': 'vehicle_frame_no',
    '险类': 'insurance_type',
    '三级机构': 'org_level_3',
    '险别组合': 'coverage_combination',
    '客户类别': 'customer_category',
    '货车吨位分段': 'tonnage_segment',
    '厂牌车型分类': 'brand_model_category',
    '燃料种类': 'fuel_type',
    '保单号': 'policy_no',
    '车牌号': 'plate_no',
    '保险起期': 'insurance_start_date',
    '续转保': 'renewal_status',
    '是否过户车': 'is_transfer',
    '是否新能源车': 'is_nev',
    '是否电销': 'is_telemarketing',
    '是否承保': 'is_underwritten',
    # '险别组合.1' → 重复列，丢弃
    '车险分等级': '_grade_1',
    '小货车评分': '_grade_2',
    '大货车评分': '_grade_3',
    '高速风险等级': 'highway_risk_level',       # 对齐保单 highway_risk_level
    '交通风险评分等级': 'traffic_risk_grade',
    '业务员': 'salesman_raw',
    '新车购置价': 'new_vehicle_price',          # 对齐保单 new_vehicle_price
    '车龄': 'vehicle_age',
    '纯风险保费': 'pure_risk_premium',
    '商业险NCD': 'commercial_ncd',
    'NCD较上年': 'ncd_yoy_change',
    'NCD保费': 'ncd_premium',
    '自主定价系数': 'commercial_pricing_factor',
    '自主系数较上年': 'pricing_factor_yoy_change',
    '最终报价': 'final_quote_premium',
}

REQUIRED_COLUMNS = ['车架号', '报价时间']
STR_FORCE_COLS = {'车架号': str, '保单号': str, '车牌号': str}


def find_input_files(search_dir: str = '数据管理') -> list[Path]:
    """自动检测报价清单 xlsx：旧编号 04_报价清单* + 新编号 YYYYMMDD_02_报价清单*（2026-06-10 上游编号 04→02）"""
    base = Path(search_dir)
    if not base.exists():
        return []
    files = list(base.glob('04_报价清单*.xlsx'))
    files += [f for f in base.glob('*_02_报价清单*.xlsx')
              if re.match(r'^\d{8}_02_', f.name)]
    # 排除浏览器重复下载残留（xxx (1).xlsx）
    files = [f for f in files if not re.search(r'\(\d+\)\.xlsx$', f.name)]
    return sorted(set(files), key=lambda f: f.name)


def split_salesman(name: str):
    """拆分 '110031100周凡丁' → ('110031100', '周凡丁')"""
    if not isinstance(name, str):
        return ('', '')
    m = re.match(r'^(\d+)(.*)', name)
    if m:
        return (m.group(1), m.group(2))
    return ('', name)


def split_salesman_columns(raw: pd.Series) -> tuple[pd.Series, pd.Series]:
    """向量化拆分业务员字段，保持 split_salesman 的兼容语义。"""
    values = raw.astype("string").str.strip()
    parts = values.str.extract(r"^(\d+)(.*)$")
    salesman_no = parts[0].fillna("")
    salesman_name = parts[1].where(parts[0].notna(), values).fillna("")
    return salesman_no, salesman_name


def main():
    parser = argparse.ArgumentParser(description='报价转化数据 ETL（04_报价清单 → Parquet）')
    parser.add_argument('-i', '--input', nargs='+', help='输入 Excel 文件（支持多个）')
    parser.add_argument(
        '-o', '--output',
        default='数据管理/warehouse/fact/quotes_conversion',
        help='输出 Parquet 目录',
    )
    args = parser.parse_args()

    # 1. 定位输入文件
    if args.input:
        input_paths = [Path(p) for p in args.input]
    else:
        input_paths = find_input_files()

    if not input_paths:
        print('❌ 找不到报价清单 Excel 文件')
        sys.exit(1)

    missing = [p for p in input_paths if not p.exists()]
    if missing:
        print(f'❌ 文件不存在: {missing}')
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"{'='*80}")
    print(f"📋 报价转化 ETL（04_报价清单 → Parquet）")
    print(f"{'='*80}")
    print(f"   输入: {len(input_paths)} 个文件")
    for p in input_paths:
        size_mb = p.stat().st_size / 1024 / 1024
        print(f"     - {p.name} ({size_mb:.1f} MB)")

    from pipelines.etl_validation import validate_output_path, verify_non_empty, safe_pct, to_bool, PLACEHOLDER_STRS, load_excel_all_sheets

    # 2. 读取并合并 Excel（每个文件自动合并多 sheet）
    print('\n📊 读取 Excel...')
    frames = []
    for p in input_paths:
        df = load_excel_all_sheets(p, dtype=STR_FORCE_COLS, required_columns=REQUIRED_COLUMNS)
        frames.append(df)

    df = pd.concat(frames, ignore_index=True)
    print(f"   文件合并: {len(df):,} 行 × {len(df.columns)} 列")

    # 3. Schema 契约
    df.columns = df.columns.str.strip()
    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        print(f"   ❌ 缺少必须列: {missing_cols}")
        print(f"      实际列: {list(df.columns)}")
        sys.exit(1)

    # 4. 丢弃重复列 '险别组合.1'
    dup_cols = [c for c in df.columns if c.endswith('.1')]
    if dup_cols:
        df = df.drop(columns=dup_cols)
        print(f"   丢弃重复列: {dup_cols}")

    # 5. 列名重命名
    rename_cols = {k: v for k, v in CN_TO_EN.items() if k in df.columns}
    df = df.rename(columns=rename_cols)
    extra_cols = [c for c in df.columns if c not in CN_TO_EN.values()]
    if extra_cols:
        print(f"   ⚠ 未映射列（已丢弃）: {extra_cols}")
        df = df[[c for c in df.columns if c in CN_TO_EN.values()]]
    print(f"   列名重命名: {len(rename_cols)}/{len(CN_TO_EN)} 列")

    # 6. 风险等级 COALESCE 合并
    grade_cols = ['_grade_1', '_grade_2', '_grade_3']
    existing_grades = [c for c in grade_cols if c in df.columns]
    if existing_grades:
        df['insurance_grade'] = df[existing_grades[0]]
        for c in existing_grades[1:]:
            df['insurance_grade'] = df['insurance_grade'].fillna(df[c])
        df = df.drop(columns=existing_grades)
        valid_grades = df['insurance_grade'].notna().sum()
        print(f"   风险等级合并: {valid_grades:,}/{len(df):,} ({safe_pct(valid_grades, len(df)):.1f}%)")

    # 7. 类型转换

    # 日期/时间字段
    for col in ['quote_time', 'insurance_start_date']:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')

    if 'quote_time' in df.columns:
        valid = df['quote_time'].notna().sum()
        print(f"   报价时间: {df['quote_time'].min()} ~ {df['quote_time'].max()} ({valid:,} 有值)")

    # 布尔字段
    for col in ['is_transfer', 'is_nev', 'is_telemarketing']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()

    # is_underwritten 保持原始中文值 '承保'/'未承保'（SQL 按 '承保' 判定）
    if 'is_underwritten' in df.columns:
        df['is_underwritten'] = df['is_underwritten'].astype(str).str.strip()
        uw_count = (df['is_underwritten'] == '承保').sum()
        print(f"   已承保: {uw_count:,}/{len(df):,} ({safe_pct(uw_count, len(df)):.1f}%)")

    # 数值字段
    for col in ['pure_risk_premium', 'ncd_premium', 'commercial_pricing_factor',
                'final_quote_premium', 'commercial_ncd', 'new_vehicle_price', 'vehicle_age']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    # 字符串字段标准化
    for col in ['vehicle_frame_no', 'policy_no', 'plate_no']:
        if col in df.columns:
            df[col] = df[col].str.strip().replace(PLACEHOLDER_STRS, None)

    # 8. 过滤无效行
    before = len(df)
    df = df[df['vehicle_frame_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无车架号: {before - len(df):,} 行")

    # 9. 业务员字段：保留原始拼接格式（对齐保单 salesman_name = "工号+姓名"）
    #    同时拆出 salesman_no 用于 JOIN dim 表
    print('🔧 处理业务员字段...')
    if 'salesman_raw' in df.columns:
        df['salesman_no'], _salesman_name = split_salesman_columns(df['salesman_raw'])
        df['salesman_name'] = df['salesman_raw'].str.strip()  # 对齐保单命名
        df = df.drop(columns=['salesman_raw'])

    # 10. JOIN salesman dim 获取团队
    print('🔗 JOIN salesman dim 表...')
    # _DATA_ROOT = 数据管理/，用绝对路径确保从任何 cwd 都能找到
    data_root = Path(__file__).resolve().parent.parent
    project_root = data_root.parent
    dim_paths = [
        data_root / 'warehouse/dim/salesman/latest.parquet',
        project_root / 'server/data/dim/salesman/latest.parquet',
    ]
    dim_path = next((p for p in dim_paths if p.exists()), None)

    con = duckdb.connect()
    con.register('quotes', df)

    if dim_path:
        print(f"   dim 表: {dim_path}")
        result = con.execute(
            f"""
            SELECT q.*,
                   COALESCE(s.team, '未分配团队') AS team
            FROM quotes q
            LEFT JOIN read_parquet('{dim_path}') s
              ON q.salesman_no = s.business_no
            """
        ).df()
        matched = (result['team'] != '未分配团队').sum()
        print(f"   匹配: {matched:,}/{len(result):,} ({matched/len(result)*100:.0f}%)")
    else:
        print("   ⚠️ salesman dim 表不存在，团队字段全部为'未分配团队'")
        df['team'] = '未分配团队'
        result = df

    # 11. 统计概览
    print(f"\n   === 数据概览 ===")
    print(f"   记录数: {len(result):,}")
    print(f"   唯一车架号: {result['vehicle_frame_no'].nunique():,}")
    if 'renewal_status' in result.columns:
        print(f"   续转保分布: {result['renewal_status'].value_counts().to_dict()}")
    if 'customer_category' in result.columns:
        print(f"   客户类别TOP5: {result['customer_category'].value_counts().head(5).to_dict()}")
    if 'final_quote_premium' in result.columns:
        total = pd.to_numeric(result['final_quote_premium'], errors='coerce').sum()
        print(f"   最终报价合计: {total/1e8:.2f} 亿元")

    # 12. 输出 Parquet
    output_file = output_dir / 'latest.parquet'
    print(f'\n💾 写入 Parquet: {output_file}')
    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        result, output_file,
        source_file=', '.join(p.name for p in input_paths),
        processing_mode='quotes_conversion',
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"   输出: {output_file} ({size_mb:.1f} MB)")

    # 13. 验证
    verify = con.execute(
        f"""
        SELECT
            COUNT(*) AS total,
            COUNT(CASE WHEN is_underwritten='承保' THEN 1 END) AS insured,
            COUNT(DISTINCT org_level_3) AS orgs,
            COUNT(DISTINCT team) AS teams,
            COUNT(DISTINCT salesman_name) AS salesmen
        FROM read_parquet('{output_file}')
        """
    ).fetchone()
    print(f"\n✅ 完成!")
    print(f"   总量: {verify[0]:,} | 承保: {verify[1]:,} | 转化率: {verify[1]/verify[0]*100:.1f}%")
    print(f"   机构: {verify[2]} | 团队: {verify[3]} | 业务员: {verify[4]}")
    print(f"   列: {len(result.columns)} → {list(result.columns)}")

    # 14. 更新 data-sources.json
    try:
        from pipelines.data_sources_updater import update_data_sources
        update_data_sources('quotes_conversion', row_count=verify[0], field_count=len(result.columns))
    except Exception as e:
        print(f"  ⚠️ data-sources.json 更新跳过: {e}")

    print(f"{'='*80}")


if __name__ == '__main__':
    main()
