import { describe, expect, it } from 'vitest';
import {
  generatePerformanceDrilldownQuery,
  generatePerformanceOrgHeatmapQuery,
  generatePerformancePeriodBoundsQuery,
  generatePerformanceSummaryQuery,
  generatePerformanceTopSalesmanQuery,
  generatePerformanceTrendQuery,
  getPerformanceSegmentFilter,
  getPerformanceVehicleCategoryFilter,
  getPlanDenominator,
} from '../server/src/sql/performance-analysis';

describe('performance analysis SQL', () => {
  it('should include business passenger category filter keywords', () => {
    const filter = getPerformanceVehicleCategoryFilter('business_passenger');

    expect(filter).toContain("customer_category LIKE '%营业%'");
    expect(filter).toContain("customer_category LIKE '%客车%'");
    expect(filter).toContain("customer_category LIKE '%出租%'");
  });

  it('summary SQL should expose premium/plan/auto_count/avg_premium/achievement/growth/ratio fields', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'none');

    expect(sql).toContain('AS premium');
    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('AS avg_premium');
    expect(sql).toContain('AS achievement_rate');
    expect(sql).toContain('AS growth_rate');
    expect(sql).toContain('AS nev_rate');
  });

  it('summary SQL should support expandable dimensions', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'energy_business_nature');
    expect(sql).toContain('child_current');
    expect(sql).toContain("|| '+' ||");
    expect(sql).toContain('ORDER BY coverage_order, row_level, child_order');
  });

  it('summary business_nature should use 新转续三分类键值', () => {
    const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'business_nature');

    expect(sql).toContain("WHEN is_renewal_bool THEN '续保' WHEN is_new_car_bool THEN '新保'");
    expect(sql).toContain("WHEN is_renewal_bool THEN 'renewal' WHEN is_new_car_bool THEN 'new_business'");
    expect(sql).toContain("ELSE 'transfer_business' END AS expand_key");
    expect(sql).toContain("WHEN is_new_car_bool THEN 1");
    expect(sql).toContain("WHEN is_renewal_bool THEN 3");
    expect(sql).toContain("ELSE 2 END AS child_order");
  });

  it('summary SQL should allow reusing precomputed period bounds', () => {
    const sql = generatePerformanceSummaryQuery(
      'policy_date >= \'2026-01-01\'',
      '1=1',
      'all',
      'month',
      'mom',
      'none',
      {
        refDate: '2026-02-27',
        currentStart: '2026-02-01',
        currentEnd: '2026-02-27',
        prevStart: '2026-01-01',
        prevEnd: '2026-01-31',
      }
    );

    expect(sql).toContain("CAST('2026-02-27' AS DATE) AS ref_date");
    expect(sql).not.toContain('COALESCE(MAX(CAST(policy_date AS DATE)), CURRENT_DATE)');
  });

  it('segment tag filter should include all truck branches', () => {
    const filter = getPerformanceSegmentFilter('truck');
    expect(filter).toContain('business_truck');
    expect(filter).toContain('non_business_truck');
  });

  it('should generate different previous period windows for mom and yoy', () => {
    const momSql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'none');
    const yoySql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'yoy', 'none');

    expect(momSql).toContain('INTERVAL 1 MONTH');
    expect(momSql).toContain('INTERVAL 1 DAY');
    expect(yoySql).toContain('INTERVAL 1 YEAR');
  });


  it('plan denominator should follow day/week/month/quarter/year formula', () => {
    expect(getPlanDenominator('day')).toBe(365);
    expect(getPlanDenominator('week')).toBe(52);
    expect(getPlanDenominator('month')).toBe(12);
    expect(getPlanDenominator('quarter')).toBe(4);
    expect(getPlanDenominator('year')).toBe(1);
  });

  it('trend SQL should contain multi-series outputs', () => {
    const sql = generatePerformanceTrendQuery('1=1', 'all', 'monthly');

    expect(sql).toContain('AS time_period');
    expect(sql).toContain('line_key');
    expect(sql).toContain('line_label');
    expect(sql).toContain('ROUND(SUM(premium_wan), 4) AS premium');
    expect(sql).toContain('COUNT(DISTINCT dedup_key) AS auto_count');
  });

  it('drilldown SQL should contain required analysis fields', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');

    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('AS achievement_rate');
    expect(sql).toContain('AS growth_rate');
    expect(sql).toContain('AS nev_rate');
    expect(sql).toContain('AS renewal_rate');
    expect(sql).toContain('AS transfer_business_rate');
    expect(sql).toContain('AS new_car_rate');
    expect(sql).toContain('AS transfer_rate');
    expect(sql).toContain('period_progress');
    expect(sql).toContain('generate_series');
    expect(sql).toContain('CURRENT_DATE');
  });

  it('drilldown SQL should treat 续保直接等于是否续保且过户为过户转保', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');

    expect(sql).toContain('SUM(CASE WHEN is_renewal THEN 1 ELSE 0 END) AS renewal_count');
    expect(sql).toContain('SUM(CASE WHEN (NOT is_new_car) AND (NOT is_renewal) AND is_transfer THEN 1 ELSE 0 END) AS transfer_count');
  });

  it('drilldown SQL should render is_renewal grouping as 续保/非续保', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'is_renewal');

    expect(sql).toContain("THEN '续保' ELSE '非续保' END AS group_name");
  });


  it('drilldown SQL should support tonnage segment grouping for truck categories', () => {
    const sql = generatePerformanceDrilldownQuery(
      "customer_category = '营业货车'",
      "customer_category = '营业货车'",
      'business_truck',
      'day',
      'mom',
      [{ dimension: 'customer_category', value: '营业货车' }],
      'tonnage_segment'
    );

    expect(sql).toContain('tonnage_segment');
    expect(sql).toContain('未分段');
  });

  it('drilldown SQL should null out plan/achievement for dimensions without annual plans', () => {
    const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'customer_category');

    expect(sql).toContain('WHEN FALSE = FALSE THEN NULL');
    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('AS achievement_rate');
  });

  it('top salesman SQL should default to achievement ascending then premium descending', () => {
    const sql = generatePerformanceTopSalesmanQuery('1=1', '1=1', 'motorcycle', 'day', 'mom', 20);

    expect(sql).toContain('AS plan_premium');
    expect(sql).toContain('ORDER BY m.achievement_rate ASC NULLS LAST, m.premium DESC');
    expect(sql).toContain('LIMIT 20');
  });

  it('period bounds SQL should expose current/previous windows', () => {
    const sql = generatePerformancePeriodBoundsQuery('1=1', 'all', 'month', 'mom');
    expect(sql).toContain('AS current_start');
    expect(sql).toContain('AS current_end');
    expect(sql).toContain('AS prev_start');
    expect(sql).toContain('AS prev_end');
  });

  it('heatmap SQL should default to 15 consecutive periods', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day');
    expect(sql).toContain('INTERVAL 14 DAY');
  });

  it('heatmap SQL should normalize table aliases without generating double dots', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'org_level_3');

    expect(sql).toContain('CAST(p.org_level_3 AS VARCHAR)');
    expect(sql).not.toContain('p..org_level_3');
  });

  it('heatmap SQL should use period plan and natural-day progress for achievement', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'month', 15, 'org_level_3');

    expect(sql).toContain('FROM SalesmanTeamMapping m');
    expect(sql).toContain('period_progress');
    expect(sql).toContain('progress_ratio');
    expect(sql).toContain('ppd.period_plan_wan * pr.progress_ratio');
    expect(sql).not.toContain('cur.plan_premium / 12');
  });

  it('heatmap SQL should null out plan fields for non-plan dimensions', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'customer_category');

    expect(sql).toContain('NULL::DOUBLE AS plan_premium');
    expect(sql).toContain('NULL AS achievement_rate');
  });

  it('heatmap SQL should use 承保口径并排除零负保费记录', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature');

    expect(sql).toContain('p.premium / 10000.0 AS premium_wan');
    expect(sql).toContain('AND COALESCE(p.premium, 0) > 0');
  });

  it('heatmap business_nature should generate 4-category dimension: 新保/续保/过户转保/非过户转保', () => {
    const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature');

    expect(sql).toContain("THEN '新保'");
    expect(sql).toContain("THEN '续保'");
    expect(sql).toContain("THEN '过户转保'");
    expect(sql).toContain("ELSE '非过户转保'");
    // 过户转保/非过户转保 完全覆盖转保空间，不应再有聚合 '转保' 输出值
    expect(sql).not.toContain("ELSE '转保'");
  });

  it('heatmap business_nature drill filter should map 转保 to 旧车非续保', () => {
    const sql = generatePerformanceOrgHeatmapQuery(
      '1=1',
      'all',
      'day',
      15,
      'business_nature',
      [{ dimension: 'business_nature', value: '转保' }]
    );

    expect(sql).toContain("TRY_CAST(p.is_renewal AS BOOLEAN) = true");
    expect(sql).toContain("TRY_CAST(p.is_new_car AS BOOLEAN) = true");
    // Both fields negated — verify compound condition pattern
    expect(sql).toMatch(/NOT\s*\(\s*\n?\s*TRY_CAST\(p\.is_new_car AS BOOLEAN\)/);
    expect(sql).toMatch(/NOT\s*\(\s*\n?\s*TRY_CAST\(p\.is_renewal AS BOOLEAN\)/);
  });

  it('heatmap business_nature drill filter should support 过户转保子类', () => {
    const sql = generatePerformanceOrgHeatmapQuery(
      '1=1',
      'all',
      'day',
      15,
      'business_nature',
      [{ dimension: 'business_nature', value: '过户转保' }]
    );

    expect(sql).toMatch(/NOT\s*\(\s*\n?\s*TRY_CAST\(p\.is_renewal AS BOOLEAN\)/);
    expect(sql).toMatch(/NOT\s*\(\s*\n?\s*TRY_CAST\(p\.is_new_car AS BOOLEAN\)/);
    expect(sql).toContain("TRY_CAST(p.is_transfer AS BOOLEAN) = true");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 测试组 A：业务性质维度快照（12 个组合）
  // 固化四分类口径（新保/续保/过户转保/非过户转保），防止回退。
  // ─────────────────────────────────────────────────────────────────────────

  describe('业务性质维度快照 — 四分类不变量（12 组合）', () => {
    it('[A-01] heatmap: 新保 × 非新能源 × 非下钻 → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature');
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-02] heatmap: 新保 × 新能源 × 非下钻 → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_nev = true', 'all', 'day', 15, 'business_nature');
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-03] heatmap: 续保 × 非新能源 × 非下钻 → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_renewal = true AND is_nev = false', 'all', 'day', 15, 'business_nature');
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-04] heatmap: 续保 × 新能源 × 非下钻 → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_renewal = true AND is_nev = true', 'all', 'day', 15, 'business_nature');
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-05] heatmap: 过户转保 × 非新能源 × 非下钻 → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_transfer = true AND is_nev = false', 'all', 'day', 15, 'business_nature');
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-06] heatmap: 非过户转保 × 非新能源 × 非下钻 → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery(
        'is_transfer = false AND is_new_car = false AND is_renewal = false AND is_nev = false',
        'all', 'day', 15, 'business_nature'
      );
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-07] heatmap: 新保 × 非新能源 × 下钻(过户转保) → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '过户转保' }]);
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-08] heatmap: 续保 × 非新能源 × 下钻(续保) → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_renewal = true', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '续保' }]);
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-09] heatmap: 过户转保 × 非新能源 × 下钻(过户转保) → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_transfer = true', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '过户转保' }]);
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-10] heatmap: 非过户转保 × 非新能源 × 下钻(非过户转保) → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '非过户转保' }]);
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-11] heatmap: 新保 × 新能源 × 下钻(新保) → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_nev = true', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '新保' }]);
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });

    it('[A-12] heatmap: 续保 × 新能源 × 下钻(续保) → 包含四分类关键字', () => {
      const sql = generatePerformanceOrgHeatmapQuery('is_renewal = true AND is_nev = true', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '续保' }]);
      expect(sql).toContain('过户转保');
      expect(sql).toContain('非过户转保');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 测试组 B：不可回退到三分类
  // 断言 business_nature 维度 SQL 中不以 '其他' 作为最终分类标签。
  // ─────────────────────────────────────────────────────────────────────────

  describe('业务性质不可回退三分类（B 组）', () => {
    it("[B-01] heatmap business_nature SQL 不得包含 ELSE '其他' 作为兜底分类", () => {
      const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature');
      expect(sql).not.toContain("ELSE '其他'");
    });

    it("[B-02] heatmap business_nature 下钻 SQL 同样不得包含 ELSE '其他'", () => {
      const sql = generatePerformanceOrgHeatmapQuery('1=1', 'all', 'day', 15, 'business_nature',
        [{ dimension: 'business_nature', value: '非过户转保' }]);
      expect(sql).not.toContain("ELSE '其他'");
    });

    it("[B-03] summary business_nature 保留三分类，转保以 '其他' 为展示标签（预期行为，与 heatmap 四分类不同）", () => {
      const sql = generatePerformanceSummaryQuery('1=1', '1=1', 'all', 'month', 'mom', 'business_nature');
      // summary 维度保持三分类：新保/续保/其他（转保），是已知口径差异，不是回退
      expect(sql).toContain("ELSE '其他'");
      // expand_key 仍用 transfer_business（内部键与展示标签分离）
      expect(sql).toContain("ELSE 'transfer_business' END AS expand_key");
    });

    it("[B-04] drilldown SQL 不得包含 ELSE '其他' 作为 business_nature 分类标签", () => {
      const sql = generatePerformanceDrilldownQuery('1=1', '1=1', 'all', 'week', 'mom', [], 'org_level_3');
      expect(sql).not.toContain("ELSE '其他'");
    });
  });
});
