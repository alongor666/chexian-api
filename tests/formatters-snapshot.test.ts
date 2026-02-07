/**
 * 格式化统一性快照测试
 *
 * 目的：确保 formatPremium、formatRate、formatNumber 等格式化函数
 * 在各种边界情况下输出一致，防止格式化逻辑被意外修改
 */

import { describe, it, expect } from 'vitest';
import { formatPremium, formatRate, formatNumber } from '../src/shared/utils/formatters';

describe('格式化统一性快照测试', () => {
  describe('formatPremium 快照测试', () => {
    it('应正确格式化零值', () => {
      expect(formatPremium(0)).toMatchSnapshot('premium-0');
    });

    it('应正确格式化小数值', () => {
      expect(formatPremium(1234)).toMatchSnapshot('premium-1234');
    });

    it('应正确格式化万级数值', () => {
      expect(formatPremium(12345678)).toMatchSnapshot('premium-12345678');
    });

    it('应正确格式化大数值（亿元）', () => {
      expect(formatPremium(1234567890)).toMatchSnapshot('premium-1234567890');
    });

    it('应正确处理千分位分隔', () => {
      expect(formatPremium(12345678)).toMatchSnapshot('premium-thousands');
    });

    it('应正确四舍五入到万元', () => {
      expect(formatPremium(12345678)).toMatchInlineSnapshot(`"1,234.6"`);
    });
  });

  describe('formatRate 快照测试', () => {
    it('应正确格式化0%', () => {
      expect(formatRate(0)).toMatchSnapshot('rate-0');
    });

    it('应正确格式化小数百分比', () => {
      expect(formatRate(0.123)).toMatchSnapshot('rate-0.123');
    });

    it('应正确格式整数百分比', () => {
      expect(formatRate(1)).toMatchSnapshot('rate-1');
    });

    it('应正确格式化大于100%的值', () => {
      expect(formatRate(1.5)).toMatchSnapshot('rate-1.5');
    });

    it('应保留1位小数', () => {
      expect(formatRate(0.1234)).toMatchInlineSnapshot('"12.3%"');
    });

    it('应处理边界值 0.05%', () => {
      expect(formatRate(0.0005)).toMatchInlineSnapshot('"0.1%"');
    });
  });

  describe('formatNumber 快照测试', () => {
    it('应正确格式化零值', () => {
      expect(formatNumber(0)).toMatchSnapshot('number-0');
    });

    it('应正确格式化小整数', () => {
      expect(formatNumber(123)).toMatchSnapshot('number-123');
    });

    it('应正确格式化带千分位的数值', () => {
      expect(formatNumber(1234567)).toMatchSnapshot('number-1234567');
    });

    it('应保留整数（无小数）', () => {
      expect(formatNumber(1234.56)).toMatchInlineSnapshot('"1,235"');
    });
  });

  describe('边界值快照测试', () => {
    it('formatPremium 应处理负数', () => {
      expect(formatPremium(-12345678)).toMatchSnapshot('premium-negative');
    });

    it('formatRate 应处理微小值', () => {
      expect(formatRate(0.00001)).toMatchSnapshot('rate-tiny');
    });

    it('formatRate 应处理极大值', () => {
      expect(formatRate(999.99)).toMatchSnapshot('rate-large');
    });

    it('应处理 NaN 值', () => {
      expect(formatPremium(NaN)).toMatchSnapshot('premium-nan');
      expect(formatRate(NaN)).toMatchSnapshot('rate-nan');
      expect(formatNumber(NaN)).toMatchSnapshot('number-nan');
    });

    it('应处理 Infinity', () => {
      expect(formatPremium(Infinity)).toMatchSnapshot('premium-infinity');
      expect(formatRate(Infinity)).toMatchSnapshot('rate-infinity');
      expect(formatNumber(Infinity)).toMatchSnapshot('number-infinity');
    });
  });

  describe('格式化一致性测试', () => {
    it('相同输入应产生相同输出（formatPremium）', () => {
      const input = 12345678;
      const result1 = formatPremium(input);
      const result2 = formatPremium(input);
      expect(result1).toBe(result2);
      expect(result1).toMatchSnapshot('premium-consistency');
    });

    it('相同输入应产生相同输出（formatRate）', () => {
      const input = 0.3638;
      const result1 = formatRate(input);
      const result2 = formatRate(input);
      expect(result1).toBe(result2);
      expect(result1).toMatchSnapshot('rate-consistency');
    });

    it('千分位分隔符应一致', () => {
      const largeNumber = 12345678901;
      expect(formatNumber(largeNumber)).toMatchInlineSnapshot('"12,345,678,901"');
    });
  });
});
