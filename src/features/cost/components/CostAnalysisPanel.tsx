/**
 * 成本分析主面板
 * Cost Analysis Panel
 *
 * 整合控制面板和各类成本分析表格：
 * - 变动成本率
 * - 赔付率
 * - 费用率
 * - 综合费用率
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { colorClasses, cn } from '../../../shared/styles';
import { CostAnalysisControlPanel } from './CostAnalysisControlPanel';
import { ClaimRatioTable } from './ClaimRatioTable';
import { CostTable } from './CostTable';
import { EarnedPremiumTable } from './EarnedPremiumTable';
import { NewEarnedPremiumTable } from './NewEarnedPremiumTable';
import { ExpenseRatioForecastPanel } from './ExpenseRatioForecastPanel';
import { VariableCostKpiBoard } from './VariableCostKpiBoard';
import { useCostAnalysis } from '../hooks/useCostAnalysis';
import { useExportHandlers } from '../hooks/useExportHandlers';
import { buildFilterParams } from '../../../shared/utils/filterParams';
import { useRBAC } from '../../../shared/hooks/useRBAC';
import type { CostSubTab, EarnedPremiumDetailFilter, CostDimension } from '../types/costTypes';
import { DIMENSION_LABELS } from '../types/costTypes';
import type { AdvancedFilterState } from '../../../shared/types';
import type { Column } from '../../../widgets/table/VirtualTable';
import { formatDate, getLastDayOfMonth } from '../../../shared/utils/date';
import { DataScopeAlert } from '../../../widgets/alerts';
import {
  transformExpenseData,
  transformComprehensiveData,
  transformVariableData,
  type DisplayExpenseData,
  type DisplayComprehensiveData,
  type DisplayVariableData,
} from '../utils/transformData';

interface CostAnalysisPanelProps {
  filters: AdvancedFilterState;
  /** 当前口径的最大数据日期（来自元数据） */
  maxDataDate?: string;
  /** 子Tab变化回调，用于通知父组件当前激活的tab */
  onSubTabChange?: (tab: CostSubTab) => void;
}

/**
 * 将 YYYY-MM-DD 规范化为“当月月末”的 YYYY-MM-DD
 * @param dateStr - 日期字符串（YYYY-MM-DD）
 */
function normalizeToMonthEnd(dateStr: string): string {
  const [y, m] = dateStr.split('-').map((v) => Number(v));
  const lastDay = getLastDayOfMonth(y, m - 1);
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * 生成月末选项（包含起止月份，按时间升序）
 * @param startDate - 起始日期（YYYY-MM-DD）
 * @param endDate - 结束日期（YYYY-MM-DD）
 */
function generateMonthEndOptions(
  startDate: string,
  endDate: string
): { value: string; label: string }[] {
  const [sy, sm] = startDate.split('-').map((v) => Number(v));
  const [ey, em] = endDate.split('-').map((v) => Number(v));

  const options: { value: string; label: string }[] = [];
  let y = sy;
  let m = sm;

  while (y < ey || (y === ey && m <= em)) {
    const lastDay = getLastDayOfMonth(y, m - 1);
    const value = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    options.push({ value, label: `${y}年${m}月末` });
    m += 1;
    if (m > 12) {
      y += 1;
      m = 1;
    }
  }

  return options;
}

/**
 * 以某个“月末日期”为锚点，向前生成 N 个月末选项（按时间升序）
 * @param anchorMonthEnd - 锚点月末日期（YYYY-MM-DD）
 * @param monthCount - 生成的月份数量
 */
function generateRecentMonthEndOptions(
  anchorMonthEnd: string,
  monthCount: number
): { value: string; label: string }[] {
  const [ay, am] = anchorMonthEnd.split('-').map((v) => Number(v));
  const anchor = new Date(ay, am - 1, 1);
  const start = new Date(anchor.getFullYear(), anchor.getMonth() - (monthCount - 1), 1);
  const startStr = formatDate(start);
  return generateMonthEndOptions(startStr, anchorMonthEnd);
}

/**
 * 成本分析主面板组件
 */
export const CostAnalysisPanel: React.FC<CostAnalysisPanelProps> = ({
  filters,
  maxDataDate,
  onSubTabChange,
}) => {
  const { isOrgUser, userOrg } = useRBAC();
  // 控制状态
  const [activeSubTab, setActiveSubTab] = useState<CostSubTab>('claim');

  // 通知父组件tab变化
  const handleSubTabChange = useCallback((tab: CostSubTab) => {
    setActiveSubTab(tab);
    onSubTabChange?.(tab);
  }, [onSubTabChange]);
  const [dimension, setDimension] = useState<CostDimension>('customer_category');
  const [cutoffDate, setCutoffDate] = useState<string>(() => {
    const fallbackToday = formatDate(new Date());
    const baseEnd = maxDataDate ?? filters.policy_date_end ?? fallbackToday;
    return normalizeToMonthEnd(baseEnd);
  });

  // 已赚保费明细筛选状态（默认显示全部月份，覆盖滚动12个月完整窗口）
  const [earnedPremiumDetailFilter, setEarnedPremiumDetailFilter] =
    useState<EarnedPremiumDetailFilter>({
      policyMonth: 'all',
      orgLevel3: 'all',
    });

  // 综合费用率预测：运营成本率状态（默认9%）
  const [operatingCostRate, setOperatingCostRate] = useState<number>(9);

  // 数据 Hook
  const {
    claimRatioState,
    expenseRatioState,
    comprehensiveCostState,
    variableCostState,
    variableCostKpiState,
    earnedPremiumState,
    newEarnedPremiumState,
    expenseRatioForecastState,
    fetchClaimRatioData,
    fetchExpenseRatioData,
    fetchComprehensiveCostData,
    fetchVariableCostData,
    fetchVariableCostKpiData,
    fetchEarnedPremiumData,
    fetchNewEarnedPremiumData,
    fetchExpenseRatioForecastData,
  } = useCostAnalysis();

  // 构建筛选参数（直接传递给后端 API）
  const filterParams = useMemo(() => buildFilterParams(filters, { isOrgUser, userOrg }), [filters, isOrgUser, userOrg]);

  /**
   * 已赚保费：忽略全局"日期范围筛选"，避免把滚动窗口错误截断到单月/单年
   * 保留机构/业务员等条件，仅移除日期范围
   */
  const earnedFilterParams = useMemo(() => {
    const earnedFilters: AdvancedFilterState = {
      ...filters,
      policy_date_start: undefined,
      policy_date_end: undefined,
    };
    return buildFilterParams(earnedFilters, { isOrgUser, userOrg });
  }, [filters, isOrgUser, userOrg]);

  const monthEndOptions = useMemo(() => {
    const fallbackToday = formatDate(new Date());
    const end = normalizeToMonthEnd(maxDataDate ?? filters.policy_date_end ?? fallbackToday);

    if (activeSubTab === 'earned') {
      return generateRecentMonthEndOptions(end, 36);
    }

    if (filters.policy_date_start) {
      return generateMonthEndOptions(filters.policy_date_start, end);
    }

    return generateRecentMonthEndOptions(end, 24);
  }, [activeSubTab, filters.policy_date_start, filters.policy_date_end, maxDataDate]);

  // 维度标签
  const dimensionLabel = useMemo(() => DIMENSION_LABELS[dimension], [dimension]);

  // 导出处理器
  const { getCurrentExportHandler } = useExportHandlers({
    claimRatioData: claimRatioState.data,
    expenseRatioData: expenseRatioState.data,
    comprehensiveCostData: comprehensiveCostState.data,
    variableCostData: variableCostState.data,
    earnedPremiumData: earnedPremiumState.data,
    earnedPremiumSummaryData: earnedPremiumState.summaryData,
    dimensionLabel,
    activeSubTab,
  });

  // 加载数据
  const loadData = useCallback(() => {
    switch (activeSubTab) {
      case 'claim':
        fetchClaimRatioData(dimension, cutoffDate, filterParams);
        break;
      case 'expense':
        fetchExpenseRatioData(dimension, cutoffDate, filterParams);
        break;
      case 'comprehensive':
        fetchComprehensiveCostData(dimension, cutoffDate, filterParams);
        break;
      case 'variable':
        fetchVariableCostData(dimension, cutoffDate, filterParams);
        if (dimension !== 'org_level_3') {
          fetchVariableCostKpiData(cutoffDate, filterParams);
        }
        break;
      case 'earned':
        fetchEarnedPremiumData(cutoffDate, earnedFilterParams, earnedPremiumDetailFilter);
        break;
      case 'earned-new':
        fetchNewEarnedPremiumData(earnedFilterParams);
        break;
      case 'expense-forecast':
        fetchExpenseRatioForecastData(earnedFilterParams, operatingCostRate);
        break;
    }
  }, [
    activeSubTab,
    dimension,
    cutoffDate,
    filterParams,
    earnedFilterParams,
    earnedPremiumDetailFilter,
    operatingCostRate,
    fetchClaimRatioData,
    fetchExpenseRatioData,
    fetchComprehensiveCostData,
    fetchVariableCostData,
    fetchVariableCostKpiData,
    fetchEarnedPremiumData,
    fetchNewEarnedPremiumData,
    fetchExpenseRatioForecastData,
  ]);

  // 监听参数变化，自动加载数据
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 费用率列配置（数字列右对齐，保费显示单位）
  const expenseColumns: Column<DisplayExpenseData>[] = useMemo(
    () => [
      { key: 'dim_key', header: dimensionLabel, width: 150 },
      { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
      { key: 'total_premium', header: '保费合计(万)', width: 120, align: 'right' },
      { key: 'total_fee', header: '费用金额(万)', width: 120, align: 'right' },
      { key: 'expense_ratio', header: '费用率', width: 100, align: 'right' },
    ],
    [dimensionLabel]
  );

  // 综合成本列配置（数字列右对齐，保费显示单位）
  const comprehensiveColumns: Column<DisplayComprehensiveData>[] = useMemo(
    () => [
      { key: 'dim_key', header: dimensionLabel, width: 150 },
      { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
      { key: 'total_premium', header: '保费合计(万)', width: 120, align: 'right' },
      { key: 'earned_premium', header: '满期保费(万)', width: 120, align: 'right' },
      { key: 'total_reported_claims', header: '已报告赔款(万)', width: 130, align: 'right' },
      { key: 'total_fee', header: '费用金额(万)', width: 100, align: 'right' },
      { key: 'earned_claim_ratio', header: '赔付率', width: 100, align: 'right' },
      { key: 'expense_ratio', header: '费用率', width: 100, align: 'right' },
      { key: 'comprehensive_expense_ratio', header: '综合费用率', width: 120, align: 'right' },
    ],
    [dimensionLabel]
  );

  // 变动成本列配置（数字列右对齐，保费显示单位）
  const variableColumns: Column<DisplayVariableData>[] = useMemo(
    () => [
      { key: 'dim_key', header: dimensionLabel, width: 150 },
      { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
      { key: 'total_premium', header: '保费合计(万)', width: 120, align: 'right' },
      { key: 'earned_premium', header: '满期保费(万)', width: 120, align: 'right' },
      { key: 'total_reported_claims', header: '已报告赔款(万)', width: 130, align: 'right' },
      { key: 'total_fee', header: '费用金额(万)', width: 100, align: 'right' },
      { key: 'earned_claim_ratio', header: '赔付率', width: 100, align: 'right' },
      { key: 'expense_ratio', header: '费用率', width: 100, align: 'right' },
      { key: 'variable_cost_ratio', header: '变动成本率', width: 120, align: 'right' },
    ],
    [dimensionLabel]
  );

  // 渲染表格内容
  const renderTableContent = () => {
    const variableKpiData =
      dimension === 'org_level_3'
        ? variableCostState.data
        : variableCostKpiState.data;
    const variableKpiLoading =
      dimension === 'org_level_3'
        ? variableCostState.loading
        : variableCostKpiState.loading;
    const variableKpiError =
      dimension === 'org_level_3'
        ? variableCostState.error
        : variableCostKpiState.error;

    switch (activeSubTab) {
      case 'claim':
        return (
          <ClaimRatioTable
            data={claimRatioState.data}
            loading={claimRatioState.loading}
            dimensionLabel={dimensionLabel}
            onExportCSV={() => getCurrentExportHandler('csv')()}
            onExportExcel={() => getCurrentExportHandler('excel')()}
          />
        );

      case 'expense':
        return (
          <CostTable<DisplayExpenseData>
            title="费用率分析明细"
            data={transformExpenseData(expenseRatioState.data)}
            columns={expenseColumns}
            loading={expenseRatioState.loading}
            onExportCSV={() => getCurrentExportHandler('csv')()}
            onExportExcel={() => getCurrentExportHandler('excel')()}
          />
        );

      case 'comprehensive':
        return (
          <CostTable<DisplayComprehensiveData>
            title="综合费用率分析明细"
            data={transformComprehensiveData(comprehensiveCostState.data)}
            columns={comprehensiveColumns}
            loading={comprehensiveCostState.loading}
            onExportCSV={() => getCurrentExportHandler('csv')()}
            onExportExcel={() => getCurrentExportHandler('excel')()}
          />
        );

      case 'variable':
        return (
          <div className="space-y-4">
            <VariableCostKpiBoard
              data={variableKpiData}
              loading={variableKpiLoading}
              error={variableKpiError}
            />
            <CostTable<DisplayVariableData>
              title="变动成本率分析明细"
              data={transformVariableData(variableCostState.data)}
              columns={variableColumns}
              loading={variableCostState.loading}
              onExportCSV={() => getCurrentExportHandler('csv')()}
              onExportExcel={() => getCurrentExportHandler('excel')()}
            />
          </div>
        );

      case 'earned':
        return (
          <EarnedPremiumTable
            data={earnedPremiumState.data}
            summaryData={earnedPremiumState.summaryData}
            loading={earnedPremiumState.loading}
            cutoffDate={cutoffDate}
            onExportCSV={() => getCurrentExportHandler('csv')()}
            onExportExcel={() => getCurrentExportHandler('excel')()}
            onDetailFilterChange={(filter) => {
              setEarnedPremiumDetailFilter(filter);
            }}
          />
        );

      case 'earned-new':
        return (
          <NewEarnedPremiumTable
            anchorYear={newEarnedPremiumState.anchorYear}
            policyPrevInPrevData={newEarnedPremiumState.policyPrevInPrevData}
            policyPrevInCurrData={newEarnedPremiumState.policyPrevInCurrData}
            policyCurrInCurrData={newEarnedPremiumState.policyCurrInCurrData}
            policyCurrInNextData={newEarnedPremiumState.policyCurrInNextData}
            summaryData={newEarnedPremiumState.summaryData}
            loading={newEarnedPremiumState.loading}
            onExportCSV={() => getCurrentExportHandler('csv')()}
            onExportExcel={() => getCurrentExportHandler('excel')()}
          />
        );

      case 'expense-forecast':
        return (
          <ExpenseRatioForecastPanel
            anchorYear={expenseRatioForecastState.anchorYear}
            forecastData={expenseRatioForecastState.forecastData}
            loading={expenseRatioForecastState.loading}
            error={expenseRatioForecastState.error}
            currentOperatingCostRate={operatingCostRate}
            onOperatingCostRateChange={(rate) => {
              setOperatingCostRate(rate);
              // 运营成本率变更后重新加载数据
              fetchExpenseRatioForecastData(earnedFilterParams, rate);
            }}
          />
        );

      default:
        return null;
    }
  };

  // 获取当前状态的错误信息
  const error = (() => {
    switch (activeSubTab) {
      case 'claim':
        return claimRatioState.error;
      case 'expense':
        return expenseRatioState.error;
      case 'comprehensive':
        return comprehensiveCostState.error;
      case 'variable':
        return variableCostState.error;
      case 'earned':
        return earnedPremiumState.error;
      case 'earned-new':
        return newEarnedPremiumState.error;
      case 'expense-forecast':
        return expenseRatioForecastState.error;
      default:
        return null;
    }
  })();

  return (
    <div className="space-y-4">
      {/* 控制面板 */}
      <div id="cost-control"><CostAnalysisControlPanel
        activeSubTab={activeSubTab}
        onSubTabChange={handleSubTabChange}
        dimension={dimension}
        onDimensionChange={setDimension}
        cutoffDate={cutoffDate}
        onCutoffDateChange={setCutoffDate}
        monthEndOptions={monthEndOptions}
      /></div>

      {/* 已赚保费 tab 的数据范围提示 */}
      {activeSubTab === 'earned' && (
        <DataScopeAlert
          type="rolling-window"
          windowMonths={12}
          cutoffDate={cutoffDate}
        />
      )}

      {/* 错误提示 */}
      {error && (
        <div
          className={cn(colorClasses.bg.danger, 'border rounded-lg p-4', colorClasses.border.danger, colorClasses.text.danger)}
          role="alert"
        >
          <strong>错误：</strong> {error}
        </div>
      )}

      {/* 表格内容 */}
      <div id="cost-content">{renderTableContent()}</div>
    </div>
  );
};

export default CostAnalysisPanel;
