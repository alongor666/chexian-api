/**
 * Workflow Audit Log — 阶段 4 PR-C
 *
 * Append-only JSON Lines 落盘，按日期分文件 server/data/runtime/audit-log/{yyyy-MM-dd}.jsonl
 *
 * 设计原则：
 * - **append-only**：每条事件用一行 JSON 追加；禁止修改/删除既有行
 * - **fire-and-forget**：appendAuditEvent 永远 resolve，错误吞掉以免阻塞 workflow 主流程
 * - **路径安全**：date 形如 YYYY-MM-DD（强校验），runId 形如 wr_*；用 path.resolve + 相对路径检测防穿越
 * - **6 类事件**：workflow-started / step-completed / approval-requested / approval-granted /
 *   approval-denied / workflow-completed
 * - **不输出 PII**：payload 仅含节点级简要（nodeId / skillId / status / 错误摘要）
 *
 * 读路径（GET /api/workflows/runs/:runId/audit）:
 *   readAuditEventsForRun 扫描所有 jsonl 文件 grep runId 行 → 返回时序数组
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../config/paths.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'workflow-started'
  | 'step-completed'
  | 'approval-requested'
  | 'approval-granted'
  | 'approval-denied'
  | 'workflow-completed';

export interface AuditEvent {
  /** ISO 8601 时间戳，由 audit-log 写入时填充（caller 不传） */
  timestamp: string;
  runId: string;
  workflowId: string;
  eventType: AuditEventType;
  userId: string;
  /** 业务角色 / approver 角色 */
  role: string;
  /** request-context 注入的 X-Request-Id */
  requestId: string;
  /** 节点级简要 — 由 caller 填充，禁止包含 PII / SQL / 原始数据 */
  payload: Record<string, unknown>;
}

export interface AuditEventInput extends Omit<AuditEvent, 'timestamp'> {
  /** 可选的显式时间戳（测试用），默认 new Date().toISOString() */
  timestamp?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Path helpers (path traversal hardened)
// ──────────────────────────────────────────────────────────────────────────

const RUNTIME_SUBDIR = 'runtime/audit-log';
/** wr_<14digits>_<workflowId 1-64 [a-z0-9-]>_<8 hex> — 与 workflow-runner 一致 */
const RUN_ID_PATTERN = /^wr_\d{14}_[a-z0-9-]{1,64}_[0-9a-f]{8}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getAuditDir(): string {
  return path.resolve(getDataDir(), RUNTIME_SUBDIR);
}

function resolveAuditFilePath(date: string): string | null {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return null;
  const dir = getAuditDir();
  const candidate = path.resolve(dir, `${date}.jsonl`);
  const rel = path.relative(dir, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

function todayUtcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ──────────────────────────────────────────────────────────────────────────
// Append (fire-and-forget)
// ──────────────────────────────────────────────────────────────────────────

/**
 * 追加一条审计事件。永远 resolve；任何错误吞掉（不阻塞 workflow）。
 *
 * 注意：writeFile + flag='a' 在 POSIX 上是原子追加（O_APPEND），多个进程并发写也不会
 * 交错单行。Node 实现保证 fs.appendFile 走 'a' flag。
 */
export async function appendAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    if (!RUN_ID_PATTERN.test(event.runId)) {
      // 静默丢弃非法 runId — 禁止任何方式写入异常路径
      return;
    }
    const timestamp = event.timestamp ?? new Date().toISOString();
    const date = timestamp.slice(0, 10);
    const filePath = resolveAuditFilePath(date);
    if (!filePath) return;

    const record: AuditEvent = { ...event, timestamp };
    const line = JSON.stringify(record) + '\n';

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, line, { encoding: 'utf8' });
  } catch {
    // fire-and-forget — 永远不抛
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────────────────────────────────

/**
 * 读取指定 runId 的所有审计事件，按 timestamp 升序返回。
 * 扫描 audit-log 目录下所有 *.jsonl 文件并 filter。
 */
export async function readAuditEventsForRun(runId: string): Promise<AuditEvent[]> {
  if (!RUN_ID_PATTERN.test(runId)) return [];
  const dir = getAuditDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const events: AuditEvent[] = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const date = f.slice(0, -'.jsonl'.length);
    const fullPath = resolveAuditFilePath(date);
    if (!fullPath) continue;
    let raw: string;
    try {
      raw = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as AuditEvent;
        if (obj && obj.runId === runId) {
          events.push(obj);
        }
      } catch {
        // 跳过损坏行
      }
    }
  }
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return events;
}

/** 仅供测试使用：清空指定日期的 audit 文件 */
export async function _resetAuditLogForDate(date: string = todayUtcDate()): Promise<void> {
  const filePath = resolveAuditFilePath(date);
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore
  }
}
