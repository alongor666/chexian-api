"""机构维度塌缩检测 — 纯函数，可单测（ETL 出口守卫）。

背景（缺口 B005-2026-07-09）：上游山西 01 签单「定稿」导出在 2026-07-01~04 退化，
`三级机构` 列坍缩为全「其他」（274,207 行仅 1 个 distinct 值）。transform.py 的
normalize_branch_org 对「其他」执行 org_map.get('其他','其他') = 原样保留，ETL 照常
产出 parquet **无任何告警** → SX 近月保单 org_level_3 全「其他」静默持续 5+ 天，
最终靠下游报告才发现。

本模块把「一个关键分析维度（org_level_3）归一化后是否坍缩成占位值」抽成无副作用
纯函数，供 transform.py 在落盘前调用告警/失败。判定逻辑抽到 pipelines/ 才能被 pytest
直接 import 测试（与 branch_assert.py / claims-freshness.mjs 同一模式）。

判定口径（与「合法机构集中」区分的关键）：
- **占位值** = 「其他」∪ {NULL / NaN / 空字符串 / 'nan'/'none'/'null' 字面量}。真实经营
  单元名（太原一部、大同 …）**不是**占位值。
- **塌缩 = 占位值合计占比 ≥ 阈值**（默认 0.95）。用「合计占比」而非「单一主值占比」：
  占位质量可能在 其他/NULL 间拆分（如 60% 其他 + 38% NULL 合计 98%），合计口径严格
  覆盖单一主值口径。
- 合法机构集中（100% 都是「太原一部」这种真实名）**不触发**——占位约束天然防误报。

见 .claude/rules/data-pipeline.md 与缺口清单 B005-2026-07-09。
"""
from typing import Iterable, Mapping, NamedTuple, Optional, Union

# 占位值合计占比 ≥ 此阈值 → 判定机构维度塌缩。
# 取 0.95（很高）：只有真实退化才命中，正常业务分布远达不到。
DEFAULT_ORG_COLLAPSE_THRESHOLD = 0.95

# 具名占位值（非 null 类）。null / nan / 空 / null 字面量由结构性判定，不在此列。
DEFAULT_ORG_PLACEHOLDERS = frozenset({"其他"})

# 归一化为小写后视作 NULL 的字符串字面量（源列被 astype(str) 后可能出现）。
_NULL_LITERALS = frozenset({"nan", "none", "null", "<na>"})

CountsInput = Union[Mapping[object, int], Iterable]


class OrgDimensionCollapseError(RuntimeError):
    """机构维度塌缩为占位值 —— 调用方显式升级为硬失败（ORG_COLLAPSE_FAIL=1）时抛出。"""


class OrgCollapseVerdict(NamedTuple):
    """机构维度塌缩判定结果（不可变）。"""

    collapsed: bool
    total: int
    distinct: int
    dominant_value: Optional[str]  # 占比最高的规范键；None 表示 NULL/空 桶
    dominant_share: float
    placeholder_share: float
    threshold: float


def _canonicalize(value: object) -> Optional[str]:
    """把原始机构值规范化为规范键：NULL/NaN/空/纯空白 → None；否则去首尾空白后的字符串。

    '其他' 与 ' 其他 ' 归并为同一键；不改变真实机构名。
    """
    if value is None:
        return None
    # float NaN（含 numpy.float64('nan')，其为 float 子类）：value != value
    if isinstance(value, float) and value != value:
        return None
    s = str(value).strip()
    return s if s else None


def _is_placeholder_key(key: Optional[str], placeholders) -> bool:
    """判定规范键是否为占位值：None（NULL/空）/ null 字面量 / 具名占位集合成员。"""
    if key is None:
        return True
    if key.lower() in _NULL_LITERALS:
        return True
    return key in placeholders


def is_org_placeholder(value: object, placeholders=DEFAULT_ORG_PLACEHOLDERS) -> bool:
    """公开便捷判定：某原始机构值是否为占位值（None/NaN/空/其他/null 字面量）。"""
    return _is_placeholder_key(_canonicalize(value), placeholders)


def _iter_pairs(counts: CountsInput):
    """把 Mapping 或 (value, count) 对可迭代统一为 (value, count) 生成器。"""
    if isinstance(counts, Mapping):
        return counts.items()
    return counts


def evaluate_org_collapse(
    counts: CountsInput,
    *,
    threshold: float = DEFAULT_ORG_COLLAPSE_THRESHOLD,
    placeholders=DEFAULT_ORG_PLACEHOLDERS,
) -> OrgCollapseVerdict:
    """判定机构维度是否塌缩为占位值。

    counts: 机构值 → 行数 的映射（如 df['三级机构'].value_counts(dropna=False).to_dict()），
            或 (机构值, 行数) 对的可迭代。键可为 None / NaN / str；计数 ≤ 0 的键被忽略。
    threshold: 占位值合计占比阈值（默认 0.95），命中 ≥ 阈值即塌缩。

    空分布（合计 0 行）→ collapsed=False（无数据 ≠ 塌缩，不崩溃）。
    """
    # 按规范键聚合（合并空白/大小写变体、NULL 类桶）
    agg: dict = {}
    for value, count in _iter_pairs(counts):
        c = int(count)
        if c <= 0:
            continue
        key = _canonicalize(value)
        agg[key] = agg.get(key, 0) + c

    total = sum(agg.values())
    if total == 0:
        return OrgCollapseVerdict(
            collapsed=False, total=0, distinct=0, dominant_value=None,
            dominant_share=0.0, placeholder_share=0.0, threshold=threshold,
        )

    # 主值（占比最高的规范键）；确定性 tie-break：先按计数降序，再按键字符串升序
    dominant_value, dominant_count = max(
        agg.items(), key=lambda kv: (kv[1], "" if kv[0] is None else str(kv[0]))
    )
    placeholder_total = sum(
        c for k, c in agg.items() if _is_placeholder_key(k, placeholders)
    )
    placeholder_share = placeholder_total / total

    return OrgCollapseVerdict(
        collapsed=placeholder_share >= threshold,
        total=total,
        distinct=len(agg),
        dominant_value=dominant_value,
        dominant_share=dominant_count / total,
        placeholder_share=placeholder_share,
        threshold=threshold,
    )


def resolve_org_collapse_threshold(
    env=None, default: float = DEFAULT_ORG_COLLAPSE_THRESHOLD
) -> float:
    """解析环境变量 ORG_COLLAPSE_WARN_THRESHOLD（(0,1] 区间的小数），非法/越界回退默认。

    env 可注入 dict 便于测试；默认读 os.environ（与 branch_assert.is_national_view 同款）。
    """
    import os

    source = env if env is not None else os.environ
    raw = source.get("ORG_COLLAPSE_WARN_THRESHOLD")
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    if not (0.0 < value <= 1.0):
        return default
    return value


def org_collapse_should_fail(env=None) -> bool:
    """解析环境变量 ORG_COLLAPSE_FAIL：真值（1/true/yes/on）→ 塌缩时硬失败中止。

    默认（未设置 / 0 / false）→ 仅告警。env 可注入 dict 便于测试。
    """
    import os

    source = env if env is not None else os.environ
    return (source.get("ORG_COLLAPSE_FAIL") or "").strip().lower() in {"1", "true", "yes", "on"}
