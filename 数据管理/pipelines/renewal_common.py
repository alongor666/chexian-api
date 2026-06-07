#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 共享原语（单一事实源）

数据源路径常量 + 业务口径常量 + Markdown 渲染（Report）+ 率值聚合（rate）+ 四级亮灯（light_q/light_r）。
主报告（diagnose_renewal.py / renewal_sections.py）与分公司视角（diagnose_renewal_branch.py）平等 import 本模块，
口径只定义一次，杜绝漂移。本模块为依赖叶子：只依赖 diagnose_common，不依赖任何续保业务模块。
"""

from pathlib import Path

from diagnose_common import fc, fi, fp, light  # noqa: F401  对外统一从本模块再导出渲染原语

HERE = Path(__file__).resolve().parent
DATA_ROOT = HERE.parent

# ---- 数据源（全部只读 Parquet）----
RT = str(DATA_ROOT / "warehouse" / "fact" / "renewal_tracker" / "latest.parquet")
POL = str(DATA_ROOT / "warehouse" / "fact" / "policy" / "current" / "*.parquet")
Q = str(DATA_ROOT / "warehouse" / "fact" / "quotes_conversion" / "latest.parquet")
OUT_DIR = DATA_ROOT / "数据分析报告"
DEFAULT_LIST = (
    Path.home()
    / "Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/四川5-7月 - 智能表.xlsx"
)

# ---- 业务口径常量 ----
QUOTE_WINDOW_START = "2025-12-03"   # 与 convert_renewal_tracker.py 报价窗口对齐
TELESALES_TERMINAL = "0110融合销售"  # 项目设定：终端来源=融合销售即电销
POOL_LEAD_DEFAULT = 30              # 进盘锚点默认提前期（天）；数据显示行动窗口约到期前 30 天
SMALL_ORG_SALESMEN = 10            # <10 业务员 = 小机构（直列业务员）

# 亮灯阈值 (关注, 预警, 危险)；报价率/续回率越高越好 → light(higher_worse=False)
TH_QUOTE = (90, 80, 70)
TH_RENEW = (75, 65, 55)


class Report:
    """累加 Markdown 行的轻量渲染器。"""

    def __init__(self):
        self.lines = []

    def add(self, text=""):
        self.lines.append(text)

    def table(self, headers, rows, aligns=None):
        self.add("| " + " | ".join(headers) + " |")
        self.add("|" + "|".join(aligns if aligns else ["---"] * len(headers)) + "|")
        for r in rows:
            self.add("| " + " | ".join(str(c) for c in r) + " |")
        self.add()

    def concl(self, text):
        self.add(f"**结论**：{text}")
        self.add()

    def text(self):
        return "\n".join(self.lines)


def light_q(v):
    """报价率亮灯（越高越好）。"""
    return light(v, TH_QUOTE, higher_worse=False)


def light_r(v):
    """续回率亮灯（越高越好）。"""
    return light(v, TH_RENEW, higher_worse=False)


def rate(num, den):
    """率值聚合铁律：SUM(分子)/SUM(分母)，分母为 0 返回 None。"""
    return round(100.0 * num / den, 1) if den else None


def disp_team(t):
    """团队名展示：NULL / 'nan' / 空 → 「未分组」。"""
    return t if t and str(t).strip().lower() not in ("nan", "none", "") else "（未分组）"
