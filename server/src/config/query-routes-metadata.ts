/**
 * Query 路由元数据集中表
 *
 * 给 CLI / MCP / Web UI 命令枚举使用。本文件是 query 路由"对外可发现"能力的唯一事实源。
 *
 * 不强制各 query 子路由 export zod schema（迁移成本大）；参数只做"提示性"描述。
 * 真正的参数校验仍在各子路由内部完成。
 *
 * 新增路由时：
 *   1) 在 server/src/config/api-routes.ts 的 QUERY_ROUTES 加 path 常量
 *   2) 在本文件 QUERY_ROUTE_METADATA 加描述（key 与 QUERY_ROUTES 对应）
 *
 * RED LINE：不可删除已有条目，只可追加；删除路由需走 BACKLOG.md 流程。
 */

export interface QueryRouteParam {
  /** 参数名（query string key） */
  name: string;
  /** 类型提示（CLI/MCP 渲染用，不做强校验） */
  type: 'string' | 'number' | 'boolean' | 'date';
  /** 是否必填 */
  required?: boolean;
  /** 人类可读说明 */
  description: string;
  /** 可选枚举值 */
  enum?: string[];
}

export interface QueryRouteMeta {
  /** 与 QUERY_ROUTES key 对应（如 'KPI'） */
  key: string;
  /** /api/query 后的路径段（如 '/kpi'） */
  path: string;
  /** HTTP 方法（query 路由统一 GET） */
  method: 'GET';
  /** 一句话标题 */
  summary: string;
  /** 详细说明（给 LLM 看） */
  description: string;
  /** 参数提示（非强校验） */
  parameters: QueryRouteParam[];
  /** 数据范围提示（受 dataScope 限制） */
  dataScope: 'all' | 'org' | 'telemarketing' | 'any';
  /** 业务领域标签，便于分组 */
  tags: string[];
}

// 常用参数复用（避免到处重复）
const COMMON_PARAMS = {
  year: { name: 'year', type: 'number', description: '保单年度，如 2026' } as QueryRouteParam,
  weekNumber: { name: 'week_number', type: 'number', description: '周序号 1-53' } as QueryRouteParam,
  monthNumber: { name: 'month_number', type: 'number', description: '月份 1-12' } as QueryRouteParam,
  startDate: { name: 'start_date', type: 'date', description: '开始日期 YYYY-MM-DD' } as QueryRouteParam,
  endDate: { name: 'end_date', type: 'date', description: '结束日期 YYYY-MM-DD' } as QueryRouteParam,
  orgLevel3: { name: 'org_level_3', type: 'string', description: '三级机构名（受 dataScope 限制）' } as QueryRouteParam,
  channel: { name: 'channel', type: 'string', description: '业务渠道（如 个代 / 中介 / 电销）' } as QueryRouteParam,
  customerCategory: { name: 'customer_category', type: 'string', description: '客户类别（11 类）' } as QueryRouteParam,
  insuranceType: { name: 'insurance_type', type: 'string', description: '险种类型', enum: ['交强险', '商业险', '主全', '交三'] } as QueryRouteParam,
};

const TS_COMMON = [COMMON_PARAMS.year, COMMON_PARAMS.weekNumber, COMMON_PARAMS.startDate, COMMON_PARAMS.endDate];
const ORG_FILTER = [COMMON_PARAMS.orgLevel3, COMMON_PARAMS.channel, COMMON_PARAMS.customerCategory];

export const QUERY_ROUTE_METADATA: QueryRouteMeta[] = [
  // ── KPI ────────────────────────────────────────
  {
    key: 'KPI', path: '/kpi', method: 'GET',
    summary: 'KPI 大盘指标',
    description: '返回保费/件数/赔款/费用率/赔付率等核心 KPI。支持按时间和维度过滤。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['kpi', 'core'],
  },
  {
    key: 'KPI_DETAIL', path: '/kpi-detail', method: 'GET',
    summary: 'KPI 明细',
    description: '在 KPI 大盘基础上按业务条线/客户类别二维展开。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['kpi'],
  },

  // ── 趋势 ───────────────────────────────────────
  {
    key: 'TREND', path: '/trend', method: 'GET',
    summary: '时间趋势分析',
    description: '按周或月返回核心指标的时间序列，用于走势图。',
    parameters: [...TS_COMMON, ...ORG_FILTER,
      { name: 'granularity', type: 'string', description: '粒度', enum: ['week', 'month'] }],
    dataScope: 'any',
    tags: ['trend'],
  },
  {
    key: 'QUALITY_BUSINESS_TREND', path: '/quality-business-trend', method: 'GET',
    summary: '优质业务趋势',
    description: '聚焦满期赔付率、综合费用率优秀段的时间趋势。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['trend', 'quality'],
  },

  // ── 货车 + 增长 + 成本 ─────────────────────────
  {
    key: 'TRUCK', path: '/truck', method: 'GET',
    summary: '货车业务专项分析',
    description: '货车（特定使用性质）的多维度专项视图。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['truck'],
  },
  {
    key: 'GROWTH', path: '/growth', method: 'GET',
    summary: '增长分析（同比/环比）',
    description: '按时间段对比业务增长，输出同比/环比指标。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['growth'],
  },
  {
    key: 'COST', path: '/cost', method: 'GET',
    summary: '成本分析（赔付率/费用率）',
    description: '满期赔付率、综合费用率、变动成本率的多维分解。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['cost'],
  },

  // ── 综合 ───────────────────────────────────────
  {
    key: 'COMPREHENSIVE_BUNDLE', path: '/comprehensive-bundle', method: 'GET',
    summary: '综合分析聚合',
    description: '一次请求返回综合分析页所需的多板块数据。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['bundle'],
  },
  {
    key: 'COMPREHENSIVE_ANALYSIS_BUNDLE', path: '/comprehensive-analysis-bundle', method: 'GET',
    summary: '综合分析聚合 v2',
    description: '综合分析板块的扩展聚合。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['bundle'],
  },

  // ── 交叉销售（车驾意） ─────────────────────────
  {
    key: 'CROSS_SELL', path: '/cross-sell', method: 'GET',
    summary: '车驾意推介率',
    description: '驾意险推介件数 / 商业险出单件数（主全+交三，去重车架号）。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['cross-sell'],
  },
  {
    key: 'CROSS_SELL_TREND', path: '/cross-sell-trend', method: 'GET',
    summary: '车驾意推介率时间趋势',
    description: '车驾意推介率的周/月时间序列。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['cross-sell', 'trend'],
  },
  {
    key: 'CROSS_SELL_SUMMARY', path: '/cross-sell-summary', method: 'GET',
    summary: '车驾意推介摘要',
    description: '推介率/渗透率核心指标汇总。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['cross-sell'],
  },
  {
    key: 'CROSS_SELL_ORG_TREND', path: '/cross-sell-org-trend', method: 'GET',
    summary: '车驾意机构趋势',
    description: '按机构分组的推介率时间趋势。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['cross-sell', 'org'],
  },
  {
    key: 'CROSS_SELL_HEATMAP', path: '/cross-sell-heatmap', method: 'GET',
    summary: '车驾意热力图',
    description: '机构 × 时间 推介率热力图。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['cross-sell'],
  },
  {
    key: 'CROSS_SELL_TOP_SALESMAN', path: '/cross-sell-top-salesman', method: 'GET',
    summary: '车驾意 Top 业务员',
    description: '推介率领先的业务员排名。',
    parameters: [...TS_COMMON, { name: 'limit', type: 'number', description: '返回行数，默认 30' }],
    dataScope: 'any',
    tags: ['cross-sell', 'ranking'],
  },
  {
    key: 'CROSS_SELL_BUNDLE', path: '/cross-sell-bundle', method: 'GET',
    summary: '车驾意聚合',
    description: '一次请求返回车驾意页所需所有数据。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['cross-sell', 'bundle'],
  },

  // ── 业务员排名 + 业绩 ─────────────────────────
  {
    key: 'SALESMAN_RANKING', path: '/salesman-ranking', method: 'GET',
    summary: '业务员排名',
    description: '业务员保费/件数/赔付率综合排名。',
    parameters: [...TS_COMMON, ...ORG_FILTER,
      { name: 'limit', type: 'number', description: 'Top N（默认 30）' }],
    dataScope: 'any',
    tags: ['ranking'],
  },
  {
    key: 'PERFORMANCE_SUMMARY', path: '/performance-summary', method: 'GET',
    summary: '业绩汇总',
    description: '业绩分析页核心 KPI 汇总。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['performance'],
  },
  {
    key: 'PERFORMANCE_TREND', path: '/performance-trend', method: 'GET',
    summary: '业绩趋势',
    description: '业绩分析页时间序列。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['performance', 'trend'],
  },
  {
    key: 'PERFORMANCE_DRILLDOWN', path: '/performance-drilldown', method: 'GET',
    summary: '业绩下钻',
    description: '按维度下钻业绩明细。',
    parameters: [...TS_COMMON, ...ORG_FILTER,
      { name: 'dimension', type: 'string', description: '下钻维度', enum: ['channel', 'customer_category', 'salesman'] }],
    dataScope: 'any',
    tags: ['performance'],
  },
  {
    key: 'PERFORMANCE_ORG_HEATMAP', path: '/performance-org-heatmap', method: 'GET',
    summary: '业绩机构热力图',
    description: '机构维度的业绩热力图。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['performance'],
  },
  {
    key: 'PERFORMANCE_TOP_SALESMAN', path: '/performance-top-salesman', method: 'GET',
    summary: '业绩 Top 业务员',
    description: '业绩 Top N 业务员清单。',
    parameters: [...TS_COMMON, { name: 'limit', type: 'number', description: 'Top N（默认 30）' }],
    dataScope: 'any',
    tags: ['performance', 'ranking'],
  },
  {
    key: 'PERFORMANCE_BUNDLE', path: '/performance-bundle', method: 'GET',
    summary: '业绩聚合',
    description: '一次请求返回业绩分析页所需所有数据。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['performance', 'bundle'],
  },

  // ── 报表 ───────────────────────────────────────
  {
    key: 'MARKETING_REPORT', path: '/marketing-report', method: 'GET',
    summary: '营销报表',
    description: '面向运营的多板块营销报表。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['report'],
  },
  {
    key: 'HOLIDAY_DRILLDOWN', path: '/holiday-drilldown', method: 'GET',
    summary: '节假日下钻',
    description: '节假日期间业务走势下钻。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['report'],
  },
  {
    key: 'PREMIUM_REPORT', path: '/premium-report', method: 'GET',
    summary: '保费报表',
    description: '保费类报表（计划/实际/达成）。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['report'],
  },
  {
    key: 'PREMIUM_PLAN', path: '/premium-plan', method: 'GET',
    summary: '保费计划',
    description: '当前保费计划配置。',
    parameters: [{ name: 'year', type: 'number', description: '计划年度' }],
    dataScope: 'any',
    tags: ['plan'],
  },
  {
    key: 'PLAN_ACHIEVEMENT', path: '/plan-achievement', method: 'GET',
    summary: '计划达成率',
    description: '保费计划完成情况。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['plan'],
  },

  // ── 仪表盘聚合 ──────────────────────────────────
  {
    key: 'DASHBOARD_BUNDLE', path: '/dashboard-bundle', method: 'GET',
    summary: '仪表盘聚合',
    description: '一次请求返回主仪表盘所有面板数据。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['bundle'],
  },

  // ── 巡检 + 续保追踪 ────────────────────────────
  {
    key: 'PATROL', path: '/patrol', method: 'GET',
    summary: '业务巡检',
    description: '业务异常巡检数据（数据质量、潜在风险）。',
    parameters: TS_COMMON,
    dataScope: 'any',
    tags: ['patrol'],
  },
  {
    key: 'RENEWAL_TRACKER', path: '/renewal-tracker', method: 'GET',
    summary: '续保追踪',
    description: '续保到期清单、跟进状态、目标客户。',
    parameters: [...TS_COMMON, ...ORG_FILTER],
    dataScope: 'any',
    tags: ['renewal'],
  },
];

/** 按 key 索引 */
export function getRouteMetaByKey(key: string): QueryRouteMeta | undefined {
  return QUERY_ROUTE_METADATA.find(r => r.key === key);
}

/** 按 path 索引（/kpi → KPI 条目） */
export function getRouteMetaByPath(path: string): QueryRouteMeta | undefined {
  return QUERY_ROUTE_METADATA.find(r => r.path === path);
}
