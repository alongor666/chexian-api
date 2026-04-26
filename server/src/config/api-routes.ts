/**
 * API 路由路径常量
 *
 * 所有路由路径的唯一真实源。
 * 前端镜像文件：src/shared/api/routes.ts（值必须与此文件完全一致）
 *
 * 约定：
 * - 常量只包含路径段（不含 /api/query/ 等前缀）
 * - 带路径参数的路由保留参数占位符（:id 等）
 * - 子路径分组用嵌套对象表示（如 RENEWAL_FUNNEL.*）
 */

// ─────────────────────────────────────────────
// /api/query/* 路由
// ─────────────────────────────────────────────
export const QUERY_ROUTES = {
  // KPI
  KPI: '/kpi',
  KPI_DETAIL: '/kpi-detail',

  // 趋势
  TREND: '/trend',
  QUALITY_BUSINESS_TREND: '/quality-business-trend',

  // 货车分析
  TRUCK: '/truck',

  // 增长分析
  GROWTH: '/growth',

  // 成本分析
  COST: '/cost',

  // 综合分析
  COMPREHENSIVE_BUNDLE: '/comprehensive-bundle',
  COMPREHENSIVE_ANALYSIS_BUNDLE: '/comprehensive-analysis-bundle',

  // 交叉销售（车驾意推介率）
  CROSS_SELL: '/cross-sell',
  CROSS_SELL_TREND: '/cross-sell-trend',
  CROSS_SELL_SUMMARY: '/cross-sell-summary',
  CROSS_SELL_ORG_TREND: '/cross-sell-org-trend',
  CROSS_SELL_HEATMAP: '/cross-sell-heatmap',
  CROSS_SELL_TOP_SALESMAN: '/cross-sell-top-salesman',
  CROSS_SELL_BUNDLE: '/cross-sell-bundle',

  // 业务员排名
  SALESMAN_RANKING: '/salesman-ranking',

  // 业绩分析
  PERFORMANCE_SUMMARY: '/performance-summary',
  PERFORMANCE_TREND: '/performance-trend',
  PERFORMANCE_DRILLDOWN: '/performance-drilldown',
  PERFORMANCE_ORG_HEATMAP: '/performance-org-heatmap',
  PERFORMANCE_TOP_SALESMAN: '/performance-top-salesman',
  PERFORMANCE_BUNDLE: '/performance-bundle',

  // 报表
  MARKETING_REPORT: '/marketing-report',
  HOLIDAY_DRILLDOWN: '/holiday-drilldown',
  PREMIUM_REPORT: '/premium-report',

  // 保费计划
  PREMIUM_PLAN: '/premium-plan',
  PLAN_ACHIEVEMENT: '/plan-achievement',

  // 仪表盘聚合
  DASHBOARD_BUNDLE: '/dashboard-bundle',

  // 报价转化
  QUOTE_CONVERSION: {
    KPI: '/quote-conversion/kpi',
    FUNNEL: '/quote-conversion/funnel',
    DRILLDOWN: '/quote-conversion/drilldown',
    HEATMAP: '/quote-conversion/heatmap',
    PRICE: '/quote-conversion/price',
    RANKING: '/quote-conversion/ranking',
    TREND: '/quote-conversion/trend',
  },

  // 承保地理分布
  POLICY_GEO: {
    PROVINCE: '/policy-geo/province',
    CITY: '/policy-geo/city',
  },

  // 维修资源（v1 + 2026-04-18 v2 重设计）
  REPAIR: {
    // v1
    OVERVIEW: '/repair/overview',
    DETAIL: '/repair/detail',
    STATUS: '/repair/status',
    METADATA: '/repair/metadata',
    // v2（单页下钻 + 本地资源占比 + 导流清单）
    CITY: '/repair/city',
    CHANNEL: '/repair/channel',
    COOP_TIER: '/repair/coop-tier',
    SCATTER: '/repair/scatter',
    LOCAL_RESOURCE: '/repair/local-resource',
    TO_PREMIUM: '/repair/to-premium',
    DIVERSION_LIST: '/repair/diversion-list',
    ORPHAN_SHOPS: '/repair/orphan-shops',
  },

  // 巡检报告
  PATROL: '/patrol',

  // 续保追踪
  RENEWAL_TRACKER: '/renewal-tracker',

  // 测试（仅开发环境）
  TEST: '/test',
} as const;

// ─────────────────────────────────────────────
// /api/data/* 路由
// ─────────────────────────────────────────────
export const DATA_ROUTES = {
  UPLOAD: '/upload',
  METADATA: '/metadata',
  CLEAR: '/clear',
  FILES: '/files',
  LOAD: '/load/:filename',
  DOWNLOAD: '/download/:filename',
  KPI_PLAN_CONFIG: '/kpi-plan-config',
} as const;

// ─────────────────────────────────────────────
// /api/auth/* 路由
// ─────────────────────────────────────────────
export const AUTH_ROUTES = {
  LOGIN: '/login',
  REFRESH: '/refresh',
  LOGOUT: '/logout',
  ME: '/me',

  USERS: '/users',
  USER_BY_ID: '/users/:id',

  ROLES: '/roles',
  ROLE_BY_ID: '/roles/:role',

  WECOM_CONFIG: '/wecom/config',
} as const;

// ─────────────────────────────────────────────
// /api/ai/* 路由
// ─────────────────────────────────────────────
export const AI_ROUTES = {
  VALIDATE_KEY: '/validate-key',
  TREND_ANALYSIS: '/trend-analysis',
  DETECT_REQUIREMENT: '/detect-requirement',
  CAPABILITIES: '/capabilities',
  QUICK_SUGGESTIONS: '/quick-suggestions',
} as const;

// ─────────────────────────────────────────────
// /api/agent/audit/* 路由
// ─────────────────────────────────────────────
export const AGENT_AUDIT_ROUTES = {
  METRICS: '/metrics',
  CAPABILITIES: '/capabilities',
  UNSUPPORTED: '/unsupported',
  OBSERVABILITY: '/observability',
  READINESS: '/readiness',
  ROUTE_QUESTION: '/route-question',
} as const;

// ─────────────────────────────────────────────
// /api/agent/diagnosis/* 路由
// ─────────────────────────────────────────────
export const AGENT_DIAGNOSIS_ROUTES = {
  COST_INDICATORS: '/cost-indicators',
  GROWTH: '/growth',
  QUOTE_CONVERSION: '/quote-conversion',
  RENEWAL_TRACKER: '/renewal-tracker',
  CLAIMS_RISK: '/claims-risk',
  CUSTOMER_FLOW: '/customer-flow',
  BUSINESS_PATROL: '/business-patrol',
} as const;

// ─────────────────────────────────────────────
// /api/filters/* 路由
// ─────────────────────────────────────────────
export const FILTER_ROUTES = {
  OPTIONS: '/options',
} as const;
