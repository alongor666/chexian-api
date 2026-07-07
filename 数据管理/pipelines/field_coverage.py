#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
字段覆盖率报告生成器（B249）

目的：每日 ETL 结束后附带产出 `数据管理/knowledge/ai/field-coverage-report.json`，
按 字段 × 年份 记录「有效非空比例」「去重计数」「样本值」，把 Parquet 的真实覆盖情况
沉淀成机器可读事实源，解决 `fields.json` 的 description 注释易过时（如 fuel_type
注释"仅2020-2023有值"实际 2024-2026 也有覆盖）导致 AI 被误导、需额外跑 DuckDB
SELECT COUNT 验证的问题。

口径说明（与 codex 闸-1 对齐）：
  - 有效非空比例 effective_non_null_ratio：VARCHAR 列把 NULL 与去空格后空串/常见占位符
    （'NULL'/'null'/'nan'/'none'/'-'）都算空；数值/时间列仅排除 NULL。这是「真实可用覆盖」，
    比 DuckDB 原生 COUNT(col) 更严格，避免 AI 看到"有值"实则全是占位符。
  - 去重计数 distinct_count：低基数列用精确 COUNT(DISTINCT)；高基数列（如保单号/车架号）
    用 approx_count_distinct 并标 is_high_cardinality，避免内存放大。
  - 样本值 sample_values：默认只对低基数、非敏感列采样（按频次降序取前 N）。
    敏感列（保单号/车架号/车牌/赔案号/姓名/地址等）一律 sample_values=[] 且 redacted=true，
    严防 PII 泄露进知识库 JSON。
  - 年份锚点 year_anchor：policy 用 policy_date（签单日期）；claims_detail 用 report_time
    （报案时间）。JSON 中显式写出 anchor 字段，NULL 年份归入 "_UNKNOWN_YEAR"。

不变性（immutability）：所有聚合结果构造新 dict，不原地改对象。
分支隔离：本脚本只服务本地 AI 知识库，**不随 VPS 发布**；daily.mjs 仅在 SC 主流程末尾调用
（非 SC 省在 runPostEtlIntegrations 之前已 return，不会触发本脚本）。

用法：
  python3 数据管理/pipelines/field_coverage.py
  python3 数据管理/pipelines/field_coverage.py --domain policy
  python3 数据管理/pipelines/field_coverage.py --policy-glob '<glob>' --output /tmp/x.json   # 测试/smoke
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb

try:  # 数据管理 在 sys.path
    from pipelines.branch_paths import policy_current_glob
except ImportError:  # pipelines 目录在 sys.path（直跑脚本惯例）
    from branch_paths import policy_current_glob

# ============================================================================
# 路径常量（仿 diagnose_common.py，禁止硬编码绝对路径）
# ============================================================================
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
# 双布局自适应（branch_paths SSOT · 801409 cutover 前置）：全量口径（跨省，覆盖率统计）
DEFAULT_POLICY_GLOB = policy_current_glob(
    PROJECT_ROOT / "数据管理/warehouse/fact/policy/current", missing_ok=True
)
DEFAULT_CLAIMS_GLOB = str(PROJECT_ROOT / "数据管理/warehouse/fact/claims_detail/claims_*.parquet")
DEFAULT_OUTPUT = str(PROJECT_ROOT / "数据管理/knowledge/ai/field-coverage-report.json")
FIELDS_JSON = PROJECT_ROOT / "server/src/config/field-registry/fields.json"
REPAIR_FIELDS_JSON = PROJECT_ROOT / "server/src/config/field-registry/repair-fields.json"

SCHEMA_VERSION = 1
UNKNOWN_YEAR = "_UNKNOWN_YEAR"
ALL_YEARS = "_ALL"

# 采样阈值：去重值数 <= 该值才视为低基数、可采样
LOW_CARDINALITY_THRESHOLD = 50
SAMPLE_TOP_N = 5
SAMPLE_VALUE_MAXLEN = 80

# 敏感列（物理列名）：一律不采样、标 redacted。与 fields.json 中的 PII 字段对齐 + 防御性扩列。
SENSITIVE_PHYSICAL_COLS = frozenset({
    "policy_no", "renewal_policy_no", "vehicle_frame_no", "plate_no",
    "subject_plate_no", "claim_no", "report_no", "endorsement_no",
    "salesman_name", "agent_name", "insured_gender",
    "accident_address", "accident_description",
})

# 字符串占位符（小写比较）：视为"空"
STRING_PLACEHOLDERS = ("null", "nan", "none", "-", "n/a", "na")

# 域配置：年份锚点字段
DOMAIN_CONFIG = {
    "policy": {"glob": DEFAULT_POLICY_GLOB, "year_anchor": "policy_date"},
    "claims_detail": {"glob": DEFAULT_CLAIMS_GLOB, "year_anchor": "report_time"},
}


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ingest_fields(mapping: dict, fields: list) -> None:
    """把一组字段定义合并进 mapping（按物理列名 id 索引；不原地改字段对象）。"""
    for f in fields:
        fid = f.get("id")
        if not fid or fid in mapping:
            continue
        mapping[fid] = {
            "field_id": fid,
            "label": f.get("label"),
            "source_column": f.get("sourceColumn"),
        }


def load_field_registry() -> dict:
    """合并读取多个字段注册表，建 物理列名->{field_id,label,source_column} 映射。

    物理列名是英文 id（见 PARQUET_SCHEMA_KNOWLEDGE）。合并 fields.json（保单/保费主表，
    顶层 `fields`）+ repair-fields.json（多域结构，顶层 `domains[].fields`），
    避免 subject_repair_shop 等已注册字段被误报为 unmapped（codex 闸-2 P2）。
    claims_detail 域目前无独立字段注册表（schema 见 claims_detail/SCHEMA.md），
    其未命中列如实标 unmapped。
    """
    mapping: dict = {}
    # 主表 fields.json
    if FIELDS_JSON.exists():
        try:
            data = json.loads(FIELDS_JSON.read_text(encoding="utf-8"))
            _ingest_fields(mapping, data.get("fields", []))
        except (json.JSONDecodeError, OSError):
            pass
    # 多域 repair-fields.json（domains 是 list，每项含 fields）
    if REPAIR_FIELDS_JSON.exists():
        try:
            data = json.loads(REPAIR_FIELDS_JSON.read_text(encoding="utf-8"))
            for dom in data.get("domains", []):
                _ingest_fields(mapping, dom.get("fields", []))
        except (json.JSONDecodeError, OSError):
            pass
    return mapping


def describe_columns(con, glob: str) -> list:
    """从 parquet 实读列清单 (name, type)，不假设 schema。"""
    rows = con.execute(
        f"SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM read_parquet(?, union_by_name=true))",
        [glob],
    ).fetchall()
    return [(r[0], r[1]) for r in rows]


def _quote_ident(name: str) -> str:
    """DuckDB 标识符转义：包裹双引号并转义内部双引号。"""
    return '"' + name.replace('"', '""') + '"'


def _is_string_type(col_type: str) -> bool:
    t = col_type.upper()
    return "CHAR" in t or "TEXT" in t or "STRING" in t


def _effective_non_null_expr(col_ident: str, col_type: str) -> str:
    """返回「有效非空」的布尔 SQL 表达式（1=有效非空）。

    VARCHAR：NULL 或 去空格空串 或 占位符 → 视为空。
    其他类型：仅 NULL 视为空。
    """
    if _is_string_type(col_type):
        placeholders = ", ".join(f"'{p}'" for p in STRING_PLACEHOLDERS)
        return (
            f"({col_ident} IS NOT NULL "
            f"AND TRIM({col_ident}) <> '' "
            f"AND LOWER(TRIM({col_ident})) NOT IN ({placeholders}))"
        )
    return f"({col_ident} IS NOT NULL)"


def _year_expr(anchor: str) -> str:
    """年份桶表达式：anchor 为 NULL → UNKNOWN_YEAR，否则 YEAR(anchor) 字符串。"""
    a = _quote_ident(anchor)
    return f"CASE WHEN {a} IS NULL THEN '{UNKNOWN_YEAR}' ELSE CAST(YEAR({a}) AS VARCHAR) END"


def _truncate(s, maxlen: int = SAMPLE_VALUE_MAXLEN) -> str:
    text = str(s)
    return text if len(text) <= maxlen else text[: maxlen - 1] + "…"


def _repo_relative(glob: str) -> str:
    """把 glob 路径转成相对 PROJECT_ROOT 的形式，避免把本机绝对路径写进提交的 JSON
    （codex 闸-2 P1）。无法相对化（如测试 /tmp 路径）时回落 basename。
    """
    try:
        return str(Path(glob).resolve().relative_to(PROJECT_ROOT))
    except (ValueError, OSError):
        # 测试/smoke 用外部路径：不泄露完整绝对路径，仅保留文件名模式
        return Path(glob).name


def compute_domain(con, domain: str, glob: str, year_anchor: str, registry: dict) -> dict:
    """计算单域字段覆盖率。返回新 dict（不原地改）。"""
    started = time.time()
    warnings = []

    columns = describe_columns(con, glob)
    col_names = [c[0] for c in columns]
    if year_anchor not in col_names:
        warnings.append(f"年份锚点字段 '{year_anchor}' 不在列清单中，全部归入 {UNKNOWN_YEAR}")

    total_rows = con.execute(f"SELECT COUNT(*) FROM read_parquet(?, union_by_name=true)", [glob]).fetchone()[0]

    # 年份清单（按锚点）
    if year_anchor in col_names:
        year_rows = con.execute(
            f"SELECT {_year_expr(year_anchor)} AS y, COUNT(*) FROM read_parquet(?, union_by_name=true) GROUP BY 1 ORDER BY 1",
            [glob],
        ).fetchall()
        years = [str(r[0]) for r in year_rows]
        year_row_counts = {str(r[0]): r[1] for r in year_rows}
    else:
        years = [UNKNOWN_YEAR]
        year_row_counts = {UNKNOWN_YEAR: total_rows}

    # 数据范围（锚点 min/max）
    data_range = None
    if year_anchor in col_names:
        a = _quote_ident(year_anchor)
        mn, mx = con.execute(
            f"SELECT MIN({a}), MAX({a}) FROM read_parquet(?, union_by_name=true)", [glob]
        ).fetchone()
        data_range = {
            "anchor": year_anchor,
            "min": _truncate(mn) if mn is not None else None,
            "max": _truncate(mx) if mx is not None else None,
        }

    fields_out = {}
    unmapped = []

    for col_name, col_type in sorted(columns, key=lambda c: c[0]):
        col_ident = _quote_ident(col_name)
        reg = registry.get(col_name)
        if reg is None:
            unmapped.append(col_name)
        sensitive = col_name in SENSITIVE_PHYSICAL_COLS
        nn_expr = _effective_non_null_expr(col_ident, col_type)
        # 去重只统计「有效非空」值：把空串/占位符排除，否则会把占位符算成一个真实值
        # 误导 AI（codex 闸-2 P1）。effective_value = nn_expr 为真时取原值，否则 NULL。
        effective_value = f"CASE WHEN {nn_expr} THEN {col_ident} END"

        # 整体去重基数先判低/高（决定精确 vs 近似 + 是否采样）
        approx_distinct_all = con.execute(
            f"SELECT approx_count_distinct({effective_value}) FROM read_parquet(?, union_by_name=true)", [glob]
        ).fetchone()[0] or 0
        is_high_card = approx_distinct_all > LOW_CARDINALITY_THRESHOLD

        per_year = {}
        # _ALL 桶 + 每年桶，用单条 SQL 按年聚合（COUNT(*) / 有效非空数 / 去重数）
        if year_anchor in col_names:
            group_expr = _year_expr(year_anchor)
            if is_high_card:
                distinct_sel = f"approx_count_distinct({effective_value})"
            else:
                distinct_sel = f"COUNT(DISTINCT {effective_value})"
            rows = con.execute(
                f"""
                SELECT {group_expr} AS y,
                       COUNT(*) AS total,
                       SUM(CASE WHEN {nn_expr} THEN 1 ELSE 0 END) AS non_null,
                       {distinct_sel} AS distinct_cnt
                FROM read_parquet(?, union_by_name=true)
                GROUP BY 1
                """,
                [glob],
            ).fetchall()
            agg_by_year = {str(r[0]): (r[1], r[2], r[3]) for r in rows}
        else:
            distinct_sel = (
                f"approx_count_distinct({effective_value})" if is_high_card
                else f"COUNT(DISTINCT {effective_value})"
            )
            r = con.execute(
                f"""
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN {nn_expr} THEN 1 ELSE 0 END) AS non_null,
                       {distinct_sel} AS distinct_cnt
                FROM read_parquet(?, union_by_name=true)
                """,
                [glob],
            ).fetchone()
            agg_by_year = {UNKNOWN_YEAR: (r[0], r[1], r[2])}

        # _ALL 汇总
        all_total = total_rows
        all_nn = sum(v[1] or 0 for v in agg_by_year.values())
        if is_high_card:
            all_distinct = con.execute(
                f"SELECT approx_count_distinct({effective_value}) FROM read_parquet(?, union_by_name=true)", [glob]
            ).fetchone()[0] or 0
        else:
            all_distinct = con.execute(
                f"SELECT COUNT(DISTINCT {effective_value}) FROM read_parquet(?, union_by_name=true)", [glob]
            ).fetchone()[0] or 0

        # 样本值采样的安全边界（codex 闸-2 P1）：默认仅对「已注册 + 非敏感 + 低基数」字段采样。
        # 未注册（unmapped）物理列默认不采样——上游若新增 owner_name/phone/id_no 等未登记 PII 字段，
        # 在进注册表并人工核对前，绝不把样本值写进知识库 JSON（fail-safe，宁可少采样不泄露）。
        sample_values = []
        redacted = sensitive or (reg is None)
        if (reg is not None) and (not sensitive) and (not is_high_card) and all_distinct > 0:
            srows = con.execute(
                f"""
                SELECT CAST({col_ident} AS VARCHAR) AS v, COUNT(*) AS c
                FROM read_parquet(?, union_by_name=true)
                WHERE {nn_expr}
                GROUP BY 1
                ORDER BY c DESC, v ASC
                LIMIT {SAMPLE_TOP_N}
                """,
                [glob],
            ).fetchall()
            sample_values = [_truncate(r[0]) for r in srows]

        def _bucket(total, non_null, distinct_cnt):
            ratio = round((non_null or 0) / total, 4) if total else 0.0
            b = {
                "total_rows": total,
                "non_null_rows": non_null or 0,
                "effective_non_null_ratio": ratio,
                "distinct_count": distinct_cnt or 0,
            }
            return b

        per_year[ALL_YEARS] = _bucket(all_total, all_nn, all_distinct)
        for y in years:
            t, nn, dc = agg_by_year.get(y, (year_row_counts.get(y, 0), 0, 0))
            per_year[y] = _bucket(t, nn, dc)

        field_entry = {
            "physical_column": col_name,
            "physical_type": col_type,
            "field_id": reg["field_id"] if reg else None,
            "label": reg["label"] if reg else None,
            "source_column": reg["source_column"] if reg else None,
            "registry_status": "registered" if reg else "unmapped",
            "is_high_cardinality": is_high_card,
            "distinct_method": "approx" if is_high_card else "exact",
            "redacted": redacted,
            "sample_values": sample_values,
            "by_year": per_year,
        }
        fields_out[col_name] = field_entry

    return {
        "available": True,
        "glob": _repo_relative(glob),
        "year_anchor": year_anchor,
        "total_rows": total_rows,
        "data_range": data_range,
        "years": [ALL_YEARS] + years,
        "fields": fields_out,
        "unmapped_fields": sorted(unmapped),
        "elapsed_ms": int((time.time() - started) * 1000),
        "warnings": warnings,
    }


def has_parquet(glob: str) -> bool:
    """glob 是否匹配到至少一个文件（DuckDB read_parquet 对空匹配会报错）。"""
    import glob as _glob

    return len(_glob.glob(glob)) > 0


def build_report(domains: dict, registry: dict) -> dict:
    """构造完整报告 dict（不原地改输入）。"""
    con = duckdb.connect()
    out_domains = {}
    overall_warnings = []
    for name, cfg in domains.items():
        glob = cfg["glob"]
        if not has_parquet(glob):
            out_domains[name] = {
                "available": False,
                "glob": _repo_relative(glob),
                "reason": "未匹配到 parquet 文件（可能在无数据的 worktree 中运行）",
            }
            overall_warnings.append(f"域 '{name}' 无 parquet，已跳过")
            continue
        out_domains[name] = compute_domain(con, name, glob, cfg["year_anchor"], registry)
    con.close()

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _now_utc_iso(),
        "generated_by": "数据管理/pipelines/field_coverage.py",
        "duckdb_version": duckdb.__version__,
        "note": (
            "本地 AI 知识库事实源：字段×年份真实覆盖率。不随 VPS 发布。"
            "敏感列已脱敏（redacted=true）。effective_non_null_ratio 把空串/占位符算空。"
        ),
        "domains": out_domains,
        "warnings": overall_warnings,
    }


def atomic_write_json(path: str, data: dict) -> None:
    """先写 .tmp 再 os.replace 原子替换，避免半截文件。"""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(p) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=False)
        fh.write("\n")
    os.replace(tmp, str(p))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="字段覆盖率报告生成器（B249）")
    parser.add_argument("--domain", choices=["policy", "claims_detail"], help="只跑指定域")
    parser.add_argument("--policy-glob", help="覆盖 policy parquet glob（测试/smoke）")
    parser.add_argument("--claims-glob", help="覆盖 claims_detail parquet glob（测试/smoke）")
    parser.add_argument("--output", help="覆盖输出路径（测试/smoke）")
    parser.add_argument(
        "--allow-empty-output",
        action="store_true",
        help="即使所有域都无数据也写出（默认：全空则不覆盖已有报告）",
    )
    args = parser.parse_args(argv)

    # 构造域配置（不原地改全局 DOMAIN_CONFIG）
    domains = {}
    for name, cfg in DOMAIN_CONFIG.items():
        if args.domain and args.domain != name:
            continue
        glob = cfg["glob"]
        if name == "policy" and args.policy_glob:
            glob = args.policy_glob
        if name == "claims_detail" and args.claims_glob:
            glob = args.claims_glob
        domains[name] = {"glob": glob, "year_anchor": cfg["year_anchor"]}

    output = args.output or DEFAULT_OUTPUT

    report = build_report(domains, load_field_registry())

    any_available = any(d.get("available") for d in report["domains"].values())
    if not any_available and not args.allow_empty_output:
        # 防污染：全空时不覆盖已有好报告（codex 闸-1 P1）
        print(
            "[field_coverage] 所有域均无 parquet 数据，跳过写出（不覆盖已有报告）。"
            "如需强制写空报告用 --allow-empty-output。",
            file=sys.stderr,
        )
        return 0

    atomic_write_json(output, report)
    avail = [n for n, d in report["domains"].items() if d.get("available")]
    print(f"[field_coverage] 已生成 {output}（可用域: {', '.join(avail) or '无'}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
