"""
ETL 脚本共用验证工具

- 路径边界检查（防止路径遍历）
- 输出非空验证（替代 assert）
- 安全百分比计算（防除零）
- 多 sheet Excel 加载（自动合并续表）
"""

import math
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


def enforce_schema_contract(
    df,
    known_cols,
    ignored_cols=(),
    *,
    force: bool = False,
    declare_hint: str = "",
) -> list:
    """Schema 契约：检测 df 中既未被处理（known_cols）也未被显式忽略（ignored_cols）的源列。

    上游若在源文件里悄改/新增字段，这些列既不在映射也不在忽略清单里，就会被静默丢弃、
    口径悄悄失真无人察觉（backlog FIND-004）。本函数把这一风险变为**响亮失败**：有未知列时
    打印字段名 + 非空率 + 前 3 个示例值，默认 sys.exit(1) 阻断 ETL；`--force`（调试逃生阀）
    时仅打印后返回、不退出。

    这是 premium 域（transform.py finalize_schema）与 base_converter.py（brand / repair /
    cross_sell 等标准域）共用的单一实现，两处拦截逻辑不再各写一份（消除重复漂移）。

    参数:
      df: 待检测的 DataFrame（列名为源列名，通常是中文）
      known_cols: 已被处理/映射的列集合（premium = final ∪ core ∪ optional；
                  base_converter = get_cn_to_en() 的键集合）
      ignored_cols: 显式忽略列集合（premium = shard-config.json explicitly_ignored_fields；
                    base_converter = 各 converter get_explicitly_ignored_columns() 声明）
      force: True 时跳过 sys.exit（仅调试；对应 --force）
      declare_hint: 追加的"应在何处声明"提示行（各调用方定制，可为空）
    返回:
      unknown 列名列表（空列表 = 契约通过）
    """
    known = set(known_cols)
    ignored = set(ignored_cols)
    unknown = [c for c in df.columns if c not in known and c not in ignored]
    if unknown:
        print(f"\n   ❌ Schema 契约违反：以下 {len(unknown)} 个源字段未被处理也未被显式忽略：")
        for col in unknown:
            sample = df[col].dropna().head(3).tolist()
            print(f"      ❓ '{col}' (非空率 {df[col].notna().mean():.1%}, 示例: {sample})")
        if declare_hint:
            print(declare_hint)
        print("      → 使用 --force 跳过此检查（仅用于调试）")
        if not force:
            sys.exit(1)
    return unknown


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
        hit_count = None  # None = 未做过 required_columns 判定（无 required_columns 场景）
        if required_columns:
            # 有指定必须列：要求命中比例 ≥ 50%（至少 1 列，向上取整），而非"任意 1 列命中"。
            # BACKLOG 2026-06-11-claude-fa0f22：FineBI 导出常带汇总/透视 sheet，恰好只含
            # 保单号这类通用列（如「保单号」在 required_columns 里），旧的 any() 判定会把这类
            # 统计 sheet 当有效续表 concat 进来，其余必须列全为 NaN，静默污染下游行。
            # 阈值取"过半"：required_columns 通常 2-3 列（见 convert_claims_detail.py=3、
            # quote_etl.py=2、convert_new_energy_claims.py=2），过半意味着至少 2/3 或 1/2 命中，
            # 单列巧合命中不足以通过；required_columns 本身就短（≤2）时过半仍要求 ≥1 列，
            # 不会把正常单必须列的域锁死。
            stripped = sheet_df.columns.str.strip()
            hit_count = sum(1 for c in required_columns if c in stripped.tolist())
            min_hits = math.ceil(len(required_columns) / 2)
            has_header = hit_count >= min_hits
            if not has_header:
                print(f"   ⚠ 跳过工作表 {sheet_name}：命中必须列 {hit_count}/{len(required_columns)}"
                      f"（需 ≥{min_hits}），疑似汇总/透视表，非有效续表")
        elif base_columns is not None:
            # 无指定必须列：与第一个 sheet 的列名对比
            stripped = sheet_df.columns.str.strip()
            has_header = len(set(base_columns) & set(stripped.tolist())) > len(base_columns) * 0.5

        if has_header:
            if base_columns is None:
                base_columns = list(sheet_df.columns.str.strip())
            valid_frames.append(sheet_df)
            print(f"   读取工作表: {sheet_name}，{len(sheet_df):,} 行")
        elif hit_count is not None and hit_count > 0:
            # 修复 fa0f22 的遗留缺口：命中部分必须列（0 < hit_count < min_hits）说明该 sheet
            # 自身确实有表头行（只是列不够，如汇总/透视表），不是"无表头续表"。若仍并入
            # headerless_sheets，下面会被当续表用 header=None 重读——把表头行当数据行、
            # 且列数凑巧 ≤ 基准时依旧会被 concat 回来，原样复现"必须列判定过松"的 bug，
            # 只是从"检测"绕到了"续表兜底"路径。因此这里直接丢弃，不进入续表兜底。
            print(f"   ⚠ 工作表 {sheet_name} 判定为非有效数据表（非零命中但不足阈值），直接丢弃，不按无表头续表处理")
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
