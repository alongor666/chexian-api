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
}));

vi.mock('../../utils/logger.js', () => ({
  logger: loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { STARTUP_DOMAIN_WARMUP_TIMEOUT_MS, cacheWarmer } from '../cache-warmer.js';

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

  it('内部启动预热按 ClaimsDetail → ClaimsAgg → CrossSell 顺序长等待，避免 CrossSell 长物化挡住 KPI 依赖', async () => {
    await cacheWarmer.warmStartupCritical();

    expect(ensureDomainLoadedMock).toHaveBeenNthCalledWith(1, 'ClaimsDetail', {
      timeoutMs: STARTUP_DOMAIN_WARMUP_TIMEOUT_MS,
    });
    expect(ensureDomainLoadedMock).toHaveBeenNthCalledWith(2, 'ClaimsAgg', {
      timeoutMs: STARTUP_DOMAIN_WARMUP_TIMEOUT_MS,
    });
    expect(ensureDomainLoadedMock).toHaveBeenNthCalledWith(3, 'CrossSell', {
      timeoutMs: STARTUP_DOMAIN_WARMUP_TIMEOUT_MS,
    });
    expect(fetchDashboardBundleDataMock).toHaveBeenCalledTimes(1);
  });

  it('关键域预热失败时不继续生成 dashboard 或启动 top-org 背景预热', async () => {
    ensureDomainLoadedMock.mockRejectedValueOnce(new Error('Domain CrossSell loading timeout (15000ms)'));

    await cacheWarmer.warmStartupCritical();
    await Promise.resolve();

    expect(fetchDashboardBundleDataMock).not.toHaveBeenCalled();
    expect(setRouteCacheMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
