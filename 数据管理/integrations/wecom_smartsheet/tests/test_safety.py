"""_safety.read_cell_text —— 企微 smartsheet cell 文本提取 SSOT 测试。

read_cell_text 合并了历史两套并行实现，两种 join_list 模式分别**字节级复刻**：

  join_list=False ← create_renewal_tracker._read_text（VIN/姓名/备注单值字段；
                     list 取首元素；str/数值不 strip）
  join_list=True  ← sync_may_renewal_fields.extract_text（list 拼接全部，分隔符 ""；
                     str/数值/dict 结果 strip）

⚠️ 关键不变量：extract_text 的 list 拼接用的是 ``"".join(...)``（空串分隔），
   多元素 list-of-dict 结果是 ``"ab"`` 而**不是** ``"a,b"``。本测试锁死该语义，
   防止未来误把分隔符改成逗号破坏 sync_may_renewal_fields 的 --dry-run 行为。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from _safety import read_cell_text  # noqa: E402


# (input, expected_false, expected_true)
CELL_CASES = [
    # --- str ---
    pytest.param("abc", "abc", "abc", id="str-plain"),
    pytest.param("  abc  ", "  abc  ", "abc", id="str-whitespace-strip-only-when-join"),
    pytest.param("", "", "", id="str-empty"),
    # --- int / float / bool（str() 无空白，两模式同值）---
    pytest.param(123, "123", "123", id="int"),
    pytest.param(1.5, "1.5", "1.5", id="float"),
    pytest.param(0, "0", "0", id="int-zero"),
    pytest.param(True, "True", "True", id="bool-true"),
    pytest.param(False, "False", "False", id="bool-false"),
    # --- list-of-dict（核心差异点：取首 vs 拼接全部）---
    pytest.param([{"text": "a"}, {"text": "b"}], "a", "ab", id="list-of-dict-first-vs-joinall"),
    pytest.param([{"text": "only"}], "only", "only", id="list-of-dict-single"),
    pytest.param(
        [{"text": " a "}, {"text": " b "}],
        " a ",  # False: 取首元素原文，不 strip（复刻 _read_text）
        "ab",   # True: 每段 strip 后空串拼接（复刻 extract_text）
        id="list-of-dict-strip-semantics",
    ),
    # --- dict ---
    pytest.param({"text": "x"}, "x", "x", id="dict-text"),
    pytest.param({"value": "y"}, "y", "y", id="dict-value-fallback"),
    pytest.param({"text": "", "value": "y"}, "y", "y", id="dict-text-empty-falls-to-value"),
    pytest.param({"link": "z"}, "z", "z", id="dict-link-fallback"),
    # --- None / 空 / 其它 ---
    pytest.param(None, "", "", id="none"),
    pytest.param({}, "", "", id="dict-empty"),
    pytest.param([], "", "", id="list-empty"),
    # --- list 含非 dict 元素（防御性，真实调用方不会命中）---
    pytest.param([None, {"text": "b"}], "", "b", id="list-leading-none"),
    pytest.param([["a"], ["b"]], "a", "ab", id="list-nested"),
]


@pytest.mark.parametrize("cell,expected_false,expected_true", CELL_CASES)
def test_read_cell_text_both_modes(cell, expected_false, expected_true) -> None:
    assert read_cell_text(cell) == expected_false  # 默认 join_list=False
    assert read_cell_text(cell, join_list=False) == expected_false
    assert read_cell_text(cell, join_list=True) == expected_true


def test_default_is_join_list_false() -> None:
    """默认参数必须是 _read_text 语义（取首元素），保护 6 处旧 _read_text 调用点。"""
    assert read_cell_text([{"text": "first"}, {"text": "second"}]) == "first"


def test_join_list_true_uses_empty_separator_not_comma() -> None:
    """RED LINE：extract_text 用空串拼接，禁止退化成逗号/其它分隔符。"""
    result = read_cell_text([{"text": "1"}, {"text": "2"}, {"text": "3"}], join_list=True)
    assert result == "123"
    assert "," not in result
