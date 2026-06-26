/**
 * 单元测试：cube 续保路径 buildRenewalExtraConditions 的分省 RLS（branch_code）下推
 *
 * 背景（山西 cutover follow-up）：cube 续保路径与 /renewal-tracker typed 路由同款，历史只走
 * buildOrgScopedPermissionWhere（仅抽 org_level_3）。RLS-on 下 branch_admin 的 permissionFilter
 * 仅含 branch_code（无 org_level_3），buildOrgScoped 对其返回 '1=1' → 不注入 → 跨省串读。
 *
 * 修法：与 renewal-tracker 路由一致，配套 resolveBranchRlsCode 双门控注入 branch_code。
 * 本文件直接单测导出的 buildRenewalExtraConditions（隔离原生 DuckDB 模块加载）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── buildOrgScopedPermissionWhere / resolveBranchRlsCode 真实逻辑内联（mock shared.js）──
// 与 renewal-tracker-permission.test.ts 同款：gate b（视图实测含 branch_code 列）在无原生
// DuckDB 的单测中视为恒成立 —— 即 RLS-on + 派生域已补列后的生产形态。
function buildOrgScopedPermissionWhereImpl(req: Request): string {
  const pf = (req as any).permissionFilter as string | undefined;
  if (!pf || pf === '1=1') return '1=1';
  const match = pf.match(/org_level_3\s*=\s*'(?:[^']|'')*'/);
  return match ? match[0] : '1=1';
}
async function resolveBranchRlsCodeImpl(req: Request): Promise<string | undefined> {
  const pf = (req as any).permissionFilter as string | undefined;
  if (!pf) return undefined;
  const m = pf.match(/branch_code\s*=\s*'([A-Z]{2})'/);
  return m ? m[1] : undefined;
}

vi.mock('../shared.js', () => ({
  asyncHandler: (fn: any) => fn,
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  duckdbService: { query: vi.fn().mockResolvedValue([]) },
  isValidDateFormat: (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s),
  sendWithEtag: vi.fn(),
  QUERY_CACHE: { hotspotShort: 3600000, hotspotMedium: 7200000, hotspotLong: 14400000 },
  HTTP_MAX_AGE: { query: 300 },
  withRouteCache: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  parseFiltersAndBuildWhere: () => ({ whereClause: '1=1' }),
  buildOrgScopedPermissionWhere: buildOrgScopedPermissionWhereImpl,
  resolveBranchRlsCode: resolveBranchRlsCodeImpl,
}));

// ── 隔离 cube.ts 其余模块级依赖（仅需让模块干净导入，buildRenewalExtraConditions 不触达它们）──
vi.mock('../../../utils/sql-sanitizer.js', () => ({
  buildInCondition: (col: string, vals: string[]) =>
    `${col} IN (${vals.map((v) => `'${v}'`).join(', ')})`,
}));
vi.mock('../../../sql/renewal-tracker.js', () => ({
  generateRenewalCubeQuery: vi.fn(() => 'SELECT 1'),
  RENEWAL_CUBE_DIMENSIONS: { org_level_3: 'org_level_3' },
  RENEWAL_OUTPUT_COLUMNS: [{ column: 'A', metricId: 'renewal_due_count' }],
}));
vi.mock('../../../sql/pivot.js', () => ({ generatePivotQuery: vi.fn(() => 'SELECT 1') }));
vi.mock('../pivot.js', () => ({ isPivotSafeMetric: () => false, PIVOT_DIM_WHITELIST: {} }));
vi.mock('../../../config/metric-registry/index.js', () => ({ getMetric: vi.fn(() => null) }));
vi.mock('../../../services/bootstrapper-registry.js', () => ({ getBootstrapper: vi.fn(() => null) }));

// 延迟导入，确保 mock 在 import 之前生效
import { buildRenewalExtraConditions } from '../cube.js';

/** 最简 Request stub：cube 续保受限筛选器仅读 query（此处全空）+ permissionFilter */
function makeReq(permissionFilter: string): Request {
  return { query: {}, permissionFilter } as unknown as Request;
}

describe('cube 续保路径 buildRenewalExtraConditions：分省 RLS（branch_code）下推', () => {
  beforeEach(() => vi.clearAllMocks());

  // CUBE-RT-01：山西 branch_admin（仅 branch_code，无 org_level_3）→ 注入 branch_code（堵串读）
  it('CUBE-RT-01: branch_admin（branch_code=SX，无 org_level_3）→ extra 含 branch_code=SX，不含 org_level_3', async () => {
    const extra = await buildRenewalExtraConditions(makeReq("branch_code = 'SX'"));
    expect(extra.some((c) => c.includes("branch_code = 'SX'"))).toBe(true);
    expect(extra.every((c) => !c.includes('org_level_3'))).toBe(true);
    expect(extra.every((c) => !c.includes('is_telemarketing'))).toBe(true);
  });

  // CUBE-RT-02：多分公司 org_user（org_level_3 + branch_code）→ 两段都下推
  it('CUBE-RT-02: org_user（org_level_3=天府 AND branch_code=SC）→ extra 同时含 org_level_3 与 branch_code=SC', async () => {
    const extra = await buildRenewalExtraConditions(makeReq("org_level_3 = '天府' AND branch_code = 'SC'"));
    expect(extra.some((c) => c.includes("org_level_3 = '天府'"))).toBe(true);
    expect(extra.some((c) => c.includes("branch_code = 'SC'"))).toBe(true);
  });

  // CUBE-RT-03：单租户 / RLS-off（1=1）→ 不注入任何权限段（字节安全）
  it('CUBE-RT-03: 单租户（permissionFilter=1=1）→ extra 不含 branch_code / org_level_3（字节安全）', async () => {
    const extra = await buildRenewalExtraConditions(makeReq('1=1'));
    expect(extra.every((c) => !c.includes('branch_code') && !c.includes('org_level_3'))).toBe(true);
  });

  // CUBE-RT-04：电销用户（is_telemarketing，视图无真实列）→ 安全降级，不注入缺失列
  it('CUBE-RT-04: 电销用户（is_telemarketing=true）→ extra 不含 is_telemarketing / branch_code（防 Binder Error）', async () => {
    const extra = await buildRenewalExtraConditions(makeReq('is_telemarketing = true'));
    expect(extra.every((c) => !c.includes('is_telemarketing') && !c.includes('branch_code'))).toBe(true);
  });
});
