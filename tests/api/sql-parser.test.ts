/**
 * SQL Parser 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  parseWhereClause,
  paramsToQueryString,
  buildQueryParams,
  mergeQueryParams,
} from '../../src/shared/utils/sql-parser';

describe('SQL Parser', () => {
  describe('parseWhereClause', () => {
    it('应解析空条件', () => {
      expect(parseWhereClause('')).toEqual({});
      expect(parseWhereClause('1=1')).toEqual({});
    });

    it('应解析日期范围条件', () => {
      const result = parseWhereClause(
        "policy_date >= '2026-01-01' AND policy_date <= '2026-12-31'"
      );
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-12-31');
      expect(result.dateField).toBe('policy_date');
    });

    it('应解析 BETWEEN 条件', () => {
      const result = parseWhereClause(
        "policy_date BETWEEN '2026-01-01' AND '2026-03-31'"
      );
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-03-31');
    });

    it('应解析单值机构条件', () => {
      const result = parseWhereClause("org_level_3 = '成都'");
      expect(result.orgName).toBe('成都');
    });

    it('应解析多值机构条件', () => {
      const result = parseWhereClause("org_level_3 IN ('成都', '乐山', '绵阳')");
      expect(result.orgNames).toEqual(['成都', '乐山', '绵阳']);
    });

    it('应解析业务员条件', () => {
      const result = parseWhereClause("salesman_name = '张三'");
      expect(result.salesmanName).toBe('张三');
    });

    it('应解析布尔条件', () => {
      const result = parseWhereClause(
        'is_renewal = true AND is_nev = false AND is_new_car = 1'
      );
      expect(result.isRenewal).toBe(true);
      expect(result.isNev).toBe(false);
      expect(result.isNewCar).toBe(true);
    });

    it('应解析复杂组合条件', () => {
      const result = parseWhereClause(
        "policy_date >= '2026-01-01' AND policy_date <= '2026-06-30' AND org_level_3 = '乐山' AND is_renewal = true"
      );
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-06-30');
      expect(result.orgName).toBe('乐山');
      expect(result.isRenewal).toBe(true);
    });
  });

  describe('paramsToQueryString', () => {
    it('应转换参数为查询字符串对象', () => {
      const result = paramsToQueryString({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        orgName: '成都',
        isRenewal: true,
      });
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-12-31');
      expect(result.orgName).toBe('成都');
      expect(result.isRenewal).toBe('true');
    });

    it('应处理多值数组', () => {
      const result = paramsToQueryString({
        orgNames: ['成都', '乐山'],
      });
      expect(result.orgNames).toBe('成都,乐山');
    });
  });

  describe('buildQueryParams', () => {
    it('应从筛选器状态构建查询参数', () => {
      const result = buildQueryParams({
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        orgLevel3: ['成都'],
        isRenewal: true,
      });
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-06-30');
      expect(result.orgName).toBe('成都');
      expect(result.isRenewal).toBe(true);
    });

    it('应处理多个机构', () => {
      const result = buildQueryParams({
        orgLevel3: ['成都', '乐山', '绵阳'],
      });
      expect(result.orgNames).toEqual(['成都', '乐山', '绵阳']);
      expect(result.orgName).toBeUndefined();
    });
  });

  describe('mergeQueryParams', () => {
    it('应合并多个参数对象', () => {
      const result = mergeQueryParams(
        { startDate: '2026-01-01', orgName: '成都' },
        { endDate: '2026-12-31' },
        { isRenewal: true }
      );
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-12-31');
      expect(result.orgName).toBe('成都');
      expect(result.isRenewal).toBe(true);
    });

    it('后者应覆盖前者', () => {
      const result = mergeQueryParams(
        { orgName: '成都' },
        { orgName: '乐山' }
      );
      expect(result.orgName).toBe('乐山');
    });

    it('应忽略 undefined 参数', () => {
      const result = mergeQueryParams(
        { startDate: '2026-01-01' },
        undefined,
        { endDate: '2026-12-31' }
      );
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-12-31');
    });
  });
});
