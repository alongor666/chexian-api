/**
 * 指标展示映射 — 从注册表自动生成
 *
 * 生成命令：npx tsx scripts/metric-registry/generate-frontend-map.ts
 * 生成时间：2026-03-27T09:35:09.057Z
 * 指标数量：25
 *
 * ⚠ 不要手动编辑此文件，修改注册表后重新生成
 */

/** 指标 ID → 中文标签 */
export const METRIC_LABEL_MAP: Record<string, string> = {
  'total_premium': '总保费',
  'policy_count': '保单件数',
  'org_count': '机构数',
  'salesman_count': '业务员数',
  'per_capita_premium': '人均保费',
  'transfer_rate': '过户占比',
  'telesales_rate': '电销占比',
  'renewal_rate': '续保占比',
  'commercial_rate': '商业险占比',
  'nev_rate': '新能源占比',
  'new_car_rate': '新车占比',
  'quality_business_rate': '优质业务占比',
  'commercial_insurance_rate': '商业险投保率',
  'earned_claim_ratio': '赔付率',
  'expense_ratio': '费用率',
  'avg_claim_amount': '案均赔款',
  'earned_premium': '满期保费',
  'variable_cost_ratio': '变动成本率',
  'earned_loss_frequency': '出险率',
  'cross_sell_total_rate': '推介率',
  'cross_sell_danjiao_rate': '单交推介率',
  'cross_sell_jiaosan_rate': '交三推介率',
  'cross_sell_zhuquan_rate': '主全推介率',
  'growth_rate_yoy': '同比增长率',
  'growth_rate_mom': '环比增长率',
} as const;

/** 指标 ID → 格式化配置 */
export const METRIC_FORMATTER_MAP: Record<string, {
  formatter: string;
  unit?: string;
  decimals?: number;
}> = {
  'total_premium': { formatter: 'premiumWan', unit: '万元' },
  'policy_count': { formatter: 'count', unit: '件' },
  'org_count': { formatter: 'count', unit: '个' },
  'salesman_count': { formatter: 'count', unit: '人' },
  'per_capita_premium': { formatter: 'premiumWan', unit: '万元' },
  'transfer_rate': { formatter: 'percent', unit: '%' },
  'telesales_rate': { formatter: 'percent', unit: '%' },
  'renewal_rate': { formatter: 'percent', unit: '%' },
  'commercial_rate': { formatter: 'percent', unit: '%' },
  'nev_rate': { formatter: 'percent', unit: '%' },
  'new_car_rate': { formatter: 'percent', unit: '%' },
  'quality_business_rate': { formatter: 'percent', unit: '%' },
  'commercial_insurance_rate': { formatter: 'percent', unit: '%' },
  'earned_claim_ratio': { formatter: 'percent', unit: '%', decimals: 2 },
  'expense_ratio': { formatter: 'percent', unit: '%', decimals: 2 },
  'avg_claim_amount': { formatter: 'premiumWan', unit: '万元' },
  'earned_premium': { formatter: 'premiumWan', unit: '万元' },
  'variable_cost_ratio': { formatter: 'percent', unit: '%', decimals: 2 },
  'earned_loss_frequency': { formatter: 'percent', unit: '%', decimals: 2 },
  'cross_sell_total_rate': { formatter: 'percent', unit: '%', decimals: 2 },
  'cross_sell_danjiao_rate': { formatter: 'percent', unit: '%', decimals: 2 },
  'cross_sell_jiaosan_rate': { formatter: 'percent', unit: '%', decimals: 2 },
  'cross_sell_zhuquan_rate': { formatter: 'percent', unit: '%', decimals: 2 },
  'growth_rate_yoy': { formatter: 'percent', unit: '%', decimals: 2 },
  'growth_rate_mom': { formatter: 'percent', unit: '%', decimals: 2 },
} as const;

/** 指标 ID → 公式描述 */
export const METRIC_FORMULA_MAP: Record<string, string> = {
  'total_premium': '所有保单保费之和',
  'policy_count': '去重保单计数',
  'org_count': '去重三级机构计数',
  'salesman_count': '去重业务员计数',
  'per_capita_premium': '保费总额 / 业务员数',
  'transfer_rate': '过户保单数 / 总保单数',
  'telesales_rate': '电销保单数 / 总保单数',
  'renewal_rate': '续保保单数 / 总保单数',
  'commercial_rate': '商业保险保费 / 总保费',
  'nev_rate': '新能源车保单数 / 总保单数',
  'new_car_rate': '新车保单数 / 总保单数',
  'quality_business_rate': '优质业务保单数 / 总保单数',
  'commercial_insurance_rate': '商业险件数 / 交强险件数',
  'earned_claim_ratio': '已报告赔款 / 满期保费',
  'expense_ratio': '费用金额 / 保费',
  'avg_claim_amount': '已报告赔款 / 赔案件数',
  'earned_premium': '保费按满期天数折算',
  'variable_cost_ratio': '满期赔付率 + 费用率（注意：两个分母不同）',
  'earned_loss_frequency': '赔案件数 * 365 / 满期天数合计（年化）',
  'cross_sell_total_rate': '驾意险件数 / 车险件数',
  'cross_sell_danjiao_rate': '单交下驾意险件数 / 单交车险件数',
  'cross_sell_jiaosan_rate': '交三下驾意险件数 / 交三车险件数',
  'cross_sell_zhuquan_rate': '主全下驾意险件数 / 主全车险件数',
  'growth_rate_yoy': '(本期 - 去年同期) / 去年同期',
  'growth_rate_mom': '(本期 - 上期) / 上期',
} as const;
