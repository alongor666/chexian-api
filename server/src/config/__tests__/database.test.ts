/**
 * DUCKDB_INIT_OPTIONS / databaseConfig 单元测试（PR-12：temp_directory 显式化）
 *
 * 验证 dbEnv.DUCKDB_TEMP_DIR → DUCKDB_INIT_OPTIONS.temp_directory 这条配置链路：
 *   - DUCKDB_INIT_OPTIONS 必须包含 temp_directory 字段（防回归：B 阶段 PR-12 移除会让
 *     cost 立方体 OOM 诊断重新陷入"看不到真实 temp_directory"困境）
 *   - 默认值绑定到 dbEnv.DUCKDB_TEMP_DIR（默认空串=保留 DuckDB cwd 下 .tmp/ 兜底）
 *   - 历史 max_memory / threads 字段保持不变（防 PR-12 误删兼容字段）
 */
import { describe, expect, it } from 'vitest';
import { databaseConfig, DUCKDB_INIT_OPTIONS } from '../database.js';
import { dbEnv } from '../env.js';

describe('DUCKDB_INIT_OPTIONS (PR-12 temp_directory 显式化)', () => {
  it('包含 temp_directory 字段（PR-12 防回归）', () => {
    expect(DUCKDB_INIT_OPTIONS).toHaveProperty('temp_directory');
  });

  it('temp_directory 值绑定到 dbEnv.DUCKDB_TEMP_DIR', () => {
    expect(DUCKDB_INIT_OPTIONS.temp_directory).toBe(dbEnv.DUCKDB_TEMP_DIR);
  });

  it('默认无 env 时 temp_directory 为空串（保留 DuckDB cwd 下 .tmp/ 默认行为）', () => {
    // 进程启动无 DUCKDB_TEMP_DIR env 时（CI/本地 dev 缺省路径）应为空串。
    // 非空串场景由集成测试覆盖（见 duckdb-init-temp-dir.test.ts），此处只断默认。
    if (process.env.DUCKDB_TEMP_DIR === undefined || process.env.DUCKDB_TEMP_DIR === '') {
      expect(DUCKDB_INIT_OPTIONS.temp_directory).toBe('');
    } else {
      // 若 CI 注入了非空 env（少见但允许），至少应等于 env 值
      expect(DUCKDB_INIT_OPTIONS.temp_directory).toBe(process.env.DUCKDB_TEMP_DIR);
    }
  });

  it('历史字段 max_memory / threads / allow_unsigned_extensions 保留不变（兼容性）', () => {
    expect(DUCKDB_INIT_OPTIONS).toHaveProperty('max_memory');
    expect(DUCKDB_INIT_OPTIONS).toHaveProperty('threads');
    expect(DUCKDB_INIT_OPTIONS.allow_unsigned_extensions).toBe(false);
  });

  it('databaseConfig.path 仍读 dbEnv.DUCKDB_PATH（不受 PR-12 影响）', () => {
    expect(databaseConfig.path).toBe(dbEnv.DUCKDB_PATH);
  });
});

describe('dbEnv.DUCKDB_TEMP_DIR', () => {
  it('类型为 string（缺省空串与非空字符串都合法，运行时由 DuckDBService.init 分支）', () => {
    expect(typeof dbEnv.DUCKDB_TEMP_DIR).toBe('string');
  });
});
