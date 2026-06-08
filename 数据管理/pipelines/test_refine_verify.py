#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refine_verify 回归测试 — 锁定 数字清理 / 元信息解析 / 表格解析 / 事实结构 / 回查降级 契约。

纯函数 + 合成报告文本，不依赖 parquet（回查走 do_verify=False / meta 缺失降级）。
与 test_diagnose_renewal.py 同范式。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from refine_verify import (  # type: ignore  # noqa: E402
    _clean,
    _num,
    build_facts,
    parse_meta,
    parse_sections,
    parse_table,
    table_facts,
    verify_renewal,
)

SYNTHETIC = """# 续保诊断 · 三级机构视角 · 测试机构 · 2026年6月

> **数据截止日** 2026-06-08 · **口径** 商业险 · 应续件数 = 去重车架号
> **生成** `diagnose_renewal.py --org-report --org 测试机构` · 20260608_000000

## 一、当月已到期续保表

**问题一 · 续保率缺口**：草稿结论占位。

| top9业务员 | 应续 | 已报价 | 已续保 | 未报价 | 流失 | 续保影响度 | 报价率 | 续保率 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 张三 | 10 | 3 | 2 | 7 | 8 | 20.0% | 30.0% 🔴 | 20.0% 🔴 |
| 李四 | 8 | 8 | 5 | 0 | 3 | 7.5% | 100.0% 🟢 | 62.5% 🟡 |
| **合计** | **18** | **11** | **7** | **7** | **11** | **27.5%** | **61.1%** | **38.9%** |

## 三、当月未到期续保表

**结论**：草稿占位。

| top9业务员 | 应续 | 已报价 | 已续保 | 报价率 | 续保率 |
|---|--:|--:|--:|--:|--:|
| 张三 | 20 | 10 | 3 | 50.0% 🔴 | 15.0% |
| 李四 | 15 | 12 | 6 | 80.0% 🔵 | 40.0% |
| **合计** | **35** | **22** | **9** | **62.9%** | **25.7%** |

## 附录 · 表一指标口径

| 指标 | 含义 |
|---|---|
| 应续件数 | 去重车架号数 |
"""


@pytest.fixture
def report(tmp_path):
    p = tmp_path / "续保三级机构视角_测试_2026年06月.md"
    p.write_text(SYNTHETIC, encoding="utf-8")
    return p


# ---- 数字清理：剥离 加粗/emoji/百分号/千分位 ----

@pytest.mark.parametrize("raw,expect", [
    ("**18**", 18),
    ("30.0% 🔴", 30.0),
    ("1,623", 1623),
    ("100.0% 🟢", 100.0),
    ("张三", "张三"),
    ("-", None),
    ("", None),
])
def test_num(raw, expect):
    assert _num(raw) == expect


def test_clean_strips_noise():
    assert _clean("**46.2%** 🔴") == "46.2"


# ---- 元信息解析 ----

def test_parse_meta():
    m = parse_meta(SYNTHETIC)
    assert m["domain"] == "renewal"
    assert m["view"] == "org-report"
    assert m["org"] == "测试机构"
    assert m["year"] == 2026 and m["month"] == 6
    assert m["cutoff"] == "2026-06-08"
    assert m["customer_category"] is None


def test_parse_meta_customer_category():
    txt = SYNTHETIC.replace("2026年6月\n", "2026年6月 · 客户类别「非营业个人客车」\n")
    assert parse_meta(txt)["customer_category"] == "非营业个人客车"


# ---- section / 表格解析 ----

def test_sections_skip_appendix():
    secs = parse_sections(SYNTHETIC)
    titles = [h for h, _ in secs]
    assert any("当月已到期" in t for t in titles)
    assert any("当月未到期" in t for t in titles)
    assert not any("附录" in t for t in titles)  # 附录/口径 section 跳过


def test_parse_table_9col():
    secs = dict(parse_sections(SYNTHETIC))
    body = next(b for h, b in secs.items() if "已到期" in h)
    headers, data, total = parse_table(body)
    assert "应续" in "".join(headers)
    assert len(data) == 2                 # 张三 + 李四（合计行剔除）
    assert total is not None and "合计" in total[0]


# ---- 事实结构 ----

def test_facts_matured_funnel_and_total(report):
    facts = build_facts(report, do_verify=False)["tables"]
    assert len(facts) == 2                 # 附录跳过
    t1 = facts[0]
    assert t1["maturity"] == "matured"     # 当月已到期
    assert t1["funnel"] == [18, 11, 7]
    assert t1["total"]["renew_rate"] == 38.9


def test_facts_top_anomaly_by_impact(report):
    t1 = build_facts(report, do_verify=False)["tables"][0]
    assert t1["top_anomaly"]["name"] == "张三"        # 影响度 20.0 最高
    assert t1["top_anomaly"]["metric"] == "续保影响度"


def test_facts_gap_and_contrast(report):
    t1 = build_facts(report, do_verify=False)["tables"][0]
    assert t1["gap"]["unquoted"] == 7
    assert t1["gap"]["unquoted_top"]["name"] == "张三"
    # 对比落差：已报价续保率 = 续回7/报价11 = 63.6%，未报价恒 0
    assert t1["contrast"]["quoted_renew_rate"] == 63.6
    assert t1["contrast"]["unquoted_renew_rate"] == 0.0


def test_facts_progress_anomaly_by_lowest_renew(report):
    t3 = build_facts(report, do_verify=False)["tables"][1]
    assert t3["maturity"] == "progress"               # 当月未到期
    assert t3["top_anomaly"]["name"] == "张三"         # 续保率 15.0 最低（yc≥5）
    assert "gap" not in t3                             # 6 列无未报价列


# ---- 回查降级（不依赖 parquet）----

def test_verify_skipped_without_meta():
    v = verify_renewal({"domain": None, "org": None, "cutoff": None, "year": None}, [])
    assert v["ok"] is True and v["checked"] == [] and "skipped" in v


def test_build_facts_no_verify(report):
    out = build_facts(report, do_verify=False)
    assert out["verify"]["ok"] is True
    assert "--no-verify" in out["verify"]["skipped"]
