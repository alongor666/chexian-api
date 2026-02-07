/**
 * 营销战报模块导出
 *
 * 提供假日营销分析功能：
 * - 机构战报（表一）
 * - 业务员明细（表二）
 */

// 组件导出
export { MarketingReportPanel } from './components/MarketingReportPanel';
export { OrganizationReportTable } from './components/OrganizationReportTable';
export { SalesmanDetailTable } from './components/SalesmanDetailTable';
export { HolidaySummaryCard } from './components/HolidaySummaryCard';
export { HolidayDrilldownPanel } from './components/HolidayDrilldownPanel';
export { SortableTable } from './components/SortableTable';

// Hook 导出
export { useMarketingReport } from './hooks/useMarketingReport';

// 类型导出
export type {
  OrganizationReportRow,
  SalesmanDetailRow,
  SortState,
  MarketingReportFilters,
  MarketingReportData,
  TableColumn,
} from './types/marketingReport';

// 工具函数导出
export {
  isHoliday,
  getHolidayName,
  getHolidaysInRange,
  countHolidaysInRange,
  getHolidayDatesInRange,
  getHolidaysGroupedByName,
  generateHolidayValuesSql,
  getHolidaySummary,
  HOLIDAYS_2026,
  HOLIDAY_SET,
  HOLIDAYS_BY_NAME,
} from './utils/holidayUtils';

// SQL 生成器导出
export { generateOrgReportQuery } from './sql/orgReport';
export { generateSalesmanDetailQuery } from './sql/salesmanDetail';
export {
  generateHolidayDrilldownQuery,
  generateKPICardQuery,
  generateCustomerCategoryQuery,
  generateCoverageCombinationQuery,
} from './sql/holidayDrilldown';
export type {
  DrilldownLevel,
  DrilldownDimension,
  RankingConfig,
  SortField,
  SortOrder,
} from './sql/holidayDrilldown';
