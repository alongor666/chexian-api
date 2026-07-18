"""敏感字段脱敏回归锁（PR #1129 隐私评审 F2）。

背景：sync_filtered_policies dry-run 会把前 3 条 sample_records 打印到 stdout 并
落盘 logs/*.json。投保人名称（applicant_name → ffFwIh）是个人信息，明文进入
日志属隐私泄漏。本测试锁定：
  1. mask_pii 定长脱敏（不泄漏原文与长度）；
  2. mask_sample_values 只脱敏敏感 field_id、不碰其他字段、不改原 dict；
  3. applicant_name 恒在 SENSITIVE_SOURCE_FIELDS（防止被静默移除）。
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from sync_filtered_policies import (  # noqa: E402
    SENSITIVE_SOURCE_FIELDS,
    mask_pii,
    mask_sample_values,
)


def test_applicant_name_registered_as_sensitive():
    assert "applicant_name" in SENSITIVE_SOURCE_FIELDS


def test_mask_pii_keeps_first_char_fixed_length():
    assert mask_pii("张三丰") == "张＊＊"
    assert mask_pii("王五") == "王＊＊"
    # 单位全称同样只留首字符，掩码定长不泄漏长度
    assert mask_pii("山西某某物流有限公司") == "山＊＊"


def test_mask_pii_passthrough_empty():
    assert mask_pii(None) is None
    assert mask_pii("") == ""
    assert mask_pii("   ") == "   "


def test_mask_sample_values_only_masks_sensitive_field_ids():
    values = {
        "ffFwIh": "张三丰",       # 投保人（敏感）
        "ftQMc5": "6181001031220260005831",  # 保单号（非敏感映射字段，保持原值）
        "fn8TJd": 294.91,
    }
    masked = mask_sample_values(values, {"ffFwIh"})
    assert masked["ffFwIh"] == "张＊＊"
    assert masked["ftQMc5"] == "6181001031220260005831"
    assert masked["fn8TJd"] == 294.91
    # 不可变：原 dict 不被修改
    assert values["ffFwIh"] == "张三丰"


def test_mask_sample_values_no_sensitive_ids_is_identity():
    values = {"ftQMc5": "X123", "fn8TJd": 1.0}
    assert mask_sample_values(values, set()) == values
