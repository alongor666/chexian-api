/**
 * parsePositiveInt 单元测试
 *
 * 重点覆盖 codex review 指出的"parseInt 部分解析"陷阱：
 * "1.5" / "8abc" / "1e2" 等 parseInt 会"宽容"接受的字符串必须被严格拒绝，
 * 否则生产 env 写错值时服务会以错误的资源限制静默启动。
 */
import { describe, expect, it, vi } from 'vitest';
import { parsePositiveInt } from '../parse-env.js';

describe('parsePositiveInt', () => {
  it('合法字面正整数返回解析值', () => {
    expect(parsePositiveInt('X', '1', 99)).toBe(1);
    expect(parsePositiveInt('X', '8', 99)).toBe(8);
    expect(parsePositiveInt('X', '100', 99)).toBe(100);
    expect(parsePositiveInt('X', '  42  ', 99)).toBe(42); // trim 空白
  });

  it('未设置（undefined / 空串）返回 fallback', () => {
    expect(parsePositiveInt('X', undefined, 8)).toBe(8);
    expect(parsePositiveInt('X', '', 8)).toBe(8);
  });

  it('部分解析陷阱必须拒绝（codex P2 修复点）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // parseInt 会宽容地返回 1/8/1，必须被严格拒绝
    expect(parsePositiveInt('X', '1.5', 99)).toBe(99);
    expect(parsePositiveInt('X', '8abc', 99)).toBe(99);
    expect(parsePositiveInt('X', '1e2', 99)).toBe(99);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('零 / 负数 / 非数字返回 fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePositiveInt('X', '0', 8)).toBe(8);
    expect(parsePositiveInt('X', '-3', 8)).toBe(8);
    expect(parsePositiveInt('X', 'abc', 8)).toBe(8);
    expect(parsePositiveInt('X', 'NaN', 8)).toBe(8);
    warn.mockRestore();
  });

  it('前导零 / 浮点数返回 fallback（避免歧义）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parsePositiveInt('X', '01', 8)).toBe(8); // 八进制歧义
    expect(parsePositiveInt('X', '08', 8)).toBe(8);
    expect(parsePositiveInt('X', '3.0', 8)).toBe(8);
    warn.mockRestore();
  });

  it('warn 信息包含 env 变量名和原始值（便于诊断）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parsePositiveInt('DUCKDB_MAX_CONNECTIONS', '1.5', 8);
    expect(warn.mock.calls[0]?.[0]).toContain('DUCKDB_MAX_CONNECTIONS');
    expect(warn.mock.calls[0]?.[0]).toContain('"1.5"');
    expect(warn.mock.calls[0]?.[0]).toContain('使用默认值 8');
    warn.mockRestore();
  });
});
