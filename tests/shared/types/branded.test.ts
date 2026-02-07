/**
 * 品牌类型测试
 */

import { describe, it, expect } from 'vitest';
import {
  isMoney,
  isPositiveInteger,
  isPercentage,
  isRatio,
  isNonNegative,
  asMoney,
  asPositiveInteger,
  asPercentage,
  asRatio,
  tryAsMoney,
  tryAsPercentage,
  ratioToPercentage,
  percentageToRatio,
  isPolicyNumber,
  isOrgCode,
  isISODateString,
  asISODateString,
  dateToISOString,
} from '../../../src/shared/types/branded';

describe('品牌类型 - 数值类型守卫', () => {
  describe('isMoney', () => {
    it('应该接受正数', () => {
      expect(isMoney(100)).toBe(true);
      expect(isMoney(0)).toBe(true);
      expect(isMoney(1234567.89)).toBe(true);
    });

    it('应该拒绝负数', () => {
      expect(isMoney(-100)).toBe(false);
    });

    it('应该拒绝非有限数', () => {
      expect(isMoney(Infinity)).toBe(false);
      expect(isMoney(-Infinity)).toBe(false);
      expect(isMoney(NaN)).toBe(false);
    });
  });

  describe('isPositiveInteger', () => {
    it('应该接受正整数', () => {
      expect(isPositiveInteger(1)).toBe(true);
      expect(isPositiveInteger(100)).toBe(true);
      expect(isPositiveInteger(999999)).toBe(true);
    });

    it('应该拒绝零', () => {
      expect(isPositiveInteger(0)).toBe(false);
    });

    it('应该拒绝负数', () => {
      expect(isPositiveInteger(-1)).toBe(false);
    });

    it('应该拒绝小数', () => {
      expect(isPositiveInteger(1.5)).toBe(false);
    });
  });

  describe('isPercentage', () => {
    it('应该接受0-100范围内的数', () => {
      expect(isPercentage(0)).toBe(true);
      expect(isPercentage(50)).toBe(true);
      expect(isPercentage(100)).toBe(true);
      expect(isPercentage(33.33)).toBe(true);
    });

    it('应该拒绝超出范围的数', () => {
      expect(isPercentage(-1)).toBe(false);
      expect(isPercentage(101)).toBe(false);
    });

    it('应该拒绝非有限数', () => {
      expect(isPercentage(NaN)).toBe(false);
      expect(isPercentage(Infinity)).toBe(false);
    });
  });

  describe('isRatio', () => {
    it('应该接受0-1范围内的数', () => {
      expect(isRatio(0)).toBe(true);
      expect(isRatio(0.5)).toBe(true);
      expect(isRatio(1)).toBe(true);
      expect(isRatio(0.333)).toBe(true);
    });

    it('应该拒绝超出范围的数', () => {
      expect(isRatio(-0.1)).toBe(false);
      expect(isRatio(1.1)).toBe(false);
    });
  });

  describe('isNonNegative', () => {
    it('应该接受非负数', () => {
      expect(isNonNegative(0)).toBe(true);
      expect(isNonNegative(100)).toBe(true);
      expect(isNonNegative(0.001)).toBe(true);
    });

    it('应该拒绝负数', () => {
      expect(isNonNegative(-0.001)).toBe(false);
    });
  });
});

describe('品牌类型 - 类型转换', () => {
  describe('asMoney', () => {
    it('应该转换有效金额', () => {
      const money = asMoney(100);
      expect(money).toBe(100);
    });

    it('应该对无效金额抛出错误', () => {
      expect(() => asMoney(-100)).toThrow('Invalid money value');
    });
  });

  describe('asPositiveInteger', () => {
    it('应该转换有效正整数', () => {
      const num = asPositiveInteger(42);
      expect(num).toBe(42);
    });

    it('应该对无效值抛出错误', () => {
      expect(() => asPositiveInteger(0)).toThrow('Invalid positive integer');
      expect(() => asPositiveInteger(1.5)).toThrow('Invalid positive integer');
    });
  });

  describe('asPercentage', () => {
    it('应该转换有效百分比', () => {
      const pct = asPercentage(50);
      expect(pct).toBe(50);
    });

    it('应该对无效值抛出错误', () => {
      expect(() => asPercentage(101)).toThrow('Invalid percentage');
    });
  });

  describe('asRatio', () => {
    it('应该转换有效比率', () => {
      const ratio = asRatio(0.5);
      expect(ratio).toBe(0.5);
    });

    it('应该对无效值抛出错误', () => {
      expect(() => asRatio(1.5)).toThrow('Invalid ratio');
    });
  });
});

describe('品牌类型 - 安全转换', () => {
  describe('tryAsMoney', () => {
    it('应该返回有效金额', () => {
      expect(tryAsMoney(100)).toBe(100);
    });

    it('应该对无效值返回null', () => {
      expect(tryAsMoney(-100)).toBeNull();
    });
  });

  describe('tryAsPercentage', () => {
    it('应该返回有效百分比', () => {
      expect(tryAsPercentage(50)).toBe(50);
    });

    it('应该对无效值返回null', () => {
      expect(tryAsPercentage(150)).toBeNull();
    });
  });
});

describe('品牌类型 - 数值转换', () => {
  describe('ratioToPercentage', () => {
    it('应该将比率转换为百分比', () => {
      expect(ratioToPercentage(0.5 as any)).toBe(50);
      expect(ratioToPercentage(0.333 as any)).toBeCloseTo(33.3, 1);
      expect(ratioToPercentage(1 as any)).toBe(100);
    });
  });

  describe('percentageToRatio', () => {
    it('应该将百分比转换为比率', () => {
      expect(percentageToRatio(50 as any)).toBe(0.5);
      expect(percentageToRatio(33.3 as any)).toBeCloseTo(0.333, 2);
      expect(percentageToRatio(100 as any)).toBe(1);
    });
  });
});

describe('品牌类型 - 字符串类型守卫', () => {
  describe('isPolicyNumber', () => {
    it('应该接受非空字符串', () => {
      expect(isPolicyNumber('POL123')).toBe(true);
      expect(isPolicyNumber('A')).toBe(true);
    });

    it('应该拒绝空字符串', () => {
      expect(isPolicyNumber('')).toBe(false);
    });
  });

  describe('isOrgCode', () => {
    it('应该接受非空字符串', () => {
      expect(isOrgCode('ORG001')).toBe(true);
    });

    it('应该拒绝空字符串', () => {
      expect(isOrgCode('')).toBe(false);
    });
  });
});

describe('品牌类型 - 日期类型', () => {
  describe('isISODateString', () => {
    it('应该接受有效ISO日期', () => {
      expect(isISODateString('2024-01-15')).toBe(true);
      expect(isISODateString('2026-12-31')).toBe(true);
    });

    it('应该拒绝无效格式', () => {
      expect(isISODateString('2024/01/15')).toBe(false);
      expect(isISODateString('01-15-2024')).toBe(false);
      expect(isISODateString('2024-1-5')).toBe(false);
    });

    it('应该拒绝无效日期', () => {
      expect(isISODateString('2024-13-01')).toBe(false);
      expect(isISODateString('2024-02-30')).toBe(false);
    });
  });

  describe('asISODateString', () => {
    it('应该转换有效日期', () => {
      const date = asISODateString('2024-01-15');
      expect(date).toBe('2024-01-15');
    });

    it('应该对无效日期抛出错误', () => {
      expect(() => asISODateString('invalid')).toThrow('Invalid ISO date string');
    });
  });

  describe('dateToISOString', () => {
    it('应该将Date转换为ISO字符串', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const isoStr = dateToISOString(date);
      expect(isoStr).toBe('2024-01-15');
    });
  });
});
