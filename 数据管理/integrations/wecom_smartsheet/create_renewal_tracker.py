#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按业务员独立文档 + 主管汇总的续保追踪批量建表器。

设计文档：~/.claude/plans/wechat-cli-5-expressive-narwhal.md（已批准）

功能：
- 复用 sync_renewal.py 的 build_source_rows() 拉取应续清单 SQL。
- 调用 wecom-cli `doc create_doc` / `smartsheet_*` 自动建文档/子表/字段/记录。
- 每业务员一份独立文档（防泄密：管理者 1 份汇总 + 业务员 N 份独立）。
- 主管文档含 KPI 子表（每业务员 1 行）+ 全量明细子表（所有应续行）。
- 支持 build / refresh 模式：refresh 不重建文档，仅刷新 KPI + 回拉跟进字段。
- state 三层 record_id 映射，便于按 VIN 精确定位与回更（不全表 get）。

使用：
    python3 create_renewal_tracker.py --org 乐山 --start 2026-05-01 --end 2026-06-30 [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

# ---- 引入同包内的 sync_renewal 与 field_spec ----
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import field_spec as fs  # noqa: E402
from sync_renewal import SyncConfig, build_source_rows  # noqa: E402


DATA_ROOT = HERE.parents[1]


# ===========================================================================
# WeCom CLI 子进程封装
# ===========================================================================
class WeComCliError(RuntimeError):
    """wecom-cli 调用失败（非零退出 / JSON 解析失败 / 业务 errcode）。"""


class WeComCli:
    """封装 `wecom-cli doc *` 调用：均通过 `--json '<JSON>'` 传参。"""

    BIN = "wecom-cli"

    def __init__(self, dry_run: bool = False, log: Any = None) -> None:
        self.dry_run = dry_run
        self._log = log if log is not None else _silent_logger()

    def _invoke(self, group: str, command: str, payload: dict[str, Any]) -> dict[str, Any]:
        """实际调子进程；dry_run 模式返回 stub。"""
        cmd = [self.BIN, group, command, "--json", json.dumps(payload, ensure_ascii=False)]
        if self.dry_run:
            self._log("debug", f"[DRY-RUN] {self.BIN} {group} {command} {json.dumps(payload, ensure_ascii=False)[:120]}")
            return {"_dry_run": True}
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                timeout=120,
            )
        except subprocess.TimeoutExpired as exc:
            raise WeComCliError(f"{group} {command} 调用超时（120s）: {exc}") from exc

        if proc.returncode != 0:
            raise WeComCliError(
                f"{group} {command} 退出码 {proc.returncode}: stderr={proc.stderr.strip()[:500]}"
            )
        if not proc.stdout.strip():
            raise WeComCliError(f"{group} {command} 输出为空（stderr: {proc.stderr.strip()[:300]}）")
        try:
            envelope = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise WeComCliError(
                f"{group} {command} 输出非 JSON: {proc.stdout.strip()[:300]}"
            ) from exc

        # wecom-cli 0.1.8 走 MCP RPC 风格：业务对象嵌套在 result.content[0].text 里（JSON 字符串，需二次 parse）
        data = _unwrap_mcp_envelope(envelope)
        if isinstance(data, dict) and data.get("errcode") not in (None, 0):
            raise WeComCliError(
                f"{group} {command} errcode={data.get('errcode')} errmsg={data.get('errmsg')}"
            )
        return data

    # ---------- 文档 ----------
    def create_doc(self, doc_name: str, doc_type: int = 10) -> dict[str, Any]:
        """新建智能表格（doc_type=10）。返回 {docid, url}。"""
        return self._invoke("doc", "create_doc", {"doc_type": doc_type, "doc_name": doc_name})

    # ---------- 子表 ----------
    def get_sheets(self, docid: str) -> list[dict[str, Any]]:
        """获取该文档下所有子表 [{sheet_id, title, ...}]。
        实测响应：{errcode, errmsg, sheet_list: [{sheet_id, title, ...}]}"""
        resp = self._invoke("doc", "smartsheet_get_sheet", {"docid": docid})
        return _coerce_list(
            resp.get("sheet_list") or resp.get("sheets") or resp.get("data") or resp
        )

    def add_sheet(self, docid: str, title: str) -> dict[str, Any]:
        """添加新子表，返回包含 sheet_id 的对象。"""
        resp = self._invoke("doc", "smartsheet_add_sheet", {
            "docid": docid,
            "properties": {"title": title},
        })
        # 兼容多种响应形态：{sheet:{...}} / {sheet_id, title} / {properties:{...}}
        if isinstance(resp, dict):
            for key in ("sheet", "properties"):
                inner = resp.get(key)
                if isinstance(inner, dict) and inner.get("sheet_id"):
                    return inner
            if resp.get("sheet_id"):
                return resp
        return resp or {}

    def update_sheet(self, docid: str, sheet_id: str, title: str) -> None:
        self._invoke("doc", "smartsheet_update_sheet", {
            "docid": docid,
            "properties": {"sheet_id": sheet_id, "title": title},
        })

    # ---------- 字段 ----------
    def get_fields(self, docid: str, sheet_id: str) -> list[dict[str, Any]]:
        resp = self._invoke("doc", "smartsheet_get_fields", {"docid": docid, "sheet_id": sheet_id})
        return _coerce_list(
            resp.get("field_list") or resp.get("fields") or resp.get("data") or resp
        )

    def update_fields(
        self, docid: str, sheet_id: str, fields: list[dict[str, str]]
    ) -> dict[str, Any]:
        return self._invoke("doc", "smartsheet_update_fields", {
            "docid": docid, "sheet_id": sheet_id, "fields": fields,
        })

    def add_fields(
        self, docid: str, sheet_id: str, fields: list[dict[str, str]]
    ) -> dict[str, Any]:
        return self._invoke("doc", "smartsheet_add_fields", {
            "docid": docid, "sheet_id": sheet_id, "fields": fields,
        })

    # ---------- 记录 ----------
    def add_records(
        self, docid: str, sheet_id: str, records: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """records=[{values: {...}}, ...]。返回新增行列表（含 record_id）。"""
        resp = self._invoke("doc", "smartsheet_add_records", {
            "docid": docid, "sheet_id": sheet_id, "records": records,
        })
        return _coerce_list(
            resp.get("record_list") or resp.get("records")
            or resp.get("add_records") or resp.get("data") or []
        )

    def update_records(
        self, docid: str, sheet_id: str, records: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """records=[{record_id, values: {...}}, ...]。"""
        return self._invoke("doc", "smartsheet_update_records", {
            "docid": docid, "sheet_id": sheet_id, "records": records,
        })

    def get_records(self, docid: str, sheet_id: str) -> list[dict[str, Any]]:
        resp = self._invoke("doc", "smartsheet_get_records", {"docid": docid, "sheet_id": sheet_id})
        return _coerce_list(
            resp.get("record_list") or resp.get("records") or resp.get("data") or resp
        )

    # ---------- 元信息 ----------
    @classmethod
    def version(cls) -> str:
        try:
            out = subprocess.run([cls.BIN, "--version"], capture_output=True, text=True, timeout=10)
            return out.stdout.strip() or out.stderr.strip()
        except Exception as exc:  # noqa: BLE001
            return f"<unknown: {exc}>"

    @classmethod
    def schema(cls, group: str, command: str) -> dict[str, Any]:
        out = subprocess.run([cls.BIN, group, command, "--schema"], capture_output=True, text=True, timeout=10)
        if out.returncode != 0:
            raise WeComCliError(f"{group} {command} --schema 失败: {out.stderr.strip()[:300]}")
        try:
            return json.loads(out.stdout)
        except json.JSONDecodeError as exc:
            raise WeComCliError(f"{group} {command} schema 非 JSON: {exc}") from exc


def _unwrap_mcp_envelope(envelope: Any) -> Any:
    """wecom-cli 0.1.8 走 MCP JSON-RPC：业务对象嵌套在 result.content[0].text。

    {
      "id": "mcp_rpc_...",
      "jsonrpc": "2.0",
      "result": {
        "content": [{"type": "text", "text": "{\"errcode\":0,\"docid\":\"...\"}"}],
        "isError": false
      }
    }

    若不是 MCP 包装（直接业务对象），原样返回。
    """
    if not isinstance(envelope, dict):
        return envelope
    if "jsonrpc" not in envelope and "result" not in envelope:
        return envelope
    if envelope.get("error"):
        raise WeComCliError(f"MCP RPC error: {envelope['error']}")
    result = envelope.get("result")
    if not isinstance(result, dict):
        return envelope
    if result.get("isError"):
        raise WeComCliError(f"MCP RPC isError: {result}")
    content = result.get("content")
    if not isinstance(content, list) or not content:
        return result
    first = content[0]
    if not isinstance(first, dict):
        return result
    text = first.get("text", "")
    if not isinstance(text, str):
        return first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 业务返回纯文本（不常见），原样包装
        return {"_raw_text": text}


def _coerce_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in ("records", "fields", "sheets", "items"):
            v = value.get(key)
            if isinstance(v, list):
                return v
    return []


def _silent_logger():
    return lambda level, msg: None


# ===========================================================================
# Preflight：版本 + schema 自检
# ===========================================================================
def preflight(log) -> dict[str, Any]:
    """运行前置检查：wecom-cli 可用 + schema 与 FieldSpec 字段类型对齐。"""
    info: dict[str, Any] = {
        "wecom_cli_version": WeComCli.version(),
        "schema_checks": [],
        "messaging_disabled": False,
    }
    log("info", f"wecom-cli 版本: {info['wecom_cli_version']}")

    # 1) 字段类型常量对齐
    schema = WeComCli.schema("doc", "smartsheet_add_fields")
    enum_values: list[str] = (
        schema.get("inputSchema", {})
        .get("properties", {})
        .get("fields", {})
        .get("items", {})
        .get("properties", {})
        .get("field_type", {})
        .get("enum", [])
    )
    enum_set = set(enum_values)
    spec_set = {spec.field_type for spec in (*fs.WORKBENCH_FIELDS, *fs.KPI_FIELDS, *fs.DETAIL_FIELDS)}
    missing = spec_set - enum_set
    info["schema_checks"].append({
        "command": "smartsheet_add_fields",
        "schema_field_types": sorted(enum_set),
        "spec_field_types": sorted(spec_set),
        "missing_in_schema": sorted(missing),
    })
    if missing:
        raise WeComCliError(
            f"FieldSpec 用到的字段类型不在 wecom-cli schema 中: {sorted(missing)}。"
            f"schema 支持: {sorted(enum_set)}"
        )
    log("info", f"schema 字段类型对齐: 期望 {len(spec_set)} 种全部存在")

    # 2) messaging 是否禁用（不阻塞，仅记录）
    msg_probe = subprocess.run(
        [WeComCli.BIN, "msg", "--help"], capture_output=True, text=True, timeout=10
    )
    if "暂不支持授权" in (msg_probe.stderr + msg_probe.stdout):
        info["messaging_disabled"] = True
        log("warn", "wecom-cli msg 接口被禁用，分发只能人工复制粘贴消息模板")

    return info


# ===========================================================================
# state 持久化（三层 record_id 映射）
# ===========================================================================
def state_path(suffix: str) -> Path:
    name = f"leshan_renewal_{suffix}.json" if suffix else "leshan_renewal.json"
    return HERE / "state" / name


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema_version": 1,
            "instance": "leshan_renewal",
            "doc_a": {},
            "sheets": {},
            "created_at": None,
            "updated_at": None,
        }
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    if not state.get("created_at"):
        state["created_at"] = state["updated_at"]
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ===========================================================================
# 数据查询 + 分组
# ===========================================================================
def rescue_records_from_doc_b(
    cli: WeComCli,
    state: dict[str, Any],
    state_sink: Path,
    expected_rows_by_salesman: dict[str, int],
    log,
) -> dict[str, int]:
    """对 state.sheets.records 为空但企微侧应有数据的业务员，调 get_records 反查并写回 state。

    场景：上次 add_records MCP 超时，服务器侧实际写入但客户端没拿到 record_id。
    解决：拉 Doc B 当前所有 records，按"车架号"列匹配 VIN，回填 record_id 到 state。
    返回：{salesman: 拉回行数}。
    """
    rescued: dict[str, int] = {}
    for salesman, sheet in state.get("sheets", {}).items():
        if not sheet.get("docid") or not sheet.get("sheet_id"):
            continue
        local_count = len(sheet.get("records") or {})
        expected = expected_rows_by_salesman.get(salesman, 0)
        if local_count >= expected and expected > 0:
            continue  # state 已完整
        log("info", f"[rescue] {salesman}: state {local_count} 行，预期 {expected} 行，调 get_records 拉真实数据")
        records = cli.get_records(sheet["docid"], sheet["sheet_id"])
        vin_to_rid: dict[str, str] = dict(sheet.get("records") or {})
        for rec in records:
            values = rec.get("values", {}) or {}
            vin = _read_text(values.get("车架号"))
            rid = rec.get("record_id") or rec.get("id")
            if vin and rid:
                vin_to_rid[vin] = rid
        if vin_to_rid:
            sheet["records"] = vin_to_rid
            sheet["record_count"] = len(vin_to_rid)
            save_state(state_sink, state)
            rescued[salesman] = len(vin_to_rid)
            log("info", f"[rescue] {salesman}: 拉回 {len(vin_to_rid)} 个 record_id（含已有）")
    return rescued


def fetch_rows(org: str, start: str, end: str) -> list[dict[str, Any]]:
    """复用 sync_renewal.build_source_rows，传 5-6 月到期窗口。"""
    config = SyncConfig(
        instance_name="leshan_renewal_tracker",
        org_level_3=org,
        insurance_type="商业保险",
        insurance_end_date_from=start,
        insurance_end_date_to=end,
        premium_gt=300.0,
        quote_window_start="2025-12-03",
    )
    return build_source_rows(config)


def group_by_salesman(rows: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
    """按业务员名分组，跳过空名；返回 [(salesman, rows), ...]，按行数倒序。"""
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        name = (row.get("salesman_name") or "").strip()
        if not name:
            continue
        buckets[name].append(row)
    return sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0]))


# ===========================================================================
# KPI 聚合
# ===========================================================================
def aggregate_kpi(
    salesman: str,
    rows: list[dict[str, Any]],
    doc_url: str = "",
    fillin_rate_pct: float = 0.0,
) -> dict[str, Any]:
    due_count = len(rows)
    quoted = sum(1 for r in rows if r.get("is_quoted"))
    renewed = sum(1 for r in rows if r.get("is_renewed"))
    premium = sum(float(r.get("prior_premium") or 0) for r in rows)
    team_name = next((r.get("team_name") for r in rows if r.get("team_name")), "未分配")
    return {
        "salesman_name": salesman,
        "team_name": team_name or "未分配",
        "due_count": due_count,
        "due_premium": round(premium, 2),
        "quoted_count": quoted,
        "renewed_count": renewed,
        "quoted_rate_pct": round(quoted / due_count * 100, 2) if due_count else 0.0,
        "renewed_rate_pct": round(renewed / due_count * 100, 2) if due_count else 0.0,
        "fillin_rate_pct": round(fillin_rate_pct, 2),
        "doc_url": doc_url,
    }


def aggregate_total(kpi_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """合计行：率值用基数加权重算（不平均率值）。"""
    due_count = sum(r["due_count"] for r in kpi_rows)
    quoted = sum(r["quoted_count"] for r in kpi_rows)
    renewed = sum(r["renewed_count"] for r in kpi_rows)
    premium = sum(r["due_premium"] for r in kpi_rows)
    # 填报率 = 各业务员"已填行数"加权 / 总应续件数
    filled = sum(round(r["fillin_rate_pct"] / 100 * r["due_count"]) for r in kpi_rows)
    return {
        "salesman_name": "合计",
        "team_name": "—",
        "due_count": due_count,
        "due_premium": round(premium, 2),
        "quoted_count": quoted,
        "renewed_count": renewed,
        "quoted_rate_pct": round(quoted / due_count * 100, 2) if due_count else 0.0,
        "renewed_rate_pct": round(renewed / due_count * 100, 2) if due_count else 0.0,
        "fillin_rate_pct": round(filled / due_count * 100, 2) if due_count else 0.0,
        "doc_url": "",
    }


# ===========================================================================
# 子表初始化（重命名默认列 + 添加剩余列）
# ===========================================================================
def init_default_sheet_fields(
    cli: WeComCli,
    docid: str,
    sheet_id: str,
    target_fields: list[fs.FieldSpec],
) -> None:
    """新子表自带 1 个默认文本列；先重命名为第 1 个目标字段，再 add_fields 加剩余。"""
    if not target_fields:
        return
    existing = cli.get_fields(docid, sheet_id)
    if not existing:
        # 没有默认字段（理论上不应发生）：直接 add_fields 全部
        cli.add_fields(docid, sheet_id, [s.to_add_field_payload() for s in target_fields])
        return

    default_field = existing[0]
    default_field_id = default_field.get("field_id")
    default_field_type = default_field.get("field_type", fs.FIELD_TYPE_TEXT)
    if not default_field_id:
        raise WeComCliError(f"默认字段缺 field_id: {default_field}")

    first = target_fields[0]
    # 默认字段必须为文本类型才能被重命名为目标第 1 列；否则要先删
    if default_field_type != fs.FIELD_TYPE_TEXT or first.field_type != fs.FIELD_TYPE_TEXT:
        # 实际上目标第 1 列我们都设计为 TEXT（"姓名" / "业务员"），此分支防御性
        if first.field_type != default_field_type:
            raise WeComCliError(
                f"默认字段类型 {default_field_type} 与目标第 1 列 {first.title}({first.field_type}) 不一致；"
                f"update_fields 不允许改类型。请确保第 1 列是 FIELD_TYPE_TEXT。"
            )
    cli.update_fields(docid, sheet_id, [{
        "field_id": default_field_id,
        "field_title": first.title,
        "field_type": default_field_type,
    }])
    # 添加剩余字段
    rest = [s.to_add_field_payload() for s in target_fields[1:]]
    if rest:
        cli.add_fields(docid, sheet_id, rest)


# ===========================================================================
# 建 Doc B（业务员独立工作台）
# ===========================================================================
def build_doc_b(
    cli: WeComCli,
    state: dict[str, Any],
    salesman: str,
    rows: list[dict[str, Any]],
    smoke: bool,
    state_sink: Path,
    log,
) -> dict[str, Any]:
    """建一份业务员文档；返回 {docid, url, sheet_id, record_count, records: {vin: record_id}}。

    增量持久化：每完成一个步骤（create_doc / update_sheet / add_fields / add_records 批次）
    立即写入 state，避免中途异常造成孤儿文档无人认领。
    """
    sheets_state = state.setdefault("sheets", {})
    snapshot = sheets_state.setdefault(salesman, {})

    # ---- 阶段 1：create_doc ----
    if not snapshot.get("docid"):
        prefix = "[SMOKE]" if smoke else ""
        doc_name = f"{prefix}{salesman}-2026年5-6月应续追踪"
        log("info", f"[build] create_doc {doc_name}")
        created = cli.create_doc(doc_name)
        docid = created.get("docid")
        url = created.get("url")
        if not docid:
            raise WeComCliError(f"create_doc 未返回 docid: {created}")
        snapshot.update({
            "docid": docid, "url": url,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "records": snapshot.get("records", {}),
        })
        save_state(state_sink, state)
    else:
        log("info", f"[skip] Doc B for {salesman} already in state（{snapshot.get('url')}）")
        if snapshot.get("records") and snapshot.get("sheet_id"):
            # 已完整：直接返回
            return snapshot

    docid = snapshot["docid"]

    # ---- 阶段 2：sheet_id ----
    if not snapshot.get("sheet_id"):
        sheets = cli.get_sheets(docid)
        if not sheets:
            raise WeComCliError(f"get_sheets 为空: {docid}")
        sheet_id = sheets[0].get("sheet_id") or sheets[0].get("id")
        if not sheet_id:
            raise WeComCliError(f"默认子表无 sheet_id: {sheets[0]}")
        cli.update_sheet(docid, sheet_id, title="应续清单")
        init_default_sheet_fields(cli, docid, sheet_id, fs.WORKBENCH_FIELDS)
        snapshot["sheet_id"] = sheet_id
        save_state(state_sink, state)
    sheet_id = snapshot["sheet_id"]

    # ---- 阶段 3：add_records（按 VIN 持久化，已写过的跳过）----
    record_map: dict[str, str] = snapshot.get("records", {})
    pending_rows = [r for r in rows
                    if (r.get("vehicle_frame_no") or "").strip()
                    and (r.get("vehicle_frame_no") or "").strip() not in record_map]
    log("info", f"[build] {salesman} 待写 {len(pending_rows)} / 总 {len(rows)} 行")
    for batch in _chunked(pending_rows, 200):
        records_payload = []
        vins_in_batch = []
        for r in batch:
            vin = (r.get("vehicle_frame_no") or "").strip()
            vins_in_batch.append(vin)
            records_payload.append({"values": fs.build_record_values(r, fs.WORKBENCH_FIELDS)})
        if not records_payload:
            continue
        added = cli.add_records(docid, sheet_id, records_payload)
        for vin, item in zip(vins_in_batch, added):
            rid = item.get("record_id") or item.get("id")
            if rid:
                record_map[vin] = rid
        snapshot["records"] = record_map
        snapshot["record_count"] = len(record_map)
        save_state(state_sink, state)
        time.sleep(0.2)

    return snapshot


# ===========================================================================
# 建 Doc A（主管汇总）
# ===========================================================================
def build_doc_a(cli: WeComCli, state: dict[str, Any], smoke: bool, log) -> dict[str, Any]:
    """建主管汇总文档（仅 KPI 子表骨架）。返回 doc_a state。

    业务员子表（每业务员 1 个）由 build_doc_a_salesman_sheet 在 Doc B 建完后追加，
    避免一次性创建空子表后又难以判断哪些已写完。
    """
    doc_a = state.setdefault("doc_a", {})

    if doc_a.get("docid") and doc_a.get("kpi_sheet_id"):
        log("info", f"[skip] Doc A already in state（{doc_a.get('url')}）")
        doc_a.setdefault("kpi_records", {})
        doc_a.setdefault("salesman_sheets", {})
        return doc_a

    if not doc_a.get("docid"):
        prefix = "[SMOKE]" if smoke else ""
        doc_name = f"{prefix}乐山5-6月续保追踪-主管汇总"
        log("info", f"[build] create_doc {doc_name}")
        created = cli.create_doc(doc_name)
        docid = created.get("docid")
        url = created.get("url")
        if not docid:
            raise WeComCliError(f"create_doc 未返回 docid: {created}")
        doc_a.update({
            "docid": docid,
            "url": url,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        })

    if not doc_a.get("kpi_sheet_id"):
        sheets = cli.get_sheets(doc_a["docid"])
        kpi_sheet_id = sheets[0].get("sheet_id") or sheets[0].get("id")
        cli.update_sheet(doc_a["docid"], kpi_sheet_id, title="KPI看板")
        init_default_sheet_fields(cli, doc_a["docid"], kpi_sheet_id, fs.KPI_FIELDS)
        doc_a["kpi_sheet_id"] = kpi_sheet_id

    doc_a.setdefault("kpi_records", {})
    doc_a.setdefault("salesman_sheets", {})
    return doc_a


# ===========================================================================
# 在 Doc A 中建业务员子表（每业务员 1 张，主管视角的镜像清单）
# ===========================================================================
def build_doc_a_salesman_sheet(
    cli: WeComCli,
    state: dict[str, Any],
    salesman: str,
    rows: list[dict[str, Any]],
    state_sink: Path,
    log,
) -> dict[str, Any]:
    """在 Doc A 中为某业务员建子表 + 写入应续清单（主管视角的镜像）。

    分阶段持久化：add_sheet → init_fields → 批次 add_records，任一阶段失败重跑可续。
    返回 {sheet_id, records: {vin: record_id}, record_count}。
    """
    doc_a = state["doc_a"]
    docid = doc_a["docid"]
    salesman_sheets = doc_a.setdefault("salesman_sheets", {})
    snapshot = salesman_sheets.setdefault(salesman, {})

    # ---- 阶段 1：add_sheet + 字段初始化 ----
    if not snapshot.get("sheet_id"):
        log("info", f"[doc_a] add_sheet {salesman}")
        added = cli.add_sheet(docid, title=salesman)
        sheet_id = added.get("sheet_id") or added.get("id")
        if not sheet_id:
            all_sheets = cli.get_sheets(docid)
            sheet_id = all_sheets[-1].get("sheet_id") or all_sheets[-1].get("id")
        if not sheet_id:
            raise WeComCliError(f"add_sheet 未拿到 sheet_id（业务员 {salesman}）")
        init_default_sheet_fields(cli, docid, sheet_id, fs.WORKBENCH_FIELDS)
        snapshot["sheet_id"] = sheet_id
        snapshot.setdefault("records", {})
        save_state(state_sink, state)

    sheet_id = snapshot["sheet_id"]
    record_map: dict[str, str] = snapshot.get("records", {})

    # ---- 阶段 2：add_records（按 VIN 持久化，已写过的跳过）----
    pending_rows = [r for r in rows
                    if (r.get("vehicle_frame_no") or "").strip()
                    and (r.get("vehicle_frame_no") or "").strip() not in record_map]
    log("info", f"[doc_a] {salesman} 子表 待写 {len(pending_rows)} / 总 {len(rows)} 行")
    for batch in _chunked(pending_rows, 200):
        records_payload = []
        vins_in_batch = []
        for r in batch:
            vin = (r.get("vehicle_frame_no") or "").strip()
            vins_in_batch.append(vin)
            records_payload.append({"values": fs.build_record_values(r, fs.WORKBENCH_FIELDS)})
        if not records_payload:
            continue
        added = cli.add_records(docid, sheet_id, records_payload)
        for vin, item in zip(vins_in_batch, added):
            rid = item.get("record_id") or item.get("id")
            if rid:
                record_map[vin] = rid
        snapshot["records"] = record_map
        snapshot["record_count"] = len(record_map)
        save_state(state_sink, state)
        time.sleep(0.2)

    return snapshot


# ===========================================================================
# Doc A KPI 子表回填（业务员明细子表已在 build_doc_a_salesman_sheet 阶段写完）
# ===========================================================================
def backfill_doc_a(
    cli: WeComCli,
    state: dict[str, Any],
    kpi_rows: list[dict[str, Any]],
    state_sink: Path,
    log,
) -> None:
    """KPI 子表写入 / 刷新（业务员子表已在 build_doc_a_salesman_sheet 阶段写完）。

    KPI 子表逻辑：
    - 不存在 record_id（首次）→ add_records，记录 record_id
    - 存在 record_id（重跑刷 doc_url 等）→ update_records 刷新所有指标 + url
    """
    doc_a = state["doc_a"]
    docid = doc_a["docid"]
    kpi_records = doc_a.setdefault("kpi_records", {})

    new_rows = [r for r in kpi_rows if r["salesman_name"] not in kpi_records]
    update_rows = [r for r in kpi_rows if r["salesman_name"] in kpi_records]

    if new_rows:
        log("info", f"[backfill] KPI 子表 add {len(new_rows)} 行")
        records_payload = [{"values": fs.build_record_values(r, fs.KPI_FIELDS)} for r in new_rows]
        added = cli.add_records(docid, doc_a["kpi_sheet_id"], records_payload)
        for r, item in zip(new_rows, added):
            rid = item.get("record_id") or item.get("id")
            if rid:
                kpi_records[r["salesman_name"]] = rid
        save_state(state_sink, state)

    if update_rows:
        log("info", f"[backfill] KPI 子表 update {len(update_rows)} 行（刷新 url/指标）")
        update_payload = []
        for r in update_rows:
            update_payload.append({
                "record_id": kpi_records[r["salesman_name"]],
                "values": fs.build_record_values(r, fs.KPI_FIELDS),
            })
        for batch in _chunked(update_payload, 200):
            cli.update_records(docid, doc_a["kpi_sheet_id"], batch)
            time.sleep(0.2)


# ===========================================================================
# Refresh 模式：从 Doc B 拉跟进字段，刷新 Doc A KPI + 业务员子表
# ===========================================================================
def refresh_kpi_and_followup(
    cli: WeComCli,
    state: dict[str, Any],
    rows: list[dict[str, Any]],
    log,
) -> None:
    doc_a = state["doc_a"]
    if not doc_a.get("docid"):
        raise WeComCliError("refresh 失败：Doc A 不存在于 state，请先 build")

    sheets_state = state["sheets"]
    # 从每个 Doc B 拉跟进字段
    salesman_followup: dict[str, dict[str, dict[str, str]]] = {}  # salesman -> {vin: {跟进状态, 跟进备注, 姓名}}
    fillin_rate_by_salesman: dict[str, float] = {}
    for salesman, sheet in sheets_state.items():
        if not sheet.get("docid"):
            continue
        records = cli.get_records(sheet["docid"], sheet["sheet_id"])
        # 按 VIN 索引
        vin_to_followup = {}
        statuses = []
        for rec in records:
            values = rec.get("values", {}) or {}
            vin = _read_text(values.get("车架号"))
            if not vin:
                continue
            status = _read_select(values.get("跟进状态"))
            note = _read_text(values.get("跟进备注"))
            name = _read_text(values.get("姓名"))
            vin_to_followup[vin] = {"跟进状态": status, "跟进备注": note, "姓名": name}
            statuses.append(status)
        salesman_followup[salesman] = vin_to_followup
        fillin_rate_by_salesman[salesman] = fs.calc_fillin_rate(statuses)
        log("info", f"[refresh] {salesman}: {len(vin_to_followup)} 行，填报率 {fillin_rate_by_salesman[salesman]}%")

    # 重新聚合 KPI（基于最新 SQL + 最新填报率）
    groups = group_by_salesman(rows)
    kpi_rows: list[dict[str, Any]] = []
    for salesman, salesman_rows in groups:
        url = sheets_state.get(salesman, {}).get("url", "")
        kpi = aggregate_kpi(salesman, salesman_rows, doc_url=url,
                            fillin_rate_pct=fillin_rate_by_salesman.get(salesman, 0.0))
        kpi_rows.append(kpi)
    kpi_rows.append(aggregate_total(kpi_rows))

    # 更新 Doc A KPI 子表
    update_payload = []
    for kpi in kpi_rows:
        rid = doc_a["kpi_records"].get(kpi["salesman_name"])
        if not rid:
            log("warn", f"[refresh] KPI 行 {kpi['salesman_name']} 缺 record_id，跳过")
            continue
        update_payload.append({
            "record_id": rid,
            "values": fs.build_record_values(kpi, fs.KPI_FIELDS),
        })
    if update_payload:
        for batch in _chunked(update_payload, 200):
            cli.update_records(doc_a["docid"], doc_a["kpi_sheet_id"], batch)
            time.sleep(0.2)
        log("info", f"[refresh] KPI 子表已刷新 {len(update_payload)} 行")

    # 更新 Doc A 各业务员子表的"姓名/跟进状态/跟进备注"（按 VIN，分子表逐个回拉）
    # 仅在业务员"实际填了内容"时才回写：避免对一片"默认值"行做无意义的网络更新
    salesman_sheets = doc_a.get("salesman_sheets", {})
    total_pushed = 0
    for salesman, vin_map in salesman_followup.items():
        sm_sheet = salesman_sheets.get(salesman, {})
        sm_sheet_id = sm_sheet.get("sheet_id")
        sm_records = sm_sheet.get("records", {})
        if not sm_sheet_id:
            log("warn", f"[refresh] {salesman} 在 Doc A 中无对应子表，跳过")
            continue
        sm_update = []
        for vin, followup in vin_map.items():
            rid = sm_records.get(vin)
            if not rid:
                continue
            values: dict[str, Any] = {}
            if followup["姓名"].strip():
                values["姓名"] = fs.render_force_text(followup["姓名"])
            if fs.is_filled(followup["跟进状态"]):
                values["跟进状态"] = fs.render_single_select(followup["跟进状态"])
            if followup["跟进备注"].strip():
                values["跟进备注"] = fs.render_force_text(followup["跟进备注"])
            if values:
                sm_update.append({"record_id": rid, "values": values})
        if sm_update:
            for batch in _chunked(sm_update, 200):
                cli.update_records(doc_a["docid"], sm_sheet_id, batch)
                time.sleep(0.2)
            log("info", f"[refresh] {salesman} 子表回拉跟进字段 {len(sm_update)} 行")
            total_pushed += len(sm_update)
    log("info", f"[refresh] 业务员子表共回拉 {total_pushed} 行")


def _read_text(cell: Any) -> str:
    """从 wecom-cli get_records 返回的 cell 解析为纯字符串。"""
    if cell is None:
        return ""
    if isinstance(cell, str):
        return cell
    if isinstance(cell, list) and cell:
        first = cell[0]
        if isinstance(first, dict):
            return str(first.get("text") or first.get("link") or "")
    if isinstance(cell, dict):
        return str(cell.get("text") or "")
    return str(cell)


def _read_select(cell: Any) -> str:
    """从 wecom-cli get_records 返回的单选 cell 解析为选项文本。"""
    if cell is None:
        return ""
    if isinstance(cell, list) and cell:
        first = cell[0]
        if isinstance(first, dict):
            return str(first.get("text") or "")
    if isinstance(cell, str):
        return cell
    return ""


# ===========================================================================
# 输出双产物
# ===========================================================================
def write_outputs(
    state: dict[str, Any],
    kpi_rows: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    coverage: dict[str, Any],
    output_dir: Path,
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    distribute_path = output_dir / "leshan_renewal_distribute.md"
    messages_path = output_dir / "leshan_renewal_messages.md"

    doc_a = state.get("doc_a", {})
    sheets = state.get("sheets", {})
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ---- 分发清单 ----
    lines: list[str] = []
    lines.append("# 乐山 5-6 月续保追踪 — 分发指引")
    lines.append("")
    lines.append(f"生成时间：{timestamp}")
    lines.append(f"应续保单总数：{coverage.get('total_rows', 0)}（保费 > 300 商业险，乐山三级机构，5-6 月到期）")
    lines.append(f"覆盖业务员：{coverage.get('covered_salesmen', 0)} 人")
    lines.append("")
    lines.append("## 1️⃣ 主管汇总文档（请加入主管 + 总经理）")
    lines.append(f"- 文档名：{('[SMOKE]' if state.get('smoke') else '')}乐山5-6月续保追踪-主管汇总")
    lines.append(f"- 链接：{doc_a.get('url', '<待生成>')}")
    lines.append("")
    lines.append("## 2️⃣ 业务员独立工作台")
    lines.append("")
    lines.append("| # | 业务员 | 团队 | 客户数 | 文档链接 |")
    lines.append("|---|-------|------|-------|---------|")
    for idx, kpi in enumerate(kpi_rows, 1):
        if kpi["salesman_name"] == "合计":
            continue
        sheet = sheets.get(kpi["salesman_name"], {})
        lines.append(
            f"| {idx} | {kpi['salesman_name']} | {kpi['team_name']} | {kpi['due_count']} | "
            f"{sheet.get('url', '<未建/失败>')} |"
        )
    lines.append("")
    lines.append("## ⚠️ 防泄密 · 人工授权验收（每行逐项打勾，全部完成才能宣称权限隔离）")
    lines.append("")
    lines.append("| 业务员 | ☐ 关闭链接泛访问 | ☐ 仅授权本人编辑 | ☐ 未授权其他业务员 | ☐ 未给本业务员授权主管汇总 |")
    lines.append("|-------|---------------|----------------|------------------|------------------------|")
    for kpi in kpi_rows:
        if kpi["salesman_name"] == "合计":
            continue
        lines.append(f"| {kpi['salesman_name']} | ☐ | ☐ | ☐ | ☐ |")
    lines.append("")
    lines.append("## 授权步骤")
    lines.append('企微 → 文档 → 右上角"分享" → **关闭"链接获取者可阅读"** → 添加业务员姓名 → 设"可编辑" → 确定。')
    lines.append("")
    if failures:
        lines.append("## 失败列表")
        for fail in failures:
            lines.append(f"- {fail.get('salesman', '?')}: {fail.get('error', '?')}")
    lines.append("")
    lines.append("> ⚠️ **脚本完成 ≠ 权限已隔离**。本清单只声明文档已按隔离结构生成，权限授权必须主管按上方勾选项逐项验收。")
    distribute_path.write_text("\n".join(lines), encoding="utf-8")

    # ---- 业务员消息模板 ----
    msg_lines: list[str] = []
    msg_lines.append("# 乐山 5-6 月续保任务 — 业务员消息模板")
    msg_lines.append("")
    msg_lines.append("> 主管复制粘贴每段到企微聊天发给对应业务员。脚本不能自动推送（企业禁用 wecom-cli msg 接口）。")
    msg_lines.append("")
    for kpi in kpi_rows:
        if kpi["salesman_name"] == "合计":
            continue
        sheet = sheets.get(kpi["salesman_name"], {})
        url = sheet.get("url", "<未建/失败>")
        premium_wan = round(kpi["due_premium"] / 10000, 2)
        msg_lines.append(f"## → 发给：{kpi['salesman_name']}")
        msg_lines.append("")
        msg_lines.append(
            f"【乐山续保任务】{kpi['salesman_name']}好，2026 年 5-6 月你名下应续 {kpi['due_count']} "
            f"户商业险（上年保费合计约 {premium_wan} 万元），请逐户跟进。"
        )
        msg_lines.append("")
        msg_lines.append(f"📋 你的工作台：{url}")
        msg_lines.append("")
        msg_lines.append("操作要点：")
        msg_lines.append('1. 打开链接 → 找到"跟进状态"列 → 每联系一户就改对应状态（已联系/已报价/已续保/拒保/失联）')
        msg_lines.append('2. "跟进备注"列可写联系结果、客户特殊要求等')
        msg_lines.append('3. "姓名"列请补充车主姓名')
        msg_lines.append("4. 已报价、已续回字段会自动同步，不需手填")
        msg_lines.append("5. 完成度（跟进率）每天统计到主管看板")
        msg_lines.append("")
        msg_lines.append("如有数据错漏请联系运维。")
        msg_lines.append("")
        msg_lines.append("---")
        msg_lines.append("")
    messages_path.write_text("\n".join(msg_lines), encoding="utf-8")
    return distribute_path, messages_path


# ===========================================================================
# 工具
# ===========================================================================
def _chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i: i + size] for i in range(0, len(items), size)]


def make_logger(records: list[dict[str, Any]]):
    def log(level: str, msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] [{level.upper()}] {msg}"
        print(line, file=sys.stderr if level in ("warn", "error") else sys.stdout, flush=True)
        records.append({"ts": datetime.now().isoformat(timespec="seconds"), "level": level, "msg": msg})
    return log


# ===========================================================================
# Dry-run 校验：打印同口径 DuckDB SQL
# ===========================================================================
DRYRUN_VALIDATION_SQL_TEMPLATE = """
WITH policy_agg AS (
  SELECT policy_no, vehicle_frame_no,
         SUM(premium) AS premium,
         MAX(CAST(insurance_end_date AS DATE)) AS insurance_end_date,
         ANY_VALUE(salesman_name) AS salesman_name
  FROM read_parquet('{policy_glob}', union_by_name=true)
  WHERE insurance_type='商业保险'
    AND vehicle_frame_no IS NOT NULL AND vehicle_frame_no != ''
    AND org_level_3='{org}'
    AND CAST(insurance_end_date AS DATE) BETWEEN '{start}' AND '{end}'
  GROUP BY policy_no, vehicle_frame_no
  HAVING SUM(premium) > 300
),
base AS (
  SELECT * EXCLUDE rn FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY vehicle_frame_no
      ORDER BY insurance_end_date DESC NULLS LAST, policy_no DESC) rn
    FROM policy_agg
  ) WHERE rn = 1
)
SELECT salesman_name, COUNT(*) AS rows, ROUND(SUM(premium), 2) AS total_premium
FROM base GROUP BY 1 ORDER BY 2 DESC;
""".strip()


# ===========================================================================
# 主入口
# ===========================================================================
def main() -> int:
    parser = argparse.ArgumentParser(description="乐山按业务员独立文档 + 主管汇总 续保追踪建表器")
    parser.add_argument("--org", default="乐山", help="三级机构名（默认 乐山）")
    parser.add_argument("--start", default="2026-05-01", help="到期日起（含）")
    parser.add_argument("--end", default="2026-06-30", help="到期日止（含）")
    parser.add_argument("--mode", choices=["build", "refresh"], default="build")
    parser.add_argument("--state-suffix", default="", help="state 文件后缀，smoke 模式必传 smoke")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不调 wecom-cli")
    parser.add_argument("--limit-salesman", type=int, default=0, help="仅处理前 N 个业务员（smoke 用）")
    parser.add_argument("--rescue-records", action="store_true",
                        help="对 state.records 缺失但企微侧应有数据的业务员，先调 get_records 拉回 record_id")
    args = parser.parse_args()

    smoke = args.state_suffix == "smoke"
    if args.limit_salesman and not smoke:
        print("ERROR: --limit-salesman 必须与 --state-suffix smoke 配合，避免污染正式 state", file=sys.stderr)
        return 2

    log_records: list[dict[str, Any]] = []
    log = make_logger(log_records)

    # SQL
    log("info", f"拉取应续清单: org={args.org} window={args.start}~{args.end}")
    rows = fetch_rows(args.org, args.start, args.end)
    groups = group_by_salesman(rows)
    if args.limit_salesman:
        groups = groups[: args.limit_salesman]
    coverage = {
        "total_rows": len(rows),
        "covered_salesmen": len(groups),
        "groups_summary": [(s, len(g)) for s, g in groups],
    }
    log("info",
        f"应续 {len(rows)} 行，覆盖 {len(groups)} 名业务员（top: " +
        ", ".join(f"{s}({len(g)})" for s, g in groups[:5]) + "...)")

    # KPI 预聚合（不含 fillin，build 阶段无业务员填报）
    kpi_rows = [aggregate_kpi(s, g, fillin_rate_pct=0.0) for s, g in groups]
    if kpi_rows:
        kpi_rows.append(aggregate_total(kpi_rows))

    # ---- DRY-RUN 分支 ----
    if args.dry_run:
        log("info", "=" * 60)
        log("info", "DRY-RUN 同口径校验 SQL（与 build_source_rows() CTE 等价）：")
        validation_sql = DRYRUN_VALIDATION_SQL_TEMPLATE.format(
            policy_glob="数据管理/warehouse/fact/policy/current/*.parquet",
            org=args.org, start=args.start, end=args.end,
        )
        print()
        print(validation_sql)
        print()
        log("info", "=" * 60)
        log("info", f"业务员分组（脚本聚合视图，请与上方 SQL 输出严格对账）：")
        print()
        print(f"{'业务员':<12}{'团队':<10}{'应续件数':>8}{'上年保费':>12}{'已报价':>6}{'已续回':>6}{'报价率':>7}{'续保率':>7}")
        for kpi in kpi_rows:
            print(
                f"{kpi['salesman_name']:<12}{kpi['team_name']:<10}{kpi['due_count']:>8}"
                f"{kpi['due_premium']:>12.2f}{kpi['quoted_count']:>6}{kpi['renewed_count']:>6}"
                f"{kpi['quoted_rate_pct']:>6.1f}%{kpi['renewed_rate_pct']:>6.1f}%"
            )
        # 写日志
        log_dir = HERE / "logs"
        log_dir.mkdir(exist_ok=True)
        log_path = log_dir / f"leshan_renewal_dryrun_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        log_path.write_text(json.dumps({
            "args": vars(args), "coverage": coverage,
            "kpi_rows": kpi_rows, "validation_sql": validation_sql,
            "log": log_records,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        log("info", f"日志: {log_path}")
        return 0

    # ---- preflight ----
    cli = WeComCli(dry_run=False, log=log)
    info = preflight(log)
    log_records.append({"preflight": info})

    # ---- state ----
    sp = state_path(args.state_suffix)
    state = load_state(sp)
    state["smoke"] = smoke
    state["window"] = {"org": args.org, "start": args.start, "end": args.end}

    failures: list[dict[str, Any]] = []

    if args.mode == "build":
        # 0) Rescue：对 add_records 超时但企微实际写入的业务员，先反查 record_id 到 state
        if args.rescue_records:
            expected = {salesman: len(rs) for salesman, rs in groups}
            try:
                rescue_records_from_doc_b(cli, state, sp, expected, log)
            except Exception as exc:  # noqa: BLE001
                log("error", f"rescue 失败：{exc}")
                return 5

        # 1) 建 Doc A 空架子（仅 KPI 子表）
        try:
            build_doc_a(cli, state, smoke, log)
            save_state(sp, state)
        except Exception as exc:  # noqa: BLE001
            log("error", f"Doc A 建立失败：{exc}")
            return 3

        # 2) 循环每业务员：先建 Doc B（业务员侧）→ 再建 Doc A 业务员子表（主管侧镜像）
        for salesman, salesman_rows in groups:
            try:
                build_doc_b(cli, state, salesman, salesman_rows, smoke, sp, log)
                build_doc_a_salesman_sheet(cli, state, salesman, salesman_rows, sp, log)
            except Exception as exc:  # noqa: BLE001
                log("warn", f"业务员 {salesman} 失败：{exc}")
                failures.append({"salesman": salesman, "error": str(exc)})
                save_state(sp, state)

        # 3) 回填 Doc A KPI（业务员子表已在 step 2 完成）
        kpi_rows = []
        for salesman, salesman_rows in groups:
            url = state["sheets"].get(salesman, {}).get("url", "")
            kpi_rows.append(aggregate_kpi(salesman, salesman_rows, doc_url=url, fillin_rate_pct=0.0))
        if kpi_rows:
            kpi_rows.append(aggregate_total(kpi_rows))
        try:
            backfill_doc_a(cli, state, kpi_rows, sp, log)
            save_state(sp, state)
        except Exception as exc:  # noqa: BLE001
            log("error", f"Doc A KPI 回填失败：{exc}")
            failures.append({"salesman": "<doc_a_kpi_backfill>", "error": str(exc)})

    elif args.mode == "refresh":
        try:
            refresh_kpi_and_followup(cli, state, rows, log)
            save_state(sp, state)
        except Exception as exc:  # noqa: BLE001
            log("error", f"refresh 失败：{exc}")
            return 4

    # ---- 输出双产物 ----
    output_dir = HERE / "outputs"
    distribute_path, messages_path = write_outputs(state, kpi_rows, failures, coverage, output_dir)
    log("info", f"分发清单: {distribute_path}")
    log("info", f"消息模板: {messages_path}")

    # ---- 写日志 ----
    log_dir = HERE / "logs"
    log_dir.mkdir(exist_ok=True)
    log_name = f"leshan_renewal_{args.mode}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    log_path = log_dir / log_name
    log_path.write_text(json.dumps({
        "args": vars(args), "coverage": coverage,
        "preflight": info, "failures": failures,
        "kpi_rows": kpi_rows, "log": log_records,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    log("info", f"日志: {log_path}")

    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
