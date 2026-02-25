/**
 * 营销战报类型定义
 *
 * 包含机构战报和业务员明细表的数据类型
 */

/**
 * 机构战报行数据
 */
export interface OrganizationReportRow {
  /** 三级机构名称 */
  org_level_3: string;
  /** 车险保费（万元） */
  车险保费: number;
  /** 商业险保费（万元） */
  商业险保费: number;
  /** 车险开单率（节假日有出单业务员数 / 总业务员数） */
  车险开单率: number;
  /** 商业险开单率 */
  商业险开单率: number;
  /** 该机构总业务员数 */
  总业务员数: number;
  /** 车险假日出单业务员数 */
  车险出单人数: number;
  /** 商业险假日出单业务员数 */
  商业险出单人数: number;
  /** 索引签名 */
  [key: string]: string | number;
}

/**
 * 业务员明细行数据
 */
export interface SalesmanDetailRow {
  /** 业务员姓名 */
  salesman_name: string;
  /** 三级机构名称 */
  org_level_3: string;
  /** 团队名称 */
  team_name: string;
  /** 假日车险签单天数 */
  假日车险签单天数: number;
  /** 假日天数（筛选范围内） */
  假日天数: number;
  /** 假日车险签单比例 */
  假日车险签单比例: number;
  /** 假日商业险签单天数 */
  假日商业险签单天数: number;
  /** 假日商业险签单比例 */
  假日商业险签单比例: number;
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
 * 营销战报筛选条件
 */
export interface MarketingReportFilters {
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
  /** 附加筛选参数（buildFilterParams 产物） */
  additionalParams?: Record<string, string>;
}

/**
 * 营销战报数据状态
 */
export interface MarketingReportData {
  /** 机构战报数据 */
  orgReport: OrganizationReportRow[];
  /** 业务员明细数据 */
  salesmanDetail: SalesmanDetailRow[];
  /** 假日统计信息 */
  holidayStats: {
    /** 节假日总天数 */
    totalDays: number;
    /** 各节日统计 */
    holidays: Array<{
      name: string;
      days: number;
      dateRange: string;
    }>;
  };
  /** 是否加载中 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
}

/**
 * 表格列定义
 */
export interface TableColumn<T> {
  /** 列键名 */
  key: keyof T;
  /** 表头文本 */
  header: string;
  /** 列宽度 */
  width?: number;
  /** 格式化函数 */
  format?: (value: T[keyof T]) => string;
  /** 是否可排序 */
  sortable?: boolean;
  /** 文本对齐方式 */
  align?: 'left' | 'center' | 'right';
}
