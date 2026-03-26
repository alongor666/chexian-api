import { describe, expect, it } from 'vitest';
import {
  generateRenewalFreeDrilldownQuery,
  type RenewalDrillDimension,
  type RenewalDrillStep,
  type RenewalFreeDrilldownParams,
} from '../renewal-drilldown.js';
import type { AdvancedFilterState } from '../../types/data.js';

const emptyFilters: AdvancedFilterState = {};

function gen(
  groupBy: RenewalDrillDimension = 'org_level_3',
  drillPath: RenewalDrillStep[] = [],
  overrides: Partial<RenewalFreeDrilldownParams> = {},
) {
  return generateRenewalFreeDrilldownQuery(emptyFilters, {
    targetYear: 2026,
    groupBy,
    drillPath,
    sortField: 'renewal_rate',
    sortOrder: 'desc',
    ...overrides,
  });
}

describe('续保自由维度下钻 — SQL 语义不变式', () => {
  // R-01: 顶层字段集不变式
  it('R-01: 输出含应续/已续/报价率/续保率核心字段', () => {
    const sql = gen();
    expect(sql).toContain('AS due_count');
    expect(sql).toContain('AS renewed_count');
    expect(sql).toContain('AS quoted_count');
    expect(sql).toContain('AS renewal_rate');
    expect(sql).toContain('AS quote_rate');
    expect(sql).toContain('AS renewal_premium_rate');
    expect(sql).toContain('AS rank_asc');
    expect(sql).toContain('AS rank_desc');
  });

  // R-02: 续保判定口径
  it('R-02: 续保判定使用 renewal_policy_no IS NOT NULL', () => {
    const sql = gen();
    expect(sql).toContain('renewal_policy_no IS NOT NULL');
    expect(sql).toContain("renewal_policy_no <> ''");
  });

  // R-03: 到期日计算
  it('R-03: dueMonth 使用到期日计算（+1年-1天）', () => {
    const sql = gen('org_level_3', [], { dueMonth: 2 });
    expect(sql).toContain("INTERVAL '1 year'");
    expect(sql).toContain("INTERVAL '1 day'");
    expect(sql).toContain('= 2');
  });

  // R-04: cutoffDate 与 dueMonth 互斥
  it('R-04: dueMonth 存在时 cutoffDate 不生效', () => {
    const sql = gen('org_level_3', [], {
      dueMonth: 2,
      cutoffDate: '2026-03-15',
    });
    expect(sql).not.toContain('BETWEEN');
  });

  it('R-04b: 无 dueMonth 时 cutoffDate 生成 BETWEEN', () => {
    const sql = gen('org_level_3', [], {
      cutoffDate: '2026-03-15',
    });
    expect(sql).toContain('BETWEEN');
    expect(sql).toContain('2026-03-15');
  });

  // R-05: team 维度触发 CTE JOIN
  it('R-05: groupBy=team 生成 team_mapping CTE', () => {
    const sql = gen('team');
    expect(sql).toContain('team_mapping AS');
    expect(sql).toContain('renewal_with_team AS');
    expect(sql).toContain('LEFT JOIN team_mapping');
  });

  // R-06: 非 team 维度不产生额外 JOIN
  it('R-06: groupBy=salesman 无 team_mapping', () => {
    const sql = gen('salesman');
    expect(sql).not.toContain('team_mapping AS');
    expect(sql).not.toContain('renewal_with_team AS');
  });

  // R-07: drillPath 步骤翻译为 WHERE
  it('R-07: drillPath org_level_3=天府 翻译为 WHERE 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'org_level_3', value: '天府' },
    ]);
    expect(sql).toContain("r.org_level_3 = '天府'");
  });

  // R-08: 布尔维度 is_new_car 翻译
  it('R-08: drillPath is_new_car=新车 翻译为 true/1 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'is_new_car', value: '新车' },
    ]);
    expect(sql).toContain("r.is_new_car = 'true'");
    expect(sql).toContain("r.is_new_car = '1'");
  });

  // R-09: sortField/sortOrder 透传
  it('R-09: sortField=due_count sortOrder=asc 透传到 ORDER BY', () => {
    const sql = gen('org_level_3', [], {
      sortField: 'due_count',
      sortOrder: 'asc',
    });
    expect(sql).toContain('ORDER BY due_count asc');
  });

  // R-10: drillPath team 步骤触发 team_mapping
  it('R-10: drillPath 含 team 步骤时自动触发 team_mapping', () => {
    const sql = gen('salesman', [
      { dimension: 'team', value: 'A团队' },
    ]);
    expect(sql).toContain('team_mapping AS');
    expect(sql).toContain("team_name = 'A团队'");
  });

  // R-11: drilldown_base CTE 结构
  it('R-11: SQL 包含 drilldown_base 和 drilldown_calc CTE', () => {
    const sql = gen();
    expect(sql).toContain('drilldown_base AS');
    expect(sql).toContain('drilldown_calc AS');
  });
});
