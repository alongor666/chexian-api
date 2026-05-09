"""WeCom 智能表格字段规格 — 与 wecom-cli `doc smartsheet_*` 命令对齐。

⚠️ 不要复用 sync_renewal.py 的 DEFAULT_SCHEMA / build_record（webhook 模型）。
   两者写入接口不同：
   - webhook：key=field_id，日期=epoch_ms，文本=纯字符串
   - wecom-cli：key=field_title，日期='YYYY-MM-DD'，文本=[{"type":"text","text":"..."}]

本模块只面向 wecom-cli。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable

# ---------------------------------------------------------------------------
# 字段类型常量（实测自 `wecom-cli doc smartsheet_add_fields --schema`）
# ---------------------------------------------------------------------------
FIELD_TYPE_TEXT = "FIELD_TYPE_TEXT"
FIELD_TYPE_NUMBER = "FIELD_TYPE_NUMBER"
FIELD_TYPE_CHECKBOX = "FIELD_TYPE_CHECKBOX"
FIELD_TYPE_DATE_TIME = "FIELD_TYPE_DATE_TIME"
FIELD_TYPE_URL = "FIELD_TYPE_URL"
FIELD_TYPE_SINGLE_SELECT = "FIELD_TYPE_SINGLE_SELECT"
FIELD_TYPE_SELECT = "FIELD_TYPE_SELECT"
FIELD_TYPE_PERCENTAGE = "FIELD_TYPE_PERCENTAGE"
FIELD_TYPE_PROGRESS = "FIELD_TYPE_PROGRESS"
FIELD_TYPE_CURRENCY = "FIELD_TYPE_CURRENCY"

VALID_FIELD_TYPES: frozenset[str] = frozenset({
    FIELD_TYPE_TEXT, FIELD_TYPE_NUMBER, FIELD_TYPE_CHECKBOX,
    FIELD_TYPE_DATE_TIME, FIELD_TYPE_URL, FIELD_TYPE_SINGLE_SELECT,
    FIELD_TYPE_SELECT, FIELD_TYPE_PERCENTAGE, FIELD_TYPE_PROGRESS,
    FIELD_TYPE_CURRENCY,
})

# 跟进状态选项（业务员手填）
FOLLOWUP_DEFAULT = "未联系"
FOLLOWUP_OPTIONS: tuple[str, ...] = (
    "未联系", "已联系", "已报价", "已续保", "拒保", "失联",
)


# ---------------------------------------------------------------------------
# 渲染工具（把 Python 值转成 wecom-cli add_records / update_records 期望的格式）
# ---------------------------------------------------------------------------
SENTINEL_SKIP = object()
"""renderer 返回此哨兵 → 该字段在 payload 里不出现（None/NaN 等）。"""


def render_text(value: Any) -> Any:
    """文本字段必须是 [{"type":"text","text":"..."}]。空值返回 SENTINEL_SKIP（不传该列）。"""
    if value is None:
        return SENTINEL_SKIP
    text = str(value).strip()
    if not text:
        return SENTINEL_SKIP
    return [{"type": "text", "text": text}]


def render_force_text(value: Any) -> list[dict[str, str]]:
    """文本字段，空字符串也写入（用于业务员手填的占位列：姓名/跟进备注）。"""
    text = "" if value is None else str(value)
    return [{"type": "text", "text": text}]


def render_number(value: Any) -> Any:
    """数字字段：直接返回 float；None/NaN/无法转 → SENTINEL_SKIP。"""
    if value is None:
        return SENTINEL_SKIP
    try:
        as_float = float(value)
    except (TypeError, ValueError):
        return SENTINEL_SKIP
    if math.isnan(as_float):
        return SENTINEL_SKIP
    return round(as_float, 6)


def render_checkbox(value: Any) -> bool:
    return bool(value)


def render_single_select(option: str) -> Any:
    """单选字段必须是 [{"text":"选项内容"}]。"""
    if option is None:
        return SENTINEL_SKIP
    text = str(option).strip()
    if not text:
        return SENTINEL_SKIP
    return [{"text": text}]


def render_date(value: Any) -> Any:
    """日期字段直接传 'YYYY-MM-DD' 字符串。
    pandas NaT/None/空字符串/无法格式化 → SENTINEL_SKIP（不传该列）。"""
    if value is None:
        return SENTINEL_SKIP
    # pandas.NaT 检测：NaT != NaT，且 isinstance(NaT, datetime)=True 但 strftime 抛 NaTType
    try:
        import pandas as _pd  # 局部 import，避免硬依赖
        if _pd.isna(value):
            return SENTINEL_SKIP
    except (ImportError, TypeError, ValueError):
        pass
    if isinstance(value, str):
        s = value.strip()
        return s if s else SENTINEL_SKIP
    if isinstance(value, datetime):
        try:
            return value.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            return SENTINEL_SKIP
    if isinstance(value, date):
        try:
            return value.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            return SENTINEL_SKIP
    if hasattr(value, "to_pydatetime"):
        try:
            return value.to_pydatetime().strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            return SENTINEL_SKIP
    return SENTINEL_SKIP


def render_url(link: str | None, text: str | None = None) -> Any:
    """超链接 [{"type":"url","link":"...","text":"..."}]。link 为空跳过。"""
    if not link:
        return SENTINEL_SKIP
    return [{"type": "url", "link": str(link), "text": str(text) if text else str(link)}]


# ---------------------------------------------------------------------------
# FieldSpec
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class FieldSpec:
    """单个字段的规格 + 从源 row 渲染到 wecom-cli value 的逻辑。"""

    title: str
    field_type: str
    renderer: Callable[[dict[str, Any]], Any]
    """传入完整 row dict，返回符合 field_type 的 value 或 SENTINEL_SKIP。"""

    def __post_init__(self) -> None:
        if self.field_type not in VALID_FIELD_TYPES:
            raise ValueError(
                f"FieldSpec.field_type 非法: {self.field_type!r}。允许值: {sorted(VALID_FIELD_TYPES)}"
            )

    def to_add_field_payload(self) -> dict[str, str]:
        """add_fields/update_fields 用：{"field_title": ..., "field_type": ...}。"""
        return {"field_title": self.title, "field_type": self.field_type}


def build_record_values(
    row: dict[str, Any],
    fields: list[FieldSpec],
) -> dict[str, Any]:
    """根据 fields 渲染单行 → add_records/update_records 的 values 字典。

    跳过 SENTINEL_SKIP 字段，避免 wecom-cli 把空值写成空文本/0。
    """
    values: dict[str, Any] = {}
    for spec in fields:
        try:
            v = spec.renderer(row)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"字段 {spec.title!r} 渲染失败: {exc}") from exc
        if v is SENTINEL_SKIP:
            continue
        values[spec.title] = v
    return values


# ---------------------------------------------------------------------------
# 业务员独立工作台 Doc B（20 列）
# 数据源：sync_renewal.py:259 build_source_rows() 返回的 row dict
# ---------------------------------------------------------------------------
WORKBENCH_FIELDS: list[FieldSpec] = [
    FieldSpec("姓名", FIELD_TYPE_TEXT,
              renderer=lambda r: render_force_text("")),
    FieldSpec("到期日", FIELD_TYPE_DATE_TIME,
              renderer=lambda r: render_date(r.get("expiry_date"))),
    FieldSpec("三级机构", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("org_level_3"))),
    FieldSpec("销售团队", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("team_name"))),
    FieldSpec("车牌号码", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("plate_no"))),
    FieldSpec("车架号", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("vehicle_frame_no"))),
    FieldSpec("业务员", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("salesman_name"))),
    FieldSpec("客户类别", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("customer_category"))),
    FieldSpec("险别组合", FIELD_TYPE_SINGLE_SELECT,
              renderer=lambda r: render_single_select(r.get("coverage_combination"))),
    FieldSpec("报价", FIELD_TYPE_SINGLE_SELECT,
              renderer=lambda r: render_single_select("是" if r.get("is_quoted") else "否")),
    FieldSpec("上年折扣", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("prior_discount"))),
    FieldSpec("上年保费", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("prior_premium"))),
    FieldSpec("报价折扣", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("quote_discount"))),
    FieldSpec("报价保费", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("quote_premium"))),
    FieldSpec("是否续回", FIELD_TYPE_CHECKBOX,
              renderer=lambda r: render_checkbox(r.get("is_renewed"))),
    FieldSpec("续保模式", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text("未分类")),
    FieldSpec("续回日期", FIELD_TYPE_DATE_TIME,
              renderer=lambda r: render_date(r.get("renewed_sign_date"))),
    FieldSpec("报价日期", FIELD_TYPE_DATE_TIME,
              renderer=lambda r: render_date(r.get("earliest_quote_date"))),
    FieldSpec("跟进状态", FIELD_TYPE_SINGLE_SELECT,
              renderer=lambda r: render_single_select(FOLLOWUP_DEFAULT)),
    FieldSpec("跟进备注", FIELD_TYPE_TEXT,
              renderer=lambda r: render_force_text("")),
]
assert len(WORKBENCH_FIELDS) == 20, "WORKBENCH_FIELDS 应固定 20 列"
assert WORKBENCH_FIELDS[0].title == "姓名", "第 1 列必须是'姓名'（默认子表初始字段重命名锚点）"


# ---------------------------------------------------------------------------
# Doc A 全量明细子表 = WORKBENCH_FIELDS 同 20 列
# refresh 阶段从 Doc B 回拉"姓名/跟进状态/跟进备注"，这里初始值与 Doc B 一致
# ---------------------------------------------------------------------------
DETAIL_FIELDS: list[FieldSpec] = WORKBENCH_FIELDS


# ---------------------------------------------------------------------------
# Doc A KPI 子表（10 列）
# 数据源：每业务员一行的 KPI 聚合 dict
# ---------------------------------------------------------------------------
KPI_FIELDS: list[FieldSpec] = [
    FieldSpec("业务员", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("salesman_name"))),
    FieldSpec("团队", FIELD_TYPE_TEXT,
              renderer=lambda r: render_text(r.get("team_name"))),
    FieldSpec("应续件数", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("due_count"))),
    FieldSpec("应续保费(元)", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("due_premium"))),
    FieldSpec("已报价件数", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("quoted_count"))),
    FieldSpec("已续回件数", FIELD_TYPE_NUMBER,
              renderer=lambda r: render_number(r.get("renewed_count"))),
    FieldSpec("续保率", FIELD_TYPE_PERCENTAGE,
              renderer=lambda r: render_number(r.get("renewed_rate_pct"))),
    FieldSpec("报价率", FIELD_TYPE_PERCENTAGE,
              renderer=lambda r: render_number(r.get("quoted_rate_pct"))),
    FieldSpec("填报率", FIELD_TYPE_PERCENTAGE,
              renderer=lambda r: render_number(r.get("fillin_rate_pct"))),
    FieldSpec("业务员文档链接", FIELD_TYPE_URL,
              renderer=lambda r: render_url(r.get("doc_url"), text=r.get("salesman_name"))),
]
assert len(KPI_FIELDS) == 10, "KPI_FIELDS 应固定 10 列"
assert KPI_FIELDS[0].title == "业务员", "第 1 列必须是'业务员'（默认子表初始字段重命名锚点）"


# ---------------------------------------------------------------------------
# 填报率口径（全文唯一定义）
# ---------------------------------------------------------------------------
def is_filled(followup_status: Any) -> bool:
    """业务员是否已填该行跟进状态（≠ '' 且 ≠ '未联系'）。"""
    if followup_status is None:
        return False
    text = str(followup_status).strip()
    return text not in ("", FOLLOWUP_DEFAULT)


def calc_fillin_rate(rows_followup_status: list[Any]) -> float:
    """填报率 = COUNT(跟进状态 NOT IN ('', '未联系')) / 应续件数 × 100。"""
    if not rows_followup_status:
        return 0.0
    filled = sum(1 for s in rows_followup_status if is_filled(s))
    return round(filled / len(rows_followup_status) * 100, 2)


__all__ = [
    "FIELD_TYPE_TEXT", "FIELD_TYPE_NUMBER", "FIELD_TYPE_CHECKBOX",
    "FIELD_TYPE_DATE_TIME", "FIELD_TYPE_URL", "FIELD_TYPE_SINGLE_SELECT",
    "FIELD_TYPE_SELECT", "FIELD_TYPE_PERCENTAGE", "FIELD_TYPE_PROGRESS",
    "FIELD_TYPE_CURRENCY", "VALID_FIELD_TYPES",
    "FOLLOWUP_DEFAULT", "FOLLOWUP_OPTIONS",
    "FieldSpec", "SENTINEL_SKIP",
    "render_text", "render_force_text", "render_number",
    "render_checkbox", "render_single_select", "render_date", "render_url",
    "build_record_values",
    "WORKBENCH_FIELDS", "DETAIL_FIELDS", "KPI_FIELDS",
    "is_filled", "calc_fillin_rate",
]
