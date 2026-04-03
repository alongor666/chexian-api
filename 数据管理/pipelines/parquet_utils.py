#!/usr/bin/env python3
"""
统一 Parquet 写出工具 — 自动注入 L1 文件级 metadata

所有 ETL 脚本写 Parquet 时必须调用此模块，确保每个 .parquet 文件都有：
  - etl_generated_at: ISO 时间戳
  - etl_row_count: 行数
  - etl_source_file: 源文件名（可选）
  - etl_processing_mode: 处理模式（可选）

读取 metadata（不加载数据，毫秒级）：
  import pyarrow.parquet as pq
  meta = pq.read_metadata('output.parquet')
  print(meta.metadata)
"""

from datetime import datetime
from pathlib import Path
from typing import Optional, Union

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


def write_parquet_with_metadata(
    data: Union[pa.Table, pd.DataFrame],
    output_path: Union[str, Path],
    *,
    source_file: Optional[str] = None,
    processing_mode: Optional[str] = None,
    compression: str = "snappy",
    extra_metadata: Optional[dict] = None,
) -> pa.Table:
    """统一 Parquet 写出，自动注入 L1 metadata。

    Args:
        data: pyarrow Table 或 pandas DataFrame
        output_path: 输出路径
        source_file: 源文件名
        processing_mode: 处理模式标识
        compression: 压缩算法（默认 snappy）
        extra_metadata: 额外 key-value 对

    Returns:
        写入的 pyarrow Table（含 metadata）
    """
    if isinstance(data, pd.DataFrame):
        table = pa.Table.from_pandas(data, preserve_index=False)
    else:
        table = data

    meta = dict(table.schema.metadata or {})
    meta[b"etl_generated_at"] = datetime.now().isoformat().encode("utf-8")
    meta[b"etl_row_count"] = str(len(table)).encode("utf-8")

    if source_file:
        meta[b"etl_source_file"] = str(source_file).encode("utf-8")
    if processing_mode:
        meta[b"etl_processing_mode"] = str(processing_mode).encode("utf-8")
    if extra_metadata:
        for k, v in extra_metadata.items():
            key = k.encode("utf-8") if isinstance(k, str) else k
            val = str(v).encode("utf-8") if not isinstance(v, bytes) else v
            meta[key] = val

    table = table.replace_schema_metadata(meta)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, str(output_path), compression=compression)

    return table


def read_parquet_metadata(path: Union[str, Path]) -> dict:
    """读取 Parquet 文件的 L1 metadata（不加载数据）。

    Returns:
        dict，key/value 均为 str
    """
    meta = pq.read_metadata(str(path))
    if meta.metadata is None:
        return {}
    return {k.decode("utf-8"): v.decode("utf-8") for k, v in meta.metadata.items()}
