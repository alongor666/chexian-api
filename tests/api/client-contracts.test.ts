import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

async function importClient() {
  return import('../../src/shared/api/client');
}

describe('API client contract coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
  });

  it('truck endpoint preserves queryType and metric', async () => {
    const { apiClient } = await importClient();
    await apiClient.getTruckAnalysis({ queryType: 'all', metric: 'premium' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/truck?');
    expect(calledUrl).toContain('queryType=all');
    expect(calledUrl).toContain('metric=premium');
  });

  it('cross-sell trend endpoint preserves time granularity and path', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { labels: [], series: {} } }),
    });
    await apiClient.getCrossSellTrend({ granularity: 'monthly', org: '乐山' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/cross-sell-trend?');
    expect(calledUrl).toContain('granularity=monthly');
    expect(calledUrl).toContain('org=%E4%B9%90%E5%B1%B1');
  });

  it('cross-sell top-salesman endpoint preserves ranking params', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { rows: [] } }),
    });
    await apiClient.getCrossSellTopSalesman({ rankingType: 'quality', topN: '20' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/cross-sell-top-salesman?');
    expect(calledUrl).toContain('rankingType=quality');
    expect(calledUrl).toContain('topN=20');
  });

  it('cross-sell heatmap endpoint keeps penetration_rate contract', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          rows: [{
            date: '2026-03-07',
            org_level_3: '分公司',
            auto_count: 10,
            driver_count: 5,
            driver_policy_count: 5,
            driver_premium: 1200,
            penetration_base_premium: 8000,
            rate: 50,
            penetration_rate: 15,
            avg_premium: 240,
            achievement_rate: 100,
          }],
        },
      }),
    });
    const resp = await apiClient.getCrossSellHeatmap({ groupByDimension: 'org_level_3', timePeriod: 'month' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/cross-sell-heatmap?');
    expect(calledUrl).toContain('groupByDimension=org_level_3');
    expect(resp.rows[0]?.penetration_rate).toBe(15);
  });

  it('performance summary endpoint preserves year and dimension', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    await apiClient.getPerformanceSummary({ year: '2026', dimension: 'team' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/performance-summary?');
    expect(calledUrl).toContain('year=2026');
    expect(calledUrl).toContain('dimension=team');
  });

  it('performance drilldown endpoint preserves drill path payload', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    await apiClient.getPerformanceDrilldown({
      year: '2026',
      level: 'salesman',
      parentValue: '天府',
    });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/performance-drilldown?');
    expect(calledUrl).toContain('level=salesman');
    expect(calledUrl).toContain('parentValue=');
  });


  it('performance heatmap endpoint preserves segment and days params', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { rows: [] } }),
    });
    await apiClient.getPerformanceOrgHeatmap({ segmentTag: 'business_passenger', days: '14' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/performance-org-heatmap?');
    expect(calledUrl).toContain('segmentTag=business_passenger');
    expect(calledUrl).toContain('days=14');
  });

  it('marketing report endpoint preserves date range filters', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    await apiClient.getMarketingReport({ startDate: '2026-01-01', endDate: '2026-01-31', groupBy: 'org' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/marketing-report?');
    expect(calledUrl).toContain('startDate=2026-01-01');
    expect(calledUrl).toContain('endDate=2026-01-31');
    expect(calledUrl).toContain('groupBy=org');
  });

  it('premium report endpoint preserves scope filters', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    await apiClient.getPremiumReport({ startDate: '2026-01-01', endDate: '2026-01-31', org: '乐山' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/premium-report?');
    expect(calledUrl).toContain('org=%E4%B9%90%E5%B1%B1');
  });

  it('plan achievement endpoint preserves planType and dimension', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    await apiClient.getPlanAchievement({ year: 2026, planType: 'driver', dimension: 'org' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/plan-achievement?');
    expect(calledUrl).toContain('planType=driver');
    expect(calledUrl).toContain('dimension=org');
  });

  it('filter options endpoint remains stable', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    await apiClient.getFilterOptions();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/filters/options');
  });

  it('comprehensive bundle endpoint preserves granularity and cutoffDate', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { meta: {}, overview: {}, premium: {}, cost: {}, loss: {}, expense: {}, roi: {} } }),
    });
    await apiClient.getComprehensiveBundle({
      granularity: 'monthly',
      cutoffDate: '2026-02-27',
      orgNames: '天府',
    });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/comprehensive-bundle?');
    expect(calledUrl).toContain('granularity=monthly');
    expect(calledUrl).toContain('cutoffDate=2026-02-27');
    expect(calledUrl).toContain('orgNames=');
  });
});
