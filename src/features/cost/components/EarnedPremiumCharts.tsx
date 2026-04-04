/**
 * 已赚保费可视化图表组件
 * Earned Premium Visualization Charts
 *
 * 提供财务口径已赚保费的多维度可视化：
 * - KPI 卡片区域：保费合计、已赚保费、已赚保费率
 * - 险类构成环形图：交强险 vs 商业保险
 * - 堆叠柱状图：首日费用部分 vs 时间分摊部分（按机构）
 * - 机构对比横向条形图：已赚保费 Top N
 */

import React, { memo, useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '../../../shared/utils/echarts';
import { formatCurrency, formatPercent } from '../../../shared/utils/formatters';
import { EnhancedKpiCard } from '../../../widgets/kpi/EnhancedKpiCard';
import { CHART_TEXT_STYLES, GRID_CONFIG } from '../../../shared/config/chartStyles';
import { colorClasses, cn } from '../../../shared/styles';
import type { EarnedPremiumData, EarnedPremiumSummaryData } from '../types/costTypes';

// ==================== 类型定义 ====================

interface EarnedPremiumChartsProps {
  /** 明细数据（用于险类构成计算） */
  detailData: EarnedPremiumData[];
  /** 汇总数据（用于机构对比） */
  summaryData: EarnedPremiumSummaryData[];
  /** 加载状态 */
  loading?: boolean;
  /** 统计截止日期 */
  cutoffDate: string;
}

/** 险类汇总数据 */
interface InsuranceTypeSummary {
  name: string;
  totalPremium: number;
  earnedPremium: number;
  firstDayPart: number;
  timePart: number;
}

// ==================== 颜色配置 ====================

const COLORS = {
  // 险类颜色
  compulsory: '#3b82f6', // 交强险 - 蓝色
  commercial: '#10b981', // 商业保险 - 绿色
  // 构成颜色
  firstDay: '#6366f1', // 首日费用 - 靛蓝色
  timePart: '#22c55e', // 时间分摊 - 绿色
  // 机构颜色渐变
  orgGradient: ['#3b82f6', '#60a5fa', '#93c5fd'],
};

// ==================== 工具函数 ====================

/**
 * 按险类汇总数据
 */
function aggregateByInsuranceType(data: EarnedPremiumData[]): InsuranceTypeSummary[] {
  const map = new Map<string, InsuranceTypeSummary>();

  data.forEach((row) => {
    const key = row.insurance_type;
    const existing = map.get(key);

    if (existing) {
      existing.totalPremium += row.total_premium;
      existing.earnedPremium += row.earned_premium_cum;
      existing.firstDayPart += row.first_day_part;
      existing.timePart += row.time_part;
    } else {
      map.set(key, {
        name: key,
        totalPremium: row.total_premium,
        earnedPremium: row.earned_premium_cum,
        firstDayPart: row.first_day_part,
        timePart: row.time_part,
      });
    }
  });

  return Array.from(map.values());
}

/**
 * 格式化金额（输入单位：元）
 */
function formatYuan(value: number): string {
  if (value >= 100000000) {
    // >= 1亿
    return `${formatCurrency(value / 100000000)}亿`;
  } else if (value >= 10000) {
    // >= 1万
    return `${formatCurrency(value / 10000)}万`;
  }
  return `${formatCurrency(value)}元`;
}

// ==================== KPI 卡片组件 ====================

interface KpiSectionProps {
  summaryData: EarnedPremiumSummaryData[];
  loading?: boolean;
}

const KpiSection: React.FC<KpiSectionProps> = ({ summaryData, loading }) => {
  // 从合计行获取数据
  const totals = useMemo(() => {
    const totalRow = summaryData.find((row) => row.org_level_3 === '合计');
    if (!totalRow) {
      return {
        totalPremium: 0,
        earnedPremium: 0,
        earnedRatio: 0,
        firstDayPart: 0,
        timePart: 0,
      };
    }
    return {
      totalPremium: totalRow.total_premium,
      earnedPremium: totalRow.total_earned_premium,
      earnedRatio: totalRow.earned_ratio,
      firstDayPart: totalRow.total_first_day_part,
      timePart: totalRow.total_time_part,
    };
  }, [summaryData]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* 保费合计 */}
      <EnhancedKpiCard
        title="保费合计"
        value={formatYuan(totals.totalPremium)}
        loading={loading}
        type="value"
      />

      {/* 累计已赚保费 */}
      <EnhancedKpiCard
        title="累计已赚保费"
        value={formatYuan(totals.earnedPremium)}
        loading={loading}
        type="value"
      />

      {/* 已赚保费率 */}
      <EnhancedKpiCard
        title="已赚保费率"
        value={formatPercent(totals.earnedRatio)}
        loading={loading}
        type="value"
      />

      {/* 已赚保费构成 */}
      <EnhancedKpiCard
        title="已赚保费构成"
        loading={loading}
        type="donut"
        ratioData={[
          { label: '首日费用', value: totals.firstDayPart, color: COLORS.firstDay },
          { label: '时间分摊', value: totals.timePart, color: COLORS.timePart },
        ]}
        chartSize={56}
      />
    </div>
  );
};

// ==================== 险类构成环形图 ====================

interface InsuranceTypePieProps {
  data: InsuranceTypeSummary[];
  loading?: boolean;
}

const InsuranceTypePie: React.FC<InsuranceTypePieProps> = ({ data, loading }) => {
  const option = useMemo(() => {
    const pieData = data.map((item) => ({
      name: item.name,
      value: item.earnedPremium,
      itemStyle: {
        color: item.name === '交强险' ? COLORS.compulsory : COLORS.commercial,
      },
    }));

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const value = formatYuan(params.value);
          return `${params.name}<br/>已赚保费: ${value}<br/>占比: ${formatPercent(Number(params.percent))}`;
        },
      },
      legend: {
        bottom: 0,
        textStyle: CHART_TEXT_STYLES.legend,
      },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: '{b}\n{d}%',
            ...CHART_TEXT_STYLES.dynamicLabel,
          },
          labelLine: {
            show: true,
            length: 10,
            length2: 15,
          },
          data: pieData,
        },
      ],
    };
  }, [data]);

  if (loading) {
    return (
      <div className={cn('h-64 flex items-center justify-center rounded-lg', colorClasses.bg.neutral)}>
        <span className={colorClasses.text.neutralMuted}>加载中...</span>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-lg p-4 border', colorClasses.border.neutral)}>
      <h4 className={cn('text-sm font-medium mb-2', colorClasses.text.neutralDark)}>险类已赚保费构成</h4>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '220px', width: '100%' }}
        notMerge={true}
      />
    </div>
  );
};

// ==================== 堆叠柱状图（首日费用 vs 时间分摊） ====================

interface StackedBarChartProps {
  summaryData: EarnedPremiumSummaryData[];
  loading?: boolean;
}

const StackedBarChart: React.FC<StackedBarChartProps> = ({ summaryData, loading }) => {
  const option = useMemo(() => {
    // 过滤掉合计行，只显示机构数据
    const orgData = summaryData.filter((row) => row.org_level_3 !== '合计');

    const categories = orgData.map((row) => row.org_level_3);
    const firstDayData = orgData.map((row) => row.total_first_day_part);
    const timePartData = orgData.map((row) => row.total_time_part);

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const category = params[0].axisValue;
          let result = `<div style="font-weight:bold;margin-bottom:8px">${category}</div>`;

          let total = 0;
          params.forEach((param: any) => {
            const value = formatYuan(param.value);
            result += `<div style="display:flex;align-items:center;margin-top:4px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${param.color};margin-right:8px"></span>
              <span>${param.seriesName}: <strong>${value}</strong></span>
            </div>`;
            total += param.value;
          });

          result += `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee">
            <strong>合计: ${formatYuan(total)}</strong>
          </div>`;

          return result;
        },
      },
      legend: {
        bottom: 0,
        textStyle: CHART_TEXT_STYLES.legend,
      },
      grid: GRID_CONFIG,
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          rotate: 0,
          interval: 0,
          ...CHART_TEXT_STYLES.axisLabel,
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => formatYuan(value),
          ...CHART_TEXT_STYLES.axisLabel,
        },
      },
      series: [
        {
          name: '首日费用部分',
          type: 'bar',
          stack: 'earned',
          data: firstDayData,
          itemStyle: { color: COLORS.firstDay },
          barWidth: '50%',
        },
        {
          name: '时间分摊部分',
          type: 'bar',
          stack: 'earned',
          data: timePartData,
          itemStyle: { color: COLORS.timePart },
          barWidth: '50%',
        },
      ],
    };
  }, [summaryData]);

  if (loading) {
    return (
      <div className={cn('h-64 flex items-center justify-center rounded-lg', colorClasses.bg.neutral)}>
        <span className={colorClasses.text.neutralMuted}>加载中...</span>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-lg p-4 border', colorClasses.border.neutral)}>
      <h4 className={cn('text-sm font-medium mb-2', colorClasses.text.neutralDark)}>已赚保费构成分解（按机构）</h4>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '220px', width: '100%' }}
        notMerge={true}
      />
    </div>
  );
};

// ==================== 机构对比横向条形图 ====================

interface OrgComparisonBarProps {
  summaryData: EarnedPremiumSummaryData[];
  loading?: boolean;
}

const OrgComparisonBar: React.FC<OrgComparisonBarProps> = ({ summaryData, loading }) => {
  const option = useMemo(() => {
    // 过滤掉合计行，按已赚保费降序排序
    const orgData = summaryData
      .filter((row) => row.org_level_3 !== '合计')
      .sort((a, b) => b.total_earned_premium - a.total_earned_premium);

    const categories = orgData.map((row) => row.org_level_3);
    const earnedData = orgData.map((row) => row.total_earned_premium);
    const ratioData = orgData.map((row) => row.earned_ratio);

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const category = params[0].axisValue;
          const earned = params[0]?.value || 0;
          const ratio = params[1]?.value || 0;
          return `<div style="font-weight:bold;margin-bottom:8px">${category}</div>
            <div>累计已赚保费: <strong>${formatYuan(earned)}</strong></div>
            <div>已赚保费率: <strong>${formatPercent(Number(ratio))}</strong></div>`;
        },
      },
      legend: {
        bottom: 0,
        textStyle: CHART_TEXT_STYLES.legend,
      },
      grid: {
        ...GRID_CONFIG,
        right: '10%',
      },
      xAxis: [
        {
          type: 'value',
          position: 'bottom',
          axisLabel: {
            formatter: (value: number) => formatYuan(value),
            ...CHART_TEXT_STYLES.axisLabel,
          },
        },
        {
          type: 'value',
          position: 'top',
          max: 100,
          axisLabel: {
            formatter: '{value}%',
            ...CHART_TEXT_STYLES.axisLabel,
          },
          splitLine: { show: false },
        },
      ],
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: CHART_TEXT_STYLES.axisLabel,
        inverse: true,
      },
      series: [
        {
          name: '累计已赚保费',
          type: 'bar',
          xAxisIndex: 0,
          data: earnedData,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: '#3b82f6' },
                { offset: 1, color: '#60a5fa' },
              ],
            },
          },
          barWidth: '60%',
          label: {
            show: true,
            position: 'right',
            formatter: (params: any) => formatYuan(params.value),
            ...CHART_TEXT_STYLES.dynamicLabel,
          },
        },
        {
          name: '已赚保费率',
          type: 'line',
          xAxisIndex: 1,
          data: ratioData,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { color: '#f59e0b', width: 2 },
          itemStyle: { color: '#f59e0b' },
        },
      ],
    };
  }, [summaryData]);

  if (loading) {
    return (
      <div className={cn('h-64 flex items-center justify-center rounded-lg', colorClasses.bg.neutral)}>
        <span className={colorClasses.text.neutralMuted}>加载中...</span>
      </div>
    );
  }

  return (
    <div className={cn('bg-white rounded-lg p-4 border', colorClasses.border.neutral)}>
      <h4 className={cn('text-sm font-medium mb-2', colorClasses.text.neutralDark)}>机构已赚保费对比</h4>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: '220px', width: '100%' }}
        notMerge={true}
      />
    </div>
  );
};

// ==================== 主组件 ====================

/**
 * 已赚保费可视化图表组件
 *
 * 布局：
 * - 第一行：KPI 卡片（4列）
 * - 第二行：险类构成环形图 + 堆叠柱状图（2列）
 * - 第三行：机构对比横向条形图（全宽）
 */
export const EarnedPremiumCharts = memo<EarnedPremiumChartsProps>(function EarnedPremiumCharts({
  detailData,
  summaryData,
  loading = false,
  cutoffDate: _cutoffDate, // Reserved for future use (e.g., trend charts)
}) {
  // 按险类汇总数据
  const insuranceTypeSummary = useMemo(
    () => aggregateByInsuranceType(detailData),
    [detailData]
  );

  // 空数据检查
  if (!loading && detailData.length === 0 && summaryData.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* 第一行：KPI 卡片 */}
      <KpiSection summaryData={summaryData} loading={loading} />

      {/* 第二行：险类构成 + 堆叠柱状图 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InsuranceTypePie data={insuranceTypeSummary} loading={loading} />
        <StackedBarChart summaryData={summaryData} loading={loading} />
      </div>

      {/* 第三行：机构对比 */}
      <OrgComparisonBar summaryData={summaryData} loading={loading} />
    </div>
  );
});

export default EarnedPremiumCharts;
