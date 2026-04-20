/**
 * snapshot-serve 快照清理逻辑测试
 *
 * 验证 invalidateSnapshotPathCache() 能正确删除磁盘快照文件并记录清理结果。
 * 不依赖 DuckDB，纯文件系统操作。
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir: string;

async function writeSnapshotFile(bundle: string, scope: string, paramHash: string, content: object) {
  const dir = path.join(tmpDir, bundle, scope);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${paramHash}.json`), JSON.stringify(content));
}

async function countJsonFiles(dir: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += await countJsonFiles(fullPath);
      } else if (entry.name.endsWith('.json')) {
        count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

const mockGetSnapshotDirs = vi.fn<(...args: unknown[]) => string[]>(() => []);

vi.mock('../../config/paths.js', () => ({
  getSnapshotDirs: (...args: any[]) => mockGetSnapshotDirs(...args),
}));

import {
  invalidateSnapshotPathCache,
  getSnapshotPurgeResult,
  computeParamHash,
  permissionToScope,
  resetSnapshotStats,
  getSnapshotStats,
} from '../../middleware/snapshot-serve.js';

describe('snapshot-serve — 快照文件清理', () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-purge-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('SP-01: invalidateSnapshotPathCache 删除磁盘快照文件', async () => {
    await writeSnapshotFile('dashboard-bundle', 'all', 'abc123456789', { _meta: { etlDate: '2025-01-01' }, data: {} });
    await writeSnapshotFile('dashboard-bundle', 'all', 'def987654321', { _meta: { etlDate: '2025-01-01' }, data: {} });
    await writeSnapshotFile('performance-bundle', 'all', 'ghi555555555', { _meta: { etlDate: '2025-01-01' }, data: {} });

    const beforeCount = await countJsonFiles(tmpDir);
    expect(beforeCount).toBe(3);

    mockGetSnapshotDirs.mockReturnValue([tmpDir]);

    invalidateSnapshotPathCache();
    await new Promise((r) => setTimeout(r, 500));

    const afterCount = await countJsonFiles(tmpDir);
    expect(afterCount).toBe(0);
  });

  it('SP-02: 清理结果通过 getSnapshotPurgeResult 可查', async () => {
    await writeSnapshotFile('dashboard-bundle', 'all', 'sp02hash001', { _meta: { etlDate: '2025-01-01' }, data: { kpi: 1 } });

    invalidateSnapshotPathCache();
    await new Promise((r) => setTimeout(r, 500));

    const result = getSnapshotPurgeResult();
    expect(result).not.toBeNull();
    expect(result!.filesDeleted).toBeGreaterThanOrEqual(1);
    expect(result!.timestamp).toBeTruthy();
  });

  it('SP-03: 空目录不报错', async () => {
    invalidateSnapshotPathCache();
    await new Promise((r) => setTimeout(r, 500));

    const result = getSnapshotPurgeResult();
    expect(result).not.toBeNull();
    expect(result!.errors).toBe(0);
  });
});

describe('snapshot-serve — 纯函数', () => {
  it('SP-04: computeParamHash 确定性', () => {
    const h1 = computeParamHash({ b: '2', a: '1' });
    const h2 = computeParamHash({ a: '1', b: '2' });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(12);
  });

  it('SP-05: permissionToScope 正确解析', () => {
    expect(permissionToScope(undefined)).toBe('all');
    expect(permissionToScope('1=1')).toBe('all');
    expect(permissionToScope("org_level_3 = '某某分公司'")).toBe('某某分公司');
    expect(permissionToScope('is_telemarketing = true')).toBe('telemarketing');
    expect(permissionToScope('unknown_filter = 1')).toBeNull();
  });

  it('SP-06: resetSnapshotStats 清零', () => {
    resetSnapshotStats();
    const stats = getSnapshotStats();
    expect(stats.hit).toBe(0);
    expect(stats.miss).toBe(0);
    expect(stats.stale).toBe(0);
    expect(stats.error).toBe(0);
  });
});
