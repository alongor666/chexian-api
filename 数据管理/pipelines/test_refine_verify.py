#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""refine_verify 回归测试 — 锁定 数字清理 / 元信息解析 / 表格解析 / 事实结构 / 回查降级 契约。

纯函数 + 合成报告文本，不依赖 parquet（回查走 do_verify=False / meta 缺失降级）。
与 test_diagnose_renewal.py 同范式。
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import refine_verify  # type: ignore  # noqa: E402  模块级访问（monkeypatch RT / _renewal_aggregate）
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
    # 无回查（--no-verify）→ 对比落差为表内上界近似：已报价续保率 = 续回7/报价11 = 63.6%（上界），
    # 未报价路径表内无法拆分 → None（不再谎称恒 0；matured 表由回查给精确值）
    assert t1["contrast"]["quoted_renew_rate"] == 63.6
    assert t1["contrast"]["unquoted_renew_rate"] is None
    assert t1["contrast"]["approx"] is True


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
    assert "exact_contrast" not in out["verify"]  # 内部 plumbing，不进公开事实包


# ---- P2.2 漏斗列序守卫（fail-loud，无回查兜底的 progress 表防静默读错列）----

def test_funnel_layout_guard_fail_loud():
    # 第 2 列被换成「已报价」、应续移到第 3 列 → 守卫应抛 ValueError 而非静默读错
    bad = ["业务员", "已报价", "应续", "已续保", "续保率"]
    with pytest.raises(ValueError, match="应续"):
        table_facts("一", "当月已到期续保表", bad, [], None)


def test_funnel_layout_guard_too_few_cols():
    with pytest.raises(ValueError, match="列数"):
        table_facts("一", "当月已到期续保表", ["业务员", "应续"], [], None)


# ---- P2.4 分公司视角元信息（org=None → 回查跳过）+ duckdb 降级锚点 ----

BRANCH_SYNTHETIC = """# 续保诊断 · 分公司视角 · 2026年6月

> **数据截止日** 2026-06-08 · **口径** 商业险
> **生成** `diagnose_renewal.py --branch-report` · 20260608_000000

## 一、当月已到期续保表

| 三级机构 | 应续 | 已报价 | 已续保 | 未报价 | 流失 | 续保影响度 | 报价率 | 续保率 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| 乐山 | 10 | 8 | 5 | 2 | 5 | 50.0% | 80.0% | 50.0% |
| **合计** | **10** | **8** | **5** | **2** | **5** | **50.0%** | **80.0%** | **50.0%** |
"""


def test_parse_meta_branch_report_no_org():
    m = parse_meta(BRANCH_SYNTHETIC)
    assert m["view"] == "branch-report"
    assert m["org"] is None                       # 分公司视角无单一机构
    v = verify_renewal(m, [])
    assert v["ok"] is True and "skipped" in v      # org=None → 回查跳过（不误判 ok=false）


def test_verify_renewal_duckdb_unavailable(monkeypatch):
    """降级锚点：duckdb 不可用时 verify 返回 ok=True + skipped，不阻断产出。"""
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *a, **k):
        if name == "duckdb":
            raise ImportError("simulated missing duckdb")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    meta = {"domain": "renewal", "org": "乐山", "cutoff": "2026-06-08",
            "year": 2026, "month": 6, "customer_category": None}
    v = verify_renewal(meta, [])
    assert v["ok"] is True
    assert v["skipped"] == "duckdb 不可用"


# ---- P1 SQL 注入安全 + P2.3 续回×报价交叉拆分（需 duckdb + 合成 parquet）----

@pytest.fixture
def synthetic_rt(tmp_path, monkeypatch):
    """造一张小 renewal_tracker parquet 并 monkeypatch refine_verify.RT 指向它。

    乐山 4 帧覆盖 报价×续回 四象限：
      VIN1 报价+续回 / VIN2 报价+未续回 / VIN3 未报价+续回 / VIN4 未报价+未续回
    宜宾 1 帧（VIN5 报价+续回）用于验证 org 过滤不串读。
    """
    duckdb = pytest.importorskip("duckdb")
    p = tmp_path / "rt.parquet"
    con = duckdb.connect()
    con.execute(
        """
        CREATE TABLE rt AS SELECT * FROM (VALUES
          ('VIN1', TRUE,  TRUE,  DATE '2026-06-05', '乐山', '非营业个人客车'),
          ('VIN2', TRUE,  FALSE, DATE '2026-06-05', '乐山', '非营业个人客车'),
          ('VIN3', FALSE, TRUE,  DATE '2026-06-05', '乐山', '非营业个人客车'),
          ('VIN4', FALSE, FALSE, DATE '2026-06-05', '乐山', '非营业个人客车'),
          ('VIN5', TRUE,  TRUE,  DATE '2026-06-05', '宜宾', '非营业个人客车')
        ) AS t(vehicle_frame_no, is_quoted, is_renewed, expiry_date, org_level_3, customer_category)
        """
    )
    con.execute(f"COPY rt TO '{p}' (FORMAT PARQUET)")
    con.close()
    monkeypatch.setattr(refine_verify, "RT", str(p))
    return str(p)


def test_renewal_aggregate_sql_injection_safe(synthetic_rt):
    duckdb = pytest.importorskip("duckdb")
    con = duckdb.connect()
    start, end = date(2026, 6, 1), date(2026, 6, 30)
    legit = refine_verify._renewal_aggregate(con, start, end, "乐山", None)
    assert legit[0] == 4                # 合法 org 命中乐山 4 帧
    # 注入串被当字面量匹配 → 命中 0；旧 f-string 会让 ILIKE '%乐山' OR '1'='1%' 恒真 → 返回全部 5 帧
    evil = refine_verify._renewal_aggregate(con, start, end, "乐山' OR '1'='1", None)
    assert evil[0] == 0
    con.close()


def test_renewal_aggregate_crosstab_split(synthetic_rt):
    duckdb = pytest.importorskip("duckdb")
    con = duckdb.connect()
    yc, q, r, rq, ru = refine_verify._renewal_aggregate(
        con, date(2026, 6, 1), date(2026, 6, 30), "乐山", None)
    con.close()
    assert (yc, q, r) == (4, 2, 2)
    assert rq == 1                      # 续回且报价 = VIN1
    assert ru == 1                      # 续回未报价 = VIN3 → 证明 is_renewed ⊄ is_quoted


def test_verify_exact_contrast_for_matured(synthetic_rt):
    pytest.importorskip("duckdb")
    meta = {"domain": "renewal", "org": "乐山", "cutoff": "2026-06-30",
            "year": 2026, "month": 6, "customer_category": None}
    facts = [{"idx": "一", "title": "当月已到期续保表", "maturity": "matured",
              "total": {"yc": 4, "quoted": 2, "renewed": 2}}]
    v = verify_renewal(meta, facts)
    assert v["ok"] is True              # 报告合计 4/2/2 与 parquet 一致
    ec = v["exact_contrast"]["一"]
    assert ec["source"] == "parquet_exact"
    assert ec["quoted_renew_rate"] == 50.0    # 续回且报价1 / 报价2
    assert ec["unquoted_renew_rate"] == 50.0  # 续回未报价1 / 未报价2 → 精确，非恒 0
