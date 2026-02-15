import React, { useEffect, useState, useMemo } from 'react';
import { useGrowthAnalysis, type DualMetricComparisonData } from '../hooks/useGrowthAnalysis';
import { exportArrayToCSV } from '../../../shared/utils/export';
import { BarChart } from '../../../widgets/charts/BarChart';
import { formatCount, formatPremiumWan, formatRate } from '../../../shared/utils/formatters';
import type { AdvancedFilterState } from '../../../shared/types/data';
import { WaterfallChart } from '../../../widgets/charts/WaterfallChart';
import { usePerspective } from '../../dashboard/hooks/usePerspective';
import { useDataStatus } from '../../../shared/contexts/DataContext';
import {
  type ComparisonPreset,
  type ComparisonPeriods,
  calculatePresetPeriods,
} from '../utils/comparisonPresets';
import { GrowthAnalysisControlPanel } from './GrowthAnalysisControlPanel';
import { GrowthMonthTabs } from './GrowthMonthTabs';
import { GrowthComparisonSection } from './GrowthComparisonSection';
import { GrowthDetailSection } from './GrowthDetailSection';
import { formatPercent1, getSafeDateStr } from '../utils/format';
import { buildFilterParams } from '../../../shared/utils/filterParams';

interface GrowthAnalysisPanelProps {
  filters: AdvancedFilterState;
}

/**
 * 增长率分析面板组件
 *
 * 集成到现有Dashboard中，提供多维度增长率分析
 *
 * 重构说明（2026-02-13）：
 * - 使用 buildFilterParams 构建 API 查询参数（替代有损的 WHERE 字符串转换）
 * - 支持完整筛选器：客户类别、险别组合、续保模式、评分字段、基本选项等
 * - 与仪表盘筛选器完全对齐
 */
export const GrowthAnalysisPanel: React.FC<GrowthAnalysisPanelProps> = ({
  filters
}) => {
  // 从 filters 中提取机构和业务员（取第一个选中的值）
  const orgLevel3 = filters.org_level_3?.[0];
  const salesmanName = filters.salesman_name?.[0];
  const [analysisType, setAnalysisType] = useState<'org' | 'salesman' | 'kpi' | 'comparison'>('org');
  const [growthType, setGrowthType] = useState<'yoy' | 'mom' | 'ytd'>('yoy');
  const [timeView, setTimeView] = useState<'monthly' | 'quarterly'>('monthly');
  // 默认选中当前月份
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const { perspective, setPerspective, config: perspectiveConfig } = usePerspective();
  const { isDataLoaded } = useDataStatus();

  // 对比分析状态
  const [comparisonPreset, setComparisonPreset] = useState<ComparisonPreset>('yoy');
  const [comparisonPeriods, setComparisonPeriods] = useState<ComparisonPeriods | null>(null);
  const [comparisonData, setComparisonData] = useState<DualMetricComparisonData[]>([]);
  const [comparisonGroupBy, setComparisonGroupBy] = useState<'org_level_3' | 'salesman_name'>('org_level_3');
  // 基准日期（DC-002: 使用筛选器的截止日期或数据最大日期）
  const baseDate = filters.policy_date_end ?? new Date().toISOString().split('T')[0];
  const isPremiumPerspective = perspectiveConfig.valueFormatter === 'premium';
  const valueLabel = isPremiumPerspective ? '保费' : '件数';
  const unitLabel = isPremiumPerspective ? '万' : '件';

  /**
   * 构建附加筛选参数
   *
   * 使用 buildFilterParams 生成后端 API 查询参数，
   * 但排除机构和业务员（因为它们在各函数中单独处理），
   * 以及日期范围（因为增长分析使用独立的日期逻辑）。
   */
  const additionalFilterParams = useMemo(() => {
    // 创建一个不包含机构/业务员/日期的筛选器副本
    const filtersForParams: AdvancedFilterState = {
      // 保留客户类别、险别组合、续保模式
      customer_category: filters.customer_category,
      coverage_combination: filters.coverage_combination,
      renewal_mode: filters.renewal_mode,
      // 保留布尔筛选器
      is_renewal: filters.is_renewal,
      is_new_car: filters.is_new_car,
      is_transfer: filters.is_transfer,
      is_nev: filters.is_nev,
      is_telemarketing: filters.is_telemarketing,
      is_commercial_insure: filters.is_commercial_insure,
      is_renewable: filters.is_renewable,
      is_cross_sell: filters.is_cross_sell,
      // 保留新增评分字段
      insurance_grade: filters.insurance_grade,
      small_truck_score: filters.small_truck_score,
      large_truck_score: filters.large_truck_score,
      // 不传入日期相关字段（增长分析有独立的日期逻辑）
      // 不传入机构/业务员（在各函数中单独处理）
    };

    return buildFilterParams(filtersForParams);
  }, [
    filters.customer_category,
    filters.coverage_combination,
    filters.renewal_mode,
    filters.is_renewal,
    filters.is_new_car,
    filters.is_transfer,
    filters.is_nev,
    filters.is_telemarketing,
    filters.is_commercial_insure,
    filters.is_renewable,
    filters.is_cross_sell,
    filters.insurance_grade,
    filters.small_truck_score,
    filters.large_truck_score,
  ]);

  /**
   * 格式化数值（不带单位）
   * 遵循全局格式化规范：保费万元整数，件数整数千分位
   */
  const formatValueNoUnit = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    if (isPremiumPerspective) return formatPremiumWan(val);
    return formatCount(val);
  };
  /**
   * 格式化数值（带单位）
   */
  const formatValueWithUnit = (val: number) => {
    if (isPremiumPerspective) return formatPremiumWan(val) + '万';
    return formatCount(val);
  };

  const {
    data,
    loading,
    error,
    analyzeOrgPremiumGrowth,
    analyzeSalesmanGrowth,
    analyzeKPIGrowth,
    analyzeDailyGrowthDetail,
    analyzeDualMetricComparison,
    reset
  } = useGrowthAnalysis();

  // 处理对比预设变更
  const handleComparisonPresetChange = (preset: ComparisonPreset, periods: ComparisonPeriods | null) => {
    setComparisonPreset(preset);
    setComparisonPeriods(periods);
  };

  // 对比分析effect
  useEffect(() => {
    if (analysisType !== 'comparison') return;
    if (!isDataLoaded) return;
    if (!comparisonPeriods) return;

    const performComparison = async () => {
      // 构建筛选参数：合并机构筛选和附加筛选参数
      const comparisonFilterParams: Record<string, string> = {
        ...additionalFilterParams,
      };
      if (filters.org_level_3?.length) {
        comparisonFilterParams.orgNames = filters.org_level_3.join(',');
      }

      const result = await analyzeDualMetricComparison(
        comparisonPeriods.current,
        comparisonPeriods.previous,
        [comparisonGroupBy],
        comparisonFilterParams
      );

      if (result.success) {
        setComparisonData(result.data);
      }
    };

    performComparison();
  }, [analysisType, isDataLoaded, comparisonPeriods, comparisonGroupBy, filters.org_level_3, additionalFilterParams, analyzeDualMetricComparison]);

  // 初始化对比期间（首次切换到对比分析时）
  useEffect(() => {
    if (analysisType === 'comparison' && !comparisonPeriods) {
      const periods = calculatePresetPeriods(comparisonPreset, baseDate);
      setComparisonPeriods(periods);
    }
  }, [analysisType, comparisonPeriods, comparisonPreset, baseDate]);

  // 根据分析类型和参数执行增长分析
  useEffect(() => {
    // comparison类型有自己的useEffect处理
    if (analysisType === 'comparison') return;
    if (!isDataLoaded) return;

    if (!orgLevel3 && !salesmanName && analysisType === 'salesman') {
      return; // 需要指定业务员才能分析
    }

    const performAnalysis = async () => {
      // 特殊模式：机构分析 + 同比 + 月度 -> 显示每日详情表格
      if (analysisType === 'org' && growthType === 'yoy' && timeView === 'monthly') {
        // DC-002: 使用 ?? 确保用户选择优先于默认值
        const year = filters.analysis_year ?? new Date().getFullYear();
        // 强制查询全年数据，以便支持月份切换和YTD计算
        const start = `${year}-01-01`;
        const end = `${year}-12-31`;

        await analyzeDailyGrowthDetail(start, end, {
          orgLevel3: filters.org_level_3,
          perspective,
          additionalFilterParams,
        });
        return;
      }

      switch (analysisType) {
        case 'org':
          await analyzeOrgPremiumGrowth(orgLevel3, growthType, timeView, perspective, additionalFilterParams);
          break;
        case 'salesman':
          if (salesmanName) {
            await analyzeSalesmanGrowth(salesmanName, growthType, perspective, additionalFilterParams);
          }
          break;
        case 'kpi':
          // 分析续保率增长率
          await analyzeKPIGrowth(
            '(COUNT(CASE WHEN is_renewal THEN 1 END) * 1.0 / NULLIF(COUNT(*), 0)) AS renewal_rate',
            growthType,
            orgLevel3 ? ['salesman_name'] : ['org_level_3'],
            additionalFilterParams
          );
          break;
      }
    };

    performAnalysis();
  }, [
    analysisType,
    isDataLoaded,
    growthType,
    timeView,
    orgLevel3,
    salesmanName,
    filters.analysis_year,
    filters.org_level_3,
    perspective,
    additionalFilterParams,
    analyzeOrgPremiumGrowth,
    analyzeSalesmanGrowth,
    analyzeKPIGrowth,
    analyzeDailyGrowthDetail,
  ]);

  // 准备图表数据
  const prepareChartData = () => {
    if (!data || !Array.isArray(data)) return [];
    return data.map(item => ({
      dim_key: item.time_period ? getSafeDateStr(item.time_period) : String(item.salesman_name || item.org_level_3 || '-'),
      value: (item.growth_rate || 0) * 100, // 转换为百分比
    }));
  };

  const chartData = prepareChartData();
  const isDailyDetailMode = analysisType === 'org' && growthType === 'yoy' && timeView === 'monthly';

  // 准备瀑布图数据 (增长贡献)
  const waterfallData = React.useMemo(() => {
    if (isDailyDetailMode) return [];

    return data
      .map(item => ({
        label: item.time_period ? getSafeDateStr(item.time_period) : String(item.salesman_name || item.org_level_3 || '-'),
        value: (item.current_value || 0) - (item.previous_value || 0)
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)) // 按绝对值排序
      .slice(0, 15); // 取前15个影响因子
  }, [data, isDailyDetailMode]);

  // 过滤当前选中月份的数据
  const displayData = isDailyDetailMode
    ? data.filter(item => {
        if (!item.time_period) return false;
        const date = new Date(item.time_period);
        return (date.getMonth() + 1) === selectedMonth;
      })
    : data;

  // 获取截止日期（用于样式判断）
  // DC-002: 使用 ?? 确保用户选择优先于默认值
  const cutoffDateStr = filters.policy_date_end ?? new Date().toISOString().split('T')[0];

  const handleDownload = () => {
    const exportData = displayData.map(item => {
      const dateStr = getSafeDateStr(item.time_period);
      const label = isDailyDetailMode
        ? (item.time_period ? dateStr : '-')
        : (item.time_period ? dateStr : (item.salesman_name || item.org_level_3 || '-'));

      const row: Record<string, string | number> = {
        [isDailyDetailMode ? '日期' : analysisType === 'org' ? '机构' : analysisType === 'salesman' ? '业务员' : '时间']: label,
        [`${isDailyDetailMode ? '当年当日' : '当期'}${valueLabel}`]: formatValueNoUnit(item.current_value),
        [`${isDailyDetailMode ? '上年当日' : '基期'}${valueLabel}`]: formatValueNoUnit(item.previous_value),
        [isDailyDetailMode ? '日增速' : '增长率']: formatPercent1(item.growth_rate)
      };

      if (isDailyDetailMode) {
        row[`当年当月累计${valueLabel}`] = formatValueNoUnit(item.period_total_current);
        row[`上年当月累计${valueLabel}`] = formatValueNoUnit(item.period_total_previous);
        row['当月增速'] = formatPercent1(item.period_growth_rate);
        row[`当年累计${valueLabel}`] = formatValueNoUnit(item.ytd_total_current);
        row[`上年累计${valueLabel}`] = formatValueNoUnit(item.ytd_total_previous);
        row['当年增速'] = formatPercent1(item.ytd_growth_rate);
      }

      return row;
    });

    exportArrayToCSV(exportData, `增长明细_${getSafeDateStr(new Date())}.csv`);
  };

  const handleComparisonDownload = () => {
    const exportData = comparisonData.map(item => ({
      [comparisonGroupBy === 'org_level_3' ? '机构' : '业务员']: item.dim_key,
      '当期保费(万)': formatPremiumWan(item.current_premium),
      '基期保费(万)': formatPremiumWan(item.previous_premium),
      '保费增长率': formatPercent1(item.premium_growth_rate),
      '当期件数': formatCount(item.current_count),
      '基期件数': formatCount(item.previous_count),
      '件数增长率': formatPercent1(item.count_growth_rate)
    }));

    exportArrayToCSV(exportData, `对比分析数据_${getSafeDateStr(new Date())}.csv`);
  };

  // 生成当前筛选条件描述（用于UI显示）
  const filterDescription = useMemo(() => {
    const parts: string[] = [];
    if (filters.customer_category?.length) {
      parts.push(`客户类别: ${filters.customer_category.join(', ')}`);
    }
    if (filters.coverage_combination?.length) {
      parts.push(`险别组合: ${filters.coverage_combination.join(', ')}`);
    }
    if (filters.renewal_mode?.length) {
      parts.push(`续保模式: ${filters.renewal_mode.join(', ')}`);
    }
    if (filters.insurance_type !== undefined && filters.insurance_type !== null) {
      parts.push(`险类: ${filters.insurance_type ? '交强险' : '商业保险'}`);
    }
    return parts.length > 0 ? parts.join(' | ') : null;
  }, [filters.customer_category, filters.coverage_combination, filters.renewal_mode, filters.insurance_type]);

  return (
    <div className="growth-analysis-panel">
      <GrowthAnalysisControlPanel
        analysisType={analysisType}
        onAnalysisTypeChange={setAnalysisType}
        growthType={growthType}
        onGrowthTypeChange={setGrowthType}
        timeView={timeView}
        onTimeViewChange={setTimeView}
        comparisonGroupBy={comparisonGroupBy}
        onComparisonGroupByChange={setComparisonGroupBy}
        perspective={perspective}
        onPerspectiveChange={setPerspective}
      />

      {/* 筛选条件提示 */}
      {filterDescription && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-4 text-sm text-blue-800">
          <span className="font-medium">当前筛选：</span>{filterDescription}
        </div>
      )}

      {/* 错误显示 */}
      {error && (
        <div style={{
          padding: '12px',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '6px',
          marginBottom: '16px'
        }}>
          <strong>错误：</strong> {error}
        </div>
      )}

      {analysisType === 'comparison' && (
        <GrowthComparisonSection
          baseDate={baseDate}
          comparisonPreset={comparisonPreset}
          comparisonPeriods={comparisonPeriods}
          comparisonData={comparisonData}
          comparisonGroupBy={comparisonGroupBy}
          loading={loading}
          onPresetChange={handleComparisonPresetChange}
          onDownload={handleComparisonDownload}
        />
      )}

      {/* 增长率图表 - 仅在非详情模式和非对比模式下显示 */}
      {!isDailyDetailMode && analysisType !== 'comparison' && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div>
              <h3 style={{ marginBottom: '16px' }}>
                {analysisType === 'org' ? '机构' : analysisType === 'salesman' ? '业务员' : 'KPI'}增长率趋势
              </h3>
              <BarChart
                data={chartData}
                loading={loading}
                title={`${growthType.toUpperCase()} 增长率 (%)`}
                valueFormatter={formatRate}
              />
            </div>
            <div>
              <h3 style={{ marginBottom: '16px' }}>
                增长贡献分析 (Top 15 变动)
              </h3>
              <WaterfallChart
                data={waterfallData}
                loading={loading}
                title={`${valueLabel}变动贡献 (${unitLabel})`}
                valueFormatter={formatValueWithUnit}
              />
            </div>
          </div>
        </div>
      )}

      {/* 月份切换标签页 */}
      {isDailyDetailMode && <GrowthMonthTabs selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />}

      <GrowthDetailSection
        analysisType={analysisType}
        displayData={displayData}
        data={data}
        isDailyDetailMode={isDailyDetailMode}
        isPremiumPerspective={isPremiumPerspective}
        cutoffDateStr={cutoffDateStr}
        selectedMonth={selectedMonth}
        valueLabel={valueLabel}
        unitLabel={unitLabel}
        formatValueNoUnit={formatValueNoUnit}
        onDownload={handleDownload}
      />

      {/* 无数据提示 */}
      {!loading && displayData.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#6c757d', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
          暂无数据 (当前月份: {selectedMonth}月)
        </div>
      )}

      <div style={{ marginTop: '24px', textAlign: 'center' }}>
        <button
          onClick={reset}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          重置分析
        </button>
      </div>
    </div>
  );
};

export default GrowthAnalysisPanel;
