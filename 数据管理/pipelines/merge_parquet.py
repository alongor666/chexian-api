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
from pathlib import Path


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

    # promote_options='default' 允许类型兼容提升（如 int32 → int64）
    merged = pa.concat_tables(tables, promote_options='default')
    pq.write_table(merged, output_path, compression='snappy')

    elapsed = time.perf_counter() - start_ts
    total_rows = sum(t.num_rows for t in tables)
    print(f"✅ 合并完成: {total_rows:,} 行 → {output_path.name}（{elapsed:.2f}s）")


if __name__ == "__main__":
    main()
