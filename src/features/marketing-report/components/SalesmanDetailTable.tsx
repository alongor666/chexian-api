/**
 * 业务员明细表格组件
 *
 * 表二：展示业务员的假日签单明细
 * - 业务员、三级机构、团队、假日车险签单天数、假日天数、假日车险签单比例、
 *   假日商业险签单天数、假日商业险签单比例
 */

import { SortableTable } from './SortableTable';
import type { SalesmanDetailRow, SortState } from '../types/marketingReport';

interface SalesmanDetailTableProps {
  /** 表格数据 */
  data: SalesmanDetailRow[];
  /** 排序状态 */
  sortState: SortState;
  /** 排序状态变更回调 */
  onSortChange: (sort: SortState) => void;
  /** 加载状态 */
  loading?: boolean;
}

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
  return num.toString();
};

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * 业务员明细表格组件
 */
export const SalesmanDetailTable: React.FC<SalesmanDetailTableProps> = ({
  data,
  sortState,
  onSortChange,
  loading = false,
}) => {
  const columns = [
    {
      key: 'salesman_name' as keyof SalesmanDetailRow,
      header: '业务员',
      width: 100,
      align: 'left' as const,
    },
    {
      key: 'org_level_3' as keyof SalesmanDetailRow,
      header: '三级机构',
      width: 100,
      align: 'left' as const,
    },
    {
      key: 'team_name' as keyof SalesmanDetailRow,
      header: '团队',
      width: 120,
      align: 'left' as const,
    },
    {
      key: '假日天数' as keyof SalesmanDetailRow,
      header: '假日天数',
      width: 90,
      format: formatInteger,
      align: 'center' as const,
    },
    {
      key: '假日车险签单天数' as keyof SalesmanDetailRow,
      header: '车险签单天数',
      width: 110,
      format: formatInteger,
      align: 'center' as const,
    },
    {
      key: '假日车险签单比例' as keyof SalesmanDetailRow,
      header: '车险签单比例',
      width: 110,
      format: formatPercent,
      align: 'center' as const,
    },
    {
      key: '假日商业险签单天数' as keyof SalesmanDetailRow,
      header: '商业险签单天数',
      width: 120,
      format: formatInteger,
      align: 'center' as const,
    },
    {
      key: '假日商业险签单比例' as keyof SalesmanDetailRow,
      header: '商业险签单比例',
      width: 120,
      format: formatPercent,
      align: 'center' as const,
    },
  ];

  return (
    <SortableTable<SalesmanDetailRow>
      data={data}
      columns={columns}
      sortState={sortState}
      onSortChange={onSortChange}
      rowKey={(row, index) => `${row.salesman_name}-${index}`}
      maxHeight={450}
      loading={loading}
      emptyText="暂无业务员数据"
    />
  );
};
