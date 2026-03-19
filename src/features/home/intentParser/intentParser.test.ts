/**
 * 本地意图解析器 — 单元测试
 */

import { describe, it, expect } from 'vitest';
import type { CapabilityInfo } from '@/shared/api/client';
import type { FilterOptions } from '@/shared/types/data';
import { matchCapabilities } from './capabilityMatcher';
import { extractFilters } from './filterExtractor';
import { parseIntent } from './intentParser';

// ────────────────────────────────────────────────────
// 测试数据
// ────────────────────────────────────────────────────

const MOCK_CAPABILITIES: CapabilityInfo[] = [
  {
    id: 'renewal',
    route: '/renewal',
    name: '续保分析',
    icon: 'RefreshCw',
    description: '续保率分析，含机构/团队/业务员维度续保率、续保明细下钻',
    keywords: ['续保', '续保率', '到期续保', '续转率'],
    exampleQueries: ['续保率是多少', '各机构续保情况', '续保分析', '到期保单续保率'],
  },
  {
    id: 'dashboard',
    route: '/dashboard',
    name: '仪表盘',
    icon: 'LayoutDashboard',
    description: '综合业绩总览：KPI 大盘、保费趋势图、机构排名',
    keywords: ['仪表盘', '总览', '大盘', 'KPI', '概览', '保费总量', '件数', '人均产能'],
    exampleQueries: ['看一下整体业绩情况', '总保费是多少', '今天的KPI数据'],
  },
  {
    id: 'cost',
    route: '/cost',
    name: '成本分析',
    icon: 'TrendingDown',
    description: '赔付率/费用率/综合费用率/变动成本率',
    keywords: ['成本', '赔付率', '费用率', '综合费用率', '变动成本率'],
    exampleQueries: ['成本分析', '赔付率多少'],
  },
  {
    id: 'premium-report',
    route: '/premium-report',
    name: '保费报表',
    icon: 'DollarSign',
    description: '保费明细报表，含计划达成率、完成进度',
    keywords: ['保费', '报表', '计划', '达成率', '完成率', '进度'],
    exampleQueries: ['保费完成率怎么样', '各机构保费达成率'],
  },
  {
    id: 'cross-sell',
    route: '/cross-sell',
    name: '驾意险推介率',
    icon: 'Target',
    description: '驾意险推介率四象限散点图',
    keywords: ['驾意险', '推介率', '四象限', '交叉销售'],
    exampleQueries: ['驾意险推介率排名', '推介率分析'],
  },
];

const MOCK_FILTER_OPTIONS: FilterOptions = {
  org_level_3: [
    { value: '天府中支', count: 0 },
    { value: '乐山中支', count: 0 },
    { value: '成都市中心支', count: 0 },
    { value: '绵阳中支', count: 0 },
    { value: '南充中支', count: 0 },
  ],
  salesman_name: [
    { value: '张三', count: 0 },
    { value: '李四', count: 0 },
    { value: '王五', count: 0 },
  ],
  customer_category: [
    { value: '非营业个人客车', count: 0 },
    { value: '营业货车', count: 0 },
    { value: '摩托车', count: 0 },
  ],
};

const FIXED_TODAY = new Date('2026-03-15');

// ────────────────────────────────────────────────────
// capabilityMatcher
// ────────────────────────────────────────────────────

describe('matchCapabilities', () => {
  it('精确关键词命中 - "续保率" → renewal 排名第一', () => {
    const results = matchCapabilities('续保率', MOCK_CAPABILITIES);
    expect(results[0].id).toBe('renewal');
    expect(results[0].score).toBeGreaterThanOrEqual(20);
  });

  it('示例查询命中 - "各机构续保情况" → renewal 高置信度', () => {
    const results = matchCapabilities('各机构续保情况', MOCK_CAPABILITIES);
    expect(results[0].id).toBe('renewal');
    expect(results[0].score).toBeGreaterThanOrEqual(40);
  });

  it('能力名称完整匹配 - "仪表盘" → dashboard 高置信度', () => {
    const results = matchCapabilities('仪表盘', MOCK_CAPABILITIES);
    expect(results[0].id).toBe('dashboard');
    expect(results[0].score).toBeGreaterThanOrEqual(40);
  });

  it('多关键词加成 - "成本赔付率费用率" → cost 高置信度', () => {
    const results = matchCapabilities('成本赔付率费用率', MOCK_CAPABILITIES);
    expect(results[0].id).toBe('cost');
    expect(results[0].score).toBeGreaterThanOrEqual(60);
  });

  it('无匹配 - "明天天气怎么样" → 全部 score < 20', () => {
    const results = matchCapabilities('明天天气怎么样', MOCK_CAPABILITIES);
    for (const r of results) {
      expect(r.score).toBeLessThan(20);
    }
  });

  it('返回不超过 topN=3 个结果，按分数降序', () => {
    const results = matchCapabilities('保费续保成本', MOCK_CAPABILITIES, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('空输入返回空数组', () => {
    expect(matchCapabilities('', MOCK_CAPABILITIES)).toEqual([]);
    expect(matchCapabilities('  ', MOCK_CAPABILITIES)).toEqual([]);
  });

  it('空能力列表返回空数组', () => {
    expect(matchCapabilities('续保', [])).toEqual([]);
  });
});

// ────────────────────────────────────────────────────
// filterExtractor
// ────────────────────────────────────────────────────

describe('extractFilters', () => {
  it('完整机构名提取 - "天府中支续保" → org_level_3: ["天府中支"]', () => {
    const result = extractFilters('天府中支续保', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.org_level_3).toEqual(['天府中支']);
  });

  it('简称提取 - "天府的续保率" → org_level_3: ["天府中支"]', () => {
    const result = extractFilters('天府的续保率', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.org_level_3).toEqual(['天府中支']);
  });

  it('防止误匹配 - "保费" 不应命中任何机构', () => {
    const result = extractFilters('保费情况', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.org_level_3).toBeUndefined();
  });

  it('业务员提取 - "张三的业绩" → salesman_name: ["张三"]', () => {
    const result = extractFilters('张三的业绩', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.salesman_name).toEqual(['张三']);
  });

  it('客户类别提取 - "营业货车" → customer_category: ["营业货车"]', () => {
    const result = extractFilters('营业货车分析', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.customer_category).toEqual(['营业货车']);
  });

  it('本月时间提取 → 正确 start/end', () => {
    const result = extractFilters('本月保费', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2026-03-01');
    expect(result.policy_date_end).toBe('2026-03-15');
  });

  it('上月时间提取', () => {
    const result = extractFilters('上月续保率', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2026-02-01');
    expect(result.policy_date_end).toBe('2026-02-28');
  });

  it('最近30天', () => {
    const result = extractFilters('最近30天数据', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2026-02-13');
    expect(result.policy_date_end).toBe('2026-03-15');
  });

  it('最近一个月', () => {
    const result = extractFilters('最近一个月趋势', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2026-02-13');
    expect(result.policy_date_end).toBe('2026-03-15');
  });

  it('今年', () => {
    const result = extractFilters('今年保费', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2026-01-01');
    expect(result.policy_date_end).toBe('2026-12-31');
  });

  it('去年', () => {
    const result = extractFilters('去年的数据', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2025-01-01');
    expect(result.policy_date_end).toBe('2025-12-31');
  });

  it('指定年份 - "2025年" → 2025全年', () => {
    const result = extractFilters('2025年数据', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(result.policy_date_start).toBe('2025-01-01');
    expect(result.policy_date_end).toBe('2025-12-31');
  });

  it('无匹配 → 返回空', () => {
    const result = extractFilters('明天天气', MOCK_FILTER_OPTIONS, FIXED_TODAY);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('空输入返回空', () => {
    expect(extractFilters('', MOCK_FILTER_OPTIONS, FIXED_TODAY)).toEqual({});
  });
});

// ────────────────────────────────────────────────────
// parseIntent 集成
// ────────────────────────────────────────────────────

describe('parseIntent', () => {
  it('高置信度 - "续保率是多少" → confidence=high, renewal 排第一', () => {
    const result = parseIntent('续保率是多少', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS, {
      today: FIXED_TODAY,
    });
    expect(result.confidence).toBe('high');
    expect(result.links.length).toBeGreaterThanOrEqual(1);
    expect(result.links[0].capability.id).toBe('renewal');
    expect(result.links[0].isPrimary).toBe(true);
  });

  it('低置信度 - "数据情况" → confidence=low', () => {
    const result = parseIntent('数据情况', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS, {
      today: FIXED_TODAY,
    });
    // "数据" 可能部分匹配但分数不高
    expect(['low', 'none']).toContain(result.confidence);
  });

  it('零匹配 - "明天天气怎么样" → confidence=none', () => {
    const result = parseIntent('明天天气怎么样', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS, {
      today: FIXED_TODAY,
    });
    expect(result.confidence).toBe('none');
    expect(result.links).toHaveLength(0);
  });

  it('带机构 - "天府中支续保率" → links[0].filters.org_level_3', () => {
    const result = parseIntent('天府中支续保率', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS, {
      today: FIXED_TODAY,
    });
    expect(result.confidence).toBe('high');
    expect(result.links[0].capability.id).toBe('renewal');
    expect(result.links[0].filters.org_level_3).toEqual(['天府中支']);
  });

  it('标签生成 - 有机构时包含机构名', () => {
    const result = parseIntent('天府续保', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS, {
      today: FIXED_TODAY,
    });
    if (result.links.length > 0 && result.links[0].filters.org_level_3) {
      expect(result.links[0].label).toContain('天府');
    }
  });

  it('allowedRoutes 过滤 - 仅保留允许的路由', () => {
    const result = parseIntent('续保率', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS, {
      today: FIXED_TODAY,
      allowedRoutes: ['/dashboard', '/cost'],
    });
    // renewal 被过滤掉了
    for (const link of result.links) {
      expect(['/dashboard', '/cost']).toContain(link.capability.route);
    }
  });

  it('空输入 → confidence=none', () => {
    const result = parseIntent('', MOCK_CAPABILITIES, MOCK_FILTER_OPTIONS);
    expect(result.confidence).toBe('none');
  });

  it('空能力列表 → confidence=none', () => {
    const result = parseIntent('续保', [], MOCK_FILTER_OPTIONS);
    expect(result.confidence).toBe('none');
  });
});
