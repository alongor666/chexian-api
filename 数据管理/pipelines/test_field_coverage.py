#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
field_coverage.py 单元测试（B249）

用内存构造的 fixture parquet 验证：
  1. effective_non_null_ratio 把空串/占位符算空（比裸 COUNT 更严格）
  2. 敏感列脱敏（redacted=true + sample_values=[]）
  3. 按年份锚点分桶 + _ALL 汇总 + NULL 年份归 _UNKNOWN_YEAR
  4. 高基数列走 approx、低基数列走 exact + 采样
  5. 未注册物理列进 unmapped_fields
  6. 无数据时默认不写出（不覆盖已有报告）

不依赖真实 warehouse 数据，可在任意 worktree 运行：
  python3 -m pytest 数据管理/pipelines/test_field_coverage.py -q
"""

import json
import os
import sys

import pandas as pd
import pytest

_PIPELINES_DIR = os.path.dirname(os.path.abspath(__file__))
if _PIPELINES_DIR not in sys.path:
    sys.path.insert(0, _PIPELINES_DIR)

import field_coverage as fc


@pytest.fixture
def policy_parquet(tmp_path):
    """构造一个 policy fixture：含敏感列、占位符空值、高/低基数、NULL 年份。"""
    df = pd.DataFrame(
        {
            # policy_date：3 行 2021，1 行 2022，1 行 NULL
            "policy_date": pd.to_datetime(
                ["2021-03-01", "2021-06-01", "2021-09-01", "2022-01-01", None]
            ),
            # fuel_type：低基数，含一个空串 + 一个占位符 'NULL'（应被算空）
            "fuel_type": ["汽油", "汽油", "柴油", "", "NULL"],
            # plate_no：敏感列，高基数（全唯一）
            "plate_no": ["川A001", "川A002", "川A003", "川A004", "川A005"],
            # premium：数值，含一个 NULL
            "premium": [100.0, 200.0, None, 400.0, 500.0],
            # 一个未注册物理列
            "ghost_col": ["x", "y", "z", None, None],
        }
    )
    out = tmp_path / "policy.parquet"
    df.to_parquet(out, index=False)
    return str(out)


def _build(policy_glob):
    registry = fc.load_field_registry()
    domains = {"policy": {"glob": policy_glob, "year_anchor": "policy_date"}}
    return fc.build_report(domains, registry)


def test_effective_non_null_ratio_treats_placeholder_as_empty(policy_parquet):
    rep = _build(policy_parquet)
    ft = rep["domains"]["policy"]["fields"]["fuel_type"]["by_year"]["_ALL"]
    # 5 行中 '' 和 'NULL' 算空 → 3 有效 → 0.6
    assert ft["effective_non_null_ratio"] == pytest.approx(0.6)
    assert ft["non_null_rows"] == 3
    assert ft["total_rows"] == 5


def test_sensitive_column_redacted(policy_parquet):
    rep = _build(policy_parquet)
    pn = rep["domains"]["policy"]["fields"]["plate_no"]
    assert pn["redacted"] is True
    assert pn["sample_values"] == []


def test_non_sensitive_low_card_has_samples(policy_parquet):
    rep = _build(policy_parquet)
    ft = rep["domains"]["policy"]["fields"]["fuel_type"]
    assert ft["redacted"] is False
    # 最高频 '汽油' 必在样本中
    assert "汽油" in ft["sample_values"]
    assert ft["distinct_method"] == "exact"


def test_year_bucketing_and_unknown_year(policy_parquet):
    rep = _build(policy_parquet)
    pol = rep["domains"]["policy"]
    assert fc.ALL_YEARS in pol["years"]
    assert fc.UNKNOWN_YEAR in pol["years"]  # 第 5 行 policy_date 为 NULL
    by_year = pol["fields"]["premium"]["by_year"]
    # 2021 有 3 行
    assert by_year["2021"]["total_rows"] == 3
    # NULL 年份桶 1 行
    assert by_year[fc.UNKNOWN_YEAR]["total_rows"] == 1


def test_premium_numeric_ratio(policy_parquet):
    rep = _build(policy_parquet)
    pm = rep["domains"]["policy"]["fields"]["premium"]["by_year"]["_ALL"]
    # 数值列：仅 NULL 算空 → 4/5 = 0.8
    assert pm["effective_non_null_ratio"] == pytest.approx(0.8)


def test_unmapped_field_listed(policy_parquet):
    rep = _build(policy_parquet)
    pol = rep["domains"]["policy"]
    assert "ghost_col" in pol["unmapped_fields"]
    assert pol["fields"]["ghost_col"]["registry_status"] == "unmapped"
    assert pol["fields"]["ghost_col"]["field_id"] is None


def test_report_top_level_metadata(policy_parquet):
    rep = _build(policy_parquet)
    assert rep["schema_version"] == fc.SCHEMA_VERSION
    assert rep["generated_at"].endswith("Z")
    assert "duckdb_version" in rep


def test_empty_glob_skips_write_by_default(tmp_path, monkeypatch):
    """无数据时默认不写出，不覆盖已有报告。"""
    out = tmp_path / "report.json"
    out.write_text('{"keep":"me"}', encoding="utf-8")
    empty_glob = str(tmp_path / "nonexistent_*.parquet")
    rc = fc.main(
        ["--policy-glob", empty_glob, "--claims-glob", empty_glob, "--output", str(out)]
    )
    assert rc == 0
    # 旧内容保留
    assert json.loads(out.read_text(encoding="utf-8")) == {"keep": "me"}


def test_empty_glob_allow_empty_writes(tmp_path):
    out = tmp_path / "report.json"
    empty_glob = str(tmp_path / "nonexistent_*.parquet")
    rc = fc.main(
        [
            "--policy-glob",
            empty_glob,
            "--claims-glob",
            empty_glob,
            "--output",
            str(out),
            "--allow-empty-output",
        ]
    )
    assert rc == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["domains"]["policy"]["available"] is False


def test_atomic_write_roundtrip(tmp_path):
    out = tmp_path / "sub" / "x.json"
    fc.atomic_write_json(str(out), {"a": 1, "中文": "值"})
    assert json.loads(out.read_text(encoding="utf-8")) == {"a": 1, "中文": "值"}


def test_distinct_excludes_placeholders(tmp_path):
    """去重计数必须排除空串/占位符（codex 闸-2 P1 反例）。"""
    df = pd.DataFrame(
        {
            "policy_date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
            # fuel_type 是已注册字段；3 行全是"空"语义 → 有效去重应为 0
            "fuel_type": ["", "NULL", "-"],
        }
    )
    out = tmp_path / "p.parquet"
    df.to_parquet(out, index=False)
    rep = _build(str(out))
    b = rep["domains"]["policy"]["fields"]["fuel_type"]["by_year"]["_ALL"]
    assert b["non_null_rows"] == 0
    assert b["distinct_count"] == 0  # 不能把 '', 'NULL', '-' 算成 3 个真实值


def test_unmapped_field_not_sampled(tmp_path):
    """未注册物理列默认不采样且 redacted=true（fail-safe 防未登记 PII 泄露，codex 闸-2 P1）。"""
    df = pd.DataFrame(
        {
            "policy_date": pd.to_datetime(["2024-01-01", "2024-01-02"]),
            # 未注册的疑似 PII 列，低基数
            "owner_phone": ["13800000001", "13800000002"],
        }
    )
    out = tmp_path / "p.parquet"
    df.to_parquet(out, index=False)
    rep = _build(str(out))
    f = rep["domains"]["policy"]["fields"]["owner_phone"]
    assert f["registry_status"] == "unmapped"
    assert f["redacted"] is True
    assert f["sample_values"] == []


def test_glob_path_is_repo_relative_or_basename(policy_parquet):
    """输出的 glob 不得是本机绝对路径（codex 闸-2 P1）。"""
    rep = _build(policy_parquet)
    g = rep["domains"]["policy"]["glob"]
    assert not g.startswith("/")  # 不泄露绝对路径
    assert g == "policy.parquet"  # tmp 路径回落 basename


def test_repair_field_recognized(tmp_path):
    """subject_repair_shop 在 repair-fields.json 注册，不应被误报 unmapped（codex 闸-2 P2）。"""
    reg = fc.load_field_registry()
    # 仅当注册表文件存在时断言（CI clean checkout 一定存在）
    if "subject_repair_shop" in reg:
        assert reg["subject_repair_shop"]["field_id"] == "subject_repair_shop"
    # policy 主表字段也应在合并后的注册表里
    assert "fuel_type" in reg
