/**
 * 节假日统计摘要卡片
 *
 * 显示筛选日期范围内的节假日统计信息
 */

import React from 'react';

interface HolidaySummary {
  name: string;
  days: number;
  dateRange: string;
}

interface HolidaySummaryCardProps {
  /** 节假日总天数 */
  totalDays: number;
  /** 各节日统计 */
  holidays: HolidaySummary[];
  /** 日期范围 */
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

/**
 * 节假日统计摘要卡片
 */
export const HolidaySummaryCard: React.FC<HolidaySummaryCardProps> = ({
  totalDays,
  holidays,
  dateRange,
}) => {
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center">
          <span className="mr-2">📅</span>
          节假日统计
        </h4>
        <span className="text-xs text-gray-500">
          {dateRange.startDate} ~ {dateRange.endDate}
        </span>
      </div>

      {totalDays === 0 ? (
        <div className="text-center py-4 text-gray-500">
          <p className="text-sm">所选日期范围内暂无节假日</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center bg-white rounded-lg px-3 py-2 shadow-sm">
              <span className="text-2xl font-bold text-blue-600">{totalDays}</span>
              <span className="ml-2 text-sm text-gray-500">天节假日</span>
            </div>
            <div className="flex items-center bg-white rounded-lg px-3 py-2 shadow-sm">
              <span className="text-2xl font-bold text-indigo-600">{holidays.length}</span>
              <span className="ml-2 text-sm text-gray-500">个节日</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {holidays.map((holiday, index) => (
              <div
                key={index}
                className="inline-flex items-center bg-white rounded-full px-3 py-1 text-sm shadow-sm"
              >
                <span className="font-medium text-gray-700">{holiday.name}</span>
                <span className="mx-1 text-gray-300">|</span>
                <span className="text-blue-600">{holiday.days}天</span>
                <span className="ml-2 text-xs text-gray-400">({holiday.dateRange})</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
