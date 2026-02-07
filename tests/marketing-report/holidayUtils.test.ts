/**
 * 节假日工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  isHoliday,
  getHolidayName,
  getHolidaysInRange,
  countHolidaysInRange,
  getHolidayDatesInRange,
  getHolidaysGroupedByName,
  generateHolidayValuesSql,
  getHolidaySummary,
  HOLIDAYS_2026,
} from '../../src/features/marketing-report/utils/holidayUtils';

describe('holidayUtils', () => {
  describe('isHoliday', () => {
    it('should return true for holiday dates', () => {
      expect(isHoliday('2026-01-01')).toBe(true); // 元旦
      expect(isHoliday('2026-01-28')).toBe(true); // 春节
      expect(isHoliday('2026-05-01')).toBe(true); // 劳动节
      expect(isHoliday('2026-10-01')).toBe(true); // 国庆节
    });

    it('should return false for non-holiday dates', () => {
      expect(isHoliday('2026-01-02')).toBe(false); // 周五
      expect(isHoliday('2026-03-16')).toBe(false); // 周一（3/15是周日）
      expect(isHoliday('2026-07-01')).toBe(false); // 周三
    });
  });

  describe('getHolidayName', () => {
    it('should return holiday name for holiday dates', () => {
      expect(getHolidayName('2026-01-01')).toBe('元旦');
      expect(getHolidayName('2026-01-28')).toBe('春节');
      expect(getHolidayName('2026-05-01')).toBe('劳动节');
    });

    it('should return null for non-holiday dates', () => {
      expect(getHolidayName('2026-01-02')).toBeNull();
    });
  });

  describe('getHolidaysInRange', () => {
    it('should return holidays within date range', () => {
      const holidays = getHolidaysInRange('2026-01-01', '2026-01-31');
      // 元旦 1天 + 春节 4天（1月28-31日）+ 周末（1月共9个周末日：3,4,10,11,17,18,24,25,31）
      // 其中1/31是周六，已算在春节里，所以周末额外贡献8天
      // 总计：1 + 4 + 8 = 13天
      expect(holidays.length).toBe(13);
    });

    it('should return only weekends when no legal holidays in range', () => {
      const holidays = getHolidaysInRange('2026-03-01', '2026-03-31');
      // 3月周末：1,7,8,14,15,21,22,28,29共9天（3/1是周日）
      expect(holidays.length).toBe(9);
    });
  });

  describe('countHolidaysInRange', () => {
    it('should count holidays correctly', () => {
      // 元旦
      expect(countHolidaysInRange('2026-01-01', '2026-01-01')).toBe(1);
      // 春节 7天
      expect(countHolidaysInRange('2026-01-28', '2026-02-03')).toBe(7);
      // 国庆节 7天
      expect(countHolidaysInRange('2026-10-01', '2026-10-07')).toBe(7);
    });

    it('should count weekends when no legal holidays', () => {
      // 3月周末：1,7,8,14,15,21,22,28,29共9天（3/1是周日）
      expect(countHolidaysInRange('2026-03-01', '2026-03-31')).toBe(9);
    });
  });

  describe('getHolidayDatesInRange', () => {
    it('should return date strings', () => {
      const dates = getHolidayDatesInRange('2026-01-01', '2026-01-01');
      expect(dates).toEqual(['2026-01-01']);
    });
  });

  describe('getHolidaysGroupedByName', () => {
    it('should group holidays by name', () => {
      const grouped = getHolidaysGroupedByName('2026-01-28', '2026-02-03');
      expect(grouped['春节']).toBeDefined();
      expect(grouped['春节'].length).toBe(7);
    });
  });

  describe('generateHolidayValuesSql', () => {
    it('should generate SQL VALUES clause', () => {
      const sql = generateHolidayValuesSql('2026-01-01', '2026-01-01');
      expect(sql).toBe("('2026-01-01')");
    });

    it('should generate multiple values', () => {
      const sql = generateHolidayValuesSql('2026-01-28', '2026-01-30');
      expect(sql).toContain('2026-01-28');
      expect(sql).toContain('2026-01-29');
      expect(sql).toContain('2026-01-30');
    });

    it('should handle no holidays case', () => {
      // 3月2日是周一，不是假日也不是周末
      const sql = generateHolidayValuesSql('2026-03-02', '2026-03-02');
      expect(sql).toBe("('1900-01-01')");
    });
  });

  describe('getHolidaySummary', () => {
    it('should return summary with correct format', () => {
      const summary = getHolidaySummary('2026-01-01', '2026-01-31');
      expect(summary.length).toBeGreaterThan(0);

      const yuandan = summary.find(s => s.name === '元旦');
      expect(yuandan).toBeDefined();
      expect(yuandan?.days).toBe(1);
    });
  });

  describe('HOLIDAYS_2026', () => {
    it('should contain all major holidays', () => {
      const holidayNames = new Set(HOLIDAYS_2026.map(h => h.name));
      expect(holidayNames.has('元旦')).toBe(true);
      expect(holidayNames.has('春节')).toBe(true);
      expect(holidayNames.has('清明节')).toBe(true);
      expect(holidayNames.has('劳动节')).toBe(true);
      expect(holidayNames.has('端午节')).toBe(true);
      expect(holidayNames.has('中秋节')).toBe(true);
      expect(holidayNames.has('国庆节')).toBe(true);
    });

    it('should contain weekends', () => {
      const holidayNames = new Set(HOLIDAYS_2026.map(h => h.name));
      expect(holidayNames.has('周六')).toBe(true);
      expect(holidayNames.has('周日')).toBe(true);
    });

    it('should have correct number of holiday days', () => {
      // 法定节假日29天 + 周末104天 - 重叠天数
      // 2026年周末与法定假日重叠的日期：
      // - 元旦1/1是周四，不重叠
      // - 春节1/28周三-2/3周二，1/31周六、2/1周日重叠2天
      // - 清明4/4周六-4/6周一，4/4周六、4/5周日重叠2天
      // - 劳动节5/1周五-5/5周二，5/2周六、5/3周日重叠2天
      // - 端午5/31周日-6/2周二，5/31周日重叠1天
      // - 中秋9/27周日-9/29周二，9/27周日重叠1天
      // - 国庆10/1周四-10/7周三，10/3周六、10/4周日重叠2天
      // 总重叠：2+2+2+1+1+2=10天
      // 总计：29 + 104 - 10 = 123天
      expect(HOLIDAYS_2026.length).toBe(123);
    });
  });
});
