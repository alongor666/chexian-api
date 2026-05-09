import { describe, it, expect } from 'vitest';
import { cacheWarmer } from '../cache-warmer.js';

describe('cacheWarmer.warmCommonRoutes', () => {
  const range = { startDate: '2026-01-01', maxDate: '2026-05-08' };

  it('buildCommonRouteTasks: 默认 6 路由 × 6 机构 = 36 个任务', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    expect(tasks.length).toBe(6 * 6);
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

  it('包含头部机构（天府、宜宾、高新、青羊、泸州）的任务', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const orgLabels = tasks.map((t) => t.label).join('|');
    for (const org of ['天府', '宜宾', '高新', '青羊', '泸州']) {
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

  it('renewal-tracker 路由 query 用 start/end/cutoff（对齐前端 useRenewalTracker，非 commonFilterSchema）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const t = tasks.find((x) => x.url.includes('/api/query/renewal-tracker?'));
    expect(t).toBeDefined();
    // 续保追踪用独立时间协议（expiry_date 语义）
    expect(t!.url).toContain('start=2026-01-01');
    expect(t!.url).toContain('end=2026-05-08');
    expect(t!.url).toContain('cutoff=2026-05-08');
    // 必须不带 dateField/startDate/endDate（commonFilterSchema 的 key）
    expect(t!.url).not.toContain('dateField=');
    expect(t!.url).not.toContain('startDate=');
    expect(t!.url).not.toContain('endDate=');
  });

  it('renewal-tracker 全公司任务不带 orgNames（与前端 if filters.org_level_3.length>0 一致）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(range);
    const allOrg = tasks.filter(
      (x) => x.url.includes('/api/query/renewal-tracker?') && x.label.includes('(all)'),
    );
    expect(allOrg.length).toBe(1);
    expect(allOrg[0].url).not.toContain('orgNames=');
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
});
