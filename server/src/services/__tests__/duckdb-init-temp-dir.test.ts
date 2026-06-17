/**
 * DuckDBService.init temp_directory 行为集成测试（PR-12，需 DuckDB 原生二进制）
 *
 * 验证 init 时 spill 路径的三态行为：
 *   ① DUCKDB_INIT_OPTIONS.temp_directory 非空 → init 中应调一次 `SET temp_directory='${值}'`
 *      → 真实生效（`SELECT current_setting('temp_directory')` 回读值相符）
 *   ② DUCKDB_INIT_OPTIONS.temp_directory 空串 → init 中不应调 `SET temp_directory`
 *      → 保留 DuckDB 默认（cwd 下 `.tmp/`，回读 'temp_directory' 仍为 '.tmp'）
 *   ③ init 链路必含 `SELECT current_setting('temp_directory')`（启动日志依据，
 *      防 PR-12 启动日志可观测改造在后续重构中被无意删除）
 *
 * 用真实 DuckDBInstance（`:memory:`）+ `vi.spyOn(...).mockImplementation` 透传模式
 * 既能拦截 SQL 序列、又能让原 SQL 真正生效（验证 temp_directory 真的被写入设置层）。
 *
 * 排除策略：文件名以 `duckdb-` 开头 → 命中 vite.config.ts exclude，仅本地
 * `bun run test:integration` 跑（DuckDB 原生 binding 在 CI vitest/jsdom 失败）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { duckdbService } from '../duckdb.js';
import { DUCKDB_INIT_OPTIONS } from '../../config/database.js';

const SET_TEMP_DIR_RE = /^SET\s+temp_directory\s*=\s*'([^']+)'\s*$/i;
const CURRENT_SETTING_RE = /current_setting\('temp_directory'\)/i;

describe('DuckDBService.init temp_directory 行为（PR-12）', () => {
  const originalTempDir = DUCKDB_INIT_OPTIONS.temp_directory;

  beforeEach(async () => {
    // 确保未 init 状态；close 幂等，未初始化时 noop
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    DUCKDB_INIT_OPTIONS.temp_directory = originalTempDir;
    try { await duckdbService.close(); } catch { /* ignore */ }
  });

  it('① 非空时 init 中调 SET temp_directory 且真实生效', async () => {
    const targetDir = '/tmp/chexian-duckdb-spill-test';
    DUCKDB_INIT_OPTIONS.temp_directory = targetDir;

    const spy = vi.spyOn(duckdbService, 'query');
    await duckdbService.init();

    const setCalls = spy.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => SET_TEMP_DIR_RE.test(sql));
    expect(setCalls).toHaveLength(1);
    const match = setCalls[0]!.match(SET_TEMP_DIR_RE)!;
    expect(match[1]).toBe(targetDir);

    // 回读真实生效（spy 默认 pass-through 不拦原行为）
    const rows = await duckdbService.query<{ temp_directory: string }>(
      `SELECT current_setting('temp_directory') AS temp_directory`
    );
    expect(rows[0]?.temp_directory).toBe(targetDir);
  });

  it('② 空串时 init 不调 SET temp_directory（保留 DuckDB cwd 下 .tmp/ 默认）', async () => {
    DUCKDB_INIT_OPTIONS.temp_directory = '';

    const spy = vi.spyOn(duckdbService, 'query');
    await duckdbService.init();

    const setCalls = spy.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => SET_TEMP_DIR_RE.test(sql));
    expect(setCalls).toHaveLength(0);

    // 回读应为 DuckDB 默认值（cwd 下相对路径 '.tmp'，不强校具体值，避免不同版本默认值漂移）
    const rows = await duckdbService.query<{ temp_directory: string }>(
      `SELECT current_setting('temp_directory') AS temp_directory`
    );
    expect(typeof rows[0]?.temp_directory).toBe('string');
    expect(rows[0]?.temp_directory.length).toBeGreaterThan(0);
  });

  it('③ init 链路必含 SELECT current_setting(temp_directory)（启动日志依据，防回归）', async () => {
    DUCKDB_INIT_OPTIONS.temp_directory = '';

    const spy = vi.spyOn(duckdbService, 'query');
    await duckdbService.init();

    const settingReads = spy.mock.calls
      .map(([sql]) => String(sql))
      .filter(sql => CURRENT_SETTING_RE.test(sql));
    expect(settingReads.length).toBeGreaterThanOrEqual(1);
  });
});
