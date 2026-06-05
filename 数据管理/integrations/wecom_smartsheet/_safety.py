"""Wecom 智能表行级重复风险闸 + 共享 wecom-cli 调用器。

设计目标
--------
2026-06-03 事故根因：state.records 跑前为空 → sync 走 add 路径 → 与企微表既存
数据形成行级重复（合计 28,899 行）。详见 [[project_wecom_org_renewal_first_real_run_dup]]。

本模块提供三类共享组件：

A. 行级重复风险闸（被 sync_org_renewal_from_xlsx / sync_filtered_policies /
   sync_may_renewal_fields 三个写入脚本共用）
   1. `print_preflight_banner` — 写入前打印对比表（state 预期 vs source 现状 vs 计划写入）
   2. `evaluate_gate` — 判断是否触发危险信号（state 空 / to_add 占比过高 / 全 add 无 update）
   3. `--i-checked-wecom-rows` 显式覆盖开关（用户去企微表点查行数后才能加）

B. wecom-cli 安全调用器（被 cleanup_org_renewal_dup / prime_state_from_wecom /
   rebuild_state_from_distribute 三个一次性运维脚本共用）
   1. `cli_call` — 唯一入口，覆盖：超时 / 非 0 退出码 / 空输出 / JSON parse / MCP envelope 解包 / 业务 errcode
   2. `WecomCliError` — 上述任一失败时抛出，调用方按异常处理
   动因：codex PR #485 第二轮 P1 — `wecom-cli` 进程 returncode=0 但响应里
   errcode 非 0（如 851014 文档权限过期、40058 webhook 不支持的操作）时，
   旧版 cli_call 只看 returncode → 静默把错误响应当成功响应，造成 cleanup
   误清 state / prime 用空 vin_index 覆盖 state.records。本入口与
   create_renewal_tracker.WeComCli._invoke / sync_may_renewal_fields
   .normalize_wecom_response 同等校验水准。

C. wecom-cli get_records cell 文本提取（被所有读 cell 的脚本共用）
   `read_cell_text` — 把 wecom-cli 返回的 cell（str / 数值 / dict / list-of-dict /
   None / 其它）统一解析为纯文本。合并历史两套并行实现：
     - create_renewal_tracker._read_text（join_list=False：list 取首元素）
     - sync_may_renewal_fields.extract_text（join_list=True：list 拼接全部，分隔符 ""）
   动因：两套实现长期并行漂移（dict 是否兜底 value、str 是否 strip、list 取首/拼接
   语义都不一致），新脚本极易复制错版本。收敛到此 SSOT 后只有一处真相。

为什么不靠 wecom-cli 直接 GET 企微表行数？
- 应用 API 受 errcode 851014 (authorization expired) 阻塞，无法绕开（详见
  [[project_wecom_org_renewal_xindu_dazhou_broken]]）
- webhook 通道只支持 add/update，不支持 read / delete（实测 errcode 40058）
- 唯一可靠的"企微当前行数"信息来源：人工去企微表点查 → 加 --i-checked-wecom-rows
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from typing import Any, Literal

# to_add / source_rows 超过此比例视为高风险（疑似重复写入）
DANGER_ADD_RATIO = 0.30

Verdict = Literal["ok", "danger_empty_state", "danger_high_add_ratio", "danger_all_add_no_update"]


@dataclass(frozen=True)
class GateResult:
    ok: bool
    verdict: Verdict
    message: str


def evaluate_gate(*, state_count: int, source_rows: int, to_add: int, to_update: int) -> GateResult:
    """根据三项指标判断是否放行 --execute。

    返回 ok=True 表示安全可写；ok=False 表示触发危险信号，需用户显式 --i-checked-wecom-rows
    覆盖（先去企微表点查行数确认无误）。

    判断顺序（短路）：
    1. state 空 + 想写入 → 一定危险（除非首次建表，但首次必须人工确认企微表为空）
    2. to_add == source_rows 且 to_update == 0 → 危险（疑似首次/重复）
    3. to_add / source_rows > 30% → 危险（state 显著失真）
    4. 其他 → 安全
    """
    if source_rows == 0:
        return GateResult(True, "ok", "源数据为 0，无写入操作")

    if state_count == 0 and to_add > 0:
        return GateResult(
            False,
            "danger_empty_state",
            f"state.records 为 0 但 to_add={to_add}：无法判断企微表是否已有数据，存在重复风险。",
        )

    if to_add == source_rows and to_update == 0:
        return GateResult(
            False,
            "danger_all_add_no_update",
            f"to_add={to_add} == source_rows，to_update=0：疑似首次建表或 state 完全失真，存在重复风险。",
        )

    ratio = to_add / source_rows
    if ratio > DANGER_ADD_RATIO:
        return GateResult(
            False,
            "danger_high_add_ratio",
            f"to_add={to_add} / source_rows={source_rows} = {ratio:.0%} > {DANGER_ADD_RATIO:.0%}：state 部分失真，存在重复风险。",
        )

    return GateResult(True, "ok", f"to_add={to_add}/{source_rows} ({ratio:.0%})，state 状态健康")


def print_preflight_banner(
    label: str,
    *,
    state_count: int,
    source_rows: int,
    to_add: int,
    to_update: int,
    gate: GateResult | None = None,
) -> GateResult:
    """打印对比表 + 合理性判断；返回 gate 结果。如果调用方已算好 gate，可传入复用。"""
    if gate is None:
        gate = evaluate_gate(
            state_count=state_count, source_rows=source_rows, to_add=to_add, to_update=to_update
        )
    icon = "✓" if gate.ok else "✗"
    print(f"  ┌─── preflight: {label} ───")
    print(f"  │ state.records_count : {state_count:>8}  ← 脚本预期企微表当前行数")
    print(f"  │ source_rows         : {source_rows:>8}  ← 本次源数据行数")
    print(f"  │ to_add              : {to_add:>8}  ← 将新增（写入企微表）")
    print(f"  │ to_update           : {to_update:>8}  ← 将更新（按 record_id 改既有行）")
    print(f"  │ 合理性              : {icon} {gate.message}")
    print(f"  └────────────────────────────────────────────")
    return gate


def must_check_wecom_rows_hint(label: str, state_count: int) -> str:
    """触发危险信号时的固定指引，由调用方拼到错误消息里。"""
    return (
        f"\n[{label}] 行级重复风险闸触发，--execute 拒绝执行。\n"
        f"\n请去企微表点查当前行数：\n"
        f"  - 当前行数 ≈ {state_count}（脚本预期值）→ state 准确，可加 --i-checked-wecom-rows 放行\n"
        f"  - 当前行数 ≈ 0（企微表为空）→ 首次建表/已被人工清空，可加 --i-checked-wecom-rows 放行\n"
        f"  - 当前行数显著大于以上两种 → **禁止 --execute**，会产生行级重复；\n"
        f"    必须先人工清表（去企微 UI 删除所有行），再加 --i-checked-wecom-rows 放行\n"
        f"\n参考：[[project_wecom_org_renewal_first_real_run_dup]] [[feedback_wecom_no_row_duplication]]"
    )


# ============================================================================
# B. wecom-cli 安全调用器（SSOT）
# ============================================================================
class WecomCliError(RuntimeError):
    """wecom-cli 调用失败 — 超时 / 非 0 退出 / 空输出 / JSON 解析失败 / 业务 errcode 非 0。"""


def _unwrap_mcp_envelope(envelope: Any) -> Any:
    """wecom-cli 0.1.8 MCP JSON-RPC 风格：业务对象嵌在 result.content[0].text 里（JSON 字符串）。
    若非 MCP 包装则原样返回。
    """
    if not isinstance(envelope, dict):
        return envelope
    if "jsonrpc" not in envelope and "result" not in envelope:
        return envelope
    if envelope.get("error"):
        raise WecomCliError(f"MCP RPC error: {envelope['error']}")
    result = envelope.get("result")
    if not isinstance(result, dict):
        return envelope
    if result.get("isError"):
        raise WecomCliError(f"MCP RPC isError: {result}")
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
        return first


def cli_call(
    group: str,
    command: str,
    payload: dict[str, Any],
    *,
    timeout: int = 120,
) -> dict[str, Any]:
    """共享 wecom-cli 调用器（SSOT）。

    覆盖六类失败模式，任一触发即抛 WecomCliError：
      1. 超时（subprocess.TimeoutExpired）
      2. 非 0 退出码
      3. stdout 为空
      4. stdout 非 JSON
      5. MCP envelope 的 isError / error
      6. 业务 errcode 非 0（如 851014 文档权限过期、40058 webhook 不支持）

    成功则返回**已解包**的业务对象（dict）。

    本入口设立动因：codex PR #485 第二轮 P1 — 旧的 cli_call 复制版只看
    returncode，static 把 errcode 非 0 响应当成功响应；cleanup 误清 state、
    prime 用空 vin_index 覆盖 state.records 等都是其后果。
    """
    cmd = ["wecom-cli", group, command, "--json", json.dumps(payload, ensure_ascii=False)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise WecomCliError(f"{group} {command} 调用超时（{timeout}s）") from exc

    if proc.returncode != 0:
        raise WecomCliError(
            f"{group} {command} 退出码 {proc.returncode}: stderr={proc.stderr.strip()[:500]}"
        )
    if not proc.stdout.strip():
        raise WecomCliError(
            f"{group} {command} 输出为空（stderr: {proc.stderr.strip()[:300]}）"
        )
    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise WecomCliError(
            f"{group} {command} 输出非 JSON: {proc.stdout.strip()[:300]}"
        ) from exc

    data = _unwrap_mcp_envelope(envelope)
    if isinstance(data, dict) and data.get("errcode") not in (None, 0):
        raise WecomCliError(
            f"{group} {command} errcode={data.get('errcode')} errmsg={data.get('errmsg')}"
        )
    return data if isinstance(data, dict) else {"_raw": data}


# ============================================================================
# C. wecom-cli get_records cell 文本提取（SSOT）
# ============================================================================
def _cell_scalar_text(value: Any) -> str:
    """非 list 形态 → 原始文本（**不** strip，strip 由 read_cell_text 按模式决定）。

    dict 取值优先级统一为 text → value → link：
      - text：普通文本/单选 cell 的标准字段
      - value：部分接口形态（extract_text 历史支持）
      - link：超链接 cell（_read_text list 分支历史支持）
    三者均为安全兜底——仅在前者为空时生效，不会改变原本非空的返回。
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("text") or value.get("value") or value.get("link") or "")
    # int / float / bool / 其它
    return str(value)


def read_cell_text(cell: Any, *, join_list: bool = False) -> str:
    """统一企微 smartsheet cell → 文本提取（SSOT）。

    支持形态：str / int / float / bool / dict / list / None / 其它。

    Args:
        cell: wecom-cli get_records 返回的 cell（形态见上）。
        join_list: 控制 **list** 形态的处理与是否 strip，分别复刻历史两套实现：
            False（默认）→ list 仅取**首个**元素；str / 数值 / dict 结果**不 strip**。
                向后兼容 create_renewal_tracker._read_text（VIN/姓名/备注等单值字段）。
            True → list **拼接所有**元素（分隔符 ``""``，每段先 strip）；标量结果也 strip。
                向后兼容 sync_may_renewal_fields.extract_text。

    ⚠️ join_list=True 的 list 分隔符是空串 ``""``（``"".join``），多元素结果形如
       ``"ab"`` 而非 ``"a,b"``——这是 extract_text 的既有语义，禁止改成逗号，
       否则破坏 sync_may_renewal_fields 的写入行为。
    """
    if isinstance(cell, list):
        if not join_list:
            if not cell:
                return ""
            first = cell[0]
            # 防御：首元素仍是 list 时递归（真实调用方不会命中）
            return read_cell_text(first) if isinstance(first, list) else _cell_scalar_text(first)
        # join_list=True：拼接全部元素，每段 strip 后以空串连接
        return "".join(
            read_cell_text(item, join_list=True)
            if isinstance(item, list)
            else _cell_scalar_text(item).strip()
            for item in cell
        ).strip()

    text = _cell_scalar_text(cell)
    return text.strip() if join_list else text
