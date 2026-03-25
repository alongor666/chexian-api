/**
 * 假日营销下钻面板 (V2 — 自由维度)
 *
 * 支持任意维度组合下钻：机构/团队/业务员/新车/过户/新能源/电销
 * 数据来源：GET /api/query/holiday-drilldown
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { apiClient } from '../../../shared/api/client';
import { getHolidayDatesInRange } from '../utils/holidayUtils';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';
import {
  DrilldownBreadcrumb,
  DrilldownCell,
  DrilldownLoadingOverlay,
  DrilldownExhaustedBanner,
} from '../../../shared/ui';
import type { DrilldownBreadcrumbStep } from '../../../shared/ui';
import { DIMENSION_LABELS } from '../../../shared/config/drilldown-dimensions';
import { formatCount, formatRate, formatPremiumWan } from '../../../shared/utils/formatters';
import { queryKeys } from '../../../shared/api/query-keys';

type HolidayDimension =
  | 'org_level_3' | 'team' | 'salesman'
  | 'is_new_car' | 'is_transfer' | 'is_nev' | 'is_telemarketing';

const ALL_HOLIDAY_DIMENSIONS: HolidayDimension[] = [
  'org_level_3', 'team', 'salesman',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing',
];

interface DrillStep {
  dimension: HolidayDimension;
  value: string;
}

interface HolidayDrilldownPanelProps {
  filters: AdvancedFilterState;
  startDate: string;
  endDate: string;
}

interface HolidayRow {
  group_name: string;
  premium_wan: number;
  commercial_premium_wan: number;
  total_salesman: number;
  active_salesman: number;
  commercial_active_salesman: number;
  auto_active_rate: number;
  commercial_active_rate: number;
}

export const HolidayDrilldownPanel: React.FC<HolidayDrilldownPanelProps> = ({
  filters,
  startDate,
  endDate,
}) => {
  const dateField: string =
    filters.date_criteria === 'insurance_start_date'
      ? 'insurance_start_date'
      : 'policy_date';

  const [drillPath, setDrillPath] = useState<DrillStep[]>([]);
  const [currentGroupBy, setCurrentGroupBy] = useState<HolidayDimension>('org_level_3');

  // 计算假日日期
  const holidayDates = useMemo(
    () => getHolidayDatesInRange(startDate, endDate),
    [startDate, endDate],
  );

  // 可选维度
  const availableDimensions = useMemo(() => {
    const used = new Set<string>([...drillPath.map((s) => s.dimension), currentGroupBy]);
    return ALL_HOLIDAY_DIMENSIONS.filter((d) => !used.has(d));
  }, [drillPath, currentGroupBy]);

  // 面包屑
  const breadcrumb = useMemo(
    () => drillPath.map((step): DrilldownBreadcrumbStep => ({
      label: step.value,
      dimension: step.dimension,
      value: step.value,
    })),
    [drillPath],
  );

  // API 参数
  const apiParams = useMemo(() => ({
    groupBy: currentGroupBy,
    drillPath: JSON.stringify(drillPath),
    holidayDates: holidayDates.join(','),
    dateField,
    startDate,
    endDate,
    ...(filters.org_level_3?.length ? { orgNames: filters.org_level_3.join(',') } : {}),
  }), [currentGroupBy, drillPath, holidayDates, dateField, startDate, endDate, filters.org_level_3]);

  // 查询
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: queryKeys.holidayDrilldown(apiParams),
    queryFn: () => apiClient.getHolidayDrilldown(apiParams as Record<string, any>),
    enabled: holidayDates.length > 0,
    select: (result): HolidayRow[] =>
      (Array.isArray(result) ? result : []).map((r: Record<string, unknown>) => ({
        group_name: String(r.group_name ?? ''),
        premium_wan: Number(r.premium_wan ?? 0),
        commercial_premium_wan: Number(r.commercial_premium_wan ?? 0),
        total_salesman: Number(r.total_salesman ?? 0),
        active_salesman: Number(r.active_salesman ?? 0),
        commercial_active_salesman: Number(r.commercial_active_salesman ?? 0),
        auto_active_rate: Number(r.auto_active_rate ?? 0),
        commercial_active_rate: Number(r.commercial_active_rate ?? 0),
      })),
  });

  const drillDown = useCallback((value: string, nextDim: HolidayDimension) => {
    setDrillPath((prev) => [...prev, { dimension: currentGroupBy, value }]);
    setCurrentGroupBy(nextDim);
  }, [currentGroupBy]);

  const navigateTo = useCallback((index: number) => {
    if (index < 0) {
      setDrillPath([]);
      setCurrentGroupBy('org_level_3');
      return;
    }
    const newPath = drillPath.slice(0, index + 1);
    const nextGroupBy = index + 1 < drillPath.length
      ? drillPath[index + 1].dimension
      : currentGroupBy;
    setDrillPath(newPath);
    setCurrentGroupBy(nextGroupBy);
  }, [drillPath, currentGroupBy]);

  const reset = useCallback(() => {
    setDrillPath([]);
    setCurrentGroupBy('org_level_3');
  }, []);

  const canDrillDown = availableDimensions.length > 0;
  const currentDimLabel = DIMENSION_LABELS[currentGroupBy] || currentGroupBy;

  if (holidayDates.length === 0 && !isLoading) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        所选日期范围内暂无节假日数据
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 面包屑 */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <DrilldownBreadcrumb
          path={breadcrumb}
          onNavigate={navigateTo}
          topLabel="分公司整体"
          canGoToTop
          dimensionLabels={DIMENSION_LABELS}
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          {error instanceof Error ? error.message : '加载失败'}
        </div>
      )}

      {/* 穷尽提示 */}
      <DrilldownExhaustedBanner
        visible={!canDrillDown && rows.length > 0 && !isLoading}
        onReset={reset}
      />

      {/* 数据表格 */}
      <DrilldownLoadingOverlay loading={isLoading}>
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-800">
              假日营销表现 — 按{currentDimLabel}
            </h3>
          </div>
          <div className="p-4">
            {rows.length === 0 && !isLoading ? (
              <div className="text-center py-8 text-gray-500 text-sm">暂无数据</div>
            ) : (
              <div className={TABLE_CSS_CLASSES.container}>
                <table className={TABLE_CSS_CLASSES.table}>
                  <thead className={TABLE_CSS_CLASSES.thead}>
                    <tr>
                      <th className={TABLE_CSS_CLASSES.headerCell}>{currentDimLabel}</th>
                      <th className={TABLE_CSS_CLASSES.headerCellRight}>车险保费(万)</th>
                      <th className={TABLE_CSS_CLASSES.headerCellRight}>商业险保费(万)</th>
                      <th className={TABLE_CSS_CLASSES.headerCellRight}>业务员数</th>
                      <th className={TABLE_CSS_CLASSES.headerCellRight}>车险出单人数</th>
                      <th className={TABLE_CSS_CLASSES.headerCellRight}>车险开单率</th>
                      <th className={TABLE_CSS_CLASSES.headerCellRight}>商业险开单率</th>
                    </tr>
                  </thead>
                  <tbody className={TABLE_CSS_CLASSES.tbody}>
                    {rows.map((row, i) => (
                      <tr key={row.group_name || String(i)} className={TABLE_CSS_CLASSES.row}>
                        <td className={TABLE_CSS_CLASSES.cell}>
                          <DrilldownCell
                            label={row.group_name}
                            availableDimensions={availableDimensions}
                            dimensionLabels={DIMENSION_LABELS}
                            onSelect={(nextDim) => drillDown(row.group_name, nextDim as HolidayDimension)}
                          />
                        </td>
                        <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                          {formatPremiumWan(row.premium_wan * 10000)}
                        </td>
                        <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                          {formatPremiumWan(row.commercial_premium_wan * 10000)}
                        </td>
                        <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                          {formatCount(row.total_salesman)}
                        </td>
                        <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                          {formatCount(row.active_salesman)}
                        </td>
                        <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                          {formatRate(row.auto_active_rate)}
                        </td>
                        <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                          {formatRate(row.commercial_active_rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DrilldownLoadingOverlay>
    </div>
  );
};
