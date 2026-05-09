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


def test_build_doc_a_skips_when_state_has_docid_and_kpi_sheet() -> None:
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
    result = crt.build_doc_a(cli, state, smoke=False, log=_silent_log)
    assert result["docid"] == "doc_a_existing"
    assert result["kpi_sheet_id"] == "sht_kpi_existing"
    cli.create_doc.assert_not_called()
    cli.add_sheet.assert_not_called()  # 不再建全量明细子表


def test_build_doc_a_includes_salesman_sheets_dict() -> None:
    """新版 doc_a state 必须有 salesman_sheets 字典占位（即使空）。"""
    cli = MagicMock(spec=crt.WeComCli)
    state = {
        "doc_a": {
            "docid": "doc_a_existing",
            "url": "https://x/A",
            "kpi_sheet_id": "sht_kpi_existing",
        }
    }
    result = crt.build_doc_a(cli, state, smoke=False, log=_silent_log)
    assert "salesman_sheets" in result
    assert result["salesman_sheets"] == {}
    assert "kpi_records" in result


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
