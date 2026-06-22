import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import quoteConversionRouter from '../../routes/query/quote-conversion.js';
import { AppError } from '../../routes/query/shared.js';
import { duckdbService } from '../../services/duckdb.js';
import { generateQuoteFunnelQuery, generateQuoteKpiQuery } from '../quote-conversion.js';

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

  it('KPI 路由支持旧车专属筛选参数', async () => {
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
    } as unknown as Request;
    const res = {
      json,
    } as unknown as Response;

    await handler(req, res, vi.fn() as unknown as NextFunction);

    expect(duckdbQuery).toHaveBeenCalledTimes(1);
    const sql = duckdbQuery.mock.calls[0]?.[0] as string;
    expect(sql).toContain("is_telemarketing = '电销'");
    expect(sql).toContain("is_nev = '是'");
    expect(sql).toContain("is_transfer = '否'");
    expect(sql).toContain("insurance_grade = 'B'");
    expect(sql).toContain('commercial_ncd >= 0.9');
    expect(sql).toContain('commercial_ncd <= 1.2');
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
});
