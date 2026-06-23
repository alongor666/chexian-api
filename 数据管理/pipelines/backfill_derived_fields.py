#!/usr/bin/env python3
"""
派生字段 backfill — 从 fields.json 读派生规则，应用到现有 Parquet 分片

用途：
  首次引入派生字段时，历史分片需要一次性补齐。未来新增分片由 transform.py 直接物化。

规则来源：
  server/src/config/field-registry/fields.json 中 derived:true 的字段

支持的 derivation.type：
  - prefix_map: 按源列前缀 N 位映射到系数
  - constant: 写入常量（envVar 优先于 defaultValue）
  注：强校验派生字段（branch_code）由 transform.py ETL 物化 + 自校验，本通用 backfill 一律拒绝

用法：
  python3 数据管理/pipelines/backfill_derived_fields.py           # 默认 policy/current
  python3 数据管理/pipelines/backfill_derived_fields.py --force   # 强制覆盖已存在的派生列
  python3 数据管理/pipelines/backfill_derived_fields.py --dry-run # 只打印计划不写入

  # 注：branch_code（强校验）由 transform.py 在 ETL 物化 + 自校验，本脚本拒绝回填强校验字段。

  # 指定单一目录（如山西数据落地后只补一类）：
  python3 数据管理/pipelines/backfill_derived_fields.py --path 数据管理/warehouse/dim/salesman

扫描目录：默认 数据管理/warehouse/fact/policy/current/*.parquet；可通过 --path 覆盖。
"""

import argparse
import json
import os
import sys
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent.parent
REGISTRY_PATH = ROOT / "server/src/config/field-registry/fields.json"
POLICY_CURRENT = ROOT / "数据管理/warehouse/fact/policy/current"

# 递归扫描时跳过的目录前缀（备份/分片中间态/缓存）
EXCLUDED_DIR_PARTS = {"__pycache__", "staging"}
EXCLUDED_DIR_PREFIXES = (".backup", ".dup-archive")


def load_derived_rules() -> list[dict]:
    """读 fields.json 返回 derived:true 的字段列表。"""
    with open(REGISTRY_PATH) as f:
        registry = json.load(f)
    return [fd for fd in registry.get("fields", []) if fd.get("derived")]


def apply_derivation(df: pd.DataFrame, field: dict, force: bool) -> tuple[pd.DataFrame, str]:
    """对 DataFrame 应用单个派生规则。返回 (新 df, 状态描述)。"""
    fid = field["id"]
    rule = field.get("derivation", {})
    rtype = rule.get("type")

    # 强校验派生字段（branch_code：strictNonNull / assertDeclaredBranch）由 transform.py 在 ETL
    # 物化时做完整 fail-fast 自校验（喂错省/混省/NULL/源列缺失）。通用 backfill 无声明省上下文、
    # 且写回层按「是否新增列」判定（codex 闸-2 r2/r3），无法完整复刻该契约 → 一律拒绝回填强校验
    # 字段，避免静默绕过契约（RLS 等值过滤漏行）。域感知强校验回填（含混省检测 + 域白名单）留 Phase 4。
    if rule.get("strictNonNull") or rule.get("assertDeclaredBranch"):
        # 一律 skip（不处理/不写回），交 transform.py（ETL 物化 + 完整自校验）/ Phase 4 域感知回填。
        # 用 skip 而非 sys.exit：避免按全量字段跑时一遇 branch_code 就杀掉整轮、连带丢失其它字段回填。
        return df, f"skip({fid}: 强校验派生字段，通用 backfill 不支持，由 transform.py 物化 / Phase 4 域感知回填)"

    if fid in df.columns and not force:
        nonnull = df[fid].notna().sum()
        return df, f"skip({fid}: already exists, {nonnull:,} non-null, use --force to overwrite)"

    if rtype == "prefix_map":
        source = rule.get("source")
        if not source or source not in df.columns:
            return df, f"skip({fid}: source {source} missing)"
        prefix_len = rule.get("prefixLength", 2)
        mapping = rule.get("mapping", {})
        default_value = rule.get("defaultValue")
        df[fid] = df[source].astype(str).str[:prefix_len].map(mapping)
        if default_value is not None:
            df[fid] = df[fid].fillna(default_value)
        nonnull = df[fid].notna().sum()
        return df, f"ok({fid}: {nonnull:,}/{len(df):,} non-null)"

    if rtype == "constant":
        env_var = rule.get("envVar")
        env_value = os.environ.get(env_var) if env_var else None
        value = env_value if env_value else rule.get("defaultValue")
        if value is None:
            return df, f"skip({fid}: constant 无 envVar={env_var} 命中且无 defaultValue)"
        df[fid] = value
        hint = f"envVar={env_var}" if env_value else "defaultValue"
        return df, f"ok({fid}: 常量 '{value}' ({hint}), {len(df):,} rows)"

    return df, f"skip({fid}: unsupported derivation.type={rtype})"


def backfill_parquet(path: Path, derived_fields: list[dict], force: bool, dry_run: bool) -> dict:
    """处理单个 Parquet 文件。"""
    table = pq.read_table(path)
    df = table.to_pandas()
    original_cols = set(df.columns)
    statuses = []

    for field in derived_fields:
        df, status = apply_derivation(df, field, force)
        statuses.append(status)

    added_cols = set(df.columns) - original_cols
    if not added_cols and not force:
        return {"path": path.name, "changed": False, "statuses": statuses}

    if dry_run:
        return {"path": path.name, "changed": True, "dry_run": True, "statuses": statuses}

    # 重写 Parquet，合并原 L1 metadata（保留 etl_* 键）+ pyarrow 重建的 pandas metadata（反映新列）
    import pyarrow as pa

    new_table = pa.Table.from_pandas(df, preserve_index=False)
    fresh_metadata = dict(new_table.schema.metadata or {})
    original_metadata = dict(table.schema.metadata or {})
    for k, v in original_metadata.items():
        if k.startswith(b"etl_"):
            fresh_metadata[k] = v
    new_table = new_table.replace_schema_metadata(fresh_metadata)
    pq.write_table(new_table, str(path), compression="snappy")

    return {"path": path.name, "changed": True, "statuses": statuses, "rows": len(df)}


def is_excluded_dir(path: Path) -> bool:
    """判断目录是否应跳过（备份/staging/缓存）。"""
    for part in path.parts:
        if part in EXCLUDED_DIR_PARTS:
            return True
        if any(part.startswith(prefix) for prefix in EXCLUDED_DIR_PREFIXES):
            return True
    return False


def collect_parquet_files(root: Path, recursive: bool) -> list[Path]:
    """扫描目标目录下的 *.parquet 文件，跳过备份/staging/缓存。"""
    if not recursive:
        return sorted(p for p in root.glob("*.parquet") if not is_excluded_dir(p.parent))
    return sorted(p for p in root.rglob("*.parquet") if not is_excluded_dir(p.parent))


def main():
    parser = argparse.ArgumentParser(description="派生字段 backfill")
    parser.add_argument("--force", action="store_true", help="强制覆盖已存在的派生列")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划不写入")
    parser.add_argument(
        "--path",
        type=str,
        default=None,
        help="扫描目录（默认 数据管理/warehouse/fact/policy/current）",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="递归扫描子目录所有 *.parquet（用于多域 branch_code 一次性 backfill）",
    )
    args = parser.parse_args()

    derived_fields = load_derived_rules()
    if not derived_fields:
        print("⚠️  fields.json 中没有 derived:true 字段，退出")
        return 0

    print(f"📋 派生字段规则: {len(derived_fields)} 个")
    for fd in derived_fields:
        print(f"   - {fd['id']} ({fd.get('derivation', {}).get('type', '?')})")

    scan_root = Path(args.path).resolve() if args.path else POLICY_CURRENT
    if not scan_root.exists():
        print(f"❌ 扫描目录不存在: {scan_root}")
        return 1

    parquet_files = collect_parquet_files(scan_root, args.recursive)
    rel = scan_root.relative_to(ROOT) if scan_root.is_relative_to(ROOT) else scan_root
    suffix = "（递归）" if args.recursive else ""
    print(f"\n📁 扫描 {rel}{suffix}: {len(parquet_files)} 个分片\n")

    if not parquet_files:
        print("⚠️  无分片文件")
        return 0

    changed_count = 0
    total_rows = 0
    for path in parquet_files:
        result = backfill_parquet(path, derived_fields, args.force, args.dry_run)
        tag = "DRY-RUN" if result.get("dry_run") else ("✅" if result["changed"] else "⏭️ ")
        display_path = path.relative_to(scan_root) if path.is_relative_to(scan_root) else path.name
        print(f"{tag} {display_path}")
        for s in result["statuses"]:
            print(f"       {s}")
        if result["changed"]:
            changed_count += 1
            total_rows += result.get("rows", 0)

    print(f"\n{'=' * 60}")
    print(f"✅ 完成: {changed_count}/{len(parquet_files)} 分片已处理")
    if not args.dry_run and total_rows:
        print(f"   总记录数: {total_rows:,}")
    if args.dry_run:
        print("   (dry-run 模式，未实际写入)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
