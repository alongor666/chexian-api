import { memo } from 'react';
import { EnhancedKpiCard, type EnhancedKpiCardProps } from '../../../widgets/kpi/EnhancedKpiCard';
import { formatCount, formatPremiumWan, formatRate } from '../../../shared/utils/formatters';
import type { KpiData } from '../hooks/useKpiData';
import {
  DEFAULT_KPI_ORDER,
  KPI_CARD_META,
  type KpiCardId,
} from '../dashboardLayoutConfig';

// ==================== 类型和函数（原 shared/sql/kpi-detail 导出） ====================

export interface KpiDetailResult {
  total_premium: number | bigint;
  policy_count: number | bigint;
  per_capita_premium: number | bigint;
  transfer_count: number | bigint;
  non_transfer_count: number | bigint;
  telesales_count: number | bigint;
  non_telesales_count: number | bigint;
  renewal_count: number | bigint;
  non_renewal_count: number | bigint;
  commercial_premium: number | bigint;
  non_commercial_premium: number | bigint;
  nev_count: number | bigint;
  non_nev_count: number | bigint;
  new_car_count: number | bigint;
  non_new_car_count: number | bigint;
}

const calculateRate = (part: number, total: number): number => {
  if (total === 0 || total === null || total === undefined) {
    return 0;
  }
  return part / total;
};

const extractDonutData = (
  kpiDetail: KpiDetailResult,
  type: 'transfer' | 'telesales' | 'renewal' | 'commercial' | 'nev' | 'new_car'
): Array<{ label: string; value: number }> => {
  const toBigNumber = (value: number | bigint): number =>
    typeof value === 'bigint' ? Number(value) : value;

  switch (type) {
    case 'transfer':
      return [
        { label: '过户', value: toBigNumber(kpiDetail.transfer_count || 0) },
        { label: '非过户', value: toBigNumber(kpiDetail.non_transfer_count || 0) },
      ];
    case 'telesales':
      return [
        { label: '电销', value: toBigNumber(kpiDetail.telesales_count || 0) },
        { label: '非电销', value: toBigNumber(kpiDetail.non_telesales_count || 0) },
      ];
    case 'renewal':
      return [
        { label: '续保', value: toBigNumber(kpiDetail.renewal_count || 0) },
        { label: '非续保', value: toBigNumber(kpiDetail.non_renewal_count || 0) },
      ];
    case 'commercial':
      return [
        { label: '商业险', value: toBigNumber(kpiDetail.commercial_premium || 0) },
        { label: '非商业险', value: toBigNumber(kpiDetail.non_commercial_premium || 0) },
      ];
    case 'nev':
      return [
        { label: '新能源', value: toBigNumber(kpiDetail.nev_count || 0) },
        { label: '非新能源', value: toBigNumber(kpiDetail.non_nev_count || 0) },
      ];
    case 'new_car':
      return [
        { label: '新车', value: toBigNumber(kpiDetail.new_car_count || 0) },
        { label: '非新车', value: toBigNumber(kpiDetail.non_new_car_count || 0) },
      ];
    default:
      return [];
  }
};

const toNumber = (value: number | bigint | null | undefined): number => {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return Number(value ?? 0);
};

interface KpiSectionProps {
  kpis: KpiData;
  kpiDetails: KpiDetailResult | null;
  loading: boolean;
  visibleKpis?: KpiCardId[];
}

/**
 * KPI 指标卡片区域组件
 *
 * 显示：
 * - 数值类 KPI（总保费、保单件数、人均保费）
 * - 核心占比类 KPI（非过户占比、续保占比、商业险占比）
 * - 其他占比类 KPI（电销占比、新能源占比、新车占比）
 */
export const KpiSection = memo<KpiSectionProps>(({ kpis, kpiDetails, loading, visibleKpis }) => {
  const labelMap = KPI_CARD_META.reduce((acc, item) => {
    acc[item.id] = item.label;
    return acc;
  }, {} as Record<KpiCardId, string>);

  const buildCardProps = (id: KpiCardId): EnhancedKpiCardProps | null => {
    const title = labelMap[id] || id;
    switch (id) {
      case 'total_premium':
        return { title, value: kpis.total_premium, formatter: formatPremiumWan, loading, type: 'value' };
      case 'policy_count':
        return { title, value: kpis.policy_count, formatter: formatCount, loading, type: 'value' };
      case 'per_capita_premium':
        return { title, value: kpis.per_capita_premium, formatter: formatPremiumWan, loading, type: 'value' };
      case 'non_transfer_rate':
        return {
          title,
          value: kpiDetails
            ? calculateRate(
                toNumber(kpiDetails.non_transfer_count),
                toNumber(kpiDetails.non_transfer_count) + toNumber(kpiDetails.transfer_count)
              )
            : undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails
            ? [
                { label: '非过户', value: kpiDetails.non_transfer_count || 0 },
                { label: '过户', value: kpiDetails.transfer_count || 0 },
              ]
            : [],
        };
      case 'renewal_rate':
        return {
          title,
          value: kpis.renewal_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'renewal') : [],
        };
      case 'commercial_rate':
        return {
          title,
          value: kpis.commercial_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'commercial') : [],
        };
      case 'telesales_rate':
        return {
          title,
          value: kpis.telesales_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'telesales') : [],
        };
      case 'nev_rate':
        return {
          title,
          value: kpis.nev_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'nev') : [],
        };
      case 'new_car_rate':
        return {
          title,
          value: kpis.new_car_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'new_car') : [],
        };
      default:
        return null;
    }
  };

  const effectiveOrder = visibleKpis ? visibleKpis : DEFAULT_KPI_ORDER;
  const cardEntries = effectiveOrder
    .map((id) => {
      const props = buildCardProps(id);
      if (!props) return null;
      return { id, props };
    })
    .filter((item): item is { id: KpiCardId; props: EnhancedKpiCardProps } => Boolean(item));

  if (visibleKpis && visibleKpis.length === 0) {
    return (
      <div className="bg-white p-6 rounded shadow text-center text-gray-500">
        未选择KPI指标
      </div>
    );
  }

  if (cardEntries.length === 0) {
    return (
      <div className="bg-white p-6 rounded shadow text-center text-gray-500">
        暂无可用KPI指标
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cardEntries.map((entry) => (
        <EnhancedKpiCard key={entry.id} {...entry.props} />
      ))}
    </div>
  );
});
