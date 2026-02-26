/**
 * TOP20 业务员推介率看板 (主全 / 交三)
 * Cross-Sell Top Salesman Board
 * 
 * 包含：AI智能分析面板 + 主全/交三表格/分布图 + 导出CSV功能
 */

import { memo, useState, useCallback } from 'react';
import type { AdvancedFilterState } from '@/shared/types/data';
import { useCrossSellTopSalesman } from './hooks/useCrossSellTopSalesman';
import type { VehicleCategory } from './hooks/useCrossSellTimePeriod';
import { formatCount, formatPercent, formatDriverPremiumWan } from '@/shared/utils/formatters';
import { cardStyles, textStyles, cn } from '@/shared/styles';
import { TopSalesmanQuadrantChart } from './TopSalesmanQuadrantChart';
import type { TrendGranularity } from './hooks/useCrossSellTrend';
import { getRateClassByField, getAvgPremiumClassByCoverage } from './crossSellRateStatus';
import { CrossSellAIAnalysisPanel } from './CrossSellAIAnalysisPanel';
import { prepareExportData, exportToCSV, downloadCSV, generateExportFilename } from './utils/crossSellExport';

interface TopSalesmanBoardProps {
    filters: AdvancedFilterState;
    vehicleCategory: VehicleCategory;
    timePeriod: TrendGranularity;
}

type SortField = 'org_level_3' | 'driver_premium' | 'auto_count' | 'avg_premium' | 'rate';
type SortOrder = 'asc' | 'desc';
type ViewMode = 'table' | 'chart';

const TIME_PERIOD_LABELS: Record<TrendGranularity, string> = {
    daily: '当日',
    weekly: '当周',
    monthly: '当月',
    quarterly: '当季',
    yearly: '当年',
};

export const CrossSellTopSalesmanBoard = memo(function CrossSellTopSalesmanBoard({
    filters,
    vehicleCategory,
    timePeriod,
}: TopSalesmanBoardProps) {
    // 主全数据
    const zhuquanResult = useCrossSellTopSalesman({
        filters,
        vehicleCategory,
        coverage: '主全',
        timePeriod,
    });
    
    // 交三数据
    const jiaosanResult = useCrossSellTopSalesman({
        filters,
        vehicleCategory,
        coverage: '交三',
        timePeriod,
    });

    const loading = zhuquanResult.loading || jiaosanResult.loading;
    const error = zhuquanResult.error || jiaosanResult.error;
    const hasData = zhuquanResult.data.length > 0 || jiaosanResult.data.length > 0;

    // 导出CSV
    const handleExport = useCallback(() => {
        if (!hasData) return;
        
        const exportData = prepareExportData(zhuquanResult.data, jiaosanResult.data);
        const csvContent = exportToCSV(exportData);
        const filename = generateExportFilename(TIME_PERIOD_LABELS[timePeriod]);
        downloadCSV(csvContent, filename);
    }, [zhuquanResult.data, jiaosanResult.data, timePeriod, hasData]);

    return (
        <div className="space-y-4">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between">
                <h3 className={cn(textStyles.h4, 'text-neutral-800')}>
                    TOP20 业务员分析
                </h3>
                <button
                    onClick={handleExport}
                    disabled={!hasData || loading}
                    className={cn(
                        'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                        hasData && !loading
                            ? 'bg-primary text-white hover:bg-primary/90'
                            : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                    )}
                >
                    导出CSV
                </button>
            </div>

            {/* 主内容区：左侧AI分析 + 右侧表格/图表 */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                {/* 左侧：AI智能分析面板 */}
                <div className="xl:col-span-1 h-auto xl:h-[460px]">
                    <CrossSellAIAnalysisPanel
                        zhuquanData={zhuquanResult.data}
                        jiaosanData={jiaosanResult.data}
                        timePeriodLabel={TIME_PERIOD_LABELS[timePeriod]}
                    />
                </div>

                {/* 右侧：主全和交三面板 */}
                <div className="xl:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <SalesmanPanel
                        title="主全"
                        coverage="主全"
                        data={zhuquanResult.data}
                        loading={zhuquanResult.loading}
                        error={zhuquanResult.error}
                    />
                    <SalesmanPanel
                        title="交三"
                        coverage="交三"
                        data={jiaosanResult.data}
                        loading={jiaosanResult.loading}
                        error={jiaosanResult.error}
                    />
                </div>
            </div>
        </div>
    );
});

// 单个面板组件
const SalesmanPanel = memo(function SalesmanPanel({
    title,
    coverage,
    data,
    loading,
    error,
}: {
    title: string;
    coverage: '主全' | '交三';
    data: ReturnType<typeof useCrossSellTopSalesman>['data'];
    loading: boolean;
    error: string | null;
}) {
    const [viewMode, setViewMode] = useState<ViewMode>('table');
    const [sortField, setSortField] = useState<SortField>('rate');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

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

        if (typeof aVal === 'string' && typeof bVal === 'string') {
            return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }

        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return (
        <div className={cn(cardStyles.standard, 'p-0 flex flex-col overflow-hidden border border-neutral-200 shadow-sm h-[400px]')}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 bg-neutral-50">
                <h4 className={cn(textStyles.body, 'font-semibold text-neutral-800')}>{title} TOP 20</h4>
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
                        分布图
                    </button>
                </div>
            </div>

            <div className="p-4 flex-1 overflow-hidden relative">
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
                                    >
                                        三级机构 {sortField === 'org_level_3' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('driver_premium')}
                                    >
                                        驾乘险保费-万 {sortField === 'driver_premium' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('auto_count')}
                                    >
                                        车险件数 {sortField === 'auto_count' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('rate')}
                                    >
                                        推介率 {sortField === 'rate' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </th>
                                    <th
                                        className="py-2.5 px-3 font-medium text-neutral-500 cursor-pointer hover:bg-neutral-50 text-right whitespace-nowrap"
                                        onClick={() => handleSort('avg_premium')}
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
