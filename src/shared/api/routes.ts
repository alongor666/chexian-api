/**
 * API 路由路径常量（前端镜像）
 *
 * 与服务端 server/src/config/api-routes.ts 保持完全一致。
 * 路径值一旦变更，两处必须同步修改。
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
  KPI: 'kpi',
  KPI_DETAIL: 'kpi-detail',

  // 趋势
  TREND: 'trend',
  QUALITY_BUSINESS_TREND: 'quality-business-trend',

  // 货车分析
  TRUCK: 'truck',

  // 增长分析
  GROWTH: 'growth',

  // 成本分析
  COST: 'cost',

  // 综合分析
  COMPREHENSIVE_BUNDLE: 'comprehensive-bundle',
  COMPREHENSIVE_ANALYSIS_BUNDLE: 'comprehensive-analysis-bundle',

  // 交叉销售（车驾意推介率）
  CROSS_SELL: 'cross-sell',
  CROSS_SELL_TREND: 'cross-sell-trend',
  CROSS_SELL_SUMMARY: 'cross-sell-summary',
  CROSS_SELL_ORG_TREND: 'cross-sell-org-trend',
  CROSS_SELL_HEATMAP: 'cross-sell-heatmap',
  CROSS_SELL_TOP_SALESMAN: 'cross-sell-top-salesman',
  CROSS_SELL_BUNDLE: 'cross-sell-bundle',

  // 业务员排名
  SALESMAN_RANKING: 'salesman-ranking',

  // 业绩分析
  PERFORMANCE_SUMMARY: 'performance-summary',
  PERFORMANCE_TREND: 'performance-trend',
  PERFORMANCE_DRILLDOWN: 'performance-drilldown',
  PERFORMANCE_ORG_HEATMAP: 'performance-org-heatmap',
  PERFORMANCE_TOP_SALESMAN: 'performance-top-salesman',
  PERFORMANCE_BUNDLE: 'performance-bundle',

  // 报表
  MARKETING_REPORT: 'marketing-report',
  HOLIDAY_DRILLDOWN: 'holiday-drilldown',
  PREMIUM_REPORT: 'premium-report',

  // 保费计划
  PREMIUM_PLAN: 'premium-plan',
  PLAN_ACHIEVEMENT: 'plan-achievement',

  // 仪表盘聚合
  DASHBOARD_BUNDLE: 'dashboard-bundle',

  // 报价转化
  QUOTE_CONVERSION: {
    KPI: 'quote-conversion/kpi',
    FUNNEL: 'quote-conversion/funnel',
    DRILLDOWN: 'quote-conversion/drilldown',
    HEATMAP: 'quote-conversion/heatmap',
    PRICE: 'quote-conversion/price',
    RANKING: 'quote-conversion/ranking',
    TREND: 'quote-conversion/trend',
  },
  // 费用率发展
  EXPENSE_DEVELOPMENT: 'expense-development',
  // 维修资源
  REPAIR: {
    // v1
    OVERVIEW: 'repair/overview',
    DETAIL: 'repair/detail',
    STATUS: 'repair/status',
    METADATA: 'repair/metadata',
    // v2（2026-04-18 重设计：单页下钻 + 本地资源占比 + 导流清单）
    CITY: 'repair/city',
    CHANNEL: 'repair/channel',
    COOP_TIER: 'repair/coop-tier',
    SCATTER: 'repair/scatter',
    LOCAL_RESOURCE: 'repair/local-resource',
    TO_PREMIUM: 'repair/to-premium',
    DIVERSION_LIST: 'repair/diversion-list',
    ORPHAN_SHOPS: 'repair/orphan-shops',
  },
  // 客户来源去向
  CUSTOMER_FLOW: {
    SUMMARY: 'customer-flow/summary',
    INFLOW: 'customer-flow/inflow',
    OUTFLOW: 'customer-flow/outflow',
    TREND: 'customer-flow/trend',
    METADATA: 'customer-flow/metadata',
  },
  // 承保地理分布
  POLICY_GEO: {
    PROVINCE: 'policy-geo/province',
    CITY: 'policy-geo/city',
  },

  // 巡检报告
  PATROL: 'patrol',

  // 续保追踪
  RENEWAL_TRACKER: 'renewal-tracker',

  // 赔案明细
  CLAIMS_DETAIL: {
    PENDING_OVERVIEW: 'claims-detail/pending-overview',
    PENDING_BY_ORG: 'claims-detail/pending-by-org',
    PENDING_AGING: 'claims-detail/pending-aging',
    CAUSE_ANALYSIS: 'claims-detail/cause-analysis',
    GEO_ACCIDENT: 'claims-detail/geo-accident',
    GEO_PLATE: 'claims-detail/geo-plate',
    GEO_COMPARISON: 'claims-detail/geo-comparison',
    CLAIM_CYCLE: 'claims-detail/claim-cycle',
    FREQUENCY_YOY: 'claims-detail/frequency-yoy',
    LOSS_RATIO_DEV: 'claims-detail/loss-ratio-development',
    HEATMAP: 'claims-detail/heatmap',
  },
} as const;

// ─────────────────────────────────────────────
// /api/data/* 路由
// ─────────────────────────────────────────────
export const DATA_ROUTES = {
  UPLOAD: 'upload',
  METADATA: 'metadata',
  CLEAR: 'clear',
  FILES: 'files',
  LOAD: 'load',
  DOWNLOAD: 'download',
  KPI_PLAN_CONFIG: 'kpi-plan-config',
} as const;

// ─────────────────────────────────────────────
// /api/auth/* 路由
// ─────────────────────────────────────────────
export const AUTH_ROUTES = {
  LOGIN: 'auth/login',
  REFRESH: 'auth/refresh',
  LOGOUT: 'auth/logout',
  ME: 'auth/me',

  USERS: 'auth/users',
  USER_BY_ID: 'auth/users',

  ROLES: 'auth/roles',
  ROLE_BY_ID: 'auth/roles',

  WECOM_CONFIG: 'auth/wecom/config',
} as const;

// ─────────────────────────────────────────────
// /api/ai/* 路由
// ─────────────────────────────────────────────
export const AI_ROUTES = {
  VALIDATE_KEY: 'ai/validate-key',
  TREND_ANALYSIS: 'ai/trend-analysis',
  DETECT_REQUIREMENT: 'ai/detect-requirement',
  CAPABILITIES: 'ai/capabilities',
  QUICK_SUGGESTIONS: 'ai/quick-suggestions',
} as const;

// ─────────────────────────────────────────────
// /api/agent/audit/* 路由
// ─────────────────────────────────────────────
export const AGENT_AUDIT_ROUTES = {
  METRICS: 'agent/audit/metrics',
  CAPABILITIES: 'agent/audit/capabilities',
  UNSUPPORTED: 'agent/audit/unsupported',
  OBSERVABILITY: 'agent/audit/observability',
  READINESS: 'agent/audit/readiness',
  ROUTE_QUESTION: 'agent/audit/route-question',
} as const;

// ─────────────────────────────────────────────
// /api/agent/diagnosis/* 路由
// ─────────────────────────────────────────────
export const AGENT_DIAGNOSIS_ROUTES = {
  COST_INDICATORS: 'agent/diagnosis/cost-indicators',
  GROWTH: 'agent/diagnosis/growth',
  QUOTE_CONVERSION: 'agent/diagnosis/quote-conversion',
  RENEWAL_TRACKER: 'agent/diagnosis/renewal-tracker',
  CLAIMS_RISK: 'agent/diagnosis/claims-risk',
  CUSTOMER_FLOW: 'agent/diagnosis/customer-flow',
  BUSINESS_PATROL: 'agent/diagnosis/business-patrol',
} as const;

// ─────────────────────────────────────────────
// /api/agent/explain/* 路由
// ─────────────────────────────────────────────
export const AGENT_EXPLAIN_ROUTES = {
  DIAGNOSIS: 'agent/explain/diagnosis',
} as const;

// ─────────────────────────────────────────────
// /api/filters/* 路由
// ─────────────────────────────────────────────
export const FILTER_ROUTES = {
  OPTIONS: 'filters/options',
} as const;

// ─────────────────────────────────────────────
// /api/copilot/* 路由（阶段 3）
// ─────────────────────────────────────────────
export const COPILOT_ROUTES = {
  RUNS: 'copilot/runs',
  RUN_STREAM: 'copilot/runs/:runId/stream',
  RUN_REPORT: 'copilot/runs/:runId/report',
} as const;
