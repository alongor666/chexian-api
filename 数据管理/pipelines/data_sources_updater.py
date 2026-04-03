#!/usr/bin/env python3
"""
data-sources.json 自动更新工具

ETL 脚本完成后调用，更新对应域的 last_updated / row_count / field_count / data_range。

用法：
    from pipelines.data_sources_updater import update_data_sources
    update_data_sources('claims', row_count=815274, field_count=5, data_range='2024-01-01 ~ 2026-03-31')
"""

import json
from datetime import date
from pathlib import Path
from typing import Optional


DATA_SOURCES_PATH = Path(__file__).resolve().parent.parent / "data-sources.json"


def update_data_sources(
    domain_id: str,
    *,
    row_count: int,
    field_count: Optional[int] = None,
    data_range: Optional[str] = None,
) -> bool:
    """更新 data-sources.json 中指定域的元数据。

    Args:
        domain_id: 域 ID（如 'premium', 'claims', 'quotes_conversion'）
        row_count: 产出行数
        field_count: 产出字段数（可选）
        data_range: 数据范围字符串（如 '2024-01-01 ~ 2026-03-31'，可选）

    Returns:
        True 更新成功，False 域不存在或文件不存在
    """
    if not DATA_SOURCES_PATH.exists():
        print(f"  ⚠️ data-sources.json 不存在: {DATA_SOURCES_PATH}")
        return False

    try:
        config = json.loads(DATA_SOURCES_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"  ⚠️ data-sources.json 读取失败: {e}")
        return False

    # 查找目标域
    target = None
    for domain in config.get("domains", []):
        if domain.get("id") == domain_id:
            target = domain
            break

    if target is None:
        print(f"  ⚠️ data-sources.json 中未找到域 '{domain_id}'")
        return False

    # 更新字段
    target["last_updated"] = date.today().isoformat()
    target["row_count"] = row_count
    if field_count is not None:
        target["field_count"] = field_count
    if data_range is not None:
        target["data_range"] = data_range

    # 写回
    DATA_SOURCES_PATH.write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"  📋 data-sources.json 已更新: {domain_id} (rows={row_count:,}, updated={target['last_updated']})")
    return True
