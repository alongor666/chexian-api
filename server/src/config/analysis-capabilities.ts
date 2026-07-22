/**
 * 远程分析能力目录
 *
 * 这是 skills / cx 对“无需本地 Parquet 也能完成哪些分析”的唯一事实源。
 * 每项只映射到已受 auth + readonly + permissionMiddleware 保护的 GET 查询路由；
 * 不允许在这里登记文件下载、行级明细或任意 SQL。
 */
import { QUERY_ROUTES } from './api-routes.js';
import { getRouteMetaByPath } from './query-routes-metadata.js';

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
}

/** 此目录要求的最小 CLI 版本；低版本没有 cx analyze/capabilities 命令。 */
export const ANALYSIS_CAPABILITIES_MIN_CLI_VERSION = '0.3.0';

export const ANALYSIS_CAPABILITIES: readonly AnalysisCapability[] = [
  {
    id: 'operating-trend',
    name: '经营趋势',
    description: '按日、周或月返回保费、件数与核心经营指标的时间序列。',
    path: QUERY_ROUTES.TREND,
    requiredParams: ['startDate', 'endDate'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'operating',
  },
  {
    id: 'org-weekly',
    name: '机构周度经营概览',
    description: '返回机构经营的 KPI 汇总，供远程周报表格与结论使用。',
    path: QUERY_ROUTES.KPI,
    requiredParams: ['startDate', 'endDate'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'operating',
  },
  {
    id: 'period-trend',
    name: '期间趋势',
    description: '返回可按机构、客户类别和险类过滤的期间经营趋势。',
    path: QUERY_ROUTES.TREND,
    requiredParams: ['startDate', 'endDate', 'granularity'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'operating',
  },
  {
    id: 'loss-development',
    name: '赔付率发展',
    description: '按事故口径返回赔付率发展分析的聚合结果。',
    path: QUERY_ROUTES.CLAIMS_DETAIL.LOSS_RATIO_DEV,
    requiredParams: ['dateStart', 'dateEnd', 'cutoffDate'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
  },
  {
    id: 'incident-rate',
    name: '出险率发展',
    description: '返回出险频率同比与分组聚合，不暴露保单或赔案行。',
    path: QUERY_ROUTES.CLAIMS_DETAIL.FREQUENCY_YOY,
    requiredParams: ['dateStart', 'dateEnd'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
  },
  {
    id: 'accident-profile',
    name: '事故画像',
    description: '按原因、机构和筛选条件返回事故画像聚合。',
    path: QUERY_ROUTES.CLAIMS_DETAIL.CAUSE_ANALYSIS,
    requiredParams: ['dateStart', 'dateEnd'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'claims',
  },
  {
    id: 'ncd-pricing',
    name: 'NCD 定价诊断',
    description: '返回报价转化与价格/NCD 分布的聚合数据。',
    path: QUERY_ROUTES.QUOTE_CONVERSION.PRICE,
    requiredParams: ['dateStart', 'dateEnd'],
    requiresExplicitBranchForMultiBranch: true,
    domain: 'pricing',
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
  }
  return issues;
}

export function getAnalysisCapability(id: string): AnalysisCapability | undefined {
  return ANALYSIS_CAPABILITIES.find((capability) => capability.id === id);
}
