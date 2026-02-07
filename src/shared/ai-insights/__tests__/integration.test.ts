/**
 * AI 洞察模块集成测试
 *
 * 验证模块导出和基本功能
 */

import { describe, it, expect } from 'vitest';
import {
  // 类型
  type Insight,
  type InsightType,
  type RenewalDataContext,

  // 上下文构建器
  buildRenewalContext,
  generateCacheKey,
  formatContextForAI,

  // 洞察生成器
  isInsightConfigured,

  // Prompts
  getPromptByType,
  RENEWAL_INSIGHT_PROMPT,
} from '../index';

describe('AI Insights Module Integration', () => {
  describe('exports', () => {
    it('should export context builder functions', () => {
      expect(typeof buildRenewalContext).toBe('function');
      expect(typeof generateCacheKey).toBe('function');
      expect(typeof formatContextForAI).toBe('function');
    });

    it('should export insight generator functions', () => {
      expect(typeof isInsightConfigured).toBe('function');
    });

    it('should export prompt utilities', () => {
      expect(typeof getPromptByType).toBe('function');
      expect(typeof RENEWAL_INSIGHT_PROMPT).toBe('string');
    });
  });

  describe('type safety', () => {
    it('should allow creating valid Insight objects', () => {
      const insight: Insight = {
        id: 'test-1',
        type: 'warning' as InsightType,
        title: '测试洞察',
        description: '这是一条测试洞察',
        priority: 'high',
      };

      expect(insight.type).toBe('warning');
      expect(insight.priority).toBe('high');
    });

    it('should allow creating valid RenewalDataContext', () => {
      const context: RenewalDataContext = {
        type: 'renewal',
        kpi: {
          dueCount: 100,
          renewedCount: 75,
          quotedCount: 80,
          duePremium: 100000,
          renewedPremium: 75000,
          quotedPremium: 80000,
          renewalRate: 0.75,
          quoteRate: 0.8,
          conversionRate: 0.9375,
        },
        top20Salesmen: [],
      };

      expect(context.type).toBe('renewal');
      expect(context.kpi.renewalRate).toBe(0.75);
    });
  });

  describe('prompt selection', () => {
    it('should return renewal prompt for renewal type', () => {
      const prompt = getPromptByType('renewal');
      expect(prompt).toContain('续保');
      expect(prompt).toContain('Top 20');
    });

    it('should return premium prompt for premium type', () => {
      const prompt = getPromptByType('premium');
      expect(prompt).toContain('保费');
    });

    it('should return generic prompt for unknown types', () => {
      const prompt = getPromptByType('cost');
      expect(prompt).toContain('数据分析');
    });
  });

  describe('context building workflow', () => {
    it('should build context and generate cache key', () => {
      const kpiData = {
        dueCount: 500,
        renewedCount: 400,
        quotedCount: 450,
        duePremium: 2500000,
        renewedPremium: 2000000,
        quotedPremium: 2250000,
        renewalRate: 0.8,
        quoteRate: 0.9,
        conversionRate: 0.889,
      };

      const top20Data = [
        {
          groupName: '王五',
          parentName: '北京分公司',
          levelType: 'salesman',
          dueCount: 50,
          renewedCount: 45,
          quotedCount: 48,
          duePremium: 250000,
          renewedPremium: 225000,
          quotedPremium: 240000,
          renewalRate: 0.9,
          quoteRate: 0.96,
          renewalPremiumRate: 0.9,
          quotePremiumRate: 0.96,
          rankAsc: 1,
          rankDesc: 20,
        },
      ];

      // 构建上下文
      const context = buildRenewalContext(kpiData, top20Data, {
        selfRenewalOnly: true,
      });

      // 验证上下文结构
      expect(context.type).toBe('renewal');
      expect(context.kpi.dueCount).toBe(500);
      expect(context.top20Salesmen[0].name).toBe('王五');
      expect(context.filters?.selfRenewalOnly).toBe(true);

      // 生成缓存 key
      const cacheKey = generateCacheKey(context);
      expect(typeof cacheKey).toBe('string');
      expect(cacheKey.length).toBeGreaterThan(0);
      expect(cacheKey).toContain('renewal');

      // 格式化为 AI 输入
      const formatted = formatContextForAI(context);
      expect(formatted).toContain('王五');
      expect(formatted).toContain('北京分公司');
      expect(formatted).toContain('仅自留续保');
    });
  });
});
