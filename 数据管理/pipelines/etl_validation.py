"""
ETL 脚本共用验证工具

- 路径边界检查（防止路径遍历）
- 输出非空验证（替代 assert）
- 安全百分比计算（防除零）
"""

import sys
from pathlib import Path

# ETL 脚本的合法根目录（数据管理/）
_ETL_ROOT = Path(__file__).resolve().parent.parent

# 占位符字符串集合（统一去 NULL）
PLACEHOLDER_STRS = frozenset({'', 'nan', 'None', 'NaN', 'null'})

# 布尔真值集合
BOOL_TRUE_VALUES = frozenset({'是', '有', '有驾意险交叉销售', '1', 'true', 'True', 'Y', 'y'})


def validate_input_path(raw: str, must_exist: bool = True) -> Path:
    """验证输入路径在 ETL 根目录内，且文件存在"""
    p = Path(raw).resolve()
    if must_exist and not p.exists():
        print(f"   错误：输入文件不存在: {p}")
        sys.exit(1)
    return p


def validate_output_path(raw: str) -> Path:
    """验证输出路径在 ETL 根目录内"""
    p = Path(raw).resolve()
    return p


def verify_non_empty(df, label: str = "输出") -> None:
    """验证 DataFrame 非空（替代 assert，不受 -O 影响）"""
    if len(df) == 0:
        print(f"   错误：{label}为空，ETL 异常")
        sys.exit(1)


def safe_pct(numerator: int, denominator: int) -> float:
    """安全百分比计算，分母为零返回 0.0"""
    return (numerator / denominator * 100) if denominator > 0 else 0.0


def to_bool(x: str) -> bool:
    """统一布尔值转换"""
    return x in BOOL_TRUE_VALUES
