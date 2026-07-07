import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import {
  STATUS_FILE_BASENAME,
  readStatusDomains,
  writeStatusDomain,
  mergeDomainStatus,
} from '../数据管理/lib/data-sources-status.mjs';

let root: string;
let statusPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'data-sources-status-'));
  statusPath = join(root, STATUS_FILE_BASENAME);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readStatusDomains', () => {
  it('文件缺失 → 返回空对象', () => {
    expect(readStatusDomains(statusPath)).toEqual({});
  });

  it('JSON 损坏 → 返回空对象（不抛异常）', () => {
    writeFileSync(statusPath, '{ 不是合法 JSON', 'utf-8');
    expect(readStatusDomains(statusPath)).toEqual({});
  });

  it('domains 字段缺失或非对象 → 返回空对象', () => {
    writeFileSync(statusPath, JSON.stringify({ _comment: 'x' }), 'utf-8');
    expect(readStatusDomains(statusPath)).toEqual({});
    writeFileSync(statusPath, JSON.stringify({ domains: 'not-an-object' }), 'utf-8');
    expect(readStatusDomains(statusPath)).toEqual({});
  });

  it('正常文件 → 返回 domains map', () => {
    writeFileSync(
      statusPath,
      JSON.stringify({ domains: { premium: { row_count: 100 } } }),
      'utf-8'
    );
    expect(readStatusDomains(statusPath)).toEqual({ premium: { row_count: 100 } });
  });
});

describe('writeStatusDomain', () => {
  it('首写建文件含 _comment，且落盘内容与返回值一致', () => {
    const entry = writeStatusDomain(statusPath, 'premium', {
      last_updated: '2026-07-06',
      row_count: 4464114,
      field_count: 42,
      data_range: '2021-01-01 ~ 2026-05-16',
    });
    expect(entry).toEqual({
      last_updated: '2026-07-06',
      row_count: 4464114,
      field_count: 42,
      data_range: '2021-01-01 ~ 2026-05-16',
    });

    const onDisk = JSON.parse(readFileSync(statusPath, 'utf-8'));
    expect(onDisk._comment).toBeTruthy();
    expect(onDisk.domains.premium).toEqual(entry);
  });

  it('二次写合并覆盖同域字段，且不影响他域', () => {
    writeStatusDomain(statusPath, 'premium', { row_count: 100, field_count: 10 });
    writeStatusDomain(statusPath, 'claims_detail', { row_count: 999 });

    const updated = writeStatusDomain(statusPath, 'premium', { row_count: 200 });
    expect(updated).toEqual({ row_count: 200, field_count: 10 });

    const domains = readStatusDomains(statusPath);
    expect(domains.premium).toEqual({ row_count: 200, field_count: 10 });
    expect(domains.claims_detail).toEqual({ row_count: 999 }); // 他域不受影响
  });

  it('patch 中 null/undefined 键不写入（不抹掉旧值）', () => {
    writeStatusDomain(statusPath, 'premium', { row_count: 100, field_count: 10, data_range: '2021~2026' });
    const updated = writeStatusDomain(statusPath, 'premium', {
      row_count: 150,
      field_count: undefined,
      data_range: null,
    });
    expect(updated).toEqual({ row_count: 150, field_count: 10, data_range: '2021~2026' });
  });

  it('文件缺失时从空骨架起步（不抛异常）', () => {
    const entry = writeStatusDomain(statusPath, 'quotes', { row_count: 5 });
    expect(entry).toEqual({ row_count: 5 });
  });
});

describe('mergeDomainStatus', () => {
  it('statusEntry 存在时覆盖契约同名字段', () => {
    const contract = { id: 'premium', name: '保费', row_count: 1, output: 'a.parquet' };
    const status = { row_count: 999, last_updated: '2026-07-06' };
    expect(mergeDomainStatus(contract, status)).toEqual({
      id: 'premium',
      name: '保费',
      row_count: 999,
      output: 'a.parquet',
      last_updated: '2026-07-06',
    });
  });

  it('statusEntry 为空/undefined 时返回契约浅拷贝（冻结快照兜底）', () => {
    const contract = { id: 'premium', row_count: 1 };
    expect(mergeDomainStatus(contract, undefined)).toEqual(contract);
    expect(mergeDomainStatus(contract, undefined)).not.toBe(contract); // 新对象，非同一引用
  });
});
