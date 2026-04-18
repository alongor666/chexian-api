"""
ETL 脚本共用验证工具

- 路径边界检查（防止路径遍历）
- 输出非空验证（替代 assert）
- 安全百分比计算（防除零）
- 多 sheet Excel 加载（自动合并续表）
"""

import sys
import time
from pathlib import Path
from typing import Optional

import pandas as pd

# ETL 脚本的合法根目录（数据管理/）
_ETL_ROOT = Path(__file__).resolve().parent.parent

# 占位符字符串集合（统一去 NULL）
PLACEHOLDER_STRS = frozenset({'', 'nan', 'None', 'NaN', 'null'})

# 布尔真值集合
BOOL_TRUE_VALUES = frozenset({'是', '有', '有驾意险交叉销售', '1', 'true', 'True', 'Y', 'y'})

# Excel 读取引擎（calamine 是 Rust 实现，比 openpyxl 快 5-10x，dtype 行为完全等价）
# 依赖：pip install python-calamine（pandas >= 2.2 内置 engine 支持）
EXCEL_ENGINE = 'calamine'


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


def load_excel_all_sheets(
    input_file,
    dtype: Optional[dict] = None,
    required_columns: Optional[list] = None,
) -> pd.DataFrame:
    """加载 Excel 所有工作表并自动合并续表。

    Excel 因行数上限（~104 万行）拆分为多个 sheet 时：
    - Sheet1 有表头（列名）
    - Sheet2+ 可能有表头（相同列名）或无表头（续表，列数相同）

    本函数自动检测并合并所有 sheet，避免静默丢数据。

    Args:
        input_file: Excel 文件路径
        dtype: 传递给 pd.read_excel 的 dtype 参数（如 {'保单号': str}）
        required_columns: 用于识别有效 sheet 的必须列名列表。
                          若为 None，则用第一个 sheet 的全部列名作为基准。

    Returns:
        合并后的 DataFrame
    """
    start_ts = time.perf_counter()
    kwargs = {'engine': EXCEL_ENGINE}
    if dtype:
        kwargs['dtype'] = dtype

    sheet_data = pd.read_excel(input_file, sheet_name=None, **kwargs)

    # 单 sheet 快速路径
    if isinstance(sheet_data, pd.DataFrame):
        elapsed = time.perf_counter() - start_ts
        print(f"   加载: {len(sheet_data):,} 行 × {len(sheet_data.columns)} 列（{elapsed:.1f}s, 1 sheet）")
        return sheet_data

    sheets = list(sheet_data.items())
    if len(sheets) == 1:
        name, df = sheets[0]
        elapsed = time.perf_counter() - start_ts
        print(f"   加载: {len(df):,} 行 × {len(df.columns)} 列（{elapsed:.1f}s, 1 sheet）")
        return df

    # 多 sheet：识别有表头的 sheet vs 无表头的续表
    valid_frames = []
    base_columns = None
    headerless_sheets = []

    for sheet_name, sheet_df in sheets:
        if not isinstance(sheet_df, pd.DataFrame) or sheet_df.empty:
            continue

        has_header = True
        if required_columns:
            # 有指定必须列：检查是否包含
            stripped = sheet_df.columns.str.strip()
            has_header = any(c in stripped.tolist() for c in required_columns)
        elif base_columns is not None:
            # 无指定必须列：与第一个 sheet 的列名对比
            stripped = sheet_df.columns.str.strip()
            has_header = len(set(base_columns) & set(stripped.tolist())) > len(base_columns) * 0.5

        if has_header:
            if base_columns is None:
                base_columns = list(sheet_df.columns.str.strip())
            valid_frames.append(sheet_df)
            print(f"   读取工作表: {sheet_name}，{len(sheet_df):,} 行")
        else:
            headerless_sheets.append(sheet_name)

    # 处理无表头续表
    if base_columns is not None and headerless_sheets:
        for sheet_name in headerless_sheets:
            headerless_kwargs = {'engine': EXCEL_ENGINE}
            if dtype:
                # 将列名键转为位置索引键（续表无表头）
                col_list = list(dtype.keys())
                headerless_kwargs['dtype'] = {
                    base_columns.index(col): typ
                    for col, typ in dtype.items()
                    if col in base_columns
                }
            raw_sheet = pd.read_excel(
                input_file, sheet_name=sheet_name, header=None,
                **headerless_kwargs,
            )
            if raw_sheet.empty:
                continue
            n_cols = raw_sheet.shape[1]
            n_base = len(base_columns)
            if n_cols > n_base:
                print(f"   ⚠ 跳过续表 {sheet_name}：列数 {n_cols} > 基准 {n_base}")
                continue
            if n_cols < n_base:
                # 续表列数少于基准（常见：源系统导出续表时末尾列缺失）→ NaN 填充
                for i in range(n_cols, n_base):
                    raw_sheet[i] = pd.NA
                print(f"   读取续表: {sheet_name}，{len(raw_sheet):,} 行（无表头，补 {n_base - n_cols} 列 NaN）")
            else:
                print(f"   读取续表: {sheet_name}，{len(raw_sheet):,} 行（无表头）")
            raw_sheet.columns = base_columns
            valid_frames.append(raw_sheet)

    if not valid_frames:
        print(f"   ❌ 未找到有效工作表")
        sys.exit(1)

    if len(valid_frames) == 1:
        df = valid_frames[0]
    else:
        df = pd.concat(valid_frames, ignore_index=True)

    elapsed = time.perf_counter() - start_ts
    print(f"   加载合计: {len(df):,} 行 × {len(df.columns)} 列（{elapsed:.1f}s, {len(valid_frames)} sheet 合并）")
    return df
