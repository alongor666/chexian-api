import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

const { candidate, loadMock } = vi.hoisted(() => ({
  candidate: `/tmp/chexian-sales-team-missing-${process.pid}.parquet`,
  loadMock: vi.fn(),
}));

vi.mock('../../config/paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config/paths.js')>()),
  getSalesTeamPerformancePaths: () => [candidate],
}));

vi.mock('../duckdb-domain-loaders.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../duckdb-domain-loaders.js')>()),
  loadSalesTeamPerformance: loadMock,
}));

import { DataBootstrapper } from '../data-bootstrapper.js';

describe('SalesTeamPerformance 缺文件恢复', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(candidate, { force: true });
  });

  afterEach(() => fs.rmSync(candidate, { force: true }));

  it('缺文件返回 503 且保持可重试，文件出现后第二次加载成功', async () => {
    const bootstrapper = new DataBootstrapper({} as any);
    (bootstrapper as any).registerLazyDomains();

    await expect(bootstrapper.ensureDomainLoaded('SalesTeamPerformance')).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(bootstrapper.getDomainState('SalesTeamPerformance')).toBe('unloaded');
    expect(loadMock).not.toHaveBeenCalled();

    fs.writeFileSync(candidate, 'fixture');
    await bootstrapper.ensureDomainLoaded('SalesTeamPerformance');
    expect(loadMock).toHaveBeenCalledWith(expect.anything(), candidate);
    expect(bootstrapper.getDomainState('SalesTeamPerformance')).toBe('loaded');
  });
});
