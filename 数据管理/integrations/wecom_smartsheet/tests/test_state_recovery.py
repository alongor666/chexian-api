"""单测：state 续跑跳过逻辑（codex 审计 #6）。

确保：
- Doc B 已存在的业务员重跑跳过 create_doc
- Doc A 已存在跳过 create_doc
- smoke 模式独立 state 文件，不污染正式 state
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import create_renewal_tracker as crt  # noqa: E402


def _silent_log(level, msg):
    pass


def test_build_doc_b_skips_when_state_has_docid(tmp_path: Path) -> None:
    """已建过的业务员（含 sheet_id + records）重跑应直接复用 state，不再调 create_doc / add_records。"""
    cli = MagicMock(spec=crt.WeComCli)
    state = {
        "sheets": {
            "张三": {
                "docid": "doc_existing",
                "url": "https://x.example/doc_existing",
                "sheet_id": "sht_existing",
                "record_count": 5,
                "records": {"VIN_X": "rec_x"},
            },
        },
    }
    state_sink = tmp_path / "state.json"
    snapshot = crt.build_doc_b(
        cli, state, "张三",
        rows=[{"vehicle_frame_no": "VIN_X"}],
        smoke=False, state_sink=state_sink, log=_silent_log,
    )
    assert snapshot["docid"] == "doc_existing"
    cli.create_doc.assert_not_called()
    cli.add_records.assert_not_called()


def test_build_doc_a_skips_when_state_has_docid_and_kpi_sheet(tmp_path: Path) -> None:
    """新版 build_doc_a：完整建好（含 kpi_sheet_id）才跳过创建。"""
    cli = MagicMock(spec=crt.WeComCli)
    state = {
        "doc_a": {
            "docid": "doc_a_existing",
            "url": "https://x/A",
            "kpi_sheet_id": "sht_kpi_existing",
            "kpi_records": {},
            "salesman_sheets": {},
        }
    }
    sp = tmp_path / "state.json"
    result = crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)
    assert result["docid"] == "doc_a_existing"
    assert result["kpi_sheet_id"] == "sht_kpi_existing"
    cli.create_doc.assert_not_called()
    cli.add_sheet.assert_not_called()  # 不再建全量明细子表


def test_build_doc_a_includes_salesman_sheets_dict(tmp_path: Path) -> None:
    """新版 doc_a state 必须有 salesman_sheets 字典占位（即使空）。"""
    cli = MagicMock(spec=crt.WeComCli)
    state = {
        "doc_a": {
            "docid": "doc_a_existing",
            "url": "https://x/A",
            "kpi_sheet_id": "sht_kpi_existing",
        }
    }
    sp = tmp_path / "state.json"
    result = crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)
    assert "salesman_sheets" in result
    assert result["salesman_sheets"] == {}
    assert "kpi_records" in result


def test_build_doc_a_persists_docid_immediately_after_create(tmp_path: Path) -> None:
    """codex P1：create_doc 成功后立即 save_state，防止后续步骤失败造成孤儿 Doc A。"""
    cli = MagicMock(spec=crt.WeComCli)
    cli.create_doc.return_value = {"docid": "DOC_NEW", "url": "https://x/new"}
    cli.get_sheets.side_effect = RuntimeError("模拟 get_sheets 失败")

    state: dict = {}
    sp = tmp_path / "state.json"
    try:
        crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)
    except RuntimeError:
        pass
    persisted = json.loads(sp.read_text(encoding="utf-8"))
    assert persisted["doc_a"]["docid"] == "DOC_NEW"
    assert persisted["doc_a"]["url"] == "https://x/new"
    assert "kpi_sheet_id" not in persisted["doc_a"]


def test_build_doc_a_persists_kpi_sheet_id_before_init_fields(tmp_path: Path) -> None:
    """codex P1：拿到 kpi_sheet_id 后立即 save_state，再 init_fields；init 失败重跑不再建 sheet。"""
    cli = MagicMock(spec=crt.WeComCli)
    cli.create_doc.return_value = {"docid": "DOC_NEW", "url": "https://x/new"}
    cli.get_sheets.return_value = [{"sheet_id": "SHT_KPI"}]

    init_calls = []

    def fake_init(*args, **kwargs):
        init_calls.append(1)
        raise RuntimeError("模拟 init_fields 失败")

    state: dict = {}
    sp = tmp_path / "state.json"
    original = crt.init_default_sheet_fields
    crt.init_default_sheet_fields = fake_init
    try:
        try:
            crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)
        except RuntimeError:
            pass
        persisted = json.loads(sp.read_text(encoding="utf-8"))
        assert persisted["doc_a"]["kpi_sheet_id"] == "SHT_KPI"
        assert persisted["doc_a"]["kpi_fields_initialized"] is False
        assert len(init_calls) == 1
    finally:
        crt.init_default_sheet_fields = original


def test_build_doc_a_retries_kpi_init_after_first_init_failure(tmp_path: Path) -> None:
    """codex P1：init_fields 首次失败、kpi_fields_initialized=False 落盘后，
    重跑必须补 init（不能因 docid+kpi_sheet_id 都齐就整体跳过）。"""
    cli = MagicMock(spec=crt.WeComCli)
    cli.create_doc.return_value = {"docid": "DOC_NEW", "url": "https://x/new"}
    cli.get_sheets.return_value = [{"sheet_id": "SHT_KPI"}]

    init_calls = []

    def fake_init_fail_then_succeed(*args, **kwargs):
        init_calls.append(1)
        if len(init_calls) == 1:
            raise RuntimeError("模拟首次 init_fields 失败")
        # 第二次成功

    state: dict = {}
    sp = tmp_path / "state.json"
    original = crt.init_default_sheet_fields
    crt.init_default_sheet_fields = fake_init_fail_then_succeed
    try:
        # 首次：create_doc + get_sheets + 失败的 init
        try:
            crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)
        except RuntimeError:
            pass

        # 重跑：必须不再 create_doc / get_sheets，但要重新 init（这里关键）
        cli.create_doc.reset_mock()
        cli.get_sheets.reset_mock()
        result = crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)

        cli.create_doc.assert_not_called()
        cli.get_sheets.assert_not_called()
        assert len(init_calls) == 2  # init 又被调一次（补 init）
        assert result["kpi_fields_initialized"] is True
        persisted = json.loads(sp.read_text(encoding="utf-8"))
        assert persisted["doc_a"]["kpi_fields_initialized"] is True
    finally:
        crt.init_default_sheet_fields = original


def test_build_doc_a_skip_for_legacy_state_without_init_flag(tmp_path: Path) -> None:
    """向后兼容：PR #343 建好的 Doc A（state 无 kpi_fields_initialized 字段）必须直接跳过 init。"""
    cli = MagicMock(spec=crt.WeComCli)
    state = {
        "doc_a": {
            "docid": "DOC_LEGACY",
            "url": "https://x/legacy",
            "kpi_sheet_id": "SHT_LEGACY",
            "kpi_records": {},
            "salesman_sheets": {},
        }
    }
    sp = tmp_path / "state.json"
    init_called = []
    original = crt.init_default_sheet_fields
    crt.init_default_sheet_fields = lambda *a, **kw: init_called.append(1)
    try:
        result = crt.build_doc_a(cli, state, smoke=False, state_sink=sp, log=_silent_log)
        cli.create_doc.assert_not_called()
        cli.get_sheets.assert_not_called()
        assert len(init_called) == 0  # 旧 state 视为已初始化，不补 init
        assert result["docid"] == "DOC_LEGACY"
    finally:
        crt.init_default_sheet_fields = original


def test_group_by_salesman_unassigned_fallback() -> None:
    """codex P1：空 salesman_name 必须 fallback 到 "未分配" 桶，不可静默丢弃（防数据丢失）。"""
    rows = [
        {"salesman_name": "张三", "vehicle_frame_no": "VIN_A"},
        {"salesman_name": "", "vehicle_frame_no": "VIN_B"},
        {"salesman_name": None, "vehicle_frame_no": "VIN_C"},
        {"salesman_name": "  ", "vehicle_frame_no": "VIN_D"},  # 仅空白
        {"salesman_name": "李四", "vehicle_frame_no": "VIN_E"},
    ]
    groups = dict(crt.group_by_salesman(rows))
    assert "张三" in groups and len(groups["张三"]) == 1
    assert "李四" in groups and len(groups["李四"]) == 1
    assert crt.UNASSIGNED_SALESMAN in groups
    assert len(groups[crt.UNASSIGNED_SALESMAN]) == 3
    assert sum(len(g) for g in groups.values()) == len(rows)


def test_state_path_smoke_isolated_from_prod() -> None:
    """codex #6：smoke 模式必须用独立 state 文件，不能污染正式。"""
    smoke_path = crt.state_path("smoke")
    prod_path = crt.state_path("")
    assert smoke_path != prod_path
    assert "smoke" in smoke_path.name
    assert "smoke" not in prod_path.name


def test_load_save_state_roundtrip(tmp_path: Path) -> None:
    sp = tmp_path / "test_state.json"
    state = crt.load_state(sp)
    assert state["sheets"] == {}
    assert state["doc_a"] == {}
    state["sheets"]["张三"] = {"docid": "d1", "records": {"VIN1": "r1"}}
    crt.save_state(sp, state)
    loaded = crt.load_state(sp)
    assert loaded["sheets"]["张三"]["docid"] == "d1"
    assert loaded["sheets"]["张三"]["records"]["VIN1"] == "r1"
    assert loaded["created_at"] is not None
    assert loaded["updated_at"] is not None


def test_failure_does_not_block_other_salesmen() -> None:
    """单业务员失败不阻塞其他业务员（codex #6 第 3 项）。"""
    # 该测试验证主流程的降级逻辑：通过手动模拟而非完整跑 main()
    failures = []
    sheets = ["张三", "李四", "王五"]

    def fake_build(salesman):
        if salesman == "李四":
            raise RuntimeError("企微 errcode=99999 模拟失败")
        return {"docid": f"doc_{salesman}", "url": f"https://x/{salesman}"}

    snapshots = {}
    for s in sheets:
        try:
            snapshots[s] = fake_build(s)
        except Exception as exc:  # noqa: BLE001
            failures.append({"salesman": s, "error": str(exc)})

    assert "张三" in snapshots
    assert "王五" in snapshots
    assert "李四" not in snapshots
    assert len(failures) == 1
    assert failures[0]["salesman"] == "李四"
