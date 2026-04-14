/**
 * DuckDB 类型转换工具
 *
 * 将 DuckDB 特殊类型转换为 JSON 可序列化的值。
 * 从 duckdb.ts 拆出，纯函数，零外部依赖。
 */

// ============================================
// 慢查询监控阈值（毫秒）
// ============================================
export const SLOW_QUERY_THRESHOLD_MS = 3000;

/**
 * 转换 DuckDB 特殊类型为 JSON 可序列化的值
 * - BigInt → Number
 * - DuckDB DATE {days: N} → "YYYY-MM-DD" 字符串
 * - DuckDB TIMESTAMP {micros: N} → ISO 字符串
 */
export function convertBigIntToNumber(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return Number(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => convertBigIntToNumber(item));
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);

    // DuckDB DATE type: {days: number} → "YYYY-MM-DD"
    if (keys.length === 1 && keys[0] === 'days' && typeof data.days === 'number') {
      const ms = data.days * 86400000;
      return new Date(ms).toISOString().split('T')[0];
    }

    // DuckDB TIMESTAMP type: {micros: bigint|number} → ISO string
    if (keys.length === 1 && keys[0] === 'micros' && (typeof data.micros === 'bigint' || typeof data.micros === 'number')) {
      const ms = Number(data.micros) / 1000;
      return new Date(ms).toISOString();
    }

    const converted: any = {};
    for (const [key, value] of Object.entries(data)) {
      converted[key] = convertBigIntToNumber(value);
    }
    return converted;
  }

  return data;
}
