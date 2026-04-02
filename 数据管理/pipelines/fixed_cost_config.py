#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
固定成本参数加载模块 — 读取 fixed-cost-params.json，生成 DuckDB SQL 片段

被 diagnose_vehicle.py / diagnose_agent.py 调用。
参数含时间属性 effective_date，按分析截止日筛选当前有效版本。

参数来源: 数据管理/config/fixed-cost-params.json
"""

import json
from datetime import date
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "fixed-cost-params.json"


def _pick_latest(history: list, as_of: date = None) -> dict | None:
    """从 history 数组中选取 effective_date <= as_of 的最新条目"""
    as_of = as_of or date.today()
    as_of_str = as_of.isoformat()
    valid = [e for e in history if e.get("effective_date", "9999") <= as_of_str]
    return max(valid, key=lambda e: e["effective_date"]) if valid else None


def load(as_of: date = None) -> dict | None:
    """加载并解析固定成本参数，返回扁平化 dict；配置文件不存在则返回 None（优雅降级）"""
    if not CONFIG_PATH.exists():
        return None

    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    surcharge = _pick_latest(raw.get("surcharge_rate", []), as_of)
    promotion = _pick_latest(raw.get("promotion_rate", []), as_of)
    mgmt = _pick_latest(raw.get("mgmt_cost_rate", []), as_of)

    if not surcharge or not promotion or not mgmt:
        return None

    mgmt_rates = mgmt["rates"]
    # 计算全公司均值作为"其他"机构的默认值（简单算术均值）
    mgmt_values = list(mgmt_rates.values())
    mgmt_default = round(sum(mgmt_values) / len(mgmt_values), 4) if mgmt_values else 0.085

    return {
        "surcharge": surcharge["rate"],
        "promotion": {
            "交强险": promotion["交强险"],
            "商业险": promotion["商业险"],
            "人身险": promotion.get("人身险", 0.0074),
        },
        "mgmt_rates": mgmt_rates,
        "mgmt_default": mgmt_default,
    }


def build_fixed_cost_sql(params: dict) -> dict:
    """从参数生成 DuckDB SQL 片段（per-record 计算列）

    返回 dict:
      - tax: 附加税费 per record
      - promo: 推动费 per record
      - mgmt: 管理费 per record
      - fixed_total: 固定成本合计 per record
    """
    surcharge = params["surcharge"]
    promo_cq = params["promotion"]["交强险"]
    promo_sy = params["promotion"]["商业险"]
    mgmt_rates = params["mgmt_rates"]
    mgmt_default = params["mgmt_default"]

    tax_sql = f"保费 * {surcharge}"

    promo_sql = (
        f"CASE WHEN 险类 = '交强险' THEN 保费 * {promo_cq} "
        f"WHEN 险类 = '商业保险' THEN 保费 * {promo_sy} "
        f"ELSE 0 END"
    )

    mgmt_cases = " ".join(
        f"WHEN '{org}' THEN 保费 * {rate}"
        for org, rate in mgmt_rates.items()
    )
    mgmt_sql = f"CASE 三级机构 {mgmt_cases} ELSE 保费 * {mgmt_default} END"

    fixed_total = f"(({tax_sql}) + ({promo_sql}) + ({mgmt_sql}))"

    return {
        "tax": tax_sql,
        "promo": promo_sql,
        "mgmt": mgmt_sql,
        "fixed_total": fixed_total,
    }
