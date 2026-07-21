import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const duckdbQuery = vi.hoisted(() => vi.fn());

vi.mock('../../../services/duckdb.js', () => ({
  duckdbService: { query: duckdbQuery },
}));

import { resolveRequiredPlanFactBranchCode } from '../shared.js';

const req = (branchCode: string): Request => ({
  effectiveBranch: branchCode,
  permissionFilter: `branch_code = '${branchCode}'`,
  user: { branchCode },
} as unknown as Request);

describe('resolveRequiredPlanFactBranchCode', () => {
  beforeEach(() => duckdbQuery.mockReset());

  it('SX 运行时 PlanFact 有 branch_code 时返回 SX', async () => {
    duckdbQuery.mockResolvedValue([{ cnt: 1 }]);
    await expect(resolveRequiredPlanFactBranchCode(req('SX'))).resolves.toBe('SX');
  });

  it('SX 缺运行时 branch_code 时返回明确 503，不误报物理 parquet', async () => {
    duckdbQuery.mockResolvedValue([{ cnt: 0 }]);
    await expect(resolveRequiredPlanFactBranchCode(req('SX'))).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('SalesmanDim branch_code 信号缺失'),
    });
  });

  it('SC 延续双门控，不把 SX 严格规则扩散到四川', async () => {
    duckdbQuery.mockResolvedValue([{ cnt: 0 }]);
    await expect(resolveRequiredPlanFactBranchCode(req('SC'))).resolves.toBeUndefined();
  });
});
