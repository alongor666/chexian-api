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
    """防 SQL 注入：仅允许字母数字下划线和有限关键字"""
    allowed_keywords = {"ASC", "DESC", "NULLS", "LAST", "FIRST", ","}
    for part in value.replace(",", " , ").split():
        if part.upper() in allowed_keywords:
            continue
        if not part.replace("_", "").isalnum():
            print(f"❌ 非法 {label}: {value}（仅允许字母数字下划线 + ASC/DESC/NULLS LAST）")
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
        args = argparse.Namespace(dedup_key=None, order_by=None)

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
    else:
        run_concat(input_paths, output_path)


if __name__ == "__main__":
    main()
