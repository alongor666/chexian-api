"""车牌号码规整逻辑 — 防回归测试

ETL 协议（transform.py 第 15 步）：
- 保留完整车牌（供 integrations 续保链路使用）
- 新车未上牌的源占位符（*-* / *** / -- / *）统一归 NULL
- 空字符串 / nan / NaN / None / NULL 字面量归 NULL
- 下游归属地分析仍可用 SUBSTRING(plate_no,1,2) 或 LIKE '川A%' 兼容
"""

import pandas as pd
import pytest


def normalize_plate(series: pd.Series) -> pd.Series:
    """复刻 transform.py 第 15 步车牌规整逻辑（保持与生产逻辑一致）"""
    cleaned = (
        series
        .astype('string')
        .str.strip()
        .replace({'': pd.NA, 'nan': pd.NA, 'NaN': pd.NA, 'None': pd.NA, 'none': pd.NA, 'NULL': pd.NA})
    )
    new_car_mask = cleaned.notna() & ~cleaned.str.contains(r'[A-Za-z0-9一-鿿]', regex=True, na=False)
    cleaned = cleaned.where(~new_car_mask, pd.NA)
    return cleaned


@pytest.mark.parametrize("raw,expected", [
    ('川A12345', '川A12345'),
    ('粤AE34575', '粤AE34575'),
    ('川MABC11', '川MABC11'),
    ('  川Q123  ', '川Q123'),
])
def test_complete_plate_preserved(raw, expected):
    """完整车牌必须无损保留（去除首尾空格）"""
    out = normalize_plate(pd.Series([raw]))
    assert out.iloc[0] == expected


@pytest.mark.parametrize("placeholder", ['*-*', '***', '--', '*', '*-', '   ', '-'])
def test_new_car_placeholder_to_null(placeholder):
    """新车未上牌占位符（无字母数字）统一归 NULL"""
    out = normalize_plate(pd.Series([placeholder]))
    assert out.iloc[0] is pd.NA, f"占位符 {placeholder!r} 应归 NULL，实际={out.iloc[0]!r}"


@pytest.mark.parametrize("empty_literal", ['', 'nan', 'NaN', 'None', 'none', 'NULL', None])
def test_empty_literal_to_null(empty_literal):
    """空值字面量归 NULL"""
    out = normalize_plate(pd.Series([empty_literal]))
    assert out.iloc[0] is pd.NA


def test_downstream_geo_compatibility():
    """下游归属地分析（LIKE / SUBSTRING）必须能从完整车牌正确提取省份代号"""
    plates = pd.Series(['川A12345', '川C8K8K8', '粤AE34575', '渝B99999'])
    out = normalize_plate(plates)
    assert (out.str[:2] == pd.Series(['川A', '川C', '粤A', '渝B'])).all()
    assert out.str.startswith('川A').sum() == 1
    assert out.str.startswith('川').sum() == 2


def test_no_leakage_of_old_two_char_artifacts():
    """旧 ETL 截断产物（'*-' 等）不得作为有效车牌出现在输出中"""
    raw = pd.Series(['*-*', '*-', '川A12345', '*'])
    out = normalize_plate(raw)
    valid = out.dropna()
    assert len(valid) == 1
    assert valid.iloc[0] == '川A12345'
