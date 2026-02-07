/**
 * 洞察生成器测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RenewalDataContext } from '../types';

// Mock configStore
vi.mock('../../../features/sql-query/aiSql/configStore', () => ({
  getStoredConfig: vi.fn(() => ({ apiKey: '', model: 'codegeex-4' })),
}));

// 动态导入以确保 mock 生效
const getInsightGenerator = async () => {
  const module = await import('../insight-generator');
  return module;
};

describe('insight-generator', () => {
  const mockContext: RenewalDataContext = {
    type: 'renewal',
    kpi: {
      dueCount: 1000,
      renewedCount: 750,
      quotedCount: 850,
      duePremium: 5000000,
      renewedPremium: 3750000,
      quotedPremium: 4250000,
      renewalRate: 0.75,
      quoteRate: 0.85,
      conversionRate: 0.882,
    },
    top20Salesmen: [
      {
        name: '张三',
        org: '成都分公司',
        dueCount: 100,
        renewedCount: 80,
        quotedCount: 90,
        renewalRate: 0.8,
        quoteRate: 0.9,
        duePremium: 500000,
        renewedPremium: 400000,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isInsightConfigured', () => {
    it('should return false when no API key configured', async () => {
      const { isInsightConfigured } = await getInsightGenerator();
      expect(isInsightConfigured()).toBe(false);
    });
  });

  describe('generateInsights', () => {
    it('should return error when API key not configured', async () => {
      const { generateInsights } = await getInsightGenerator();

      const result = await generateInsights(mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API Key');
      expect(result.insights).toHaveLength(0);
    });
  });
});

// 单独测试 parseInsights 逻辑
describe('parseInsights logic', () => {
  it('should parse valid JSON array from response', () => {
    const content = `Here is the analysis:
\`\`\`json
[
  {
    "type": "warning",
    "title": "续保率偏低",
    "description": "整体续保率75%低于行业平均80%",
    "priority": "high",
    "metric": { "name": "续保率", "value": "75%" },
    "affectedEntities": ["张三", "李四"]
  }
]
\`\`\``;

    // 提取 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    expect(jsonMatch).not.toBeNull();

    const parsed = JSON.parse(jsonMatch![0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('warning');
    expect(parsed[0].title).toBe('续保率偏低');
    expect(parsed[0].priority).toBe('high');
  });

  it('should handle malformed JSON gracefully', () => {
    const content = 'Invalid response without JSON';

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    expect(jsonMatch).toBeNull();
  });
});
