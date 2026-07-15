import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDuckDBService, type DuckDBService } from '../duckdb.js';
import { loadSalesTeamPerformance } from '../duckdb-domain-loaders.js';
import {
  generateSalesTeamPerformanceQuery,
  generateSalesTeamPerformanceTotalQuery,
} from '../../sql/sales-team-performance.js';

describe('SalesTeamPerformance 原生 DuckDB 集成', () => {
  let db: DuckDBService;
  let root: string;
  let parquetPath: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'sales-team-native-'));
    parquetPath = join(root, 'fixture.parquet').replace(/'/g, "''");
    db = createDuckDBService({ path: ':memory:' });
    await db.init();
    await db.query(`COPY (
      SELECT * FROM (VALUES
        ('甲', '一队', '太原', '车险', DATE '2026-06-01', 100.0, 120.0),
        ('甲', '一队', '太原', '车险', DATE '2026-06-02', 200.0, 240.0),
        ('乙', '二队', '大同', '非车险', DATE '2026-06-03', 300.0, 330.0)
      ) AS t("业务员", "销售团队", "机构", "险种大类", "承保确认时间", "实收保费", "标保")
    ) TO '${parquetPath}' (FORMAT PARQUET)`);
    await loadSalesTeamPerformance(db, parquetPath);
  });

  afterAll(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('中文列视图按业务员聚合并使用无歧义的明细行数字段', async () => {
    const rows = await db.query<Record<string, unknown>>(
      generateSalesTeamPerformanceQuery({ dimension: 'salesman', limit: 10 }),
    );
    expect(rows[0]).toMatchObject({ dim_value: '甲', sales_team_row_count: 2 });
    expect(rows[0]?.standard_premium).toBe(360);
  });

  it('日期窗口合计与行数一致', async () => {
    const totals = await db.query<Record<string, unknown>>(
      generateSalesTeamPerformanceTotalQuery({ start: '2026-06-02', end: '2026-06-03' }),
    );
    expect(totals[0]).toMatchObject({
      sales_team_row_count: 2,
      received_premium: 500,
      standard_premium: 570,
      latest_confirm_date: '2026-06-03',
    });
  });
});
