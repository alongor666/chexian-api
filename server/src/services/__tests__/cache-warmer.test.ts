import { describe, it, expect } from 'vitest';
import { cacheWarmer } from '../cache-warmer.js';

describe('cacheWarmer.warmCommonRoutes', () => {
  it('buildCommonRouteTasks: 默认 12 路由 × 6 机构 = 72 个任务', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks({
      startDate: '2026-01-01',
      maxDate: '2026-05-08',
    });
    expect(tasks.length).toBe(12 * 6);
  });

  it('每个任务 URL 含 dateField/startDate/endDate；首条无 orgNames（全公司）', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks({
      startDate: '2026-01-01',
      maxDate: '2026-05-08',
    });
    const first = tasks[0];
    expect(first.url).toContain('dateField=policy_date');
    expect(first.url).toContain('startDate=2026-01-01');
    expect(first.url).toContain('endDate=2026-05-08');
    expect(first.url).not.toContain('orgNames=');
    expect(first.label).toContain('(all)');
  });

  it('包含头部机构（天府、宜宾、高新、青羊、泸州）的任务', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks({
      startDate: '2026-01-01',
      maxDate: '2026-05-08',
    });
    const orgLabels = tasks.map((t) => t.label).join('|');
    for (const org of ['天府', '宜宾', '高新', '青羊', '泸州']) {
      expect(orgLabels).toContain(`org=${org}`);
    }
  });

  it('显式传入路由/机构参数 → 任务数 = routes × orgs', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(
      { startDate: '2026-01-01', maxDate: '2026-05-08' },
      [{ path: '/api/query/foo', ttlMs: 60_000 }],
      [null, '天府', '宜宾'],
    );
    expect(tasks.length).toBe(3);
    expect(tasks[0].label).toBe('/api/query/foo (all)');
    expect(tasks[1].label).toBe('/api/query/foo org=天府');
    expect(tasks[2].label).toBe('/api/query/foo org=宜宾');
  });

  it('orgNames 中文按 URLSearchParams 编码进 URL', () => {
    const tasks = cacheWarmer.buildCommonRouteTasks(
      { startDate: '2026-01-01', maxDate: '2026-05-08' },
      [{ path: '/api/query/x', ttlMs: 60_000 }],
      ['天府'],
    );
    expect(tasks[0].url).toMatch(/orgNames=%E5%A4%A9%E5%BA%9C/);
  });

  it('空 routes 或空 orgs → 返回空任务清单', () => {
    expect(
      cacheWarmer.buildCommonRouteTasks(
        { startDate: '2026-01-01', maxDate: '2026-05-08' },
        [],
        ['天府'],
      ).length,
    ).toBe(0);
    expect(
      cacheWarmer.buildCommonRouteTasks(
        { startDate: '2026-01-01', maxDate: '2026-05-08' },
        [{ path: '/x', ttlMs: 1 }],
        [],
      ).length,
    ).toBe(0);
  });
});
