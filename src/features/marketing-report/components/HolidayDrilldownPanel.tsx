/**
 * 假日营销下钻面板
 *
 * 两级下钻：
 *   分公司整体（各机构汇总） → 点击机构 → 该机构业务员明细
 *
 * 数据来源：
 *   机构级  GET /api/query/marketing-report?reportType=org
 *   业务员级 GET /api/query/marketing-report?reportType=salesman（已在上层加载）
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { apiClient, isRequestAbortError } from '../../../shared/api/client';
import { getHolidayDatesInRange } from '../utils/holidayUtils';
import { createLogger } from '../../../shared/utils/logger';
import { TABLE_CSS_CLASSES } from '../../../shared/config/chartStyles';
import {
  DrilldownBreadcrumb,
  DrilldownCell,
  DrilldownLoadingOverlay,
} from '../../../shared/ui';
import type { DrilldownBreadcrumbStep } from '../../../shared/ui';
import { DIMENSION_LABELS } from '../../../shared/config/drilldown-dimensions';
import { formatCount, formatRate, formatSalesmanName, formatTeamName } from '../../../shared/utils/formatters';
import { SalesmanDetailTable } from './SalesmanDetailTable';
import type { OrganizationReportRow, SalesmanDetailRow, SortState } from '../types/marketingReport';

const logger = createLogger('HolidayDrilldownPanel');

interface HolidayDrilldownPanelProps {
  filters: AdvancedFilterState;
  startDate: string;
  endDate: string;
}

export const HolidayDrilldownPanel: React.FC<HolidayDrilldownPanelProps> = ({
  filters,
  startDate,
  endDate,
}) => {
  const [orgData, setOrgData] = useState<OrganizationReportRow[]>([]);
  const [salesmanData, setSalesmanData] = useState<SalesmanDetailRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [salesmanSort, setSalesmanSort] = useState<SortState>({
    column: '假日车险签单天数',
    direction: 'desc',
  });

  const dateField: 'policy_date' | 'insurance_start_date' =
    filters.date_criteria === 'insurance_start_date'
      ? 'insurance_start_date'
      : 'policy_date';

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setSelectedOrg(null);

      const holidayDates = getHolidayDatesInRange(startDate, endDate);
      if (holidayDates.length === 0) {
        setOrgData([]);
        setSalesmanData([]);
        setIsLoading(false);
        return;
      }

      const baseParams: Record<string, any> = {
        holidayDates: holidayDates.join(','),
        dateField,
        startDate,
        endDate,
      };
      if (filters.org_level_3?.length) {
        baseParams.orgNames = filters.org_level_3.join(',');
      }

      try {
        const [orgResult, salesmanResult] = await Promise.all([
          apiClient.getMarketingReport({ ...baseParams, reportType: 'org' }),
          apiClient.getMarketingReport({ ...baseParams, reportType: 'salesman' }),
        ]);

        if (cancelled) return;

        setOrgData(
          (orgResult || []).map((r: Record<string, unknown>) => ({
            org_level_3: String(r.org_level_3 || ''),
            车险保费: Number(r['车险保费'] || 0),
            商业险保费: Number(r['商业险保费'] || 0),
            车险开单率: Number(r['车险开单率'] || 0),
            商业险开单率: Number(r['商业险开单率'] || 0),
            总业务员数: Number(r['总业务员数'] || 0),
            车险出单人数: Number(r['车险出单人数'] || 0),
            商业险出单人数: Number(r['商业险出单人数'] || 0),
          }))
        );

        setSalesmanData(
          (salesmanResult || []).map((r: Record<string, unknown>) => ({
            salesman_name: formatSalesmanName(String(r.salesman_name || '')),
            org_level_3: String(r.org_level_3 || ''),
            team_name: formatTeamName(String(r.team_name || '')),
            假日车险签单天数: Number(r['假日车险签单天数'] || 0),
            假日天数: Number(r['假日天数'] || 0),
            假日车险签单比例: Number(r['假日车险签单比例'] || 0),
            假日商业险签单天数: Number(r['假日商业险签单天数'] || 0),
            假日商业险签单比例: Number(r['假日商业险签单比例'] || 0),
          }))
        );
      } catch (err) {
        if (isRequestAbortError(err)) return;
        const msg = err instanceof Error ? err.message : '加载失败';
        if (!cancelled) {
          setError(msg);
          logger.error('Failed to load drilldown data', { error: msg });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [filters, startDate, endDate, dateField]);

  /** 业务员数据按选中机构筛选后排序 */
  const filteredSalesmanData = useMemo(() => {
    if (!selectedOrg) return [];
    const filtered = salesmanData.filter((r) => r.org_level_3 === selectedOrg);
    return [...filtered].sort((a, b) => {
      const av = a[salesmanSort.column as keyof SalesmanDetailRow] as number;
      const bv = b[salesmanSort.column as keyof SalesmanDetailRow] as number;
      if (typeof av === 'number' && typeof bv === 'number') {
        return salesmanSort.direction === 'asc' ? av - bv : bv - av;
      }
      const as = String(av ?? '');
      const bs = String(bv ?? '');
      return salesmanSort.direction === 'asc'
        ? as.localeCompare(bs, 'zh-CN')
        : bs.localeCompare(as, 'zh-CN');
    });
  }, [salesmanData, selectedOrg, salesmanSort]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        <p className="font-medium">加载失败</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 面包屑 */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <DrilldownBreadcrumb
          path={selectedOrg
            ? [{ label: selectedOrg, dimension: 'org_level_3', value: selectedOrg } as DrilldownBreadcrumbStep]
            : []
          }
          onNavigate={() => setSelectedOrg(null)}
          topLabel="分公司整体"
          dimensionLabels={DIMENSION_LABELS}
        />
      </div>

      <DrilldownLoadingOverlay loading={isLoading}>
        {/* 机构级汇总 */}
        {!selectedOrg && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">各机构假日营销表现</h3>
              <p className="text-sm text-gray-500 mt-1">
                点击机构名称下钻查看该机构业务员明细
              </p>
            </div>
            <div className="p-4">
              {orgData.length === 0 && !isLoading ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  {startDate && endDate ? '所选日期范围内暂无节假日数据' : '暂无数据'}
                </div>
              ) : (
                <div className={TABLE_CSS_CLASSES.container}>
                  <table className={TABLE_CSS_CLASSES.table}>
                    <thead className={TABLE_CSS_CLASSES.thead}>
                      <tr>
                        <th className={TABLE_CSS_CLASSES.headerCell}>机构名称</th>
                        <th className={TABLE_CSS_CLASSES.headerCellRight}>业务员数</th>
                        <th className={TABLE_CSS_CLASSES.headerCellRight}>车险出单人数</th>
                        <th className={TABLE_CSS_CLASSES.headerCellRight}>车险开单率</th>
                        <th className={TABLE_CSS_CLASSES.headerCellRight}>商业险出单人数</th>
                        <th className={TABLE_CSS_CLASSES.headerCellRight}>商业险开单率</th>
                      </tr>
                    </thead>
                    <tbody className={TABLE_CSS_CLASSES.tbody}>
                      {orgData.map((row, i) => (
                        <tr key={row.org_level_3 || String(i)} className={TABLE_CSS_CLASSES.row}>
                          <td className={TABLE_CSS_CLASSES.cell}>
                            <DrilldownCell
                              label={row.org_level_3}
                              availableDimensions={['salesman']}
                              dimensionLabels={{ ...DIMENSION_LABELS, salesman: '业务员' }}
                              onSelect={() => setSelectedOrg(row.org_level_3)}
                              autoOnSingle
                            />
                          </td>
                          <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                            {formatCount(row.总业务员数)}
                          </td>
                          <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                            {formatCount(row.车险出单人数)}
                          </td>
                          <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                            {formatRate(row.车险开单率)}
                          </td>
                          <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                            {formatCount(row.商业险出单人数)}
                          </td>
                          <td className={`${TABLE_CSS_CLASSES.cellRight} font-tabular`}>
                            {formatRate(row.商业险开单率)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 业务员明细（下钻后） */}
        {selectedOrg && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  {selectedOrg} — 业务员假日明细
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  共 {formatCount(filteredSalesmanData.length)} 名业务员
                </p>
              </div>
            </div>
            <div className="p-4">
              <SalesmanDetailTable
                data={filteredSalesmanData}
                sortState={salesmanSort}
                onSortChange={setSalesmanSort}
                loading={false}
              />
            </div>
          </div>
        )}
      </DrilldownLoadingOverlay>
    </div>
  );
};
