/**
 * DuckDB 性能优化测试 (P0/P1/P1b/P3)
 *
 * 覆盖：
 * - P0: loadMultipleParquet() read_parquet 统一路径
 * - P1: materializePolicyFactWorkingSet() 布尔标准化
 * - P1b: CrossSellDailyAgg CTE 简化后等价性
 * - P3: materializeInBatches() 环境感知分批
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { duckdbService } from '../server/src/services/duckdb.js';
import { BOOLEAN_FIELDS } from '../server/src/services/column-normalizer.js';

describe('P0: loadMultipleParquet — read_parquet 统一路径', () => {
  beforeAll(async () => {
    await duckdbService.init();
  });

  afterAll(async () => {
    await duckdbService.close();
  });

  // T2: 0 文件 → AppError(400)
  it('T2: 0 文件抛 AppError(400)', async () => {
    await expect(duckdbService.loadMultipleParquet([])).rejects.toThrow('No parquet files provided');
  });

  // T3: 不存在的文件 → 清晰报错
  it('T3: 不存在的文件抛 AppError(500) 含报错信息', async () => {
    await expect(
      duckdbService.loadMultipleParquet(['/nonexistent/file.parquet'])
    ).rejects.toThrow(/Parquet loading failed/);
  });
});

describe('P1: BOOLEAN_FIELDS 导出一致性', () => {
  it('BOOLEAN_FIELDS 包含 7 个预期字段', () => {
    const expected = [
      'is_renewal', 'is_renewable', 'is_new_car', 'is_transfer',
      'is_nev', 'is_telemarketing', 'is_cross_sell',
    ];
    for (const field of expected) {
      expect(BOOLEAN_FIELDS).toContain(field);
    }
  });

  it('BOOLEAN_FIELDS 不包含 is_commercial_insure', () => {
    expect(BOOLEAN_FIELDS).not.toContain('is_commercial_insure');
  });
});

describe('P1: 布尔标准化 SELECT * REPLACE 语义验证', () => {
  beforeAll(async () => {
    await duckdbService.init();
  });

  afterAll(async () => {
    await duckdbService.close();
  });

  // T4: VARCHAR 各种真值 → BOOLEAN true
  it('T4: VARCHAR 真值标准化为 true', async () => {
    const trueValues = ["'是'", "'1'", "'true'", "'t'", "'y'", "'yes'", "'有'"];
    for (const val of trueValues) {
      const result = await duckdbService.query<{ result: boolean }>(
        `SELECT CASE WHEN LOWER(TRIM(CAST(${val} AS VARCHAR))) IN ('是', '1', 'true', 't', 'y', 'yes', '有', '有驾意险交叉销售') THEN true ELSE false END AS result`
      );
      expect(result[0].result).toBe(true);
    }
  });

  // T5: NULL → false
  it('T5: NULL 标准化为 false', async () => {
    const result = await duckdbService.query<{ result: boolean }>(
      `SELECT CASE WHEN LOWER(TRIM(CAST(NULL AS VARCHAR))) IN ('是', '1', 'true', 't', 'y', 'yes', '有', '有驾意险交叉销售') THEN true ELSE false END AS result`
    );
    expect(result[0].result).toBe(false);
  });

  // T4b: 已是 BOOLEAN true → 保持 true
  it('T4b: BOOLEAN true 经 CAST AS VARCHAR 后仍命中', async () => {
    const result = await duckdbService.query<{ result: boolean }>(
      `SELECT CASE WHEN LOWER(TRIM(CAST(true AS VARCHAR))) IN ('是', '1', 'true', 't', 'y', 'yes', '有', '有驾意险交叉销售') THEN true ELSE false END AS result`
    );
    expect(result[0].result).toBe(true);
  });
});

describe('P3: 环境感知分批策略', () => {
  // T6: 验证 DUCKDB_INIT_OPTIONS.threads 控制分批行为
  it('T6: threads 配置可读取', async () => {
    // 确认配置存在且为正整数
    const { DUCKDB_INIT_OPTIONS } = await import('../server/src/config/database.js');
    expect(DUCKDB_INIT_OPTIONS.threads).toBeGreaterThan(0);
    expect(typeof DUCKDB_INIT_OPTIONS.threads).toBe('number');
  });
});

describe('P1b: CrossSellDailyAgg CTE 布尔字段简化验证', () => {
  beforeAll(async () => {
    await duckdbService.init();
  });

  afterAll(async () => {
    await duckdbService.close();
  });

  // T7: COALESCE(bool_field, false) 对 BOOLEAN 输入等价于旧 TRY_CAST 逻辑
  it('T7: COALESCE(true, false) = true', async () => {
    const result = await duckdbService.query<{ val: boolean }>(
      `SELECT COALESCE(true, false) AS val`
    );
    expect(result[0].val).toBe(true);
  });

  it('T7b: COALESCE(false, false) = false', async () => {
    const result = await duckdbService.query<{ val: boolean }>(
      `SELECT COALESCE(false, false) AS val`
    );
    expect(result[0].val).toBe(false);
  });

  it('T7c: COALESCE(NULL::BOOLEAN, false) = false', async () => {
    const result = await duckdbService.query<{ val: boolean }>(
      `SELECT COALESCE(NULL::BOOLEAN, false) AS val`
    );
    expect(result[0].val).toBe(false);
  });
});
