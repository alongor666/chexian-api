import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import quoteConversionRouter from '../../routes/query/quote-conversion.js';
import { AppError } from '../../routes/query/shared.js';
import { duckdbService } from '../../services/duckdb.js';
import {
  generateQuoteFunnelQuery,
  generateQuoteHeatmapQuery,
  generateQuoteKpiQuery,
  generateQuoteRankingQuery,
  type QuoteConversionFilters,
} from '../quote-conversion.js';

vi.mock('../../services/duckdb.js', () => ({
  duckdbService: {
    query: vi.fn().mockResolvedValue([{ ok: true }]),
  },
}));

const duckdbQuery = vi.mocked(duckdbService.query);

function getKpiRouteHandler() {
  return getRouteHandler('/quote-conversion/kpi');
}

function getRouteHandler(path: string) {
  const layer = quoteConversionRouter.stack.find(
    (item: { route?: { path?: string; stack?: Array<{ handle: unknown }> } }) =>
      item.route?.path === path,
  );
  const stack = layer?.route?.stack;
  if (!stack || stack.length === 0) {
    throw new Error(`无法定位 ${path} 路由处理器`);
  }
  // 链路末位是真正的 asyncHandler；前置可能有 withRouteCache 中间件
  return stack[stack.length - 1].handle as (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => unknown;
}

describe('quote-conversion SQL contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('KPI SQL 包含新增派生字段', () => {
    const sql = generateQuoteKpiQuery();
    expect(sql).toContain('renewal_insured_premium');
    expect(sql).toContain('switch_insured_premium');
  });

  it('P2 c21667：generateQuoteKpiQuery 中 isTelemarketing=电销 生成 boolean TRUE 条件', () => {
    const filters: QuoteConversionFilters = { isTelemarketing: '电销' };
    const sql = generateQuoteKpiQuery(filters);
    expect(sql).toContain('is_telemarketing = TRUE');
    expect(sql).not.toContain("is_telemarketing = '电销'");
  });

  it('P2 c21667：generateQuoteKpiQuery 中 isTelemarketing=非电销 生成 boolean FALSE 条件', () => {
    const filters: QuoteConversionFilters = { isTelemarketing: '非电销' };
    const sql = generateQuoteKpiQuery(filters);
    expect(sql).toContain('is_telemarketing = FALSE');
    expect(sql).not.toContain("is_telemarketing = '非电销'");
  });

  it('P2 c21667：isTelemarketing 未传时不生成 is_telemarketing 条件（无筛选行为不变）', () => {
    const sql = generateQuoteKpiQuery({});
    expect(sql).not.toContain('is_telemarketing =');
  });

  it('KPI 路由支持旧车专属筛选参数（后端兼容层：电销枚举→boolean SQL）', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        isTelemarketing: '电销',
        isNewEnergy: '是',
        isTransferred: '否',
        riskGrade: 'B',
        ncdMin: '0.9',
        ncdMax: '1.2',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    // P2 c21667：后端兼容层将枚举 '电销' 映射为 boolean SQL 条件 `is_telemarketing = TRUE`
    expect(sql).toContain('is_telemarketing = TRUE');
    expect(sql).not.toContain("is_telemarketing = '电销'");  // 不再使用旧字符串比较
    expect(sql).toContain("is_nev = '是'");
    expect(sql).toContain("is_transfer = '否'");
    expect(sql).toContain("insurance_grade = 'B'");
    expect(sql).toContain('commercial_ncd >= 0.9');
    expect(sql).toContain('commercial_ncd <= 1.2');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('P2 c21667：非电销枚举映射为 boolean FALSE', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        isTelemarketing: '非电销',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).toContain('is_telemarketing = FALSE');
    expect(sql).not.toContain("is_telemarketing = '非电销'");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('NCD 空字符串不应生成区间条件', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        ncdMin: '',
        ncdMax: '',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('NCD系数 >=');
    expect(sql).not.toContain('NCD系数 <=');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('NCD 纯空白字符串不应生成区间条件', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        ncdMin: '   ',
        ncdMax: '  ',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('NCD系数 >=');
    expect(sql).not.toContain('NCD系数 <=');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('枚举筛选空串按未筛选处理', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        isTelemarketing: '',
        isNewEnergy: '',
        isTransferred: '',
        riskGrade: '',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('是否电销 =');
    expect(sql).not.toContain('是否新能源车 =');
    expect(sql).not.toContain('是否过户车 =');
    expect(sql).not.toContain('车险分等级 =');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('日期筛选空白不触发格式校验', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        dateStart: '   ',
        dateEnd: '  ',
        orgName: '北京',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain('CAST(报价时间 AS DATE) >=');
    expect(sql).not.toContain('CAST(报价时间 AS DATE) <=');
    expect(sql).toContain("org_level_3 = '北京'");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('renewalType 和 insuranceCombo 空白按未筛选处理', async () => {
    const handler = getKpiRouteHandler();
    const json = vi.fn();
    const req = {
      query: {
        renewalType: '   ',
        insuranceCombo: '',
        orgName: '   ',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain("WHERE 1=1 AND renewal_status =");
    expect(sql).not.toContain("WHERE 1=1 AND coverage_combination =");
    expect(sql).not.toContain("WHERE 1=1 AND org_level_3 =");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('ncdMin 大于 ncdMax 时应拒绝', async () => {
    const handler = getKpiRouteHandler();
    const next = vi.fn();
    const req = {
      query: {
        ncdMin: '1.2',
        ncdMax: '0.9',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json: vi.fn(),
    } as unknown as Response;

    await handler(req, res, next as unknown as NextFunction);

    expect(duckdbQuery).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as Error;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
    expect(err.message).toContain('ncdMin 不能大于 ncdMax');
  });

  it('drilldown level 非法值应返回 400', async () => {
    const handler = getRouteHandler('/quote-conversion/drilldown');
    const next = vi.fn();
    const req = {
      query: {
        level: 'invalid',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json: vi.fn(),
    } as unknown as Response;

    await handler(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as Error;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('trend granularity 非法值应返回 400', async () => {
    const handler = getRouteHandler('/quote-conversion/trend');
    const next = vi.fn();
    const req = {
      query: {
        granularity: 'invalid',
      },
      permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
    } as unknown as Request;
    const res = {
      json: vi.fn(),
    } as unknown as Response;

    await handler(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as Error;
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('riskGrade 扩展到 E/F/G/X 后 KPI 路由能正确生成 SQL 筛选条件', async () => {
    // B261: riskGrade 枚举扩展到 A-G/X，E/F/G/X 等级的已评级客户应可筛选
    const handler = getKpiRouteHandler();
    const json = vi.fn();

    for (const grade of ['E', 'F', 'G', 'X'] as const) {
      vi.clearAllMocks();
      const req = {
        query: { riskGrade: grade },
        permissionFilter: '1=1', // B326：stub 模拟 permissionMiddleware 已注入（branch_admin='1=1'）
      } as unknown as Request;
      const res = { json } as unknown as Response;

      await handler(req, res, vi.fn() as unknown as NextFunction);

      expect(duckdbQuery).toHaveBeenCalledTimes(1);
      const sql = duckdbQuery.mock.calls[0]?.[0] as string;
      expect(sql).toContain(`insurance_grade = '${grade}'`);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    }
  });

  it('L3 quality SQL 包含 A-G/X 全量已评级风险等级（B261 扩展）', () => {
    // 验证漏斗 SQL 已扩展到 A-G/X，确保质量报价定义包含所有已评级客户
    const sql = generateQuoteFunnelQuery();
    expect(sql).toContain("insurance_grade IN ('A','B','C','D','E','F','G','X')");
  });
  // ── P1 c21667 字节安全：维度输出侧兼容层 ─────────────────────────────────
  // QuoteConversion 视图 is_telemarketing 已是 boolean，
  // 但对外的 dim_value 输出契约必须仍为中文枚举 '电销'/'非电销'。
  // 四川（federation 关闭）的输出逐字节与改动前一致。

  it('P1 c21667：heatmap 以 is_telemarketing 为列维度时 dim_value 输出中文枚举而非 boolean', () => {
    const sql = generateQuoteHeatmapQuery({}, 'is_telemarketing');
    // 输出表达式应含 CASE WHEN … THEN '电销' ELSE '非电销' END
    expect(sql).toContain("THEN '电销'");
    expect(sql).toContain("ELSE '非电销'");
    // 不应直接裸输出 boolean 字段
    expect(sql).not.toMatch(/SELECT[\s\S]*is_telemarketing AS dim_value/);
    // 兼容层使用 boolean 比较而非字符串枚举直查
    expect(sql).toContain('is_telemarketing = TRUE');
  });

  it('P1 c21667：ranking 以 is_telemarketing 为维度时 dim_value 输出中文枚举而非 boolean', () => {
    const sql = generateQuoteRankingQuery({}, 'is_telemarketing');
    expect(sql).toContain("THEN '电销'");
    expect(sql).toContain("ELSE '非电销'");
    expect(sql).not.toMatch(/SELECT[\s\S]*is_telemarketing AS dim_value/);
    expect(sql).toContain('is_telemarketing = TRUE');
  });

  it('P1 c21667：heatmap 使用其他维度时 is_telemarketing 不出现在 dim_value 列（回归）', () => {
    const sql = generateQuoteHeatmapQuery({}, 'renewal_status');
    // 选择 renewal_status 为列维度时，不应引入 is_telemarketing 相关表达式
    expect(sql).not.toContain('is_telemarketing');
  });

  it('P1 c21667：rankig 使用其他维度时 is_telemarketing 不出现在 dim_value 列（回归）', () => {
    const sql = generateQuoteRankingQuery({}, 'customer_category');
    expect(sql).not.toContain('is_telemarketing');
  });

  // ── codex 二轮 P1 严格三态：非法 isTelemarketing 值返回空（不静默放大）──────────────
  it('codex 二轮 P1：isTelemarketing 非法值（全部）生成 1=0 不可能命中条件', () => {
    const filters: QuoteConversionFilters = { isTelemarketing: '全部' as '电销' };
    const sql = generateQuoteKpiQuery(filters);
    // 非法值应生成 1 = 0，而非 is_telemarketing = FALSE（防止静默放大为全部非电销数据）
    expect(sql).toContain('1 = 0');
    expect(sql).not.toContain('is_telemarketing = FALSE');
    expect(sql).not.toContain('is_telemarketing = TRUE');
  });

  it('codex 二轮 P1：isTelemarketing typo 值也生成 1=0（防止静默放大）', () => {
    const filters: QuoteConversionFilters = { isTelemarketing: 'dianxiao' as '电销' };
    const sql = generateQuoteKpiQuery(filters);
    expect(sql).toContain('1 = 0');
    expect(sql).not.toContain('is_telemarketing = FALSE');
  });

  // ── codex 二轮 P2 维度输出侧 NULL 保护 ───────────────────────────────────────────
  it('codex 二轮 P2：heatmap is_telemarketing 维度输出含 IS NULL 保护（不折叠 NULL 为非电销）', () => {
    const sql = generateQuoteHeatmapQuery({}, 'is_telemarketing');
    // 必须显式处理 NULL，防止 ELSE 折叠成 '非电销'
    expect(sql).toContain('is_telemarketing IS NULL');
    expect(sql).toContain("THEN NULL");
  });

  it('codex 二轮 P2：ranking is_telemarketing 维度输出含 IS NULL 保护', () => {
    const sql = generateQuoteRankingQuery({}, 'is_telemarketing');
    expect(sql).toContain('is_telemarketing IS NULL');
    expect(sql).toContain("THEN NULL");
  });
});
