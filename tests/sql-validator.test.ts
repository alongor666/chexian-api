/**
 * SQL 验证器单元测试
 *
 * 测试覆盖:
 * 1. 只读限制 (禁止 DDL/DML)
 * 2. 单语句限制 (禁止多语句)
 * 3. PolicyFact 边界 (必须引用, 禁止 raw_parquet)
 * 4. 隐私保护 (禁止 policy_no 明细)
 * 5. 聚合要求 (必须包含聚合或 GROUP BY)
 */

import { describe, it, expect } from 'vitest';
import {
  validateSQL,
  isReadOnlyQuery,
  hasAggregation,
  MAX_SQL_LENGTH,
} from '../src/shared/utils/sql-validator';

describe('SQL Validator', () => {
  describe('validateSQL - Basic Constraints', () => {
    it('should reject empty SQL', () => {
      const result = validateSQL('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('不能为空');
    });

    it('should reject SQL exceeding max length', () => {
      const longSQL = 'SELECT COUNT(*) FROM PolicyFact WHERE '.concat('a'.repeat(MAX_SQL_LENGTH));
      const result = validateSQL(longSQL);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('长度超过限制');
    });

    it('should reject multiple statements separated by semicolon', () => {
      const sql = 'SELECT COUNT(*) FROM PolicyFact; DROP TABLE PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('多语句');
    });

    it('should allow single statement with trailing semicolon', () => {
      const sql = 'SELECT COUNT(*) FROM PolicyFact;';
      const result = validateSQL(sql);
      // This has COUNT aggregation, so it should pass
      expect(result.valid).toBe(true);
    });
  });

  describe('validateSQL - Read-Only Constraints', () => {
    it('should reject non-SELECT/WITH statements', () => {
      const invalidStarts = [
        'INSERT INTO PolicyFact VALUES (1, 2, 3)',
        'UPDATE PolicyFact SET premium = 0',
        'DELETE FROM PolicyFact',
        'CREATE TABLE test (id INT)',
        'DROP TABLE PolicyFact',
      ];

      invalidStarts.forEach((sql) => {
        const result = validateSQL(sql);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/只允许 SELECT 或 WITH/);
      });
    });

    it('should accept valid SELECT statements', () => {
      const sql = 'SELECT COUNT(*) as total FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept valid WITH (CTE) statements', () => {
      const sql =
        'WITH summary AS (SELECT salesman_name, SUM(premium) as total FROM PolicyFact GROUP BY salesman_name) SELECT * FROM summary';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should reject DDL keywords', () => {
      const ddlKeywords = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE'];

      ddlKeywords.forEach((keyword) => {
        const sql = `SELECT COUNT(*) FROM PolicyFact WHERE name = '${keyword}'`;
        // This should pass (keyword in string literal)
        // But if keyword appears as statement, it should fail
        const badSQL = `${keyword} TABLE test`;
        const result = validateSQL(badSQL);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/只允许 SELECT 或 WITH/);
      });
    });

    it('should reject DML keywords', () => {
      const dmlKeywords = ['INSERT', 'UPDATE', 'DELETE'];

      dmlKeywords.forEach((keyword) => {
        const badSQL = `SELECT COUNT(*) FROM PolicyFact; ${keyword} INTO test VALUES (1)`;
        const result = validateSQL(badSQL);
        expect(result.valid).toBe(false);
        // Should fail on multiple statements first
        expect(result.error).toMatch(/多语句/);
      });
    });

    it('should reject file operation functions', () => {
      const fileFunctions = ['read_parquet', 'read_csv', 'write_parquet', 'copy_to'];

      fileFunctions.forEach((func) => {
        const sql = `SELECT COUNT(*) FROM ${func}('test.parquet')`;
        const result = validateSQL(sql);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('文件操作函数');
      });
    });

    it('should reject system-level keywords', () => {
      const systemKeywords = ['PRAGMA', 'SET', 'CALL'];

      systemKeywords.forEach((keyword) => {
        const sql = `${keyword} schema = 'test'`;
        const result = validateSQL(sql);
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('validateSQL - Access Boundary', () => {
    it('should reject SQL without PolicyFact reference', () => {
      const sql = 'SELECT COUNT(*) FROM some_other_table';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('PolicyFact');
    });

    it('should reject SQL accessing raw_parquet', () => {
      // Include PolicyFact to pass first boundary check, then fail on raw_parquet
      const sql = 'SELECT COUNT(*) FROM PolicyFact JOIN raw_parquet ON PolicyFact.id = raw_parquet.id';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('raw_parquet');
    });

    it('should accept SQL with PolicyFact reference', () => {
      const sql = 'SELECT COUNT(*) FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should be case-insensitive for PolicyFact', () => {
      const variants = ['policyfact', 'PolicyFact', 'POLICYFACT', 'pOlIcYfAcT'];

      variants.forEach((variant) => {
        const sql = `SELECT COUNT(*) FROM ${variant}`;
        const result = validateSQL(sql);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('validateSQL - Privacy Protection', () => {
    it('should reject SQL selecting raw policy_no field', () => {
      const invalidSQLs = [
        'SELECT policy_no FROM PolicyFact GROUP BY policy_no',
        'SELECT *, policy_no FROM PolicyFact GROUP BY policy_no',
        'SELECT salesman_name, policy_no FROM PolicyFact GROUP BY salesman_name, policy_no',
      ];

      invalidSQLs.forEach((sql) => {
        const result = validateSQL(sql);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('policy_no');
      });
    });

    it('should reject mixed raw and aggregated policy_no (privacy regression test)', () => {
      // This is the key test: even with COUNT(policy_no), raw policy_no should be rejected
      const sql = 'SELECT policy_no, COUNT(policy_no) FROM PolicyFact GROUP BY policy_no';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('policy_no');
    });

    it('should reject GROUP BY policy_no', () => {
      const sql = 'SELECT salesman_name, COUNT(*) FROM PolicyFact GROUP BY salesman_name, policy_no';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('policy_no');
      expect(result.error).toContain('分组');
    });

    it('should reject ORDER BY policy_no', () => {
      const sql = 'SELECT salesman_name, COUNT(*) FROM PolicyFact GROUP BY salesman_name ORDER BY policy_no';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('policy_no');
      expect(result.error).toContain('排序');
    });

    it('should allow policy_no ONLY inside aggregate functions', () => {
      const validSQLs = [
        'SELECT COUNT(policy_no) FROM PolicyFact',
        'SELECT COUNT(DISTINCT policy_no) FROM PolicyFact',
        'SELECT COUNT(DISTINCT policy_no) as cnt, SUM(premium) FROM PolicyFact',
        'SELECT salesman_name, COUNT(DISTINCT policy_no) FROM PolicyFact GROUP BY salesman_name',
      ];

      validSQLs.forEach((sql) => {
        const result = validateSQL(sql);
        expect(result.valid).toBe(true);
      });
    });

    it('should allow policy_no in WHERE clause but not in SELECT', () => {
      // WHERE is fine, SELECT is not
      const sqlWithWhere = "SELECT COUNT(*) FROM PolicyFact WHERE policy_no = '123'";
      const result = validateSQL(sqlWithWhere);
      expect(result.valid).toBe(true);
    });

    it('should allow policy_no in CASE inside aggregate', () => {
      const sql = `
        SELECT
          COUNT(CASE WHEN policy_no IS NOT NULL THEN policy_no END) as valid_count
        FROM PolicyFact
      `;
      const result = validateSQL(sql);
      // This is tricky - the CASE is inside COUNT, so it should be allowed
      expect(result.valid).toBe(true);
    });
  });

  describe('validateSQL - Aggregation Requirement', () => {
    it('should reject SQL without aggregation or GROUP BY', () => {
      const sql = 'SELECT salesman_name FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('聚合');
    });

    it('should accept SQL with COUNT', () => {
      const sql = 'SELECT COUNT(*) FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept SQL with SUM', () => {
      const sql = 'SELECT SUM(premium) FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept SQL with GROUP BY', () => {
      const sql = 'SELECT salesman_name, SUM(premium) FROM PolicyFact GROUP BY salesman_name';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept SQL with AVG, MIN, MAX', () => {
      const functions = ['AVG', 'MIN', 'MAX'];

      functions.forEach((func) => {
        const sql = `SELECT ${func}(premium) FROM PolicyFact`;
        const result = validateSQL(sql);
        expect(result.valid).toBe(true);
      });
    });

    it('should accept SQL with multiple aggregation functions', () => {
      const sql = 'SELECT COUNT(*), SUM(premium), AVG(premium) FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });
  });

  describe('isReadOnlyQuery', () => {
    it('should return true for SELECT statements', () => {
      expect(isReadOnlyQuery('SELECT * FROM PolicyFact')).toBe(true);
      expect(isReadOnlyQuery('select count(*) from policyfact')).toBe(true);
    });

    it('should return true for WITH statements', () => {
      expect(
        isReadOnlyQuery('WITH cte AS (SELECT * FROM PolicyFact) SELECT * FROM cte')
      ).toBe(true);
    });

    it('should return false for write operations', () => {
      expect(isReadOnlyQuery('INSERT INTO PolicyFact VALUES (1, 2)')).toBe(false);
      expect(isReadOnlyQuery('UPDATE PolicyFact SET premium = 0')).toBe(false);
      expect(isReadOnlyQuery('DELETE FROM PolicyFact')).toBe(false);
      expect(isReadOnlyQuery('CREATE TABLE test (id INT)')).toBe(false);
      expect(isReadOnlyQuery('DROP TABLE PolicyFact')).toBe(false);
    });

    it('should return false for statements with embedded write keywords', () => {
      // Even if starts with SELECT, contains forbidden keywords
      expect(isReadOnlyQuery('SELECT * FROM PolicyFact; DROP TABLE test')).toBe(false);
    });
  });

  describe('hasAggregation', () => {
    it('should return true for SQL with GROUP BY', () => {
      expect(hasAggregation('SELECT salesman_name FROM PolicyFact GROUP BY salesman_name')).toBe(
        true
      );
    });

    it('should return true for SQL with aggregate functions', () => {
      expect(hasAggregation('SELECT COUNT(*) FROM PolicyFact')).toBe(true);
      expect(hasAggregation('SELECT SUM(premium) FROM PolicyFact')).toBe(true);
      expect(hasAggregation('SELECT AVG(premium) FROM PolicyFact')).toBe(true);
      expect(hasAggregation('SELECT MIN(premium), MAX(premium) FROM PolicyFact')).toBe(true);
    });

    it('should return false for SQL without aggregation', () => {
      expect(hasAggregation('SELECT salesman_name FROM PolicyFact')).toBe(false);
      expect(hasAggregation('SELECT * FROM PolicyFact')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(hasAggregation('select count(*) from policyfact')).toBe(true);
      expect(hasAggregation('SELECT salesman_name FROM PolicyFact group by salesman_name')).toBe(
        true
      );
    });
  });

  describe('validateSQL - Real-World Valid Queries', () => {
    it('should accept KPI aggregation query with COUNT DISTINCT policy_no', () => {
      const sql = `
        SELECT
          COUNT(DISTINCT policy_no) as policy_count,
          SUM(premium) as total_premium,
          AVG(premium) as avg_premium
        FROM PolicyFact
      `;
      const result = validateSQL(sql);
      // COUNT(DISTINCT policy_no) is allowed - it's aggregated, not raw detail
      expect(result.valid).toBe(true);
    });

    it('should accept salesman performance query', () => {
      const sql = `
        SELECT
          salesman_name,
          COUNT(*) as policy_count,
          SUM(premium) as total_premium
        FROM PolicyFact
        GROUP BY salesman_name
        ORDER BY total_premium DESC
        LIMIT 10
      `;
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept customer category analysis', () => {
      const sql = `
        SELECT
          customer_category,
          COUNT(*) as count,
          SUM(premium) as premium,
          ROUND(SUM(premium) * 100.0 / (SELECT SUM(premium) FROM PolicyFact), 2) as percentage
        FROM PolicyFact
        GROUP BY customer_category
      `;
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept daily premium trend query', () => {
      const sql = `
        SELECT
          CAST(policy_date AS DATE) as date,
          SUM(premium) as daily_premium,
          COUNT(*) as daily_count
        FROM PolicyFact
        GROUP BY CAST(policy_date AS DATE)
        ORDER BY date
      `;
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept CTE with aggregation', () => {
      const sql = `
        WITH monthly_summary AS (
          SELECT
            DATE_TRUNC('month', policy_date) as month,
            SUM(premium) as monthly_premium
          FROM PolicyFact
          GROUP BY DATE_TRUNC('month', policy_date)
        )
        SELECT
          month,
          monthly_premium,
          LAG(monthly_premium) OVER (ORDER BY month) as prev_month
        FROM monthly_summary
      `;
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });
  });
});
