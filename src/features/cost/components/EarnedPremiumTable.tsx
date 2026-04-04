/**
 * 已赚保费分析表格
 * Earned Premium Analysis Table
 *
 * 展示已赚保费计算结果：
 * - 计算指引：滚动12个月财务口径详解（可折叠，含时间线图示、6种保单情形、公式说明）
 * - 可视化图表：已赚保费分布图表
 * - 汇总表：按机构分组（四川-同城-异地-合计），支持排序，无滚动条
 * - 明细表：按月份+机构筛选，展示已赚保费明细
 */

import { memo, useMemo, useState, useCallback } from 'react';
import { VirtualTable, Column } from '../../../widgets/table/VirtualTable';
import { EarnedPremiumCharts } from './EarnedPremiumCharts';
import { EarnedPremiumGuide } from './EarnedPremiumGuide';
import type { EarnedPremiumData, EarnedPremiumSummaryData } from '../types/costTypes';
import type {
  EarnedPremiumDetailFilter,
  EarnedPremiumSortState,
  SortField,
} from '../types/costTypes';
import {
  formatAverage,
  formatCount,
  formatCurrency,
  formatPercent,
  formatPremiumWan,
} from '../../../shared/utils/formatters';
import { colorClasses, cn } from '../../../shared/styles';

interface EarnedPremiumTableProps {
  data: EarnedPremiumData[];
  summaryData: EarnedPremiumSummaryData[];
  loading?: boolean;
  cutoffDate: string;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
  onDetailFilterChange?: (filter: EarnedPremiumDetailFilter) => void;
}

/**
 * 明细表显示格式
 */
interface DisplayEarnedPremiumData {
  org_level_3: string;
  insurance_type: string;
  policy_month: string;
  policy_count: string;
  total_premium: string;
  total_fee: string;
  fee_rate: string;
  line_factor: string;
  avg_elapsed_days: string;
  first_day_part: string;
  time_part: string;
  earned_premium_cum: string;
}

/**
 * 汇总表显示格式（带原始数据用于排序）
 */
interface DisplaySummaryData {
  org_level_3: string;
  policy_count: string;
  total_premium: string;
  total_fee: string;
  avg_fee_rate: string;
  total_first_day_part: string;
  total_time_part: string;
  total_earned_premium: string;
  earned_ratio: string;
  // 原始数值用于排序
  _original_total_earned_premium: number;
  _original_earned_ratio: number;
}

/**
 * 转换明细数据为显示格式
 * 遵循全局格式化规范（见 CLAUDE.md §2.5）：
 * - 件数：整数，千分位 → formatCount
 * - 保费：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
function transformDetailData(data: EarnedPremiumData[]): DisplayEarnedPremiumData[] {
  return data.map((row) => ({
    org_level_3: row.org_level_3 || '未知',
    insurance_type: row.insurance_type || '未知',
    policy_month: row.policy_month || '未知',
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    total_fee: formatPremiumWan(row.total_fee),
    fee_rate: formatPercent(row.fee_rate),
    line_factor: row.line_factor === null || row.line_factor === undefined ? '-' : formatCurrency(row.line_factor),
    avg_elapsed_days: row.avg_elapsed_days === null || row.avg_elapsed_days === undefined ? '-' : formatAverage(row.avg_elapsed_days),
    first_day_part: formatPremiumWan(row.first_day_part),
    time_part: formatPremiumWan(row.time_part),
    earned_premium_cum: formatPremiumWan(row.earned_premium_cum),
  }));
}

/**
 * 转换汇总数据为显示格式（保留原始数据用于排序）
 * 遵循全局格式化规范
 */
function transformSummaryData(data: EarnedPremiumSummaryData[]): DisplaySummaryData[] {
  return data.map((row) => ({
    org_level_3: row.org_level_3,
    policy_count: formatCount(row.policy_count),
    total_premium: formatPremiumWan(row.total_premium),
    total_fee: formatPremiumWan(row.total_fee),
    avg_fee_rate: formatPercent(row.avg_fee_rate),
    total_first_day_part: formatPremiumWan(row.total_first_day_part),
    total_time_part: formatPremiumWan(row.total_time_part),
    total_earned_premium: formatPremiumWan(row.total_earned_premium),
    earned_ratio: formatPercent(row.earned_ratio),
    _original_total_earned_premium: row.total_earned_premium,
    _original_earned_ratio: row.earned_ratio,
  }));
}

/**
 * 排序汇总数据
 */
function sortSummaryData(
  data: DisplaySummaryData[],
  sortField: SortField,
  sortDirection: 'asc' | 'desc'
): DisplaySummaryData[] {
  // 分离固定行和可排序行
  const fixedRows = data.filter((row) =>
    ['四川', '同城', '异地', '合计'].includes(row.org_level_3)
  );
  const sortableRows = data.filter((row) =>
    !['四川', '同城', '异地', '合计'].includes(row.org_level_3)
  );

  // 排序可排序行
  const sorted = [...sortableRows].sort((a, b) => {
    const aValue = sortField === 'total_earned_premium'
      ? a._original_total_earned_premium
      : a._original_earned_ratio;
    const bValue = sortField === 'total_earned_premium'
      ? b._original_total_earned_premium
      : b._original_earned_ratio;

    const comparison = aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // 固定行保持顺序（四川、同城、异地、合计）+ 排序后的其他机构
  return [
    fixedRows.find((row) => row.org_level_3 === '四川'),
    fixedRows.find((row) => row.org_level_3 === '同城'),
    fixedRows.find((row) => row.org_level_3 === '异地'),
    fixedRows.find((row) => row.org_level_3 === '合计'),
    ...sorted,
  ].filter(Boolean) as DisplaySummaryData[];
}

/**
 * 公式展示组件
 */
/**
 * 已赚保费分析表格组件
 */
export const EarnedPremiumTable = memo<EarnedPremiumTableProps>(function EarnedPremiumTable({
  data,
  summaryData,
  loading = false,
  cutoffDate,
  onExportCSV,
  onExportExcel,
  onDetailFilterChange,
}) {
  // 明细表筛选状态（默认显示全部月份，覆盖滚动12个月完整窗口）
  const [detailFilter, setDetailFilter] = useState<EarnedPremiumDetailFilter>({
    policyMonth: 'all',
    orgLevel3: 'all',
  });

  // 排序状态（固定为按已赚保费降序）
  const sortState: EarnedPremiumSortState = {
    sortField: 'total_earned_premium',
    sortDirection: 'desc',
  };

  // 汇总表列配置（表头显示单位，数字列右对齐）
  const summaryColumns: Column<DisplaySummaryData>[] = useMemo(
    () => [
      { key: 'org_level_3', header: '三级机构', width: 100 },
      { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
      { key: 'total_premium', header: '保费合计(万)', width: 130, align: 'right' },
      { key: 'total_fee', header: '费用金额(万)', width: 120, align: 'right' },
      { key: 'avg_fee_rate', header: '平均费用率', width: 100, align: 'right' },
      { key: 'total_first_day_part', header: '首日费用部分(万)', width: 130, align: 'right' },
      { key: 'total_time_part', header: '时间分摊部分(万)', width: 130, align: 'right' },
      { key: 'total_earned_premium', header: '累计已赚保费(万)', width: 140, align: 'right' },
      { key: 'earned_ratio', header: '已赚保费率', width: 100, align: 'right' },
    ],
    []
  );

  // 明细表列配置（表头显示单位，数字列右对齐）
  const detailColumns: Column<DisplayEarnedPremiumData>[] = useMemo(
    () => [
      { key: 'org_level_3', header: '三级机构', width: 100 },
      { key: 'insurance_type', header: '险类', width: 80 },
      { key: 'policy_month', header: '起保年月', width: 100 },
      { key: 'policy_count', header: '保单件数', width: 90, align: 'right' },
      { key: 'total_premium', header: '保费合计(万)', width: 120, align: 'right' },
      { key: 'total_fee', header: '费用金额(万)', width: 100, align: 'right' },
      { key: 'fee_rate', header: '费用率', width: 80, align: 'right' },
      { key: 'line_factor', header: '险类系数', width: 80, align: 'right' },
      { key: 'avg_elapsed_days', header: '平均有效天数', width: 100, align: 'right' },
      { key: 'first_day_part', header: '首日费用部分(万)', width: 120, align: 'right' },
      { key: 'time_part', header: '时间分摊部分(万)', width: 120, align: 'right' },
      { key: 'earned_premium_cum', header: '累计已赚保费(万)', width: 130, align: 'right' },
    ],
    []
  );

  // 转换并排序数据
  const displaySummaryData = useMemo(() => {
    const transformed = transformSummaryData(summaryData);
    return sortSummaryData(transformed, sortState.sortField, sortState.sortDirection);
  }, [summaryData, sortState]);

  const displayDetailData = useMemo(() => transformDetailData(data), [data]);

  // 明细表筛选处理
  const handleFilterChange = useCallback(
    (field: keyof EarnedPremiumDetailFilter, value: string) => {
      const newFilter = { ...detailFilter, [field]: value };
      setDetailFilter(newFilter);
      onDetailFilterChange?.(newFilter);
    },
    [detailFilter, onDetailFilterChange]
  );

  // 获取可选机构列表（从汇总数据中提取）
  const orgOptions = useMemo(() => {
    const orgs = Array.from(new Set(summaryData.map((d) => d.org_level_3)));
    return ['all', ...orgs.sort()];
  }, [summaryData]);

  const policyMonthOptions = useMemo(() => {
    const months = Array.from(
      new Set(
        data
          .map((d) => d.policy_month)
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      )
    ).sort();

    const toLabel = (month: string): string => {
      if (month === '未知') return '未知';
      const [y, m] = month.split('-');
      const monthNum = Number(m);
      if (!y || !Number.isFinite(monthNum)) return month;
      return `${y}年${monthNum}月`;
    };

    return [
      { value: 'all', label: '全部月份' },
      ...months.map((m) => ({ value: m, label: toLabel(m) })),
    ];
  }, [data]);

  // 空状态
  if (!loading && data.length === 0 && summaryData.length === 0) {
    return (
      <div className={cn('bg-white dark:bg-neutral-800 rounded-lg shadow-sm p-8 text-center', colorClasses.text.neutralLight)}>
        暂无数据
      </div>
    );
  }

  // 计算汇总表高度（显示全部行，无滚动条）
  const summaryTableHeight = Math.max(180, displaySummaryData.length * 40 + 60);

  return (
    <div className="space-y-4">
      {/* 计算指引（可折叠） */}
      <EarnedPremiumGuide cutoffDate={cutoffDate} />

      {/* 可视化图表区域 */}
      <EarnedPremiumCharts
        detailData={data}
        summaryData={summaryData}
        loading={loading}
        cutoffDate={cutoffDate}
      />

      {/* 汇总表 */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-sm">
        <div className={cn('px-4 py-3 border-b flex justify-between items-center', colorClasses.border.neutral)}>
          <h3 className={cn('text-base font-medium', colorClasses.text.neutralBlack)}>
            已赚保费汇总（按机构）
          </h3>
          <div className="flex items-center gap-3">
            <span className={cn('text-sm', colorClasses.text.neutralLight)}>共 {summaryData.length} 条记录</span>
            {(onExportCSV || onExportExcel) && (
              <div className="flex gap-2">
                {onExportCSV && (
                  <button
                    onClick={onExportCSV}
                    className="px-3 py-1 text-sm bg-success-solid text-white rounded hover:bg-success-dark transition-colors"
                    disabled={data.length === 0 && summaryData.length === 0}
                  >
                    导出CSV
                  </button>
                )}
                {onExportExcel && (
                  <button
                    onClick={onExportExcel}
                    className="px-3 py-1 text-sm bg-primary-solid text-white rounded hover:bg-primary-dark transition-colors"
                    disabled={data.length === 0 && summaryData.length === 0}
                  >
                    导出Excel
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <VirtualTable<DisplaySummaryData>
          columns={summaryColumns}
          data={displaySummaryData}
          loading={loading}
          height={summaryTableHeight}
          rowHeight={40}
        />
      </div>

      {/* 明细表 */}
      <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-sm">
        <div className={cn('px-4 py-3 border-b', colorClasses.border.neutral)}>
          <div className="flex justify-between items-center mb-3">
            <h3 className={cn('text-base font-medium', colorClasses.text.neutralBlack)}>
              已赚保费明细（按机构×险类×起保年月）
            </h3>
            <span className={cn('text-sm', colorClasses.text.neutralLight)}>共 {data.length} 条记录</span>
          </div>

          {/* 筛选器 */}
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <label className={cn('font-medium', colorClasses.text.neutral)}>起保年月：</label>
              <select
                value={detailFilter.policyMonth}
                onChange={(e) => handleFilterChange('policyMonth', e.target.value)}
                className={cn('px-3 py-1 rounded border focus:ring-2 focus:ring-primary-500 focus:border-primary-500', colorClasses.border.neutral)}
              >
                {policyMonthOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className={cn('font-medium', colorClasses.text.neutral)}>三级机构：</label>
              <select
                value={detailFilter.orgLevel3}
                onChange={(e) => handleFilterChange('orgLevel3', e.target.value)}
                className={cn('px-3 py-1 rounded border focus:ring-2 focus:ring-primary-500 focus:border-primary-500', colorClasses.border.neutral)}
              >
                <option value="all">全部机构合计</option>
                {orgOptions
                  .filter((org) => org !== 'all')
                  .map((org) => (
                    <option key={org} value={org}>
                      {org}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>
        <VirtualTable<DisplayEarnedPremiumData>
          columns={detailColumns}
          data={displayDetailData}
          loading={loading}
          height={400}
          rowHeight={40}
        />
      </div>
    </div>
  );
});

export default EarnedPremiumTable;
