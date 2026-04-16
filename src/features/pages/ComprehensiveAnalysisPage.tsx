import React, { useMemo, useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { PageFilterPanel, FilterQuickActions } from '@/components/layout/PageFilterPanel';
import { Tabs, Button } from '@/shared/ui';
import { cardStyles, cn, colorClasses, textStyles, buttonStyles } from '@/shared/styles';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';
import { useTheme } from '@/shared/theme';
import { QuickFilterBar } from '@/shared/components/QuickFilterBar';
import { deriveQuickFilters, applyQuickFiltersToGlobal, buildFilterLabel } from '@/shared/utils/quickFilterHelpers';
import { formatPercent, formatPremiumWan } from '@/shared/utils/formatters';
import { useComprehensiveBundle } from '@/features/comprehensive-analysis/hooks/useComprehensiveBundle';
import type {
  ComprehensiveDimensionKey,
  ComprehensiveMetricRow,
  ComprehensiveRoiRow,
  ComprehensiveTabKey,
} from '@/features/comprehensive-analysis/types';
import { ComprehensiveChartCard } from '@/features/comprehensive-analysis/charts/ComprehensiveChartCard';
import { ComprehensiveMetricTable, type ComprehensiveColumn } from '@/features/comprehensive-analysis/components/ComprehensiveMetricTable';
import {
  buildCostOption,
  buildExpenseOption,
  buildExpenseSurplusOption,
  buildLossQuadrantOption,
  buildLossTrendOption,
  buildOverviewOption,
  buildPremiumOption,
  buildRoiOption,
} from '@/features/comprehensive-analysis/charts/options';

type LossViewMode = 'quadrant' | 'trend';

const tabItems = [
  { key: 'overview', label: '总览' },
  { key: 'premium', label: '保费进度' },
  { key: 'cost', label: '成本分析' },
  { key: 'loss', label: '赔案分析' },
  { key: 'expense', label: '费用分析' },
  { key: 'roi', label: 'ROI效率' },
];

const dimensionItems: Array<{ key: ComprehensiveDimensionKey; label: string }> = [
  { key: 'org', label: '机构' },
  { key: 'category', label: '客户类别' },
  { key: 'business', label: '业务类型' },
];

function filterRowsByDimension(
  rows: ComprehensiveMetricRow[],
  dimension: ComprehensiveDimensionKey
): ComprehensiveMetricRow[] {
  return rows.filter((row) => row.dimType === dimension);
}

interface ComprehensiveAnalysisPageProps {
  onBack?: () => void;
}

export const ComprehensiveAnalysisPage: React.FC<ComprehensiveAnalysisPageProps> = ({ onBack }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { filters, setFilters, maxDataDate } = useGlobalFilters();

  const quickFilters = useMemo(() => deriveQuickFilters(filters), [filters.vehicle_quick_filter, filters.enterprise_car, filters.is_nev, filters.fuel_category, filters.is_new_car, filters.is_renewal, filters.business_nature, filters.is_transfer, filters.coverage_combination, filters.insurance_type]);
  const handleQuickFilterChange = useCallback((newQuick: Parameters<typeof applyQuickFiltersToGlobal>[1]) => {
    setFilters(prev => applyQuickFiltersToGlobal(prev, newQuick));
  }, [setFilters]);
  const dynamicTitle = useMemo(() => {
    const label = buildFilterLabel(quickFilters);
    return label ? `${label} — 综合分析` : '综合分析';
  }, [quickFilters]);
  const { data, loading, error } = useComprehensiveBundle(filters, maxDataDate);

  const [activeTab, setActiveTab] = useState<ComprehensiveTabKey>('overview');
  const [lossView, setLossView] = useState<LossViewMode>('quadrant');
  const [dimensions, setDimensions] = useState<Record<ComprehensiveTabKey, ComprehensiveDimensionKey>>({
    overview: 'org',
    premium: 'category',
    cost: 'org',
    loss: 'org',
    expense: 'org',
    roi: 'org',
  });

  const currentDimension = dimensions[activeTab];

  const selectedMetricRows = useMemo(() => {
    if (!data) return [];
    switch (activeTab) {
      case 'overview':
        return filterRowsByDimension(data.overview.rows, currentDimension);
      case 'premium':
        return filterRowsByDimension(data.premium.rows, currentDimension);
      case 'cost':
        return filterRowsByDimension(data.cost.rows, currentDimension);
      case 'loss':
        return filterRowsByDimension(data.loss.quadrantRows, currentDimension);
      case 'expense':
        return filterRowsByDimension(data.expense.rows, currentDimension);
      case 'roi':
      default:
        return filterRowsByDimension(data.cost.rows, currentDimension);
    }
  }, [activeTab, currentDimension, data]);

  const roiRows = useMemo(() => {
    if (!data) return [];
    return data.roi.rows.filter((row) => row.dimType === currentDimension);
  }, [currentDimension, data]);

  const overviewColumns: Array<ComprehensiveColumn<ComprehensiveMetricRow>> = [
    { key: 'dimKey', title: '维度' },
    {
      key: 'signedPremium',
      title: '签单保费(万)',
      align: 'right',
      render: (value) => formatPremiumWan(value as number),
    },
    {
      key: 'variableCostRatio',
      title: '变动成本率',
      align: 'right',
      render: (value) => formatPercent(value as number | null),
    },
    {
      key: 'achievementRate',
      title: '年计划达成率',
      align: 'right',
      render: (value) => formatPercent(value as number | null),
    },
    {
      key: 'premiumShare',
      title: '保费贡献度',
      align: 'right',
      render: (value) => formatPercent(value as number),
    },
  ];

  const expenseColumns: Array<ComprehensiveColumn<ComprehensiveMetricRow>> = [
    { key: 'dimKey', title: '维度' },
    {
      key: 'feeAmount',
      title: '费用金额(万)',
      align: 'right',
      render: (value) => formatPremiumWan(value as number),
    },
    {
      key: 'expenseRatio',
      title: '费用率',
      align: 'right',
      render: (value) => formatPercent(value as number | null),
    },
    {
      key: 'expenseShare',
      title: '费用占比',
      align: 'right',
      render: (value) => formatPercent(value as number),
    },
  ];

  const roiColumns: Array<ComprehensiveColumn<ComprehensiveRoiRow>> = [
    { key: 'dimKey', title: '维度' },
    {
      key: 'signedPremium',
      title: '签单保费(万)',
      align: 'right',
      render: (value) => formatPremiumWan(value as number),
    },
    {
      key: 'expenseAmount',
      title: '费用金额(万)',
      align: 'right',
      render: (value) => formatPremiumWan(value as number),
    },
    {
      key: 'expenseOutputPremiumRatio',
      title: '费用产出保费比',
      align: 'right',
      render: (value) => {
        const num = value as number | null;
        return num === null ? '-' : num.toFixed(2);
      },
    },
    {
      key: 'marginRate',
      title: '边际贡献率',
      align: 'right',
      render: (value) => formatPercent(value as number | null),
    },
  ];

  const chartOption = useMemo(() => {
    if (!data) return {};

    switch (activeTab) {
      case 'overview':
        return buildOverviewOption(selectedMetricRows, isDark);
      case 'premium':
        return buildPremiumOption(selectedMetricRows, isDark);
      case 'cost':
        return buildCostOption(selectedMetricRows);
      case 'loss':
        if (lossView === 'trend') {
          return buildLossTrendOption(data.loss.trendRows, isDark);
        }
        return buildLossQuadrantOption(
          selectedMetricRows,
          data.meta.thresholds.lossRateWarn
        );
      case 'expense':
        return buildExpenseOption(selectedMetricRows, data.meta.thresholds.expenseBudget, isDark);
      case 'roi':
      default:
        return buildRoiOption(roiRows);
    }
  }, [activeTab, data, isDark, lossView, roiRows, selectedMetricRows]);

  const secondaryChartOption = useMemo(() => {
    if (!data || activeTab !== 'expense') return null;
    return buildExpenseSurplusOption(
      data.expense.surplusRows.filter((row) => row.dimType === currentDimension),
      isDark
    );
  }, [activeTab, currentDimension, data, isDark]);

  const isDimensionVisible = activeTab !== 'loss' || lossView === 'quadrant';

  return (
    <PageFilterPanel
      preset="cost"
      title={dynamicTitle}
      showBasicFilterBar={false}
      headerRightContent={(actions) => (
        <FilterQuickActions {...actions}>
          {onBack && (
            <button
              onClick={onBack}
              className={cn(buttonStyles.base, buttonStyles.secondary, buttonStyles.sizeSmall)}
            >
              <ArrowLeft size={14} className="mr-1" />
              返回成本分析
            </button>
          )}
        </FilterQuickActions>
      )}
    >
      <QuickFilterBar filters={quickFilters} onChange={handleQuickFilterChange} />
      <div className="space-y-4">
        <section className={cn(cardStyles.standard, 'space-y-3')}>
          <Tabs
            items={tabItems}
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as ComprehensiveTabKey)}
            variant="pills"
          />
          {activeTab === 'loss' && (
            <div className="flex items-center gap-2">
              <Button
                variant={lossView === 'quadrant' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setLossView('quadrant')}
              >
                象限视图
              </Button>
              <Button
                variant={lossView === 'trend' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setLossView('trend')}
              >
                趋势视图
              </Button>
            </div>
          )}
          {isDimensionVisible && (
            <div className="flex items-center gap-2 flex-wrap">
              {dimensionItems.map((item) => (
                <Button
                  key={item.key}
                  variant={currentDimension === item.key ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => setDimensions((prev) => ({ ...prev, [activeTab]: item.key }))}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          )}
          {data && (
            <div className={textStyles.caption}>
              截止日期：{data.meta.cutoffDate} | 计划年度：{data.meta.planYear} | 机构范围：{data.meta.orgScope.join('、') || '全部'}
            </div>
          )}
        </section>

        {activeTab === 'overview' && data && (
          <section className={cn(cardStyles.standard, 'space-y-3')}>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <div className={cn(cardStyles.base, 'p-3')}>
                <div className={textStyles.caption}>签单保费</div>
                <div className={cn(textStyles.titleMedium, 'mt-1')}>{formatPremiumWan(data.overview.summary.signedPremium)} 万</div>
              </div>
              <div className={cn(cardStyles.base, 'p-3')}>
                <div className={textStyles.caption}>满期赔付率</div>
                <div className={cn(textStyles.titleMedium, 'mt-1')}>{formatPercent(data.overview.summary.earnedClaimRatio)}</div>
              </div>
              <div className={cn(cardStyles.base, 'p-3')}>
                <div className={textStyles.caption}>费用率</div>
                <div className={cn(textStyles.titleMedium, 'mt-1')}>{formatPercent(data.overview.summary.expenseRatio)}</div>
              </div>
              <div className={cn(cardStyles.base, 'p-3')}>
                <div className={textStyles.caption}>年计划达成率</div>
                <div className={cn(textStyles.titleMedium, 'mt-1')}>{formatPercent(data.overview.summary.achievementRate)}</div>
              </div>
            </div>

            {data.overview.alerts.length > 0 && (
              <div className={cn(cardStyles.base, 'p-3')}>
                <div className={cn(textStyles.label, colorClasses.text.danger)}>预警提示</div>
                <ul className={cn('mt-2 space-y-1', textStyles.body)}>
                  {data.overview.alerts.map((alert) => (
                    <li key={alert} className="list-disc list-inside">{alert}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <ComprehensiveChartCard
          title={
            activeTab === 'overview'
              ? '总览分析'
              : activeTab === 'premium'
                ? '保费进度分析'
                : activeTab === 'cost'
                  ? '成本指标象限'
                  : activeTab === 'loss'
                    ? (lossView === 'trend' ? '赔付趋势分析' : '赔付贡献象限')
                    : activeTab === 'expense'
                      ? '费用率分析'
                      : 'ROI 效率分析'
          }
          option={chartOption}
          loading={loading}
          error={error}
          height={360}
        />

        {secondaryChartOption && (
          <ComprehensiveChartCard
            title="费用结余分析"
            option={secondaryChartOption}
            loading={loading}
            error={error}
            height={320}
          />
        )}

        {activeTab === 'roi' ? (
          <ComprehensiveMetricTable
            title="ROI 明细（Top 20）"
            rows={roiRows}
            columns={roiColumns}
            loading={loading}
          />
        ) : (
          <ComprehensiveMetricTable
            title={`${tabItems.find((item) => item.key === activeTab)?.label || ''}明细（Top 20）`}
            rows={selectedMetricRows}
            columns={activeTab === 'expense' ? expenseColumns : overviewColumns}
            loading={loading}
          />
        )}

        {error && (
          <div className={cn(cardStyles.standard, colorClasses.text.danger)}>
            数据加载失败：{error}
          </div>
        )}

        {data && (
          <div className={textStyles.caption}>
            阈值配置：保费进度 {data.meta.thresholds.premiumProgressWarn}% | 变动成本率 {data.meta.thresholds.costRateWarn}% | 满期赔付率 {data.meta.thresholds.lossRateWarn}% | 费用率 {data.meta.thresholds.expenseRateWarn}% | 费用预算 {data.meta.thresholds.expenseBudget}%
          </div>
        )}
      </div>
    </PageFilterPanel>
  );
};

export default ComprehensiveAnalysisPage;
