import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import ExcelJS from 'exceljs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

type DuckDbReader = { getRows(): unknown[][] };
type DuckDbConnection = {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<DuckDbReader>;
  closeSync(): void;
};
type DuckDbInstanceFactory = {
  create(databasePath: string): Promise<{
    connect(): Promise<DuckDbConnection>;
  }>;
};

const require = createRequire(import.meta.url);

// pandas または DuckDB native 依存が利用できない環境（CI など）では全テストをスキップ
const hasPandas = spawnSync('python3', ['-c', 'import pandas'], { stdio: 'pipe' }).status === 0;
const duckDbEntry = (() => {
  try {
    return require.resolve('@duckdb/node-api', { paths: [resolve('server')] });
  } catch {
    return null;
  }
})();
const hasDuckDbNodeApi = duckDbEntry !== null;
const hasParquetProcessingDeps = hasPandas && hasDuckDbNodeApi;

import { generateColumnMappingSQL } from '../server/src/services/column-normalizer';
import { generatePerformanceOrgHeatmapQuery } from '../server/src/sql/performance-analysis';
import { getParquetLoadRejectionReason } from '../server/src/utils/parquet-source';

const HEADER_ROW = [
  '三级机构', '保单号', '批单号', '是否续保', '吨位分段', '缴费日期', '签单日期', '保险起期',
  '客户类别', '新车购置价', '是否过户车', '是否新车', '是否新能源', '是否交商统保', '险别',
  '厂牌车型', '座位数', '车牌号码', '业务员', '代理人/经纪人', '客户源', '终端来源', '险类',
  '签单/批改保费', '商车自主定价系数', '批改类型', '是否报价', '车架号', '案件数', '赔款合计', '总费用金额',
];

const FIXTURE_ROWS = [
  ['天府', 'P0001', '', '', '', '2026-03-09', '2026-03-09', '2026-03-20', '非营业个人客车', 0, '否', '否', '否', '非套单', '交三', '车型A', 5, '川A01', '10001张三', '经代A', '直客', '柜面', '商业保险', 1000, 1.0, '', '否', 'VIN-001', 0, 0, 0],
  ['天府', 'P0001', '', '', '', '2026-03-10', '2026-03-10', '2026-03-21', '非营业个人客车', 0, '否', '否', '否', '非套单', '交三', '车型A', 5, '川A01', '10001张三', '经代A', '直客', '柜面', '商业保险', 500, 1.0, '', '否', 'VIN-001', 0, 0, 0],
  ['天府', 'P0003', '', '', '', '2026-03-10', '2026-03-10', '2026-03-22', '非营业个人客车', 0, '否', '否', '否', '非套单', '交三', '车型C', 5, '川A03', '10003王五', '经代C', '直客', '柜面', '商业保险', -200, 1.0, '16退保', '否', 'VIN-003', 0, 0, 0],
  ['天府', 'P0002', '', '', '', '2026-03-10', '2026-03-10', '2026-03-25', '营业货车', 0, '否', '否', '否', '非套单', '主全', '车型B', 2, '川A02', '10002李四', '经代B', '转介绍', '柜面', '商业保险', 2000, 1.0, '', '否', 'VIN-002', 0, 0, 0],
];

function escapeSqlValue(value: string): string {
  return value.replace(/'/g, "''");
}

async function createFixtureWorkbook(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('车险签单报价数据1');
  sheet.addRow(HEADER_ROW);
  FIXTURE_ROWS.forEach((row) => sheet.addRow(row));
  await workbook.xlsx.writeFile(filePath);
}

function getDuckDbInstanceFactory(): DuckDbInstanceFactory {
  if (!duckDbEntry) {
    throw new Error('@duckdb/node-api is unavailable for parquet-processing.test.ts');
  }
  return require(duckDbEntry).DuckDBInstance as DuckDbInstanceFactory;
}

async function runDuckDbQuery<T = unknown[]>(sql: string): Promise<T[]> {
  const db = await getDuckDbInstanceFactory().create(':memory:');
  const conn = await db.connect();
  try {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRows() as T[];
  } finally {
    conn.closeSync();
  }
}

async function getProcessingMode(parquetPath: string): Promise<string | null> {
  // 镜像 server/src/utils/parquet-source.ts：ETL 统一写出键名 etl_processing_mode 优先，
  // 兼容更名前存量文件的 processing_mode
  const rows = await runDuckDbQuery<[string, string]>(`
    SELECT key, value
    FROM parquet_kv_metadata('${escapeSqlValue(parquetPath)}')
    WHERE key IN ('etl_processing_mode', 'processing_mode')
    ORDER BY CASE WHEN key = 'etl_processing_mode' THEN 0 ELSE 1 END
  `);
  const rawValue = rows[0]?.[1];
  if (rawValue == null) return null;
  if (typeof rawValue === 'object' && rawValue !== null && 'bytes' in rawValue) {
    const bytes = (rawValue as { bytes?: Buffer | { data?: number[] } | Record<string, number> }).bytes;
    if (Buffer.isBuffer(bytes)) {
      return bytes.toString('utf-8');
    }
    if (bytes && typeof bytes === 'object' && Array.isArray(bytes.data)) {
      return Buffer.from(bytes.data).toString('utf-8');
    }
    if (bytes && typeof bytes === 'object') {
      const byteValues = Object.entries(bytes)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, value]) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 255);
      if (byteValues.length > 0) {
        return Buffer.from(byteValues).toString('utf-8');
      }
    }
  }
  return String(rawValue);
}

async function getPremiumByDateAndCategory(parquetPath: string): Promise<Record<string, number>> {
  // transform.py 已输出英文字段名（CN→EN 迁移）：客户类别→customer_category、保费→premium、
  // 签单日期(业绩统计日期)→policy_date，权威映射见 server/src/config/field-registry/fields.json
  const rows = await runDuckDbQuery<[string, number]>(`
    SELECT customer_category, ROUND(SUM(premium), 2) AS premium
    FROM read_parquet('${escapeSqlValue(parquetPath)}')
    WHERE CAST(policy_date AS DATE) = DATE '2026-03-10'
    GROUP BY 1
    ORDER BY 1
  `);
  return Object.fromEntries(rows.map(([category, premium]) => [String(category), Number(premium)]));
}

async function buildPolicyFactViewFromParquet(parquetPath: string): Promise<string> {
  const escapedPath = escapeSqlValue(parquetPath);
  const db = await getDuckDbInstanceFactory().create(':memory:');
  const conn = await db.connect();
  try {
    await conn.run(`CREATE TABLE raw_parquet AS SELECT * FROM read_parquet('${escapedPath}')`);
    const schemaReader = await conn.runAndReadAll('DESCRIBE raw_parquet');
    const actualColumns = schemaReader.getRows().map((row) => String(row[0]));
    await conn.run(generateColumnMappingSQL('raw_parquet', actualColumns));
    const sql = generatePerformanceOrgHeatmapQuery(
      "policy_date >= DATE '2026-03-10' AND policy_date <= DATE '2026-03-10'",
      'all',
      'day',
      15,
      'customer_category'
    );
    const reader = await conn.runAndReadAll(`
      SELECT org_level_3, CAST(policy_date AS VARCHAR) AS policy_date, premium
      FROM (${sql})
      WHERE policy_date = DATE '2026-03-10'
      ORDER BY org_level_3
    `);
    return JSON.stringify(reader.getRows());
  } finally {
    conn.closeSync();
  }
}

describe.skipIf(!hasParquetProcessingDeps).sequential('Parquet processing defaults and load guards', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'chexian-parquet-fix-'));
  const inputXlsx = join(tempDir, 'fixture.xlsx');
  const fullParquet = join(tempDir, 'fixture-full.parquet');
  const mergedParquet = join(tempDir, 'fixture-merged.parquet');

  // 镜像生产链路 daily.mjs buildPythonEnv()：transform.py 内 `from pipelines.xxx import ...`
  // 依赖 数据管理/ 在 PYTHONPATH 上，否则 ModuleNotFoundError: No module named 'pipelines'
  const pythonEnv = {
    ...process.env,
    PYTHONPATH: [resolve('数据管理'), process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  };

  beforeAll(async () => {
    await createFixtureWorkbook(inputXlsx);
    execFileSync('python3', [resolve('数据管理/pipelines/transform.py'), '-i', inputXlsx, '-o', fullParquet], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: pythonEnv,
    });
    execFileSync('python3', [resolve('数据管理/pipelines/transform.py'), '-i', inputXlsx, '-o', mergedParquet, '-m', 'merged'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: pythonEnv,
    });
  }, 60_000);

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('transform.py should default to full mode and preserve same-policy rows across dates', async () => {
    expect(await getProcessingMode(fullParquet)).toBe('full');

    const premiumMap = await getPremiumByDateAndCategory(fullParquet);
    expect(premiumMap).toEqual({
      '营业货车': 2000,
      '非营业个人客车': 300,
    });
  });

  it('merged mode should remain opt-in and collapse cross-date premium into the retained row', async () => {
    expect(await getProcessingMode(mergedParquet)).toBe('merged');

    const premiumMap = await getPremiumByDateAndCategory(mergedParquet);
    expect(premiumMap).toEqual({
      '营业货车': 2000,
      '非营业个人客车': -200,
    });
  });

  it('load guard should allow full parquet and reject merged parquet', async () => {
    const fullReason = getParquetLoadRejectionReason({
      columnNames: ['保单号', '保费'],
      hasRowLevelSchema: true,
      processingMode: await getProcessingMode(fullParquet),
    });
    const mergedReason = getParquetLoadRejectionReason({
      columnNames: ['保单号', '保费'],
      hasRowLevelSchema: true,
      processingMode: await getProcessingMode(mergedParquet),
    });

    expect(fullReason).toBeNull();
    expect(mergedReason).toContain('processing_mode=merged');
  });

  it('performance heatmap should match row-level full parquet for 2026-03-10 customer categories', async () => {
    const rowsJson = await buildPolicyFactViewFromParquet(fullParquet);
    const rows = JSON.parse(rowsJson) as Array<[string, string, number]>;
    const premiumMap = Object.fromEntries(
      rows.map(([dimension, policyDate, premium]) => [`${dimension}|${policyDate}`, Number(premium)])
    );

    // 签单保费 = 净额含批改（281e638d，2026-05-22 口径变更）：
    // 非营业个人客车 03-10 = 500（P0001 批改） + (-200)（P0003 退保） = 300 元 = 0.03 万
    expect(premiumMap['营业货车|2026-03-10']).toBeCloseTo(0.2, 6);
    expect(premiumMap['非营业个人客车|2026-03-10']).toBeCloseTo(0.03, 6);
  });
});
