/**
 * 远程分析能力目录
 *
 * 这是 skills / cx 对“无需本地 Parquet 也能完成哪些分析”的唯一事实源。
 * 每项只映射到已受 auth + readonly + permissionMiddleware 保护的 GET 查询路由；
 * 不允许在这里登记文件下载、行级明细或任意 SQL。
 */
import { QUERY_ROUTES } from './api-routes.js';
import { getRouteMetaByPath } from './query-routes-metadata.js';
import type { QueryRouteParam, RouteTimeWindow } from './query-routes-metadata.js';

export interface AnalysisCapability {
  id: string;
  name: string;
  description: string;
  /** /api/query 下已登记的目标路径。 */
  path: string;
  /** 调用该分析必须显式给出的参数。 */
  requiredParams: string[];
  /** 不传 targetBranch 时是否可能让多省账号误取默认省。 */
  requiresExplicitBranchForMultiBranch: boolean;
  /** 供 skills 选择叙事/表格渲染的稳定领域标识。 */
  domain: 'operating' | 'claims' | 'pricing';
  /** 服务端能力锁定的查询参数；调用方不得覆盖。 */
  fixedParams?: Readonly<Record<string, string>>;
  /** skills 可据此稳定解析、校验聚合结果，不再猜测每条路由的响应形态。 */
  resultSchema: AnalysisResultSchema;
}

export interface AnalysisResultSchema {
  /** 语义稳定标识；字段或形态发生不兼容变化时递增末尾版本。 */
  id: string;
  version: number;
  kind: 'record' | 'records';
  /** 聚合记录相对 response.data 的位置。 */
  recordsPath: '$' | '$.rows';
  requiredFields: readonly string[];
  dimensionFields: readonly string[];
  metricFields: readonly string[];
}

/** 目录协议版本；任何响应形态、参数契约或能力集合变化都必须递增。 */
export const ANALYSIS_CAPABILITIES_VERSION = 5;

/** 1.3.0 起支持 resultSchema 校验、服务端 requestId 与可复现 SHA-256 指纹。 */
export const ANALYSIS_CAPABILITIES_MIN_CLI_VERSION = '1.3.0';

/**
 * 分析入口额外允许的全局查询参数。业务路由自身的参数来自 QUERY_ROUTE_METADATA；
 * targetBranch 由统一 RLS 中间件消费，因此不重复登记在每条业务路由里。
 */
const ANALYSIS_GLOBAL_PARAMETERS: readonly QueryRouteParam[] = [
  {
    name: 'targetBranch',
    type: 'string',
    description: '显式分公司代码（如 SC/SX）或有权账号的 ALL；多省分析必填',
  },
] as const;

export const ANALYSIS_CAPABILITIES: readonly AnalysisCapability[] = [
  {
    id: 'operating-trend',
    name: '经营趋势',
    description: '按日、周或月返回保费、件数与核心经营指标的时间序列。',
    path: QUERY_ROUTES.TREND,
    requiredParams: ['startDate', 'endDate'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'operating',
    resultSchema: {
      id: 'operating.trend.v1', version: 1, kind: 'records', recordsPath: '$',
      requiredFields: ['time_period', 'premium'],
      dimensionFields: ['time_period'],
      metricFields: ['premium'],
    },
  },
  {
    id: 'org-weekly',
    name: '机构周度经营概览',
    description: '返回机构经营的 KPI 汇总，供远程周报表格与结论使用。',
    path: QUERY_ROUTES.KPI,
    requiredParams: ['startDate', 'endDate'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'operating',
    resultSchema: {
      id: 'operating.kpi.v1', version: 1, kind: 'record', recordsPath: '$',
      requiredFields: ['vehicle_premium', 'total_premium', 'policy_count', 'org_count'],
      dimensionFields: [],
      metricFields: ['vehicle_premium', 'total_premium', 'policy_count', 'org_count'],
    },
  },
  {
    id: 'period-trend',
    name: '期间趋势',
    description: '返回可按机构、客户类别和险类过滤的期间经营趋势。',
    path: QUERY_ROUTES.TREND,
    requiredParams: ['startDate', 'endDate', 'granularity'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'operating',
    resultSchema: {
      id: 'operating.period-trend.v1', version: 1, kind: 'records', recordsPath: '$',
      requiredFields: ['time_period', 'premium'],
      dimensionFields: ['time_period'],
      metricFields: ['premium'],
    },
  },
  {
    id: 'loss-development',
    name: '赔付率发展',
    description: '按事故口径返回赔付率发展分析的聚合结果。',
    path: QUERY_ROUTES.CLAIMS_DETAIL.LOSS_RATIO_DEV,
    requiredParams: ['dateStart', 'dateEnd', 'cutoffDate'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
    resultSchema: {
      id: 'claims.loss-development.v1', version: 1, kind: 'records', recordsPath: '$',
      requiredFields: ['cohort_year', 'dev_month', 'loss_ratio_pct'],
      dimensionFields: ['cohort_year', 'dev_month'],
      metricFields: ['loss_ratio_pct'],
    },
  },
  {
    id: 'incident-rate',
    name: '出险率发展',
    description: '返回出险频率同比与分组聚合，不暴露保单或赔案行。',
    path: QUERY_ROUTES.CLAIMS_DETAIL.FREQUENCY_YOY,
    requiredParams: ['dateStart', 'dateEnd'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
    resultSchema: {
      id: 'claims.incident-rate.v1', version: 1, kind: 'records', recordsPath: '$',
      requiredFields: ['year', 'quarter', 'freq_per_1000', 'policy_count'],
      dimensionFields: ['year', 'quarter'],
      metricFields: ['freq_per_1000', 'policy_count'],
    },
  },
  {
    id: 'agent-earned-loss-frequency',
    name: '经代满期出险率',
    description: '按规范化后的经代完整名称返回年化满期出险频率和保单件数；只做精确匹配，不做短名归并。',
    path: QUERY_ROUTES.PIVOT,
    requiredParams: ['startDate', 'endDate', 'dateField', 'agentNames'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
    fixedParams: {
      dimensions: 'agent_name',
      metrics: 'earned_loss_frequency,policy_count',
      limit: '500',
    },
    resultSchema: {
      id: 'claims.agent-earned-loss-frequency.v1', version: 1, kind: 'records', recordsPath: '$.rows',
      requiredFields: ['agent_name', 'earned_loss_frequency', 'policy_count'],
      dimensionFields: ['agent_name'],
      metricFields: ['earned_loss_frequency', 'policy_count'],
    },
  },
  {
    id: 'accident-profile',
    name: '事故画像',
    description: '按原因、机构和筛选条件返回事故画像聚合。',
    path: QUERY_ROUTES.CLAIMS_DETAIL.CAUSE_ANALYSIS,
    requiredParams: ['dateStart', 'dateEnd'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
    resultSchema: {
      id: 'claims.accident-profile.v1', version: 1, kind: 'records', recordsPath: '$',
      requiredFields: ['accident_cause', 'cases', 'reserve_wan'],
      dimensionFields: ['accident_cause'],
      metricFields: ['cases', 'reserve_wan'],
    },
  },
  {
    id: 'ncd-pricing',
    name: 'NCD 定价诊断',
    description: '返回报价转化与价格/NCD 分布的聚合数据。',
    path: QUERY_ROUTES.QUOTE_CONVERSION.PRICE,
    requiredParams: ['dateStart', 'dateEnd'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'pricing',
    resultSchema: {
      id: 'pricing.ncd.v1', version: 1, kind: 'records', recordsPath: '$',
      requiredFields: ['discount_bin', 'total_quotes', 'conversion_rate'],
      dimensionFields: ['discount_bin'],
      metricFields: ['total_quotes', 'conversion_rate'],
    },
  },
] as const;

/** 配置自检：防止能力目录把 skill 引向未注册或参数契约不存在的路由。 */
export function validateAnalysisCapabilities(): string[] {
  const issues: string[] = [];
  for (const capability of ANALYSIS_CAPABILITIES) {
    const route = getRouteMetaByPath(capability.path);
    if (!route) {
      issues.push(`${capability.id}: 未在 QUERY_ROUTE_METADATA 登记 ${capability.path}`);
      continue;
    }
    const params = new Set(route.parameters.map((p) => p.name));
    for (const param of capability.requiredParams) {
      if (!params.has(param)) {
        issues.push(`${capability.id}: ${capability.path} 的 catalog 未登记必填参数 ${param}`);
      }
    }
    for (const [param, value] of Object.entries(capability.fixedParams ?? {})) {
      if (!params.has(param)) {
        issues.push(`${capability.id}: ${capability.path} 的 catalog 未登记固定参数 ${param}`);
      }
      if (!value.trim()) {
        issues.push(`${capability.id}: 固定参数 ${param} 不能为空`);
      }
    }
    const schema = capability.resultSchema;
    const required = new Set(schema.requiredFields);
    const dimensions = new Set(schema.dimensionFields);
    const metrics = new Set(schema.metricFields);
    if (!/^[a-z0-9.-]+\.v[1-9][0-9]*$/.test(schema.id)) {
      issues.push(`${capability.id}: resultSchema.id 非法 ${schema.id}`);
    }
    if (!Number.isInteger(schema.version) || schema.version < 1) {
      issues.push(`${capability.id}: resultSchema.version 必须为正整数`);
    }
    if (schema.kind === 'record' && schema.recordsPath !== '$') {
      issues.push(`${capability.id}: record 结果只能使用 recordsPath=$`);
    }
    if (required.size !== schema.requiredFields.length
      || dimensions.size !== schema.dimensionFields.length
      || metrics.size !== schema.metricFields.length) {
      issues.push(`${capability.id}: resultSchema 字段不得重复`);
    }
    for (const field of [...dimensions, ...metrics]) {
      if (!required.has(field)) {
        issues.push(`${capability.id}: resultSchema 语义字段 ${field} 必须同时列入 requiredFields`);
      }
    }
    for (const field of dimensions) {
      if (metrics.has(field)) {
        issues.push(`${capability.id}: resultSchema 字段 ${field} 不能同时是维度和指标`);
      }
    }
  }
  return issues;
}

/**
 * 返回 cx analyze 可转发的完整白名单。能力目录必须公开这份契约，CLI 才能在发请求前
 * 拒绝拼写错误或未支持参数，避免 Express/路由静默忽略后产出看似成功的错误分析。
 */
export function getAnalysisCapabilityAllowedParams(capability: AnalysisCapability): string[] {
  const route = getRouteMetaByPath(capability.path);
  const fixed = new Set(Object.keys(capability.fixedParams ?? {}));
  if (!route) return ANALYSIS_GLOBAL_PARAMETERS.map((parameter) => parameter.name);
  return [...new Set([
    ...route.parameters.map((parameter) => parameter.name).filter((name) => !fixed.has(name)),
    ...ANALYSIS_GLOBAL_PARAMETERS.map((parameter) => parameter.name),
  ])];
}

export interface PublishedAnalysisCapability extends AnalysisCapability {
  allowedParams: string[];
  fullPath: string;
  parameters: QueryRouteParam[];
  timeWindow: RouteTimeWindow;
  timeWindowNote?: string;
}

function buildCapabilityParameters(capability: AnalysisCapability): QueryRouteParam[] {
  const route = getRouteMetaByPath(capability.path);
  if (!route) return [...ANALYSIS_GLOBAL_PARAMETERS];
  const fixed = new Set(Object.keys(capability.fixedParams ?? {}));
  return [
    ...route.parameters.filter((parameter) => !fixed.has(parameter.name)),
    ...ANALYSIS_GLOBAL_PARAMETERS.filter(
      (global) => !route.parameters.some((parameter) => parameter.name === global.name),
    ),
  ].map((parameter) => ({
    ...parameter,
    required: capability.requiredParams.includes(parameter.name) || parameter.required,
  }));
}

export function getAnalysisCapability(id: string): AnalysisCapability | undefined {
  return ANALYSIS_CAPABILITIES.find((capability) => capability.id === id);
}

/** 构造完整的公开目录数据；路由以响应体 ETag 发送，代码变化自动失效。 */
export function buildAnalysisCapabilitiesData(): {
  version: number;
  minCliVersion: string;
  capabilities: PublishedAnalysisCapability[];
} {
  return {
    version: ANALYSIS_CAPABILITIES_VERSION,
    minCliVersion: ANALYSIS_CAPABILITIES_MIN_CLI_VERSION,
    capabilities: ANALYSIS_CAPABILITIES.map((capability) => {
      const route = getRouteMetaByPath(capability.path)!;
      return {
        ...capability,
        allowedParams: getAnalysisCapabilityAllowedParams(capability),
        fullPath: `/api/query${capability.path}`,
        parameters: buildCapabilityParameters(capability),
        timeWindow: route.timeWindow,
        ...(route.timeWindowNote ? { timeWindowNote: route.timeWindowNote } : {}),
      };
    }),
  };
}
