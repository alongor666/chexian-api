"""单测：续保引擎 v2 跨省省份隔离（branch_code）生效。

背景：`数据管理/warehouse/fact/policy/current/` 物理混放 SC+SX，sync_renewal_v2 旧版裸读
`current/*.parquet` 无 WHERE branch_code 过滤，会把山西保单推进四川企微表（duckdb 实证 H1
窗口混入 3.99 万山西行）。本测试锁两层：

  层1（无需 parquet · CI 必跑）：load_instance 对缺省 / 非注册 branch_code fail-closed。
  层2（skipif 无本地 parquet）：SC 实例取数纯 SC + 出口断言被接入 + 裸读混省会被断言拦下（负向）。

参考裁决：architect 设计闸-1（问题3/4/7）。关联 RED LINE .claude/rules/data-pipeline.md「省份数据隔离」。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import sync_renewal_v2 as m  # noqa: E402
from pipelines.branch_assert import BranchIsolationError  # noqa: E402

# worktree warehouse gitignored 为空 → 指向主仓数据。两路径任一存在即用。
_CANDIDATES = [
    HERE.parents[1] / "warehouse" / "fact" / "policy" / "current",  # 主仓本地运行
]
# worktree 运行时回落主仓绝对路径（与 data-pipeline.md「worktree 无 Parquet」一致）
_MAIN_REPO_WH = Path(
    "/Users/alongor666/Downloads/底层数据湖DUD/chexian-api/数据管理/warehouse"
)
PARQUET_DIR = next((p for p in _CANDIDATES if p.exists() and any(p.rglob("*.parquet"))), None)
if PARQUET_DIR is None and (_MAIN_REPO_WH / "fact/policy/current").exists():
    PARQUET_DIR = _MAIN_REPO_WH / "fact/policy/current"

_HAS_PARQUET = PARQUET_DIR is not None and any(PARQUET_DIR.rglob("*.parquet"))


def _write_instance(tmp_path: Path, extra: str = "") -> Path:
    """造一个最小 H1 风格实例 YAML，extra 注入/覆盖顶层键。"""
    body = f"""
instance_name: test_branch_iso
webhook_env: WECOM_TEST_WEBHOOK
{extra}
filters:
  insurance_type: 商业保险
  insurance_start_date_from: '2025-01-01'
  insurance_start_date_to: '2025-06-30'
  premium_gt: 200
  exclude_endorsement: true
  organization_in: null
quote_window_start: '2025-12-03'
fields_enabled:
  - expiry_date
  - vehicle_frame_no
"""
    p = tmp_path / "inst.yaml"
    p.write_text(body, encoding="utf-8")
    return p


# ---------- 层1：fail-closed（无需 parquet）----------

def test_missing_branch_code_fails_closed(tmp_path: Path) -> None:
    """缺 branch_code → RuntimeError 中止，禁止静默回落 SC。"""
    path = _write_instance(tmp_path, extra="")  # 不声明 branch_code
    with pytest.raises(RuntimeError, match="缺少必填字段 branch_code"):
        m.load_instance(path)


def test_unregistered_branch_code_fails_closed(tmp_path: Path) -> None:
    """branch_code 非已注册省份 → RuntimeError 中止。"""
    path = _write_instance(tmp_path, extra="branch_code: ZZ")
    with pytest.raises(RuntimeError, match="非已注册省份"):
        m.load_instance(path)


def test_registered_branch_code_loads(tmp_path: Path) -> None:
    """合法 SC → 正常加载，字段透传。"""
    path = _write_instance(tmp_path, extra="branch_code: SC")
    inst = m.load_instance(path)
    assert inst.branch_code == "SC"


# ---------- 层2：端到端隔离（skipif 无 parquet）----------

@pytest.fixture
def _point_to_data(monkeypatch):
    """把模块级数据路径指向真实 parquet（worktree 回落主仓）。"""
    wh = PARQUET_DIR.parents[2]  # .../warehouse
    # 双布局自适应（branch_paths SSOT · 801409 cutover 前置）：与生产 DEFAULT_POLICY_GLOB 同源，
    # 否则 cutover 后守卫（rglob 见子目录数据）判定运行、但消费扁平 glob 读 0 行报错。
    from pipelines.branch_paths import policy_current_glob
    monkeypatch.setattr(m, "DEFAULT_POLICY_GLOB", policy_current_glob(PARQUET_DIR, missing_ok=True))
    monkeypatch.setattr(m, "DEFAULT_QUOTES_PATH", wh / "fact/quotes_conversion/latest.parquet")
    monkeypatch.setattr(m, "DEFAULT_SALESMAN_PATH", wh / "dim/salesman/latest.parquet")
    monkeypatch.setattr(m, "DEFAULT_CUSTOMER_FLOW_PATH", wh / "fact/customer_flow/latest.parquet")
    return wh


@pytest.mark.skipif(not _HAS_PARQUET, reason="本地无 policy parquet，CI 跳过端到端隔离测试")
def test_sc_instance_yields_pure_sc(tmp_path: Path, _point_to_data) -> None:
    """SC 实例取数后 policy_no[:3] 全部派生 SC，0 SX 混入。"""
    path = _write_instance(tmp_path, extra="branch_code: SC")
    inst = m.load_instance(path)
    rows, _ = m.build_source_rows(inst)
    assert rows, "SC H1 窗口应有数据"
    mapping = m.get_branch_mapping()
    provinces = {mapping.get(str(r.get("policy_no"))[:3], "UNKNOWN") for r in rows}
    assert provinces == {"SC"}, f"混入非 SC 省份: {provinces}"


@pytest.mark.skipif(not _HAS_PARQUET, reason="本地无 policy parquet，CI 跳过端到端隔离测试")
def test_exit_assertion_is_wired(tmp_path: Path, _point_to_data, monkeypatch) -> None:
    """出口防线④ assert_single_branch 确被调用（接入回归锁）。"""
    calls = []
    real = m.assert_single_branch
    monkeypatch.setattr(m, "assert_single_branch", lambda df, **kw: (calls.append(kw), real(df, **kw))[1])
    path = _write_instance(tmp_path, extra="branch_code: SC")
    inst = m.load_instance(path)
    m.build_source_rows(inst)
    assert len(calls) == 1, "build_source_rows 出口必须调用一次 assert_single_branch"
    assert "续保引擎企微出口" in calls[0].get("context", "")


@pytest.mark.skipif(not _HAS_PARQUET, reason="本地无 policy parquet，CI 跳过端到端隔离测试")
def test_backstop_catches_mixed_province(_point_to_data) -> None:
    """负向：裸读混省 current/（无 branch_code 过滤）→ 出口断言 fail-closed 抛错。

    证明「即便 WHERE 漏了，防线④也混不出去」。直接读混省 glob 喂 assert_single_branch。
    """
    import duckdb
    con = duckdb.connect(":memory:")
    df = con.execute(
        f"SELECT policy_no FROM read_parquet('{m.DEFAULT_POLICY_GLOB}', union_by_name=true) "
        "WHERE insurance_type = '商业保险' "
        "AND CAST(insurance_start_date AS DATE) BETWEEN DATE '2025-01-01' AND DATE '2025-06-30' "
        "LIMIT 200000"
    ).fetchdf()
    with pytest.raises(BranchIsolationError, match="跨省混入"):
        m.assert_single_branch(df, allow_national=False, context="负向测试")
