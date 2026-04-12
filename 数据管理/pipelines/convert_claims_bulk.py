#!/usr/bin/env python3
"""
全量赔付数据 Excel → claims_bulk/latest.parquet

保单级聚合赔付数据（每行=一个保单），含结案件数、未结件数、赔款合计。
来源：每周日更新的全量赔付报表（Excel 因行数上限拆为 2 个 sheet）。

用法：
  python3 convert_claims_bulk.py \
    --input "02_赔付数据_全量_2021-20260411.xlsx" \
    --output warehouse/fact/claims_bulk/latest.parquet
"""

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import numpy as np

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.parquet_utils import write_parquet_with_metadata

# ── 常量 ──

CN_COLUMNS = ['保单号', '车架号', '结案件数', '未结件数', '赔款合计']
EN_COLUMNS = ['policy_no', 'vehicle_frame_no', 'closed_cases', 'open_cases', 'total_claims']

CN_TO_EN = dict(zip(CN_COLUMNS, EN_COLUMNS))

# pandas 读入时强制为字符串的列（避免保单号被转为科学记数法）
STR_FORCE = {'保单号': str, '车架号': str}
STR_FORCE_IDX = {0: str, 1: str}  # Sheet2 无表头，用列索引


def parse_args():
    p = argparse.ArgumentParser(description='全量赔付 Excel → Parquet')
    p.add_argument('--input', '-i', required=True, help='输入 Excel 路径')
    p.add_argument('--output', '-o', default=None,
                   help='输出 Parquet 路径（默认 warehouse/fact/claims_bulk/latest.parquet）')
    return p.parse_args()


def read_and_merge(xlsx_path: str) -> pd.DataFrame:
    """读取两个 sheet 并合并。Sheet1 有表头，Sheet2 无表头。"""

    t0 = time.time()
    print(f'[1/4] 读取 Sheet1（有表头）...')
    df1 = pd.read_excel(xlsx_path, sheet_name=0, dtype=STR_FORCE, engine='openpyxl')
    df1.columns = df1.columns.str.strip()
    # 确认列名匹配
    missing = [c for c in CN_COLUMNS if c not in df1.columns]
    if missing:
        print(f'  ⚠️ Sheet1 缺少列: {missing}')
        sys.exit(1)
    df1 = df1[CN_COLUMNS].rename(columns=CN_TO_EN)
    print(f'  Sheet1: {len(df1):,} 行 ({time.time()-t0:.1f}s)')

    t1 = time.time()
    print(f'[1/4] 读取 Sheet2（无表头）...')
    df2 = pd.read_excel(xlsx_path, sheet_name=1, header=None, dtype=STR_FORCE_IDX, engine='openpyxl')
    if len(df2.columns) < 5:
        print(f'  ⚠️ Sheet2 列数不足: {len(df2.columns)}')
        sys.exit(1)
    df2 = df2.iloc[:, :5]
    df2.columns = EN_COLUMNS
    print(f'  Sheet2: {len(df2):,} 行 ({time.time()-t1:.1f}s)')

    print(f'[2/4] 合并 {len(df1):,} + {len(df2):,} = {len(df1)+len(df2):,} 行...')
    df = pd.concat([df1, df2], ignore_index=True)
    return df


def clean_and_dedup(df: pd.DataFrame) -> pd.DataFrame:
    """类型转换 + 去重。"""
    total_raw = len(df)

    # 类型规范化
    df['policy_no'] = df['policy_no'].astype(str).str.strip()
    df['vehicle_frame_no'] = df['vehicle_frame_no'].astype(str).str.strip()
    df['closed_cases'] = pd.to_numeric(df['closed_cases'], errors='coerce').fillna(0).astype('int32')
    df['open_cases'] = pd.to_numeric(df['open_cases'], errors='coerce').fillna(0).astype('int32')
    df['total_claims'] = pd.to_numeric(df['total_claims'], errors='coerce').fillna(0.0)

    # 过滤无效行（policy_no 为空或 'nan'）
    df = df[~df['policy_no'].isin(['', 'nan', 'None', 'NaN'])].copy()

    # 去重 Step1：精确去重（同一 policy_no + 同一金额 = 完全重复行）
    before_exact = len(df)
    df = df.drop_duplicates(subset=['policy_no', 'closed_cases', 'open_cases', 'total_claims'])
    exact_dupes = before_exact - len(df)

    # 去重 Step2：同一 policy_no 多行（VIN 差异等），保留 total_claims 最大行
    before_pno = len(df)
    df = df.sort_values('total_claims', ascending=False).drop_duplicates(subset=['policy_no'], keep='first')
    pno_dupes = before_pno - len(df)

    print(f'[3/4] 去重: 精确重复 {exact_dupes:,} 行, policy_no 重复 {pno_dupes:,} 行')
    print(f'  原始 {total_raw:,} → 去重后 {len(df):,} ({total_raw - len(df):,} 行移除)')

    # 派生字段
    df['total_case_count'] = df['closed_cases'] + df['open_cases']

    return df.reset_index(drop=True)


def main():
    args = parse_args()
    input_path = Path(args.input)
    if not input_path.exists():
        print(f'❌ 文件不存在: {input_path}')
        sys.exit(1)

    data_root = Path(__file__).resolve().parent.parent
    output_path = Path(args.output) if args.output else data_root / 'warehouse/fact/claims_bulk/latest.parquet'

    # 读取 + 合并
    df = read_and_merge(str(input_path))

    # 清洗 + 去重
    df = clean_and_dedup(df)

    # 基础统计
    has_claims = df[df['total_claims'] > 0]
    print(f'  有赔款保单: {len(has_claims):,} ({len(has_claims)/len(df)*100:.1f}%)')
    print(f'  总赔款: {df["total_claims"].sum()/1e4:,.2f} 万元')
    print(f'  总案件数: {df["total_case_count"].sum():,}')

    # 写出 Parquet
    print(f'[4/4] 写出 Parquet → {output_path}')
    table = write_parquet_with_metadata(
        df, output_path,
        source_file=input_path.name,
        processing_mode='convert_claims_bulk',
        extra_metadata={
            'etl_raw_rows': str(len(df)),
            'etl_claims_total_wan': f'{df["total_claims"].sum()/1e4:.2f}',
        },
    )

    # 验证
    import pyarrow.parquet as pq
    verify = pq.read_metadata(str(output_path))
    print(f'  ✓ 写入 {verify.num_rows:,} 行, {verify.num_columns} 列, {output_path.stat().st_size/1e6:.1f} MB')
    print(f'  schema: {[f.name for f in table.schema]}')


if __name__ == '__main__':
    main()
