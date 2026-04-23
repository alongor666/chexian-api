#!/usr/bin/env python3
"""
理赔明细 Excel → claims_detail parquet（支持分区架构）

赔案级明细数据（每行 = 一个赔案），包含出险原因/人伤/地点/时效链/金额细分。
支持 --policy-dir 参数，JOIN PolicyFact 获取 insurance_start_date 并派生 insurance_year。

用法：
  python3 convert_claims_detail.py -i 02_理赔明细_*.xlsx -o warehouse/fact/claims_detail/_incoming.parquet --policy-dir warehouse/fact/policy/current/
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
    # ── 前后兼容：2021-2024 旧源含「已决费用」无「标的汽修厂」；2025+ 新源反之 ──
    '报案时间': 'report_time',
    '赔案号': 'claim_no',
    '报案号': 'report_no',
    '车架号': 'vehicle_frame_no',
    '保单号': 'policy_no',
    '标的车牌': 'subject_plate_no',
    '车系': 'vehicle_series',
    '报案损失类别': 'loss_category',
    '出险经过': 'accident_description',
    '诊疗类型': 'treatment_type',
    '出险原因': 'accident_cause',
    '出险地点省份': 'accident_province',
    '出险地点城市': 'accident_city',
    '出险地区': 'accident_district',
    '出险地点': 'accident_address',
    '出险时间': 'accident_time',
    '立案时间': 'case_open_time',
    '查勘时间': 'survey_time',
    '已决时间': 'settlement_time',
    '支付时间': 'payment_time',
    '案件类型': 'case_type',
    '现场类型': 'scene_type',
    '三者汽修厂': 'third_party_repair',
    '标的汽修厂': 'subject_repair_shop',      # 2025+ 新增（标的车维修厂）
    '是否追偿': 'is_recovery',
    '立案金额': 'reserve_amount',
    '立案金额-人': 'reserve_bodily_amount',
    '立案金额-车物': 'reserve_vehicle_amount',
    '立案金额-物': 'reserve_property_amount',
    '业务结案赔款-车物': 'settled_vehicle_amount',
    '业务结案赔款-人': 'settled_bodily_amount',
    '已决费用': 'settled_fee',                # 2021-2024 旧源，2025+ 已移除
    '责任系数': 'liability_ratio',
    '已决金额': 'settled_amount',
    '未决金额': 'pending_amount',
}

REQUIRED_COLUMNS = ['保单号', '赔案号', '立案金额']

TIMESTAMP_COLS = ['accident_time', 'report_time', 'case_open_time', 'survey_time', 'settlement_time', 'payment_time']
AMOUNT_COLS = [
    'reserve_amount', 'reserve_bodily_amount',
    'reserve_vehicle_amount', 'reserve_property_amount',
    'settled_vehicle_amount', 'settled_bodily_amount', 'settled_fee',
    'settled_amount', 'pending_amount',
]
STR_FORCE_COLS = {'保单号': str, '报案号': str, '赔案号': str, '车架号': str, '标的车牌': str}


def _enrich_insurance_start_date(df: pd.DataFrame, policy_dir: str | None) -> pd.DataFrame:
    """从 PolicyFact JOIN 获取 insurance_start_date，未匹配的用 policy_no 位置 12-15 推导年份。"""
    import duckdb

    # Step 1: 从 policy_no 提取年份作为 fallback（SUBSTRING 位置 12-15 = 保险起期年份，98.2% 一致率）
    def extract_year(pno):
        if pd.isna(pno) or len(str(pno)) < 15:
            return None
        y = str(pno)[11:15]
        return int(y) if y.isdigit() and 2018 <= int(y) <= 2030 else None

    df['_pn_year'] = df['policy_no'].apply(extract_year)

    # Step 2: 尝试 JOIN PolicyFact 获取精确日期
    joined_count = 0
    if policy_dir:
        policy_path = Path(policy_dir)
        if policy_path.exists() and any(policy_path.glob('*.parquet')):
            glob_pattern = str(policy_path / '*.parquet')
            print(f"   JOIN PolicyFact: {glob_pattern}")
            try:
                result = duckdb.sql(f"""
                    SELECT DISTINCT policy_no, insurance_start_date
                    FROM read_parquet('{glob_pattern}')
                    WHERE policy_no IS NOT NULL AND insurance_start_date IS NOT NULL
                """).df()
                result.columns = ['policy_no', '_pf_insurance_start_date']
                df = df.merge(result, on='policy_no', how='left')
                joined_count = df['_pf_insurance_start_date'].notna().sum()
                print(f"   PolicyFact 匹配: {joined_count:,}/{len(df):,} ({joined_count/len(df)*100:.1f}%)")
            except Exception as e:
                print(f"   ⚠ PolicyFact JOIN 失败（使用 policy_no 回退）: {e}")

    # Step 3: 合并——优先用 JOIN 结果，回退到 policy_no 年份
    if '_pf_insurance_start_date' in df.columns:
        df['insurance_start_date'] = df['_pf_insurance_start_date']
        # 未匹配的用 policy_no 年份构造 YYYY-01-01
        mask = df['insurance_start_date'].isna() & df['_pn_year'].notna()
        df.loc[mask, 'insurance_start_date'] = df.loc[mask, '_pn_year'].apply(
            lambda y: pd.Timestamp(year=int(y), month=1, day=1)
        )
        df.drop(columns=['_pf_insurance_start_date'], inplace=True)
    else:
        df['insurance_start_date'] = df['_pn_year'].apply(
            lambda y: pd.Timestamp(year=int(y), month=1, day=1) if pd.notna(y) else pd.NaT
        )

    # Step 4: 派生 insurance_year（分区键）
    df['insurance_start_date'] = pd.to_datetime(df['insurance_start_date'], errors='coerce')
    df['insurance_year'] = df['insurance_start_date'].dt.year.astype('Int64')
    fallback_count = len(df) - joined_count
    null_year = df['insurance_year'].isna().sum()
    print(f"   insurance_year: JOIN={joined_count:,}, fallback={fallback_count:,}, NULL={null_year:,}")

    df.drop(columns=['_pn_year'], inplace=True)
    return df


def parse_args():
    parser = argparse.ArgumentParser(description='理赔明细 → Parquet')
    parser.add_argument('-i', '--input', nargs='+', required=True, help='输入 Excel 文件（支持多个）')
    parser.add_argument('-o', '--output', required=True, help='输出 Parquet 文件')
    parser.add_argument('--policy-dir', default=None,
                        help='PolicyFact parquet 目录，用于 JOIN 获取 insurance_start_date（可选，回退到 policy_no 提取）')
    return parser.parse_args()


def main():
    args = parse_args()
    input_files = [Path(f) for f in args.input]
    output_file = Path(args.output)

    print(f"{'='*80}")
    print(f"📋 理赔明细 → Parquet (赔案明细)")
    print(f"{'='*80}")

    # ── 加载（多文件 × 多 sheet 自动合并）──
    from pipelines.etl_validation import load_excel_all_sheets
    frames = []
    for f in input_files:
        print(f"   输入: {f.name}")
        part = load_excel_all_sheets(f, dtype=STR_FORCE_COLS, required_columns=REQUIRED_COLUMNS)
        frames.append(part)
    df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    if len(frames) > 1:
        print(f"   合并 {len(frames)} 个文件: {len(df):,} 行")
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

    # ── 前后兼容：确保双 schema 列始终存在（缺失补 NULL） ──
    # 2021-2024 旧源有 settled_fee 无 subject_repair_shop；2025+ 反之。
    # 输出 parquet 统一包含两列，避免跨年度分区合并时 schema 漂移。
    for legacy_col in ('settled_fee', 'subject_repair_shop'):
        if legacy_col not in df.columns:
            df[legacy_col] = pd.NA
            print(f"   补齐缺失列: {legacy_col} = NULL（源文件无此字段）")

    # ── 类型转换 ──

    # 时间戳
    for col in TIMESTAMP_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    if 'accident_time' in df.columns:
        valid_ts = df['accident_time'].notna().sum()
        print(f"   出险时间: {df['accident_time'].min()} ~ {df['accident_time'].max()} ({valid_ts:,} 有值)")

    # 是否追偿 → BOOLEAN
    if 'is_recovery' in df.columns:
        df['is_recovery'] = df['is_recovery'].map({'是': True, '否': False}).astype('boolean')

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
    for col in ['policy_no', 'claim_no', 'report_no', 'vehicle_frame_no', 'subject_plate_no',
                'subject_repair_shop', 'third_party_repair']:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace(_PLACEHOLDER_STRS, None)

    # ── 派生：标的汽修厂前 8 位编码（JOIN RepairDim.shop_code 的稳定 key）──
    # 维修资源板块使用（.claude/shared-memory/repair_source_field_mapping.md §2.1）
    if 'subject_repair_shop' in df.columns:
        df['subject_shop_code'] = df['subject_repair_shop'].apply(
            lambda s: s[:8] if pd.notna(s) and isinstance(s, str) and len(s) >= 8 else None
        )
        shop_non_null = df['subject_shop_code'].notna().sum()
        shop_unique = df['subject_shop_code'].nunique()
        print(f"   标的汽修厂: {shop_non_null:,}/{len(df):,} 有值, 去重编码 {shop_unique:,}")

    # ── 派生字段 ──

    # claim_status：根据已决时间判断（⚠️ 近似口径：以 settlement_time 非空作为业务结案标志，非来自原始状态字段）
    if 'settlement_time' in df.columns:
        df['claim_status'] = df['settlement_time'].notna().map({True: '已业务结案', False: '未业务结案'})
    else:
        df['claim_status'] = '未业务结案'

    # is_bodily_injury：立案金额-人 > 0 OR 业务结案赔款-人 > 0
    _zero = pd.Series(False, index=df.index)
    bodily_reserve = (df['reserve_bodily_amount'].fillna(0) > 0) if 'reserve_bodily_amount' in df.columns else _zero
    bodily_settled = (df['settled_bodily_amount'].fillna(0) > 0) if 'settled_bodily_amount' in df.columns else _zero
    df['is_bodily_injury'] = bodily_reserve | bodily_settled
    injury_count = df['is_bodily_injury'].sum()
    print(f"   人伤案件: {injury_count:,}/{len(df):,} ({injury_count/len(df)*100:.1f}%)")

    # ── 过滤无效行 ──
    before = len(df)
    df = df[df['claim_no'].notna()].copy()
    if len(df) < before:
        print(f"   过滤无赔案号: {before - len(df):,} 行")

    # ── insurance_start_date enrichment ──
    df = _enrich_insurance_start_date(df, args.policy_dir)

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
        source_file=', '.join(str(f) for f in args.input),
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
