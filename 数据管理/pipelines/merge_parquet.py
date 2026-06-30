#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Parquet 合并工具 — 两种模式

1. concat 模式（默认，pyarrow columnar concat，支持 schema 自动统一）：
   python3 merge_parquet.py f1.parquet f2.parquet ... output.parquet
   或：python3 merge_parquet.py -i f1.parquet f2.parquet -o output.parquet

2. dedup 模式（DuckDB ROW_NUMBER PARTITION BY，按主键保留排序后第一行）：
   python3 merge_parquet.py -i f1.parquet f2.parquet -o output.parquet \\
       --dedup-key policy_no --order-by "policy_date DESC NULLS LAST"

dedup 模式专为 daily.mjs 中 cross_sell/repair 多分片合并设计，替代 inline
Python 生成。
"""

import argparse
import sys
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.types as patypes


# ── concat 模式（pyarrow columnar concat） ──

def resolve_target_type(name, types):
    non_null_types = [t for t in types if not patypes.is_null(t)]
    if not non_null_types:
        return pa.null()

    first = non_null_types[0]
    if all(t.equals(first) for t in non_null_types[1:]):
        return first

    if all(patypes.is_string(t) or patypes.is_large_string(t) for t in non_null_types):
        return pa.large_string()

    if all(patypes.is_boolean(t) for t in non_null_types):
        return pa.bool_()

    if all(patypes.is_integer(t) or patypes.is_floating(t) or patypes.is_boolean(t) for t in non_null_types):
        if any(patypes.is_floating(t) for t in non_null_types):
            return pa.float64()
        return pa.int64()

    if all(patypes.is_timestamp(t) for t in non_null_types):
        units = {t.unit for t in non_null_types}
        timezones = {t.tz for t in non_null_types}
        if len(units) == 1 and len(timezones) == 1:
            return first

    raise TypeError(
        f"列 {name} 存在无法自动统一的类型: "
        + ", ".join(str(t) for t in non_null_types)
    )


def build_target_schema(tables):
    ordered_names = []
    for table in tables:
        for name in table.column_names:
            if name not in ordered_names:
                ordered_names.append(name)

    fields = []
    for name in ordered_names:
        types = []
        for table in tables:
            if name in table.column_names:
                types.append(table.schema.field(name).type)
        fields.append(pa.field(name, resolve_target_type(name, types)))
    return pa.schema(fields)


def align_table(table, target_schema):
    arrays = []
    for field in target_schema:
        if field.name in table.column_names:
            column = table[field.name]
            if not column.type.equals(field.type):
                column = column.cast(field.type)
        else:
            column = pa.nulls(table.num_rows, type=field.type)
        arrays.append(column)
    return pa.table(arrays, schema=target_schema)


def run_concat(input_paths, output_path):
    start_ts = time.perf_counter()
    tables = []
    for p in input_paths:
        t = pq.read_table(p)
        print(f"   读取: {p.name}  {t.num_rows:,} 行 × {t.num_columns} 列")
        tables.append(t)

    target_schema = build_target_schema(tables)
    aligned_tables = [align_table(table, target_schema) for table in tables]
    merged = pa.concat_tables(aligned_tables, promote_options='default')

    from pipelines.parquet_utils import write_parquet_with_metadata
    source_names = ", ".join(p.name for p in input_paths)
    write_parquet_with_metadata(
        merged, output_path,
        source_file=source_names,
        processing_mode="merge",
        extra_metadata={"etl_input_count": str(len(input_paths))},
    )

    elapsed = time.perf_counter() - start_ts
    total_rows = sum(t.num_rows for t in tables)
    print(f"✅ 合并完成: {total_rows:,} 行 → {output_path.name}（{elapsed:.2f}s）")


# ── dedup 模式（DuckDB ROW_NUMBER） ──

def _validate_sql_identifier(value: str, label: str) -> None:
    """防 SQL 注入：仅允许字母数字下划线、有限关键字、括号和 IS NULL 表达式"""
    allowed_keywords = {"ASC", "DESC", "NULLS", "LAST", "FIRST", ",", "IS", "NOT", "NULL"}
    # 先剥离括号（用于 `(col IS NULL) ASC` 这类条件排序），再按空格切分
    tokens = (
        value
        .replace("(", " ( ")
        .replace(")", " ) ")
        .replace(",", " , ")
        .split()
    )
    for part in tokens:
        upper = part.upper()
        if upper in allowed_keywords or upper in {"(", ")"}:
            continue
        if not part.replace("_", "").isalnum():
            print(
                f"❌ 非法 {label}: {value}"
                "（允许：字母数字下划线 + ASC/DESC/NULLS LAST/FIRST/IS NOT NULL/括号/逗号）"
            )
            sys.exit(1)


def run_dedup(input_paths, output_path, dedup_key, order_by):
    import duckdb
    _validate_sql_identifier(dedup_key, "dedup_key")
    _validate_sql_identifier(order_by, "order_by")

    file_list = "[" + ", ".join(f"'{str(p.resolve())}'" for p in input_paths) + "]"
    output_abs = str(output_path.resolve())
    sql = f"""
        COPY (
            SELECT * EXCLUDE (_rn) FROM (
                SELECT *,
                    ROW_NUMBER() OVER (
                        PARTITION BY {dedup_key}
                        ORDER BY {order_by}
                    ) AS _rn
                FROM read_parquet({file_list}, union_by_name=true)
            )
            WHERE _rn = 1
        ) TO '{output_abs}' (FORMAT PARQUET)
    """
    duckdb.sql(sql)
    cnt = duckdb.sql(f"SELECT COUNT(*) FROM read_parquet('{output_abs}')").fetchone()[0]
    print(f"   ✅ 去重合并完成: {cnt:,} 条 → {output_path.name}")


def reapply_registry_derivations(output_path, declared_branch):
    """合并去重后对最终 parquet 重新应用 registry 派生（多省 P3-B codex 闸-2 P1）。

    根因（保单类域）：multi_file_merge + merge_with_history 会把旧 latest.parquet（无
    branch_code 列）与新 tmp 分片（已派生 branch_code）一起喂给
    `read_parquet(..., union_by_name=true)`，导致旧行 branch_code=NULL → strict_non_null
    保护被绕过 → RLS 漏行。本函数读回合并产物 → 重派生 branch_code（基于 policy_no 现有列）→ 写回。

    dim 表分支（Bug 3 修复，如 repair_resource）：无 policy_no 主键列，branch_code 的
    prefix_map 派生（源列 policy_no）不适用 —— 原先硬走 apply_registry_derivations 会触发
    strictNonNull「源列 policy_no 缺失」fail-fast，使 SC repair 39 分片合并崩溃。dim 表的
    branch_code 是 ETL 按部署省注入的常量列（值由 declared_branch 权威确定），故无 policy_no
    时改为直接以 declared_branch 赋常量、跳过对 policy_no 的强校验（亦顺带覆盖 convert 阶段
    可能写入的错省码，保证 dim 产物 branch_code == 声明省）。
    """
    import pandas as pd
    from pipelines.derived_fields import apply_registry_derivations

    df = pd.read_parquet(output_path)
    before_cols = list(df.columns)
    if "policy_no" in df.columns:
        df = apply_registry_derivations(df, declared_branch)
    else:
        df = _reassert_dim_branch_constant(df, output_path.name, declared_branch)
    print(
        f"   🔁 合并后 re-derive 完成: {output_path.name}（{len(df):,} 行,"
        f" {len(before_cols)} → {len(df.columns)} 列）"
    )
    df.to_parquet(output_path, index=False)


def _reassert_dim_branch_constant(df, label, declared_branch):
    """无 policy_no 列的 dim 表合并产物：以 declared_branch 赋 branch_code 常量列。

    跳过 prefix_map 强校验（dim 表没有 policy_no 可供前缀派生）。declared_branch 为空时
    （dedup 模式下 daily.mjs 总会透传，默认 'SC'，故仅理论防御）保持原值不动、不静默赋 None。
    """
    if not declared_branch:
        print(f"   ℹ {label} 无 policy_no 列且未声明省份 → 跳过 branch_code 重赋（保持原值）")
        return df
    # fail-closed（PR #861 review MEDIUM）：merge_parquet.py 作为独立可执行脚本可被外部直调，
    # declared_branch 须是 fields.json 已注册省码，否则会把非法省码无声写进 dim 产物（违反隔离红线）。
    from pipelines.derived_fields import registered_branch_codes
    allowed = registered_branch_codes()
    if allowed and declared_branch not in allowed:
        print(f"   ❌ {label} declared-branch '{declared_branch}' 不在已注册省份 {sorted(allowed)} — fail-fast")
        sys.exit(1)
    df = df.copy()
    df["branch_code"] = declared_branch
    print(
        f"   🔁 {label} 无 policy_no 列（dim 表）→ branch_code 赋常量 "
        f"'{declared_branch}'（跳过 prefix_map 强校验）"
    )
    return df


def main():
    # 检测调用模式：含 -i/-o → argparse 模式；否则 → 旧位置参数模式
    use_argparse = any(a in ("-i", "--inputs", "-o", "--output") for a in sys.argv[1:])

    if use_argparse:
        parser = argparse.ArgumentParser(description="Parquet 合并工具（concat 或 dedup 模式）")
        parser.add_argument("-i", "--inputs", nargs="+", required=True, help="输入 parquet 文件")
        parser.add_argument("-o", "--output", required=True, help="输出 parquet 路径")
        parser.add_argument("--dedup-key", default=None,
                            help="去重主键列名（提供则启用 dedup 模式）")
        parser.add_argument("--order-by", default=None,
                            help='dedup 排序表达式，如 "policy_date DESC NULLS LAST"')
        parser.add_argument(
            "--declared-branch", default=None,
            help="多省 P3-B（codex 闸-2 P1）：dedup 模式合并完成后对最终 parquet 重新应用 "
                 "registry 派生（branch_code 等）。覆盖来自历史 latest 合并产生的 NULL 派生列（"
                 "union_by_name=true 会给旧行补 NULL → strict_non_null 保护被绕过 → RLS 漏行）。"
                 "df 无 policy_no 列（dim 表如 repair_resource）时直接以本值赋 branch_code 常量、"
                 "跳过 prefix_map 强校验。仅作用于 dedup 模式。",
        )
        args = parser.parse_args()
        input_paths = [Path(p) for p in args.inputs]
        output_path = Path(args.output)
    else:
        # 旧位置参数模式（向后兼容）
        if len(sys.argv) < 3:
            print("用法: merge_parquet.py <input1.parquet> [input2.parquet ...] <output.parquet>")
            print("  或: merge_parquet.py -i in1.parquet in2.parquet -o out.parquet [--dedup-key K --order-by EXPR]")
            sys.exit(1)
        input_paths = [Path(p) for p in sys.argv[1:-1]]
        output_path = Path(sys.argv[-1])
        args = argparse.Namespace(dedup_key=None, order_by=None, declared_branch=None)

    for p in input_paths:
        if not p.exists():
            print(f"❌ 输入文件不存在: {p}")
            sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if args.dedup_key:
        if not args.order_by:
            print("❌ --dedup-key 需配合 --order-by 使用")
            sys.exit(1)
        run_dedup(input_paths, output_path, args.dedup_key, args.order_by)
        # 多省 P3-B（codex 闸-2 P1）：dedup 合并后 re-derive，覆盖来自历史 latest 的 NULL 派生
        if args.declared_branch:
            reapply_registry_derivations(output_path, args.declared_branch)
    else:
        run_concat(input_paths, output_path)


if __name__ == "__main__":
    main()
