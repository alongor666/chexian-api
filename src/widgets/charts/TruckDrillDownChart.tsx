import React, { useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import {
  AXIS_SPLIT_LINE,
  CHART_TEXT_STYLES,
  GRID_CONFIG,
  TONNAGE_COLORS,
  X_AXIS_CONFIG,
} from '../../shared/config/chartStyles';
import { echarts } from '../../shared/utils/echarts';
import { formatCount, formatPremiumWan, formatRate } from '../../shared/utils/formatters';
import type { EChartsParam } from '../../shared/types/echarts';
import type { ViewPerspective } from '../../shared/types';
import { getPerspectiveConfig } from '../../shared/types';
import { cardStyles, cn, colorClasses } from '../../shared/styles';

interface TruckDrillDownData {
  org_level_3: string;
  tonnage_segment: string;
  premium: number;
  premium_ratio: number; // 该吨位在该机构中的占比
}

interface TruckDrillDownChartProps {
  data: TruckDrillDownData[];
  loading?: boolean;
  title?: string;
  subtitle?: string;
  showTitle?: boolean;
  showContainer?: boolean;
  perspective?: ViewPerspective;
}

/**
 * 营业货车下钻分析图
 *
 * 第一层：机构堆叠柱状图（按吨位分段堆叠）
 * - X轴：所有三级机构（按总保费降序）
 * - Y轴：保费金额
 * - 柱子：按吨位分段堆叠（不同颜色）
 * - 点击：下钻到该机构的吨位分段详情
 *
 * 第二层：吨位分段占比详情（饼图）
 * - 显示所选机构的吨位分段保费和占比
 * - 返回按钮：回到第一层
 *
 * @example
 * ```tsx
 * <TruckDrillDownChart
 *   data={[
 *     {org_level_3: '机构A', tonnage_segment: '1吨以下', premium: 100000, premium_ratio: 0.25},
 *     ...
 *   ]}
 *   loading={false}
 * />
 * ```
 */
export const TruckDrillDownChart: React.FC<TruckDrillDownChartProps> = ({
  data,
  loading = false,
  title = '营业货车分析',
  subtitle,
  showTitle = true,
  showContainer = true,
  perspective = 'premium',
}) => {
  const perspectiveConfig = getPerspectiveConfig(perspective);
  const valueFormatter =
    perspectiveConfig.valueFormatter === 'premium' ? formatPremiumWan : formatCount;
  const valueLabel = perspectiveConfig.valueFormatter === 'premium' ? '保费' : '件数';
  // 当前层级状态：'org' = 机构层，'tonnage' = 吨位详情层
  const [drillDownLevel, setDrillDownLevel] = useState<'org' | 'tonnage'>('org');
  // 选中的机构（仅在第二层有效）
  const [selectedOrg, setSelectedOrg] = useState<string>('');

  // 数据转换：计算每个机构的总保费并排序
  const orgTotalPremiums = useMemo(() => {
    const totals = new Map<string, number>();
    data.forEach(row => {
      const current = totals.get(row.org_level_3) || 0;
      totals.set(row.org_level_3, current + row.premium);
    });
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1]) // 按总保费降序
      .map(([org]) => org);
  }, [data]);

  // 提取所有吨位分段（按保费总和降序）
  const tonnageSegments = useMemo(() => {
    const totals = new Map<string, number>();
    data.forEach(row => {
      const current = totals.get(row.tonnage_segment) || 0;
      totals.set(row.tonnage_segment, current + row.premium);
    });
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([segment]) => segment);
  }, [data]);

  // 第一层配置：机构堆叠柱状图
  const orgStackedOption = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        title: { text: title, left: 'center' },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        },
      };
    }

    // 构建数据映射：{机构: {吨位: 保费}} + 机构总保费
    const orgTonnageMap = new Map<string, Map<string, number>>();
    const orgTotals = new Map<string, number>();
    data.forEach(row => {
      if (!orgTonnageMap.has(row.org_level_3)) {
        orgTonnageMap.set(row.org_level_3, new Map());
      }
      orgTonnageMap.get(row.org_level_3)!.set(row.tonnage_segment, row.premium);
      orgTotals.set(row.org_level_3, (orgTotals.get(row.org_level_3) || 0) + row.premium);
    });

    // 构建系列数据：每个吨位分段一个系列
    const series = tonnageSegments.map(segment => ({
      name: segment,
      type: 'bar' as const,
      stack: 'total',
      data: orgTotalPremiums.map(org => orgTonnageMap.get(org)?.get(segment) || 0),
      itemStyle: { color: TONNAGE_COLORS[segment] || '#8D98B3' },
      emphasis: { focus: 'series' as const },
      label: {
        show: true,
        position: 'inside',
        formatter: (params: any) => {
          const safeParams = params as EChartsParam;
          const total = orgTotals.get(String(safeParams.name)) || 0;
          const rawValue =
            typeof safeParams.value === 'number'
              ? safeParams.value
              : Number((safeParams.value as any) ?? 0);
          if (total <= 0 || rawValue <= 0) {
            return '';
          }
          const ratio = rawValue / total;
          if (ratio < 0.05) {
            return '';
          }
          return valueFormatter(rawValue);
        },
        ...CHART_TEXT_STYLES.dynamicLabel,
      },
    }));

    const totalSeries = {
      name: '总保费',
      type: 'bar' as const,
      barGap: '-100%',
      data: orgTotalPremiums.map(org => orgTotals.get(org) || 0),
      itemStyle: { color: 'transparent' },
      label: {
        show: true,
        position: 'top',
        formatter: (params: any) => {
          const safeParams = params as EChartsParam;
          const rawValue =
            typeof safeParams.value === 'number'
              ? safeParams.value
              : Number((safeParams.value as any) ?? 0);
          if (rawValue <= 0) {
            return '';
          }
          return valueFormatter(rawValue);
        },
        ...CHART_TEXT_STYLES.dynamicLabel,
      },
      tooltip: { show: false },
      silent: true,
    };

    const chartOption: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const safeParams = (Array.isArray(params) ? params : []) as EChartsParam[];
          if (!Array.isArray(safeParams) || safeParams.length === 0) return '';
          const org = safeParams[0].name;

          // 计算该机构的总保费
          const totalPremium = safeParams.reduce(
            (sum: number, p) => sum + Number((p.value as any) ?? 0),
            0
          );

          let result = `<div style="font-weight:bold;margin-bottom:6px">${org}</div>`;
          result += `<div style="color:#666;margin-bottom:4px">总${valueLabel}: <strong>${valueFormatter(totalPremium)}</strong></div>`;
          result += `<div style="border-top:1px solid #eee;margin:4px 0"></div>`;

          safeParams.forEach((param) => {
            const rawValue =
              typeof param.value === 'number'
                ? param.value
                : Number((param.value as any) ?? 0);
            if (rawValue > 0) {
              const ratio = rawValue / totalPremium;
              result += `<div style="display:flex;align-items:center;margin-top:4px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${param.color};margin-right:5px"></span>
                <span>${param.seriesName}: <strong>${valueFormatter(rawValue)}</strong> (${formatRate(ratio)})</span>
              </div>`;
            }
          });
          return result;
        },
      },
      legend: {
        bottom: 0,
        data: tonnageSegments,
        type: 'scroll',
        textStyle: CHART_TEXT_STYLES.staticLabel,
      },
      grid: GRID_CONFIG,
      xAxis: {
        ...X_AXIS_CONFIG,
        data: orgTotalPremiums,
        axisLabel: {
          ...X_AXIS_CONFIG.axisLabel,
        },
      },
      yAxis: {
        type: 'value',
        name: perspectiveConfig.yAxisLabel,
        axisLabel: {
          formatter: valueFormatter,
          ...CHART_TEXT_STYLES.axisLabel,
        },
        splitLine: AXIS_SPLIT_LINE,
      },
      series: [...series, totalSeries] as any,
    };

    return chartOption;
  }, [data, orgTotalPremiums, perspectiveConfig.yAxisLabel, title, tonnageSegments, valueFormatter, valueLabel]);

  // 第二层配置：吨位分段占比详情（饼图）
  const tonnageDetailOption = useMemo(() => {
    if (!selectedOrg) {
      return { title: { text: '请选择机构', left: 'center' } };
    }

    // 筛选选中机构的数据
    const orgData = data.filter(row => row.org_level_3 === selectedOrg);
    if (orgData.length === 0) {
      return {
        title: { text: `${selectedOrg} - 暂无数据`, left: 'center' },
        graphic: {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: { text: '暂无数据', fontSize: 16, fill: '#999' },
        },
      };
    }

    // 按保费降序排序
    const sortedData = [...orgData].sort((a, b) => b.premium - a.premium);

    const chartOption: EChartsOption = {
      title: {
        text: `${selectedOrg} - 吨位分段分析`,
        left: 'center',
        textStyle: CHART_TEXT_STYLES.title,
        subtext: '点击返回按钮查看所有机构',
        subtextStyle: CHART_TEXT_STYLES.subtitle,
      },
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const safeParams = params as EChartsParam;
          const data = params.data as { value?: number; ratio?: number } | undefined;
          const premium = valueFormatter(Number(data?.value ?? 0));
          const ratio = formatRate(Number(data?.ratio ?? 0));
          return `<div style="font-weight:bold">${safeParams.name}</div>
            <div style="margin-top:4px">${valueLabel}: <strong>${premium}</strong></div>
            <div>占比: <strong>${ratio}</strong></div>`;
        },
      },
      legend: {
        orient: 'vertical',
        left: 'left',
        top: 'middle',
        data: sortedData.map(row => row.tonnage_segment),
        textStyle: CHART_TEXT_STYLES.staticLabel,
      },
      series: [
        {
          name: '吨位分段',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['60%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 8,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            show: true,
            formatter: (params: any) => {
              const safeParams = params as EChartsParam;
              const data = params.data as { ratio?: number } | undefined;
              const ratio = formatRate(Number(data?.ratio ?? 0));
              return `${safeParams.name}\n${ratio}`;
            },
            ...CHART_TEXT_STYLES.dynamicLabel,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
            },
          },
          data: sortedData.map(row => ({
            name: row.tonnage_segment,
            value: row.premium,
            ratio: row.premium_ratio,
            itemStyle: {
              color: TONNAGE_COLORS[row.tonnage_segment] || '#8D98B3',
            },
          })),
        },
      ],
    };

    return chartOption;
  }, [data, selectedOrg, valueFormatter, valueLabel]);

  // 点击事件：下钻到吨位详情
  const onChartClick = (params: any) => {
    if (drillDownLevel === 'org' && params?.componentType === 'series') {
      const org = typeof params?.name === 'string' ? params.name : '';
      if (!org) return;
      setSelectedOrg(org);
      setDrillDownLevel('tonnage');
    }
  };

  // 返回到机构层
  const handleBack = () => {
    setDrillDownLevel('org');
    setSelectedOrg('');
  };

  if (loading) {
    return <div className={`h-96 flex items-center justify-center ${colorClasses.bg.neutral}`}>加载中...</div>;
  }

  const content = (
    <>
      {showTitle && (
        <div className="mb-4 text-center">
          <h3 className={`text-lg font-bold ${colorClasses.text.neutralBlack}`}>{title}</h3>
          {subtitle && <p className={`text-sm ${colorClasses.text.neutralMuted}`}>{subtitle}</p>}
        </div>
      )}

      {/* 返回按钮（仅在第二层显示） */}
      {drillDownLevel === 'tonnage' && (
        <div className="flex items-center mb-4">
          <button
            onClick={handleBack}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            ← 返回机构列表
          </button>
        </div>
      )}

      {drillDownLevel === 'org' && (
        <div className={`text-center text-sm ${colorClasses.text.neutralMuted} mb-2`}>
          点击柱子看机构各吨位分段占比
        </div>
      )}

      <ReactEChartsCore
        echarts={echarts}
        option={drillDownLevel === 'org' ? orgStackedOption : tonnageDetailOption}
        style={{ height: '500px', width: '100%' }}
        notMerge={true}
        onEvents={{
          click: onChartClick,
        }}
      />
    </>
  );

  if (!showContainer) {
    return <div>{content}</div>;
  }

  return <div className={cn(cardStyles.standard)}>{content}</div>;
};
