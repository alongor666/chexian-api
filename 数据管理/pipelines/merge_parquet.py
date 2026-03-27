#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高性能 Parquet 合并工具（pyarrow columnar concat）

用法:
  python3 merge_parquet.py <file1.parquet> <file2.parquet> ... <output.parquet>

最后一个参数为输出文件，其余为输入文件（按顺序合并）。
"""

import sys
import time
import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.types as patypes
from pathlib import Path


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


def main():
    if len(sys.argv) < 3:
        print("用法: merge_parquet.py <input1.parquet> [input2.parquet ...] <output.parquet>")
        sys.exit(1)

    input_paths = [Path(p) for p in sys.argv[1:-1]]
    output_path = Path(sys.argv[-1])

    for p in input_paths:
        if not p.exists():
            print(f"❌ 输入文件不存在: {p}")
            sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    start_ts = time.perf_counter()
    tables = []
    for p in input_paths:
        t = pq.read_table(p)
        print(f"   读取: {p.name}  {t.num_rows:,} 行 × {t.num_columns} 列")
        tables.append(t)

    target_schema = build_target_schema(tables)
    aligned_tables = [align_table(table, target_schema) for table in tables]
    merged = pa.concat_tables(aligned_tables, promote_options='default')
    pq.write_table(merged, output_path, compression='snappy')

    elapsed = time.perf_counter() - start_ts
    total_rows = sum(t.num_rows for t in tables)
    print(f"✅ 合并完成: {total_rows:,} 行 → {output_path.name}（{elapsed:.2f}s）")


if __name__ == "__main__":
    main()
