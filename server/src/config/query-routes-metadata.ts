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

// 报价转化域公共参数（routes/query/quote-conversion.ts quoteFilterSchema）
const QUOTE_PARAMS: QueryRouteParam[] = [
  { name: 'dateStart', type: 'date', description: '起保日期下限 YYYY-MM-DD' },
  { name: 'dateEnd', type: 'date', description: '起保日期上限 YYYY-MM-DD' },
  { name: 'renewalType', type: 'string', description: '续转类型', enum: ['续保', '转保'] },
  { name: 'orgName', type: 'string', description: '三级机构名（受 dataScope 限制）' },
  { name: 'teamName', type: 'string', description: '销售团队名' },
  { name: 'salesmanNo', type: 'string', description: '业务员工号' },
  { name: 'customerCategory', type: 'string', description: '客户类别（11 类）' },
  { name: 'insuranceCombo', type: 'string', description: '险别组合', enum: ['主全', '交三'] },
  { name: 'isTelemarketing', type: 'string', description: '是否电销', enum: ['电销', '非电销'] },
  { name: 'isNewEnergy', type: 'string', description: '是否新能源', enum: ['是', '否'] },
  { name: 'isTransferred', type: 'string', description: '是否过户', enum: ['是', '否'] },
  { name: 'riskGrade', type: 'string', description: '风险等级', enum: ['A', 'B', 'C', 'D'] },
  { name: 'ncdMin', type: 'number', description: 'NCD 系数下限' },
  { name: 'ncdMax', type: 'number', description: 'NCD 系数上限' },
];

// 维修资源域 v1 公共参数（routes/query/repair.ts filterSchema）
const REPAIR_PARAMS: QueryRouteParam[] = [
  { name: 'orgName', type: 'string', description: '三级机构名（受 dataScope 限制）' },
  { name: 'is4sShop', type: 'string', description: '是否 4S 店', enum: ['true', 'false'] },
  { name: 'cooperationStatus', type: 'string', description: '合作状态' },
  { name: 'city', type: 'string', description: '城市' },
];

// 赔案明细域公共参数（routes/query/claims-detail.ts parseFilters）
const CLAIMS_DETAIL_PARAMS: QueryRouteParam[] = [
  { name: 'dateStart', type: 'date', description: '出险日期下限 YYYY-MM-DD' },
  { name: 'dateEnd', type: 'date', description: '出险日期上限 YYYY-MM-DD' },
  { name: 'orgName', type: 'string', description: '三级机构名（受 dataScope 限制）' },
  { name: 'claimStatus', type: 'string', description: '赔案状态（已结案/未结案）' },
  { name: 'isBodilyInjury', type: 'string', description: '是否人伤案' },
  { name: 'accidentCause', type: 'string', description: '出险原因' },
  { name: 'accidentCity', type: 'string', description: '出险城市' },
  { name: 'customerCategory', type: 'string', description: '客户类别（11 类）' },
  { name: 'isNev', type: 'string', description: '是否新能源', enum: ['是', '否'] },
  { name: 'coverageCombination', type: 'string', description: '险别组合' },
  { name: 'isTransfer', type: 'string', description: '是否过户', enum: ['是', '否'] },
  { name: 'vehicleQuickFilter', type: 'string', description: '车型快捷预设' },
  { name: 'businessNature', type: 'string', description: '业务性质' },
  { name: 'isNewCar', type: 'string', description: '是否新车', enum: ['是', '否'] },
  { name: 'isRenewal', type: 'string', description: '是否续保', enum: ['是', '否'] },
  { name: 'cutoffDate', type: 'date', description: '满期口径截止日（earned 分母计算）' },
];

// 客户来源去向域参数（routes/query/customer-flow.ts filterSchema）
const CUSTOMER_FLOW_PARAMS: QueryRouteParam[] = [
  { name: 'year', type: 'number', description: '保单年度（2020-2030）' },
];

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
    // 2026-06-09 修正：原 path '/patrol' 在服务端不存在（实挂载为 /patrol/:domain），CLI/MCP 调用必 404
    key: 'PATROL', path: '/patrol/:domain', method: 'GET',
    summary: '业务巡检报告',
    description: '返回指定域的最新巡检报告（path 参数 domain，当前支持 renewal）。',
    parameters: [
      { name: 'domain', type: 'string', required: true, description: '巡检域（path 参数）', enum: ['renewal'] },
    ],
    dataScope: 'any',
    tags: ['patrol'],
  },
  {
    key: 'PATROL_NARRATIVE', path: '/patrol/:domain/narrative', method: 'GET',
    summary: '业务巡检叙事报告',
    description: '返回指定域巡检报告的叙事文本版（path 参数 domain，当前支持 renewal）。',
    parameters: [
      { name: 'domain', type: 'string', required: true, description: '巡检域（path 参数）', enum: ['renewal'] },
    ],
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

  // ── PIVOT 维度×指标交叉聚合 ──────────────────────
  {
    key: 'PIVOT', path: '/pivot', method: 'GET',
    summary: '维度×指标交叉聚合',
    description: '让 Agent 自由组合 1-2 个维度 × 1-10 个指标做 GROUP BY 聚合。维度走白名单（org_level_3 / salesman_name / customer_category / insurance_type / coverage_combination / tonnage_segment / renewal_mode / insurance_grade / is_renewal / is_new_car / is_nev / is_telemarketing / is_transfer / week_number / month_number），指标走 metric-registry（参考 /api/discover/metrics）。',
    parameters: [
      { name: 'dimensions', type: 'string', required: true, description: '逗号分隔的 1-2 个维度（如 org_level_3,customer_category）' },
      { name: 'metrics', type: 'string', required: true, description: '逗号分隔的 1-10 个指标 id（如 total_premium,policy_count）' },
      { name: 'limit', type: 'number', description: '返回行数，默认 100，上限 500' },
      ...TS_COMMON, ...ORG_FILTER,
    ],
    dataScope: 'any',
    tags: ['pivot', 'agent'],
  },

  // ── SQL 直通 ─────────────────────────────────────
  {
    key: 'SQL', path: '/sql', method: 'GET',
    summary: 'DuckDB SELECT/WITH 直通',
    description: '复杂查询安全兜底。强制 SELECT|WITH 开头、必须含 PolicyFact、必须聚合、禁止 policy_no 明细、≤8000 字符。行级权限自动注入到每个 FROM PolicyFact。',
    parameters: [
      { name: 'sql', type: 'string', required: true, description: 'DuckDB SELECT 或 WITH 查询语句（≤8000 字符，必须聚合）' },
    ],
    dataScope: 'any',
    tags: ['sql', 'agent'],
  },

  // ── 报价转化（2026-06-09 catalog 补全，key 扁平命名供 MCP tool 名使用）──
  {
    key: 'QUOTE_CONVERSION_KPI', path: '/quote-conversion/kpi', method: 'GET',
    summary: '报价转化 KPI 汇总',
    description: '报价→成交转化漏斗的核心 KPI：报价件数、成交件数、转化率、平均报价/成交保费。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion', 'kpi'],
  },
  {
    key: 'QUOTE_CONVERSION_FUNNEL', path: '/quote-conversion/funnel', method: 'GET',
    summary: '报价转化漏斗',
    description: '从报价到成交的分阶段漏斗（报价/核保/承保），定位转化流失环节。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion'],
  },
  {
    key: 'QUOTE_CONVERSION_DRILLDOWN', path: '/quote-conversion/drilldown', method: 'GET',
    summary: '报价转化多维下钻',
    description: '按指定维度展开报价转化指标（机构/团队/客户类别等）。',
    parameters: [...QUOTE_PARAMS, { name: 'dimension', type: 'string', description: '下钻维度' }],
    dataScope: 'any',
    tags: ['quote-conversion'],
  },
  {
    key: 'QUOTE_CONVERSION_HEATMAP', path: '/quote-conversion/heatmap', method: 'GET',
    summary: '报价转化机构×维度热力图',
    description: '机构 × 业务维度的转化率热力图，定位低转化组合。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion'],
  },
  {
    key: 'QUOTE_CONVERSION_PRICE', path: '/quote-conversion/price', method: 'GET',
    summary: '报价价格带分析',
    description: '报价保费价格带分布与各价格带的成交率对比。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion'],
  },
  {
    key: 'QUOTE_CONVERSION_RANKING', path: '/quote-conversion/ranking', method: 'GET',
    summary: '报价转化排名',
    description: '按机构/团队/业务员的报价转化率排名。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion', 'ranking'],
  },
  {
    key: 'QUOTE_CONVERSION_TREND', path: '/quote-conversion/trend', method: 'GET',
    summary: '报价转化时间趋势',
    description: '报价量、成交量与转化率的时间序列。',
    parameters: QUOTE_PARAMS,
    dataScope: 'any',
    tags: ['quote-conversion', 'trend'],
  },

  // ── 承保地理分布 ────────────────────────────────
  {
    key: 'POLICY_GEO_PROVINCE', path: '/policy-geo/province', method: 'GET',
    summary: '承保地理分布（省级）',
    description: '按车牌归属地省份统计承保保费/件数分布（地域锚点用车牌而非机构）。',
    parameters: [COMMON_PARAMS.year],
    dataScope: 'any',
    tags: ['policy-geo'],
  },
  {
    key: 'POLICY_GEO_CITY', path: '/policy-geo/city', method: 'GET',
    summary: '承保地理分布（市级）',
    description: '指定省份内按车牌归属地城市统计承保分布。',
    parameters: [COMMON_PARAMS.year, { name: 'province', type: 'string', description: '省份名' }],
    dataScope: 'any',
    tags: ['policy-geo'],
  },

  // ── 维修资源 ────────────────────────────────────
  {
    key: 'REPAIR_OVERVIEW', path: '/repair/overview', method: 'GET',
    summary: '维修资源机构级汇总',
    description: '各机构维修送修量、产值与合作修理厂概况。',
    parameters: REPAIR_PARAMS,
    dataScope: 'any',
    tags: ['repair'],
  },
  {
    key: 'REPAIR_DETAIL', path: '/repair/detail', method: 'GET',
    summary: '修理厂明细（分页）',
    description: '修理厂级明细清单，支持分页。',
    parameters: [
      ...REPAIR_PARAMS,
      { name: 'page', type: 'number', description: '页码，默认 1' },
      { name: 'pageSize', type: 'number', description: '每页行数，默认 200，上限 500' },
    ],
    dataScope: 'any',
    tags: ['repair'],
  },
  {
    key: 'REPAIR_STATUS', path: '/repair/status', method: 'GET',
    summary: '维修合作状态分布',
    description: '合作中/曾合作/未合作修理厂的数量与送修分布。',
    parameters: REPAIR_PARAMS,
    dataScope: 'any',
    tags: ['repair'],
  },
  {
    key: 'REPAIR_METADATA', path: '/repair/metadata', method: 'GET',
    summary: '维修资源维度元数据',
    description: '维修资源分析可用的维度与可选值清单。',
    parameters: [],
    dataScope: 'any',
    tags: ['repair', 'metadata'],
  },
  // ── 赔案明细 ────────────────────────────────────
  {
    key: 'CLAIMS_DETAIL_PENDING_OVERVIEW', path: '/claims-detail/pending-overview', method: 'GET',
    summary: '未决赔案概览',
    description: '已结案 vs 未结案的赔案件数与金额汇总（未决金额口径 reserve_amount）。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'pending'],
  },
  {
    key: 'CLAIMS_DETAIL_PENDING_BY_ORG', path: '/claims-detail/pending-by-org', method: 'GET',
    summary: '未决赔案按机构分布',
    description: '各三级机构未决赔案件数与未决金额分布。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'pending'],
  },
  {
    key: 'CLAIMS_DETAIL_PENDING_AGING', path: '/claims-detail/pending-aging', method: 'GET',
    summary: '未决赔案账龄分析',
    description: '未决赔案按挂账时长分桶（账龄）分析，定位长尾未决。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'pending'],
  },
  {
    key: 'CLAIMS_DETAIL_CAUSE_ANALYSIS', path: '/claims-detail/cause-analysis', method: 'GET',
    summary: '出险原因分析',
    description: '按出险原因统计案件量、金额与占比。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail'],
  },
  {
    key: 'CLAIMS_DETAIL_GEO_ACCIDENT', path: '/claims-detail/geo-accident', method: 'GET',
    summary: '出险地点地理分布',
    description: '按出险地点城市统计案件量与金额分布。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'geo'],
  },
  {
    key: 'CLAIMS_DETAIL_GEO_PLATE', path: '/claims-detail/geo-plate', method: 'GET',
    summary: '车牌归属地地理分布',
    description: '按出险车辆车牌归属地统计案件分布。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'geo'],
  },
  {
    key: 'CLAIMS_DETAIL_GEO_COMPARISON', path: '/claims-detail/geo-comparison', method: 'GET',
    summary: '出险地 vs 归属地对比',
    description: '出险地点与车牌归属地的交叉对比（异地出险识别）。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'geo'],
  },
  {
    key: 'CLAIMS_DETAIL_CLAIM_CYCLE', path: '/claims-detail/claim-cycle', method: 'GET',
    summary: '理赔周期分析',
    description: '报案到结案的周期分布与各环节时效。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail'],
  },
  {
    key: 'CLAIMS_DETAIL_FREQUENCY_YOY', path: '/claims-detail/frequency-yoy', method: 'GET',
    summary: '出险频度同比',
    description: '出险案件频度的同比对比分析。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail', 'trend'],
  },
  {
    key: 'CLAIMS_DETAIL_LOSS_RATIO_DEVELOPMENT', path: '/claims-detail/loss-ratio-development', method: 'GET',
    summary: '赔付率发展',
    description: '多 cutoff 日期下的满期赔付率发展视图（与理赔热力图同口径）。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail'],
  },
  {
    key: 'CLAIMS_DETAIL_HEATMAP', path: '/claims-detail/heatmap', method: 'GET',
    summary: '理赔热力图',
    description: '维度 × 时间的理赔指标热力图。',
    parameters: CLAIMS_DETAIL_PARAMS,
    dataScope: 'any',
    tags: ['claims-detail'],
  },

  // ── 客户来源去向 ────────────────────────────────
  {
    key: 'CUSTOMER_FLOW_SUMMARY', path: '/customer-flow/summary', method: 'GET',
    summary: '客户来源去向总览',
    description: '客户流入/流出/留存的总览统计（评级对比法）。',
    parameters: CUSTOMER_FLOW_PARAMS,
    dataScope: 'any',
    tags: ['customer-flow'],
  },
  {
    key: 'CUSTOMER_FLOW_INFLOW', path: '/customer-flow/inflow', method: 'GET',
    summary: '客户流入分析',
    description: '新转入客户的来源结构与质量（评级）分析。',
    parameters: CUSTOMER_FLOW_PARAMS,
    dataScope: 'any',
    tags: ['customer-flow'],
  },
  {
    key: 'CUSTOMER_FLOW_OUTFLOW', path: '/customer-flow/outflow', method: 'GET',
    summary: '客户流出分析',
    description: '流失客户的去向结构与质量（评级）分析。',
    parameters: CUSTOMER_FLOW_PARAMS,
    dataScope: 'any',
    tags: ['customer-flow'],
  },
  {
    key: 'CUSTOMER_FLOW_TREND', path: '/customer-flow/trend', method: 'GET',
    summary: '客户流动趋势',
    description: '客户流入/流出量的时间趋势。',
    parameters: CUSTOMER_FLOW_PARAMS,
    dataScope: 'any',
    tags: ['customer-flow', 'trend'],
  },
  {
    key: 'CUSTOMER_FLOW_METADATA', path: '/customer-flow/metadata', method: 'GET',
    summary: '客户流动维度元数据',
    description: '客户来源去向分析可用的维度与可选值。',
    parameters: [],
    dataScope: 'any',
    tags: ['customer-flow', 'metadata'],
  },

  // ── 费用率发展 ──────────────────────────────────
  {
    key: 'EXPENSE_DEVELOPMENT', path: '/expense-development', method: 'GET',
    summary: '费用率发展',
    description: '多年保单批次（保单年度）的费用率随观察期发展视图。',
    parameters: [...TS_COMMON, { name: 'cohortYears', type: 'string', description: '保单年度列表，逗号分隔（如 2024,2025）' }],
    dataScope: 'any',
    tags: ['expense'],
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
