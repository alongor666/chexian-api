/**
 * DataSource 数据源切换测试
 */
import { describe, it, expect } from 'vitest';

describe('DataSource 数据源切换', () => {
  describe('parseWhereClause 与 API 参数转换', () => {
    it('应正确转换 WHERE clause 为 API 参数', async () => {
      const { parseWhereClause } = await import('../../src/shared/utils/sql-parser');

      const whereClause = "policy_date >= '2026-01-01' AND policy_date <= '2026-06-30' AND org_level_3 = '乐山'";
      const params = parseWhereClause(whereClause);

      expect(params.startDate).toBe('2026-01-01');
      expect(params.endDate).toBe('2026-06-30');
      expect(params.orgName).toBe('乐山');
    });

    it('应处理多机构 IN 子句', async () => {
      const { parseWhereClause } = await import('../../src/shared/utils/sql-parser');

      const whereClause = "org_level_3 IN ('成都', '乐山', '绵阳')";
      const params = parseWhereClause(whereClause);

      expect(params.orgNames).toEqual(['成都', '乐山', '绵阳']);
    });

    it('应处理布尔筛选条件', async () => {
      const { parseWhereClause } = await import('../../src/shared/utils/sql-parser');

      const whereClause = 'is_renewal = true AND is_nev = false';
      const params = parseWhereClause(whereClause);

      expect(params.isRenewal).toBe(true);
      expect(params.isNev).toBe(false);
    });
  });

  describe('buildQueryParams 从筛选器状态构建', () => {
    it('应从筛选器状态构建正确的参数', async () => {
      const { buildQueryParams } = await import('../../src/shared/utils/sql-parser');

      const filters = {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        orgLevel3: ['成都'],
        isRenewal: true,
        dateField: 'policy_date' as const,
      };

      const params = buildQueryParams(filters);

      expect(params.startDate).toBe('2026-01-01');
      expect(params.endDate).toBe('2026-12-31');
      expect(params.orgName).toBe('成都'); // 单机构转为 orgName
      expect(params.isRenewal).toBe(true);
      expect(params.dateField).toBe('policy_date');
    });

    it('应处理多机构筛选', async () => {
      const { buildQueryParams } = await import('../../src/shared/utils/sql-parser');

      const filters = {
        orgLevel3: ['成都', '乐山'],
      };

      const params = buildQueryParams(filters);

      expect(params.orgNames).toEqual(['成都', '乐山']);
      expect(params.orgName).toBeUndefined();
    });
  });

  describe('paramsToQueryString URL 参数转换', () => {
    it('应正确转换为 URL 参数格式', async () => {
      const { paramsToQueryString } = await import('../../src/shared/utils/sql-parser');

      const params = {
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        orgName: '成都',
        isRenewal: true,
      };

      const queryParams = paramsToQueryString(params);

      expect(queryParams.startDate).toBe('2026-01-01');
      expect(queryParams.endDate).toBe('2026-12-31');
      expect(queryParams.orgName).toBe('成都');
      expect(queryParams.isRenewal).toBe('true'); // 布尔值转字符串
    });

    it('应正确处理数组参数', async () => {
      const { paramsToQueryString } = await import('../../src/shared/utils/sql-parser');

      const params = {
        orgNames: ['成都', '乐山', '绵阳'],
      };

      const queryParams = paramsToQueryString(params);

      expect(queryParams.orgNames).toBe('成都,乐山,绵阳');
    });
  });
});
