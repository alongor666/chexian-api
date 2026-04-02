#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诊断运行上下文 — 所有板块共享的运行时数据

被 diagnose_vehicle.py 主入口构建，传递给各 section 的 run() 函数。
"""

from dataclasses import dataclass, field
from typing import Callable, List


@dataclass
class RunContext:
    """板块间共享的运行上下文"""

    con: object                      # DuckDB 连接
    base_where: str                  # --filter 原始 WHERE 条件
    years: List[int] = field(default_factory=list)  # 年份列表
    min_yr: int = 0
    max_yr: int = 0
    yr_where: Callable = None        # lambda yr: "YEAR(签单日期)=yr AND ytd_filter"
    risk_expr: str = "车险风险等级"   # detect_risk_field() 结果
    title: str = ""
    max_sign: str = ""               # 最新签单日期
    max_start: str = ""              # 最新起保日期
    total_pol: int = 0               # 总保单数
    total_rec: int = 0               # 总记录数
    is_ytd: bool = False             # 是否同期对比
    ytd_label: str = "全年"          # YTD 标签文字
    fixed_cost_sql: dict = None      # fixed_cost_config.build_fixed_cost_sql() 返回值
