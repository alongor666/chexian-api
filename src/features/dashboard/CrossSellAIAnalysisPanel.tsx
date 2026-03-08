/**
 * AI智能分析面板（驾意险推介率）
 * Cross-Sell AI Analysis Panel
 *
 * 基于推介率和驾意件均两个维度，将业务员分为四象限
 */

import { memo, useMemo } from 'react';
import { cardStyles, textStyles, cn, colorClasses } from '@/shared/styles';
import { formatPercent, formatCount } from '@/shared/utils/formatters';
import type { TopSalesmanRow } from './hooks/useCrossSellTopSalesman';

export type QuadrantCategory = 
    | 'dual_excellent'      // 双优：推介率高 + 件均高
    | 'rate_excellent_avg_weak'  // 推介优件均差
    | 'rate_weak_avg_excellent'  // 推介差件均优
    | 'dual_weak';          // 双差

interface QuadrantGroup {
    category: QuadrantCategory;
    label: string;
    icon: string;
    description: string;
    names: string[];
    count: number;
    colorClass: string;
}

interface CrossSellAIAnalysisPanelProps {
    zhuquanData: TopSalesmanRow[];
    jiaosanData: TopSalesmanRow[];
    timePeriodLabel: string;
}

export const CrossSellAIAnalysisPanel = memo(function CrossSellAIAnalysisPanel({
    zhuquanData,
    jiaosanData,
    timePeriodLabel,
}: CrossSellAIAnalysisPanelProps) {
    // 合并主全和交三数据
    const allData = useMemo(() => {
        const zhuquanWithCoverage = zhuquanData.map(d => ({ ...d, coverage: '主全' as const }));
        const jiaosanWithCoverage = jiaosanData.map(d => ({ ...d, coverage: '交三' as const }));
        return [...zhuquanWithCoverage, ...jiaosanWithCoverage];
    }, [zhuquanData, jiaosanData]);

    // 计算中位数阈值
    const thresholds = useMemo(() => {
        if (allData.length === 0) return { rateMedian: 0, avgPremiumMedian: 0 };
        
        const rates = allData.map(d => d.rate).sort((a, b) => a - b);
        const avgPremiums = allData.map(d => d.avg_premium).sort((a, b) => a - b);
        
        const median = (arr: number[]) => {
            const mid = Math.floor(arr.length / 2);
            return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
        };
        
        return {
            rateMedian: median(rates),
            avgPremiumMedian: median(avgPremiums),
        };
    }, [allData]);

    // 按四象限分类
    const quadrantGroups = useMemo((): QuadrantGroup[] => {
        const { rateMedian, avgPremiumMedian } = thresholds;
        
        const groups: Record<QuadrantCategory, string[]> = {
            dual_excellent: [],
            rate_excellent_avg_weak: [],
            rate_weak_avg_excellent: [],
            dual_weak: [],
        };
        
        allData.forEach(item => {
            const rateGood = item.rate >= rateMedian;
            const avgGood = item.avg_premium >= avgPremiumMedian;
            
            if (rateGood && avgGood) {
                groups.dual_excellent.push(item.salesman_name);
            } else if (rateGood && !avgGood) {
                groups.rate_excellent_avg_weak.push(item.salesman_name);
            } else if (!rateGood && avgGood) {
                groups.rate_weak_avg_excellent.push(item.salesman_name);
            } else {
                groups.dual_weak.push(item.salesman_name);
            }
        });
        
        return [
            {
                category: 'dual_excellent',
                label: '双优伙伴',
                icon: '★',
                description: '推介率高、件均高，值得表彰',
                names: groups.dual_excellent,
                count: groups.dual_excellent.length,
                colorClass: colorClasses.text.success,
            },
            {
                category: 'rate_excellent_avg_weak',
                label: '推介优件均差',
                icon: '◆',
                description: '推介意识强，建议提升件均',
                names: groups.rate_excellent_avg_weak,
                count: groups.rate_excellent_avg_weak.length,
                colorClass: colorClasses.text.warning,
            },
            {
                category: 'rate_weak_avg_excellent',
                label: '推介差件均优',
                icon: '◆',
                description: '高端客户多，加强推介培训',
                names: groups.rate_weak_avg_excellent,
                count: groups.rate_weak_avg_excellent.length,
                colorClass: colorClasses.text.warning,
            },
            {
                category: 'dual_weak',
                label: '双差伙伴',
                icon: '○',
                description: '需重点关注与辅导',
                names: groups.dual_weak,
                count: groups.dual_weak.length,
                colorClass: colorClasses.text.danger,
            },
        ];
    }, [allData, thresholds]);

    return (
        <div className={cn(cardStyles.standard, 'p-4 flex flex-col h-full')}>
            <h4 className={cn(textStyles.body, 'font-semibold text-neutral-800 mb-4')}>
                🤖 AI智能分析
            </h4>
            
            <div className="flex-1 overflow-auto space-y-3">
                {quadrantGroups.map(group => (
                    <div key={group.category} className="border-b border-neutral-100 pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className={cn('text-lg', group.colorClass)}>{group.icon}</span>
                            <span className={cn('font-medium', group.colorClass)}>
                                {group.label}
                            </span>
                            <span className="text-xs text-neutral-400">
                                ({group.count}人)
                            </span>
                        </div>
                        
                        {group.names.length > 0 ? (
                            <p className={cn(textStyles.caption, 'text-neutral-600 leading-relaxed')}>
                                {group.names.slice(0, 5).join('、')}
                                {group.names.length > 5 && ` 等${group.names.length}人`}
                            </p>
                        ) : (
                            <p className={cn(textStyles.caption, 'text-neutral-400 italic')}>
                                暂无
                            </p>
                        )}
                        
                        <p className={cn(textStyles.caption, 'text-neutral-400 mt-1')}>
                            → {group.description}
                        </p>
                    </div>
                ))}
            </div>
            
            {/* 分析依据 */}
            <div className="mt-4 pt-3 border-t border-neutral-200">
                <p className={cn(textStyles.caption, 'font-medium text-neutral-700 mb-2')}>
                    📈 分析依据
                </p>
                <div className={cn(textStyles.caption, 'text-neutral-500 space-y-1')}>
                    <p>• 推介率阈值：{formatPercent(thresholds.rateMedian)}</p>
                    <p>• 件均阈值：{formatCount(thresholds.avgPremiumMedian)}元</p>
                    <p>• 统计时间：{timePeriodLabel}</p>
                </div>
            </div>
        </div>
    );
});

// 导出分类函数供其他组件使用
export function classifySalesmanQuadrant(
    rate: number, 
    avgPremium: number, 
    rateMedian: number, 
    avgPremiumMedian: number
): QuadrantCategory {
    const rateGood = rate >= rateMedian;
    const avgGood = avgPremium >= avgPremiumMedian;
    
    if (rateGood && avgGood) return 'dual_excellent';
    if (rateGood && !avgGood) return 'rate_excellent_avg_weak';
    if (!rateGood && avgGood) return 'rate_weak_avg_excellent';
    return 'dual_weak';
}

export const QUADRANT_CATEGORY_LABELS: Record<QuadrantCategory, string> = {
    dual_excellent: '双优',
    rate_excellent_avg_weak: '推介优件均差',
    rate_weak_avg_excellent: '推介差件均优',
    dual_weak: '双差',
};
