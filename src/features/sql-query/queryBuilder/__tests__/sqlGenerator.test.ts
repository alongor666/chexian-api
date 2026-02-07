/**
 * SQL 生成器单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  generateSqlFromBuilder,
  validateQueryBuilderState,
  generateDistinctValuesSql,
  generateCountPreviewSql,
} from '../sqlGenerator';
import type { QueryBuilderState } from '../types';

describe('sqlGenerator', () => {
  describe('validateQueryBuilderState', () => {
    it('should fail validation when no measures selected', () => {
      const state: QueryBuilderState = {
        dimensions: [{ field: 'org_level_3' }],
        measures: [],
        filters: [],
        orderBy: null,
        limit: 1000,
      };

      const result = validateQueryBuilderState(state);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('请至少选择一个度量字段');
    });

    it('should pass validation with at least one measure', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [],
        orderBy: null,
        limit: 1000,
      };

      const result = validateQueryBuilderState(state);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate measure aliases', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [
          { field: 'premium', aggregate: 'SUM', alias: '保费' },
          { field: 'premium', aggregate: 'AVG', alias: '保费' },
        ],
        filters: [],
        orderBy: null,
        limit: 1000,
      };

      const result = validateQueryBuilderState(state);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('度量别名不能重复');
    });
  });

  describe('generateSqlFromBuilder', () => {
    it('should generate global summary SQL without dimensions', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain('SELECT SUM(premium) AS "总保费"');
      expect(sql).toContain('FROM PolicyFact');
      expect(sql).not.toContain('GROUP BY');
      expect(sql).toContain('ORDER BY "总保费" DESC');
      expect(sql).toContain('LIMIT 1000');
    });

    it('should generate grouped SQL with dimensions', () => {
      const state: QueryBuilderState = {
        dimensions: [{ field: 'org_level_3' }, { field: 'salesman_name' }],
        measures: [
          { field: 'premium', aggregate: 'SUM', alias: '总保费' },
          { field: 'policy_no', aggregate: 'COUNT_DISTINCT', alias: '件数' },
        ],
        filters: [],
        orderBy: null,
        limit: 100,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain('SELECT org_level_3,');
      expect(sql).toContain('salesman_name,');
      expect(sql).toContain('SUM(premium) AS "总保费"');
      expect(sql).toContain('COUNT(DISTINCT policy_no) AS "件数"');
      expect(sql).toContain('GROUP BY org_level_3, salesman_name');
      expect(sql).toContain('LIMIT 100');
    });

    it('should generate SQL with filters', () => {
      const state: QueryBuilderState = {
        dimensions: [{ field: 'org_level_3' }],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          { id: '1', field: 'org_level_3', operator: '=', value: '分公司A' },
          { id: '2', field: 'premium', operator: '>=', value: '1000' },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain("WHERE org_level_3 = '分公司A'");
      expect(sql).toContain('AND premium >= 1000');
    });

    it('should handle IN operator with array values', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          {
            id: '1',
            field: 'org_level_3',
            operator: 'IN',
            value: ['分公司A', '分公司B'],
          },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain("WHERE org_level_3 IN ('分公司A', '分公司B')");
    });

    it('should handle LIKE operator', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          { id: '1', field: 'salesman_name', operator: 'LIKE', value: '张' },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain("WHERE salesman_name LIKE '%张%'");
    });

    it('should handle IS NULL operator', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          { id: '1', field: 'tonnage_segment', operator: 'IS NULL', value: null },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain('WHERE tonnage_segment IS NULL');
    });

    it('should handle BETWEEN operator', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          {
            id: '1',
            field: 'policy_date',
            operator: 'BETWEEN',
            value: '2026-01-01',
            value2: '2026-01-31',
          },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain("WHERE policy_date BETWEEN '2026-01-01' AND '2026-01-31'");
    });

    it('should handle custom order by', () => {
      const state: QueryBuilderState = {
        dimensions: [{ field: 'org_level_3' }],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [],
        orderBy: { field: 'org_level_3', direction: 'ASC' },
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain('ORDER BY "org_level_3" ASC');
    });

    it('should escape single quotes in string values', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          { id: '1', field: 'salesman_name', operator: '=', value: "张'三" },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain("WHERE salesman_name = '张''三'");
    });

    it('should handle boolean filters', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [
          { id: '1', field: 'is_renewal', operator: '=', value: 'true' },
        ],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateSqlFromBuilder(state);
      expect(sql).toContain('WHERE is_renewal = TRUE');
    });
  });

  describe('generateDistinctValuesSql', () => {
    it('should generate distinct values SQL', () => {
      const sql = generateDistinctValuesSql('org_level_3', 50);
      expect(sql).toContain('SELECT DISTINCT org_level_3');
      expect(sql).toContain('FROM PolicyFact');
      expect(sql).toContain('WHERE org_level_3 IS NOT NULL');
      expect(sql).toContain('ORDER BY org_level_3');
      expect(sql).toContain('LIMIT 50');
    });
  });

  describe('generateCountPreviewSql', () => {
    it('should generate count SQL with dimensions', () => {
      const state: QueryBuilderState = {
        dimensions: [{ field: 'org_level_3' }],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateCountPreviewSql(state);
      expect(sql).toContain('SELECT COUNT(*) as group_count');
      expect(sql).toContain('GROUP BY org_level_3');
    });

    it('should generate simple count SQL without dimensions', () => {
      const state: QueryBuilderState = {
        dimensions: [],
        measures: [{ field: 'premium', aggregate: 'SUM', alias: '总保费' }],
        filters: [],
        orderBy: null,
        limit: 1000,
      };

      const sql = generateCountPreviewSql(state);
      expect(sql).toContain('SELECT COUNT(*) as row_count FROM PolicyFact');
    });
  });
});
