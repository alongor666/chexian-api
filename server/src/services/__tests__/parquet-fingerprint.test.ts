/**
 * computeParquetFingerprint — 纯行为单元测试
 *
 * 只测试 computeParquetFingerprint 纯函数，不触发 loadMultipleParquet（需要 DuckDB 原生模块）。
 * 使用临时文件验证真实 statSync 路径；不存在的路径验证 null 返回。
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeParquetFingerprint } from '../duckdb-parquet-loader.js';

describe('computeParquetFingerprint', () => {
  // PF-01: 对不存在的文件返回 null
  it('PF-01: 文件不存在时返回 null（触发全量重建信号）', () => {
    const result = computeParquetFingerprint(['/nonexistent/path/file.parquet']);
    expect(result).toBeNull();
  });

  // PF-02: 对空数组不崩溃（无文件时指纹稳定）
  it('PF-02: 空文件列表返回非 null 指纹（hash of empty）', () => {
    const result = computeParquetFingerprint([]);
    expect(result).not.toBeNull();
    expect(result!.fingerprint).toBeTruthy();
    expect(result!.mtimes.size).toBe(0);
  });

  // PF-03: 同一文件列表两次调用返回相同指纹（确定性）
  it('PF-03: 相同文件列表返回相同指纹（确定性）', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pf-test-'));
    const file1 = join(tmpDir, 'a.parquet');
    const file2 = join(tmpDir, 'b.parquet');
    writeFileSync(file1, 'dummy');
    writeFileSync(file2, 'dummy');

    try {
      const r1 = computeParquetFingerprint([file1, file2]);
      const r2 = computeParquetFingerprint([file1, file2]);
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.fingerprint).toBe(r2!.fingerprint);
    } finally {
      try { unlinkSync(file1); } catch { /* ignore */ }
      try { unlinkSync(file2); } catch { /* ignore */ }
    }
  });

  // PF-04: 顺序无关（内部排序）
  it('PF-04: 文件列表顺序不同，返回相同指纹', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pf-order-'));
    const file1 = join(tmpDir, 'x.parquet');
    const file2 = join(tmpDir, 'y.parquet');
    writeFileSync(file1, 'data1');
    writeFileSync(file2, 'data2');

    try {
      const r1 = computeParquetFingerprint([file1, file2]);
      const r2 = computeParquetFingerprint([file2, file1]);
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.fingerprint).toBe(r2!.fingerprint);
    } finally {
      try { unlinkSync(file1); } catch { /* ignore */ }
      try { unlinkSync(file2); } catch { /* ignore */ }
    }
  });

  // PF-05: 返回 mtimes Map，包含所有文件路径
  it('PF-05: 返回的 mtimes Map 包含所有文件路径', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pf-mtimes-'));
    const file1 = join(tmpDir, 'p.parquet');
    writeFileSync(file1, 'content');

    try {
      const result = computeParquetFingerprint([file1]);
      expect(result).not.toBeNull();
      expect(result!.mtimes.has(file1)).toBe(true);
      expect(typeof result!.mtimes.get(file1)).toBe('number');
    } finally {
      try { unlinkSync(file1); } catch { /* ignore */ }
    }
  });

  // PF-06: 部分文件不存在时返回 null
  it('PF-06: 文件列表中任一文件不存在则返回 null', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pf-partial-'));
    const existingFile = join(tmpDir, 'exists.parquet');
    writeFileSync(existingFile, 'real');

    try {
      const result = computeParquetFingerprint([existingFile, '/no/such/file.parquet']);
      expect(result).toBeNull();
    } finally {
      try { unlinkSync(existingFile); } catch { /* ignore */ }
    }
  });
});
