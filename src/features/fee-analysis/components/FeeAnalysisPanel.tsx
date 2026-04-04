/**
 * 费用分析主面板
 * 数据范围：成都同城 | 非营业个人客车 | 非新能源 | 非电销
 * 规则版本：2026-02-25 起
 */

import React, { useEffect, useState } from 'react';
import { cardStyles, colorClasses, fontStyles } from '@/shared/styles';
import { formatCount, formatPremiumWan, formatPercent } from '@/shared/utils/formatters';
import { useFeeAnalysis } from '../hooks/useFeeAnalysis';
import { CAT_NON_COMMERCIAL_PERSONAL } from '@/shared/config/customer-categories';
import { FeeRuleTierTable } from './FeeRuleTierTable';
import { FeeDistributionChart } from './FeeDistributionChart';
import type { FeeInsuranceTypeTab } from '../types/feeAnalysisTypes';

interface Props {
  filters: Record<string, any>;
}

const TAB_OPTIONS: { key: FeeInsuranceTypeTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'cti', label: '交强险' },
  { key: 'com', label: '商业险' },
];

export const FeeAnalysisPanel: React.FC<Props> = ({ filters }) => {
  const { data, summary, loading, error, fetchFeeAnalysis } = useFeeAnalysis();
  const [activeTab, setActiveTab] = useState<FeeInsuranceTypeTab>('all');

  useEffect(() => {
    fetchFeeAnalysis(filters);
  }, [fetchFeeAnalysis, filters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-sm text-neutral-400">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className={`text-sm ${colorClasses.text.danger}`}>{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 数据范围说明条 */}
      <div className="px-4 py-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-400 flex flex-wrap gap-x-4 gap-y-1">
        <span>📍 适用范围：成都同城机构（武侯/天府/新都/青羊/高新）</span>
        <span>·</span>
        <span>{CAT_NON_COMMERCIAL_PERSONAL}</span>
        <span>·</span>
        <span>非新能源</span>
        <span>·</span>
        <span>非电销渠道</span>
        <span>·</span>
        <span>规则版本 2026-02-25 起</span>
        {summary && summary.out_of_scope_count > 0 && (
          <>
            <span>·</span>
            <span className={colorClasses.text.warning}>
              规则外 {formatCount(summary.out_of_scope_count)} 件（{formatPremiumWan(summary.out_of_scope_premium)}万）
            </span>
          </>
        )}
      </div>

      {/* KPI 卡片行 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={cardStyles.base}>
            <div className="text-xs text-neutral-500 mb-1">规则内件数</div>
            <div className={fontStyles.kpi}>{formatCount(summary.total_policy_count - summary.out_of_scope_count)}</div>
          </div>
          <div className={cardStyles.base}>
            <div className="text-xs text-neutral-500 mb-1">规则内保费</div>
            <div className={fontStyles.kpi}>{formatPremiumWan(summary.matched_premium)}万</div>
          </div>
          <div className={cardStyles.base}>
            <div className="text-xs text-neutral-500 mb-1">预计费用合计</div>
            <div className={`${fontStyles.kpi} ${colorClasses.text.danger}`}>
              {formatPremiumWan(summary.total_expected_fee)}万
            </div>
          </div>
          <div className={cardStyles.base}>
            <div className="text-xs text-neutral-500 mb-1">加权平均费率</div>
            <div className={fontStyles.kpi}>{formatPercent(summary.weighted_avg_fee_rate)}</div>
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-700">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 表格 + 图表 */}
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-neutral-400">
          签单日期 2026-02-25 起暂无符合条件的数据
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className={cardStyles.base}>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-3">
              费率分档明细
            </h3>
            <FeeRuleTierTable data={data} activeTab={activeTab} />
          </div>
          <div className={cardStyles.base}>
            <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 mb-3">
              保费分布（按规则档位）
            </h3>
            <FeeDistributionChart data={data} activeTab={activeTab} />
          </div>
        </div>
      )}
    </div>
  );
};
