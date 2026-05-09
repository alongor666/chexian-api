"""单测：FieldSpec 渲染与字段集结构（覆盖 codex 审计 #3、#4）。"""
from __future__ import annotations

import datetime
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import field_spec as fs  # noqa: E402


# ---------------------------------------------------------------------------
# Renderer 行为
# ---------------------------------------------------------------------------
def test_render_text_array_format() -> None:
    """文本字段必须返回 [{"type":"text","text":"..."}]，符合 wecom-cli schema。"""
    out = fs.render_text("川A12345")
    assert out == [{"type": "text", "text": "川A12345"}]


def test_render_text_skip_when_empty() -> None:
    assert fs.render_text(None) is fs.SENTINEL_SKIP
    assert fs.render_text("") is fs.SENTINEL_SKIP
    assert fs.render_text("   ") is fs.SENTINEL_SKIP


def test_render_force_text_keeps_empty_for_user_fillin() -> None:
    """姓名/跟进备注列必须保留空字符串占位（业务员要看到列存在）。"""
    out = fs.render_force_text("")
    assert out == [{"type": "text", "text": ""}]
    out = fs.render_force_text(None)
    assert out == [{"type": "text", "text": ""}]


def test_render_number_handles_nan_none() -> None:
    """NaN/None/无法转 → SENTINEL_SKIP（add_records 时不传该字段）。"""
    assert fs.render_number(None) is fs.SENTINEL_SKIP
    assert fs.render_number(float("nan")) is fs.SENTINEL_SKIP
    assert fs.render_number("abc") is fs.SENTINEL_SKIP
    assert fs.render_number(1820.5) == 1820.5
    assert fs.render_number("0.65") == 0.65


def test_render_single_select_array_format() -> None:
    out = fs.render_single_select("已联系")
    assert out == [{"text": "已联系"}]


def test_render_date_outputs_yyyy_mm_dd_string() -> None:
    """codex #3：日期必须是 YYYY-MM-DD 字符串，不能是 epoch ms（webhook 模型）。"""
    assert fs.render_date(datetime.date(2026, 5, 15)) == "2026-05-15"
    assert fs.render_date(datetime.datetime(2026, 5, 15, 10, 30)) == "2026-05-15"
    assert fs.render_date("2026-05-15") == "2026-05-15"
    assert fs.render_date(None) is fs.SENTINEL_SKIP
    assert fs.render_date("") is fs.SENTINEL_SKIP


def test_render_url_array_format() -> None:
    out = fs.render_url("https://doc.weixin.qq.com/x", text="张三")
    assert out == [{"type": "url", "link": "https://doc.weixin.qq.com/x", "text": "张三"}]
    assert fs.render_url(None) is fs.SENTINEL_SKIP


def test_render_checkbox_bool() -> None:
    assert fs.render_checkbox(True) is True
    assert fs.render_checkbox(False) is False
    assert fs.render_checkbox(None) is False
    assert fs.render_checkbox(1) is True


# ---------------------------------------------------------------------------
# WORKBENCH_FIELDS 结构
# ---------------------------------------------------------------------------
def test_workbench_fields_has_20_columns() -> None:
    assert len(fs.WORKBENCH_FIELDS) == 20


def test_workbench_first_column_is_姓名_text() -> None:
    """第 1 列必须是 FIELD_TYPE_TEXT，因为新建子表的默认字段是文本类型，
    update_fields 不允许改类型。"""
    assert fs.WORKBENCH_FIELDS[0].title == "姓名"
    assert fs.WORKBENCH_FIELDS[0].field_type == fs.FIELD_TYPE_TEXT


def test_workbench_followup_status_is_single_select_with_default_未联系() -> None:
    spec = next(s for s in fs.WORKBENCH_FIELDS if s.title == "跟进状态")
    assert spec.field_type == fs.FIELD_TYPE_SINGLE_SELECT
    rendered = spec.renderer({})
    assert rendered == [{"text": "未联系"}]


def test_workbench_field_types_in_schema_enum() -> None:
    """所有 FieldSpec.field_type 必须在 wecom-cli schema 的 enum 中。
    schema enum（实测自 wecom-cli doc smartsheet_add_fields --schema）："""
    schema_enum = {
        "FIELD_TYPE_TEXT", "FIELD_TYPE_NUMBER", "FIELD_TYPE_CHECKBOX",
        "FIELD_TYPE_DATE_TIME", "FIELD_TYPE_IMAGE", "FIELD_TYPE_ATTACHMENT",
        "FIELD_TYPE_USER", "FIELD_TYPE_URL", "FIELD_TYPE_SELECT",
        "FIELD_TYPE_PROGRESS", "FIELD_TYPE_PHONE_NUMBER", "FIELD_TYPE_EMAIL",
        "FIELD_TYPE_SINGLE_SELECT", "FIELD_TYPE_LOCATION", "FIELD_TYPE_CURRENCY",
        "FIELD_TYPE_PERCENTAGE", "FIELD_TYPE_BARCODE",
    }
    for spec in (*fs.WORKBENCH_FIELDS, *fs.KPI_FIELDS, *fs.DETAIL_FIELDS):
        assert spec.field_type in schema_enum, f"{spec.title} 类型 {spec.field_type} 不在 schema 中"


def test_kpi_fields_has_10_columns_first_is_业务员_text() -> None:
    assert len(fs.KPI_FIELDS) == 10
    assert fs.KPI_FIELDS[0].title == "业务员"
    assert fs.KPI_FIELDS[0].field_type == fs.FIELD_TYPE_TEXT


# ---------------------------------------------------------------------------
# build_record_values 集成
# ---------------------------------------------------------------------------
def test_build_record_values_skips_sentinel() -> None:
    row = {
        "vehicle_frame_no": "VIN0001",
        "expiry_date": datetime.date(2026, 5, 15),
        "renewed_sign_date": None,           # 应跳过
        "earliest_quote_date": None,         # 应跳过
        "prior_premium": float("nan"),       # 应跳过
        "is_quoted": True,
        "is_renewed": False,
    }
    values = fs.build_record_values(row, fs.WORKBENCH_FIELDS)
    assert "续回日期" not in values
    assert "报价日期" not in values
    assert "上年保费" not in values
    assert values["到期日"] == "2026-05-15"
    assert values["车架号"] == [{"type": "text", "text": "VIN0001"}]
    assert values["报价"] == [{"text": "是"}]
    assert values["跟进状态"] == [{"text": "未联系"}]
    # 姓名 / 跟进备注用 force_text，必须存在且为空
    assert values["姓名"] == [{"type": "text", "text": ""}]
    assert values["跟进备注"] == [{"type": "text", "text": ""}]


# ---------------------------------------------------------------------------
# 填报率口径（codex #4 全文唯一定义）
# ---------------------------------------------------------------------------
def test_is_filled_excludes_未联系_and_empty() -> None:
    assert fs.is_filled("") is False
    assert fs.is_filled(None) is False
    assert fs.is_filled("未联系") is False
    assert fs.is_filled("已联系") is True
    assert fs.is_filled("已报价") is True
    assert fs.is_filled("已续保") is True


def test_calc_fillin_rate() -> None:
    assert fs.calc_fillin_rate([]) == 0.0
    assert fs.calc_fillin_rate(["未联系"] * 10) == 0.0
    assert fs.calc_fillin_rate(["未联系", "已联系"]) == 50.0
    assert fs.calc_fillin_rate(["已联系", "已报价", "已续保"]) == 100.0
    # 4/10 = 40%
    assert fs.calc_fillin_rate(["未联系"] * 6 + ["已联系"] * 4) == 40.0


# ---------------------------------------------------------------------------
# FieldSpec 防御
# ---------------------------------------------------------------------------
def test_invalid_field_type_raises() -> None:
    import pytest
    with pytest.raises(ValueError, match="field_type 非法"):
        fs.FieldSpec("X", "FIELD_TYPE_NOT_EXIST", renderer=lambda r: "x")
