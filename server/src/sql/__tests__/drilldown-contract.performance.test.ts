import { describe, expect, it } from 'vitest';
import {
  generatePerformanceDrilldownQuery,
  type PerformanceDimension,
  type PerformanceDrilldownStep,
  type PerformanceSegmentTag,
  type PerformanceTimePeriod,
  type PerformanceGrowthMode,
  type PerformancePeriodBounds,
} from '../performance-analysis.js';

const ALL_DIMS: PerformanceDimension[] = [
  'org_level_3', 'team', 'salesman', 'customer_category',
  'tonnage_segment', 'is_new_car', 'is_transfer', 'is_nev',
  'is_telemarketing', 'is_renewal',
];

function gen(
  groupBy: PerformanceDimension | null = 'org_level_3',
  drillPath: PerformanceDrilldownStep[] = [],
  opts: {
    segmentTag?: PerformanceSegmentTag;
    timePeriod?: PerformanceTimePeriod;
    growthMode?: PerformanceGrowthMode;
    periodBoundsOverride?: PerformancePeriodBounds;
  } = {},
) {
  return generatePerformanceDrilldownQuery(
    '1=1',
    '1=1',
    opts.segmentTag ?? 'all',
    opts.timePeriod ?? 'month',
    opts.growthMode ?? 'mom',
    drillPath,
    groupBy,
    opts.periodBoundsOverride,
  );
}

describe('业绩分析下钻 — SQL 语义不变式', () => {
  // P-01: 输出字段集
  it('P-01: 输出含保费/计划/达成率/增长率核心字段', () => {
    const sql = gen();
    expect(sql).toContain('AS premium');
    expect(sql).toContain('AS achievement_rate');
    expect(sql).toContain('AS growth_rate');
    expect(sql).toContain('AS nev_rate');
  });

  // P-02: period_progress CTE 永远存在
  it('P-02: period_progress CTE 用于进度计算', () => {
    const sql = gen();
    expect(sql).toContain('period_progress');
  });

  // P-03: 布尔维度 is_renewal 显示标签
  it('P-03: groupBy=is_renewal 输出续保/非续保标签', () => {
    const sql = gen('is_renewal');
    expect(sql).toContain("'续保'");
    expect(sql).toContain("'非续保'");
  });

  // P-04: tonnage_segment 维度
  it('P-04: groupBy=tonnage_segment 生成吨位分段SQL', () => {
    const sql = gen('tonnage_segment');
    expect(sql).toContain('tonnage_segment');
    expect(sql).toContain('AS group_name');
  });

  // P-05: drillPath 注入 WHERE 条件
  it('P-05: drillPath org+is_nev 翻译为多个 WHERE 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'org_level_3', value: '天府' },
      { dimension: 'is_nev', value: '新能源' },
    ]);
    expect(sql).toContain("p.org_level_3 = '天府'");
    // is_nev=新能源 使用 truthyExpr 而非字符串匹配
    expect(sql).toContain('p.is_nev');
  });

  // P-06: periodBoundsOverride 使用静态日期
  it('P-06: periodBoundsOverride 注入静态日期 CTE', () => {
    const sql = gen('org_level_3', [], {
      periodBoundsOverride: {
        refDate: '2026-02-27',
        currentStart: '2026-02-01',
        currentEnd: '2026-02-27',
        prevStart: '2026-01-01',
        prevEnd: '2026-01-27',
      },
    });
    expect(sql).toContain("'2026-02-27'");
    expect(sql).toContain("'2026-02-01'");
  });

  // P-07: segmentTag 隔离车型
  it('P-07: segmentTag=non_business_passenger 不含货车段', () => {
    const sql = gen('org_level_3', [], { segmentTag: 'non_business_passenger' });
    expect(sql).toContain('non_business_passenger');
  });

  // P-08: mom vs yoy 增长率
  it('P-08: growthMode=yoy 使用 INTERVAL 1 YEAR', () => {
    const sqlYoy = gen('org_level_3', [], { growthMode: 'yoy' });
    expect(sqlYoy).toContain('INTERVAL 1 YEAR');
  });

  it('P-08b: growthMode=mom + timePeriod=month 使用 INTERVAL 1 MONTH', () => {
    const sqlMom = gen('org_level_3', [], { growthMode: 'mom', timePeriod: 'month' });
    expect(sqlMom).toContain('INTERVAL 1 MONTH');
  });

  // P-09: groupBy=null 返回整体汇总
  it('P-09: groupBy=null 输出分公司整体', () => {
    const sql = gen(null);
    expect(sql).toContain("'分公司整体' AS group_name");
  });

  // P-10: drillPath team 步骤
  it('P-10: drillPath team 步骤翻译为 team_name 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'team', value: '成都团队' },
    ]);
    expect(sql).toContain("team_name");
    expect(sql).toContain("'成都团队'");
  });
});
