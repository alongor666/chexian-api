"""一次性 state 重建脚本：从最新 build 日志 + wecom-cli 反查重建 state.sheets。

场景：state 文件意外丢失，企微侧 11 份 Doc B + 1 份 Doc A 实际存在，需要重建脚本侧的映射。
重建后 state.doc_a 留空 — 用户应在企微 UI 删除当前 Doc A，然后跑主脚本 build 模式即可
（业务员 Doc B 已完整 → 跳过；新流程会自动建新结构 Doc A：KPI + 11 业务员子表）。

执行：
    python3 rebuild_state_from_distribute.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import create_renewal_tracker as crt  # noqa: E402

LOGS_DIR = HERE / "logs"
STATE_PATH = HERE / "state" / "leshan_renewal.json"


DOCID_RE = re.compile(r"smartsheet/([A-Za-z0-9_]+)")


def cli_call(group: str, command: str, payload: dict[str, Any]) -> dict[str, Any]:
    """直接调 wecom-cli，支持 payload 含 url 替代 docid（schema 允许二选一）。"""
    cmd = ["wecom-cli", group, command, "--json", json.dumps(payload, ensure_ascii=False)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"{command} exit {proc.returncode}: {proc.stderr.strip()[:300]}")
    if not proc.stdout.strip():
        raise RuntimeError(f"{command} 输出为空: stderr={proc.stderr.strip()[:300]}")
    envelope = json.loads(proc.stdout)
    data = crt._unwrap_mcp_envelope(envelope)
    if isinstance(data, dict) and data.get("errcode") not in (None, 0):
        raise RuntimeError(f"{command} errcode={data.get('errcode')} errmsg={data.get('errmsg')}")
    return data


def find_latest_build_log() -> Path:
    """找最新的 build 日志（含 kpi_rows 含 doc_url 的）。"""
    candidates = sorted(LOGS_DIR.glob("leshan_renewal_build_*.json"), reverse=True)
    for p in candidates:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if data.get("kpi_rows") and data["kpi_rows"][0].get("doc_url"):
                return p
        except Exception:
            continue
    raise FileNotFoundError("找不到含 kpi_rows + doc_url 的 build 日志")


def parse_log(path: Path) -> list[dict[str, str]]:
    """从 build 日志解析业务员-docid 映射，返回 [{salesman, team, count, url, docid}]."""
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for kpi in data.get("kpi_rows", []):
        salesman = kpi.get("salesman_name", "")
        if not salesman or salesman == "合计":
            continue
        url = kpi.get("doc_url", "") or ""
        docid_m = DOCID_RE.search(url)
        if not docid_m:
            print(f"[skip] {salesman} 无法解析 docid: {url}", file=sys.stderr)
            continue
        rows.append({
            "salesman": salesman,
            "team": kpi.get("team_name", ""),
            "count": int(kpi.get("due_count", 0)),
            "url": url,
            "docid": docid_m.group(1),
        })
    return rows


def main() -> int:
    log_path = find_latest_build_log()
    print(f"使用 build 日志: {log_path}")

    rows = parse_log(log_path)
    if not rows:
        print("ERROR: 日志中未解析出业务员", file=sys.stderr)
        return 3
    print(f"解析到 {len(rows)} 名业务员")

    if STATE_PATH.exists():
        bak = STATE_PATH.with_suffix(f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        STATE_PATH.rename(bak)
        print(f"备份原 state: {bak}")

    state = crt.load_state(STATE_PATH)
    state["doc_a"] = {}  # 旧 Doc A 即将删除，留空让 build 重建
    state["sheets"] = {}

    for r in rows:
        salesman = r["salesman"]
        url = r["url"]
        print(f"\n[{salesman}] url={url[:80]}...")

        # 1) 拿 sheet_id（Doc B 默认只有 1 个子表"应续清单"）— 用 url 传参
        try:
            resp = cli_call("doc", "smartsheet_get_sheet", {"url": url})
        except Exception as exc:
            print(f"  [ERROR] get_sheets 失败: {exc}", file=sys.stderr)
            continue
        sheets = resp.get("sheet_list") or resp.get("sheets") or []
        if not sheets:
            print(f"  [WARN] get_sheets 返回空", file=sys.stderr)
            continue
        sheet_id = sheets[0].get("sheet_id") or sheets[0].get("id")
        # cli 返回的真实 docid（非 url path 中那段）
        true_docid = resp.get("docid") or sheets[0].get("docid")
        print(f"  sheet_id = {sheet_id}, true_docid = {true_docid}")

        # 2) 拿 records 按 VIN 索引
        try:
            resp = cli_call("doc", "smartsheet_get_records", {"url": url, "sheet_id": sheet_id})
        except Exception as exc:
            print(f"  [ERROR] get_records 失败: {exc}", file=sys.stderr)
            # 写入 state 但 records 为空，需要标记
            state["sheets"][salesman] = {
                "docid": true_docid or "<unknown>", "url": url, "sheet_id": sheet_id,
                "records": {}, "record_count": 0,
                "rebuild_error": str(exc),
                "rebuilt_at": datetime.now().isoformat(timespec="seconds"),
            }
            crt.save_state(STATE_PATH, state)
            continue
        records = resp.get("record_list") or resp.get("records") or []
        vin_to_rid: dict[str, str] = {}
        for rec in records:
            values = rec.get("values", {}) or {}
            vin = crt._read_text(values.get("车架号"))
            rid = rec.get("record_id") or rec.get("id")
            if vin and rid:
                vin_to_rid[vin] = rid
        match_pct = (len(vin_to_rid) / r["count"] * 100) if r["count"] else 0
        print(f"  records: {len(vin_to_rid)} VIN / 预期 {r['count']}（{match_pct:.0f}%）")
        if len(vin_to_rid) < r["count"]:
            print(f"  [WARN] {salesman} 拉回 record 数量不足，可能权限不够 (errcode=851008 类问题)", file=sys.stderr)

        state["sheets"][salesman] = {
            "docid": true_docid or "<unknown>",
            "url": url,
            "sheet_id": sheet_id,
            "records": vin_to_rid,
            "record_count": len(vin_to_rid),
            "rebuilt_at": datetime.now().isoformat(timespec="seconds"),
        }
        crt.save_state(STATE_PATH, state)

    print(f"\n✅ state 重建完成: {STATE_PATH}")
    print(f"   sheets: {len(state['sheets'])} 名业务员")
    print(f"   doc_a: {{}} （留空，待 UI 删除旧 Doc A 后跑主脚本重建）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
