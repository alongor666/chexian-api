"""单测：refresh 按 VIN 合并跟进字段不冲掉业务员手填（codex 审计 #5）。"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import create_renewal_tracker as crt  # noqa: E402
import field_spec as fs  # noqa: E402


def _silent_log(level, msg):
    pass


def _make_state_with_docs() -> dict:
    return {
        "doc_a": {
            "docid": "doc_a",
            "url": "https://x/A",
            "kpi_sheet_id": "sht_kpi",
            "kpi_records": {"张三": "rec_kpi_zhang", "李四": "rec_kpi_li", "合计": "rec_kpi_total"},
            "salesman_sheets": {
                "张三": {
                    "sheet_id": "sht_a_zhang",
                    "records": {"VIN_001": "rec_a_z_001", "VIN_002": "rec_a_z_002"},
                },
                "李四": {
                    "sheet_id": "sht_a_li",
                    "records": {"VIN_003": "rec_a_l_003"},
                },
            },
        },
        "sheets": {
            "张三": {
                "docid": "doc_b_zhang",
                "url": "https://x/zhang",
                "sheet_id": "sht_zhang",
                "records": {"VIN_001": "rec_z_001", "VIN_002": "rec_z_002"},
            },
            "李四": {
                "docid": "doc_b_li",
                "url": "https://x/li",
                "sheet_id": "sht_li",
                "records": {"VIN_003": "rec_l_003"},
            },
        },
    }


def test_refresh_skips_未联系_rows_in_doc_a_salesman_sheets() -> None:
    """业务员未填的行（跟进状态=未联系）不应回拉到 Doc A 业务员子表
    （否则会用'未联系'覆盖 Doc A 已有值，造成无意义写入）。"""
    state = _make_state_with_docs()
    cli = MagicMock(spec=crt.WeComCli)

    # 模拟 Doc B 当前数据：
    # 张三 VIN_001: 已改为"已联系"+备注；VIN_002: 仍是默认"未联系"
    # 李四 VIN_003: 已改为"已报价"
    cli.get_records.side_effect = [
        # 张三 sheet
        [
            {"values": {
                "车架号": [{"type": "text", "text": "VIN_001"}],
                "姓名": [{"type": "text", "text": "李车主"}],
                "跟进状态": [{"text": "已联系"}],
                "跟进备注": [{"type": "text", "text": "客户已确认续保"}],
            }},
            {"values": {
                "车架号": [{"type": "text", "text": "VIN_002"}],
                "姓名": [{"type": "text", "text": ""}],
                "跟进状态": [{"text": "未联系"}],
                "跟进备注": [{"type": "text", "text": ""}],
            }},
        ],
        # 李四 sheet
        [
            {"values": {
                "车架号": [{"type": "text", "text": "VIN_003"}],
                "姓名": [{"type": "text", "text": "王车主"}],
                "跟进状态": [{"text": "已报价"}],
                "跟进备注": [{"type": "text", "text": "已发报价单"}],
            }},
        ],
    ]

    # 源数据（与 SQL 输出对齐）
    rows = [
        {"vehicle_frame_no": "VIN_001", "salesman_name": "张三", "team_name": "一团队",
         "is_quoted": True, "is_renewed": False, "prior_premium": 1000.0},
        {"vehicle_frame_no": "VIN_002", "salesman_name": "张三", "team_name": "一团队",
         "is_quoted": False, "is_renewed": False, "prior_premium": 800.0},
        {"vehicle_frame_no": "VIN_003", "salesman_name": "李四", "team_name": "二团队",
         "is_quoted": True, "is_renewed": True, "prior_premium": 1500.0},
    ]

    crt.refresh_kpi_and_followup(cli, state, rows, _silent_log)

    # 检查 update_records 调用：
    # - KPI 子表更新一次
    # - 张三 子表更新 1 行（VIN_001，VIN_002 仍是"未联系"被脚本跳过）
    # - 李四 子表更新 1 行（VIN_003 已报价）
    update_calls = cli.update_records.call_args_list

    zhang_calls = [c for c in update_calls if c.args[1] == "sht_a_zhang"]
    assert len(zhang_calls) == 1, f"张三子表应调用 1 次：{zhang_calls}"
    zhang_records = zhang_calls[0].args[2]
    zhang_vins_updated = [r["record_id"] for r in zhang_records]
    assert "rec_a_z_001" in zhang_vins_updated  # VIN_001 已联系
    # VIN_002 跟进状态=未联系 + 姓名空 + 备注空 → 全部 SENTINEL_SKIP，整行无更新值，不应被加入
    assert "rec_a_z_002" not in zhang_vins_updated, (
        f"VIN_002 是默认值（未联系+空姓名+空备注），不应触发更新。实际：{zhang_vins_updated}"
    )

    li_calls = [c for c in update_calls if c.args[1] == "sht_a_li"]
    assert len(li_calls) == 1, f"李四子表应调用 1 次：{li_calls}"
    li_records = li_calls[0].args[2]
    li_vins_updated = [r["record_id"] for r in li_records]
    assert "rec_a_l_003" in li_vins_updated  # VIN_003 已报价


def test_refresh_kpi_uses_record_id_from_state() -> None:
    """codex #5：KPI 行更新必须按 state.doc_a.kpi_records[salesman] -> record_id 定位，
    不能每次重新 get_records 匹配。"""
    state = _make_state_with_docs()
    cli = MagicMock(spec=crt.WeComCli)
    cli.get_records.return_value = []  # Doc B 都为空
    rows = [
        {"vehicle_frame_no": "VIN_001", "salesman_name": "张三", "team_name": "一团队",
         "is_quoted": True, "is_renewed": False, "prior_premium": 1000.0},
        {"vehicle_frame_no": "VIN_003", "salesman_name": "李四", "team_name": "二团队",
         "is_quoted": False, "is_renewed": False, "prior_premium": 1500.0},
    ]

    crt.refresh_kpi_and_followup(cli, state, rows, _silent_log)

    update_calls = cli.update_records.call_args_list
    kpi_calls = [c for c in update_calls if c.args[1] == "sht_kpi"]
    assert len(kpi_calls) == 1
    kpi_records_sent = kpi_calls[0].args[2]
    record_ids = [r["record_id"] for r in kpi_records_sent]
    # 必须使用 state 中持久化的 record_id（而不是查询表后匹配出来的）
    assert "rec_kpi_zhang" in record_ids
    assert "rec_kpi_li" in record_ids
    assert "rec_kpi_total" in record_ids


def test_refresh_long_followup_note_safe() -> None:
    """长文本跟进备注转义安全（不破坏 JSON 包装）。"""
    long_note = "客户" * 200 + "\n包含换行\t制表符 \"双引号\" '单引号' & 符号"
    out = fs.render_force_text(long_note)
    assert out == [{"type": "text", "text": long_note}]
    # 测试 build_record_values 渲染单行时长备注不损坏
    row = {"vehicle_frame_no": "VIN_X", "is_quoted": True, "is_renewed": False}
    values = fs.build_record_values(row, fs.WORKBENCH_FIELDS)
    assert values["跟进备注"] == [{"type": "text", "text": ""}]  # 默认空
