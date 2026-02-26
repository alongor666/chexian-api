/**
 * TOP20 业务员推介率看板 (主全 / 交三)
 * Cross-Sell Top Salesman Board
 */

import { memo, useState } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { useCrossSellTopSalesman } from './hooks/useCrossSellTopSalesman';
import type { VehicleCategory } from './hooks/useCrossSellTimePeriod';
import { formatCount, formatPercent, formatDriverPremiumWan } from '@/shared/utils/formatters';
import { cardStyles, textStyles, cn } from '@/shared/styles';
import { TopSalesmanQuadrantChart } from './TopSalesmanQuadrantChart';
import type { TrendGranularity } from './hooks/useCrossSellTrend';
import { getRateClassByField, getAvgPremiumClassByCoverage } from './crossSellRateStatus';

interface TopSalesmanBoardProps {
    filters: AdvancedFilterState;
    vehicleCategory: VehicleCategory;
    timePeriod: TrendGranularity;
}

type SortField = 'org_level_3' | 'driver_premium' | 'auto_count' | 'avg_premium' | 'rate';
type SortOrder = 'asc' | 'desc';
type ViewMode = 'table' | 'chart';

export const CrossSellTopSalesmanBoard = memo(function CrossSellTopSalesmanBoard({
    filters,
    vehicleCategory,
    timePeriod,
}: TopSalesmanBoardProps) {
    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <SalesmanPanel
                title="主全"
                coverage="主全"
                filters={filters}
                vehicleCategory={vehicleCategory}
                timePeriod={timePeriod}
            />
            <SalesmanPanel
                title="交三"
                coverage="交三"
                filters={filters}
                vehicleCategory={vehicleCategory}
                timePeriod={timePeriod}
            />
        </div>
    );
});

// 单个面板组件
const SalesmanPanel = memo(function SalesmanPanel({
    title,
    coverage,
    filters,
    vehicleCategory,
    timePeriod,
}: {
    title: string;
    coverage: '主全' | '交三';
    filters: AdvancedFilterState;
    vehicleCategory: VehicleCategory;
    timePeriod: TrendGranularity;
}) {
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [sortField, setSortField] = useState<SortField>('rate');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

    const { data, loading, error } = useCrossSellTopSalesman({
        filters,
        vehicleCategory,
        coverage,
        timePeriod,
    });

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder(field === 'rate' ? 'asc' : 'desc');
        }
    };

    const sortedData = [...data].sort((a, b) => {
        let aVal: any = a[sortField];
        let bVal: any = b[sortField];

        // 如果是字符串，使用 localeCompare
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }

        // 数值比较
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return (
        <div className={cn(cardStyles.standard, 'p-0 flex flex-col overflow-hidden border border-neutral-200 shadow-sm')}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 bg-neutral-50">
                <h4 className={cn(textStyles.body, 'font-semibold text-neutral-800')}>{title} TOP 20 业务员</h4>
                <div className="flex bg-white rounded-lg border border-neutral-200 p-0.5 shadow-sm">
                    <button
                        onClick={() => setViewMode('table')}
                        className={cn(
                            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                            viewMode === 'table' ? 'bg-primary text-white shadow' : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        列表
                    </button>
                    <button
                        onClick={() => setViewMode('chart')}
                        className={cn(
                            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                            viewMode === 'chart' ? 'bg-primary text-white shadow' : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        四象限
                    </button>
                </div>
            </div>

            <div className="p-4 flex-1 h-[400px] overflow-hidden relative">
                {loading && (
                    <div className="absolute inset-0 z-10 bg-white/60 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                    </div>
                )}

                {error && (
                    <div className="h-full flex items-center justify-center text-danger text-sm">
                        加载失败: {error}
                    </div>
                )}

                {!loading && !error && data.length === 0 && (
                    <div className="h-full flex items-center justify-center text-neutral-400">
                        暂无业务员数据
                    </div>
                )}

                {!error && data.length > 0 && viewMode === 'table' && (
                    <div className="h-full overflow-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="sticky top-0 bg-white z-10 border-b border-neutral-200 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1)]">
                                <tr>
                                    <th className="py-2.5 px-3 font-medium text-neutral-500 whitespace-nowrap">业务员</th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 whitespace-nowrap"
                                        onClick={() => handleSort('org_level_3')}
                                        title="点击按三级机构排序"
                                    >
                                        三级机构 {sortField === 'org_level_3' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('driver_premium')}
                                        title="点击按驾乘首年保费排序"
                                    >
                                        驾乘险保费-万 {sortField === 'driver_premium' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('auto_count')}
                                        title="点击按车险件数排序"
                                    >
                                        车险件数 {sortField === 'auto_count' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('rate')}
                                        title="点击按推介率排序"
                                    >
                                        推介率 {sortField === 'rate' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('avg_premium')}
                                        title="点击按件均保费排序"
                                    >
                                        件均保费-元 {sortField === 'avg_premium' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                                {sortedData.map((row, idx) => (
                                    <tr key={`${row.salesman_name}-${idx}`} className="hover:bg-neutral-50/50 transition-colors">
                                        <td className="py-2 px-3 text-neutral-900 font-medium whitespace-nowrap">{row.salesman_name}</td>
                                        <td className="py-2 px-3 text-neutral-600 whitespace-nowrap">{row.org_level_3}</td>
                                        <td className="py-2 px-3 text-right text-neutral-900 whitespace-nowrap">{formatDriverPremiumWan(row.driver_premium)}</td>
                                        <td className="py-2 px-3 text-right text-neutral-900 whitespace-nowrap">{formatCount(row.auto_count)}</td>
                                        <td className={cn("py-2 px-3 text-right font-medium whitespace-nowrap", getRateClassByField(coverage === '主全' ? 'zhuquan_rate' : 'jiaosan_rate', row.rate))}>{formatPercent(row.rate)}</td>
                                        <td className={cn("py-2 px-3 text-right font-medium whitespace-nowrap", getAvgPremiumClassByCoverage(coverage, row.avg_premium))}>{formatCount(row.avg_premium)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {!error && data.length > 0 && viewMode === 'chart' && (
                    <div className="h-full w-full">
                        <TopSalesmanQuadrantChart data={data} coverage={coverage} />
                    </div>
                )}
            </div>
        </div>
    );
});
