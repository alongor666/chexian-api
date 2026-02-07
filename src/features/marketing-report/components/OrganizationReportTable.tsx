/**
 * 机构战报表格组件
 *
 * 表一：展示各机构的假日营销数据
 * - 三级机构、车险保费、商业险保费、车险开单率、商业险开单率
 */

import { SortableTable } from './SortableTable';
import type { OrganizationReportRow, SortState } from '../types/marketingReport';

interface OrganizationReportTableProps {
  /** 表格数据 */
  data: OrganizationReportRow[];
  /** 排序状态 */
  sortState: SortState;
  /** 排序状态变更回调 */
  onSortChange: (sort: SortState) => void;
  /** 加载状态 */
  loading?: boolean;
}

/**
 * 格式化金额（万元）
 */
const formatCurrency = (value: unknown): string => {
  const num = Number(value);
  if (isNaN(num)) return '-';
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/**
 * 格式化百分比
 */
const formatPercent = (value: unknown): string => {
  const num = Number(value);
  if (isNaN(num) || num === 0) return '-';
  return `${(num * 100).toFixed(1)}%`;
};

/**
 * 格式化整数
 */
const formatInteger = (value: unknown): string => {
  const num = Number(value);
  if (isNaN(num)) return '-';
  return num.toLocaleString('zh-CN');
};

/**
 * 机构战报表格组件
 */
export const OrganizationReportTable: React.FC<OrganizationReportTableProps> = ({
  data,
  sortState,
  onSortChange,
  loading = false,
}) => {
  const columns = [
    {
      key: 'org_level_3' as keyof OrganizationReportRow,
      header: '三级机构',
      width: 150,
      align: 'left' as const,
    },
    {
      key: '车险保费' as keyof OrganizationReportRow,
      header: '车险保费(万)',
      width: 120,
      format: formatCurrency,
      align: 'right' as const,
    },
    {
      key: '商业险保费' as keyof OrganizationReportRow,
      header: '商业险保费(万)',
      width: 130,
      format: formatCurrency,
      align: 'right' as const,
    },
    {
      key: '总业务员数' as keyof OrganizationReportRow,
      header: '业务员数',
      width: 100,
      format: formatInteger,
      align: 'right' as const,
    },
    {
      key: '车险出单人数' as keyof OrganizationReportRow,
      header: '车险出单人数',
      width: 120,
      format: formatInteger,
      align: 'right' as const,
    },
    {
      key: '车险开单率' as keyof OrganizationReportRow,
      header: '车险开单率',
      width: 110,
      format: formatPercent,
      align: 'right' as const,
    },
    {
      key: '商业险出单人数' as keyof OrganizationReportRow,
      header: '商业险出单人数',
      width: 130,
      format: formatInteger,
      align: 'right' as const,
    },
    {
      key: '商业险开单率' as keyof OrganizationReportRow,
      header: '商业险开单率',
      width: 120,
      format: formatPercent,
      align: 'right' as const,
    },
  ];

  return (
    <SortableTable<OrganizationReportRow>
      data={data}
      columns={columns}
      sortState={sortState}
      onSortChange={onSortChange}
      rowKey={(row) => row.org_level_3}
      maxHeight={350}
      loading={loading}
      emptyText="暂无机构数据"
    />
  );
};
