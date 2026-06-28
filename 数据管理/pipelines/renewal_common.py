#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 共享原语（单一事实源）

数据源路径常量 + 业务口径常量 + Markdown 渲染（Report）+ 率值聚合（rate）+ 四级亮灯（light_q/light_r）。
主报告（diagnose_renewal.py / renewal_sections.py）与分公司视角（diagnose_renewal_branch.py）平等 import 本模块，
口径只定义一次，杜绝漂移。本模块为依赖叶子：只依赖 diagnose_common，不依赖任何续保业务模块。
"""

import os
import re
from pathlib import Path

from diagnose_common import fc, fi, fp, light  # noqa: F401  对外统一从本模块再导出渲染原语
from diagnose_common import KNOWN_BRANCHES, branch_paths  # 多省数据源路由 SSOT（全诊断族共用，杜绝双写）

HERE = Path(__file__).resolve().parent
# 数据根：默认脚本所在 数据管理/；环境变量 CHEXIAN_DATA_ROOT 可覆盖
# （worktree 内跑、warehouse 数据只在主仓库时，指向主仓库 数据管理/ 读数据）。
DATA_ROOT = Path(os.environ.get("CHEXIAN_DATA_ROOT") or HERE.parent)

# ---- 多省路由（ADR D5）：BRANCH_CODE=SC 读生产 fact/；非 SC 省读隔离区 validation/<省>/ ----
# SC 行为完全不变（向后兼容，默认即 SC）；非 SC 省（如 SX 山西）续保试算产物全部隔离在
# validation/<省>/，绝不碰 fact/current/。
# branch_paths / KNOWN_BRANCHES 已下沉至 diagnose_common（全诊断族数据源 SSOT），本模块复用，
# 杜绝「续保 vs 诊断脚本各自维护路由」的双写漂移（2026-06-28 技能层省份隔离收口）。
BRANCH_CODE = (os.environ.get("BRANCH_CODE") or "SC").strip() or "SC"

# ---- 数据源（全部只读 Parquet）：经 diagnose_common.branch_paths() 路由（含未知省 fail-closed）----
_PATHS = branch_paths(BRANCH_CODE)
RT = _PATHS["renewal_tracker"]
POL = _PATHS["policy_glob"]
Q = _PATHS["quotes"]
# 报告落地：DATA_ROOT 基准（续保历史输出位置，与 diagnose 的 PROJECT_ROOT 基准不同，故各自处理）；
# SC 无后缀向后兼容、非 SC 省加 /<省>/ 隔离
OUT_DIR = DATA_ROOT / "数据分析报告" if BRANCH_CODE == "SC" else DATA_ROOT / "数据分析报告" / BRANCH_CODE

# 责任模式默认清单路径（各省独立；未配置省份返回 None，运行时须显式传 --renewal-list）
DEFAULT_LIST = {
    "SC": Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/四川5-7月 - 智能表.xlsx",
    # SX 山西：无默认清单路径，必须显式传 --renewal-list
}.get(BRANCH_CODE)

# ---- 业务口径常量（按省字典 + 访问器；新增省份须补齐每个字典，否则模块加载自检报错）----
# 报价窗口起点：convert_renewal_tracker.py 经 quote_window_start_for() 共用本字典、不再各自定义，
# 修复 SSOT 双写漂移（曾 SC=12-03 / convert_renewal_tracker 默认值未分省致 SX tracker 截断 2 天 · review HIGH-2）。
_QUOTE_WINDOW_START_BY_BRANCH = {
    "SC": "2025-12-03",
    "SX": "2025-12-01",  # 山西实际报价数据起点（duckdb MIN(quote_time) 验证，2026-06-28）
}


def quote_window_start_for(branch):
    """省份 → 报价窗口起点（YYYY-MM-DD）。多省 SSOT 访问器，供 convert_renewal_tracker ETL 共用。"""
    return _QUOTE_WINDOW_START_BY_BRANCH[branch]


QUOTE_WINDOW_START = quote_window_start_for(BRANCH_CODE)
TELESALES_TERMINAL = "0110融合销售"  # 项目设定：终端来源=融合销售即电销（当前全省统一口径）
POOL_LEAD_DEFAULT = 30              # 可续期窗口默认提前期（天）；四川当前规则 30 天，其他省按实际调 --pool-lead-days
SMALL_ORG_SALESMEN = 10            # <10 业务员 = 小机构（直列业务员，当前全省统一）

# 亮灯阈值 (关注, 预警, 危险)；报价率/续保率越高越好 → light(higher_worse=False)
# 当前全省统一阈值；各省业务考核标准确认后可按省分化（届时改为按省字典 + 纳入下方自检）
TH_QUOTE = (90, 80, 70)
TH_RENEW = (75, 65, 55)

# 已到期最终续保率目标（业务给定的对标基准，单位 %）。结论以此为锚给出「差多少个百分点」。
_TARGET_MATURED_RENEWAL_RATE_BY_BRANCH = {
    "SC": 58,
    "SX": 58,  # 暂定与四川一致（2026-06-28 用户确认）；山西正式考核基准确定后更新
}
TARGET_MATURED_RENEWAL_RATE = _TARGET_MATURED_RENEWAL_RATE_BY_BRANCH[BRANCH_CODE]

# 可续期规则标签（报告正文替代硬编码"四川规则"）。与 KNOWN_BRANCHES 同处定义为 SSOT，
# 杜绝下游模块各自维护致键集漂移（曾在 diagnose_renewal_branch.py 独立定义 · review HIGH-1）。
_RULE_LABEL_BY_BRANCH = {
    "SC": "四川规则",
    "SX": "山西规则",
}
RULE_LABEL = _RULE_LABEL_BY_BRANCH[BRANCH_CODE]

# ---- 多省配置一致性自检（fail-closed · review HIGH-1）----
# 每个「缺键即 KeyError 崩溃」的按省字典必须覆盖全部已注册省份；任意省份启动时即暴露
# 「某省漏配」，而非等切到该省才运行期崩溃。DEFAULT_LIST 用 .get()（缺省返回 None）故不纳入。
for _cfg_name, _cfg_keys in (
    ("_QUOTE_WINDOW_START_BY_BRANCH", _QUOTE_WINDOW_START_BY_BRANCH),
    ("_TARGET_MATURED_RENEWAL_RATE_BY_BRANCH", _TARGET_MATURED_RENEWAL_RATE_BY_BRANCH),
    ("_RULE_LABEL_BY_BRANCH", _RULE_LABEL_BY_BRANCH),
):
    _missing = KNOWN_BRANCHES - set(_cfg_keys)
    if _missing:
        raise RuntimeError(
            f"多省配置 {_cfg_name} 缺少已注册省份 {sorted(_missing)} 的条目；"
            "新增省份须同步补齐每个按省字典（renewal_common 多省 SSOT）。"
        )


def _parse_categories(arg):
    """逗号分隔的客户类别参数 → 去空白的非空值列表。"""
    return [c.strip() for c in (arg or "").split(",") if c.strip()]


def customer_category_clause(arg):
    """构造客户类别 WHERE 子句（精确 IN 匹配，支持逗号分隔多值）。

    客户类别是 10 个固定枚举值（非营业个人客车/非营业货车/营业货车…），故用 IN 精确匹配而非
    org/team 的 ILIKE 模糊匹配，避免「非营业个人客车」误伤「非营业企业客车」。值对单引号转义
    （memory domain_duckdb_string_escaping）。三处 where 注入（主报告/分公司视角/三级机构视角）
    共用本函数，单一事实源杜绝漂移。arg 为空 → 返回 None（不筛选）。
    """
    cats = _parse_categories(arg)
    if not cats:
        return None
    quoted = ", ".join("'" + c.replace("'", "''") + "'" for c in cats)
    return f"customer_category IN ({quoted})"


def customer_category_label(arg):
    """报告头/scope 用的客户类别显示标签（顿号连接），空则空串。"""
    return "、".join(_parse_categories(arg))


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


def pp(v):
    """百分点格式（用于「缺口 / 拉低幅度」等差值，与表示水平的 fp「%」区分）：
    20.0 → '20个点'、12.7 → '12.7个点'、None → '-'。整数省略小数位，更简洁有力（用户 2026-06-08）。"""
    if v is None:
        return "-"
    v = round(v, 1)
    return f"{v:.0f}个点" if v == int(v) else f"{v:.1f}个点"


# ---- 续保经营专项指标注册（单一事实源 · 防口径漂移）----
# 「当月已到期续保表」在基础漏斗（应续 / 已报价 / 已续保）之上派生三项缺口指标。
# 注册于此口径叶子，渲染层只引用、不另行计算，保证「同名同算」不漂移。
#
# 续保影响度遵循「先聚合后计算」：先按分类（机构 / 团队 / 业务员 …）聚合各件数，
# 再以「该次分类的合计应续件数」为分母相除 —— 通用，什么分类就按什么合计。
# 可加和性：各分类续保影响度之和 = 整体续保缺口（1 − 整体续保率）。
MATURED_GLOSSARY = [
    ("应续件数", "窗口内落入到期范围的去重车架号数", "COUNT(DISTINCT 车架号)"),
    ("已报价件数", "应续车中至少有过一次有效报价的件数", "SUM(是否已报价)"),
    ("已续保件数", "应续车中已签单续保（匹配到续保单号）的件数", "SUM(是否已续保)"),
    ("未报价件数", "应续车中至今无任何有效报价的件数", "应续件数 − 已报价件数"),
    ("流失件数", "应续车中尚未续保的件数（含未报价 + 已报价未成交）", "应续件数 − 已续保件数"),
    ("报价率", "已报价占应续的比例", "已报价件数 ÷ 应续件数"),
    ("续保率", "已续保占应续的比例（已到期窗口即最终留存）", "已续保件数 ÷ 应续件数"),
    ("续保影响度", "该分类流失导致整体续保缺口扩大的占比（可加和，各分类之和 = 整体续保缺口；越高越坏）",
     "流失件数 ÷ 合计应续件数（先按分类聚合各件数，再相除）"),
]


def funnel_derived(yc, q, r):
    """已到期漏斗派生件数（「先聚合后计算」的计算环节）。
    入参为某一分类已聚合的 应续 / 已报价 / 已续保 件数，返回 未报价 / 流失件数。"""
    q, r = q or 0, r or 0
    return {"unquoted": yc - q, "lost": yc - r}


def impact_rate(lost, total_yc):
    """续保影响度 = 流失件数 ÷ 合计应续件数（total_yc = 当前分类维度的合计应续件数）。"""
    return round(100.0 * lost / total_yc, 1) if total_yc else None


def disp_team(t):
    """团队名展示：NULL / 'nan' / 空 → 「未分组」。"""
    return t if t and str(t).strip().lower() not in ("nan", "none", "") else "（未分组）"


# ---- 业务员显示名清洗（单一事实源，用户 2026-06-07 / 06-08 / 06-21）----
# 报告里业务员只显示中文名，禁止出现工号编码。policy.salesman_name = 「工号+姓名」（如
# 200045244李晓琴）。清洗规则：① admin<机构>直接个代 → 「直接个代」（个代直营归并）；
# ② 其余剥离全部数字 → 只留中文名。主报告（renewal_sections.build_base）与分公司/三级机构
# 视角（diagnose_renewal_branch.raw）共用本口径，杜绝「有的清洗、有的不清洗」漂移。
# 团队名（team_name）本身为中文（业务员维度表派生），由 disp_team 处理空值，无需去编码。
def salesman_display_sql(col="salesman_name"):
    """返回清洗业务员名的 DuckDB SQL 表达式（SELECT/GROUP BY 内联）。"""
    return (f"CASE WHEN {col} LIKE 'admin%直接个代' THEN '直接个代' "
            f"ELSE REGEXP_REPLACE({col}, '[0-9]', '', 'g') END")


def clean_salesman(name):
    """业务员名清洗（Python 版，与 salesman_display_sql 同口径，供非 SQL 渲染/后处理）。"""
    if not name:
        return name
    s = str(name)
    if s.startswith("admin") and s.endswith("直接个代"):
        return "直接个代"
    return re.sub(r"[0-9]", "", s)
