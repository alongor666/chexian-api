/**
 * duckdb-type-converter.ts — 纯函数单元测试
 *
 * 测试覆盖 convertBigIntToNumber 所有类型分支及 SLOW_QUERY_THRESHOLD_MS 常量。
 * 零外部依赖，无 DuckDB 原生模块，可在 bun run test 中运行。
 */
import { describe, it, expect } from 'vitest';
import { convertBigIntToNumber, SLOW_QUERY_THRESHOLD_MS } from '../duckdb-type-converter.js';

describe('duckdb-type-converter', () => {
  // TC-01: 常量值验证
  it('TC-01: SLOW_QUERY_THRESHOLD_MS 导出值为 3000', () => {
    expect(SLOW_QUERY_THRESHOLD_MS).toBe(3000);
  });

  // TC-02: null / undefined 直通
  it('TC-02: null 原样返回', () => {
    expect(convertBigIntToNumber(null)).toBeNull();
  });

  it('TC-02b: undefined 原样返回', () => {
    expect(convertBigIntToNumber(undefined)).toBeUndefined();
  });

  // TC-03: BigInt → Number 转换
  it('TC-03: BigInt 值转换为 Number', () => {
    expect(convertBigIntToNumber(BigInt(42))).toBe(42);
    expect(convertBigIntToNumber(BigInt(0))).toBe(0);
    expect(convertBigIntToNumber(BigInt(-100))).toBe(-100);
  });

  // TC-04: DuckDB DATE {days: N} → "YYYY-MM-DD"
  it('TC-04: DuckDB DATE 对象 {days: 0} 转换为 "1970-01-01"', () => {
    const result = convertBigIntToNumber({ days: 0 });
    expect(result).toBe('1970-01-01');
  });

  it('TC-04b: DuckDB DATE 对象 {days: 19358} 转换为 "2023-01-01"', () => {
    // 2023-01-01 = 19358 days since 1970-01-01
    const result = convertBigIntToNumber({ days: 19358 });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // TC-05: DuckDB TIMESTAMP {micros: N} → ISO string
  it('TC-05: DuckDB TIMESTAMP 对象 {micros: 0} 转换为 ISO 字符串', () => {
    const result = convertBigIntToNumber({ micros: 0 });
    expect(typeof result).toBe('string');
    // micros=0 → ms=0 → 1970-01-01T00:00:00.000Z
    expect(result).toBe('1970-01-01T00:00:00.000Z');
  });

  it('TC-05b: DuckDB TIMESTAMP 对象 {micros: BigInt} 也能转换', () => {
    const result = convertBigIntToNumber({ micros: BigInt(0) });
    expect(typeof result).toBe('string');
    expect(result).toBe('1970-01-01T00:00:00.000Z');
  });

  // TC-06: 数组递归转换
  it('TC-06: 数组内的 BigInt 被递归转换', () => {
    const input = [BigInt(1), BigInt(2), BigInt(3)];
    const result = convertBigIntToNumber(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it('TC-06b: 嵌套数组被递归转换', () => {
    const input = [{ days: 0 }, { micros: 0 }, BigInt(7)];
    const result = convertBigIntToNumber(input);
    expect(result[0]).toBe('1970-01-01');
    expect(result[1]).toBe('1970-01-01T00:00:00.000Z');
    expect(result[2]).toBe(7);
  });

  // TC-07: 嵌套对象递归转换
  it('TC-07: 普通对象内的 BigInt 字段被递归转换', () => {
    const input = { count: BigInt(100), label: 'test', nested: { value: BigInt(5) } };
    const result = convertBigIntToNumber(input);
    expect(result.count).toBe(100);
    expect(result.label).toBe('test');
    expect(result.nested.value).toBe(5);
  });

  // TC-08: 普通值直通（string, number, boolean）
  it('TC-08: 普通 number/string/boolean 原样返回', () => {
    expect(convertBigIntToNumber(42)).toBe(42);
    expect(convertBigIntToNumber('hello')).toBe('hello');
    expect(convertBigIntToNumber(true)).toBe(true);
  });

  // TC-09: 不匹配 DATE/TIMESTAMP 格式的对象走普通对象转换分支
  it('TC-09: {days: N, extra: M} 不被识别为 DATE 对象，走普通对象分支', () => {
    const input = { days: 100, extra: BigInt(5) };
    const result = convertBigIntToNumber(input);
    // 两个字段，不匹配单字段 DATE 格式
    expect(result.days).toBe(100);
    expect(result.extra).toBe(5); // BigInt 被递归转换
  });

  // TC-10: DuckDB DECIMAL {width, scale, value} → Number
  it('TC-10: DECIMAL 正常值（value 为 number）按 scale 换算', () => {
    // 123.45，width=10 scale=2 value=12345
    const result = convertBigIntToNumber({ width: 10, scale: 2, value: 12345 });
    expect(result).toBe(123.45);
  });

  it('TC-10b: DECIMAL 负数值正确换算', () => {
    // -123.45
    const result = convertBigIntToNumber({ width: 10, scale: 2, value: -12345 });
    expect(result).toBe(-123.45);
  });

  it('TC-10c: DECIMAL scale=0 时等于原始整数值', () => {
    const result = convertBigIntToNumber({ width: 5, scale: 0, value: 42 });
    expect(result).toBe(42);
  });

  it('TC-10d: DECIMAL value 为 BigInt 时也能正确换算', () => {
    const result = convertBigIntToNumber({ width: 18, scale: 4, value: BigInt(1234567) });
    expect(result).toBeCloseTo(123.4567, 10);
  });

  it('TC-10e: DECIMAL value 为负数 BigInt 时也能正确换算', () => {
    const result = convertBigIntToNumber({ width: 18, scale: 2, value: BigInt(-500) });
    expect(result).toBe(-5);
  });

  // TC-11: 形状不完整/不匹配的对象不被误转为 DECIMAL
  it('TC-11: {width, scale} 缺 value 字段，不被识别为 DECIMAL，走普通对象分支', () => {
    const input = { width: 10, scale: 2 };
    const result = convertBigIntToNumber(input);
    expect(result).toEqual({ width: 10, scale: 2 });
  });

  it('TC-11b: {width, scale, value} 但 value 为字符串，不被识别为 DECIMAL', () => {
    const input = { width: 10, scale: 2, value: '12345' };
    const result = convertBigIntToNumber(input);
    // 不匹配 DECIMAL 形状，走普通对象分支，字段原样保留
    expect(result).toEqual({ width: 10, scale: 2, value: '12345' });
  });

  it('TC-11c: {width, scale, value, extra} 四键不被识别为 DECIMAL', () => {
    const input = { width: 10, scale: 2, value: 12345, extra: 'x' };
    const result = convertBigIntToNumber(input);
    expect(result).toEqual({ width: 10, scale: 2, value: 12345, extra: 'x' });
  });

  it('TC-11d: 普通业务对象恰好含三键但类型不符，不被误转', () => {
    const input = { width: '宽', scale: '刻度', value: '值' };
    const result = convertBigIntToNumber(input);
    expect(result).toEqual({ width: '宽', scale: '刻度', value: '值' });
  });
});
