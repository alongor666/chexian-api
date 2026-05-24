import { describe, it, expect } from 'vitest';
import { cacheWarmer, getWarmRetryDelayMs, resolveWarmEndDate } from '../cache-warmer.js';

describe('cacheWarmer.warmCommonRoutes', () => {
  const range = { startDate: '2026-01-01', maxDate: '2026-05-08' };

  it('resolveWarmEndDate: 当今天仍在数据年度且晚于最大数据日时，预热 key 对齐今天', () => {
    expect(resolveWarmEndDate('2026-05-23', '2026-05-24')).toBe('2026-05-24');
    expect(resolveWarmEndDate('2026-05-24', '2026-05-24')).toBe('2026-05-24');
    expect(resolveWarmEndDate('2025-12-31', '2026-05-24')).toBe('2025-12-31');
    expect(resolveWarmEndDate(null, '2026-05-24')).toBeNull();
  });

  it('buildCommonRouteTasks: 默认 5 路由 × 13 机构 + 3 个全公司 performance 任务 = 68 个任务', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    expect(tasks.length).toBe(5 * 13 + 3);
  });

  it('每个任务 URL 含 dateField/startDate/endDate；首条无 orgNames（全公司）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const first = tasks[0];
    expect(first.url).toContain('dateField=policy_date');
    expect(first.url).toContain('startDate=2026-01-01');
    expect(first.url).toContain('endDate=2026-05-08');
    expect(first.url).not.toContain('orgNames=');
    expect(first.label).toContain('(all)');
  });

  it('包含 12 机构验收集的任务', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const orgLabels = tasks.map((t) => t.label).join('|');
    for (const org of ['天府', '宜宾', '高新', '青羊', '泸州', '新都', '武侯', '乐山', '德阳', '自贡', '资阳', '达州']) {
      expect(orgLabels).toContain(`org=${org}`);
    }
  });

  it('trend 路由 query 含 granularity=day + perspective=premium（对齐前端 useTrendData）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const trendTask = tasks.find((t) => t.url.includes('/api/query/trend?'));
    expect(trendTask).toBeDefined();
    expect(trendTask!.url).toContain('granularity=day');
    expect(trendTask!.url).toContain('perspective=premium');
  });

  it('cost 路由 query 含 cutoffDate=maxDate（必填字段）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const costTask = tasks.find((t) => t.url.includes('/api/query/cost?'));
    expect(costTask).toBeDefined();
    expect(costTask!.url).toContain('cutoffDate=2026-05-08');
  });

  it('salesman-ranking 路由 query 含 limit=20（对齐前端 getSalesmanRanking 默认）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const t = tasks.find((x) => x.url.includes('/api/query/salesman-ranking?'));
    expect(t).toBeDefined();
    expect(t!.url).toContain('limit=20');
  });

  it('performance benchmark 路由只预热全公司固定 key，避免机构笛卡尔放大', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const performanceTasks = tasks.filter((t) => t.path.startsWith('/api/query/performance'));

    expect(performanceTasks.map((t) => t.path).sort()).toEqual([
      '/api/query/performance-bundle',
      '/api/query/performance-summary',
      '/api/query/performance-top-salesman',
    ]);
    expect(performanceTasks.every((t) => t.org === null)).toBe(true);

    const bundle = performanceTasks.find((t) => t.path === '/api/query/performance-bundle');
    expect(bundle).toBeDefined();
    expect(bundle!.url).toContain('segmentTag=all');
    expect(bundle!.url).toContain('timePeriod=month');
    expect(bundle!.url).toContain('growthMode=mom');
    expect(bundle!.url).toContain('expandDims=none');

    const bundleUrl = new URL(bundle!.url);
    expect(bundleUrl.searchParams.has('granularity')).toBe(false);
    expect(bundleUrl.searchParams.has('limit')).toBe(false);

    const topSalesman = performanceTasks.find((t) => t.path === '/api/query/performance-top-salesman');
    expect(topSalesman).toBeDefined();
    expect(new URL(topSalesman!.url).searchParams.has('limit')).toBe(false);
  });

  it('KPI 预热任务使用更长 timeout，避免 15s abort 导致关键 key 未写入 cache', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const kpiTask = tasks.find((t) => t.path === '/api/query/kpi' && t.org === null);
    const trendTask = tasks.find((t) => t.path === '/api/query/trend' && t.org === null);

    expect(kpiTask).toBeDefined();
    expect(trendTask).toBeDefined();
    expect(kpiTask!.timeoutMs).toBeGreaterThan(trendTask!.timeoutMs);
    expect(kpiTask!.timeoutMs).toBeGreaterThanOrEqual(45_000);
  });

  it('显式传入路由/机构 → 任务数 = routes × orgs', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(
      range,
      [
        {
          path: '/api/query/foo',
          ttlMs: 60_000,
          buildQuery: (r, org) => {
            const q: Record<string, string> = { startDate: r.startDate, endDate: r.maxDate };
            if (org) q.orgNames = org;
            return q;
          },
        },
      ],
      [null, '天府', '宜宾'],
    );
    expect(tasks.length).toBe(3);
    expect(tasks[0].label).toBe('/api/query/foo (all)');
    expect(tasks[1].label).toBe('/api/query/foo org=天府');
    expect(tasks[2].label).toBe('/api/query/foo org=宜宾');
  });

  it('orgNames 中文按 URLSearchParams 编码进 URL', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const tianfu = tasks.find((t) => t.label.includes('org=天府'));
    expect(tianfu).toBeDefined();
    expect(tianfu!.url).toMatch(/orgNames=%E5%A4%A9%E5%BA%9C/);
  });

  it('空 routes 或空 orgs → 返回空任务清单', () => {
    expect(cacheWarmer.buildCommonRouteTasks(range, [], ['天府']).length).toBe(0);
    expect(
      cacheWarmer.buildCommonRouteTasks(
        range,
        [{ path: '/x', ttlMs: 1, buildQuery: () => ({}) }],
        [],
      ).length,
    ).toBe(0);
  });

  it('预热按 VPS 负载分阶段：全公司先跑，KPI/趋势机构请求单并发', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const batches = cacheWarmer.buildWarmTaskBatches(tasks);

    expect(batches[0].name).toBe('all-company');
    expect(batches[0].concurrency).toBe(1);
    expect(batches[0].tasks.length).toBe(8);
    expect(batches[0].tasks.every((task) => task.org === null)).toBe(true);

    const orgKpi = batches.find((batch) => batch.name === 'org-kpi');
    expect(orgKpi).toBeDefined();
    expect(orgKpi!.concurrency).toBe(1);
    expect(orgKpi!.tasks.length).toBe(12);
    expect(orgKpi!.tasks.every((task) => task.path === '/api/query/kpi' && task.org)).toBe(true);

    const orgTrend = batches.find((batch) => batch.name === 'org-trend');
    expect(orgTrend).toBeDefined();
    expect(orgTrend!.concurrency).toBe(1);
    expect(orgTrend!.tasks.every((task) => task.path === '/api/query/trend' && task.org)).toBe(true);

    const maxOrgConcurrency = Math.max(...batches.filter((batch) => batch.name !== 'all-company').map((batch) => batch.concurrency));
    expect(maxOrgConcurrency).toBeLessThanOrEqual(2);
  });

  it('失败重试使用递增退避，避免瞬时池压力下立即重打', () => {
    expect(getWarmRetryDelayMs(1)).toBeGreaterThan(0);
    expect(getWarmRetryDelayMs(2)).toBeGreaterThan(getWarmRetryDelayMs(1));
  });
});
