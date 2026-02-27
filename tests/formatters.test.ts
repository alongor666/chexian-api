import { describe, it, expect } from 'vitest';
import { formatPremium, formatRate, formatNumber, formatSalesmanName } from '../src/shared/utils/formatters';

describe('formatters', () => {
  describe('formatPremium', () => {
    // 新规则：万元、1位小数、无单位
    it('formats premium in 万 with 1 decimal, no unit', () => {
      expect(formatPremium(0)).toBe('0.0');
      expect(formatPremium(123456)).toBe('12.3'); // 12.3456万 -> 12.3
      expect(formatPremium(9999)).toBe('1.0'); // 0.9999万 -> 1.0
    });

    it('handles thousand separators correctly', () => {
      expect(formatPremium(12345678)).toBe('1,234.6'); // 1234.5678万 -> 1,234.6
      expect(formatPremium(123456789)).toBe('12,345.7'); // 12345.6789万 -> 12,345.7
      expect(formatPremium(1234567890)).toBe('123,456.8'); // 123456.789万 -> 123,456.8
    });

    it('handles rounding edge cases', () => {
      // 四舍五入边界测试（1位小数）
      expect(formatPremium(14999)).toBe('1.5'); // 1.4999万 -> 1.5
      expect(formatPremium(15000)).toBe('1.5'); // 1.5万 -> 1.5
      expect(formatPremium(15001)).toBe('1.5'); // 1.5001万 -> 1.5
      expect(formatPremium(24999)).toBe('2.5'); // 2.4999万 -> 2.5
      expect(formatPremium(25000)).toBe('2.5'); // 2.5万 -> 2.5
    });

    it('handles invalid numbers', () => {
      expect(formatPremium(Number.NaN)).toBe('-');
      expect(formatPremium(Number.POSITIVE_INFINITY)).toBe('-');
      expect(formatPremium(Number.NEGATIVE_INFINITY)).toBe('-');
    });

    it('handles edge values', () => {
      expect(formatPremium(0)).toBe('0.0');
      expect(formatPremium(1)).toBe('0.0'); // 0.0001万 -> 0.0
      expect(formatPremium(10000)).toBe('1.0'); // 1万 -> 1.0
      expect(formatPremium(9999999999)).toBe('1,000,000.0'); // 极大值
    });
  });

  describe('formatRate', () => {
    it('formats ratio or percent with one decimal', () => {
      expect(formatRate(0.1234)).toBe('12.3%');
      expect(formatRate(12.34)).toBe('12.3%');
      expect(formatRate(100)).toBe('100.0%');
    });

    it('handles precision with rounding', () => {
      // 精度测试 - 1位小数
      expect(formatRate(0.1234)).toBe('12.3%'); // 12.34% -> 12.3% (舍)
      expect(formatRate(0.1236)).toBe('12.4%'); // 12.36% -> 12.4% (入)
      expect(formatRate(0.1299)).toBe('13.0%'); // 12.99% -> 13.0% (入)
      expect(formatRate(0.001)).toBe('0.1%'); // 0.1%
      expect(formatRate(0.999)).toBe('99.9%'); // 99.9%
    });

    it('handles edge values', () => {
      expect(formatRate(0)).toBe('0.0%');
      expect(formatRate(1)).toBe('100.0%');
      expect(formatRate(0.0001)).toBe('0.0%'); // 0.01% -> 0.0%
      expect(formatRate(0.0005)).toBe('0.1%'); // 0.05% -> 0.1%
    });

    it('handles invalid numbers', () => {
      expect(formatRate(Number.NaN)).toBe('-');
      expect(formatRate(Number.NEGATIVE_INFINITY)).toBe('-');
      expect(formatRate(Number.POSITIVE_INFINITY)).toBe('-');
    });
  });

  describe('formatNumber', () => {
    it('formats number with rounding', () => {
      expect(formatNumber(12.4)).toBe('12');
      expect(formatNumber(12.5)).toBe('13');
    });

    it('handles thousand separators correctly', () => {
      expect(formatNumber(1234)).toBe('1,234');
      expect(formatNumber(12345)).toBe('12,345');
      expect(formatNumber(123456)).toBe('123,456');
      expect(formatNumber(1234567)).toBe('1,234,567');
    });

    it('handles rounding edge cases', () => {
      expect(formatNumber(1.4)).toBe('1'); // 舍
      expect(formatNumber(1.5)).toBe('2'); // 入
      expect(formatNumber(2.4)).toBe('2'); // 舍
      expect(formatNumber(2.5)).toBe('3'); // 入
    });

    it('handles edge values', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(9999999999)).toBe('9,999,999,999'); // 极大值保持原样
    });

    it('handles invalid numbers', () => {
      expect(formatNumber(Number.NaN)).toBe('-');
      expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('-');
      expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('-');
    });
  });

  describe('formatSalesmanName', () => {
    it('only keeps Chinese name and removes numeric/english IDs', () => {
      expect(formatSalesmanName('210000461周鑫磊')).toBe('周鑫磊');
      expect(formatSalesmanName('A1002王小明')).toBe('王小明');
      expect(formatSalesmanName('陈晓梅(200053182)')).toBe('陈晓梅');
    });

    it('maps admin to 直接个代', () => {
      expect(formatSalesmanName('admin')).toBe('直接个代');
      expect(formatSalesmanName('ADMIN001')).toBe('直接个代');
      expect(formatSalesmanName('Admin_系统')).toBe('直接个代');
    });

    it('returns fallback for invalid names', () => {
      expect(formatSalesmanName('100200300')).toBe('-');
      expect(formatSalesmanName('')).toBe('-');
      expect(formatSalesmanName(undefined)).toBe('-');
      expect(formatSalesmanName(null)).toBe('-');
    });
  });
});
