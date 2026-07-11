"""policy/current 分省子目录布局 · Python 读侧路径路由（多省 Phase B · 801409 cutover 前置）。

Node 侧同款语义：scripts/lib/policy-current-shards.mjs（listPolicyCurrentShards /
policyCurrentGlobPatterns）。本模块是其 Python 等价实现，供所有直读
`warehouse/fact/policy/current/` 的 Python 站点（诊断族 / ETL enrich / 企微引擎 /
对账脚本）统一收口，杜绝生产切「current/SC/ + current/SX/」子目录布局后
扁平 glob 读 0 行的静默失明。

三态布局语义（与装载层 data-bootstrapper.ts / sync 闸 policy-current-shards.mjs 对齐）：
  - 纯扁平（现状）：顶层 `current/*.parquet`；省份靠文件名前缀区分
    （`SX_` 等 `^[A-Z]{2}_` 前缀 = 该省；无前缀裸名 / `sichuan_` 小写 = 基准省 SC，
    #753 Option A 既定约定）。SC 过滤沿用 `[!S]*` 语义（#842 用户拍板、
    governance「[!S]* glob 前缀隔离」闸持续校验其前提）。
  - 纯子目录（cutover 后）：单层两位大写省码目录 `current/<省>/*.parquet`；
    readdir 枚举实际存在的省目录，**禁硬编码省常量**（新省自动生效）。
  - 并存（顶层与子目录同时有 parquet）：迁移态冲突，**fail-closed 抛错**
    （与 findPolicyCurrentSyncGateViolations ①、enforceProvinceSubdirGate 同判）——
    读侧任选一边必有一省双计或缺数，禁静默。

fail-closed 纪律（cutover SOP §1 就绪清单 #4）：
  - 选定布局/省份后**读到 0 个 parquet 必须抛 PolicyCurrentLayoutError**，禁静默空结果。
  - 未注册省份（不在 fields.json branch_code.derivation.mapping 值域）立即抛错，
    禁静默回落四川（data-pipeline.md 红线）。
  - 仅 `missing_ok=True`（模块级常量场景：worktree / CI 无数据时保 import 不崩）
    允许在**目录整体无数据**时回落现状扁平 glob 字符串——此时下游 DuckDB 对
    0 匹配 glob 自会大声报错，不构成静默通道。

⚠️ 扁平前缀 / 子目录收窄都只是**性能与布局路由**，不是省份隔离保证；
   各站点原有 `WHERE branch_code = ?` 过滤必须保留（data-pipeline.md 红线）。

单测：tests/pipelines/test_branch_paths.py（三布局 fixture + fail-closed 断言）。
"""
from __future__ import annotations

import glob as _glob
import re
from dataclasses import dataclass
from pathlib import Path

# 单层两位大写省码目录（与 Node PROVINCE_SUBDIR /^[A-Z]{2}$/ 一致；
# 排除 archive/ staging/ 等多字符或小写目录）
_PROVINCE_SUBDIR_RE = re.compile(r"^[A-Z]{2}$")
# 扁平文件名省前缀（#753 Option A 约定 `SX_每日数据_*`；通用 ^[A-Z]{2}_，不枚举省常量）
_FLAT_PREFIX_RE = re.compile(r"^([A-Z]{2})_")


class PolicyCurrentLayoutError(RuntimeError):
    """policy/current 布局/数据不可用 —— 读侧 fail-closed 中止（禁静默空结果）。"""


@dataclass(frozen=True)
class PolicyShard:
    """一个 policy/current parquet 分片。branch=None 表示顶层扁平（省份看文件名前缀）。"""

    name: str
    path: str
    branch: str | None


def flat_prefix_branch(name: str) -> str | None:
    """扁平文件名的省前缀（`SX_x.parquet` → 'SX'；裸名/sichuan_ 小写 → None）。

    与 data-bootstrapper.ts flatPrefixBranch 同语义（^[A-Z]{2}_，非省常量枚举）。
    """
    m = _FLAT_PREFIX_RE.match(name)
    return m.group(1) if m else None


def list_policy_current_shards(current_dir: str | Path) -> list[PolicyShard]:
    """枚举 policy/current 全部 parquet 分片（顶层扁平 + 单层省份子目录）。

    等价 Node listPolicyCurrentShards：Pass1 顶层 `.parquet`（branch=None）；
    Pass2 `^[A-Z]{2}$` 子目录内 `.parquet`（branch=目录名，仅取文件、排除嵌套目录）。
    目录不存在 → []。纯枚举不设政策（并存/空由 policy_current_files 等上层裁决）。
    """
    root = Path(current_dir)
    if not root.is_dir():
        return []
    shards: list[PolicyShard] = []
    entries = sorted(root.iterdir(), key=lambda p: p.name)
    for entry in entries:
        # Pass1：顶层扁平 parquet（跟随 symlink；is_file 对坏 symlink 返回 False → 跳过）
        if entry.name.endswith(".parquet") and entry.is_file():
            shards.append(PolicyShard(entry.name, str(entry), None))
    for entry in entries:
        # Pass2：单层两位大写省码子目录（省码不以 .parquet 结尾，与 Pass1 天然不相交）
        if not _PROVINCE_SUBDIR_RE.match(entry.name) or not entry.is_dir():
            continue
        for sub in sorted(entry.iterdir(), key=lambda p: p.name):
            if sub.name.endswith(".parquet") and sub.is_file():
                shards.append(PolicyShard(sub.name, str(sub), entry.name))
    return shards


def inspect_policy_current_layout(current_dir: str | Path) -> dict:
    """布局体检：{flat_count, subdir_count, subdir_only, mixed, branches}。"""
    shards = list_policy_current_shards(current_dir)
    flat = [s for s in shards if s.branch is None]
    subdir = [s for s in shards if s.branch is not None]
    return {
        "flat_count": len(flat),
        "subdir_count": len(subdir),
        "subdir_only": not flat and bool(subdir),
        "mixed": bool(flat) and bool(subdir),
        "branches": sorted({s.branch for s in subdir}),
    }


def _known_branches() -> set:
    """已注册省份值域（唯一事实源 = fields.json branch_code.derivation.mapping）。"""
    try:
        from pipelines.branch_assert import get_branch_mapping  # 数据管理 在 sys.path
    except ImportError:
        from branch_assert import get_branch_mapping  # pipelines 目录在 sys.path
    return set(get_branch_mapping().values())


def _validate_branch(branch: str) -> None:
    allowed = _known_branches()
    if branch not in allowed:
        raise PolicyCurrentLayoutError(
            f"未注册省份代码 '{branch}'（已注册：{sorted(allowed)}，"
            "唯一事实源 = fields.json branch_code.derivation.mapping）。"
            "禁止静默回落四川 — data-pipeline.md 红线。"
        )


def _raise_mixed(current_dir: Path, layout: dict) -> None:
    raise PolicyCurrentLayoutError(
        f"迁移态冲突：{current_dir} 顶层扁平 parquet（{layout['flat_count']} 个）与省份子目录 "
        f"parquet（{','.join(layout['branches'])}，{layout['subdir_count']} 个）并存。"
        "读侧任选一边必有一省双计或缺数——物理迁移须一次性完成（见 cutover SOP），"
        "与 sync 闸 findPolicyCurrentSyncGateViolations / 装载互斥闸同判 fail-closed。"
    )


def _raise_empty(context: str) -> None:
    raise PolicyCurrentLayoutError(
        f"{context} 读到 0 个 parquet —— fail-closed 中止（禁静默空结果）。"
        "请核实数据目录（worktree 无 parquet 须用主仓绝对路径，"
        "见 data-pipeline.md「山西 GATED」一节）。"
    )


def policy_current_files(current_dir: str | Path, branch: str | None = None) -> list[str]:
    """双布局自适应返回 policy/current parquet 文件路径列表（strict fail-closed）。

    - 子目录布局：branch=None → 全部省目录文件；branch='SC' → current/SC/ 文件。
    - 扁平布局：branch=None → 全部顶层文件；branch='SC' → 首字母非 'S' 的顶层文件
      （逐字节等价既有 `[!S]*.parquet` glob 语义）；branch=其他省 → `<省>_` 前缀文件。
    - 并存 → 抛错；选定范围 0 文件 → 抛错；未注册省份 → 抛错。

    返回排序后的字符串路径（确定性）。扁平前缀过滤仅是性能/路由辅助，
    调用方的 `WHERE branch_code` 过滤必须保留。
    """
    root = Path(current_dir)
    if branch is not None:
        _validate_branch(branch)
    layout = inspect_policy_current_layout(root)
    if layout["mixed"]:
        _raise_mixed(root, layout)
    shards = list_policy_current_shards(root)
    if layout["subdir_only"]:
        picked = [s for s in shards if branch is None or s.branch == branch]
        scope = f"{root}/{branch}/（子目录布局）" if branch else f"{root}/<省>/（子目录布局）"
    else:
        if branch is None:
            picked = shards
        elif branch == "SC":
            # 与 diagnose_common 既有 [!S]*.parquet 逐字节同语义（大小写敏感：
            # sichuan_ 小写保留、SX_ 排除）；前提由 governance「[!S]* glob 前缀隔离」闸守护
            picked = [s for s in shards if not s.name.startswith("S")]
        else:
            picked = [s for s in shards if s.name.startswith(f"{branch}_")]
        scope = f"{root}（扁平布局，省份={branch or '全部'}）"
    if not picked:
        _raise_empty(scope)
    return sorted(s.path for s in picked)


def policy_current_glob(
    current_dir: str | Path, branch: str | None = None, *, missing_ok: bool = False
) -> str:
    """双布局自适应返回单条 glob 字符串（供嵌入 `read_parquet('...')` SQL）。

    - 子目录布局：branch=None → `<dir>/[A-Z][A-Z]/*.parquet`；branch='SC' → `<dir>/SC/*.parquet`。
    - 扁平布局：branch=None → `<dir>/*.parquet`；branch='SC' → `<dir>/[!S]*.parquet`（现状）；
      branch=其他省 → `<dir>/<省>_*.parquet`。
    - 并存 → 抛错（missing_ok 不豁免——并存是有数据的冲突态，非「无数据」）。
    - 选定范围 0 匹配 → 抛错；missing_ok=True 且目录整体无 parquet →
      回落**现状扁平形态** glob（供模块级常量在 worktree/CI 无数据环境下保 import 不崩；
      下游 DuckDB 对 0 匹配 glob 自会报错，非静默通道）。

    glob 模式与 Node policyCurrentGlobPatterns 语义一致（单层 [A-Z][A-Z] 字符类，
    非递归、不吃 archive/ staging/ 等目录）。
    """
    root = Path(current_dir)
    if branch is not None:
        _validate_branch(branch)

    def _flat_form() -> str:
        if branch is None:
            return str(root / "*.parquet")
        if branch == "SC":
            return str(root / "[!S]*.parquet")
        return str(root / f"{branch}_*.parquet")

    layout = inspect_policy_current_layout(root)
    if layout["mixed"]:
        _raise_mixed(root, layout)
    if layout["flat_count"] == 0 and layout["subdir_count"] == 0:
        if missing_ok:
            return _flat_form()
        _raise_empty(f"{root}（扁平/子目录均无 parquet）")
    if layout["subdir_only"]:
        pattern = str(root / (branch or "[A-Z][A-Z]") / "*.parquet")
    else:
        pattern = _flat_form()
    if not _glob.glob(pattern):
        _raise_empty(f"{root}（glob={Path(pattern).name}，省份={branch or '全部'}）")
    return pattern


def resolve_province(value: str | None) -> str:
    """`--province` fail-closed 解析（手动工具省份轴收窄 · data-pipeline.md 红线）。

    仅接受已注册省份（唯一事实源 = fields.json branch_code.derivation.mapping）；
    缺省 / 空串 / 未注册省份一律抛 PolicyCurrentLayoutError，禁止静默回落 'SC'。
    大小写归一（'sc' → 'SC'）是输入便利，不构成省份回落。
    返回值供 policy_current_glob(branch=...) 与 SQL `WHERE branch_code = ?` 双层使用
    （glob 仅性能辅助，WHERE branch_code 才是隔离保证）。
    """
    if value is None or not str(value).strip():
        raise PolicyCurrentLayoutError(
            f"缺少 --province 参数（已注册省份：{sorted(_known_branches())}）。"
            "多省 warehouse 下禁止全省混查/静默回落单省 — data-pipeline.md「省份数据隔离」红线。"
        )
    branch = str(value).strip().upper()
    _validate_branch(branch)
    return branch


def has_policy_current_parquet(current_dir: str | Path) -> bool:
    """双布局数据存在性探测（不抛错）——供测试 skipif / 站点前置检查用。"""
    return bool(list_policy_current_shards(current_dir))
