/**
 * route-helpers 特征测试
 * 验证从 query.ts 提取的公共逻辑与原内联逻辑行为一致
 */
import { describe, it, expect } from 'vitest';
import {
  parseFiltersAndBuildWhere,
  parseFiltersAndBuildBothWhere,
  extractOrgNames,
  extractSalesmanNames,
  resolveGroupDim,
} from '../server/src/utils/route-helpers';
import type { Request } from 'express';

/** 创建模拟 Request 对象 */
function mockReq(
  query: Record<string, string | undefined> = {},
  overrides: { permissionFilter?: string; user?: { role: string } } = {}
): Request {
  return {
    query,
    permissionFilter: overrides.permissionFilter,
    user: overrides.user,
  } as unknown as Request;
}

describe('parseFiltersAndBuildWhere', () => {
  it('空参数应返回默认 WHERE 子句', () => {
    const req = mockReq({});
    const { filterData, whereClause } = parseFiltersAndBuildWhere(req);
    expect(whereClause).toBe('1=1');
    expect(filterData).toBeDefined();
  });

  it('带日期参数应包含日期条件', () => {
    const req = mockReq({ startDate: '2025-01-01', endDate: '2025-12-31' });
    const { whereClause } = parseFiltersAndBuildWhere(req);
    expect(whereClause).toContain('2025-01-01');
    expect(whereClause).toContain('2025-12-31');
  });

  it('带权限过滤器应追加到 WHERE 子句', () => {
    const req = mockReq({}, { permissionFilter: "org_level_3 = '成都'" });
    const { whereClause } = parseFiltersAndBuildWhere(req);
    expect(whereClause).toContain("org_level_3 = '成都'");
  });

  it('无效参数应抛出 400 错误', () => {
    const req = mockReq({ startDate: 'invalid-date' });
    expect(() => parseFiltersAndBuildWhere(req)).toThrow();
  });

  it('带机构筛选应包含机构条件', () => {
    const req = mockReq({ orgNames: '成都,绵阳' });
    const { whereClause } = parseFiltersAndBuildWhere(req);
    expect(whereClause).toContain('org_level_3');
    expect(whereClause).toContain('成都');
    expect(whereClause).toContain('绵阳');
  });
});

describe('parseFiltersAndBuildBothWhere', () => {
  it('带日期参数时两个 WHERE 子句应不同', () => {
    const req = mockReq({ startDate: '2025-01-01', endDate: '2025-12-31' });
    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
    expect(whereWithDate).toContain('2025-01-01');
    expect(whereWithoutDate).not.toContain('2025-01-01');
  });

  it('无日期参数时两个 WHERE 子句应相同', () => {
    const req = mockReq({ orgNames: '成都' });
    const { whereWithDate, whereWithoutDate } = parseFiltersAndBuildBothWhere(req);
    // 都应包含机构条件
    expect(whereWithDate).toContain('成都');
    expect(whereWithoutDate).toContain('成都');
  });
});

describe('extractOrgNames', () => {
  it('从 orgNames 逗号分隔字符串提取', () => {
    const result = extractOrgNames({ orgNames: '成都, 绵阳, 自贡' } as any);
    expect(result).toEqual(['成都', '绵阳', '自贡']);
  });

  it('从 orgLevel3 单值提取', () => {
    const result = extractOrgNames({ orgLevel3: '成都' } as any);
    expect(result).toEqual(['成都']);
  });

  it('空参数返回空数组', () => {
    const result = extractOrgNames({} as any);
    expect(result).toEqual([]);
  });

  it('从权限过滤器提取（不重复）', () => {
    const result = extractOrgNames(
      { orgNames: '成都' } as any,
      "org_level_3 = '绵阳'"
    );
    expect(result).toEqual(['成都', '绵阳']);
  });

  it('权限过滤器中的机构已存在时不重复添加', () => {
    const result = extractOrgNames(
      { orgNames: '成都' } as any,
      "org_level_3 = '成都'"
    );
    expect(result).toEqual(['成都']);
  });
});

describe('extractSalesmanNames', () => {
  it('从 salesmanNames 逗号分隔字符串提取', () => {
    const result = extractSalesmanNames({ salesmanNames: '张三, 李四' } as any);
    expect(result).toEqual(['张三', '李四']);
  });

  it('从 salesmanName 单值提取', () => {
    const result = extractSalesmanNames({ salesmanName: '张三' } as any);
    expect(result).toEqual(['张三']);
  });

  it('空参数返回空数组', () => {
    const result = extractSalesmanNames({} as any);
    expect(result).toEqual([]);
  });

  it('从权限过滤器提取', () => {
    const result = extractSalesmanNames(
      {} as any,
      "salesman_name = '张三'"
    );
    expect(result).toEqual(['张三']);
  });
});

describe('resolveGroupDim', () => {
  it('无机构筛选且非 org_user 时返回全部', () => {
    const req = mockReq({});
    const result = resolveGroupDim({} as any, req);
    expect(result).toBe("'全部'");
  });

  it('有 orgLevel3 时返回 org_level_3', () => {
    const req = mockReq({});
    const result = resolveGroupDim({ orgLevel3: '成都' } as any, req);
    expect(result).toBe('org_level_3');
  });

  it('有 orgNames 时返回 org_level_3', () => {
    const req = mockReq({});
    const result = resolveGroupDim({ orgNames: '成都' } as any, req);
    expect(result).toBe('org_level_3');
  });

  it('org_user 角色时返回 org_level_3', () => {
    const req = mockReq({}, { user: { role: 'org_user' } });
    const result = resolveGroupDim({} as any, req);
    expect(result).toBe('org_level_3');
  });
});
