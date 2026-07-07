/**
 * 赔付率分析表格
 * Claim Ratio Analysis Table
 *
 * 展示赔付率分析的详细数据：
 * - 保单件数、保费合计、赔案件数、已报告赔款
 * - 案均赔款、满期保费、满期天数
 * - 满期赔付率、满期出险率
 */

import React, { useMemo } from 'react';
import { VirtualTable, Column } from '../../../widgets/table/VirtualTable';
import type { ClaimRatioData } from '../types/costTypes';
import {
  formatCount,
  formatPremiumWan,
  formatPercent,
  formatDays,
} from '../../../shared/utils/formatters';
import { cardStyles, buttonStyles, textStyles, colorClasses } from '@/shared/styles';
import { isBranchSummaryRow } from '@/shared/utils/branchDisplay';

interface ClaimRatioTableProps {
  data: ClaimRatioData[];
  loading?: boolean;
  dimensionLabel?: string;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
}

/**
 * 转换数据为显示格式
 */
interface DisplayClaimRatioData {
  dim_key: string;
  policy_count: string;
  total_premium: string;
  total_claim_cases: string;
  total_reported_claims: string;
  avg_claim_amount: string;
  earned_premium: string;
  avg_exposure_days: string;
  earned_claim_ratio: string;
  earned_loss_frequency: string;
}

/**
 * 排序比较器：赔付率从高到低，汇总行置底。
 *
 * 对称比较（避免双汇总行时 comparator 违反反对称——原实现 isAgg(a) 命中即恒返回 1，
 * isAgg(b) 命中即恒返回 -1，两个汇总行互比时同时得到 compare(a,b)=1 与
 * compare(b,a)=1，破坏 sort 稳定性；参照 ComprehensiveMetricTable.tsx 的对称写法）。
 */
export function compareClaimRatioRows(a: ClaimRatioData, b: ClaimRatioData): number {
  const isAggA = isBranchSummaryRow(a.dim_key);
  const isAggB = isBranchSummaryRow(b.dim_key);
  if (isAggA !== isAggB) return isAggA ? 1 : -1;
  return (b.earned_claim_ratio ?? 0) - (a.earned_claim_ratio ?? 0);
}

/**
 * 转换数据为显示格式
 * 遵循全局格式化规范（见 CLAUDE.md §2.5）：
 * - 件数：整数，千分位 → formatCount
 * - 保费：万元为单位，整数 → formatPremiumWan
 * - 比率：1位小数，带% → formatPercent
 */
function transformData(data: ClaimRatioData[]): DisplayClaimRatioData[] {
  return data.map((row) => ({
    dim_key: row.dim_key || '未知',
    policy_count: formatCount(row.policy_count),
    // 保费折算为万元，整数
    total_premium: formatPremiumWan(row.total_premium ?? 0),
    total_claim_cases: formatCount(row.total_claim_cases),
    // 已报告赔款折算为万元，整数
    total_reported_claims: formatPremiumWan(row.total_reported_claims ?? 0),
    // 案均赔款取整
    avg_claim_amount: formatCount(row.avg_claim_amount ?? 0),
    // 满期保费折算为万元，整数
    earned_premium: formatPremiumWan(row.earned_premium ?? 0),
    avg_exposure_days: formatDays(row.avg_exposure_days),
    earned_claim_ratio: formatPercent(row.earned_claim_ratio),
    earned_loss_frequency: formatPercent(row.earned_loss_frequency),
  }));
}

/**
 * 赔付率分析表格组件
 */
export const ClaimRatioTable: React.FC<ClaimRatioTableProps> = ({
  data,
  loading = false,
  dimensionLabel = '维度',
  onExportCSV,
  onExportExcel,
}) => {
  // 列配置
  const columns: Column<DisplayClaimRatioData>[] = useMemo(
    () => [
      { key: 'dim_key', header: dimensionLabel, width: 150 },
      { key: 'policy_count', header: '保单件数', width: 100, align: 'right' },
      { key: 'total_premium', header: '保费(万)', width: 100, align: 'right' },
      { key: 'total_claim_cases', header: '赔案件数', width: 90, align: 'right' },
      { key: 'total_reported_claims', header: '已报告赔款(万)', width: 120, align: 'right' },
      { key: 'avg_claim_amount', header: '案均赔款', width: 100, align: 'right' },
      { key: 'earned_premium', header: '满期保费(万)', width: 110, align: 'right' },
      { key: 'avg_exposure_days', header: '平均满期天数', width: 110, align: 'right' },
      { key: 'earned_claim_ratio', header: '满期赔付率', width: 100, align: 'right' },
      { key: 'earned_loss_frequency', header: '满期出险率', width: 100, align: 'right' },
    ],
    [dimensionLabel]
  );

  // 转换数据（先排序：赔付率从高到低，汇总行置底）
  const displayData = useMemo(() => {
    const sorted = data.slice().sort(compareClaimRatioRows);
    return transformData(sorted);
  }, [data]);

  // 空状态
  if (!loading && data.length === 0) {
    return (
      <div className={`${cardStyles.base} p-8 text-center ${textStyles.caption}`}>
        暂无数据
      </div>
    );
  }

  return (
    <div className={cardStyles.base}>
      <div className={`px-4 py-3 border-b flex justify-between items-center ${colorClasses.border.neutral}`}>
        <h3 className={`text-base font-medium ${textStyles.titleSmall}`}>赔付率分析明细</h3>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${textStyles.caption}`}>共 {data.length} 条记录</span>
          {(onExportCSV || onExportExcel) && (
            <div className="flex gap-2">
              {onExportCSV && (
                <button
                  onClick={onExportCSV}
                  className={`px-3 py-1 text-sm rounded transition-colors ${buttonStyles.base} ${buttonStyles.success} ${buttonStyles.sizeSmall}`}
                  disabled={data.length === 0}
                >
                  导出CSV
                </button>
              )}
              {onExportExcel && (
                <button
                  onClick={onExportExcel}
                  className={`px-3 py-1 text-sm rounded transition-colors ${buttonStyles.base} ${buttonStyles.primary} ${buttonStyles.sizeSmall}`}
                  disabled={data.length === 0}
                >
                  导出Excel
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <VirtualTable<DisplayClaimRatioData>
        columns={columns}
        data={displayData}
        loading={loading}
        height={450}
        rowHeight={40}
      />
    </div>
  );
};

export default ClaimRatioTable;
