import { COLUMN_ALIASES } from '../normalize/mapping.js';
import { duckdbService } from '../services/duckdb.js';
import { escapeSqlValue } from './security.js';

export interface ParquetSourceInspection {
  columnNames: string[];
  hasRowLevelSchema: boolean;
  processingMode: string | null;
}

function hasMappedAlias(columns: string[], field: keyof typeof COLUMN_ALIASES): boolean {
  const aliases = (COLUMN_ALIASES[field] || []).map((alias) => alias.toLowerCase());
  return columns.some((column) => aliases.some((alias) => column === alias || column.includes(alias)));
}

function normalizeMetadataValue(value: unknown): string | null {
  if (value == null) return null;
  let normalizedValue = value;
  if (typeof value === 'object' && value !== null && 'bytes' in value) {
    const bytes = (value as { bytes?: Buffer | { data?: number[] } | Record<string, number> }).bytes;
    if (Buffer.isBuffer(bytes)) {
      normalizedValue = bytes.toString('utf-8');
    } else if (bytes && typeof bytes === 'object' && Array.isArray(bytes.data)) {
      normalizedValue = Buffer.from(bytes.data).toString('utf-8');
    } else if (bytes && typeof bytes === 'object') {
      const byteValues = Object.entries(bytes)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, entryValue]) => Number(entryValue))
        .filter((entryValue) => Number.isInteger(entryValue) && entryValue >= 0 && entryValue <= 255);
      if (byteValues.length > 0) {
        normalizedValue = Buffer.from(byteValues).toString('utf-8');
      }
    }
  }

  const normalized = String(normalizedValue).trim();
  return normalized === '' ? null : normalized;
}

export async function inspectParquetSource(filePath: string): Promise<ParquetSourceInspection> {
  const escapedPath = escapeSqlValue(filePath);
  const schemaRows = await duckdbService.query<{ column_name: string }>(`
    SELECT column_name
    FROM (DESCRIBE SELECT * FROM read_parquet('${escapedPath}'))
  `);
  const columnNames = schemaRows.map((row) => String(row.column_name).toLowerCase());

  let processingMode: string | null = null;
  try {
    const metadataRows = await duckdbService.query<{ key: unknown; value: unknown }>(`
      SELECT key, value
      FROM parquet_kv_metadata('${escapedPath}')
    `);
    // ETL 统一写出（数据管理/pipelines/parquet_utils.py）的键名是 etl_processing_mode；
    // 更名前的存量 Parquet 仍带 processing_mode，两个键都要识别，否则 merged 拒载守卫失效。
    const findModeValue = (keyName: string) =>
      metadataRows.find((row) => normalizeMetadataValue(row.key)?.toLowerCase() === keyName)?.value;
    const match = findModeValue('etl_processing_mode') ?? findModeValue('processing_mode');
    processingMode = normalizeMetadataValue(match)?.toLowerCase() ?? null;
  } catch {
    processingMode = null;
  }

  return {
    columnNames,
    hasRowLevelSchema: hasMappedAlias(columnNames, 'policy_no') && hasMappedAlias(columnNames, 'premium'),
    processingMode,
  };
}

export function getParquetLoadRejectionReason(inspection: ParquetSourceInspection): string | null {
  if (!inspection.hasRowLevelSchema) {
    return '仅允许加载行级实时数据文件';
  }

  if (!inspection.processingMode) {
    return null;
  }

  if (inspection.processingMode !== 'full') {
    return `仅允许加载 full 模式的逐行事实 Parquet，当前文件 processing_mode=${inspection.processingMode}`;
  }

  return null;
}

export function getParquetLoadWarning(inspection: ParquetSourceInspection): string | null {
  if (!inspection.processingMode) {
    return '未检测到 processing_mode 元数据，按兼容模式继续加载';
  }
  return null;
}
