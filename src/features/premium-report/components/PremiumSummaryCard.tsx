/**
 * 保费报表摘要卡片
 *
 * 显示保费报表的汇总统计信息
 */

import React from 'react';
import { cn, numericStyles, colorClasses } from '../../../shared/styles';
import { formatWanDirect, formatCount } from '../../../shared/utils/formatters';
import type { PremiumReportSummary } from '../types/premiumReport';

interface PremiumSummaryCardProps {
  /** 汇总数据 */
  summary: PremiumReportSummary;
  /** 日期范围 */
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

/**
 * 保费报表摘要卡片
 */
export const PremiumSummaryCard: React.FC<PremiumSummaryCardProps> = ({
  summary,
  dateRange,
}) => {
  return (
    <div className={`bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border ${colorClasses.border.primary}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className={`text-sm font-semibold flex items-center ${colorClasses.text.neutral}`}>
          <span className="mr-2">💰</span>
          保费报表汇总
        </h4>
        <span className={`text-xs ${colorClasses.text.neutralMuted}`}>
          {dateRange.startDate} ~ {dateRange.endDate}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* 总保费 */}
        <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
          <div className={`text-xs mb-1 ${colorClasses.text.neutralMuted}`}>总保费</div>
          <div className={cn(numericStyles.kpiPrimary, colorClasses.text.primary)}>
            {formatWanDirect(summary.totalPremium)}
          </div>
          <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>万元</div>
        </div>

        {/* 总件数 */}
        <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
          <div className={`text-xs mb-1 ${colorClasses.text.neutralMuted}`}>总件数</div>
          <div className={cn(numericStyles.kpiPrimary, colorClasses.text.indigo)}>
            {formatCount(summary.totalPolicies)}
          </div>
          <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>件</div>
        </div>

        {/* 机构数量 */}
        <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
          <div className={`text-xs mb-1 ${colorClasses.text.neutralMuted}`}>机构数</div>
          <div className={cn(numericStyles.kpiPrimary, colorClasses.text.success)}>
            {formatCount(summary.orgCount)}
          </div>
          <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>个</div>
        </div>

        {/* 业务员数量 */}
        <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
          <div className={`text-xs mb-1 ${colorClasses.text.neutralMuted}`}>业务员数</div>
          <div className={cn(numericStyles.kpiPrimary, colorClasses.text.warning)}>
            {formatCount(summary.salesmanCount)}
          </div>
          <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>人</div>
        </div>

        {/* 平均保费 */}
        <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
          <div className={`text-xs mb-1 ${colorClasses.text.neutralMuted}`}>机构平均保费</div>
          <div className={cn(numericStyles.kpiPrimary, colorClasses.text.purple)}>
            {formatWanDirect(summary.avgPremium)}
          </div>
          <div className={`text-xs mt-1 ${colorClasses.text.neutralMuted}`}>万元</div>
        </div>
      </div>
    </div>
  );
};
