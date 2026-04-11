/**
 * renewal-v2 权限过滤测试
 *
 * 验证所有 SQL 生成器正确注入 permissionFilter
 * 修复来源：PR#159 Codex Review P1
 */
import { describe, it, expect } from 'vitest';
import {
  generateOverviewQuery,
  generateOverviewTotalQuery,
  generateTrendQuery,
  generateFunnelQuery,
  generateLossReasonQuery,
  generateCompetitionLossQuery,
  generateCompetitionGainQuery,
  generateActionListQuery,
  generateActionListCountQuery,
} from '../../server/src/sql/renewal-universe';

describe('renewal-v2 行级权限过滤', () => {
  const ORG_FILTER = "org_level_3 = '乐山中支'";
  const TELEMARKETING_FILTER = 'is_telemarketing = true';

  const generators = [
    { name: 'generateOverviewQuery', fn: generateOverviewQuery },
    { name: 'generateOverviewTotalQuery', fn: generateOverviewTotalQuery },
    { name: 'generateTrendQuery', fn: generateTrendQuery },
    { name: 'generateFunnelQuery', fn: generateFunnelQuery },
    { name: 'generateLossReasonQuery', fn: generateLossReasonQuery },
    { name: 'generateCompetitionLossQuery', fn: generateCompetitionLossQuery },
    { name: 'generateCompetitionGainQuery', fn: generateCompetitionGainQuery },
    { name: 'generateActionListQuery', fn: generateActionListQuery },
    { name: 'generateActionListCountQuery', fn: generateActionListCountQuery },
  ];

  generators.forEach(({ name, fn }) => {
    it(`${name} 注入 ORG_USER 权限过滤`, () => {
      const sql = fn({}, ORG_FILTER);
      expect(sql).toContain(ORG_FILTER);
    });

    it(`${name} 注入 TELEMARKETING_USER 权限过滤`, () => {
      const sql = fn({}, TELEMARKETING_FILTER);
      expect(sql).toContain(TELEMARKETING_FILTER);
    });

    it(`${name} 默认 1=1 不产生额外条件`, () => {
      const sqlWithDefault = fn({}, '1=1');
      const sqlWithout = fn({});
      // 两者应生成相同 SQL（1=1 不额外追加）
      expect(sqlWithDefault).toBe(sqlWithout);
    });
  });

  it('权限过滤与用户筛选共存', () => {
    const sql = generateOverviewQuery(
      { orgName: '乐山中支', customerCategory: '家用车' },
      TELEMARKETING_FILTER,
    );
    expect(sql).toContain("org_level_3 = '乐山中支'");
    expect(sql).toContain("customer_category = '家用车'");
    expect(sql).toContain(TELEMARKETING_FILTER);
  });
});
