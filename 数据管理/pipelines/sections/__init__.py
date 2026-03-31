#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
板块注册表 — diagnose_vehicle.py 的可插拔板块系统

每个板块实现统一签名: run(ctx, rpt, collected, silent=False) -> dict
"""

from sections import (
    s01_overview,
    s02_vehicle_type,
    s03_energy,
    s04_risk_grade,
    s05_quarter,
    s06_insurance_type,
    s07_combo,
    s08_customer,
    s09_summary,
)

SECTION_REGISTRY = {
    1: s01_overview,
    2: s02_vehicle_type,
    3: s03_energy,
    4: s04_risk_grade,
    5: s05_quarter,
    6: s06_insurance_type,
    7: s07_combo,
    8: s08_customer,
    9: s09_summary,
}

SECTION_NAMES = {
    1: "整体经营概况",
    2: "新转续过户维度",
    3: "能源类型",
    4: "风险评分",
    5: "季度趋势",
    6: "险类",
    7: "险别组合",
    8: "客户类别",
    9: "诊断总结",
}

ALL_SECTION_IDS = sorted(SECTION_REGISTRY.keys())
