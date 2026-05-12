#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
品牌维度表兼容检查器。

当前 `warehouse/dim/brand/latest.parquet` 的权威来源是 `06_厂牌明细*.xlsx`，
经 `数据管理/pipelines/convert_brand_dim.py` / `node 数据管理/daily.mjs brand`
生成。历史版本曾从保单 `vehicle_model` 字符串提取 `brand_usage`，
该 schema 已废弃，不能再覆盖 `latest.parquet`。
"""

from pathlib import Path
import sys

try:
    import duckdb
except ImportError:
    print("错误: pip3 install duckdb")
    sys.exit(1)


SCRIPT_DIR = Path(__file__).resolve().parent
DIM_PATH = SCRIPT_DIR / "latest.parquet"
REQUIRED_COLUMNS = {
    "manufacturer",
    "vehicle_model_code",
    "vehicle_model_name",
    "brand",
    "vehicle_class",
}


def generate() -> None:
    """只校验当前厂牌明细 parquet，不再生成旧 schema。"""
    if not DIM_PATH.exists():
        raise RuntimeError(
            "品牌维度表不存在；请运行 `node 数据管理/daily.mjs brand` "
            "或 `python3 数据管理/pipelines/convert_brand_dim.py`"
        )

    con = duckdb.connect()
    try:
        cols = [c[0] for c in con.execute(f"SELECT name FROM parquet_schema('{DIM_PATH}')").fetchall()]
        missing = sorted(REQUIRED_COLUMNS - set(cols))
        if missing:
            raise RuntimeError(
                f"品牌维度表 schema 过期，缺少字段: {missing}；"
                "请用 `node 数据管理/daily.mjs brand` 重新生成"
            )
        count = con.execute(f"SELECT COUNT(*) FROM read_parquet('{DIM_PATH}')").fetchone()[0]
    finally:
        con.close()

    print(f"✅ 品牌维度表 schema 正常: {DIM_PATH} ({count:,d} 条)")


if __name__ == "__main__":
    generate()
