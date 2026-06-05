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

import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { opsEnv } from '../config/env.js';
import { getDataDir } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

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
const AUDIT_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;
const MAX_AUDIT_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATS_TIMESTAMP_PROBE_BYTES = 64 * 1024;
const logger = createLogger('WorkflowAuditLog');

/**
 * Workflow audit JSONL 根目录。
 *
 * 默认 server/data/runtime/audit-log/。可用 AUDIT_LOG_DIR 环境变量覆盖——**惰性直读
 * process.env**（不走 opsEnv 的加载时快照），使并行测试文件能在运行时各自指向独立临时
 * 目录，避免跨文件在同一日期 jsonl 上读/写/删（_resetAuditLogForDate / fs.rm / GC）
 * 产生竞态（读路径 readAuditEventsForRun 偶发返回 []）。生产环境不设此变量时行为不变。
 */
export function getAuditDir(): string {
  const override = process.env.AUDIT_LOG_DIR;
  if (typeof override === 'string' && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.resolve(getDataDir(), RUNTIME_SUBDIR);
}

function resolveAuditFilePath(date: string, seq?: number): string | null {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return null;
  if (seq !== undefined && (!Number.isInteger(seq) || seq < 1)) return null;
  const dir = getAuditDir();
  const suffix = seq === undefined ? '' : `.${seq}`;
  const candidate = path.resolve(dir, `${date}${suffix}.jsonl`);
  const rel = path.relative(dir, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

function todayUtcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function parseAuditFileName(name: string): { date: string; seq?: number } | null {
  const match = name.match(AUDIT_FILE_PATTERN);
  if (!match) return null;
  const seq = match[2] ? Number(match[2]) : undefined;
  if (seq !== undefined && (!Number.isInteger(seq) || seq < 1)) return null;
  return { date: match[1], seq };
}

async function selectWritableAuditFilePath(date: string, nextLineBytes: number): Promise<string | null> {
  await fs.mkdir(getAuditDir(), { recursive: true });
  for (let seq: number | undefined = undefined; ; seq = seq === undefined ? 1 : seq + 1) {
    const candidate = resolveAuditFilePath(date, seq);
    if (!candidate) return null;
    try {
      const stat = await fs.stat(candidate);
      if (stat.size + nextLineBytes <= MAX_AUDIT_FILE_BYTES) {
        return candidate;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw err;
    }
  }
}

function getRetentionDays(): number {
  const value = opsEnv.AUDIT_LOG_RETENTION_DAYS;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RETENTION_DAYS;
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

    const record: AuditEvent = { ...event, timestamp };
    const line = JSON.stringify(record) + '\n';
    const filePath = await selectWritableAuditFilePath(date, Buffer.byteLength(line, 'utf8'));
    if (!filePath) return;

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
    const parsed = parseAuditFileName(f);
    if (!parsed) continue;
    const fullPath = resolveAuditFilePath(parsed.date, parsed.seq);
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

export interface AuditLogGcResult {
  retentionDays: number;
  candidateFiles: string[];
  deletedFiles: string[];
  dryRun: boolean;
}

export async function garbageCollectAuditLogs(options: { dryRun?: boolean } = {}): Promise<AuditLogGcResult> {
  const dir = getAuditDir();
  const retentionDays = getRetentionDays();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { retentionDays, candidateFiles: [], deletedFiles: [], dryRun: !!options.dryRun };
    }
    throw err;
  }

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const candidateFiles = files
    .map((name) => ({ name, parsed: parseAuditFileName(name) }))
    .filter((item): item is { name: string; parsed: { date: string; seq?: number } } => !!item.parsed)
    .filter((item) => new Date(`${item.parsed.date}T00:00:00.000Z`).getTime() < cutoffMs)
    .map((item) => resolveAuditFilePath(item.parsed.date, item.parsed.seq))
    .filter((filePath): filePath is string => !!filePath)
    .sort();

  logger.info('[audit-log] GC dry-run candidates', {
    retentionDays,
    count: candidateFiles.length,
    files: candidateFiles,
  });

  if (options.dryRun) {
    return { retentionDays, candidateFiles, deletedFiles: [], dryRun: true };
  }

  const deletedFiles: string[] = [];
  for (const filePath of candidateFiles) {
    try {
      await fs.unlink(filePath);
      deletedFiles.push(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[audit-log] GC delete failed', { filePath, error: (err as Error).message });
      }
    }
  }
  logger.info('[audit-log] GC deleted files', { count: deletedFiles.length, files: deletedFiles });
  return { retentionDays, candidateFiles, deletedFiles, dryRun: false };
}

export async function runAuditLogGcCycle(): Promise<AuditLogGcResult> {
  const dryRun = await garbageCollectAuditLogs({ dryRun: true });
  if (dryRun.candidateFiles.length === 0) {
    return dryRun;
  }
  return garbageCollectAuditLogs({ dryRun: false });
}

export function startAuditLogMaintenance(options: { intervalMs?: number } = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_GC_INTERVAL_MS;
  let inFlight = false;

  const run = () => {
    if (inFlight) return;
    inFlight = true;
    runAuditLogGcCycle()
      .catch((err) => {
        logger.warn('[audit-log] GC cycle failed', { error: (err as Error).message });
      })
      .finally(() => {
        inFlight = false;
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export interface AuditLogStats {
  totalFileCount: number;
  totalBytes: number;
  earliestEventTime: string | null;
}

async function readFirstAuditTimestamp(filePath: string): Promise<string | null> {
  const stream = createReadStream(filePath, {
    encoding: 'utf8',
    start: 0,
    end: STATS_TIMESTAMP_PROBE_BYTES - 1,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as Partial<AuditEvent>;
        if (typeof obj.timestamp === 'string') {
          return obj.timestamp;
        }
      } catch {
        // 跳过损坏行，继续找首个有效事件时间
      }
    }
    return null;
  } finally {
    rl.close();
    stream.destroy();
  }
}

export async function getAuditLogStats(): Promise<AuditLogStats> {
  const dir = getAuditDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { totalFileCount: 0, totalBytes: 0, earliestEventTime: null };
    }
    throw err;
  }

  const auditFiles: Array<{ date: string; seq?: number; fullPath: string }> = [];
  for (const name of files) {
    const parsed = parseAuditFileName(name);
    if (!parsed) continue;
    const fullPath = resolveAuditFilePath(parsed.date, parsed.seq);
    if (!fullPath) continue;
    auditFiles.push({ date: parsed.date, seq: parsed.seq, fullPath });
  }
  auditFiles.sort((a, b) => a.date.localeCompare(b.date) || (a.seq ?? 0) - (b.seq ?? 0));

  let totalBytes = 0;
  let earliestEventTime: string | null = null;

  for (const file of auditFiles) {
    try {
      const stat = await fs.stat(file.fullPath);
      totalBytes += stat.size;
    } catch {
      // 跳过读不到的文件；totalFileCount 仍反映目录内 jsonl 文件数量
    }
  }

  for (const file of auditFiles) {
    try {
      const timestamp = await readFirstAuditTimestamp(file.fullPath);
      if (timestamp) {
        earliestEventTime = timestamp;
        break;
      }
    } catch {
      // 跳过损坏或读取失败的文件
    }
  }

  return { totalFileCount: auditFiles.length, totalBytes, earliestEventTime };
}

/** 仅供测试使用：清空指定日期的 audit 文件 */
export async function _resetAuditLogForDate(date: string = todayUtcDate()): Promise<void> {
  if (!DATE_PATTERN.test(date)) return;
  const dir = getAuditDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    files.map(async (name) => {
      const parsed = parseAuditFileName(name);
      if (!parsed || parsed.date !== date) return;
      const filePath = resolveAuditFilePath(parsed.date, parsed.seq);
      if (!filePath) return;
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    }),
  );
}

export const AUDIT_LOG_LIMITS = {
  maxFileBytes: MAX_AUDIT_FILE_BYTES,
  defaultRetentionDays: DEFAULT_RETENTION_DAYS,
  defaultGcIntervalMs: DEFAULT_GC_INTERVAL_MS,
} as const;
