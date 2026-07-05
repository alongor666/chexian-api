"""单测：dry-run 输出的同口径校验 SQL 与 build_source_rows() 结果一致（codex 审计 #2）。

这是端到端的 SQL 锚点测试 — 防止口径漂移。
"""
from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import create_renewal_tracker as crt  # noqa: E402
from sync_renewal import SyncConfig, build_source_rows  # noqa: E402


# 该测试需要本地 parquet 数据存在（目录存在但无 *.parquet 时同样跳过，如 worktree 只有元数据文件）
PARQUET_PATH = HERE.parents[1] / "warehouse" / "fact" / "policy" / "current"
_HAS_PARQUET = PARQUET_PATH.exists() and any(PARQUET_PATH.glob("*.parquet"))


@pytest.mark.skipif(not _HAS_PARQUET, reason="本地 parquet 不存在，CI 跳过")
def test_dryrun_sql_matches_build_source_rows_for_leshan_may_jun() -> None:
    """脚本聚合 vs DRYRUN_VALIDATION_SQL_TEMPLATE 必须每业务员行数 + 总保费严格一致。"""
    org, start, end = "乐山", "2026-05-01", "2026-06-30"

    # 1) 脚本路径
    rows = build_source_rows(SyncConfig(
        instance_name="test", org_level_3=org,
        insurance_type="商业保险",
        insurance_end_date_from=start, insurance_end_date_to=end,
        premium_gt=300.0, quote_window_start="2025-12-03",
    ))
    groups = crt.group_by_salesman(rows)
    script_summary = {
        s: (len(g), round(sum(float(r.get("prior_premium") or 0) for r in g), 2))
        for s, g in groups
    }

    # 2) 模板 SQL 路径
    sql = crt.DRYRUN_VALIDATION_SQL_TEMPLATE.format(
        policy_glob=str(PARQUET_PATH / "*.parquet"),
        org=org, start=start, end=end,
    )
    con = duckdb.connect(":memory:")
    sql_result = con.execute(sql).fetchall()
    sql_summary = {row[0]: (row[1], round(float(row[2]), 2)) for row in sql_result}

    assert script_summary == sql_summary, (
        f"脚本聚合 vs 模板 SQL 不一致！\n"
        f"脚本: {script_summary}\n"
        f"SQL:  {sql_summary}\n"
        f"差异: {set(script_summary.items()) ^ set(sql_summary.items())}"
    )
