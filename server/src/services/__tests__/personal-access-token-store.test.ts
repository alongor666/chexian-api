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

  it('DuckDB 查询失败抛错（v5 Phase 3：失败必须传播给调用方）', async () => {
    setQueryImpl(async () => { throw new Error('db gone'); });
    // v5 Phase 3 行为变化：throw 替代吞错。
    // 调用方决定是否包成 AppError 或在 flush 路径用 try/catch warn 兜底。
    await expect(saveApiTokens()).rejects.toThrow(/db gone/);
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

// codex P1 回归：并发 saveApiTokens 必须按顺序串行落盘，
// 不能让旧快照（SELECT 先完成）覆盖新快照
describe('codex P1: 并发 saveApiTokens 串行化', () => {
  it('两个并发 save 必须按提交顺序最终落盘（后写赢）', async () => {
    const writeOrder: string[] = [];

    // 第一次 SELECT 故意慢（让出事件循环 30ms），第二次快
    let callCount = 0;
    setQueryImpl(async () => {
      const idx = ++callCount;
      if (idx === 1) {
        await new Promise(r => setTimeout(r, 30));
        return [{ ...sampleRow, token_id: 'OLDSNAP1' }];
      }
      writeOrder.push('select-2');
      return [{ ...sampleRow, token_id: 'NEWSNAP2' }];
    });

    // 并发触发两次 save；如果不串行，第二次会"插队"先写完
    const p1 = saveApiTokens();
    const p2 = saveApiTokens();
    await Promise.all([p1, p2]);

    // 串行化下：p1 的 SELECT 完成后写盘 → p2 才开始 SELECT → 写盘
    // 最终文件应是第二次（NEWSNAP2）覆盖第一次（OLDSNAP1）
    const parsed = JSON.parse(fs.readFileSync(_getStorePathForTest(), 'utf-8'));
    expect(parsed.tokens[0].token_id).toBe('NEWSNAP2');
  });

  it('单次失败不污染后续调用（catch 隔离）', async () => {
    let attempt = 0;
    setQueryImpl(async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return [sampleRow];
    });
    // v5 Phase 3：第一次 throw（调用方处理），第二次必须能正常完成
    // 关键保护：writeQueue 内部 `.catch(() => {})` 防 chain 死掉
    await expect(saveApiTokens()).rejects.toThrow(/boom/);
    await expect(saveApiTokens()).resolves.toBeUndefined();
    const parsed = JSON.parse(fs.readFileSync(_getStorePathForTest(), 'utf-8'));
    expect(parsed.tokens).toHaveLength(1);
  });
});

// codex P2 回归：load 阶段遇到脏数据不可抛出，否则会中断 app 启动
describe('codex P2: load 容错', () => {
  it('expires_at 为非法字符串 → 跳过该条，其他正常加载', async () => {
    fs.writeFileSync(_getStorePathForTest(), JSON.stringify({
      version: 1,
      tokens: [
        {
          token_id: 'GOODGOOD', token_hash: '$2b$10$ok', user_id: 'u-1', username: 'alice', name: 'cli',
          expires_at: '2026-12-31T00:00:00.000Z', last_used_at: null, last_used_ip: null,
          created_at: '2026-05-01T00:00:00.000Z', revoked_at: null,
        },
        {
          token_id: 'BADBADBA', token_hash: '$2b$10$bad', user_id: 'u-2', username: 'bob', name: 'cli',
          expires_at: 'not-a-date', last_used_at: null, last_used_ip: null,
          created_at: '2026-05-01T00:00:00.000Z', revoked_at: null,
        },
      ],
    }), 'utf-8');
    setQueryImpl(async () => []);
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(1);
    const inserts = getQueries().filter(q => /INSERT INTO ApiToken/.test(q.sql));
    expect(inserts[0].sql).toContain('GOODGOOD');
    expect(inserts[0].sql).not.toContain('BADBADBA');
  });

  it('last_used_at 为非法字符串 → 降级为 NULL，不跳过整条', async () => {
    fs.writeFileSync(_getStorePathForTest(), JSON.stringify({
      version: 1,
      tokens: [{
        token_id: 'GOODGOOD', token_hash: '$2b$10$ok', user_id: 'u-1', username: 'alice', name: 'cli',
        expires_at: '2026-12-31T00:00:00.000Z',
        last_used_at: 'garbage-here',  // 可空字段坏数据：降级 NULL
        last_used_ip: null,
        created_at: '2026-05-01T00:00:00.000Z', revoked_at: null,
      }],
    }), 'utf-8');
    setQueryImpl(async () => []);
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(1);
    const insertSql = getQueries().find(q => /INSERT INTO ApiToken/.test(q.sql))!.sql;
    expect(insertSql).toContain('GOODGOOD');
    // last_used_at 字段位置应为 NULL（不是 TIMESTAMP 字面量）
    expect(insertSql.match(/NULL/g)!.length).toBeGreaterThanOrEqual(1);
  });

  it('必填字段缺失 → 跳过该条', async () => {
    fs.writeFileSync(_getStorePathForTest(), JSON.stringify({
      version: 1,
      tokens: [{
        token_id: '', token_hash: '$2b$10$ok', user_id: 'u-1', username: 'alice', name: 'cli',
        expires_at: '2026-12-31T00:00:00.000Z', last_used_at: null, last_used_ip: null,
        created_at: '2026-05-01T00:00:00.000Z', revoked_at: null,
      }],
    }), 'utf-8');
    setQueryImpl(async () => []);
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(0);
  });

  it('INSERT 阶段抛错 → 不传播，返回 0', async () => {
    fs.writeFileSync(_getStorePathForTest(), JSON.stringify({
      version: 1,
      tokens: [{
        token_id: 'GOODGOOD', token_hash: '$2b$10$ok', user_id: 'u-1', username: 'alice', name: 'cli',
        expires_at: '2026-12-31T00:00:00.000Z', last_used_at: null, last_used_ip: null,
        created_at: '2026-05-01T00:00:00.000Z', revoked_at: null,
      }],
    }), 'utf-8');
    setQueryImpl(async () => { throw new Error('DuckDB INSERT crashed'); });
    const count = await loadApiTokensIntoTable();
    expect(count).toBe(0);  // 不抛错，启动可继续
  });
});
