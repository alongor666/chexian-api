/**
 * PAT 持久层单测
 *
 * 覆盖：
 *  - saveApiTokens：SELECT → JSON 原子写（tmp + rename）
 *  - loadApiTokensIntoTable：JSON → INSERT 批量加载
 *  - 文件缺失 / 损坏 / tokens 非数组 → 返回 0 不抛
 *  - 跨"PM2 reload"模拟：save → 清空内存表 → load → 数据一致
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 临时目录 + mock paths.ts 让 getDataDir 指向它
// 注意：vi.mock 会 hoist 到文件顶部，所以用 vi.hoisted 让 tmpRoot 一并提升
const { tmpRoot } = vi.hoisted(() => {
  const _fs = require('fs') as typeof import('fs');
  const _os = require('os') as typeof import('os');
  const _path = require('path') as typeof import('path');
  return { tmpRoot: _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pat-store-')) };
});
vi.mock('../../config/paths.js', () => ({
  getDataDir: () => tmpRoot,
  getApiTokenStorePath: () => path.join(tmpRoot, 'api_tokens.json'),
}));

// Mock duckdbService：记录 SQL + 自定义 query 实现
vi.mock('../duckdb.js', () => {
  const queries: Array<{ sql: string }> = [];
  let queryImpl: (sql: string) => Promise<any[]> = async () => [];
  return {
    duckdbService: {
      query: async (sql: string) => {
        queries.push({ sql });
        return queryImpl(sql);
      },
    },
    __setQueryImpl: (fn: (sql: string) => Promise<any[]>) => { queryImpl = fn; },
    __getQueries: () => queries,
    __resetQueries: () => { queries.length = 0; },
  };
});

import {
  saveApiTokens,
  loadApiTokensIntoTable,
  _getStorePathForTest,
  _deleteStoreForTest,
} from '../personal-access-token-store.js';
import * as duckdbMod from '../duckdb.js';
const setQueryImpl = (duckdbMod as any).__setQueryImpl as (fn: (sql: string) => Promise<any[]>) => void;
const getQueries = (duckdbMod as any).__getQueries as () => Array<{ sql: string }>;
const resetQueries = (duckdbMod as any).__resetQueries as () => void;

const sampleRow = {
  token_id: 'AAAAAAAA',
  token_hash: '$2b$10$abc',
  user_id: 'u-1',
  username: 'alice',
  name: 'cli-token',
  expires_at: new Date('2026-12-31T00:00:00Z'),
  last_used_at: null,
  last_used_ip: null,
  created_at: new Date('2026-05-12T00:00:00Z'),
  revoked_at: null,
};

beforeEach(() => {
  resetQueries();
  _deleteStoreForTest();
});

afterEach(() => {
  _deleteStoreForTest();
});

describe('saveApiTokens', () => {
  it('原子写入：tmp + rename，最终落到 api_tokens.json', async () => {
    setQueryImpl(async () => [sampleRow]);
    await saveApiTokens();
    const file = _getStorePathForTest();
    expect(fs.existsSync(file)).toBe(true);
    // tmp 文件不应残留
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(parsed.version).toBe(1);
    expect(parsed.tokens).toHaveLength(1);
    expect(parsed.tokens[0].token_id).toBe('AAAAAAAA');
    expect(parsed.tokens[0].token_hash).toBe('$2b$10$abc');
    expect(parsed.tokens[0].last_used_at).toBeNull();
    expect(parsed.tokens[0].revoked_at).toBeNull();
  });

  it('空表也能写入合法 JSON', async () => {
    setQueryImpl(async () => []);
    await saveApiTokens();
    const parsed = JSON.parse(fs.readFileSync(_getStorePathForTest(), 'utf-8'));
    expect(parsed.tokens).toEqual([]);
  });

  it('DuckDB 查询失败不抛（持久化失败不阻塞热路径）', async () => {
    setQueryImpl(async () => { throw new Error('db gone'); });
    // 不抛即通过
    await expect(saveApiTokens()).resolves.toBeUndefined();
    // 也不应创建文件（写之前查询就挂了）
    expect(fs.existsSync(_getStorePathForTest())).toBe(false);
  });
});

describe('loadApiTokensIntoTable', () => {
  it('文件不存在：返回 0，不发起 INSERT', async () => {
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(0);
    expect(getQueries().filter(q => /INSERT INTO ApiToken/.test(q.sql))).toHaveLength(0);
  });

  it('JSON 损坏：返回 0 不抛', async () => {
    fs.writeFileSync(_getStorePathForTest(), '{ not valid json', 'utf-8');
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(0);
  });

  it('tokens 字段非数组：返回 0 不抛', async () => {
    fs.writeFileSync(_getStorePathForTest(), JSON.stringify({ version: 1, tokens: 'oops' }), 'utf-8');
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(0);
  });

  it('正常加载：构造 INSERT 语句包含所有字段值', async () => {
    fs.writeFileSync(_getStorePathForTest(), JSON.stringify({
      version: 1,
      exportedAt: '2026-05-12T00:00:00Z',
      tokens: [{
        token_id: 'BBBBBBBB',
        token_hash: '$2b$10$xyz',
        user_id: 'u-2',
        username: 'bob',
        name: 'mcp-token',
        expires_at: '2026-12-31T00:00:00.000Z',
        last_used_at: '2026-05-11T10:00:00.000Z',
        last_used_ip: '1.2.3.4',
        created_at: '2026-05-01T00:00:00.000Z',
        revoked_at: null,
      }],
    }), 'utf-8');
    setQueryImpl(async () => []);
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(1);
    const inserts = getQueries().filter(q => /INSERT INTO ApiToken/.test(q.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain('BBBBBBBB');
    expect(inserts[0].sql).toContain('$2b$10$xyz');
    expect(inserts[0].sql).toContain("'1.2.3.4'");
    // revoked_at 为 null 时落 NULL 字面量（不带引号）
    expect(inserts[0].sql).toMatch(/NULL[\s,)]/);
  });
});

describe('save → load 跨"PM2 reload"往返一致性', () => {
  it('save 出去再 load 回来，INSERT 数据应保留', async () => {
    // step 1: save
    setQueryImpl(async () => [sampleRow]);
    await saveApiTokens();
    // step 2: 模拟 reload — 清空 query 调用历史
    resetQueries();
    // step 3: load
    setQueryImpl(async () => []);
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(1);
    const inserts = getQueries().filter(q => /INSERT INTO ApiToken/.test(q.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain('AAAAAAAA');
    expect(inserts[0].sql).toContain('$2b$10$abc');
  });
});
