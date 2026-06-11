/**
 * Parquet KV 元数据解析 — 纯函数模块（PR #585 评审建议抽出）
 *
 * 不 import duckdb（原生模块），CI 单元测试可直接覆盖键匹配逻辑。
 * 消费方：parquet-source.ts（装载守卫）。
 */

export interface ParquetMetadataRow {
  key: unknown;
  value: unknown;
}

/** DuckDB parquet_kv_metadata 的 key/value 可能是 Buffer 包装对象，统一归一化为字符串 */
export function normalizeMetadataValue(value: unknown): string | null {
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

/**
 * 从元数据行中解析处理模式。
 *
 * ETL 统一写出（数据管理/pipelines/parquet_utils.py）的键名是 etl_processing_mode；
 * 更名前的存量 Parquet 仍带 processing_mode，两个键都要识别，否则 merged 拒载守卫失效
 * （5c5caffe 改名后守卫曾静默失效两个月，PR #585 修复）。
 */
export function resolveProcessingMode(metadataRows: ParquetMetadataRow[]): string | null {
  const findModeValue = (keyName: string) =>
    metadataRows.find((row) => normalizeMetadataValue(row.key)?.toLowerCase() === keyName)?.value;
  const match = findModeValue('etl_processing_mode') ?? findModeValue('processing_mode');
  return normalizeMetadataValue(match)?.toLowerCase() ?? null;
}
