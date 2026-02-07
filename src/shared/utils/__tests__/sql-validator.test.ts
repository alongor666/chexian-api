/**
 * SQL 验证器单元测试
 */

import { describe, it, expect } from 'vitest';
import { validateSQL } from '../sql-validator';

describe('sql-validator', () => {
  describe('隐私字段保护', () => {
    it('应该禁止直接查询 policy_no 字段', () => {
      const sql = 'SELECT policy_no, premium FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('禁止查询保单明细字段 policy_no');
    });

    it('应该允许在 COUNT 函数内使用 policy_no', () => {
      const sql = 'SELECT COUNT(policy_no) AS cnt FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('应该允许在 COUNT DISTINCT 函数内使用 policy_no', () => {
      const sql = 'SELECT COUNT(DISTINCT policy_no) AS "保单件数" FROM PolicyFact';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('应该允许在带维度的 GROUP BY 查询中使用 COUNT(DISTINCT policy_no)', () => {
      const sql = `
        SELECT org_level_3,
               SUM(premium) AS "总保费",
               COUNT(DISTINCT policy_no) AS "件数"
        FROM PolicyFact
        GROUP BY org_level_3
        ORDER BY "总保费" DESC
        LIMIT 100
      `;
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });

    it('应该禁止在非聚合场景中使用 policy_no（即使带 GROUP BY）', () => {
      const sql = 'SELECT org_level_3, policy_no FROM PolicyFact GROUP BY org_level_3, policy_no';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('禁止查询保单明细字段 policy_no');
    });
  });

  describe('聚合要求', () => {
    it('应该要求包含聚合函数或 GROUP BY', () => {
      const sql = 'SELECT premium FROM PolicyFact LIMIT 10';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('必须包含聚合函数');
    });

    it('应该允许有 GROUP BY 的查询', () => {
      const sql = 'SELECT org_level_3, SUM(premium) FROM PolicyFact GROUP BY org_level_3';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });
  });

  describe('访问边界', () => {
    it('应该要求使用 PolicyFact 视图', () => {
      const sql = 'SELECT COUNT(*) FROM other_table';
      const result = validateSQL(sql);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('PolicyFact');
    });

    it('应该允许使用 PolicyFactRenewal 视图', () => {
      const sql = 'SELECT COUNT(*) FROM PolicyFactRenewal';
      const result = validateSQL(sql);
      expect(result.valid).toBe(true);
    });
  });
});
