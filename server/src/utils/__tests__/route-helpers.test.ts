import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { AppError } from '../../middleware/error.js';
import { commonFilterSchema } from '../filter-params.js';
import {
  parseFiltersAndBuildWhere,
  parseFiltersAndBuildBothWhere,
} from '../route-helpers.js';

/**
 * B256 回归锚点 — `/api/query/kpi` 无参 GET 曾持续返回 HTTP 400
 * （trace dbb22c99-ea2e-4e4d-a7b5-2697b0a72a0c）。
 *
 * 400 抛出点：route-helpers.ts 的 `commonFilterSchema.safeParse(req.query)` 校验失败。
 * 根因随 route-helpers 重构 + commonFilterSchema 全字段可选化消除，2026-06-08
 * 生产实测 `/api/query/kpi` 已稳定返回 200 + 真实数据。
 *
 * 本测试锚定「无参 / 空 query 永不再触发 400」：
 *   - 若日后有人给 commonFilterSchema 加必填字段，无参 GET 会重演 B256，本测试即拦截；
 *   - 同时保留「非法日期仍正确抛 400」边界，确认根因不是靠削弱校验消除的。
 */
function mockReq(
  query: Record<string, unknown> = {},
  permissionFilter = '1=1'
): Request {
  return { query, permissionFilter } as unknown as Request;
}

describe('parseFiltersAndBuildWhere — B256 无参 GET 不再 400', () => {
  it('commonFilterSchema 接受空 query（无参 GET 场景）', () => {
    const result = commonFilterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('空 query 不抛 400，返回非空 whereClause', () => {
    expect(() => parseFiltersAndBuildWhere(mockReq({}))).not.toThrow();
    const { whereClause } = parseFiltersAndBuildWhere(mockReq({}));
    expect(typeof whereClause).toBe('string');
    expect(whereClause.length).toBeGreaterThan(0);
  });

  it('parseFiltersAndBuildBothWhere 空 query 同样不抛 400', () => {
    expect(() => parseFiltersAndBuildBothWhere(mockReq({}))).not.toThrow();
  });

  it('携带常见筛选参数仍解析成功（不回退 400）', () => {
    const req = mockReq({
      orgNames: '天府,高新',
      isNev: 'true',
      dateField: 'policy_date',
    });
    expect(() => parseFiltersAndBuildWhere(req)).not.toThrow();
    const { whereClause } = parseFiltersAndBuildWhere(req);
    expect(whereClause).toContain('1=1');
  });

  it('边界：非法 startDate 格式仍正确抛 400（校验未被削弱）', () => {
    const req = mockReq({ startDate: 'not-a-date' });
    expect(() => parseFiltersAndBuildWhere(req)).toThrow(AppError);
  });
});
