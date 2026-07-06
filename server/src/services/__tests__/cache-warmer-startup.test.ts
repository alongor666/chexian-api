import { beforeEach, describe, expect, it, vi } from 'vitest';

var queryMock: ReturnType<typeof vi.fn>;
var setRouteCacheMock: ReturnType<typeof vi.fn>;
var fetchDashboardBundleDataMock: ReturnType<typeof vi.fn>;
var ensureDomainLoadedMock: ReturnType<typeof vi.fn>;
var loggerMock: {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

vi.mock('../duckdb.js', () => ({
  duckdbService: {
    query: queryMock = vi.fn(),
  },
}));

vi.mock('../route-cache.js', () => ({
  setRouteCache: setRouteCacheMock = vi.fn(),
}));

vi.mock('../../routes/query.js', () => ({
  fetchDashboardBundleData: fetchDashboardBundleDataMock = vi.fn(),
}));

vi.mock('../../routes/query/shared.js', () => ({
  QUERY_CACHE: {
    hotspotShort: 3_600_000,
    hotspotMedium: 7_200_000,
    hotspotLong: 14_400_000,
  },
}));

vi.mock('../bootstrapper-registry.js', () => {
  ensureDomainLoadedMock = vi.fn();
  return {
    getBootstrapper: () => ({
      ensureDomainLoaded: ensureDomainLoadedMock,
    }),
  };
});

vi.mock('../data-version.js', () => ({
  getDataVersion: () => 'test-version',
}));

vi.mock('../../config/auth.js', () => ({
  authConfig: { jwtSecret: 'test-secret' },
}));

vi.mock('../../config/env.js', () => ({
  serverEnv: { PORT: 3100 },
  // 0B: cache-warmer 通过 dbEnv.BRANCH_RLS_ENABLED 判定是否按 branch 循环；默认 off 保持单 variant
  dbEnv: { BRANCH_RLS_ENABLED: 'false' },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { STARTUP_DOMAIN_WARMUP_TIMEOUT_MS, POST_LISTEN_DOMAIN_WARMUP_TIMEOUT_MS, cacheWarmer } from '../cache-warmer.js';

describe('cacheWarmer.warmStartupCritical', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(policy_date)')) return [{ max_date: '2026-05-08' }];
      return [];
    });
    ensureDomainLoadedMock.mockResolvedValue(undefined);
    fetchDashboardBundleDataMock.mockResolvedValue({ success: true, data: {} });
  });

  it('listen 前启动预热只等 ClaimsDetail → ClaimsAgg（KPI 首屏硬依赖），不含 CrossSell（294022：长物化曾挡住 listen 致全站 502）', async () => {
    await cacheWarmer.warmStartupCritical();

    expect(ensureDomainLoadedMock).toHaveBeenNthCalledWith(1, 'ClaimsDetail', {
      timeoutMs: STARTUP_DOMAIN_WARMUP_TIMEOUT_MS,
    });
    expect(ensureDomainLoadedMock).toHaveBeenNthCalledWith(2, 'ClaimsAgg', {
      timeoutMs: STARTUP_DOMAIN_WARMUP_TIMEOUT_MS,
    });
    expect(ensureDomainLoadedMock).toHaveBeenCalledTimes(2);
    expect(ensureDomainLoadedMock).not.toHaveBeenCalledWith('CrossSell', expect.anything());
    expect(fetchDashboardBundleDataMock).toHaveBeenCalledTimes(1);
  });

  it('关键域预热失败时不继续生成 dashboard 或启动 top-org 背景预热', async () => {
    ensureDomainLoadedMock.mockRejectedValueOnce(new Error('Domain ClaimsAgg loading timeout (15000ms)'));

    await cacheWarmer.warmStartupCritical();
    await Promise.resolve();

    expect(fetchDashboardBundleDataMock).not.toHaveBeenCalled();
    expect(setRouteCacheMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe('cacheWarmer.warmPostListenDomains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDomainLoadedMock.mockResolvedValue(undefined);
  });

  it('listen 后异步预热 CrossSell，使用长超时（物化 VPS 实测可达数分钟）', async () => {
    await cacheWarmer.warmPostListenDomains();

    expect(ensureDomainLoadedMock).toHaveBeenCalledTimes(1);
    expect(ensureDomainLoadedMock).toHaveBeenCalledWith('CrossSell', {
      timeoutMs: POST_LISTEN_DOMAIN_WARMUP_TIMEOUT_MS,
    });
  });

  it('单个域预热失败/超时不抛出（吞掉错误保证后续 warmCommonRoutes 链不被中断），仅记录 warn', async () => {
    ensureDomainLoadedMock.mockRejectedValueOnce(new Error('Domain CrossSell loading timeout (600000ms)'));

    await expect(cacheWarmer.warmPostListenDomains()).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });
});
