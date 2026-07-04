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
 * - DuckDB DECIMAL {width, scale, value} → Number（value / 10**scale）
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

    // DuckDB DECIMAL type: {width, scale, value} → Number（value / 10**scale）
    // 三键须同时存在且类型正确才转换，避免误伤其他对象形状（如缺 value 的 {width,scale}，
    // 或恰好携带同名字段的普通业务对象）。
    if (
      keys.length === 3 &&
      typeof data.width === 'number' &&
      typeof data.scale === 'number' &&
      (typeof data.value === 'bigint' || typeof data.value === 'number')
    ) {
      return Number(data.value) / 10 ** data.scale;
    }

    const converted: any = {};
    for (const [key, value] of Object.entries(data)) {
      converted[key] = convertBigIntToNumber(value);
    }
    return converted;
  }

  return data;
}
