"""
赔付率周报对账 - 配置中心（精简版）
========================================

聚焦：仅按客户类别 7 类对账 4 个核心绝对值 + 派生满期赔付率。

唯一事实源：
- 客户类别 7 类定义（CUSTOMER_CATEGORY_VALUES + CUSTOMER_CATEGORY_CASES）
- 业务类型 17 → 客户类别 7 的 rollup 映射（BUSINESS_TYPE_TO_CUSTOMER_CATEGORY）
- 4 个核心指标的对账阈值（THRESHOLDS）
- 数据路径（policy / claims_detail parquet）
"""

import os
from pathlib import Path

# ─── 路径（codex review P2 fix：移除硬编码路径，改用环境变量 + 仓库相对默认值）───
# 优先级：CLI 参数 > 环境变量 > 默认值
# - CX_DATA_ROOT：parquet 数据根（默认 = 仓库根，即脚本所在仓库；可在 CI 用环境变量指向数据卷）
# - CX_RECONCILE_XLSX：xlsx 路径（无默认值，必须通过环境变量或 CLI --xlsx 提供）
# - CX_RECONCILE_OUTPUT：输出根（默认 = 仓库根/数据管理/validation/loss-ratio-weekly）

SCRIPT_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# 数据源：相对仓库根（CI / 容器内可通过 CX_DATA_ROOT 覆盖）
DATA_REPO_ROOT = Path(os.environ.get('CX_DATA_ROOT', str(SCRIPT_REPO_ROOT)))
POLICY_PARQUET_GLOB = str(DATA_REPO_ROOT / '数据管理/warehouse/fact/policy/current/*.parquet')
CLAIMS_PARQUET_GLOB = str(DATA_REPO_ROOT / '数据管理/warehouse/fact/claims_detail/*.parquet')

# xlsx：无默认值（环境特定，必须显式提供）
# 本机典型值：~/Library/Mobile Documents/com~apple~CloudDocs/00_PC同步/1.赔付率周报_（合订版）.xlsx
XLSX_PATH = os.environ.get('CX_RECONCILE_XLSX', '')

OUTPUT_BASE_DIR = Path(os.environ.get(
    'CX_RECONCILE_OUTPUT',
    str(SCRIPT_REPO_ROOT / '数据管理/validation/loss-ratio-weekly')
))


# ─── 4 个核心指标 ──────────────────────────────────────────────────────
# xlsx 列名 → 标准 metric_id
METRIC_MAP = {
    '跟单保费(万)':        'total_premium_wan',
    '满期保费(万)':        'earned_premium_wan',
    '已报件数':            'reported_claim_count',
    '总赔款（万）':        'total_reported_claims_wan',
}

# 派生指标（reconcile 阶段从 4 个核心指标算出）
DERIVED_METRIC_ID = 'earned_loss_ratio'   # 满期赔付率 = 总赔款 / 满期保费
DERIVED_METRIC_CN = '满期赔付率'


# ─── 对账阈值 ──────────────────────────────────────────────────────────
# 通过条件：abs_diff ≤ abs_tol OR rel_diff ≤ rel_tol；WARN = 1-3 倍阈值
THRESHOLDS = {
    # 保费金额（万元）：相对 0.5%，绝对 0.01 万
    'total_premium_wan':         {'rel': 0.005, 'abs': 0.01},
    'earned_premium_wan':        {'rel': 0.005, 'abs': 0.01},
    'total_reported_claims_wan': {'rel': 0.005, 'abs': 0.01},
    # 件数：严格相等
    'reported_claim_count':      {'rel': 0,     'abs': 0},
    # 满期赔付率（小数 0-1+）：绝对 0.0001 (1bp) 或相对 0.5%
    'earned_loss_ratio':         {'rel': 0.005, 'abs': 0.0001},
}


# ─── xlsx 1.1.1 sheet 元数据 ───────────────────────────────────────────
XLSX_SHEET = '1.1.1赔付率周报（分业务类型）'
XLSX_HEADER_ROWS = 2  # 双层表头：保单年 + 指标列


# ─── 客户类别 7 类（rollup 目标维度）──────────────────────────────────
CUSTOMER_CATEGORY_VALUES = [
    '非营业客车', '非营业货车', '营业货车', '特种车', '摩托车', '出租车与网约车', '其他',
]

# 项目侧：customer_category 11 类 → 客户类别 7 大类的 SQL CASE
CUSTOMER_CATEGORY_CASES = """
CASE
  WHEN customer_category IN ('非营业个人客车','非营业企业客车','非营业机关客车')
    THEN '非营业客车'
  WHEN customer_category = '非营业货车'      THEN '非营业货车'
  WHEN customer_category = '营业货车'        THEN '营业货车'
  WHEN customer_category = '特种车'          THEN '特种车'
  WHEN customer_category = '摩托车'          THEN '摩托车'
  WHEN customer_category = '营业出租租赁'    THEN '出租车与网约车'
  ELSE '其他'
END
""".strip()


# xlsx 业务类型 17 行 → 客户类别 7 类 的 rollup 映射（解析时聚合）
BUSINESS_TYPE_TO_CUSTOMER_CATEGORY = {
    '非营业客车新车':           '非营业客车',
    '非营业客车旧车非过户':     '非营业客车',
    '非营业客车旧车过户车':     '非营业客车',
    '1吨以下非营业货车':        '非营业货车',
    '1吨以上非营业货车':        '非营业货车',
    '2吨以下营业货车':          '营业货车',
    '2-9吨营业货车':            '营业货车',
    '9-10吨营业货车':           '营业货车',
    '10吨以上-普货':            '营业货车',
    '10吨以上-牵引':            '营业货车',
    '自卸':                     '营业货车',
    '特种车':                   '特种车',
    '摩托车':                   '摩托车',
    '出租车':                   '出租车与网约车',
    '网约车':                   '出租车与网约车',
    '其他':                     '其他',
}
