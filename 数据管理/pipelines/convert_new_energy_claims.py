#!/usr/bin/env python3
"""新能源出险信息表 Excel → new_energy_claims/latest.parquet.

新能源出险 Excel 中 policy_no（保单号）100% 为 NULL，无法用保单号回填 org_level_3
或派生 branch_code。vehicle_frame_no（车架号）100% 非空，通过关联 policy/current/*.parquet
回填 org_level_3 + 派生 branch_code，命中率实证 100%（820/820 distinct VIN，901/901 行）。

核心能力：
  - enrich_org_and_branch_from_policy()：按 vehicle_frame_no JOIN policy 同时回填
    org_level_3（仅填空）+ branch_code（全行注入，hard-fail miss>0）
  - build_new_energy_claims_dataframe() 必须传入 policy_dir
    （new_energy 域上下文必需，缺失/无 parquet 即 raise，禁止静默退化）
  - 命令行新增 --policy-dir 参数（与 convert_claims_detail.py 保持一致）
  - policy parquet 路径通过 DATA_ROOT 动态解析，禁止硬编码
  - P3-E 2026-06-23：branch_code 派生化（VIN→policy LEFT JOIN 模式，区别于
    P3-A/B/C/D 的 policy_no[:3] prefix_map，因 policy_no 100% NULL 不可用）
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

_DATA_ROOT = str(Path(__file__).resolve().parent.parent)
if _DATA_ROOT not in sys.path:
    sys.path.insert(0, _DATA_ROOT)

from pipelines.etl_validation import PLACEHOLDER_STRS, load_excel_all_sheets, verify_non_empty
from pipelines.parquet_utils import write_parquet_with_metadata


OUTPUT_COLUMNS = [
    "report_time",
    "policy_no",
    "claim_no",
    "vehicle_frame_no",
    "plate_no",
    "org_level_3",
    "branch_code",
    "claim_status",
    "settled_amount",
    "reserve_amount",
    "source_batch_date",
]

CN_TO_EN = {
    "报案时间": "report_time",
    "报案号": "claim_no",
    "保单号": "policy_no",
    "车架号": "vehicle_frame_no",
    "车牌号": "plate_no",
    "标的车牌": "plate_no",
    "三级机构": "org_level_3",
    "整案是否结案": "claim_status",
    "分险种案件状态": "claim_status_detail",
    "业务结案赔款": "settled_amount",
    "业务结案金额": "settled_amount",
    "立案金额rmb": "reserve_amount",
    "立案金额": "reserve_amount",
}

REQUIRED_COLUMNS = ["报案时间", "报案号"]
STR_FORCE_COLS = {"报案号": str, "保单号": str, "车架号": str, "车牌号": str, "标的车牌": str}


def extract_batch_date(path: Path) -> str | None:
    match = re.match(r"^(\d{8})_", path.name)
    return match.group(1) if match else None


def normalize_claim_status(value: object) -> object:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if text in PLACEHOLDER_STRS:
        return None
    if text == "是":
        return "已业务结案"
    if text == "否":
        return "未业务结案"
    return text


def coalesce_duplicate_columns(df: pd.DataFrame) -> pd.DataFrame:
    """rename 后同一英文列可能来自多个中文金额列，取每行第一个非空值。"""
    result = pd.DataFrame(index=df.index)
    for col in dict.fromkeys(df.columns):
        same = df.loc[:, df.columns == col]
        if same.shape[1] == 1:
            result[col] = same.iloc[:, 0]
        else:
            result[col] = same.bfill(axis=1).iloc[:, 0]
    return result


def enrich_org_and_branch_from_policy(
    df: pd.DataFrame,
    policy_dir: str | None,
) -> pd.DataFrame:
    """通过 vehicle_frame_no 关联 policy parquet 同时回填 org_level_3 + branch_code。

    P3-E 2026-06-23（codex 闸-1 P1 修正后）：
    1. policy_dir 必需，缺失/无 parquet 即 raise（new_energy 上下文禁止静默退化）。
    2. SQL 多取 branch_code 列；org_level_3 仅填空（保留 Excel 已有值），
       branch_code 全行从 JOIN 注入（new_energy parquet 原无此列）。
    3. miss 检查移到 try 外独立 raise（P1#1：不可被通用 except 吞掉）。
       任何行 branch_code IS NULL → RuntimeError（实证 miss=0，hard-fail 合理）。
    4. 业务列保护 guard（R31 模式）：merge 前 assert 'branch_code' 不在 df.columns，
       防止重入/二次调用污染。
    5. 同一 ROW_NUMBER 取 org_level_3 + branch_code → 省份与机构来自同一张最新保单
       （当前 distinct_branch_in_hit=1；未来跨省同 VIN 由 ROW_NUMBER 取最新单一分支兜底）。
    6. 两侧 vehicle_frame_no 做 UPPER+TRIM 规范化，消除大小写/空格差异。

    返回不可变新 DataFrame（调用者原对象不被修改）。
    """
    import duckdb

    result = df.copy()

    # P1#2（codex 闸-1）：policy_dir 必需，缺失/无 parquet 不可静默
    if policy_dir is None:
        raise RuntimeError(
            "❌ enrich_org_and_branch_from_policy 需要 policy_dir（new_energy_claims "
            "的 policy_no 100% NULL，必须 VIN→policy JOIN 派生 branch_code）。daily.mjs "
            "已传 --policy-dir，若直接调用本函数请显式传入 policy/current 目录。"
        )

    policy_path = Path(policy_dir)
    if not policy_path.exists() or not any(policy_path.glob("*.parquet")):
        raise RuntimeError(
            f"❌ policy_dir 不存在或无 Parquet 文件，无法派生 branch_code："
            f"{policy_dir}（new_energy_claims 上下文禁止静默退化）。"
        )

    # 业务列保护 guard（R31 模式）：merge 前 branch_code 不应已存在
    if "branch_code" in result.columns and result["branch_code"].notna().any():
        raise ValueError(
            "❌ enrich 入参 df 已含非空 branch_code 列，禁止重入污染（R31 业务列保护）。"
        )
    # 入参可能含全 NULL 的 branch_code 列（OUTPUT_COLUMNS 预占位）→ 先 drop 以便 merge 重建
    if "branch_code" in result.columns:
        result = result.drop(columns=["branch_code"])

    glob_pattern = str(policy_path / "*.parquet")
    print(f"   JOIN PolicyFact（VIN → org_level_3 + branch_code）: {glob_pattern}")
    try:
        # 同一 ROW_NUMBER 取 org_level_3 + branch_code → 保证省份与机构来自同一张最新保单。
        # 前提：policy parquet 必须含 insurance_start_date + policy_no + branch_code
        # （P1 #762 已注入 branch_code 列，每行 100% 'SC'）。
        # 缺列将 Binder Error 显式中止（schema_error_signals 覆盖）。
        vin_map = duckdb.sql(f"""
            SELECT vehicle_frame_no, org_level_3, branch_code
            FROM (
                SELECT
                    UPPER(TRIM(CAST(vehicle_frame_no AS VARCHAR))) AS vehicle_frame_no,
                    org_level_3,
                    branch_code,
                    ROW_NUMBER() OVER (
                        PARTITION BY UPPER(TRIM(CAST(vehicle_frame_no AS VARCHAR)))
                        ORDER BY insurance_start_date DESC NULLS LAST,
                                 policy_no DESC NULLS LAST
                    ) AS rn
                FROM read_parquet('{glob_pattern}')
                WHERE vehicle_frame_no IS NOT NULL
                  AND TRIM(CAST(vehicle_frame_no AS VARCHAR)) <> ''
                  AND branch_code IS NOT NULL
                  AND TRIM(CAST(branch_code AS VARCHAR)) <> ''
            )
            WHERE rn = 1
        """).df()
        vin_map.columns = ["vehicle_frame_no", "_policy_org_level_3", "_policy_branch_code"]
        # rn=1 保证每个 VIN 唯一，drop_duplicates 作双重保险
        vin_map = vin_map.drop_duplicates(subset=["vehicle_frame_no"], keep="first")

        before_null_org = result["org_level_3"].isna().sum()
        # claims 侧 vehicle_frame_no 做同样 UPPER+TRIM 规范化，merge 后丢弃临时键
        result["_vin_key"] = result["vehicle_frame_no"].astype("string").str.upper().str.strip()
        vin_map["_vin_key"] = vin_map["vehicle_frame_no"].astype(str).str.upper().str.strip()
        result = result.merge(
            vin_map[["_vin_key", "_policy_org_level_3", "_policy_branch_code"]],
            on="_vin_key",
            how="left",
        ).drop(columns=["_vin_key"])

        # org_level_3 仅回填为空的行（Excel 已有值的行保持原值）
        need_fill_org = result["org_level_3"].isna() & result["_policy_org_level_3"].notna()
        if need_fill_org.any():
            result.loc[need_fill_org, "org_level_3"] = result.loc[need_fill_org, "_policy_org_level_3"]

        # branch_code 全行注入（new_energy parquet 原无此列，直接采用 JOIN 值）
        result["branch_code"] = result["_policy_branch_code"]

        result = result.drop(columns=["_policy_org_level_3", "_policy_branch_code"])

        after_null_org = result["org_level_3"].isna().sum()
        filled_org = before_null_org - after_null_org
        total = len(result)
        print(
            f"   org_level_3 回填（VIN JOIN）: {filled_org:,}/{before_null_org:,} 行命中"
            f"（全表命中率 {filled_org / total * 100:.1f}%，剩余空值 {after_null_org:,} 行）"
        )
    except Exception as exc:
        exc_msg = str(exc)
        # Schema/Binder 类错误（policy parquet 缺必需列 insurance_start_date / policy_no /
        # branch_code 等）显式上抛，避免 all 模式继续生成错误的产物。
        schema_error_signals = ("Binder Error", "Referenced column", "does not exist", "No such column")
        if any(sig in exc_msg for sig in schema_error_signals):
            raise RuntimeError(
                f"❌ PolicyFact VIN JOIN 因 schema 缺列中止（前提：policy parquet 必须含 "
                f"insurance_start_date + policy_no + branch_code），禁止静默退化。原始错误：{exc}"
            ) from exc
        # 其他运行时错误（I/O、内存、DuckDB 非 schema 错误）：警告，但 branch_code 必无注入
        # → 由下方 try 外 miss 检查（P1#1）兜底 fail-fast，不会静默退化。
        print(f"   ⚠ PolicyFact VIN JOIN 失败，后续 miss 检查将 fail-fast：{exc}")
        # 保证 branch_code 列存在以便 miss 检查可读取（否则 KeyError）
        if "branch_code" not in result.columns:
            result["branch_code"] = pd.NA

    # P1#1（codex 闸-1）：miss 检查在 try 外独立 raise，不可被通用 except 吞掉。
    # 兜底所有失败路径（schema 错误已 raise；通用 except 后 branch_code 必全 NULL；
    # 正常路径下实证 miss=0）。
    miss_count = int(result["branch_code"].isna().sum())
    if miss_count > 0:
        sample_vins = (
            result.loc[result["branch_code"].isna(), "vehicle_frame_no"]
            .astype("string")
            .dropna()
            .head(5)
            .tolist()
        )
        raise RuntimeError(
            f"❌ branch_code 派生失败：{miss_count:,}/{len(result):,} 行未命中 policy VIN（hard-fail）。"
            f"前 5 个未命中 VIN：{sample_vins}。"
            f"原因可能：① policy parquet 缺 branch_code 列（P1 #762 未注入）"
            f"② VIN 在 new_energy 但不在 policy（数据质量事故，必须人工排查）"
            f"③ 上游 JOIN 抛非 schema 错误被 except 兜底（warning 日志已打印）。"
        )

    return result


def build_new_energy_claims_dataframe(
    input_files: list[Path],
    policy_dir: str | None = None,
) -> pd.DataFrame:
    frames = []
    for input_file in input_files:
        raw = load_excel_all_sheets(
            input_file,
            dtype=STR_FORCE_COLS,
            required_columns=REQUIRED_COLUMNS,
        ).copy()
        raw.columns = raw.columns.str.strip()
        missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
        if missing:
            raise ValueError(f"{input_file.name} 缺少必须列: {missing}; 实际列: {list(raw.columns)}")

        rename_map = {k: v for k, v in CN_TO_EN.items() if k in raw.columns}
        df = raw.rename(columns=rename_map)
        df = coalesce_duplicate_columns(df)
        df = df[[c for c in df.columns if c in set(CN_TO_EN.values())]].copy()
        for col in OUTPUT_COLUMNS:
            if col not in df.columns:
                df[col] = pd.NA

        df["report_time"] = pd.to_datetime(df["report_time"], errors="coerce")
        df["claim_no"] = df["claim_no"].astype("string").str.strip().replace(PLACEHOLDER_STRS, None)
        for col in ("policy_no", "vehicle_frame_no", "plate_no", "org_level_3"):
            df[col] = df[col].astype("string").str.strip().replace(PLACEHOLDER_STRS, None)
        df["claim_status"] = df["claim_status"].map(normalize_claim_status)
        df["settled_amount"] = pd.to_numeric(df["settled_amount"], errors="coerce")
        df["reserve_amount"] = pd.to_numeric(df["reserve_amount"], errors="coerce")
        df["source_batch_date"] = extract_batch_date(input_file)
        frames.append(df[OUTPUT_COLUMNS])
        print(f"   产物: {input_file.name} → {len(df):,} 行 × {len(OUTPUT_COLUMNS)} 列")

    if not frames:
        raise ValueError("未提供新能源出险输入文件")

    df = pd.concat(frames, ignore_index=True)
    before = len(df)
    df = df[df["report_time"].notna()].copy()
    if len(df) < before:
        print(f"   过滤无 report_time: {before - len(df):,} 行")

    before = len(df)
    has_business_key = df["claim_no"].notna() | df["policy_no"].notna()
    df = df[has_business_key].copy()
    if len(df) < before:
        print(f"   过滤无 claim_no/policy_no: {before - len(df):,} 行")

    df = df.drop_duplicates(subset=["claim_no", "policy_no", "report_time"], keep="last")
    df = df[OUTPUT_COLUMNS].sort_values(["report_time", "claim_no"]).reset_index(drop=True)

    # 通过 vehicle_frame_no JOIN policy 同时回填 org_level_3 + 派生 branch_code
    # （policy_no 在新能源出险 Excel 中 100% 为 NULL，不可用作 JOIN 键）
    # P3-E 2026-06-23：branch_code 派生化 hard-fail（miss>0 即 raise）
    df = enrich_org_and_branch_from_policy(df, policy_dir=policy_dir)

    return df[OUTPUT_COLUMNS].reset_index(drop=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="新能源出险信息表 → Parquet")
    parser.add_argument("-i", "--input", nargs="+", required=True, help="输入 Excel 文件")
    parser.add_argument("-o", "--output", required=True, help="输出 Parquet 文件")
    parser.add_argument(
        "--policy-dir",
        default=None,
        help=(
            "policy/current Parquet 目录，用于通过 vehicle_frame_no JOIN 回填 "
            "org_level_3 + 派生 branch_code（new_energy_claims 必需；本地与 VPS "
            "路径不同，由 daily.mjs 动态拼接后传入；禁止在此硬编码）"
        ),
    )
    parser.add_argument("--no-metadata", action="store_true", help="兼容 daily.mjs manifest 流程")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_files = [Path(p).resolve() for p in args.input]
    output_file = Path(args.output).resolve()

    print("=" * 80)
    print("📋 新能源出险信息表 → Parquet")
    print("=" * 80)
    for input_file in input_files:
        print(f"   输入: {input_file.name}")
    if args.policy_dir:
        print(f"   policy_dir: {args.policy_dir}")

    df = build_new_energy_claims_dataframe(input_files, policy_dir=args.policy_dir)
    print("\n   === 数据概览 ===")
    print(f"   记录数: {len(df):,}")
    print(f"   唯一报案/赔案号: {df['claim_no'].nunique():,}")
    print(f"   报案时间: {df['report_time'].min()} ~ {df['report_time'].max()}")
    print(f"   立案金额合计: {df['reserve_amount'].sum(skipna=True):,.2f}")
    print(f"   branch_code 分布: {df['branch_code'].value_counts(dropna=False).to_dict()}")

    write_parquet_with_metadata(
        df,
        output_file,
        source_file=", ".join(str(p) for p in input_files),
        processing_mode="convert_new_energy_claims",
    )
    verify = pd.read_parquet(output_file)
    verify_non_empty(verify)
    print(f"\n   输出: {output_file} ({output_file.stat().st_size / 1024 / 1024:.1f} MB)")
    print(f"   验证: {len(verify):,} 行 × {len(verify.columns)} 列 ✅")
    print("=" * 80)
    print("✅ 完成")


if __name__ == "__main__":
    main()
