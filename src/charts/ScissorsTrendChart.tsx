import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { format, parseISO, isValid } from 'date-fns';
import { Logger } from '@/shared/utils/logger';
import { colors } from '@/shared/styles';
import { formatWanDirect, formatPercent } from '@/shared/utils/formatters';

const logger = new Logger('ScissorsTrendChart');

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
  // Optional fields for richer tooltip
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

export const ScissorsTrendChart: React.FC<ScissorsTrendChartProps> = ({
  data,
  height = 400,
  className = '',
  selectedDate,
  latestSignedDate,
  showTargetLines = true,
}) => {
  // 1. Data Processing
  const chartData = useMemo(() => {
    return data.map((item) => {
      let dateLabel = item.date;
      try {
        const dateObj = typeof item.date === 'string' ? parseISO(item.date) : new Date(item.date);
        if (isValid(dateObj)) {
          dateLabel = format(dateObj, 'MM-dd');
        }
      } catch (e) {
        logger.warn('Date parsing error:', e);
      }

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

    // Find target (last) data point's date and last year's total
    const targetDataPoint = chartData[chartData.length - 1];
    const targetLastYearTotal = targetDataPoint?.last_year_ytd || 0;

    // --- 核心逻辑修复：定位起始日 ---
    let latestValidDateObj: Date | null = null;
    let currentTotal = 0;

    // A. 优先使用外部传入的全局最新签单日
    if (latestSignedDate) {
      try {
        const d = parseISO(latestSignedDate);
        if (isValid(d)) latestValidDateObj = d;
      } catch (e) { }
    }

    // B. 如果外部未传入，或无法解析，则在当前数据集中基于 current_day > 0 寻找
    if (!latestValidDateObj) {
      const latestCurrentData = [...chartData].reverse().find(d => (d.current_day || 0) > 0);
      if (latestCurrentData) {
        try {
          latestValidDateObj = typeof latestCurrentData.date === 'string' ? parseISO(latestCurrentData.date) : new Date(latestCurrentData.date);
        } catch (e) { }
      }
    }

    // C. 获取当前累计值 (基于 current_ytd)
    const latestYtdData = [...chartData].reverse().find(d => d.current_ytd > 0);
    currentTotal = latestYtdData ? latestYtdData.current_ytd : (targetDataPoint?.current_ytd || 0);

    // D. 设定计算起始日: 如果找到了签单日，起始日 = 签单日 + 1天
    let startDateObj = new Date();
    if (latestValidDateObj && isValid(latestValidDateObj)) {
      startDateObj = new Date(latestValidDateObj);
      startDateObj.setDate(startDateObj.getDate() + 1);
    } else {
      // 没有任何签单数据时的降级逻辑
      startDateObj = new Date();
    }

    // E. 设定目标截止日 (基于数据序列终点)
    let targetDateObj = new Date(startDateObj.getFullYear(), 11, 31);
    try {
      if (targetDataPoint?.date) {
        const tDate = typeof targetDataPoint.date === 'string' ? parseISO(targetDataPoint.date) : new Date(targetDataPoint.date);
        if (isValid(tDate)) targetDateObj = tDate;
      }
    } catch (e) { }

    // F. 计算剩余天数并分摊目标
    const timeDiff = targetDateObj.getTime() - startDateObj.getTime();
    let remainingDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
    remainingDays = Math.max(1, remainingDays);

    const target0 = Math.round((targetLastYearTotal * 1.0 - currentTotal) / remainingDays);
    const target5 = Math.round((targetLastYearTotal * 1.05 - currentTotal) / remainingDays);
    const target10 = Math.round((targetLastYearTotal * 1.10 - currentTotal) / remainingDays);

    const minY = Math.min(target0, target5, target10, 0);
    const maxY = Math.max(target0, target5, target10);
    const padding = Math.max(10, (maxY - minY) * 0.1);

    return {
      target0, target5, target10,
      remainingDays,
      targetLastYearTotal, currentTotal,
      minY: Math.floor(minY - padding),
      maxY: Math.ceil(maxY + padding * 1.5)
    };
  }, [chartData, showTargetLines, latestSignedDate]);

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const current = payload.find((p: any) => p.dataKey === 'current_ytd')?.value || 0;
      const lastYear = payload.find((p: any) => p.dataKey === 'last_year_ytd')?.value || 0;
      const gap = current - lastYear;
      const gapPercent = lastYear !== 0 ? formatPercent((gap / lastYear) * 100) : '0.0%';

      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg text-sm min-w-[200px]">
          <p className="font-bold text-gray-700 mb-2">{label}</p>
          <div className="space-y-1">
            <p className="text-blue-600 font-medium">
              当年累计: <span className="font-bold">{formatWanDirect(current)}</span> 万元
            </p>
            <p className="text-gray-500">
              上年累计: {formatWanDirect(lastYear)} 万元
            </p>
            <div className={`mt-2 pt-2 border-t border-gray-100 flex justify-between items-center ${gap >= 0 ? 'text-red-500' : 'text-green-600'}`}>
              <span>差额及增长率:</span>
              <span className="font-bold">
                {gap > 0 ? '+' : ''}{formatWanDirect(gap)} ({gap > 0 ? '+' : ''}{gapPercent})
              </span>
            </div>

            {showTargetLines && targetLines && (
              <div className="mt-3 pt-2 border-t border-gray-200">
                <p className="text-xs text-gray-400 mb-1">剩余天数: {targetLines.remainingDays}天</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between" style={{ color: TARGET_COLORS.zero }}>
                    <span>0%持平 日均需:</span>
                    <span className="font-bold">{formatWanDirect(targetLines.target0)} 万/天</span>
                  </div>
                  <div className="flex justify-between" style={{ color: TARGET_COLORS.five }}>
                    <span>5%目标 日均需:</span>
                    <span className="font-bold">{formatWanDirect(targetLines.target5)} 万/天</span>
                  </div>
                  <div className="flex justify-between" style={{ color: TARGET_COLORS.ten }}>
                    <span>10%目标 日均需:</span>
                    <span className="font-bold">{formatWanDirect(targetLines.target10)} 万/天</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    try {
      const dateObj = typeof selectedDate === 'string' ? parseISO(selectedDate) : new Date(selectedDate);
      if (isValid(dateObj)) {
        return format(dateObj, 'MM-dd');
      }
    } catch (e) {
      return null;
    }
    return null;
  }, [selectedDate]);

  return (
    <div className={`w-full bg-white p-4 rounded-xl shadow-sm ${className}`}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
        <h3 className="text-lg font-bold text-gray-800">年度业绩追赶曲线</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
          <div className="flex items-center">
            <span className="w-4 h-1 bg-blue-500 mr-1 rounded"></span>
            <span className="text-gray-600">当年累计</span>
          </div>
          <div className="flex items-center">
            <span className="w-4 h-0 border-t-2 border-gray-400 border-dashed mr-1"></span>
            <span className="text-gray-600">上年累计</span>
          </div>
          {showTargetLines && (
            <>
              <span className="text-gray-300">|</span>
              <div className="flex items-center">
                <span className="w-3 h-0 border-t-[1.5px] border-dotted mr-1" style={{ borderColor: TARGET_COLORS.zero }}></span>
                <span className="text-gray-600">0%持平</span>
              </div>
              <div className="flex items-center">
                <span className="w-3 h-0 border-t-2 border-dashed mr-1" style={{ borderColor: TARGET_COLORS.five }}></span>
                <span className="text-gray-600">5%目标</span>
              </div>
              <div className="flex items-center">
                <span className="w-3 h-0 border-t-2 border-dashed mr-1" style={{ borderColor: TARGET_COLORS.ten, borderStyle: 'dashed' }}></span>
                <span className="text-gray-600">10%目标</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ height, minHeight: 280 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickLine={false}
              axisLine={{ stroke: '#E5E7EB' }}
              minTickGap={30}
            />

            <YAxis
              yAxisId="left"
              tick={{ fontSize: 12, fill: '#6B7280' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
            />

            {showTargetLines && targetLines && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                domain={[targetLines.minY, targetLines.maxY]}
                tickFormatter={(value) => `${value}`}
              />
            )}

            <Tooltip content={<CustomTooltip />} />

            {/* Dummy line to force Recharts to render the right YAxis */}
            {showTargetLines && targetLines && (
              <Line yAxisId="right" dataKey="dummy_for_right_axis" stroke="none" isAnimationActive={false} dot={false} activeDot={false} />
            )}

            <Line yAxisId="left" type="monotone" dataKey="last_year_ytd" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} />

            <Area yAxisId="left" type="monotone" dataKey="current_ytd" stroke="#3B82F6" strokeWidth={3} fill="url(#colorCurrent)" fillOpacity={0.1} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />

            {selectedDateLabel && (
              <ReferenceLine yAxisId="left" x={selectedDateLabel} stroke="#EF4444" strokeDasharray="3 3" />
            )}

            {showTargetLines && targetLines && (
              <>
                <ReferenceLine yAxisId="right" y={targetLines.target0} stroke={TARGET_COLORS.zero} strokeDasharray="3 3" strokeWidth={1.5} />
                <ReferenceLine yAxisId="right" y={targetLines.target5} stroke={TARGET_COLORS.five} strokeDasharray="5 5" strokeWidth={2} />
                <ReferenceLine yAxisId="right" y={targetLines.target10} stroke={TARGET_COLORS.ten} strokeDasharray="10 5" strokeWidth={2} />
              </>
            )}

            <defs>
              <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
