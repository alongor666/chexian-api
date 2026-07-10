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
    await apiClient.crossSell.trend({ granularity: 'monthly', org: '乐山' });
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
    await apiClient.crossSell.topSalesman({ rankingType: 'quality', topN: '20' });
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
    const resp = await apiClient.crossSell.heatmap({ groupByDimension: 'org_level_3', timePeriod: 'month' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/cross-sell-heatmap?');
    expect(calledUrl).toContain('groupByDimension=org_level_3');
    expect(resp.rows[0]?.penetration_rate).toBe(15);
  });

  it('performance summary endpoint preserves year and dimension（并透传删列后的行形状 · 42bf28）', async () => {
    const { apiClient } = await importClient();
    // 42bf28：汇总表恒 NULL 的 plan_premium/achievement_rate 两列已从后端与契约删除，
    // 契约行不再包含这两字段；此处以代表性行断言保留字段透传、被删字段缺席。
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          rows: [{
            coverage_combination: '整体',
            row_label: '整体',
            row_level: 0,
            expand_key: null,
            premium: 1234.5,
            auto_count: 100,
            avg_premium: 123.45,
            growth_rate: 12.3,
            nev_rate: 40,
            renewal_rate: 55,
            transfer_business_rate: 10,
            new_car_rate: 30,
            transfer_rate: 5,
          }],
        },
      }),
    });
    const resp = await apiClient.performance.summary({ year: '2026', dimension: 'team' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/performance-summary?');
    expect(calledUrl).toContain('year=2026');
    expect(calledUrl).toContain('dimension=team');
    const row = resp.rows[0]!;
    expect(row.growth_rate).toBe(12.3);
    expect('plan_premium' in row).toBe(false);
    expect('achievement_rate' in row).toBe(false);
  });

  it('performance drilldown endpoint preserves drill path payload', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    await apiClient.performance.drilldown({
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
    await apiClient.performance.orgHeatmap({ segmentTag: 'business_passenger', days: '14' });
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
    await apiClient.premium.report({ startDate: '2026-01-01', endDate: '2026-01-31', org: '乐山' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/premium-report?');
    expect(calledUrl).toContain('org=%E4%B9%90%E5%B1%B1');
  });

  it('plan achievement endpoint preserves planYear and level', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
    await apiClient.premium.achievement({ planYear: 2026, level: 'org' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/plan-achievement?');
    expect(calledUrl).toContain('planYear=2026');
    expect(calledUrl).toContain('level=org');
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

  it('policy-geo province endpoint preserves filter params', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    await apiClient.geo.province({ startDate: '2026-01-01', endDate: '2026-01-31' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/policy-geo/province?');
    expect(calledUrl).toContain('startDate=2026-01-01');
    expect(calledUrl).toContain('endDate=2026-01-31');
  });

  it('policy-geo city endpoint preserves province drill param', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    });
    await apiClient.geo.city({ province: '四川' });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/policy-geo/city?');
    expect(calledUrl).toContain('province=%E5%9B%9B%E5%B7%9D');
  });

  it('renewal-tracker endpoint preserves date range + cutoff + filter params', async () => {
    const { apiClient } = await importClient();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { orgRows: [], categoryRows: [], overall: null },
        meta: null,
      }),
    });
    await apiClient.getRenewalTracker({
      start: '2026-01-01',
      end: '2026-12-31',
      cutoff: '2026-04-18',
      orgNames: '乐山',
    });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/query/renewal-tracker?');
    expect(calledUrl).toContain('start=2026-01-01');
    expect(calledUrl).toContain('end=2026-12-31');
    expect(calledUrl).toContain('cutoff=2026-04-18');
    expect(calledUrl).toContain('orgNames=%E4%B9%90%E5%B1%B1');
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

/**
 * 命名空间子客户端 URL 契约（Phase 2 · 每域自带经验性覆盖）
 *
 * 闭合 #541 评审指出的「迁移域无测试直打 apiClient.<domain>.* 链」缺口：
 * 纯 fetch-spy 验证每个命名空间方法构造的 /query/ 路径与参数透传，
 * 比 RTL hook 测试更轻、不易 flaky。新增/迁移域时在此追加条目即可。
 *
 * path 字段约定：drilldownGet 家族（analysis/drilldown/bundle 等）必产查询串
 * （drillPath/groupBy 序列化），故其 path 带尾 `?` 以标记并精准区分于同前缀路由
 * （如 cross-sell? vs cross-sell-trend）；queryGet 家族无参时不产 `?`，path 不带尾 `?`。
 */
describe('namespaced sub-client URL contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
  });

  /** expectParam: true = 断言默认 org=乐山；字符串 = 断言自定义参数子串（schema 参数名非 org 的域用） */
  type NsCase = { name: string; path: string; run: (c: any) => Promise<unknown>; expectParam?: boolean | string; expectMethod?: 'POST' | 'PUT' | 'DELETE' };
  const cases: NsCase[] = [
    // ── claimsDetail（#541 迁移域回填）──
    { name: 'claimsDetail.pendingOverview', path: '/query/claims-detail/pending-overview', run: (c) => c.claimsDetail.pendingOverview({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.pendingByOrg', path: '/query/claims-detail/pending-by-org', run: (c) => c.claimsDetail.pendingByOrg({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.pendingAging', path: '/query/claims-detail/pending-aging', run: (c) => c.claimsDetail.pendingAging({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.causeAnalysis', path: '/query/claims-detail/cause-analysis', run: (c) => c.claimsDetail.causeAnalysis({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.geoAccident', path: '/query/claims-detail/geo-accident', run: (c) => c.claimsDetail.geoAccident({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.geoPlate', path: '/query/claims-detail/geo-plate', run: (c) => c.claimsDetail.geoPlate({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.geoComparison', path: '/query/claims-detail/geo-comparison', run: (c) => c.claimsDetail.geoComparison({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.claimCycle', path: '/query/claims-detail/claim-cycle', run: (c) => c.claimsDetail.claimCycle({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.frequencyYoy', path: '/query/claims-detail/frequency-yoy', run: (c) => c.claimsDetail.frequencyYoy({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.lossRatioDev', path: '/query/claims-detail/loss-ratio-development', run: (c) => c.claimsDetail.lossRatioDev({ org: '乐山' }), expectParam: true },
    { name: 'claimsDetail.heatmap', path: '/query/claims-detail/heatmap', run: (c) => c.claimsDetail.heatmap({ org: '乐山' }), expectParam: true },
    // ── repair（本 PR 迁移域）──
    { name: 'repair.overview', path: '/query/repair/overview', run: (c) => c.repair.overview({ org: '乐山' }), expectParam: true },
    { name: 'repair.detail', path: '/query/repair/detail', run: (c) => c.repair.detail({ org: '乐山' }), expectParam: true },
    { name: 'repair.status', path: '/query/repair/status', run: (c) => c.repair.status({ org: '乐山' }), expectParam: true },
    { name: 'repair.metadata', path: '/query/repair/metadata', run: (c) => c.repair.metadata() },
    { name: 'repair.city', path: '/query/repair/city', run: (c) => c.repair.city({ org: '乐山' }), expectParam: true },
    { name: 'repair.channel', path: '/query/repair/channel', run: (c) => c.repair.channel({ org: '乐山' }), expectParam: true },
    { name: 'repair.coopTier', path: '/query/repair/coop-tier', run: (c) => c.repair.coopTier({ org: '乐山' }), expectParam: true },
    { name: 'repair.scatter', path: '/query/repair/scatter', run: (c) => c.repair.scatter({ org: '乐山' }), expectParam: true },
    { name: 'repair.localResource', path: '/query/repair/local-resource', run: (c) => c.repair.localResource({ org: '乐山' }), expectParam: true },
    { name: 'repair.toPremium', path: '/query/repair/to-premium', run: (c) => c.repair.toPremium({ org: '乐山' }), expectParam: true },
    { name: 'repair.diversionList', path: '/query/repair/diversion-list', run: (c) => c.repair.diversionList({ org: '乐山' }), expectParam: true },
    { name: 'repair.orphanShops', path: '/query/repair/orphan-shops', run: (c) => c.repair.orphanShops({ org: '乐山' }), expectParam: true },
    // ── crossSell（本 PR 迁移域）──
    { name: 'crossSell.analysis', path: '/query/cross-sell?', run: (c) => c.crossSell.analysis({ org: '乐山' }), expectParam: true },
    { name: 'crossSell.timePeriod', path: '/query/cross-sell-summary', run: (c) => c.crossSell.timePeriod({ org: '乐山' }), expectParam: true },
    { name: 'crossSell.trend', path: '/query/cross-sell-trend', run: (c) => c.crossSell.trend({ org: '乐山' }), expectParam: true },
    { name: 'crossSell.topSalesman', path: '/query/cross-sell-top-salesman', run: (c) => c.crossSell.topSalesman({ org: '乐山' }), expectParam: true },
    { name: 'crossSell.bundle', path: '/query/cross-sell-bundle', run: (c) => c.crossSell.bundle({ org: '乐山' }), expectParam: true },
    { name: 'crossSell.orgTrend', path: '/query/cross-sell-org-trend', run: (c) => c.crossSell.orgTrend({ org: '乐山' }), expectParam: true },
    { name: 'crossSell.heatmap', path: '/query/cross-sell-heatmap', run: (c) => c.crossSell.heatmap({ org: '乐山' }), expectParam: true },
    // ── performance（本 PR 迁移域）──
    { name: 'performance.summary', path: '/query/performance-summary', run: (c) => c.performance.summary({ org: '乐山' }), expectParam: true },
    { name: 'performance.trend', path: '/query/performance-trend', run: (c) => c.performance.trend({ org: '乐山' }), expectParam: true },
    { name: 'performance.drilldown', path: '/query/performance-drilldown?', run: (c) => c.performance.drilldown({ org: '乐山' }), expectParam: true },
    { name: 'performance.orgHeatmap', path: '/query/performance-org-heatmap', run: (c) => c.performance.orgHeatmap({ org: '乐山' }), expectParam: true },
    { name: 'performance.topSalesman', path: '/query/performance-top-salesman', run: (c) => c.performance.topSalesman({ org: '乐山' }), expectParam: true },
    { name: 'performance.bundle', path: '/query/performance-bundle?', run: (c) => c.performance.bundle({ org: '乐山' }), expectParam: true },
    // ── customerFlow（本 PR 迁移域）──
    { name: 'customerFlow.summary', path: '/query/customer-flow/summary', run: (c) => c.customerFlow.summary({ org: '乐山' }), expectParam: true },
    { name: 'customerFlow.outflow', path: '/query/customer-flow/outflow', run: (c) => c.customerFlow.outflow({ org: '乐山' }), expectParam: true },
    { name: 'customerFlow.trend', path: '/query/customer-flow/trend', run: (c) => c.customerFlow.trend({ org: '乐山' }), expectParam: true },
    { name: 'customerFlow.metadata', path: '/query/customer-flow/metadata', run: (c) => c.customerFlow.metadata() },
    // ── ai（迁移域）──
    { name: 'ai.capabilities', path: '/ai/capabilities', run: (c) => c.ai.capabilities() },
    { name: 'ai.quickSuggestions', path: '/ai/quick-suggestions', run: (c) => c.ai.quickSuggestions() },
    { name: 'ai.detectRequirement POST', path: '/ai/detect-requirement', run: (c) => c.ai.detectRequirement({ message: '查一下出险率' }), expectMethod: 'POST' },
    // ── data（迁移域）──
    { name: 'data.files', path: '/data/files', run: (c) => c.data.files() },
    { name: 'data.load', path: '/data/load/test.parquet', run: (c) => c.data.load('test.parquet'), expectMethod: 'POST' },
    { name: 'data.version', path: '/data/version', run: (c) => c.data.version() },
    // ── workflows（本 PR 迁移域）──
    { name: 'workflows.run', path: '/workflows/runs/r1', run: (c) => c.workflows.run('r1') },
    { name: 'workflows.audit', path: '/workflows/runs/r1/audit', run: (c) => c.workflows.audit('r1') },
    { name: 'workflows.approve', path: '/workflows/runs/r1/approve', run: (c) => c.workflows.approve('r1'), expectMethod: 'POST' },
    { name: 'workflows.reject', path: '/workflows/runs/r1/reject', run: (c) => c.workflows.reject('r1', 'too risky'), expectMethod: 'POST' },
    { name: 'workflows.runsHealth', path: '/workflows/health/runs-summary', run: (c) => c.workflows.runsHealth() },
    // ── auth（本 PR 迁移域：12 个无状态 CRUD；login/logout/getCurrentUser 仍在基类）──
    { name: 'auth.listUsers', path: '/auth/users', run: (c) => c.auth.listUsers() },
    { name: 'auth.createUser POST', path: '/auth/users', run: (c) => c.auth.createUser({ username: 'u', displayName: 'U', password: 'p', role: 'analyst' }), expectMethod: 'POST' },
    { name: 'auth.updateUser PUT', path: '/auth/users/u1', run: (c) => c.auth.updateUser('u1', { displayName: 'U', role: 'analyst' }), expectMethod: 'PUT' },
    { name: 'auth.deleteUser DELETE', path: '/auth/users/u1', run: (c) => c.auth.deleteUser('u1'), expectMethod: 'DELETE' },
    { name: 'auth.listMyTokens', path: '/auth/tokens', run: (c) => c.auth.listMyTokens() },
    { name: 'auth.createMyToken POST', path: '/auth/tokens', run: (c) => c.auth.createMyToken({ name: 't', ttlDays: 30 }), expectMethod: 'POST' },
    { name: 'auth.revokeMyToken DELETE', path: '/auth/tokens/t1', run: (c) => c.auth.revokeMyToken('t1'), expectMethod: 'DELETE' },
    { name: 'auth.listRoles', path: '/auth/roles', run: (c) => c.auth.listRoles() },
    { name: 'auth.createRole POST', path: '/auth/roles', run: (c) => c.auth.createRole({ role: 'r', name: 'R', dataScope: 'all' }), expectMethod: 'POST' },
    { name: 'auth.updateRole PUT', path: '/auth/roles/r1', run: (c) => c.auth.updateRole('r1', { name: 'R', dataScope: 'all' }), expectMethod: 'PUT' },
    { name: 'auth.deleteRole DELETE', path: '/auth/roles/r1', run: (c) => c.auth.deleteRole('r1'), expectMethod: 'DELETE' },
    { name: 'auth.getFeishuConfig', path: '/auth/feishu/config', run: (c) => c.auth.getFeishuConfig() },
    // ── premium（本 PR 残渣域归并）──
    { name: 'premium.report', path: '/query/premium-report?', run: (c) => c.premium.report({ org: '乐山' }), expectParam: true },
    { name: 'premium.plan', path: '/query/premium-plan?', run: (c) => c.premium.plan({ org: '乐山' }), expectParam: true },
    // achievement 的真实 schema 参数是 planYear/level/orgFilter…（非 org），夹具用真名以文档化用法
    { name: 'premium.achievement', path: '/query/plan-achievement?', run: (c) => c.premium.achievement({ orgFilter: '乐山' }), expectParam: 'orgFilter=%E4%B9%90%E5%B1%B1' },
    // ── geo（本 PR 残渣域归并）──
    { name: 'geo.province', path: '/query/policy-geo/province?', run: (c) => c.geo.province({ org: '乐山' }), expectParam: true },
    { name: 'geo.city', path: '/query/policy-geo/city?', run: (c) => c.geo.city({ org: '乐山' }), expectParam: true },
  ];

  it.each(cases)('$name builds $path', async ({ run, path, expectParam, expectMethod }) => {
    const { apiClient } = await importClient();
    await run(apiClient);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain(path);
    if (expectParam) {
      // true = 默认 org=乐山；字符串 = 自定义参数子串（如 achievement 的 orgFilter）
      expect(calledUrl).toContain(expectParam === true ? 'org=%E4%B9%90%E5%B1%B1' : expectParam);
    } else {
      expect(calledUrl).not.toContain('?');
    }
    // 变更端点：method 是迁移关键位（URL 不变也能误把 POST/DELETE 改成别的动词丢语义），单独断言
    if (expectMethod) {
      const init = mockFetch.mock.calls[0][1] as RequestInit | undefined;
      expect(init?.method).toBe(expectMethod);
    }
  });

  // data.upload 是 multipart，走原生 fetch 而非 t.request()，单独测试
  it('data.upload sends multipart POST to /data/upload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { filename: 'test.parquet', rowCount: 100, fileSizeMB: 1 } }),
    });

    const { apiClient } = await importClient();
    const file = new File(['content'], 'test.parquet', { type: 'application/octet-stream' });
    const result = await apiClient.data.upload(file);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const calledInit = mockFetch.mock.calls[0][1] as RequestInit;
    expect(calledUrl).toContain('/data/upload');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBeInstanceOf(FormData);
    expect((result as any).rowCount).toBe(100);
  });
});
