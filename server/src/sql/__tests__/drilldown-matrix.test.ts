import { describe, expect, it } from 'vitest';
import {
  generateRenewalFreeDrilldownQuery,
  type RenewalDrillDimension,
} from '../renewal-drilldown.js';
import {
  generatePerformanceDrilldownQuery,
  type PerformanceDimension,
} from '../performance-analysis.js';
import {
  generateHolidayFreeDrilldownQuery,
  type HolidayDrillDimension,
} from '../marketing-report.js';
import {
  generateCrossSellQuery,
  type CrossSellDimension,
} from '../cross-sell.js';
import type { AdvancedFilterState } from '../../types/data.js';

const emptyFilters: AdvancedFilterState = {};

describe('下钻组合矩阵 — 边界与防御性测试', () => {
  // X-01: 续保链全部维度不抛异常
  it('X-01: 续保链 9 个 groupBy 维度均能生成 SQL', () => {
    const dims: RenewalDrillDimension[] = [
      'org_level_3', 'team', 'salesman', 'coverage_combination',
      'customer_category', 'is_new_car', 'is_transfer', 'is_nev',
      'is_telemarketing',
    ];
    for (const dim of dims) {
      expect(() =>
        generateRenewalFreeDrilldownQuery(emptyFilters, {
          targetYear: 2026,
          groupBy: dim,
          drillPath: [],
        }),
      ).not.toThrow();
    }
  });

  // X-02: 业绩链全部维度不抛异常
  it('X-02: 业绩链 10 个 groupBy 维度均能生成 SQL', () => {
    const dims: PerformanceDimension[] = [
      'org_level_3', 'team', 'salesman', 'customer_category',
      'tonnage_segment', 'is_new_car', 'is_transfer', 'is_nev',
      'is_telemarketing', 'is_renewal',
    ];
    for (const dim of dims) {
      expect(() =>
        generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'month', 'mom', [], dim),
      ).not.toThrow();
    }
  });

  // X-03: 营销链全部维度不抛异常
  it('X-03: 营销链 7 个 groupBy 维度均能生成 SQL', () => {
    const dims: HolidayDrillDimension[] = [
      'org_level_3', 'team', 'salesman',
      'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing',
    ];
    for (const dim of dims) {
      expect(() =>
        generateHolidayFreeDrilldownQuery('1=1', ['2026-02-01'], dim, []),
      ).not.toThrow();
    }
  });

  // X-04: 驾意险链全部维度不抛异常
  it('X-04: 驾意险链 9 个 groupBy 维度均能生成 SQL', () => {
    const dims: CrossSellDimension[] = [
      'org_level_3', 'team', 'salesman',
      'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
      'insurance_grade',
    ];
    for (const dim of dims) {
      expect(() =>
        generateCrossSellQuery('1=1', [], dim),
      ).not.toThrow();
    }
  });

  // X-05: 三层嵌套 drillPath 不崩溃
  it('X-05: 续保链三层嵌套 drillPath 生成有效 SQL', () => {
    const sql = generateRenewalFreeDrilldownQuery(emptyFilters, {
      targetYear: 2026,
      groupBy: 'salesman',
      drillPath: [
        { dimension: 'org_level_3', value: '天府' },
        { dimension: 'customer_category', value: '非营业个人客车' },
        { dimension: 'is_nev', value: '新能源' },
      ],
    });
    expect(sql.length).toBeGreaterThan(200);
    expect(sql).toContain("r.org_level_3 = '天府'");
    expect(sql).toContain("r.customer_category = '非营业个人客车'");
    expect(sql).toContain('r.is_nev');
  });

  // X-06: SQL 注入防御 — 续保链
  it('X-06: 续保链 drillPath 单引号被转义', () => {
    const sql = generateRenewalFreeDrilldownQuery(emptyFilters, {
      targetYear: 2026,
      groupBy: 'salesman',
      drillPath: [
        { dimension: 'org_level_3', value: "天府' OR '1'='1" },
      ],
    });
    // 原始注入字符串不应完整出现
    expect(sql).not.toContain("OR '1'='1");
  });

  // X-07: SQL 注入防御 — 营销链
  it('X-07: 营销链 drillPath 单引号被转义', () => {
    const sql = generateHolidayFreeDrilldownQuery('1=1', ['2026-02-01'], 'salesman', [
      { dimension: 'org_level_3', value: "天府' OR '1'='1" },
    ]);
    expect(sql).not.toContain("OR '1'='1");
  });

  // X-08: SQL 注入防御 — 业绩链
  it('X-08: 业绩链 drillPath 单引号被转义', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'month', 'mom', [
      { dimension: 'org_level_3', value: "天府' OR '1'='1" },
    ], 'salesman');
    expect(sql).not.toContain("OR '1'='1");
  });
});
