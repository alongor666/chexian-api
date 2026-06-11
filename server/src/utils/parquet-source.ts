import { COLUMN_ALIASES } from '../normalize/mapping.js';
import { duckdbService } from '../services/duckdb.js';
import { resolveProcessingMode } from './parquet-metadata.js';
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
    processingMode = resolveProcessingMode(metadataRows);
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
