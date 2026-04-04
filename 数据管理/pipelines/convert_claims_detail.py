#!/usr/bin/env python3
"""
车险报立结案清单 Excel → claims_detail/latest.parquet

赔案级明细数据（每行 = 一个赔案），包含出险原因/人伤/地点/时效链/金额细分。
与现有 claims/latest.parquet（保单级聚合）互补，不替换。

用法：
  python3 convert_claims_detail.py -i 车险报立结案清单_*.xlsx -o warehouse/fact/claims_detail/latest.parquet
"""

import argparse
import sys
import pandas as pd
import numpy as np
from pathlib import Path

# 确保 PYTHONPATH 包含数据管理目录（与 daily.mjs 行为一致）
_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)


# ── 字段映射：中文 → 英文 snake_case ──

CN_TO_EN = {
    '保单号': 'policy_no',
    '车架号': 'vehicle_frame_no',
    '车系': 'vehicle_series',
    '保险起期': 'insurance_start_date',
    '报案号': 'report_no',
    '赔案号': 'claim_no',
    '出险时间': 'accident_time',
    '赔案类型': 'claim_status',
    '是否人伤': 'is_bodily_injury',
    '责任系数': 'liability_ratio',
    '报案时间': 'report_time',
    '立案时间': 'case_open_time',
    '已决时间': 'settlement_time',
    '支付时间': 'payment_time',
    '出险地点省份': 'accident_province',
    '出险地点城市': 'accident_city',
    '出险地区': 'accident_district',
    '出险地点': 'accident_address',
    '出险经过': 'accident_description',
    '出险原因': 'accident_cause',
    '现场类型': 'scene_type',
    '立案金额rmb': 'reserve_amount',
    '立案金额-人': 'reserve_bodily_amount',
    '最近人伤立案金额': 'reserve_bodily_latest',
    '立案金额-车物': 'reserve_vehicle_amount',
    '立案金额-物': 'reserve_property_amount',
    '立案金额-费用': 'reserve_fee_amount',
}

REQUIRED_COLUMNS = ['保单号', '赔案号', '立案金额rmb']

TIMESTAMP_COLS = ['accident_time', 'report_time', 'case_open_time', 'settlement_time', 'payment_time']
AMOUNT_COLS = [
    'reserve_amount', 'reserve_bodily_amount', 'reserve_bodily_latest',
    'reserve_vehicle_amount', 'reserve_property_amount', 'reserve_fee_amount',
]
STR_FORCE_COLS = {'保单号': str, '报案号': str, '赔案号': str, '车架号': str}


def parse_args():
    parser = argparse.ArgumentParser(description='车险报立结案清单 → Parquet')
    parser.add_argument('-i', '--input', required=True, help='输入 Excel 文件')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 车险报立结案清单 → Parquet (赔案明细)")
    print(f"{'='*80}")
    print(f"   输入: {input_file.name}")

    # ── 加载 ──
    df = pd.read_excel(input_file, dtype=STR_FORCE_COLS)
    print(f"   加载: {len(df):,} 行 × {len(df.columns)} 列")
    print(f"   源列: {list(df.columns)}")

    # ── Schema 契约 ──
    df.columns = df.columns.str.strip()
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        print(f"   ❌ 缺少必须列: {missing}")
        print(f"      实际列: {list(df.columns)}")
        sys.exit(1)

    # ── 列名重命名 ──
    rename_cols = {k: v for k, v in CN_TO_EN.items() if k in df.columns}
    df = df.rename(columns=rename_cols)
    extra_cols = [c for c in df.columns if c not in CN_TO_EN.values()]
    if extra_cols:
        print(f"   ⚠ 未映射列（已丢弃）: {extra_cols}")
        df = df[[c for c in df.columns if c in CN_TO_EN.values()]]
    print(f"   列名重命名: {len(rename_cols)}/{len(CN_TO_EN)} 列")

    # ── 类型转换 ──

    # 时间戳
    for col in TIMESTAMP_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    if 'accident_time' in df.columns:
        valid_ts = df['accident_time'].notna().sum()
        print(f"   出险时间: {df['accident_time'].min()} ~ {df['accident_time'].max()} ({valid_ts:,} 有值)")

    # 保险起期 → DATE
    if 'insurance_start_date' in df.columns:
        df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce')

    # 是否人伤 → BOOLEAN
    if 'is_bodily_injury' in df.columns:
        df['is_bodily_injury'] = df['is_bodily_injury'].map({'是': True, '否': False})
        injury_count = df['is_bodily_injury'].sum()
        print(f"   人伤案件: {injury_count:,}/{len(df):,} ({injury_count/len(df)*100:.1f}%)")

    # 责任系数 → DOUBLE
    if 'liability_ratio' in df.columns:
        df['liability_ratio'] = pd.to_numeric(df['liability_ratio'], errors='coerce')

    # 金额列 → DOUBLE（缺失值保留 NULL，不填 0，避免虚假"0 元赔案"）
    for col in AMOUNT_COLS:
        if col in df.columns:
            nulls_before = df[col].isna().sum()
            df[col] = pd.to_numeric(df[col], errors='coerce')
            nulls_after = df[col].isna().sum()
            coerced = nulls_after - nulls_before
            if coerced > 0:
                print(f"   {col}: {coerced:,} 行无法解析为数值（保留 NULL）")

    # 出险经过截断 500 字
    _PLACEHOLDER_STRS = {'', 'nan', 'None', 'NaN', 'null'}
    if 'accident_description' in df.columns:
        df['accident_description'] = (
            df['accident_description']
            .astype(str)
            .str.strip()
            .str[:500]
            .replace(_PLACEHOLDER_STRS, None)
        )

    # 字符串字段标准化
    for col in ['policy_no', 'claim_no', 'report_no', 'vehicle_frame_no']:
        if col in df.columns:
            df[col] = df[col].str.strip().replace(_PLACEHOLDER_STRS, None)

    # ── 过滤无效行 ──
    before = len(df)
    df = df[df['claim_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无赔案号: {before - len(df):,} 行")

    # ── 统计 ──
    print(f"\n   === 数据概览 ===")
    print(f"   赔案数: {len(df):,}")
    print(f"   唯一保单: {df['policy_no'].nunique():,}")
    print(f"   赔案类型: {df['claim_status'].value_counts().to_dict() if 'claim_status' in df.columns else 'N/A'}")
    if 'accident_cause' in df.columns:
        top_causes = df['accident_cause'].value_counts().head(5)
        print(f"   出险原因TOP5: {top_causes.to_dict()}")
    if 'reserve_amount' in df.columns:
        print(f"   立案金额: 总计 {df['reserve_amount'].sum()/1e8:.2f} 亿, 均值 {df['reserve_amount'].mean():,.0f} 元")

    # ── 输出 Parquet ──
    output_file.parent.mkdir(parents=True, exist_ok=True)

    from pipelines.parquet_utils import write_parquet_with_metadata
    write_parquet_with_metadata(
        df, output_file,
        source_file=str(args.input),
        processing_mode="convert_claims_detail",
    )

    size_mb = output_file.stat().st_size / 1024 / 1024
    print(f"\n   输出: {output_file} ({size_mb:.1f} MB)")

    # ── 验证 ──
    verify = pd.read_parquet(output_file)
    assert len(verify) > 0, "输出文件为空"
    dup_claims = len(verify) - verify['claim_no'].nunique()
    if dup_claims > 0:
        print(f"   ⚠ 赔案号重复: {dup_claims:,} 条")
    missing_policy = verify['policy_no'].isna().sum()
    if missing_policy > 0:
        print(f"   ⚠ 缺失 policy_no: {missing_policy:,} 条")
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")

    print(f"{'='*80}")
    print(f"✅ 完成")


if __name__ == '__main__':
    main()
