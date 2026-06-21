/**
 * audit-log rotation / GC / stats — PR-E
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  appendAuditEvent,
  getAuditDir,
  garbageCollectAuditLogs,
  getAuditLogStats,
  readAuditEventsForRun,
  runAuditLogGcCycle,
  _resetAuditLogForDate,
} from '../server/src/skills/audit-log.js';

const MAX_AUDIT_FILE_BYTES = 50 * 1024 * 1024;
const RUN_ID = 'wr_20260427000000_auto-risk-control-v1_aabbccdd';

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ── 审计目录隔离（防跨文件竞态）─────────────────────────────────────────────
// 本文件的 afterEach 会 fs.rm 整个 audit 目录；与其他并行测试共享默认目录时会清空它们
// 的当日数据。指定独立临时审计目录，把破坏性清理限制在隔离目录内。
const _prevAuditDir = process.env.AUDIT_LOG_DIR;
let _isolatedAuditDir = '';

beforeAll(async () => {
  _isolatedAuditDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chexian-audit-rotation-'));
  process.env.AUDIT_LOG_DIR = _isolatedAuditDir;
});

afterAll(async () => {
  if (_prevAuditDir === undefined) delete process.env.AUDIT_LOG_DIR;
  else process.env.AUDIT_LOG_DIR = _prevAuditDir;
  if (_isolatedAuditDir) await fs.rm(_isolatedAuditDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(getAuditDir(), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('audit-log rotation / GC / stats', () => {
  // 写 50MB+1 字节触发滚动 → 全量并发资源紧张时 I/O 耗时 ~7.9s（隔离跑仅 ~2.8s），
  // 超默认 5s testTimeout 致间歇 flaky（本文件已用独立 AUDIT_LOG_DIR 隔离，非跨文件
  // 竞态）。给 30s 容忍慢 I/O，不改任何判定逻辑。
  it('当单个 jsonl 超过 50MB 时滚动到 {date}.{seq}.jsonl，读取仍能跨文件命中 runId', async () => {
    const date = new Date().toISOString().slice(0, 10);
    await fs.mkdir(getAuditDir(), { recursive: true });
    await fs.writeFile(path.join(getAuditDir(), `${date}.jsonl`), Buffer.alloc(MAX_AUDIT_FILE_BYTES + 1, 10));

    await appendAuditEvent({
      runId: RUN_ID,
      workflowId: 'auto-risk-control-v1',
      eventType: 'workflow-started',
      userId: 'admin',
      role: 'branch_admin',
      requestId: 'req-rotation',
      payload: { nodeCount: 1 },
    });

    const rolled = path.join(getAuditDir(), `${date}.1.jsonl`);
    const rolledRaw = await fs.readFile(rolled, 'utf8');
    expect(rolledRaw).toContain(RUN_ID);

    const events = await readAuditEventsForRun(RUN_ID);
    expect(events.map((e) => e.eventType)).toContain('workflow-started');
  }, 30_000);

  it('GC 先 dry-run 记录待删清单；dry-run 不删除，正式执行才删除 90 天前 jsonl', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await fs.mkdir(getAuditDir(), { recursive: true });
    const oldDate = isoDaysAgo(91).slice(0, 10);
    const recentDate = isoDaysAgo(3).slice(0, 10);
    const oldFile = path.join(getAuditDir(), `${oldDate}.jsonl`);
    const recentFile = path.join(getAuditDir(), `${recentDate}.jsonl`);
    await fs.writeFile(oldFile, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n', 'utf8');
    await fs.writeFile(recentFile, '{"timestamp":"2026-04-26T00:00:00.000Z"}\n', 'utf8');

    const dryRun = await garbageCollectAuditLogs({ dryRun: true });
    expect(dryRun.deletedFiles).toEqual([]);
    expect(dryRun.candidateFiles.map((f) => path.basename(f))).toEqual([`${oldDate}.jsonl`]);
    expect(await fs.stat(oldFile)).toBeTruthy();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[audit-log] GC dry-run candidates'),
      expect.objectContaining({ count: 1 }),
    );

    const deleted = await garbageCollectAuditLogs({ dryRun: false });
    expect(deleted.deletedFiles.map((f) => path.basename(f))).toEqual([`${oldDate}.jsonl`]);
    await expect(fs.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.stat(recentFile)).toBeTruthy();
  });

  it('runAuditLogGcCycle 先执行 dry-run 再正式删除候选文件', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await fs.mkdir(getAuditDir(), { recursive: true });
    const oldDate = isoDaysAgo(91).slice(0, 10);
    const oldFile = path.join(getAuditDir(), `${oldDate}.jsonl`);
    await fs.writeFile(oldFile, '{"timestamp":"2026-01-01T00:00:00.000Z"}\n', 'utf8');

    const result = await runAuditLogGcCycle();

    expect(result.dryRun).toBe(false);
    expect(result.deletedFiles.map((f) => path.basename(f))).toEqual([`${oldDate}.jsonl`]);
    await expect(fs.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    const labels = infoSpy.mock.calls.map((call) => String(call[0]));
    const dryRunIndex = labels.findIndex((label) => label.includes('GC dry-run candidates'));
    const deletedIndex = labels.findIndex((label) => label.includes('GC deleted files'));
    expect(dryRunIndex).toBeGreaterThanOrEqual(0);
    expect(deletedIndex).toBeGreaterThan(dryRunIndex);
  });

  it('getAuditLogStats 返回文件数、总大小和最早事件时间', async () => {
    await _resetAuditLogForDate();
    await appendAuditEvent({
      runId: RUN_ID,
      workflowId: 'auto-risk-control-v1',
      eventType: 'workflow-started',
      userId: 'admin',
      role: 'branch_admin',
      requestId: 'req-stats',
      timestamp: '2026-04-27T01:00:00.000Z',
      payload: {},
    });
    await appendAuditEvent({
      runId: RUN_ID,
      workflowId: 'auto-risk-control-v1',
      eventType: 'step-completed',
      userId: 'admin',
      role: 'branch_admin',
      requestId: 'req-stats',
      timestamp: '2026-04-27T01:00:01.000Z',
      payload: { nodeId: 'n1' },
    });

    const readFileSpy = vi.spyOn(fs, 'readFile');
    const stats = await getAuditLogStats();
    expect(stats.totalFileCount).toBe(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.earliestEventTime).toBe('2026-04-27T01:00:00.000Z');
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});
