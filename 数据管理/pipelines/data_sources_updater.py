#!/usr/bin/env python3
"""
data-sources-status.json 自动更新工具

ETL 脚本完成后调用，更新对应域的运行时状态 last_updated / row_count / field_count / data_range。

背景（B314）：data-sources.json 是入库的契约文件（域定义/路径/字段清单等静态信息），
运行时状态字段拆分到 data-sources-status.json（gitignored，ETL 自动生成，缺失时首跑自动创建）。
契约文件本身不再被本模块写入。

用法：
    from pipelines.data_sources_updater import update_data_sources
    update_data_sources('claims', row_count=815274, field_count=5, data_range='2024-01-01 ~ 2026-03-31')
"""

import json
import os
import time
from datetime import date
from pathlib import Path
from typing import Optional


DATA_SOURCES_PATH = Path(__file__).resolve().parent.parent / "data-sources.json"
DATA_SOURCES_STATUS_PATH = Path(__file__).resolve().parent.parent / "data-sources-status.json"

# 状态文件缺失或损坏时的空骨架
_STATUS_SKELETON_COMMENT = (
    "数据域运行时状态（ETL 自动生成，不入 git；缺失时首跑 ETL 自动创建）。契约见 data-sources.json。"
)


def _empty_status_skeleton() -> dict:
    """返回状态文件的空骨架（新 dict，不复用任何已有引用）。"""
    return {"_comment": _STATUS_SKELETON_COMMENT, "domains": {}}


def _read_status(status_path: Path) -> dict:
    """读取状态文件；缺失或损坏时返回空骨架（不抛异常，状态文件是可再生产物）。"""
    if not status_path.exists():
        return _empty_status_skeleton()
    try:
        loaded = json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _empty_status_skeleton()
    if not isinstance(loaded, dict) or "domains" not in loaded:
        return _empty_status_skeleton()
    return loaded


def _atomic_write_json(target_path: Path, payload: dict) -> None:
    """原子写：先写临时文件，再 os.replace() 落地，避免写到一半被读到半截文件。

    临时文件名含 pid+时间戳（与 Node 侧 数据管理/lib/data-sources-status.mjs 同约定）：
    多进程并发写时避免共享同一 tmp 名产生"后写截断前写"竞态。
    """
    tmp_path = target_path.with_suffix(
        f"{target_path.suffix}.tmp-{os.getpid()}-{int(time.time() * 1000)}"
    )
    tmp_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp_path, target_path)


def write_data_sources_status(
    domain_id: str,
    *,
    row_count: Optional[int] = None,
    field_count: Optional[int] = None,
    data_range: Optional[str] = None,
    last_updated: Optional[str] = None,
    status_path: Optional[Path] = None,
) -> dict:
    """更新 data-sources-status.json 中指定域的运行时状态。

    只设置非 None 的键；已存在但本次未传入的键保持不变（增量覆盖，非整条替换）。
    last_updated 为 None 时默认取今天日期。

    Args:
        domain_id: 域 ID（如 'premium', 'claims', 'quotes_conversion'）
        row_count: 产出行数（可选）
        field_count: 产出字段数（可选）
        data_range: 数据范围字符串（如 '2024-01-01 ~ 2026-03-31'，可选）
        last_updated: 更新日期（可选，默认今天）
        status_path: 状态文件路径（可选，默认 DATA_SOURCES_STATUS_PATH，测试用于注入 tmp_path）

    Returns:
        写入后该域的状态条目 dict（新对象）
    """
    target_path = status_path if status_path is not None else DATA_SOURCES_STATUS_PATH

    status = _read_status(target_path)
    domains = dict(status.get("domains", {}))
    existing_entry = dict(domains.get(domain_id, {}))

    new_entry = dict(existing_entry)
    new_entry["last_updated"] = last_updated if last_updated is not None else date.today().isoformat()
    if row_count is not None:
        new_entry["row_count"] = row_count
    if field_count is not None:
        new_entry["field_count"] = field_count
    if data_range is not None:
        new_entry["data_range"] = data_range

    domains[domain_id] = new_entry
    new_status = dict(status)
    new_status["domains"] = domains

    _atomic_write_json(target_path, new_status)
    return new_entry


def read_merged_domains(
    data_sources_path: Optional[Path] = None,
    status_path: Optional[Path] = None,
) -> list:
    """读取契约域列表 + 状态 map，返回合并后的新列表。

    合并语义：每个域 = 契约 dict 浅拷贝，再被状态文件中同名域的条目覆盖
    （status 优先；契约中的旧状态字段作为"冻结快照兜底"，用于 deprecated /
    upstream_status 停更域没有状态条目的场景）。

    Args:
        data_sources_path: 契约文件路径（可选，默认 DATA_SOURCES_PATH）
        status_path: 状态文件路径（可选，默认 DATA_SOURCES_STATUS_PATH）

    Returns:
        合并后的域 dict 新列表

    Raises:
        FileNotFoundError / json.JSONDecodeError: 契约文件是硬依赖，缺失或损坏直接抛出
    """
    contract_path = data_sources_path if data_sources_path is not None else DATA_SOURCES_PATH
    target_status_path = status_path if status_path is not None else DATA_SOURCES_STATUS_PATH

    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    status = _read_status(target_status_path)
    status_domains = status.get("domains", {})

    merged = []
    for domain in contract.get("domains", []):
        merged_domain = dict(domain)
        domain_id = merged_domain.get("id")
        if domain_id in status_domains:
            merged_domain.update(status_domains[domain_id])
        merged.append(merged_domain)
    return merged


def update_data_sources(
    domain_id: str,
    *,
    row_count: int,
    field_count: Optional[int] = None,
    data_range: Optional[str] = None,
) -> bool:
    """更新指定域的运行时状态（写入 data-sources-status.json，不再写契约文件）。

    仍读契约文件校验 domain_id 是否存在——契约是域的唯一注册表，未注册的
    domain_id 视为调用方错误，照旧打印警告并 return False。

    Args:
        domain_id: 域 ID（如 'premium', 'claims', 'quotes_conversion'）
        row_count: 产出行数
        field_count: 产出字段数（可选）
        data_range: 数据范围字符串（如 '2024-01-01 ~ 2026-03-31'，可选）

    Returns:
        True 更新成功，False 域不存在或契约文件不存在
    """
    if not DATA_SOURCES_PATH.exists():
        print(f"  ⚠️ data-sources.json 不存在: {DATA_SOURCES_PATH}")
        return False

    try:
        config = json.loads(DATA_SOURCES_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"  ⚠️ data-sources.json 读取失败: {e}")
        return False

    # 查找目标域（校验用，契约文件本身不会被修改）
    target = None
    for domain in config.get("domains", []):
        if domain.get("id") == domain_id:
            target = domain
            break

    if target is None:
        print(f"  ⚠️ data-sources.json 中未找到域 '{domain_id}'")
        return False

    entry = write_data_sources_status(
        domain_id,
        row_count=row_count,
        field_count=field_count,
        data_range=data_range,
    )
    print(
        f"  📋 data-sources-status.json 已更新: {domain_id} "
        f"(rows={row_count:,}, updated={entry['last_updated']})"
    )
    return True
