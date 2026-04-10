import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsOption } from 'echarts';
import { format, parseISO, isValid } from 'date-fns';
import { colors } from '@/shared/styles';
import { echarts } from '@/shared/utils/echarts';
import { GRID_CONFIG, getChartTheme } from '@/shared/config/chartStyles';
import { useTheme } from '@/shared/theme';
import { formatWanDirect, formatPercent } from '@/shared/utils/formatters';

/** HTML 转义 — 防止 ECharts innerHTML tooltip 中的 XSS */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SERIES_COLORS = {
  currentYear: colors.primary[500],     // #3B82F6
  lastYear: colors.neutral[400],        // #9CA3AF
  selectedDate: colors.danger.DEFAULT,  // #EF4444
};

const TARGET_COLORS = {
  zero: colors.neutral[400],
  five: colors.success.DEFAULT,
  ten: colors.warning.DEFAULT,
};

interface DailyData {
  date: string; // YYYY-MM-DD
  current_ytd: number;
  last_year_ytd: number;
  current_day?: number; // 当日保费值
  daily_growth?: number;
}

interface ScissorsTrendChartProps {
  data: DailyData[];
  height?: number;
  className?: string;
  selectedDate?: string;
  latestSignedDate?: string; // 外部传入的全局最新签单日
  showTargetLines?: boolean;
}

/** 解析日期字符串为 Date 对象，失败返回 null */
function safeParseDate(dateStr: string): Date | null {
  try {
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

export const ScissorsTrendChart: React.FC<ScissorsTrendChartProps> = ({
  data,
  height = 400,
  className = '',
  selectedDate,
  latestSignedDate,
  showTargetLines = true,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const theme = getChartTheme(isDark);

  // 1. Data Processing
  const chartData = useMemo(() => {
    return data.map((item) => {
      const dateObj = safeParseDate(item.date);
      const dateLabel = dateObj ? format(dateObj, 'MM-dd') : item.date;

      return {
        ...item,
        dateLabel,
        current_ytd: Math.round(item.current_ytd || 0),
        last_year_ytd: Math.round(item.last_year_ytd || 0),
        current_day: item.current_day || 0,
        gap: Math.round((item.current_ytd || 0) - (item.last_year_ytd || 0)),
      };
    });
  }, [data]);

  // Target calculation
  const targetLines = useMemo(() => {
    if (!showTargetLines || !chartData || chartData.length === 0) return null;

    const targetDataPoint = chartData[chartData.length - 1];
    const targetLastYearTotal = targetDataPoint?.last_year_ytd || 0;

    // --- 定位起始日 ---
    let latestValidDateObj: Date | null = null;
    let currentTotal = 0;

    // A. 优先使用外部传入的全局最新签单日
    if (latestSignedDate) {
      latestValidDateObj = safeParseDate(latestSignedDate);
    }

    // B. 如果外部未传入，在当前数据集中基于 current_day > 0 寻找
    if (!latestValidDateObj) {
      const latestCurrentData = [...chartData].reverse().find(d => (d.current_day || 0) > 0);
      if (latestCurrentData) {
        latestValidDateObj = safeParseDate(latestCurrentData.date);
      }
    }

    // C. 获取当前累计值
    const latestYtdData = [...chartData].reverse().find(d => d.current_ytd > 0);
    currentTotal = latestYtdData ? latestYtdData.current_ytd : (targetDataPoint?.current_ytd || 0);

    // D. 计算起始日 = 签单日 + 1天
    let startDateObj = new Date();
    if (latestValidDateObj) {
      startDateObj = new Date(latestValidDateObj);
      startDateObj.setDate(startDateObj.getDate() + 1);
    }

    // E. 目标截止日
    let targetDateObj = new Date(startDateObj.getFullYear(), 11, 31);
    if (targetDataPoint?.date) {
      const tDate = safeParseDate(targetDataPoint.date);
      if (tDate) targetDateObj = tDate;
    }

    // F. 剩余天数 → 分摊目标
    const timeDiff = targetDateObj.getTime() - startDateObj.getTime();
    const remainingDays = Math.max(1, Math.ceil(timeDiff / (1000 * 3600 * 24)));

    const target0 = Math.round((targetLastYearTotal * 1.0 - currentTotal) / remainingDays);
    const target5 = Math.round((targetLastYearTotal * 1.05 - currentTotal) / remainingDays);
    const target10 = Math.round((targetLastYearTotal * 1.10 - currentTotal) / remainingDays);

    return { target0, target5, target10, remainingDays, targetLastYearTotal, currentTotal };
  }, [chartData, showTargetLines, latestSignedDate]);

  // Selected date label for markLine
  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    const dateObj = safeParseDate(selectedDate);
    return dateObj ? format(dateObj, 'MM-dd') : null;
  }, [selectedDate]);

  // ECharts option
  const option = useMemo((): EChartsOption => {
    const dateLabels = chartData.map(d => d.dateLabel);
    const currentYtdValues = chartData.map(d => d.current_ytd);
    const lastYearYtdValues = chartData.map(d => d.last_year_ytd);

    // 当年累计 markLine：选中日期
    const currentMarkLines: any[] = [];
    if (selectedDateLabel) {
      currentMarkLines.push({
        xAxis: selectedDateLabel,
        lineStyle: { color: SERIES_COLORS.selectedDate, type: 'dashed', width: 1.5 },
        label: { show: false },
      });
    }

    const series: any[] = [
      // 上年累计（虚线）
      {
        name: '上年累计',
        type: 'line',
        yAxisIndex: 0,
        data: lastYearYtdValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, type: 'dashed', color: SERIES_COLORS.lastYear },
        itemStyle: { color: SERIES_COLORS.lastYear },
        emphasis: { itemStyle: { borderWidth: 0 }, scale: false },
      },
      // 当年累计（面积图）
      {
        name: '当年累计',
        type: 'line',
        yAxisIndex: 0,
        data: currentYtdValues,
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 3, color: SERIES_COLORS.currentYear },
        itemStyle: { color: SERIES_COLORS.currentYear },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${SERIES_COLORS.currentYear}33` },
            { offset: 1, color: `${SERIES_COLORS.currentYear}00` },
          ]),
        },
        emphasis: {
          itemStyle: { borderWidth: 0, shadowBlur: 6, shadowColor: `${SERIES_COLORS.currentYear}4D` },
          scale: false,
        },
        markLine: currentMarkLines.length > 0 ? {
          silent: true,
          symbol: 'none',
          data: currentMarkLines,
        } : undefined,
      },
    ];

    // 目标参考线系列（用 markLine 放在一个隐藏 series 上）
    const yAxisList: any[] = [
      {
        type: 'value',
        ...theme.yAxisConfig,
        axisLabel: { ...theme.yAxisConfig.axisLabel, formatter: (v: number) => `${v}` },
      },
    ];

    if (showTargetLines && targetLines) {
      yAxisList.push({
        type: 'value',
        ...theme.yAxisConfig,
        axisLabel: {
          ...theme.yAxisConfig.axisLabel,
          fontSize: 10,
          color: isDark ? 'rgba(255,255,255,0.35)' : SERIES_COLORS.lastYear,
        },
        splitLine: { show: false },
      });

      // 隐藏 series 挂载目标 markLine
      series.push({
        name: '_target',
        type: 'line',
        yAxisIndex: 1,
        data: [],
        silent: true,
        symbol: 'none',
        lineStyle: { width: 0 },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: targetLines.target0,
              lineStyle: { color: TARGET_COLORS.zero, type: 'dotted', width: 1.5 },
              label: { show: false },
            },
            {
              yAxis: targetLines.target5,
              lineStyle: { color: TARGET_COLORS.five, type: 'dashed', width: 2 },
              label: { show: false },
            },
            {
              yAxis: targetLines.target10,
              lineStyle: { color: TARGET_COLORS.ten, type: 'dashed', width: 2 },
              label: { show: false },
            },
          ],
        },
      });
    }

    return {
      grid: { ...GRID_CONFIG, top: 10, right: showTargetLines && targetLines ? '8%' : '4%', bottom: 0 },
      xAxis: {
        type: 'category',
        data: dateLabels,
        ...theme.xAxisConfig,
        axisLabel: { ...theme.xAxisConfig.axisLabel, interval: 'auto' },
        boundaryGap: false,
      },
      yAxis: yAxisList,
      tooltip: {
        ...theme.tooltipConfig,
        trigger: 'axis',
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const label = params[0].axisValue;
          const currentParam = params.find((p: any) => p.seriesName === '当年累计');
          const lastYearParam = params.find((p: any) => p.seriesName === '上年累计');
          const current = currentParam?.value ?? 0;
          const lastYear = lastYearParam?.value ?? 0;
          const gap = current - lastYear;
          const gapPct = lastYear !== 0 ? formatPercent((gap / lastYear) * 100) : '0.0%';
          const gapColor = gap >= 0 ? colors.danger.DEFAULT : colors.success.DEFAULT;

          let html = `<div style="min-width:200px">`;
          html += `<div style="font-weight:bold;margin-bottom:6px;color:${theme.textColors.primary}">${escapeHtml(String(label))}</div>`;
          html += `<div style="margin-bottom:2px;color:${SERIES_COLORS.currentYear};font-weight:500">当年累计: <b>${formatWanDirect(current)}</b> 万元</div>`;
          html += `<div style="color:${theme.textColors.tertiary}">上年累计: ${formatWanDirect(lastYear)} 万元</div>`;
          html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb'};color:${gapColor};display:flex;justify-content:space-between">`;
          html += `<span>差额及增长率:</span>`;
          html += `<b>${gap > 0 ? '+' : ''}${formatWanDirect(gap)} (${gap > 0 ? '+' : ''}${gapPct})</b>`;
          html += `</div>`;

          if (showTargetLines && targetLines) {
            html += `<div style="margin-top:8px;padding-top:6px;border-top:1px solid ${isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb'}">`;
            html += `<div style="font-size:11px;color:${theme.textColors.tertiary};margin-bottom:4px">剩余天数: ${targetLines.remainingDays}天</div>`;
            html += `<div style="font-size:11px;display:flex;justify-content:space-between;color:${TARGET_COLORS.zero}"><span>0%持平 日均需:</span><b>${formatWanDirect(targetLines.target0)} 万/天</b></div>`;
            html += `<div style="font-size:11px;display:flex;justify-content:space-between;color:${TARGET_COLORS.five}"><span>5%目标 日均需:</span><b>${formatWanDirect(targetLines.target5)} 万/天</b></div>`;
            html += `<div style="font-size:11px;display:flex;justify-content:space-between;color:${TARGET_COLORS.ten}"><span>10%目标 日均需:</span><b>${formatWanDirect(targetLines.target10)} 万/天</b></div>`;
            html += `</div>`;
          }

          html += `</div>`;
          return html;
        },
      },
      series,
    };
  }, [chartData, selectedDateLabel, showTargetLines, targetLines, theme, isDark]);

  return (
    <div className={`w-full bg-white dark:bg-neutral-800 p-4 rounded-xl shadow-sm ${className}`}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
        <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">年度业绩追赶曲线</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
          <div className="flex items-center">
            <span className="w-4 h-1 bg-primary mr-1 rounded"></span>
            <span className="text-neutral-600 dark:text-neutral-400">当年累计</span>
          </div>
          <div className="flex items-center">
            <span className="w-4 h-0 border-t-2 border-dashed mr-1" style={{ borderColor: colors.neutral[400] }}></span>
            <span className="text-neutral-600 dark:text-neutral-400">上年累计</span>
          </div>
          {showTargetLines && (
            <>
              <span className="text-neutral-400">|</span>
              <div className="flex items-center">
                <span className="w-3 h-0 border-t-[1.5px] border-dotted mr-1" style={{ borderColor: TARGET_COLORS.zero }}></span>
                <span className="text-neutral-600 dark:text-neutral-400">0%持平</span>
              </div>
              <div className="flex items-center">
                <span className="w-3 h-0 border-t-2 border-dashed mr-1" style={{ borderColor: TARGET_COLORS.five }}></span>
                <span className="text-neutral-600 dark:text-neutral-400">5%目标</span>
              </div>
              <div className="flex items-center">
                <span className="w-3 h-0 border-t-2 border-dashed mr-1" style={{ borderColor: TARGET_COLORS.ten, borderStyle: 'dashed' }}></span>
                <span className="text-neutral-600 dark:text-neutral-400">10%目标</span>
              </div>
            </>
          )}
        </div>
      </div>

      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height, minHeight: 280 }}
        notMerge
        lazyUpdate
      />
    </div>
  );
};
