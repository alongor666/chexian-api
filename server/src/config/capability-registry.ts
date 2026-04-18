/**
 * 能力注册表（Capability Registry）
 *
 * 定义平台所有已有报表/分析能力，供 AI 意图识别匹配使用。
 * 同时作为前端快捷建议的数据源。
 */

export interface Capability {
  id: string;
  route: string;
  name: string;
  icon: string;
  description: string;
  keywords: string[];
  exampleQueries: string[];
  requiresPermission?: string;
}

export const capabilities: Capability[] = [
  {
    id: 'dashboard',
    route: '/dashboard',
    name: '仪表盘',
    icon: 'LayoutDashboard',
    description: '综合业绩总览：KPI 大盘（保费、件数、人均产能）、保费趋势图、机构排名、客户类别/险别/终端来源玫瑰图',
    keywords: ['仪表盘', '总览', '大盘', 'KPI', '概览', '保费总量', '件数', '人均产能'],
    exampleQueries: [
      '看一下整体业绩情况',
      '总保费是多少',
      '今天的KPI数据',
      '业绩概览',
      '大盘数据',
    ],
  },
  {
    id: 'performance-analysis',
    route: '/performance-analysis',
    name: '业绩分析',
    icon: 'TrendingUp',
    description: '按机构/团队/业务员的多维业绩分析，支持下钻、热力图、排名',
    keywords: ['业绩', '机构业绩', '团队业绩', '排名', '热力图', '下钻', '业务员排名'],
    exampleQueries: [
      '各机构业绩排名',
      '哪个团队业绩最好',
      '业务员保费排名 Top20',
      '机构业绩热力图',
      '业绩下钻分析',
    ],
  },
  {
    id: 'premium-report',
    route: '/reports?tab=premium',
    name: '保费报表',
    icon: 'DollarSign',
    description: '保费明细报表，含计划达成率、完成进度、机构对比',
    keywords: ['保费', '报表', '计划', '达成率', '完成率', '进度'],
    exampleQueries: [
      '保费完成率怎么样',
      '各机构保费达成率',
      '保费计划完成进度',
      '保费报表',
    ],
  },
  // marketing-report 已合并到 premium-report（保费达成）页面
  {
    id: 'truck',
    route: '/specialty?tab=truck',
    name: '营业货车',
    icon: 'Truck',
    description: '营业货车分析：吨位段分布、堆叠柱状图、机构对比',
    keywords: ['货车', '营业货车', '吨位', '商用车'],
    exampleQueries: [
      '营业货车数据',
      '货车吨位段分布',
      '商用车业务情况',
    ],
  },
  {
    id: 'renewal',
    route: '/renewal-analysis',
    name: '续保分析',
    icon: 'RefreshCw',
    description: '续保率分析，含机构/团队/业务员维度续保率、续保明细下钻',
    keywords: ['续保', '续保率', '到期续保', '续转率'],
    exampleQueries: [
      '续保率是多少',
      '各机构续保情况',
      '续保分析',
      '到期保单续保率',
    ],
  },
  {
    id: 'cross-sell',
    route: '/specialty?tab=cross-sell',
    name: '驾意险推介率',
    icon: 'Gift',
    description: '驾意险交叉销售推介率分析，四象限散点图（件均保费 vs 推介件数）',
    keywords: ['驾意险', '推介率', '交叉销售', '散点图', '四象限'],
    exampleQueries: [
      '驾意险推介率排名',
      '各机构推介率',
      '交叉销售情况',
      '驾意险分析',
    ],
  },
  {
    id: 'growth',
    route: '/growth',
    name: '增长分析',
    icon: 'TrendingUp',
    description: '保费增长分析，同比/环比增长率、增量来源拆解',
    keywords: ['增长', '同比', '环比', '增长率', '增量'],
    exampleQueries: [
      '保费增长率',
      '同比增长情况',
      '增长分析',
      '业务增量从哪来',
    ],
  },
  {
    id: 'cost',
    route: '/cost',
    name: '成本分析',
    icon: 'Calculator',
    description: '成本四子板块：赔付率、费用率、综合费用率、变动成本率，含综合分析视图',
    keywords: ['成本', '赔付率', '费用率', '综合费用率', '变动成本率', '综合成本', '综合分析'],
    exampleQueries: [
      '成本分析',
      '赔付率是多少',
      '综合费用率',
      '变动成本率',
    ],
    requiresPermission: 'cost',
  },
  {
    id: 'comparison',
    route: '/growth',
    name: '数据对比',
    icon: 'Scale',
    description: '多维度数据横向对比：机构间、时间段间对比（已合并至增长分析）',
    keywords: ['对比', '比较', '横向对比', '机构对比'],
    exampleQueries: [
      '机构之间数据对比',
      '不同时间段对比',
      '数据比较',
    ],
  },
  {
    id: 'templates',
    route: '/templates',
    name: '报表模板',
    icon: 'FileText',
    description: 'NL2SQL 自然语言查询，17 个预置 SQL 模板',
    keywords: ['SQL', '查询', '自定义查询', '模板', '自然语言'],
    exampleQueries: [
      '自定义SQL查询',
      '用自然语言查数据',
      '报表模板',
    ],
  },
  {
    id: 'moto-cost',
    route: '/moto-cost',
    name: '摩意模型',
    icon: 'Bike',
    description: '摩托车意外险成本测算模型',
    keywords: ['摩托车', '摩意', '意外险', '成本测算'],
    exampleQueries: [
      '摩意模型',
      '摩托车成本测算',
    ],
    requiresPermission: 'motoCost',
  },
];

/**
 * 生成供 AI 使用的能力摘要文本
 */
export function getCapabilitySummaryForAI(): string {
  return capabilities
    .map(
      (c) =>
        `[${c.id}] ${c.name} (${c.route}): ${c.description}。关键词: ${c.keywords.join('、')}`
    )
    .join('\n');
}

/**
 * 获取用于前端快捷建议的示例查询
 */
export function getQuickSuggestions(count = 6): Array<{ text: string; capabilityId: string }> {
  const suggestions: Array<{ text: string; capabilityId: string }> = [];
  for (const cap of capabilities) {
    for (const q of cap.exampleQueries) {
      suggestions.push({ text: q, capabilityId: cap.id });
    }
  }
  // 从不同能力中均匀抽样
  const seen = new Set<string>();
  const result: Array<{ text: string; capabilityId: string }> = [];
  for (const s of suggestions) {
    if (!seen.has(s.capabilityId) && result.length < count) {
      result.push(s);
      seen.add(s.capabilityId);
    }
  }
  return result;
}
