/**
 * 上下文构建器测试
 */

import { describe, it, expect } from 'vitest';
import { buildRenewalContext, generateCacheKey, formatContextForAI } from '../context-builder';

describe('context-builder', () => {
  const mockKpiData = {
    dueCount: 1000,
    renewedCount: 750,
    quotedCount: 850,
    duePremium: 5000000,
    renewedPremium: 3750000,
    quotedPremium: 4250000,
    renewalRate: 0.75,
    quoteRate: 0.85,
    conversionRate: 0.882,
  };

  const mockTop20Data = [
    {
      groupName: '张三',
      parentName: '成都分公司',
      levelType: 'salesman',
      dueCount: 100,
      renewedCount: 80,
      quotedCount: 90,
      duePremium: 500000,
      renewedPremium: 400000,
      quotedPremium: 450000,
      renewalRate: 0.8,
      quoteRate: 0.9,
      renewalPremiumRate: 0.8,
      quotePremiumRate: 0.9,
      rankAsc: 1,
      rankDesc: 20,
    },
    {
      groupName: '李四',
      parentName: '重庆分公司',
      levelType: 'salesman',
      dueCount: 90,
      renewedCount: 60,
      quotedCount: 75,
      duePremium: 450000,
      renewedPremium: 300000,
      quotedPremium: 375000,
      renewalRate: 0.667,
      quoteRate: 0.833,
      renewalPremiumRate: 0.667,
      quotePremiumRate: 0.833,
      rankAsc: 2,
      rankDesc: 19,
    },
  ];

  describe('buildRenewalContext', () => {
    it('should build context with all data', () => {
      const context = buildRenewalContext(mockKpiData, mockTop20Data, {
        bundleOnly: true,
        selfRenewalOnly: false,
        dueMonth: 3,
      });

      expect(context.type).toBe('renewal');
      expect(context.kpi.dueCount).toBe(1000);
      expect(context.kpi.renewalRate).toBe(0.75);
      expect(context.top20Salesmen).toHaveLength(2);
      expect(context.top20Salesmen[0].name).toBe('张三');
      expect(context.top20Salesmen[0].org).toBe('成都分公司');
      expect(context.filters?.bundleOnly).toBe(true);
      expect(context.filters?.dueMonth).toBe(3);
    });

    it('should handle missing filters', () => {
      const context = buildRenewalContext(mockKpiData, mockTop20Data);

      expect(context.type).toBe('renewal');
      expect(context.filters).toBeUndefined();
    });

    it('should handle empty top20 data', () => {
      const context = buildRenewalContext(mockKpiData, []);

      expect(context.top20Salesmen).toHaveLength(0);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate consistent cache key for same data', () => {
      const context1 = buildRenewalContext(mockKpiData, mockTop20Data, { bundleOnly: true });
      const context2 = buildRenewalContext(mockKpiData, mockTop20Data, { bundleOnly: true });

      expect(generateCacheKey(context1)).toBe(generateCacheKey(context2));
    });

    it('should generate different keys for different data', () => {
      const context1 = buildRenewalContext(mockKpiData, mockTop20Data, { bundleOnly: true });
      const context2 = buildRenewalContext(mockKpiData, mockTop20Data, { bundleOnly: false });

      expect(generateCacheKey(context1)).not.toBe(generateCacheKey(context2));
    });

    it('should include filter conditions in key', () => {
      const contextWithBundle = buildRenewalContext(mockKpiData, mockTop20Data, { bundleOnly: true });
      const contextWithoutBundle = buildRenewalContext(mockKpiData, mockTop20Data, { bundleOnly: false });

      expect(generateCacheKey(contextWithBundle)).toContain('bundle');
      expect(generateCacheKey(contextWithoutBundle)).not.toContain('bundle');
    });
  });

  describe('formatContextForAI', () => {
    it('should format context as readable text', () => {
      const context = buildRenewalContext(mockKpiData, mockTop20Data, {
        bundleOnly: true,
        dueMonth: 3,
      });

      const formatted = formatContextForAI(context);

      expect(formatted).toContain('【整体 KPI】');
      expect(formatted).toContain('应续件数: 1,000');
      expect(formatted).toContain('续保率: 75.0%');
      expect(formatted).toContain('【应续件数 Top20 业务员】');
      expect(formatted).toContain('张三');
      expect(formatted).toContain('成都分公司');
      expect(formatted).toContain('仅套单业务');
      expect(formatted).toContain('3月到期');
    });

    it('should format table rows correctly', () => {
      const context = buildRenewalContext(mockKpiData, mockTop20Data);
      const formatted = formatContextForAI(context);

      // 检查表格格式
      expect(formatted).toContain('排名 | 业务员 | 机构');
      expect(formatted).toContain('1 | 张三 | 成都分公司 | 100 | 80 | 80.0% | 90.0%');
      expect(formatted).toContain('2 | 李四 | 重庆分公司 | 90 | 60 | 66.7% | 83.3%');
    });

    it('should not include filter section when no filters', () => {
      const context = buildRenewalContext(mockKpiData, mockTop20Data);
      const formatted = formatContextForAI(context);

      expect(formatted).not.toContain('【筛选条件】');
    });
  });
});
