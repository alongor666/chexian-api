"""policy/current 双布局路径路由单测（多省 Phase B · 801409 cutover 前置）。

被测模块：数据管理/pipelines/branch_paths.py（Node scripts/lib/policy-current-shards.mjs 的
Python 等价实现）。tmp 目录 fixture 模拟三种布局：
  - 纯扁平（现状）：顶层裸名 / sichuan_ 小写 / SX_ 前缀混放
  - 纯子目录（cutover 后）：current/SC/ + current/SX/
  - 并存（迁移冲突态）：顶层与子目录同时有 parquet → fail-closed 抛错
核心不变量：policy_current_glob 返回的 glob 实际匹配集 == policy_current_files 返回集。
"""
import sys
from pathlib import Path
import glob as pyglob

import pytest

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "数据管理"
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from pipelines.branch_paths import (  # noqa: E402
    PolicyCurrentLayoutError,
    flat_prefix_branch,
    has_policy_current_parquet,
    inspect_policy_current_layout,
    list_policy_current_shards,
    policy_current_files,
    policy_current_glob,
    resolve_province,
)


def _touch(base: Path, *rel: str) -> None:
    for r in rel:
        p = base / r
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"PAR1")


@pytest.fixture
def flat_dir(tmp_path: Path) -> Path:
    """纯扁平：数字开头裸名 + sichuan_ 小写（皆 SC）+ SX_ 前缀（山西）+ 非 parquet 杂项。"""
    d = tmp_path / "current"
    _touch(
        d,
        "01_签单清单_剔摩_20240101_20260504.parquet",
        "sichuan_每日数据_20250101_20260705.parquet",
        "SX_每日数据_20250601_20260628.parquet",
        "schema-analysis.json",
    )
    return d


@pytest.fixture
def subdir_dir(tmp_path: Path) -> Path:
    """纯子目录：SC/ ×2 + SX/ ×1；混入 archive/ staging/ 小写 zz/ 三字母 ABC/ 嵌套 SC/staging/。

    注：小写省码目录不能用 sc/（macOS 大小写不敏感文件系统会与 SC/ 合并），用 zz/ 代表。
    """
    d = tmp_path / "current"
    _touch(
        d,
        "SC/01_签单清单_剔摩.parquet",
        "SC/每日数据_20250101.parquet",
        "SX/每日数据_20250601.parquet",
        "archive/old.parquet",
        "staging/tmp.parquet",
        "zz/lower.parquet",
        "ABC/three.parquet",
        "SC/staging/nested.parquet",
        "SC/notes.txt",
    )
    return d


@pytest.fixture
def mixed_dir(tmp_path: Path) -> Path:
    """并存（迁移冲突态）：顶层 + 子目录同时有 parquet。"""
    d = tmp_path / "current"
    _touch(d, "每日数据_20250101.parquet", "SC/每日数据_20250101.parquet")
    return d


# ── 纯扁平 ──────────────────────────────────────────────────────


def test_flat_files_all(flat_dir):
    files = policy_current_files(flat_dir)
    assert [Path(f).name for f in files] == [
        "01_签单清单_剔摩_20240101_20260504.parquet",
        "SX_每日数据_20250601_20260628.parquet",
        "sichuan_每日数据_20250101_20260705.parquet",
    ]


def test_flat_files_sc_excludes_capital_s(flat_dir):
    """SC 扁平过滤 = 首字母非 'S'（逐字节等价既有 [!S]* glob：留裸名+sichuan_，排 SX_）。"""
    files = policy_current_files(flat_dir, "SC")
    names = [Path(f).name for f in files]
    assert "SX_每日数据_20250601_20260628.parquet" not in names
    assert "sichuan_每日数据_20250101_20260705.parquet" in names
    assert len(names) == 2


def test_flat_files_sx_prefix_only(flat_dir):
    files = policy_current_files(flat_dir, "SX")
    assert [Path(f).name for f in files] == ["SX_每日数据_20250601_20260628.parquet"]


@pytest.mark.parametrize("branch", [None, "SC", "SX"])
def test_flat_glob_matches_files_invariant(flat_dir, branch):
    """核心不变量：glob 实际匹配集 == files 返回集。"""
    pattern = policy_current_glob(flat_dir, branch)
    assert sorted(pyglob.glob(pattern)) == policy_current_files(flat_dir, branch)


def test_flat_glob_forms(flat_dir):
    assert policy_current_glob(flat_dir).endswith("*.parquet")
    assert policy_current_glob(flat_dir, "SC").endswith("[!S]*.parquet")
    assert policy_current_glob(flat_dir, "SX").endswith("SX_*.parquet")


# ── 纯子目录 ────────────────────────────────────────────────────


def test_subdir_enumeration_excludes_non_province_dirs(subdir_dir):
    shards = list_policy_current_shards(subdir_dir)
    branches = {s.branch for s in shards}
    assert branches == {"SC", "SX"}  # archive/staging/zz/ABC 均不入列
    assert all("archive" not in s.path and "staging" not in s.path for s in shards)
    assert len(shards) == 3


def test_subdir_files_per_branch(subdir_dir):
    assert len(policy_current_files(subdir_dir, "SC")) == 2
    assert len(policy_current_files(subdir_dir, "SX")) == 1
    assert len(policy_current_files(subdir_dir)) == 3


@pytest.mark.parametrize("branch", [None, "SC", "SX"])
def test_subdir_glob_matches_files_invariant(subdir_dir, branch):
    pattern = policy_current_glob(subdir_dir, branch)
    assert sorted(pyglob.glob(pattern)) == policy_current_files(subdir_dir, branch)


def test_subdir_glob_forms(subdir_dir):
    assert policy_current_glob(subdir_dir).endswith(str(Path("[A-Z][A-Z]") / "*.parquet"))
    assert policy_current_glob(subdir_dir, "SC").endswith(str(Path("SC") / "*.parquet"))


def test_subdir_missing_branch_raises(tmp_path):
    """子目录布局下请求省无对应子目录 → fail-closed（禁静默空结果）。"""
    d = tmp_path / "current"
    _touch(d, "SC/a.parquet")
    with pytest.raises(PolicyCurrentLayoutError):
        policy_current_files(d, "SX")
    with pytest.raises(PolicyCurrentLayoutError):
        policy_current_glob(d, "SX")


# ── 并存（迁移冲突态）──────────────────────────────────────────


def test_mixed_layout_raises(mixed_dir):
    with pytest.raises(PolicyCurrentLayoutError, match="迁移态冲突"):
        policy_current_files(mixed_dir)
    with pytest.raises(PolicyCurrentLayoutError, match="迁移态冲突"):
        policy_current_glob(mixed_dir, "SC")


def test_mixed_layout_not_excused_by_missing_ok(mixed_dir):
    """missing_ok 只豁免「无数据」，并存是有数据的冲突态 → 仍抛错。"""
    with pytest.raises(PolicyCurrentLayoutError, match="迁移态冲突"):
        policy_current_glob(mixed_dir, missing_ok=True)


def test_mixed_inspect_flags(mixed_dir):
    layout = inspect_policy_current_layout(mixed_dir)
    assert layout["mixed"] is True
    assert layout["subdir_only"] is False


# ── 0 文件 / 未注册省份 fail-closed ─────────────────────────────


def test_empty_dir_raises(tmp_path):
    d = tmp_path / "current"
    d.mkdir()
    with pytest.raises(PolicyCurrentLayoutError, match="0 个 parquet"):
        policy_current_files(d)
    with pytest.raises(PolicyCurrentLayoutError):
        policy_current_glob(d)


def test_nonexistent_dir_raises(tmp_path):
    with pytest.raises(PolicyCurrentLayoutError):
        policy_current_files(tmp_path / "nope")


def test_missing_ok_falls_back_to_flat_form(tmp_path):
    """无数据环境（worktree/CI）模块级常量场景：回落现状扁平 glob，保 import 不崩。"""
    d = tmp_path / "current"
    assert policy_current_glob(d, missing_ok=True).endswith("*.parquet")
    assert policy_current_glob(d, "SC", missing_ok=True).endswith("[!S]*.parquet")


def test_flat_branch_with_no_matching_files_raises(tmp_path):
    """扁平布局但请求省 0 匹配（如只有 SX_ 文件却要 SC）→ 抛错。"""
    d = tmp_path / "current"
    _touch(d, "SX_a.parquet")
    with pytest.raises(PolicyCurrentLayoutError):
        policy_current_files(d, "SC")


def test_unknown_branch_raises(flat_dir):
    with pytest.raises(PolicyCurrentLayoutError, match="未注册省份"):
        policy_current_files(flat_dir, "XX")
    with pytest.raises(PolicyCurrentLayoutError, match="未注册省份"):
        policy_current_glob(flat_dir, "XX")


# ── 辅助函数 ────────────────────────────────────────────────────


def test_flat_prefix_branch():
    assert flat_prefix_branch("SX_每日数据.parquet") == "SX"
    assert flat_prefix_branch("每日数据.parquet") is None
    assert flat_prefix_branch("sichuan_每日数据.parquet") is None  # 小写不算省前缀
    assert flat_prefix_branch("ABC_x.parquet") is None  # 三字母非省码


def test_has_policy_current_parquet(flat_dir, subdir_dir, tmp_path):
    assert has_policy_current_parquet(flat_dir) is True
    assert has_policy_current_parquet(subdir_dir) is True
    assert has_policy_current_parquet(tmp_path / "nope") is False


# ── resolve_province（--province fail-closed 解析 · 50d62e）────────────


def test_resolve_province_accepts_registered_codes():
    assert resolve_province("SC") == "SC"
    assert resolve_province("SX") == "SX"
    assert resolve_province(" sc ") == "SC"  # 大小写/空白归一是输入便利，非省份回落


@pytest.mark.parametrize("bad", [None, "", "   "])
def test_resolve_province_missing_raises(bad):
    with pytest.raises(PolicyCurrentLayoutError, match="缺少 --province"):
        resolve_province(bad)


@pytest.mark.parametrize("bad", ["XX", "四川", "SC,SX", "ALL"])
def test_resolve_province_unregistered_raises(bad):
    with pytest.raises(PolicyCurrentLayoutError, match="未注册省份"):
        resolve_province(bad)
