"""省份隔离 · 出口零信任断言（防线④ · fail-closed）。

「四道防线」工程（BACKLOG uid=2026-06-29-claude-a5aa03 / PR #857）的第④道兜底：
前三道（SSOT 收口 / CI 闸 / 子目录化）都在降低「漏加 WHERE branch_code」的概率，
本道保证「即便漏了，数据也混不出去」——在数据出门（企微写入 / ETL 落盘 / 取数结果）
那一刻强制体检，DISTINCT branch_code > 1（跨省混入）即 fail-closed 抛错中止。

设计要点（动手前经 architect 评审）：
- **mapping 唯一事实源** = server/src/config/field-registry/fields.json 的
  branch_code.derivation.mapping（610→SC / 618→SX），与 derived_fields.py 的
  prefix_map 派生同源同文件，不另立第二套真值。
- **fail-closed 三段优先级**（derive_branches）：
  1) 有 branch_code 列 → 含任何 NULL 即抛错（数据契约违规，不当空集合放行）；用其 DISTINCT。
  2) 否则有 policy_no 列 → policy_no[:3] 按 mapping 派生；任何前缀未命中(NaN) 即抛错
     （不 dropna 静默丢弃——堵 architect 指出的漏洞 A）。
  3) 两列都无 → 抛错（无法判定省份）。
  末尾再校验省份值 ⊆ {SC,SX}，出现未知省份值即抛错（提示同步 fields.json mapping +
  diagnose_common.KNOWN_BRANCHES）。
- **空 df（0 行）放行**：无数据 = 无混省，与「有行但判不出省」严格区分。
- **national 例外只认显式参数**：assert_single_branch(df, allow_national=...) 绝不内部
  隐式读环境变量（避免「误设 env → 断言全面失效」的 fail-open 后门）。env 解析独立成
  is_national_view()，由调用方显式 opt-in：assert_single_branch(df, allow_national=is_national_view())。

单测见 tests/pipelines/test_branch_assert.py。JS/TS 同款语义见 数据管理/lib/branch-assert.mjs。
"""
import json
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType


class BranchIsolationError(RuntimeError):
    """跨省混入 / 省份无法判定 —— 出口零信任断言 fail-closed 中止。"""


# fields.json 相对本文件：数据管理/pipelines/branch_assert.py → server/src/config/...
_FIELDS_JSON = (
    Path(__file__).resolve().parent.parent.parent
    / "server" / "src" / "config" / "field-registry" / "fields.json"
)


@lru_cache(maxsize=1)
def _branch_derivation(fields_json_path: str | None = None):
    """读 fields.json branch_code.derivation（mapping + prefixLength），返回只读快照。

    返回 (MappingProxyType(mapping), prefix_length)。mapping 用只读视图（防缓存被外部静默
    污染）；prefix_length 直接读 fields.json 的 prefixLength（唯一事实源，不从键长推导，
    防未来变长键省份漂移）。
    """
    path = Path(fields_json_path) if fields_json_path else _FIELDS_JSON
    with open(path, encoding="utf-8") as f:
        registry = json.load(f)
    for fd in registry.get("fields", []):
        if fd.get("id") == "branch_code":
            deriv = fd.get("derivation", {})
            mapping = deriv.get("mapping")
            if not mapping:
                raise BranchIsolationError(
                    f"fields.json branch_code 字段缺少 derivation.mapping（{path}）"
                )
            # prefixLength 读 SSOT；缺省时兜底取首键长度（向后兼容）
            prefix_length = deriv.get("prefixLength") or len(next(iter(mapping)))
            return MappingProxyType(dict(mapping)), int(prefix_length)
    raise BranchIsolationError(f"fields.json 未找到 branch_code 字段定义（{path}）")


def get_branch_mapping(fields_json_path: str | None = None):
    """读取 branch_code 的 policy_no 前缀映射（唯一事实源 = fields.json）。

    返回只读视图，如 {"610": "SC", "618": "SX"}。与 derived_fields.py 的 prefix_map 派生同源同文件。
    """
    return _branch_derivation(fields_json_path)[0]


def get_branch_prefix_length(fields_json_path: str | None = None) -> int:
    """读取 policy_no 前缀长度（唯一事实源 = fields.json branch_code.derivation.prefixLength）。"""
    return _branch_derivation(fields_json_path)[1]


def derive_branches(df) -> set:
    """从 df 派生省份集合（fail-closed）。

    优先 branch_code 列（含 NULL 即抛错）；否则从 policy_no[:3] 按 mapping 派生
    （前缀未命中即抛错）；两列都无则抛错。空 df → 空集合。返回值 ⊆ {SC,SX}，
    出现未知省份值即抛错。
    """
    if len(df) == 0:
        return set()

    mapping = get_branch_mapping()
    allowed = set(mapping.values())

    if "branch_code" in df.columns:
        col = df["branch_code"]
        if col.isna().any():
            null_cnt = int(col.isna().sum())
            raise BranchIsolationError(
                f"branch_code 列含 {null_cnt:,} 行 NULL，无法判定省份（数据契约违规）— 出口断言 fail-closed 中止"
            )
        branches = {str(v) for v in col.unique()}
    elif "policy_no" in df.columns:
        derived = df["policy_no"].astype(str).str[: get_branch_prefix_length()].map(mapping)
        if derived.isna().any():
            null_cnt = int(derived.isna().sum())
            bad = (
                df.loc[derived.isna(), "policy_no"].astype(str).str[: get_branch_prefix_length()]
                .value_counts().head(5).to_dict()
            )
            raise BranchIsolationError(
                f"policy_no 有 {null_cnt:,} 行前缀未命中省份 mapping（NULL/未知前缀），无法判定省份 — "
                f"出口断言 fail-closed 中止。未命中前缀样例(top5): {bad}。"
                f"若为新省份上线，须同步 fields.json branch_code.mapping + diagnose_common.KNOWN_BRANCHES"
            )
        branches = set(derived.unique())
    else:
        raise BranchIsolationError(
            "df 既无 branch_code 列也无 policy_no 列，无法判定省份 — 出口断言 fail-closed 中止"
        )

    unknown = branches - allowed
    if unknown:
        raise BranchIsolationError(
            f"检出未知省份值 {sorted(unknown)}（不在已注册省份 {sorted(allowed)}）— 出口断言 fail-closed 中止。"
            f"若为新省份上线，须同步 fields.json branch_code.mapping + diagnose_common.KNOWN_BRANCHES"
        )
    return branches


def assert_single_branch(df, *, allow_national: bool = False, context: str = "") -> None:
    """出口零信任断言：df 必须单省（DISTINCT branch_code ≤ 1）。

    跨省（>1）且未显式声明 allow_national → 抛 BranchIsolationError 中止（fail-closed）。
    空 df / 单省 / 单行 → 通过。无 branch_code 列时从 policy_no 派生。

    allow_national: 仅超管「全国视图」显式声明时为 True（调用方传 is_national_view() 等）；
                    本函数**绝不**内部隐式读环境变量，避免 fail-open 后门。
    context: 出现在错误信息中的调用点标签（如 "postal sync"），便于排查。
    """
    branches = derive_branches(df)
    if len(branches) <= 1:
        return
    if allow_national:
        return
    prefix = f"[{context}] " if context else ""
    raise BranchIsolationError(
        f"{prefix}检出跨省混入 {sorted(branches)}（DISTINCT branch_code > 1），"
        f"出口零信任断言 fail-closed 中止。如确为超管全国视图，须显式 allow_national=True"
    )


def is_national_view(env=None) -> bool:
    """解析「超管全国视图」显式声明：环境变量 PROVINCE=ALL（大小写/空白不敏感）。

    ⚠️ fail-open 风险：误设此 env 会使出口断言对相应调用放行。故仅用于超管全国视图
    调用点，且必须由调用方显式 `allow_national=is_national_view()` opt-in；
    assert_single_branch 本身不会调用本函数。
    """
    import os

    source = env if env is not None else os.environ
    return (source.get("PROVINCE") or "").strip().upper() == "ALL"
