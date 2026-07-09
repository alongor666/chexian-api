"""单测：邮政企微实例的省份隔离（RED LINE data-pipeline.md）。

背景（根因见 memory fact-current-mixes-sc-sx-bare-glob）：
    warehouse/fact/policy/current/ 物理混放四川 SC + 山西 SX 分片。山西亦有
    邮政/邮储经代、agent_name 同含「邮政」，故四川邮政表单靠 agent_name LIKE
    '%邮政%' 的「隐式隔离」在山西上线后失效，会把山西行混进四川企微表。

本测试锁死两件事（纯配置，不需 parquet，CI 可跑）：
    1. 两个真实邮政实例 yaml 各自声明了省份隔离（extra_where branch_code + 排他 glob）。
    2. build_where() 确实把 branch_code 条件注入 WHERE 子句（防止有人删 extra_where）。

端到端「四川取数只剩 SC、件数不含山西」的数据级验证需本地 parquet，由发布前
dry-run 承担（见 PR 描述的 dry-run 证据），不在 CI 单测内。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import sync_filtered_policies as sfp  # noqa: E402

INSTANCES_DIR = HERE / "instances"
SICHUAN_YAML = INSTANCES_DIR / "postal-policy-since-20260420.yaml"
SHANXI_YAML = INSTANCES_DIR / "shanxi-postal-all.yaml"


# ---------- 四川邮政表：必须隔离到 SC ----------


def test_sichuan_postal_instance_isolates_to_sc() -> None:
    """四川邮政实例 filters 必须带 branch_code='SC'，policy_glob 必须限定到 SC 分片。

    B5 cutover 后 policy_glob 走子目录布局（current/SC/*.parquet）；旧扁平前缀排除写法
    （current/[!S]*.parquet）作为历史形态一并接受，两者均合法排除 SX，不接受裸
    current/*.parquet 或任何带 SX 标识的取值（该断言曾用 `"SX" not in glob or "[!S]" in glob`，
    子目录布局下天然不含字面量 "SX" 而永真，2026-07-09 收紧为显式排他）。
    """
    inst = sfp.load_instance(SICHUAN_YAML)

    extra_where = inst.filters.get("extra_where", "")
    assert "branch_code" in extra_where and "SC" in extra_where, (
        f"四川邮政实例缺少 branch_code='SC' 省份隔离，会混入山西邮政行！"
        f"当前 extra_where={extra_where!r}"
    )
    glob = inst.policy_glob
    assert "current/SC/" in glob or "[!S]" in glob, (
        f"四川邮政实例 policy_glob 未限定到 SC 分片（子目录 current/SC/ 或扁平前缀排除 [!S]* 二选一）："
        f"{glob!r}"
    )
    assert "SX_" not in glob and "current/SX/" not in glob, (
        f"四川邮政实例 policy_glob 混入了 SX 分片标识：{glob!r}"
    )


def test_sichuan_build_where_injects_sc_branch_code() -> None:
    """build_where 必须把 branch_code='SC' 拼进 WHERE（锁死注入，防回归）。"""
    inst = sfp.load_instance(SICHUAN_YAML)
    where, params = sfp.build_where(inst.filters)

    assert "branch_code" in where and "SC" in where, (
        f"build_where 未注入 branch_code='SC'：{where!r}"
    )
    # 山西码绝不应出现在四川表的取数条件里
    assert "SX" not in where, f"四川取数 WHERE 不应含 SX：{where!r}"


# ---------- 山西邮政表：对称隔离到 SX（正面范例，防其被改坏） ----------


def test_shanxi_postal_instance_isolates_to_sx() -> None:
    """山西邮政实例 filters 必须带 branch_code='SX'，policy_glob 仅取 SX 分片。

    B5 cutover 后 policy_glob 走子目录布局（current/SX/*.parquet）；旧扁平前缀写法
    （current/SX_*.parquet）作为历史形态一并接受，2026-07-08 B5 cutover 未同步更新本断言曾
    致 CI 红（PR #987），一并收紧为不接受裸 current/*.parquet。
    """
    inst = sfp.load_instance(SHANXI_YAML)

    extra_where = inst.filters.get("extra_where", "")
    assert "branch_code" in extra_where and "SX" in extra_where, (
        f"山西邮政实例缺少 branch_code='SX' 省份隔离！当前 extra_where={extra_where!r}"
    )
    glob = inst.policy_glob
    assert "current/SX/" in glob or "SX_" in glob, (
        f"山西邮政实例 policy_glob 应仅取 SX 分片（子目录 current/SX/ 或扁平前缀 SX_ 二选一）：{glob!r}"
    )


def test_two_postal_tables_target_distinct_branches() -> None:
    """两张邮政表的省份隔离互斥：四川锁 SC、山西锁 SX，杜绝同源混省。"""
    sc = sfp.load_instance(SICHUAN_YAML)
    sx = sfp.load_instance(SHANXI_YAML)

    sc_where, _ = sfp.build_where(sc.filters)
    sx_where, _ = sfp.build_where(sx.filters)

    assert "SC" in sc_where and "SX" not in sc_where
    assert "SX" in sx_where and "SC" not in sx_where
    # 独立 webhook，互不写对方的表
    assert sc.webhook_env != sx.webhook_env
