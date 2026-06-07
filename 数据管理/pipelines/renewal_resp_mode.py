#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
续保诊断 · 责任模式清单加载（外部 Excel/CSV → 车架号→责任模式 映射）

可插拔，自动识别两类来源（列名探测）：
  · 专项责任模式清单：含「责任模式」列 → 直接采用（已确定值，verbatim，不映射、不按日期过滤）【优先】
  · wecom 电销续保清单：仅含「名单类型」列 → map_resp_mode 映射 + 按「保单到期时间」过滤诊断窗口【回退】

名单类型 → 责任模式（用户 2026-06-06 确认，见 memory domain_renewal_responsibility_mode）：
  电销续保/网电电续/微保电续→电销自留；兜底→业务员兜底；白名单→电销转保；不在清单→业务员自留。

本模块为独立关注点：只依赖 pandas，不依赖 renewal_common / SQL / 渲染。
"""

from datetime import date
from pathlib import Path

import pandas as pd


def map_resp_mode(name_type):
    """wecom 清单「名单类型」→ 责任模式；空值（None/NaN）或未识别取值返回 None（按不在清单处理＝业务员自留）。

    pandas read_excel/read_csv(dtype=str) 对空单元格返回 float NaN（NaN 为 truthy，`(x or "")` 不会替换、
    .strip() 会抛 AttributeError），故必须先 pd.isna 兜底再转 str —— 实际外部清单常见空行/未维护名单类型。
    """
    if pd.isna(name_type):
        return None
    t = str(name_type).strip()
    if t == "兜底":
        return "业务员兜底"
    if t == "白名单":
        return "电销转保"
    if t in ("电销续保", "网电电续", "微保电续"):
        return "电销自留"
    return None


def _read_all_sheets(path: Path):
    """读 Excel（多 sheet 安全 concat）或 CSV，全列按 str。"""
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, dtype=str)
    sheets = pd.read_excel(path, sheet_name=None, dtype=str)  # DuckDB read_xlsx 默认只读首 sheet，必须 pandas
    return pd.concat(sheets.values(), ignore_index=True)


def load_resp_mode_source(path: Path, start: date, end: date):
    """加载责任模式来源，返回 (DataFrame[vehicle_frame_no, resp_mode], 来源标签) 或 (None, 跳过原因)。

    车架号列名兼容：车架号 / vehicle_frame_no / VIN / vin。
    """
    if not path.exists():
        return None, f"清单不存在：{path}"
    try:
        df = _read_all_sheets(path)
    except Exception as e:  # noqa: BLE001
        return None, f"清单读取失败：{e}"
    cols = {str(c).strip(): c for c in df.columns}
    key_col = next((cols[k] for k in ("车架号", "vehicle_frame_no", "VIN", "vin") if k in cols), None)
    if not key_col:
        return None, "清单缺少车架号列"

    if "责任模式" in cols or "resp_mode" in cols:
        val_col = cols.get("责任模式") or cols.get("resp_mode")
        out = df[[key_col, val_col]].copy()
        out.columns = ["vehicle_frame_no", "resp_mode"]
        out = out.dropna(subset=["vehicle_frame_no", "resp_mode"])
        src = "专项责任模式清单（已确定值）"
    elif "名单类型" in cols:
        exp_col = cols.get("保单到期时间")
        if exp_col:
            df = df.copy()
            df["_exp"] = pd.to_datetime(df[exp_col], errors="coerce")
            df = df[(df["_exp"] >= pd.Timestamp(start)) & (df["_exp"] <= pd.Timestamp(end))]
        out = df[[key_col, cols["名单类型"]]].copy()
        out.columns = ["vehicle_frame_no", "_nt"]
        out["resp_mode"] = out["_nt"].map(map_resp_mode)
        out = out.dropna(subset=["vehicle_frame_no", "resp_mode"])[["vehicle_frame_no", "resp_mode"]]
        src = "wecom 名单类型清单（映射）"
    else:
        return None, "清单既无「责任模式」也无「名单类型」列"

    out = out.drop_duplicates(subset=["vehicle_frame_no"])
    return (out, src) if not out.empty else (None, "清单过滤后无覆盖本窗口的记录")
