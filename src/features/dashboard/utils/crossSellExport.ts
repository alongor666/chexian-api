/**
 * 驾意险推介率数据导出工具
 * Cross-Sell Data Export Utilities
 */

import type { TopSalesmanRow } from '../hooks/useCrossSellTopSalesman';
import { classifySalesmanQuadrant, QUADRANT_CATEGORY_LABELS, type QuadrantCategory } from '../CrossSellAIAnalysisPanel';
import { escapeCSVField, downloadFile } from '../../../shared/utils/export';

export interface ExportDataRow extends TopSalesmanRow {
    coverage: '主全' | '交三';
    quadrantCategory: QuadrantCategory;
}

/**
 * 计算中位数
 */
function median(arr: number[]): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 准备导出数据
 */
export function prepareExportData(
    zhuquanData: TopSalesmanRow[],
    jiaosanData: TopSalesmanRow[]
): ExportDataRow[] {
    // 合并数据计算阈值
    const allData = [...zhuquanData, ...jiaosanData];
    
    const rateMedian = median(allData.map(d => d.rate));
    const avgPremiumMedian = median(allData.map(d => d.avg_premium));
    
    // 主全数据
    const zhuquanRows: ExportDataRow[] = zhuquanData.map(row => ({
        ...row,
        coverage: '主全' as const,
        quadrantCategory: classifySalesmanQuadrant(
            row.rate, 
            row.avg_premium, 
            rateMedian, 
            avgPremiumMedian
        ),
    }));
    
    // 交三数据
    const jiaosanRows: ExportDataRow[] = jiaosanData.map(row => ({
        ...row,
        coverage: '交三' as const,
        quadrantCategory: classifySalesmanQuadrant(
            row.rate, 
            row.avg_premium, 
            rateMedian, 
            avgPremiumMedian
        ),
    }));
    
    return [...zhuquanRows, ...jiaosanRows];
}

/**
 * 获取推介率状态
 */
function getRateStatus(rate: number, coverage: '主全' | '交三'): string {
    if (coverage === '主全') {
        if (rate >= 80) return '优秀';
        if (rate >= 75) return '健康';
        if (rate >= 70) return '异常';
        return '危险';
    } else {
        if (rate >= 70) return '优秀';
        if (rate >= 65) return '健康';
        if (rate >= 60) return '异常';
        return '危险';
    }
}

/**
 * 获取件均状态
 */
function getAvgPremiumStatus(avgPremium: number, coverage: '主全' | '交三'): string {
    if (coverage === '主全') {
        if (avgPremium >= 333) return '优秀';
        if (avgPremium >= 300) return '健康';
        if (avgPremium >= 260) return '异常';
        return '危险';
    } else {
        if (avgPremium >= 288) return '优秀';
        if (avgPremium >= 200) return '健康';
        if (avgPremium >= 150) return '异常';
        return '危险';
    }
}

/**
 * 导出为CSV字符串
 */
export function exportToCSV(data: ExportDataRow[]): string {
    const headers = [
        '险别组合',
        '业务员',
        '三级机构',
        '驾意保费(万)',
        '车险件数',
        '推介率(%)',
        '推介率状态',
        '驾意件均(元)',
        '件均状态',
        '四象限分类',
    ];
    
    const rows = data.map(row => [
        row.coverage,
        row.salesman_name,
        row.org_level_3,
        (row.driver_premium / 10000).toFixed(2),
        row.auto_count,
        row.rate.toFixed(2),
        getRateStatus(row.rate, row.coverage),
        row.avg_premium.toFixed(0),
        getAvgPremiumStatus(row.avg_premium, row.coverage),
        QUADRANT_CATEGORY_LABELS[row.quadrantCategory],
    ]);
    
    // 转义收拢至 shared/utils/export.ts 唯一实现；BOM 由 downloadFile 统一前置
    return [
        headers.map(escapeCSVField).join(','),
        ...rows.map(row => row.map(escapeCSVField).join(',')),
    ].join('\n');
}

/**
 * 下载CSV文件（委托 shared downloadFile，自动加 UTF-8 BOM）
 */
export function downloadCSV(csvContent: string, filename: string): void {
    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
}

/**
 * 生成文件名
 */
export function generateExportFilename(timePeriodLabel: string): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `${dateStr}_TOP20业务员_${timePeriodLabel}_推介率报表.csv`;
}
