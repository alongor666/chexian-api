"""
xlsx 1.1.1 sheet → 客户类别 7 类 records（精简版）
====================================================

仅解析 1.1.1（业务类型 17 行）→ 提取 4 个核心指标 → rollup 到客户类别 7 类。

输出 schema:
  {policy_year, dim_path: [客户类别], metric_id, value}
metric_id ∈ {total_premium_wan, earned_premium_wan, reported_claim_count, total_reported_claims_wan}
"""
from __future__ import annotations
import openpyxl
from .config import (
    XLSX_SHEET,
    XLSX_HEADER_ROWS,
    METRIC_MAP,
    BUSINESS_TYPE_TO_CUSTOMER_CATEGORY,
)


def _ffill(values: list) -> list:
    out, prev = [], None
    for v in values:
        prev = v if v is not None else prev
        out.append(prev)
    return out


def _to_float(v):
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_all(xlsx_path: str, policy_year: str = '2026') -> list[dict]:
    """解析 1.1.1 → 业务类型 17 类 → rollup 客户类别 7 类 + 合计行。"""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[XLSX_SHEET]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]

    # 列索引：(policy_year, metric_cn) → col_index
    year_row = _ffill(rows[0])
    metric_row = rows[1]
    col_idx: dict[tuple[str, str], int] = {}
    for col, (y, m) in enumerate(zip(year_row, metric_row)):
        if y is None or m is None: continue
        ys = str(y).strip()
        if not ys.isdigit() or len(ys) != 4: continue
        col_idx[(ys, str(m).strip())] = col

    # 业务类型 17 行 × 4 个核心指标的原始值
    raw_records: list[dict] = []
    for r in rows[XLSX_HEADER_ROWS:]:
        biz_type = r[0]
        if not biz_type: continue
        biz_type = str(biz_type).strip()
        if not biz_type: continue
        for (year, metric_cn), col in col_idx.items():
            if year != policy_year: continue
            metric_id = METRIC_MAP.get(metric_cn)
            if not metric_id: continue
            val = _to_float(r[col]) if col < len(r) else None
            if val is None: continue
            raw_records.append({
                'policy_year': year,
                'biz_type': biz_type,
                'metric_id': metric_id,
                'metric_cn': metric_cn,
                'value': val,
            })

    return _rollup_to_customer_category(raw_records, policy_year)


def _rollup_to_customer_category(raw: list[dict], policy_year: str) -> list[dict]:
    """业务类型 17 行 → 客户类别 7 行 + 合计。所有 4 个指标均可直接相加。"""
    # 合计行直接取 xlsx 的"合计"行
    out: list[dict] = []

    # 按 (customer_category, metric_id) 聚合金额（4 个指标都是可加的）
    groups: dict[tuple, float] = {}
    total_row: dict[tuple, float] = {}  # 合计行的原始值
    for r in raw:
        biz_type = r['biz_type']
        if biz_type == '合计':
            total_row[(r['metric_id'], r['metric_cn'])] = r['value']
            continue
        cust_cat = BUSINESS_TYPE_TO_CUSTOMER_CATEGORY.get(biz_type)
        if cust_cat is None:
            continue
        key = (cust_cat, r['metric_id'], r['metric_cn'])
        groups[key] = groups.get(key, 0.0) + r['value']

    for (cust_cat, metric_id, metric_cn), v in groups.items():
        out.append({
            'sheet': 'customer_category',
            'policy_year': policy_year,
            'dim_path': [cust_cat],
            'metric_id': metric_id,
            'metric_cn': metric_cn,
            'value': v,
        })

    # 合计行（直接取 xlsx）
    for (metric_id, metric_cn), v in total_row.items():
        out.append({
            'sheet': 'customer_category',
            'policy_year': policy_year,
            'dim_path': ['合计'],
            'metric_id': metric_id,
            'metric_cn': metric_cn,
            'value': v,
        })

    return out
