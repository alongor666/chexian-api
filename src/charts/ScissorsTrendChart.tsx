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
  ReferenceLine, // Added for selected date
} from 'recharts';
import { format, parseISO, isValid } from 'date-fns';
import { Logger } from '@/shared/utils/logger';

const logger = new Logger('ScissorsTrendChart');

interface DailyData {
  date: string; // YYYY-MM-DD
  current_ytd: number;
  last_year_ytd: number;
  // Optional fields for richer tooltip
  daily_growth?: number;
  current_day?: number;
}

interface ScissorsTrendChartProps {
  data: DailyData[];
  height?: number;
  className?: string;
  selectedDate?: string; // Added prop
}

export const ScissorsTrendChart: React.FC<ScissorsTrendChartProps> = ({
  data,
  height = 400,
  className = '',
  selectedDate,
}) => {
  // 1. Data Processing: Format dates and ensure numbers
  const chartData = useMemo(() => {
    return data.map((item) => {
      let dateLabel = item.date;
      // Handle date formatting safely
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
        // Ensure integers as requested
        current_ytd: Math.round(item.current_ytd || 0),
        last_year_ytd: Math.round(item.last_year_ytd || 0),
        gap: Math.round((item.current_ytd || 0) - (item.last_year_ytd || 0)),
      };
    });
  }, [data]);

  // Custom Tooltip to show the "Scissors" Gap
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const current = payload.find((p: any) => p.dataKey === 'current_ytd')?.value || 0;
      const lastYear = payload.find((p: any) => p.dataKey === 'last_year_ytd')?.value || 0;
      const gap = current - lastYear;
      const gapPercent = lastYear !== 0 ? ((gap / lastYear) * 100).toFixed(1) : '0.0';

      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg text-sm">
          <p className="font-bold text-gray-700 mb-2">{label}</p>
          <div className="space-y-1">
            <p className="text-blue-600 font-medium">
              当年累计: <span className="font-bold">{current.toLocaleString()}</span> 万元
            </p>
            <p className="text-gray-500">
              上年累计: {lastYear.toLocaleString()} 万元
            </p>
            <div className={`mt-2 pt-2 border-t border-gray-100 flex justify-between items-center ${gap >= 0 ? 'text-red-500' : 'text-green-600'}`}>
              <span>剪刀差 (Gap):</span>
              <span className="font-bold">
                {gap > 0 ? '+' : ''}{gap.toLocaleString()} ({gap > 0 ? '+' : ''}{gapPercent}%)
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Calculate reference line x-axis value if selectedDate is present
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
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-800">累计业绩剪刀差趋势 (YTD Trend)</h3>
        <div className="flex items-center space-x-4 text-sm">
          <div className="flex items-center">
            <span className="w-3 h-3 bg-blue-500 rounded-full mr-2"></span>
            <span className="text-gray-600">当年累计</span>
          </div>
          <div className="flex items-center">
            <span className="w-3 h-3 border-2 border-gray-400 border-dashed mr-2"></span>
            <span className="text-gray-600">上年累计</span>
          </div>
        </div>
      </div>

      <div style={{ height: height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis 
              dataKey="dateLabel" 
              tick={{ fontSize: 12, fill: '#6B7280' }} 
              tickLine={false}
              axisLine={{ stroke: '#E5E7EB' }}
              minTickGap={30}
            />
            <YAxis 
              tick={{ fontSize: 12, fill: '#6B7280' }} 
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}`}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Last Year Line (Baseline) - Dashed Gray */}
            <Line type="monotone" dataKey="last_year_ytd" stroke="#9CA3AF" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} />
            
            {/* Current Year Line - Solid Blue with Area effect for emphasis */}
            <Area type="monotone" dataKey="current_ytd" stroke="#3B82F6" strokeWidth={3} fill="url(#colorCurrent)" fillOpacity={0.1} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
            
            {selectedDateLabel && (
               <ReferenceLine x={selectedDateLabel} stroke="#EF4444" strokeDasharray="3 3" />
            )}
            
            <defs>
              <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};