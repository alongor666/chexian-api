import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅 ETL 内部使用）
import { mergeOverlappingWeeklyShard } from '../数据管理/lib/parquet-merge.mjs';

describe('mergeOverlappingWeeklyShard（部分重叠周更分片合并，不重复不遗漏 — 2026-07-06）', () => {
  let dir: string;
  let archiveDir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `parquet-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    archiveDir = join(dir, '.archive');
    mkdirSync(dir, { recursive: true });
    // 占位文件（本函数不真读内容，行数由注入的 mock runDuckdb 决定）
    writeFileSync(join(dir, 'other.parquet'), 'x');
    writeFileSync(join(dir, 'authoritative.parquet'), 'x');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function mockRunDuckdb(rowCounts: { otherKept: number; authoritative: number; merged: number }) {
    let copyCalled = false;
    const calls: string[] = [];
    const runDuckdb = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('COPY')) {
        copyCalled = true;
        // 真实产出合并临时文件，供后续 renameSync 落地
        writeFileSync(join(dir, 'merged.parquet.tmp-merge'), 'x');
        return [];
      }
      if (sql.includes("read_parquet('") && sql.includes('other.parquet')) {
        return [{ n: rowCounts.otherKept }];
      }
      if (sql.includes('authoritative.parquet') && !sql.includes('tmp-merge')) {
        return [{ n: rowCounts.authoritative }];
      }
      if (sql.includes('tmp-merge')) {
        return [{ n: rowCounts.merged }];
      }
      return [{ n: 0 }];
    });
    return { runDuckdb, calls, wasCopyCalled: () => copyCalled };
  }

  it('行数对上（不重复不遗漏）→ 合并成功，原两份归档，产出合并文件', async () => {
    const { runDuckdb } = mockRunDuckdb({ otherKept: 100, authoritative: 50, merged: 150 });
    const mergedPath = join(dir, 'merged.parquet');

    const result = await mergeOverlappingWeeklyShard({
      authoritativePath: join(dir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(dir, 'other.parquet'),
      mergedPath,
      archiveDir,
      runDuckdb,
    });

    expect(result).toEqual({ mergedRows: 150, otherKeptRows: 100, authoritativeRows: 50, dryRun: false });
    expect(existsSync(mergedPath)).toBe(true);
    expect(existsSync(join(dir, 'other.parquet'))).toBe(false); // 已归档
    expect(existsSync(join(dir, 'authoritative.parquet'))).toBe(false); // 已归档
    const archived = readdirSync(archiveDir);
    expect(archived.some((f) => f.startsWith('other_'))).toBe(true);
    expect(archived.some((f) => f.startsWith('authoritative_'))).toBe(true);
  });

  it('🔴 行数对不上（不重复不遗漏校验失败）→ 抛错，不落地合并文件、不归档原文件', async () => {
    const { runDuckdb } = mockRunDuckdb({ otherKept: 100, authoritative: 50, merged: 140 }); // 少了 10 行
    const mergedPath = join(dir, 'merged.parquet');

    await expect(mergeOverlappingWeeklyShard({
      authoritativePath: join(dir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(dir, 'other.parquet'),
      mergedPath,
      archiveDir,
      runDuckdb,
    })).rejects.toThrow(/物理行数核对失败/);

    // 校验失败必须在归档动作之前，原文件必须原封不动
    expect(existsSync(join(dir, 'other.parquet'))).toBe(true);
    expect(existsSync(join(dir, 'authoritative.parquet'))).toBe(true);
    expect(existsSync(mergedPath)).toBe(false);
  });

  it('dryRun=true → 只读校验行数，不归档、不落地任何真实文件', async () => {
    const { runDuckdb } = mockRunDuckdb({ otherKept: 100, authoritative: 50, merged: 150 });
    const mergedPath = join(dir, 'merged.parquet');

    const result = await mergeOverlappingWeeklyShard({
      authoritativePath: join(dir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(dir, 'other.parquet'),
      mergedPath,
      archiveDir,
      runDuckdb,
      dryRun: true,
    });

    expect(result).toEqual({ mergedRows: 150, otherKeptRows: 100, authoritativeRows: 50, dryRun: true });
    // dry-run：三份真实文件都不应被改动
    expect(existsSync(join(dir, 'other.parquet'))).toBe(true);
    expect(existsSync(join(dir, 'authoritative.parquet'))).toBe(true);
    expect(existsSync(mergedPath)).toBe(false);
    expect(existsSync(archiveDir)).toBe(false); // 连归档目录都不应创建
  });

  it('dryRun=true 且行数对不上 → 仍然抛错（校验语义不受 dry-run 影响）', async () => {
    const { runDuckdb } = mockRunDuckdb({ otherKept: 100, authoritative: 50, merged: 140 });
    await expect(mergeOverlappingWeeklyShard({
      authoritativePath: join(dir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(dir, 'other.parquet'),
      mergedPath: join(dir, 'merged.parquet'),
      archiveDir,
      runDuckdb,
      dryRun: true,
    })).rejects.toThrow(/物理行数核对失败/);
  });

  it('SQL 用 WHERE 日期范围排除权威文件覆盖的区间（而不是假设谁的起点更早）', async () => {
    const { runDuckdb, calls } = mockRunDuckdb({ otherKept: 10, authoritative: 20, merged: 30 });
    await mergeOverlappingWeeklyShard({
      authoritativePath: join(dir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(dir, 'other.parquet'),
      mergedPath: join(dir, 'merged.parquet'),
      archiveDir,
      runDuckdb,
    });
    const copySql = calls.find((s) => s.startsWith('COPY'));
    expect(copySql).toContain("2026-06-01");
    expect(copySql).toContain("2026-07-05");
    expect(copySql).toContain('UNION ALL BY NAME');
  });

  it('🔴 other 里 policy_date 为 NULL 的行必须保留，不能被 WHERE 范围条件静默排除（codex 评审 P2）', async () => {
    const { runDuckdb, calls } = mockRunDuckdb({ otherKept: 5, authoritative: 20, merged: 25 });
    await mergeOverlappingWeeklyShard({
      authoritativePath: join(dir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(dir, 'other.parquet'),
      mergedPath: join(dir, 'merged.parquet'),
      archiveDir,
      runDuckdb,
    });
    // WHERE 子句在日期范围条件之外必须显式 OR IS NULL —— 否则 NULL 与 </>  比较结果是
    // UNKNOWN，既不算"在范围内"也不算"在范围外"，行会凭空消失且行数核对测不出来。
    const countSql = calls.find((s) => s.includes('COUNT(*)') && s.includes('other.parquet'));
    expect(countSql).toMatch(/policy_date IS NULL/);
    const copySql = calls.find((s) => s.startsWith('COPY'));
    expect(copySql).toMatch(/policy_date IS NULL/);
  });

  it('SQL 路径含单引号时正确转义（防注入/防语法错误）', async () => {
    const trickyDir = join(dir, "it's-a-dir");
    mkdirSync(trickyDir, { recursive: true });
    writeFileSync(join(trickyDir, 'other.parquet'), 'x');
    writeFileSync(join(trickyDir, 'authoritative.parquet'), 'x');
    const { runDuckdb, calls } = mockRunDuckdb({ otherKept: 1, authoritative: 1, merged: 2 });
    // mock 的路径匹配用 includes('other.parquet') 等，换目录不影响判定逻辑
    const runDuckdbTricky = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('COPY')) {
        writeFileSync(join(trickyDir, 'merged.parquet.tmp-merge'), 'x');
        return [];
      }
      if (sql.includes('other.parquet') && !sql.includes('tmp-merge')) return [{ n: 1 }];
      if (sql.includes('authoritative.parquet') && !sql.includes('tmp-merge')) return [{ n: 1 }];
      if (sql.includes('tmp-merge')) return [{ n: 2 }];
      return [{ n: 0 }];
    });
    await mergeOverlappingWeeklyShard({
      authoritativePath: join(trickyDir, 'authoritative.parquet'),
      authoritativeStart: '20260601',
      authoritativeEnd: '20260705',
      otherPath: join(trickyDir, 'other.parquet'),
      mergedPath: join(trickyDir, 'merged.parquet'),
      archiveDir: join(trickyDir, '.archive'),
      runDuckdb: runDuckdbTricky,
    });
    const copySql = calls.find((s) => s.startsWith('COPY'));
    expect(copySql).toContain("it''s-a-dir"); // 单引号被转义为两个单引号
  });
});
