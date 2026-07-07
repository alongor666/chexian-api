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

# Phase 4：可信域回填复用 derived_fields 的 guarded helper（与各域 ETL 同一物化路径）。
# 同时支持「作为脚本直跑」（pipelines/ 在 sys.path[0]）与「作为 pipelines.* 包导入」（测试）两种上下文。
try:
    from pipelines.derived_fields import apply_derived_fields
    from pipelines.branch_paths import policy_current_files
except ImportError:  # pragma: no cover - 脚本直跑路径
    from derived_fields import apply_derived_fields
    from branch_paths import policy_current_files

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


def apply_guarded_backfill(
    df: pd.DataFrame, field: dict, force: bool, declared_branch: str | None
) -> tuple[pd.DataFrame, str]:
    """Phase 4：强校验派生字段（branch_code）的「可信域感知」回填（codex 闸-1 P1.3）。

    数据驱动判定（不硬编码域路径）：仅对 policy_no 完整 + 单一已知省份的「可信域」物化；
    不可信域 skip；看似可信但混省 / 未知前缀 / 声明省≠推断省 → error（本轮非零退出）。

    各域 ETL 已落 branch_code 物化（premium/claims_detail/cross_sell/customer_flow 直接喂；
    quotes warn 模式；renewal_tracker 造临时列；new_energy_claims VIN-JOIN）；本通用 backfill
    只承担「policy_no 可信域」的历史补列，不触碰 quotes/new_energy/renewal_tracker/dim 等不可信域。
    """
    fid = field["id"]
    rule = field.get("derivation", {})
    rtype = rule.get("type")

    if rtype != "prefix_map":
        return df, f"skip({fid}: 强校验字段仅支持 prefix_map 回填，实际 {rtype})"

    source = rule.get("source")
    if not source or source not in df.columns:
        # 无 source 列（renewal_tracker 无 policy_no / dim 表 repair·brand）→ 交域专用 ETL
        return df, f"skip({fid}: 无 source 列 {source}，须域专用 ETL 回填（非 policy_no 可信域）)"

    if fid in df.columns and not force:
        nonnull = int(df[fid].notna().sum())
        return df, f"skip({fid}: already exists, {nonnull:,} non-null, use --force to overwrite)"

    if len(df) == 0:
        # 空分片（0 行）：无可派生，结构化 skip（不让 provinces[0] 抛 IndexError · codex 闸-2 P2.1）
        return df, f"skip({fid}: 空数据（0 行），无可派生)"

    prefix_len = rule.get("prefixLength", 2)
    mapping = rule.get("mapping", {})
    src = df[source].astype(str)
    # 不可信域：policy_no 含 NULL / 空 / 'nan' 字面（quotes 92.5% / new_energy 100%）→ skip
    empty_mask = df[source].isna() | (src.str.strip() == "") | (src.str.lower() == "nan")
    if bool(empty_mask.any()):
        return df, (
            f"skip({fid}: {source} 有 {int(empty_mask.sum()):,} 行 NULL/空，"
            f"不可信域（VIN-JOIN / warn 模式），须域专用回填)"
        )

    mapped = src.str[:prefix_len].map(mapping)
    unknown_mask = mapped.isna()
    if bool(unknown_mask.any()):
        bad = src[unknown_mask].str[:prefix_len].value_counts().head(5).to_dict()
        return df, (
            f"error({fid}: {int(unknown_mask.sum()):,} 行 {source}[:{prefix_len}] 未命中 mapping "
            f"值域 {sorted(mapping)}，top5={bad} — 疑似数据损坏，fail-closed)"
        )

    provinces = sorted(set(mapped.unique()))
    if len(provinces) > 1:
        return df, (
            f"error({fid}: 单文件混省 {provinces} — 违反单文件不混省契约，fail-closed)"
        )

    inferred = provinces[0]
    if declared_branch and declared_branch != inferred:
        return df, (
            f"error({fid}: 声明省={declared_branch} ≠ 推断省={inferred} — 疑似喂错省，fail-closed)"
        )

    # 可信域：复用 derived_fields.apply_derived_fields 物化（与各域 ETL 同一 guarded 路径）。
    # 已预校验非空 + 单省 + 已知前缀 + 声明一致 → guard 不会 sys.exit；try 兜底防御（codex P2 #1c）。
    try:
        apply_derived_fields(df, [field], declared_branch=inferred)
    except SystemExit:  # pragma: no cover - 预校验后不应触发
        return df, f"error({fid}: guarded helper fail-fast（预校验外的意外），fail-closed)"
    nonnull = int(df[fid].notna().sum())
    return df, f"ok({fid}: 可信域派生 '{inferred}'，{nonnull:,}/{len(df):,} non-null)"


def apply_derivation(
    df: pd.DataFrame, field: dict, force: bool, declared_branch: str | None = None
) -> tuple[pd.DataFrame, str]:
    """对 DataFrame 应用单个派生规则。返回 (新 df, 状态描述)。

    status 约定：以 `ok(` / `skip(` / `error(` 开头。`error(` 表示数据损坏（混省 / 未知前缀 /
    声明不符），由 main() 聚合后令本轮非零退出（fail-closed）。
    """
    fid = field["id"]
    rule = field.get("derivation", {})
    rtype = rule.get("type")

    # 强校验派生字段（branch_code：strictNonNull / assertDeclaredBranch）走可信域感知回填。
    # 各域 ETL 仍是物化主路径（premium/claims/cross_sell/customer_flow/quotes/renewal/new_energy）；
    # 本 backfill 只补「policy_no 可信域」历史列，不可信域 skip、数据损坏 error。
    if rule.get("strictNonNull") or rule.get("assertDeclaredBranch"):
        return apply_guarded_backfill(df, field, force, declared_branch)

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


def backfill_parquet(
    path: Path, derived_fields: list[dict], force: bool, dry_run: bool,
    declared_branch: str | None = None,
) -> dict:
    """处理单个 Parquet 文件。"""
    table = pq.read_table(path)
    df = table.to_pandas()
    original_cols = set(df.columns)
    statuses = []

    for field in derived_fields:
        df, status = apply_derivation(df, field, force, declared_branch)
        statuses.append(status)

    # 数据损坏（error 状态）→ 拒绝写回该文件（不物化半成品），交 main 聚合非零退出
    has_error = any(s.startswith("error(") for s in statuses)
    if has_error:
        return {"path": path.name, "changed": False, "error": True, "statuses": statuses}

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
    parser.add_argument(
        "--branch-code",
        type=str,
        default=None,
        help="声明省份代码（如 SC/SX），对强校验字段（branch_code）断言「声明省 == 推断省」；"
             "不传则用文件内单一推断省（codex 闸-1 P1.3）",
    )
    args = parser.parse_args()
    declared_branch = (args.branch_code or "").strip().upper() or None

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

    # 默认扫 policy/current（非递归）走 branch_paths SSOT 双布局自适应（801409 cutover 前置）：
    # 扁平顶层或 current/<省>/ 子目录都能枚举到，0 文件 fail-closed（禁静默空结果）。
    # 显式 --path 或 --recursive（多域一次性 backfill）仍走通用 collect_parquet_files。
    if not args.path and not args.recursive:
        parquet_files = [Path(p) for p in policy_current_files(scan_root)]
    else:
        parquet_files = collect_parquet_files(scan_root, args.recursive)
    rel = scan_root.relative_to(ROOT) if scan_root.is_relative_to(ROOT) else scan_root
    suffix = "（递归）" if args.recursive else ""
    print(f"\n📁 扫描 {rel}{suffix}: {len(parquet_files)} 个分片\n")

    if not parquet_files:
        print("⚠️  无分片文件")
        return 0

    if declared_branch:
        print(f"🏷  声明省份（--branch-code）: {declared_branch}（强校验字段将断言 声明省==推断省）\n")

    changed_count = 0
    error_count = 0
    total_rows = 0
    for path in parquet_files:
        result = backfill_parquet(path, derived_fields, args.force, args.dry_run, declared_branch)
        if result.get("error"):
            tag = "❌"
        elif result.get("dry_run"):
            tag = "DRY-RUN"
        elif result["changed"]:
            tag = "✅"
        else:
            tag = "⏭️ "
        display_path = path.relative_to(scan_root) if path.is_relative_to(scan_root) else path.name
        print(f"{tag} {display_path}")
        for s in result["statuses"]:
            print(f"       {s}")
        if result.get("error"):
            error_count += 1
        elif result["changed"]:
            changed_count += 1
            total_rows += result.get("rows", 0)

    print(f"\n{'=' * 60}")
    print(f"✅ 完成: {changed_count}/{len(parquet_files)} 分片已处理")
    if not args.dry_run and total_rows:
        print(f"   总记录数: {total_rows:,}")
    if args.dry_run:
        print("   (dry-run 模式，未实际写入)")
    if error_count:
        # fail-closed：数据损坏（混省 / 未知前缀 / 声明不符）→ 非零退出，不静默放行
        print(f"\n❌ {error_count}/{len(parquet_files)} 分片检出数据损坏（混省 / 未知前缀 / 声明不符）— 非零退出")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
