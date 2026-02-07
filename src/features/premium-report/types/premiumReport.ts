/**
 * 保费报表类型定义
 *
 * 包含机构保费报表和业务员保费报表的数据类型
 */

/**
 * 机构保费报表行数据
 */
export interface OrgPremiumReportRow {
  /** 三级机构名称 */
  org_level_3: string;
  /** 车险保费（万元） */
  车险保费: number;
  /** 商业险保费（万元） */
  商业险保费: number;
  /** 交强险保费（万元） */
  交强险保费: number;
  /** 车险件数 */
  车险件数: number;
  /** 商业险件数 */
  商业险件数: number;
  /** 交强险件数 */
  交强险件数: number;
  /** 人均保费（万元） */
  人均保费: number;
  /** 业务员数 */
  业务员数: number;
  /** 同比增长率（%） */
  同比增长率: number | null;
  /** 索引签名 */
  [key: string]: string | number | null;
}

/**
 * 业务员保费报表行数据
 */
export interface SalesmanPremiumReportRow {
  /** 业务员姓名 */
  salesman_name: string;
  /** 三级机构名称 */
  org_level_3: string;
  /** 团队名称 */
  team_name: string;
  /** 车险保费（万元） */
  车险保费: number;
  /** 商业险保费（万元） */
  商业险保费: number;
  /** 交强险保费（万元） */
  交强险保费: number;
  /** 车险件数 */
  车险件数: number;
  /** 商业险件数 */
  商业险件数: number;
  /** 交强险件数 */
  交强险件数: number;
  /** 续保率（%） */
  续保率: number;
  /** 非过户率（%） */
  非过户率: number;
  /** 索引签名 */
  [key: string]: string | number;
}

/**
 * 表格排序状态
 */
export interface SortState {
  /** 排序列名 */
  column: string;
  /** 排序方向 */
  direction: 'asc' | 'desc';
}

/**
 * 保费报表筛选条件
 */
export interface PremiumReportFilters {
  /** 签单口径：policy_date | insurance_start_date */
  dateField: 'policy_date' | 'insurance_start_date';
  /** 分析年度 */
  year: number;
  /** 起始日期 YYYY-MM-DD */
  startDate: string;
  /** 结束日期 YYYY-MM-DD */
  endDate: string;
  /** 机构筛选（可选） */
  org_level_3?: string[];
}

/**
 * 保费报表汇总数据
 */
export interface PremiumReportSummary {
  /** 总保费（万元） */
  totalPremium: number;
  /** 总件数 */
  totalPolicies: number;
  /** 机构数量 */
  orgCount: number;
  /** 业务员数量 */
  salesmanCount: number;
  /** 平均保费（万元） */
  avgPremium: number;
}

/**
 * 保费报表数据状态
 */
export interface PremiumReportData {
  /** 机构保费报表数据 */
  orgReport: OrgPremiumReportRow[];
  /** 业务员保费报表数据 */
  salesmanReport: SalesmanPremiumReportRow[];
  /** 汇总数据 */
  summary: PremiumReportSummary;
  /** 是否加载中 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
}
