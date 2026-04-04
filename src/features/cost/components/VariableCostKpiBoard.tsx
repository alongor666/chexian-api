import React, { useEffect, useMemo, useState } from 'react';
import { formatCount, formatPercent, formatPremiumWan } from '../../../shared/utils/formatters';
import { cardStyles, cn, colorClasses, textStyles } from '../../../shared/styles';
import type {
  VariableCostData,
  VariableCostKpiData,
  VariableCostKpiDrillLevel,
} from '../types/costTypes';

interface VariableCostKpiBoardProps {
  data: VariableCostData[];
  loading?: boolean;
  error?: string | null;
}

function toNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function aggregateRows(key: string, rows: VariableCostData[]): VariableCostKpiData {
  const policyCount = rows.reduce((sum, row) => sum + toNumber(row.policy_count), 0);
  const totalPremium = rows.reduce((sum, row) => sum + toNumber(row.total_premium), 0);
  const earnedPremium = rows.reduce((sum, row) => sum + toNumber(row.earned_premium), 0);
  const totalReportedClaims = rows.reduce((sum, row) => sum + toNumber(row.total_reported_claims), 0);
  const totalFee = rows.reduce((sum, row) => sum + toNumber(row.total_fee), 0);

  const earnedClaimRatio = earnedPremium > 0
    ? (totalReportedClaims * 100) / earnedPremium
    : null;
  const expenseRatio = totalPremium > 0
    ? (totalFee * 100) / totalPremium
    : null;

  return {
    key,
    policy_count: policyCount,
    total_premium: totalPremium,
    earned_premium: earnedPremium,
    total_reported_claims: totalReportedClaims,
    total_fee: totalFee,
    earned_claim_ratio: earnedClaimRatio,
    expense_ratio: expenseRatio,
    variable_cost_ratio: earnedClaimRatio !== null && expenseRatio !== null
      ? earnedClaimRatio + expenseRatio
      : null,
  };
}

function buildMetricItems(item: VariableCostKpiData) {
  return [
    { label: '保单件数', value: formatCount(item.policy_count) },
    { label: '保费合计(万)', value: formatPremiumWan(item.total_premium) },
    { label: '满期保费(万)', value: formatPremiumWan(item.earned_premium) },
    { label: '已报告赔款(万)', value: formatPremiumWan(item.total_reported_claims) },
    { label: '费用金额(万)', value: formatPremiumWan(item.total_fee) },
    { label: '赔付率', value: formatPercent(item.earned_claim_ratio) },
    { label: '费用率', value: formatPercent(item.expense_ratio) },
    { label: '变动成本率', value: formatPercent(item.variable_cost_ratio) },
  ];
}

function MetricGrid({ item }: { item: VariableCostKpiData }) {
  const metrics = useMemo(() => buildMetricItems(item), [item]);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3"
        >
          <div className={textStyles.caption}>{metric.label}</div>
          <div className={cn(textStyles.numeric, 'mt-1 text-base font-semibold text-neutral-800')}>
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export const VariableCostKpiBoard: React.FC<VariableCostKpiBoardProps> = ({
  data,
  loading = false,
  error = null,
}) => {
  const [drillLevel, setDrillLevel] = useState<VariableCostKpiDrillLevel>('branch');

  const orgRows = useMemo(
    () => data.filter((row) => !!row.dim_key),
    [data]
  );

  const branchSummary = useMemo(
    () => aggregateRows('分公司整体', orgRows),
    [orgRows]
  );

  const orgSummaries = useMemo(
    () =>
      orgRows
        .map((row) => aggregateRows(row.dim_key || '未知', [row]))
        .sort((a, b) => b.total_premium - a.total_premium),
    [orgRows]
  );

  useEffect(() => {
    setDrillLevel('branch');
  }, [data]);

  if (loading && orgRows.length === 0) {
    return (
      <div className={cardStyles.standard}>
        <div className={textStyles.caption}>变动成本率KPI看板加载中...</div>
      </div>
    );
  }

  if (!loading && orgRows.length === 0) {
    return (
      <div className={cardStyles.standard}>
        <div className={textStyles.caption}>暂无KPI数据</div>
      </div>
    );
  }

  return (
    <div className={cn(cardStyles.standard, 'space-y-4')}>
      <div className="flex items-center justify-between">
        <h3 className={textStyles.titleSmall}>变动成本率KPI看板</h3>
        {drillLevel === 'org' && (
          <button
            type="button"
            className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700"
            onClick={() => setDrillLevel('branch')}
          >
            返回分公司整体
          </button>
        )}
      </div>

      {error && (
        <div className={cn('rounded-md border p-2 text-xs', colorClasses.border.warning, colorClasses.bg.warning, colorClasses.text.warning)}>
          KPI数据加载提示：{error}
        </div>
      )}

      {drillLevel === 'branch' ? (
        <button
          type="button"
          className="w-full rounded-lg border border-primary-200 bg-primary-50 p-4 text-left hover:bg-primary-100"
          onClick={() => setDrillLevel('org')}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className={cn(textStyles.titleSmall, 'text-primary-700')}>{branchSummary.key}</div>
            <div className="text-xs text-primary-600">点击下钻至三级机构</div>
          </div>
          <MetricGrid item={branchSummary} />
        </button>
      ) : (
        <div className="space-y-3">
          {orgSummaries.map((item) => (
            <div key={item.key} className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-4">
              <div className={cn(textStyles.label, 'mb-2')}>{item.key}</div>
              <MetricGrid item={item} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VariableCostKpiBoard;
