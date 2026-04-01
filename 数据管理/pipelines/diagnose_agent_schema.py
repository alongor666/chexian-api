#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diagnose_agent 的 JSON 契约 + 异常检测规则引擎

- summary.json schema（TypedDict 定义）
- 异常检测（复用 diagnose_common 的 light() 阈值体系）
- suggested_drilldowns 触发规则

版本: 2.0.0
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, TypedDict

# 复用已有阈值体系——不引入新数字
from diagnose_common import TH_VC, TH_LR, TH_IR


# ============================================================================
# TypedDict schema
# ============================================================================

class MetaBlock(TypedDict):
    generated_at: str
    version: str
    compare_mode: str           # "ytd" | "full"
    ytd_cutoff: str | None      # "03-31" 或 None
    source_path: str
    cli_args: dict


class IdentityBlock(TypedDict):
    org: str
    agent: str                  # 精确全名
    years: list[int]
    latest_year: int
    scale_wan: float            # 最新年签单保费（万元）
    policy_count: int           # 最新年保单数
    benchmark_ratio: float      # 最新年 经代保费/机构保费
    sample_size: int            # 总记录数
    small_sample: bool          # sample_size < 200


class HealthBlock(TypedDict):
    variable_cost_ratio: float
    margin_wan: float           # 满期边际贡献额（万）
    loss_ratio: float
    expense_ratio: float
    verdict: str                # "earn" | "marginal" | "loss"


class AnomalyItem(TypedDict):
    dim: str                    # 来源维度 title
    metric: str
    year: int
    value: float
    benchmark: float
    deviation: float
    severity: str               # "danger" | "warn" | "notice"


class DrilldownSpec(TypedDict):
    spec: str
    reason: str
    priority: int               # 1=高 2=中


class SummaryJson(TypedDict):
    meta: MetaBlock
    L0: IdentityBlock
    L1: HealthBlock
    L2: dict[str, Any]          # 各维度原始聚合数据
    anomalies: list[AnomalyItem]
    suggested_drilldowns: list[DrilldownSpec]


# ============================================================================
# 辅助：severity 判定（复用 light() 阈值）
# ============================================================================

def _severity_from_thresholds(value: float, thresholds: tuple, higher_worse: bool = True) -> str | None:
    """将 light() 的四级亮灯映射为 anomaly severity。
    返回 None 表示正常（不入 anomalies）。"""
    notice, warn, danger = thresholds
    if higher_worse:
        if value > danger:
            return "danger"
        if value > warn:
            return "warn"
        if value > notice:
            return "notice"
        return None
    else:
        if value < danger:
            return "danger"
        if value < warn:
            return "warn"
        if value < notice:
            return "notice"
        return None


def _severity_from_deviation(deviation_pp: float) -> str | None:
    """基于偏离度判定 severity（用于动态基准，如费用率 vs 机构同期）。"""
    abs_dev = abs(deviation_pp)
    if abs_dev > 15:
        return "danger"
    if abs_dev > 10:
        return "warn"
    if abs_dev > 5:
        return "notice"
    return None


# ============================================================================
# 核心：build_summary()
# ============================================================================

def build_summary(
    dimensions: dict[str, dict],
    meta: dict,
    org: str,
    agent_full: str,
    years: list[int],
) -> SummaryJson:
    """从 run_all() 的 title-keyed dict 构建 summary.json。"""

    latest_year = max(years)
    anomalies: list[AnomalyItem] = []
    drilldowns: list[DrilldownSpec] = []
    seen_drilldowns: set[str] = set()

    # -- 提取核心 KPI 数据 --
    kpi_cols, kpi_rows = dimensions["核心 KPI"]["data"]
    kpi_by_year: dict[int, dict] = {}
    for row in kpi_rows:
        d = dict(zip(kpi_cols, row))
        kpi_by_year[int(d["年份"])] = d

    latest_kpi = kpi_by_year.get(latest_year, {})
    loss_ratio = float(latest_kpi.get("满期赔付率") or 0)
    expense_ratio = float(latest_kpi.get("费用率") or 0)
    vc = loss_ratio + expense_ratio
    earned_premium = float(latest_kpi.get("满期保费") or 0)
    premium = float(latest_kpi.get("签单保费") or 0)
    margin_wan = round(earned_premium * (1 - vc / 100) / 10000, 1)
    sample_size = int(latest_kpi.get("总记录数") or 0)
    policy_count = int(latest_kpi.get("总保单数") or 0)

    # -- L1 verdict --
    if vc < TH_VC[0]:       # < 85
        verdict = "earn"
    elif vc > TH_VC[2]:     # > 94
        verdict = "loss"
    else:
        verdict = "marginal"

    # -- benchmark 数据 --
    bench_cols, bench_rows = dimensions["经代 vs 机构整体"]["data"]
    org_kpi_by_year: dict[int, dict] = {}
    agent_kpi_by_year: dict[int, dict] = {}
    for row in bench_rows:
        d = dict(zip(bench_cols, row))
        yr = int(d["年份"])
        if d["维度"] == "机构整体":
            org_kpi_by_year[yr] = d
        else:
            agent_kpi_by_year[yr] = d

    org_latest = org_kpi_by_year.get(latest_year, {})
    org_premium = float(org_latest.get("签单保费") or 1)
    benchmark_ratio = round(premium / org_premium * 100, 1) if org_premium else 0
    org_loss_ratio = float(org_latest.get("满期赔付率") or 0)
    org_expense_ratio = float(org_latest.get("费用率") or 0)

    # -- 异常检测规则 --

    def _add_anomaly(dim: str, metric: str, year: int, value: float,
                     benchmark: float, severity: str):
        anomalies.append(AnomalyItem(
            dim=dim, metric=metric, year=year,
            value=round(value, 1), benchmark=round(benchmark, 1),
            deviation=round(value - benchmark, 1), severity=severity,
        ))

    def _suggest_drilldown(spec: str, reason: str, priority: int = 1):
        if spec not in seen_drilldowns:
            seen_drilldowns.add(spec)
            drilldowns.append(DrilldownSpec(spec=spec, reason=reason, priority=priority))

    # R01: 变动成本率（复用 TH_VC）
    sev = _severity_from_thresholds(vc, TH_VC)
    if sev:
        _add_anomaly("核心 KPI", "变动成本率", latest_year, vc, TH_VC[0], sev)
        if sev in ("danger", "warn"):
            _suggest_drilldown("险类×客户类别",
                               f"变动成本率 {vc:.1f}% 超标，需按险类和客户类别定位", 1)

    # R02: 满期赔付率（复用 TH_LR）
    sev = _severity_from_thresholds(loss_ratio, TH_LR)
    if sev:
        _add_anomaly("核心 KPI", "满期赔付率", latest_year, loss_ratio, TH_LR[0], sev)
        if sev == "danger":
            _suggest_drilldown("险类×客户类别",
                               f"赔付率 {loss_ratio:.1f}% 达危险线，需按客户类别拆分", 1)

    # R03: 费用率 vs 机构同期（动态基准）
    fee_dev = expense_ratio - org_expense_ratio
    sev = _severity_from_deviation(fee_dev)
    if sev:
        _add_anomaly("核心 KPI", "费用率", latest_year, expense_ratio, org_expense_ratio, sev)
        if sev in ("danger", "warn"):
            _suggest_drilldown("险别组合×年份",
                               f"费用率 {expense_ratio:.1f}% 偏离机构 {org_expense_ratio:.1f}%", 2)

    # R04: 经代 vs 机构赔付率（动态基准）
    lr_dev = loss_ratio - org_loss_ratio
    sev = _severity_from_deviation(lr_dev)
    if sev:
        _add_anomaly("经代 vs 机构整体", "赔付率偏离", latest_year, loss_ratio, org_loss_ratio, sev)

    # R05: 商业险赔付率
    ins_cols, ins_rows = dimensions["险类分拆"]["data"]
    for row in ins_rows:
        d = dict(zip(ins_cols, row))
        if int(d["年份"]) == latest_year and d["险类"] == "商业保险":
            comm_lr = float(d.get("满期赔付率") or 0)
            sev = _severity_from_thresholds(comm_lr, TH_LR)
            if sev:
                _add_anomaly("险类分拆", "商业险赔付率", latest_year, comm_lr, TH_LR[0], sev)
                if sev in ("danger", "warn"):
                    _suggest_drilldown("客户类别×年份",
                                       f"商业险赔付率 {comm_lr:.1f}% 异常", 1)

    # R06: 件均保费 YoY
    prev_year = latest_year - 1
    if prev_year in kpi_by_year and latest_year in kpi_by_year:
        prev_prem_per = float(kpi_by_year[prev_year].get("日均保费") or 0)
        curr_prem_per = float(kpi_by_year[latest_year].get("日均保费") or 0)
        if prev_prem_per > 0:
            change_pct = (curr_prem_per - prev_prem_per) / prev_prem_per * 100
            if change_pct < -15:
                _add_anomaly("核心 KPI", "件均保费YoY", latest_year, change_pct, 0, "warn")
            elif change_pct < -10:
                _add_anomaly("核心 KPI", "件均保费YoY", latest_year, change_pct, 0, "notice")

    # R07: 续保率 YoY（反事实检查指标）
    if prev_year in kpi_by_year and latest_year in kpi_by_year:
        prev_renewal = float(kpi_by_year[prev_year].get("续保率") or 0)
        curr_renewal = float(kpi_by_year[latest_year].get("续保率") or 0)
        renewal_drop = prev_renewal - curr_renewal
        if renewal_drop > 10:
            _add_anomaly("核心 KPI", "续保率下降", latest_year, curr_renewal, prev_renewal, "notice")

    # R08: 保费规模暴增（反事实检查指标）
    if prev_year in kpi_by_year and latest_year in kpi_by_year:
        prev_premium = float(kpi_by_year[prev_year].get("签单保费") or 0)
        curr_premium = float(kpi_by_year[latest_year].get("签单保费") or 0)
        if prev_premium > 0 and curr_premium / prev_premium > 3.0:
            growth_pct = round((curr_premium / prev_premium - 1) * 100, 0)
            _add_anomaly("核心 KPI", "保费暴增", latest_year, growth_pct, 100, "notice")

    # -- anomalies 按 abs(deviation) 降序排列 --
    anomalies.sort(key=lambda a: abs(a["deviation"]), reverse=True)

    # -- 构建 L2（各维度原始数据，转为可序列化 dict）--
    l2: dict[str, Any] = {}
    for title, dim_data in dimensions.items():
        cols, rows = dim_data["data"]
        l2[title] = [dict(zip(cols, row)) for row in rows]

    # -- 组装 --
    return SummaryJson(
        meta=MetaBlock(
            generated_at=datetime.now().isoformat(),
            version="2.0",
            compare_mode=meta.get("compare_mode", "full"),
            ytd_cutoff=meta.get("ytd_cutoff"),
            source_path=meta.get("source_path", ""),
            cli_args=meta.get("cli_args", {}),
        ),
        L0=IdentityBlock(
            org=org,
            agent=agent_full,
            years=years,
            latest_year=latest_year,
            scale_wan=round(premium / 10000, 1),
            policy_count=policy_count,
            benchmark_ratio=benchmark_ratio,
            sample_size=sample_size,
            small_sample=sample_size < 200,
        ),
        L1=HealthBlock(
            variable_cost_ratio=round(vc, 1),
            margin_wan=margin_wan,
            loss_ratio=round(loss_ratio, 1),
            expense_ratio=round(expense_ratio, 1),
            verdict=verdict,
        ),
        L2=l2,
        anomalies=anomalies,
        suggested_drilldowns=drilldowns,
    )
