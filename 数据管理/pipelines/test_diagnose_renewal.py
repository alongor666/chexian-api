#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""diagnose_renewal 回归测试 — 锁定责任模式映射 / 可插拔清单加载 / 时间窗口 / 亮灯 核心契约。

纯函数 + 清单加载用合成 CSV，不依赖 parquet。末尾 1 个端到端 smoke 在缺数据时自动跳过。
"""
from __future__ import annotations

import subprocess
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from diagnose_renewal import resolve_window  # type: ignore  # noqa: E402
from diagnose_renewal_branch import _month_bounds, _win_dedup_cte  # type: ignore  # noqa: E402
from renewal_common import (  # type: ignore  # noqa: E402
    DEFAULT_LIST,
    disp_team,
    funnel_derived,
    impact_rate,
    light_q,
    light_r,
    rate,
)
from renewal_resp_mode import load_resp_mode_source, map_resp_mode  # type: ignore  # noqa: E402

WIN_S, WIN_E = date(2026, 6, 1), date(2026, 6, 30)


# ---- map_resp_mode：用户 2026-06-06 确认的口径 ----

@pytest.mark.parametrize("name_type,expect", [
    ("电销续保", "电销自留"),
    ("网电电续", "电销自留"),
    ("微保电续", "电销自留"),
    ("兜底", "业务员兜底"),
    ("白名单", "电销转保"),
    (" 兜底 ", "业务员兜底"),   # 前后空格容错
    ("未知类型", None),
    ("", None),
    (None, None),
    (float("nan"), None),       # pandas 空单元格 NaN 容错（codex P2：NaN 为 truthy，不可 (x or "").strip()）
])
def test_map_resp_mode(name_type, expect):
    assert map_resp_mode(name_type) == expect


# ---- 亮灯：报价率/续回率越高越好，阈值边界 ----

# 阈值语义（严格 <）：报价率 ≥90🟢 / [80,90)🔵 / [70,80)🟡 / <70🔴
@pytest.mark.parametrize("v,emoji", [(95, "🟢"), (90, "🟢"), (85, "🔵"), (80, "🔵"), (75, "🟡"), (70, "🟡"), (65, "🔴")])
def test_light_quote(v, emoji):
    assert light_q(v).strip() == emoji


# 续回率 ≥75🟢 / [65,75)🔵 / [55,65)🟡 / <55🔴
@pytest.mark.parametrize("v,emoji", [(80, "🟢"), (75, "🟢"), (70, "🔵"), (65, "🔵"), (60, "🟡"), (55, "🟡"), (50, "🔴")])
def test_light_renew(v, emoji):
    assert light_r(v).strip() == emoji


# ---- 续保影响度专项指标（renewal_common 注册 · 先聚合后计算 · 用户 2026-06-07 修改意见）----

@pytest.mark.parametrize("yc,q,r,unquoted,lost", [
    (100, 80, 50, 20, 50),   # 常规：未报价=应续−已报价，流失=应续−已续保
    (10, 10, 10, 0, 0),      # 全报价全续保 → 零未报价零流失
    (5, 0, 0, 5, 5),         # 全未报价 → 未报价=流失=应续
    (8, 7, 2, 1, 6),         # 达州真实档
])
def test_funnel_derived(yc, q, r, unquoted, lost):
    d = funnel_derived(yc, q, r)
    assert d["unquoted"] == unquoted
    assert d["lost"] == lost


def test_funnel_derived_handles_none():
    """已报价/已续保为 None（SUM 空）时按 0 计，不抛错。"""
    assert funnel_derived(10, None, None) == {"unquoted": 10, "lost": 10}


# 续保影响度 = 流失件数 ÷ 合计应续件数（分母为当前分类合计；防除零返回 None）
@pytest.mark.parametrize("lost,total,expect", [
    (451, 2064, 21.9),   # 天府真实档（与 DuckDB 直查一致）
    (1046, 2064, 50.7),  # 合计缺口 = 1 − 续保率
    (0, 2064, 0.0),      # 无流失 → 0 影响度
    (5, 0, None),        # 分母 0 → None（防除零）
])
def test_impact_rate(lost, total, expect):
    assert impact_rate(lost, total) == expect


def test_impact_rate_additivity():
    """可加和性：各分类续保影响度之和 = 整体续保缺口（先聚合后计算的核心性质）。
    分母统一为合计应续件数，故 Σ(各分类流失 ÷ 合计) = 合计流失 ÷ 合计。"""
    lost_by_org = [451, 162, 105, 85, 50, 41, 39, 35, 31, 29, 12, 6]  # 表一 12 机构流失件数
    total_yc = 2064
    parts_sum = round(sum(impact_rate(x, total_yc) for x in lost_by_org), 1)
    overall = impact_rate(sum(lost_by_org), total_yc)
    assert parts_sum == overall == 50.7


def test_light_none():
    assert light_q(None) == "" and light_r(None) == ""


# ---- 工具：rate / disp_team ----

def test_rate():
    assert rate(31, 100) == 31.0 and rate(1, 3) == 33.3 and rate(5, 0) is None


@pytest.mark.parametrize("t,expect", [
    ("天府业务一部", "天府业务一部"),
    ("nan", "（未分组）"), ("NaN", "（未分组）"), ("None", "（未分组）"),
    ("", "（未分组）"), (None, "（未分组）"),
])
def test_disp_team(t, expect):
    assert disp_team(t) == expect


# ---- resolve_window ----

def _args(**kw):
    base = dict(time_view="ytd", year=2026, start=None, end=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_window_ytd():
    s, e, label, by_month = resolve_window(_args(time_view="ytd", year=2026))
    assert (s, e, by_month) == (date(2026, 1, 1), date(2026, 12, 31), True)
    assert "2026" in label


def test_window_by_month_equals_ytd():
    assert resolve_window(_args(time_view="by_month"))[:2] == resolve_window(_args(time_view="ytd"))[:2]


def test_window_custom():
    s, e, _label, by_month = resolve_window(_args(time_view="custom", start="2026-06-01", end="2026-06-30"))
    assert (s, e, by_month) == (WIN_S, WIN_E, False)


def test_window_custom_requires_dates():
    with pytest.raises(SystemExit):
        resolve_window(_args(time_view="custom"))


def test_window_mtd_today_is_first_of_month():
    s, e, _label, by_month = resolve_window(_args(time_view="mtd_today"))
    assert s.day == 1 and e >= s and by_month is False


# ---- load_resp_mode_source：可插拔（专项清单 / wecom 名单类型 / 异常）----

def _write_csv(path: Path, header: str, rows: list[str]):
    path.write_text(header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")


def test_load_dedicated_resp_mode_verbatim(tmp_path):
    """专项清单：含「责任模式」列 → verbatim 采用，不映射、不按日期过滤。"""
    p = tmp_path / "resp.csv"
    _write_csv(p, "车架号,责任模式", ["VIN001,电销自留", "VIN002,业务员兜底", "VIN003,自定义模式"])
    df, src = load_resp_mode_source(p, WIN_S, WIN_E)
    assert df is not None and "专项" in src
    m = dict(zip(df["vehicle_frame_no"], df["resp_mode"]))
    assert m == {"VIN001": "电销自留", "VIN002": "业务员兜底", "VIN003": "自定义模式"}


def test_load_wecom_namelist_maps_and_filters(tmp_path):
    """wecom 清单：名单类型映射 + 按保单到期时间过滤窗口。"""
    p = tmp_path / "wecom.csv"
    _write_csv(p, "车架号,名单类型,保单到期时间", [
        "VIN001,电销续保,2026-06-15",   # 窗口内 → 电销自留
        "VIN002,兜底,2026-06-20",        # 窗口内 → 业务员兜底
        "VIN003,白名单,2026-07-15",      # 窗口外 → 过滤掉
        "VIN004,未知,2026-06-10",        # 映射为 None → 丢弃
    ])
    df, src = load_resp_mode_source(p, WIN_S, WIN_E)
    assert df is not None and "名单类型" in src
    m = dict(zip(df["vehicle_frame_no"], df["resp_mode"]))
    assert m == {"VIN001": "电销自留", "VIN002": "业务员兜底"}


def test_load_dedup_keeps_one_per_vin(tmp_path):
    p = tmp_path / "dup.csv"
    _write_csv(p, "车架号,责任模式", ["VIN001,电销自留", "VIN001,业务员兜底"])
    df, _ = load_resp_mode_source(p, WIN_S, WIN_E)
    assert len(df) == 1 and list(df["vehicle_frame_no"]) == ["VIN001"]


def test_load_vin_column_aliases(tmp_path):
    p = tmp_path / "alias.csv"
    _write_csv(p, "vehicle_frame_no,责任模式", ["VIN001,电销自留"])
    df, _ = load_resp_mode_source(p, WIN_S, WIN_E)
    assert df is not None and list(df["vehicle_frame_no"]) == ["VIN001"]


def test_load_missing_file(tmp_path):
    df, reason = load_resp_mode_source(tmp_path / "nope.csv", WIN_S, WIN_E)
    assert df is None and "不存在" in reason


def test_load_no_key_column(tmp_path):
    p = tmp_path / "nokey.csv"
    _write_csv(p, "保单号,责任模式", ["P1,电销自留"])
    df, reason = load_resp_mode_source(p, WIN_S, WIN_E)
    assert df is None and "车架号" in reason


def test_load_no_mode_column(tmp_path):
    p = tmp_path / "nomode.csv"
    _write_csv(p, "车架号,客户类别", ["VIN001,非营业个人客车"])
    df, reason = load_resp_mode_source(p, WIN_S, WIN_E)
    assert df is None and ("责任模式" in reason or "名单类型" in reason)


def test_load_wecom_window_no_overlap(tmp_path):
    """wecom 清单全部落窗口外 → 降级 None。"""
    p = tmp_path / "out.csv"
    _write_csv(p, "车架号,名单类型,保单到期时间", ["VIN001,兜底,2026-05-01"])
    df, reason = load_resp_mode_source(p, WIN_S, WIN_E)
    assert df is None and "窗口" in reason


# ---- 分公司视角：窗口边界 / 去重 CTE ----

@pytest.mark.parametrize("d,expect_start,expect_end", [
    (date(2026, 6, 6), date(2026, 6, 1), date(2026, 6, 30)),
    (date(2026, 2, 15), date(2026, 2, 1), date(2026, 2, 28)),   # 平年 2 月
    (date(2024, 2, 15), date(2024, 2, 1), date(2024, 2, 29)),   # 闰年 2 月
    (date(2026, 12, 31), date(2026, 12, 1), date(2026, 12, 31)),
])
def test_month_bounds(d, expect_start, expect_end):
    assert _month_bounds(d) == (expect_start, expect_end)


def test_win_dedup_cte_structure():
    """去重 CTE：含 w/f 两级、按车架号 GROUP BY、口径 A 续回标记含 renewed=1，进盘提前期注入正确。"""
    sql = _win_dedup_cte("expiry_date >= DATE '2026-06-01'", 30)
    assert "WITH w AS" in sql and "f AS" in sql
    assert "GROUP BY vehicle_frame_no" in sql           # 窗口内按车架号去重
    assert "CAST(expiry_date AS DATE) - 30" in sql       # 进盘锚点提前期注入
    assert "quoted=1 AND renewed=1" in sql               # 口径 A：续回数 = 已报价且最终续回
    assert sql.strip().endswith(")")                     # 以 CTE 收尾，供拼接 SELECT ... FROM f


# ---- 端到端 smoke（缺 parquet 时自动跳过）----

def test_cli_smoke_when_data_present(tmp_path):
    rt = _HERE.parent / "warehouse" / "fact" / "renewal_tracker" / "latest.parquet"
    if not rt.exists():
        pytest.skip("renewal_tracker parquet 缺失（CI 无数据），跳过端到端 smoke")
    out = subprocess.run(
        [sys.executable, str(_HERE / "diagnose_renewal.py"),
         "--time-view", "custom", "--start", "2026-06-01", "--end", "2026-06-30",
         "--no-action-list", "--out-dir", str(tmp_path),
         "--resp-mode-list", "/nonexistent.csv"],  # 强制责任模式降级，不依赖外部清单
        capture_output=True, text=True, timeout=180,
    )
    assert out.returncode == 0, out.stderr
    mds = list(tmp_path.glob("续保诊断_*.md"))
    assert mds, "未生成报告"
    text = mds[0].read_text(encoding="utf-8")
    assert "## 一、机构经营盯盘总表" in text
    assert "## 四、机构下钻" in text
    assert "## 六、待跟进清单" in text
    assert "**结论**" in text
    # 已续回口径：= 已签单续保（is_renewed），与前端续保追踪一致；不按 renewed_date 起保日切片
    assert "已续回" in text and "已签单" in text
    # 报告语言红线：正文不得残留英文术语堆砌
    for bad in ("cohort", "%pp"):
        assert bad not in text, f"报告残留英文/格式问题：{bad}"


def test_cli_branch_report_when_data_present(tmp_path):
    """分公司视角模式：6 张三级机构窗口表 + 已到期/未到期合计 = 当月合计（窗口去重一致性）。"""
    rt = _HERE.parent / "warehouse" / "fact" / "renewal_tracker" / "latest.parquet"
    if not rt.exists():
        pytest.skip("renewal_tracker parquet 缺失（CI 无数据），跳过分公司视角 smoke")
    out = subprocess.run(
        [sys.executable, str(_HERE / "diagnose_renewal.py"),
         "--branch-report", "--out-dir", str(tmp_path)],
        capture_output=True, text=True, timeout=180,
    )
    assert out.returncode == 0, out.stderr
    mds = list(tmp_path.glob("续保分公司视角_*.md"))
    assert mds, "未生成分公司视角报告"
    text = mds[0].read_text(encoding="utf-8")
    for title in ("## 一、当月已到期续保表", "## 二、临期 7 天续保表", "## 三、当月未到期续保表",
                  "## 四、当月续保表", "## 五、当年已到期续保表", "## 六、当月首日续保情况",
                  "## 七、当月首周续保情况"):
        assert title in text, f"缺少板块：{title}"
    assert "三级机构" in text and "首日续保率" in text and "首周续保率" in text
    assert "**结论**" in text  # 漏斗表（三~五）+ 速度表（六/七）仍为结论式
    # 临期 7 天表（用户 2026-06-07 第三轮）：未来 7 天将到期·未到期·进度口径，诚实措辞不说「已流失」
    assert "## 二、临期 7 天续保表" in text and "未来 7 天将到期" in text
    assert "**问题一 · 临期续保进度**" in text and "**问题二 · 临期未报价风险**" in text
    # 当年已到期（表五）：截至最新日期成熟口径，标题含「已到期」（不再是被未来件稀释的全年）
    assert "## 五、当年已到期续保表" in text
    # 已续回口径：= 已签单续保（is_renewed），与前端续保追踪一致；不按 renewed_date 起保日切片
    assert "已续回口径" in text and "已签单" in text
    # 表一专项（用户 2026-06-07 第二轮：对标目标 + 业务白话 + 字段简称 + 口径附录化）
    assert "续保影响度" in text  # 派生指标列保留
    assert "## 附录 · 表一指标口径" in text  # 口径定义沉到报告末尾附录
    assert "指标口径" in text  # 防漂移映射表（位于附录）
    assert "**问题一 · 续保率缺口**" in text and "**问题二 · 未报价即流失**" in text
    # R1 对标目标：结论以续保率目标为锚给出「差多少个百分点」
    assert "的目标" in text and "个百分点" in text
    # R3 业务白话「流失…的客户」+ R4 判断副词「报价率仅」
    assert "的客户" in text and "报价率仅" in text
    # R2：去「视同」留余地措辞（正文结论已全删；附录口径定义可保留精确表述）
    assert "视同" not in text, "残留旧措辞：视同"
    # R3 业务白话：问题一以「整体分公司流失 N% 的客户」表达，而非技术化「续保缺口扩大」
    assert "整体分公司流失" in text
    # 报告语言红线：正文不得残留英文术语堆砌（cutoff 已中文化为「数据截止日」）
    for bad in ("cohort", "%pp", "mature", "funnel", "cutoff"):
        assert bad not in text, f"报告残留英文/格式问题：{bad}"
