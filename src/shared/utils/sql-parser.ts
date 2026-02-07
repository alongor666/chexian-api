/**
 * SQL WHERE Clause 解析工具
 * SQL WHERE Clause Parser
 *
 * 将 SQL WHERE clause 解析为 API 查询参数
 * 用于前后端分离架构中的数据源适配
 */

/**
 * API 查询参数接口
 */
export interface QueryParams {
  /** 开始日期 */
  startDate?: string;
  /** 结束日期 */
  endDate?: string;
  /** 三级机构名称 */
  orgName?: string;
  /** 三级机构列表（多选） */
  orgNames?: string[];
  /** 业务员名称 */
  salesmanName?: string;
  /** 业务员列表（多选） */
  salesmanNames?: string[];
  /** 客户类别 */
  customerCategory?: string;
  /** 险别组合 */
  coverageCombination?: string;
  /** 是否续保 */
  isRenewal?: boolean;
  /** 是否新能源 */
  isNev?: boolean;
  /** 是否新车 */
  isNewCar?: boolean;
  /** 是否转保 */
  isTransfer?: boolean;
  /** 日期字段名 */
  dateField?: 'policy_date' | 'insurance_start_date';
}

/**
 * 将 SQL WHERE clause 解析为 API 查询参数
 *
 * 支持的 SQL 模式：
 * - policy_date >= '2026-01-01'
 * - policy_date <= '2026-12-31'
 * - policy_date BETWEEN '2026-01-01' AND '2026-12-31'
 * - org_level_3 = '成都'
 * - org_level_3 IN ('成都', '乐山')
 * - salesman_name = '张三'
 * - salesman_name IN ('张三', '李四')
 * - customer_category = '非营业个人'
 * - coverage_combination = '商业险'
 * - is_renewal = true
 * - is_nev = true
 * - is_new_car = true
 * - is_transfer = true
 *
 * @param whereClause - SQL WHERE clause
 * @returns 解析后的 API 查询参数
 *
 * @example
 * ```ts
 * parseWhereClause("policy_date >= '2026-01-01' AND org_level_3 = '乐山'")
 * // => { startDate: '2026-01-01', orgName: '乐山' }
 * ```
 */
export function parseWhereClause(whereClause: string): QueryParams {
  const params: QueryParams = {};

  if (!whereClause || whereClause === '1=1') {
    return params;
  }

  // 日期字段模式
  const dateFieldPatterns = {
    // policy_date >= '2026-01-01'
    startDate: /(?:policy_date|insurance_start_date)\s*>=\s*'([^']+)'/i,
    // policy_date <= '2026-12-31'
    endDate: /(?:policy_date|insurance_start_date)\s*<=\s*'([^']+)'/i,
    // policy_date BETWEEN '2026-01-01' AND '2026-12-31'
    between:
      /(?:policy_date|insurance_start_date)\s+BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'/i,
  };

  // 单值字段模式
  const singleValuePatterns = {
    orgName: /org_level_3\s*=\s*'([^']+)'/i,
    salesmanName: /salesman_name\s*=\s*'([^']+)'/i,
    customerCategory: /customer_category\s*=\s*'([^']+)'/i,
    coverageCombination: /coverage_combination\s*=\s*'([^']+)'/i,
  };

  // 多值字段模式 (IN 子句)
  const multiValuePatterns = {
    orgNames: /org_level_3\s+IN\s*\(([^)]+)\)/i,
    salesmanNames: /salesman_name\s+IN\s*\(([^)]+)\)/i,
  };

  // 布尔字段模式
  const booleanPatterns = {
    isRenewal: /is_renewal\s*=\s*(true|false|1|0)/i,
    isNev: /is_nev\s*=\s*(true|false|1|0)/i,
    isNewCar: /is_new_car\s*=\s*(true|false|1|0)/i,
    isTransfer: /is_transfer\s*=\s*(true|false|1|0)/i,
  };

  // 解析 BETWEEN
  const betweenMatch = whereClause.match(dateFieldPatterns.between);
  if (betweenMatch) {
    params.startDate = betweenMatch[1];
    params.endDate = betweenMatch[2];
  } else {
    // 解析单独的日期条件
    const startMatch = whereClause.match(dateFieldPatterns.startDate);
    if (startMatch) {
      params.startDate = startMatch[1];
    }

    const endMatch = whereClause.match(dateFieldPatterns.endDate);
    if (endMatch) {
      params.endDate = endMatch[1];
    }
  }

  // 检测日期字段
  if (whereClause.includes('insurance_start_date')) {
    params.dateField = 'insurance_start_date';
  } else if (whereClause.includes('policy_date')) {
    params.dateField = 'policy_date';
  }

  // 解析单值字段
  for (const [key, pattern] of Object.entries(singleValuePatterns)) {
    const match = whereClause.match(pattern);
    if (match) {
      (params as Record<string, string>)[key] = match[1];
    }
  }

  // 解析多值字段
  for (const [key, pattern] of Object.entries(multiValuePatterns)) {
    const match = whereClause.match(pattern);
    if (match) {
      // 提取 IN 子句中的值列表
      const values = match[1]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
        .filter(Boolean);
      if (values.length > 0) {
        (params as Record<string, string[]>)[key] = values;
      }
    }
  }

  // 解析布尔字段
  for (const [key, pattern] of Object.entries(booleanPatterns)) {
    const match = whereClause.match(pattern);
    if (match) {
      const value = match[1].toLowerCase();
      (params as Record<string, boolean>)[key] =
        value === 'true' || value === '1';
    }
  }

  return params;
}

/**
 * 将 API 查询参数转换为 URL 查询字符串
 *
 * @param params - API 查询参数
 * @returns URL 查询字符串参数对象
 */
export function paramsToQueryString(
  params: QueryParams
): Record<string, string> {
  const result: Record<string, string> = {};

  if (params.startDate) result.startDate = params.startDate;
  if (params.endDate) result.endDate = params.endDate;
  if (params.orgName) result.orgName = params.orgName;
  if (params.orgNames?.length)
    result.orgNames = params.orgNames.join(',');
  if (params.salesmanName) result.salesmanName = params.salesmanName;
  if (params.salesmanNames?.length)
    result.salesmanNames = params.salesmanNames.join(',');
  if (params.customerCategory)
    result.customerCategory = params.customerCategory;
  if (params.coverageCombination)
    result.coverageCombination = params.coverageCombination;
  if (params.isRenewal !== undefined)
    result.isRenewal = String(params.isRenewal);
  if (params.isNev !== undefined) result.isNev = String(params.isNev);
  if (params.isNewCar !== undefined)
    result.isNewCar = String(params.isNewCar);
  if (params.isTransfer !== undefined)
    result.isTransfer = String(params.isTransfer);
  if (params.dateField) result.dateField = params.dateField;

  return result;
}

/**
 * 从筛选器状态构建查询参数
 *
 * @param filters - 筛选器状态
 * @returns API 查询参数
 */
export function buildQueryParams(filters: {
  startDate?: string;
  endDate?: string;
  orgLevel3?: string[];
  salesmanNames?: string[];
  customerCategory?: string;
  coverageCombination?: string;
  isRenewal?: boolean;
  isNev?: boolean;
  isNewCar?: boolean;
  isTransfer?: boolean;
  dateField?: 'policy_date' | 'insurance_start_date';
}): QueryParams {
  const params: QueryParams = {};

  if (filters.startDate) params.startDate = filters.startDate;
  if (filters.endDate) params.endDate = filters.endDate;

  // 机构筛选
  if (filters.orgLevel3?.length === 1) {
    params.orgName = filters.orgLevel3[0];
  } else if (filters.orgLevel3?.length && filters.orgLevel3.length > 1) {
    params.orgNames = filters.orgLevel3;
  }

  // 业务员筛选
  if (filters.salesmanNames?.length === 1) {
    params.salesmanName = filters.salesmanNames[0];
  } else if (
    filters.salesmanNames?.length &&
    filters.salesmanNames.length > 1
  ) {
    params.salesmanNames = filters.salesmanNames;
  }

  if (filters.customerCategory)
    params.customerCategory = filters.customerCategory;
  if (filters.coverageCombination)
    params.coverageCombination = filters.coverageCombination;
  if (filters.isRenewal !== undefined) params.isRenewal = filters.isRenewal;
  if (filters.isNev !== undefined) params.isNev = filters.isNev;
  if (filters.isNewCar !== undefined) params.isNewCar = filters.isNewCar;
  if (filters.isTransfer !== undefined) params.isTransfer = filters.isTransfer;
  if (filters.dateField) params.dateField = filters.dateField;

  return params;
}

/**
 * 合并查询参数（后者覆盖前者）
 */
export function mergeQueryParams(
  ...paramsList: (QueryParams | undefined)[]
): QueryParams {
  const result: QueryParams = {};

  for (const params of paramsList) {
    if (!params) continue;
    Object.assign(result, params);
  }

  return result;
}
