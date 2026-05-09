"""单测：Doc A 业务员子表（方案 C 新增）行为验证。

验证：
- 首次建：add_sheet → init_fields → add_records → state 持久化
- 续跑跳过：已有 sheet_id 的业务员不再 add_sheet
- 已部分写过：只 add_records 缺失的 VIN
- 跨业务员独立：sheet_id 互不污染
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import create_renewal_tracker as crt  # noqa: E402


def _silent_log(level, msg):
    pass


def _row(vin: str, salesman: str = "张三") -> dict:
    return {
        "vehicle_frame_no": vin,
        "salesman_name": salesman,
        "team_name": "一团队",
        "org_level_3": "乐山",
        "is_quoted": True,
        "is_renewed": False,
        "prior_premium": 1000.0,
    }


def test_first_time_creates_sheet_and_writes_records(tmp_path: Path) -> None:
    state = {"doc_a": {"docid": "doc_a", "kpi_sheet_id": "sht_kpi", "salesman_sheets": {}}}
    cli = MagicMock(spec=crt.WeComCli)
    cli.add_sheet.return_value = {"sheet_id": "sht_zhang_a"}
    cli.get_fields.return_value = [{"field_id": "fid_default", "field_type": "FIELD_TYPE_TEXT"}]
    cli.add_records.return_value = [
        {"record_id": "rec_aa1"}, {"record_id": "rec_aa2"},
    ]
    sp = tmp_path / "state.json"

    rows = [_row("VIN_001"), _row("VIN_002")]
    snapshot = crt.build_doc_a_salesman_sheet(cli, state, "张三", rows, sp, _silent_log)

    cli.add_sheet.assert_called_once_with("doc_a", title="张三")
    cli.update_fields.assert_called_once()  # 重命名默认字段
    cli.add_records.assert_called_once()
    assert snapshot["sheet_id"] == "sht_zhang_a"
    assert snapshot["records"] == {"VIN_001": "rec_aa1", "VIN_002": "rec_aa2"}
    assert snapshot["record_count"] == 2
    assert state["doc_a"]["salesman_sheets"]["张三"]["sheet_id"] == "sht_zhang_a"


def test_resume_skips_add_sheet_when_state_has_sheet_id(tmp_path: Path) -> None:
    """续跑时：state 已有 sheet_id 与 全部 record，应不再调 add_sheet / add_records。"""
    state = {
        "doc_a": {
            "docid": "doc_a", "kpi_sheet_id": "sht_kpi",
            "salesman_sheets": {
                "张三": {
                    "sheet_id": "sht_zhang_a",
                    "records": {"VIN_001": "rec_aa1", "VIN_002": "rec_aa2"},
                }
            },
        }
    }
    cli = MagicMock(spec=crt.WeComCli)
    sp = tmp_path / "state.json"

    rows = [_row("VIN_001"), _row("VIN_002")]
    crt.build_doc_a_salesman_sheet(cli, state, "张三", rows, sp, _silent_log)

    cli.add_sheet.assert_not_called()
    cli.add_records.assert_not_called()


def test_resume_writes_only_missing_vins(tmp_path: Path) -> None:
    """续跑：sheet_id 已有，部分 VIN 已写过，只补写缺失的 VIN。"""
    state = {
        "doc_a": {
            "docid": "doc_a", "kpi_sheet_id": "sht_kpi",
            "salesman_sheets": {
                "张三": {
                    "sheet_id": "sht_zhang_a",
                    "records": {"VIN_001": "rec_aa1"},  # VIN_001 已写
                }
            },
        }
    }
    cli = MagicMock(spec=crt.WeComCli)
    cli.add_records.return_value = [{"record_id": "rec_aa2"}]
    sp = tmp_path / "state.json"

    rows = [_row("VIN_001"), _row("VIN_002")]  # VIN_002 缺失
    crt.build_doc_a_salesman_sheet(cli, state, "张三", rows, sp, _silent_log)

    cli.add_sheet.assert_not_called()
    cli.add_records.assert_called_once()
    # 验证只发了 VIN_002 一条
    call_args = cli.add_records.call_args
    sent_records = call_args.args[2]
    assert len(sent_records) == 1
    snapshot = state["doc_a"]["salesman_sheets"]["张三"]
    assert snapshot["records"] == {"VIN_001": "rec_aa1", "VIN_002": "rec_aa2"}


def test_two_salesmen_isolated_sheet_ids(tmp_path: Path) -> None:
    """两个业务员的 sheet_id 互不污染。"""
    state = {"doc_a": {"docid": "doc_a", "kpi_sheet_id": "sht_kpi", "salesman_sheets": {}}}
    cli = MagicMock(spec=crt.WeComCli)
    cli.get_fields.return_value = [{"field_id": "fid_default", "field_type": "FIELD_TYPE_TEXT"}]
    cli.add_sheet.side_effect = [{"sheet_id": "sht_zhang"}, {"sheet_id": "sht_li"}]
    cli.add_records.side_effect = [
        [{"record_id": "rec_z1"}],
        [{"record_id": "rec_l1"}],
    ]
    sp = tmp_path / "state.json"

    crt.build_doc_a_salesman_sheet(cli, state, "张三", [_row("VIN_Z1", "张三")], sp, _silent_log)
    crt.build_doc_a_salesman_sheet(cli, state, "李四", [_row("VIN_L1", "李四")], sp, _silent_log)

    sheets = state["doc_a"]["salesman_sheets"]
    assert sheets["张三"]["sheet_id"] == "sht_zhang"
    assert sheets["李四"]["sheet_id"] == "sht_li"
    assert sheets["张三"]["records"] == {"VIN_Z1": "rec_z1"}
    assert sheets["李四"]["records"] == {"VIN_L1": "rec_l1"}


def test_persists_sheet_id_before_init_fields(tmp_path: Path) -> None:
    """codex P2：add_sheet 拿到 sheet_id 立即 save_state，再 init_fields；init 失败重试只补字段。"""
    state = {"doc_a": {"docid": "doc_a", "kpi_sheet_id": "sht_kpi", "salesman_sheets": {}}}
    cli = MagicMock(spec=crt.WeComCli)
    cli.add_sheet.return_value = {"sheet_id": "sht_zhang_a"}

    init_calls = []

    def fake_init(*args, **kwargs):
        init_calls.append(1)
        if len(init_calls) == 1:
            raise RuntimeError("模拟首次 init_fields 失败")

    sp = tmp_path / "state.json"
    original = crt.init_default_sheet_fields
    crt.init_default_sheet_fields = fake_init
    try:
        try:
            crt.build_doc_a_salesman_sheet(cli, state, "张三", [_row("VIN_001")], sp, _silent_log)
        except RuntimeError:
            pass

        snap1 = state["doc_a"]["salesman_sheets"]["张三"]
        assert snap1["sheet_id"] == "sht_zhang_a"
        assert snap1.get("fields_initialized") is False

        cli.add_records.return_value = [{"record_id": "rec_aa1"}]
        crt.build_doc_a_salesman_sheet(cli, state, "张三", [_row("VIN_001")], sp, _silent_log)

        cli.add_sheet.assert_called_once()
        assert len(init_calls) == 2
        snap2 = state["doc_a"]["salesman_sheets"]["张三"]
        assert snap2["fields_initialized"] is True
        assert snap2["records"] == {"VIN_001": "rec_aa1"}
    finally:
        crt.init_default_sheet_fields = original
