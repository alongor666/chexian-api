/**
 * aiSql/sqlValidator 单元测试
 */

import { describe, it, expect } from 'vitest';

import { quickSyntaxCheck } from '../sqlValidator';

describe('quickSyntaxCheck', () => {
  describe('基础验证', () => {
    it('should reject empty SQL', () => {
      const result = quickSyntaxCheck('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('SQL 为空');
    });

    it('should reject whitespace-only SQL', () => {
      const result = quickSyntaxCheck('   \n\t  ');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('SQL 为空');
    });

    it('should reject non-SELECT statements', () => {
      const result = quickSyntaxCheck('WITH cte AS (SELECT 1)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('SELECT 开头');
    });

    it('should accept valid SELECT statement', () => {
      const result = quickSyntaxCheck('SELECT * FROM PolicyFact');
      expect(result.valid).toBe(true);
    });

    it('should be case-insensitive for SELECT', () => {
      const result = quickSyntaxCheck('select * from PolicyFact');
      expect(result.valid).toBe(true);
    });
  });

  describe('危险操作拦截', () => {
    it('should reject DROP statements', () => {
      const result = quickSyntaxCheck('SELECT 1; DROP TABLE PolicyFact');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DROP');
    });

    it('should reject DELETE statements', () => {
      const result = quickSyntaxCheck('SELECT 1 FROM PolicyFact WHERE 1=0; DELETE FROM PolicyFact');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('DELETE');
    });

    it('should reject INSERT statements', () => {
      const result = quickSyntaxCheck('SELECT 1; INSERT INTO PolicyFact VALUES (1)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('INSERT');
    });

    it('should reject UPDATE statements', () => {
      const result = quickSyntaxCheck('SELECT 1; UPDATE PolicyFact SET premium=0');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('UPDATE');
    });

    it('should reject TRUNCATE statements', () => {
      const result = quickSyntaxCheck('SELECT 1; TRUNCATE TABLE PolicyFact');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('TRUNCATE');
    });

    it('should reject ALTER statements', () => {
      const result = quickSyntaxCheck('SELECT 1; ALTER TABLE PolicyFact ADD COLUMN x');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('ALTER');
    });

    it('should reject CREATE statements', () => {
      const result = quickSyntaxCheck('SELECT 1; CREATE TABLE evil (x INT)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('CREATE');
    });

    it('should not false-positive on substrings', () => {
      // "created_at" contains "create" but should not trigger
      const result = quickSyntaxCheck('SELECT created_at FROM PolicyFact');
      expect(result.valid).toBe(true);
    });
  });

  describe('PolicyFact 表验证', () => {
    it('should require FROM PolicyFact', () => {
      const result = quickSyntaxCheck('SELECT 1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('PolicyFact');
    });

    it('should accept PolicyFact in different cases', () => {
      const result = quickSyntaxCheck('SELECT * FROM policyfact');
      expect(result.valid).toBe(true);
    });

    it('should accept PolicyFact with alias', () => {
      const result = quickSyntaxCheck('SELECT p.premium FROM PolicyFact p');
      expect(result.valid).toBe(true);
    });
  });

  describe('复杂查询', () => {
    it('should accept subqueries', () => {
      const sql = `SELECT org_level_3, (SELECT COUNT(*) FROM PolicyFact) as total
FROM PolicyFact
GROUP BY org_level_3`;
      const result = quickSyntaxCheck(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept JOIN queries', () => {
      const sql = `SELECT a.org_level_3, SUM(a.premium)
FROM PolicyFact a
LEFT JOIN PolicyFact b ON a.org_level_3 = b.org_level_3
GROUP BY a.org_level_3`;
      const result = quickSyntaxCheck(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept window functions', () => {
      const sql = `SELECT org_level_3, premium,
  ROW_NUMBER() OVER (PARTITION BY org_level_3 ORDER BY premium DESC)
FROM PolicyFact`;
      const result = quickSyntaxCheck(sql);
      expect(result.valid).toBe(true);
    });
  });
});
