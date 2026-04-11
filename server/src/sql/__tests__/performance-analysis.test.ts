import { describe, expect, it } from 'vitest';
import {
  generatePerformanceSummaryQuery,
  generatePerformancePeriodBoundsQuery,
  generatePerformanceTrendQuery,
  generatePerformanceDrilldownQuery,
  generatePerformanceTopSalesmanQuery,
} from '../performance-analysis.js';

// ── 共享参数 ──

const WHERE_WITH_DATE = "CAST(policy_date AS DATE) >= '2026-01-01' AND CAST(policy_date AS DATE) <= '2026-03-31'";
const WHERE_WITHOUT_DATE = '1=1';
const SEGMENT = 'all' as const;
const TIME_PERIOD = 'month' as const;
const GROWTH_MODE = 'mom' as const;

// ═══════════════════════════════════════════════════
// 1. Summary 查询
// ═══════════════════════════════════════════════════

describe('generatePerformanceSummaryQuery', () => {
  it('基本结构：period_bounds + filtered + CTE', () => {
    const sql = generatePerformanceSummaryQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('period_bounds');
    expect(sql).toContain('filtered');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('输出核心业务指标', () => {
    const sql = generatePerformanceSummaryQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('premium_wan');
    expect(sql).toContain('auto_count');
  });

  it('expandDims=energy 时有油电展开行', () => {
    const sql = generatePerformanceSummaryQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE, 'energy'
    );
    expect(sql).toContain('is_nev_bool');
    expect(sql).toContain('child_current');
  });

  it('expandDims=none 默认汇总模式', () => {
    const sql = generatePerformanceSummaryQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE, 'none'
    );
    // 无 expand 时返回有效 SQL
    expect(sql.length).toBeGreaterThan(200);
    expect(sql).toContain('premium_wan');
  });
});

// ═══════════════════════════════════════════════════
// 2. PeriodBounds 查询
// ═══════════════════════════════════════════════════

describe('generatePerformancePeriodBoundsQuery', () => {
  it('返回 5 个日期边界字段', () => {
    const sql = generatePerformancePeriodBoundsQuery(WHERE_WITH_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE);
    expect(sql).toContain('ref_date');
    expect(sql).toContain('current_start');
    expect(sql).toContain('current_end');
    expect(sql).toContain('prev_start');
    expect(sql).toContain('prev_end');
  });

  it('包含 period_bounds CTE', () => {
    const sql = generatePerformancePeriodBoundsQuery(WHERE_WITH_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE);
    expect(sql).toContain('period_bounds');
  });
});

// ═══════════════════════════════════════════════════
// 3. Trend 查询
// ═══════════════════════════════════════════════════

describe('generatePerformanceTrendQuery', () => {
  it('基本结构：base_rows + selected_rows + line_source', () => {
    const sql = generatePerformanceTrendQuery(WHERE_WITH_DATE, SEGMENT, 'monthly');
    expect(sql).toContain('base_rows');
    expect(sql).toContain('selected_rows');
    expect(sql).toContain('line_source');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('输出趋势字段', () => {
    const sql = generatePerformanceTrendQuery(WHERE_WITH_DATE, SEGMENT, 'monthly');
    expect(sql).toContain('time_period');
    expect(sql).toContain('line_key');
    expect(sql).toContain('premium');
    expect(sql).toContain('auto_count');
    expect(sql).toContain('ORDER BY time_period');
  });

  it.each(['daily', 'weekly', 'monthly'] as const)('粒度 %s 生成有效 SQL', (gran) => {
    const sql = generatePerformanceTrendQuery(WHERE_WITH_DATE, SEGMENT, gran);
    expect(sql.length).toBeGreaterThan(100);
  });

  it('segmentTag=truck 包含货车筛选', () => {
    const sql = generatePerformanceTrendQuery(WHERE_WITH_DATE, 'truck', 'monthly');
    expect(sql).toContain('segment_tag');
  });
});

// ═══════════════════════════════════════════════════
// 4. Drilldown 查询
// ═══════════════════════════════════════════════════

describe('generatePerformanceDrilldownQuery', () => {
  it('基本结构：包含 period_bounds + filtered', () => {
    const sql = generatePerformanceDrilldownQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('period_bounds');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('默认无 drillPath 时有分组', () => {
    const sql = generatePerformanceDrilldownQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('GROUP BY');
  });

  it('自定义 groupBy 维度', () => {
    const sql = generatePerformanceDrilldownQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE,
      [], 'org_level_3'
    );
    expect(sql).toContain('org_level_3');
  });
});

// ═══════════════════════════════════════════════════
// 5. TopSalesman 查询
// ═══════════════════════════════════════════════════

describe('generatePerformanceTopSalesmanQuery', () => {
  it('基本结构', () => {
    const sql = generatePerformanceTopSalesmanQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('salesman_name');
  });

  it('有 LIMIT', () => {
    const sql = generatePerformanceTopSalesmanQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('LIMIT');
  });

  it('输出保费和件数', () => {
    const sql = generatePerformanceTopSalesmanQuery(
      WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE
    );
    expect(sql).toContain('premium');
    expect(sql).toContain('auto_count');
  });
});

// ═══════════════════════════════════════════════════
// 6. 所有生成器返回非空 SQL
// ═══════════════════════════════════════════════════

describe('所有生成器返回有效 SQL', () => {
  const generators = [
    () => generatePerformanceSummaryQuery(WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE),
    () => generatePerformancePeriodBoundsQuery(WHERE_WITH_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE),
    () => generatePerformanceTrendQuery(WHERE_WITH_DATE, SEGMENT, 'monthly'),
    () => generatePerformanceDrilldownQuery(WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE),
    () => generatePerformanceTopSalesmanQuery(WHERE_WITH_DATE, WHERE_WITHOUT_DATE, SEGMENT, TIME_PERIOD, GROWTH_MODE),
  ];

  it.each(generators.map((fn, i) => [i, fn]))('生成器 #%i 返回有效 SQL', (_, fn) => {
    const sql = (fn as () => string)();
    expect(sql.length).toBeGreaterThan(100);
    expect(sql).not.toMatch(/^\s*$/);
  });
});
