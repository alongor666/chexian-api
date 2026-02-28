import { memo, useMemo, useState } from 'react';
import { EnhancedKpiCard, type EnhancedKpiCardProps } from '../../../widgets/kpi/EnhancedKpiCard';
import {
  formatAchievementRate,
  formatCount,
  formatPremiumWan,
  formatRate,
} from '../../../shared/utils/formatters';
import type { KpiData } from '../hooks/useKpiData';
import {
  DEFAULT_KPI_ORDER,
  KPI_CARD_META,
  type KpiGroup,
  type KpiCardId,
} from '../dashboardLayoutConfig';
import { cardStyles, cn } from '../../../shared/styles';

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
  // 新增字段
  quality_business_count?: number | bigint;
  non_quality_business_count?: number | bigint;
  coverage_danjiao_count?: number | bigint;
  coverage_jiaosan_count?: number | bigint;
  coverage_zhuquan_count?: number | bigint;
  coverage_other_count?: number | bigint;
  vehicle_truck_count?: number | bigint;
  vehicle_bus_count?: number | bigint;
  vehicle_motorcycle_count?: number | bigint;
  vehicle_other_count?: number | bigint;
  same_city_count?: number | bigint;
  remote_count?: number | bigint;
}

const calculateRate = (part: number, total: number): number => {
  if (total === 0 || total === null || total === undefined) {
    return 0;
  }
  return part / total;
};

const extractDonutData = (
  kpiDetail: KpiDetailResult,
  type: 'transfer' | 'telesales' | 'renewal' | 'commercial' | 'nev' | 'new_car' | 'quality_business' | 'coverage_mix' | 'vehicle_type' | 'region'
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
    case 'quality_business':
      return [
        { label: '优质(A/B)', value: toBigNumber(kpiDetail.quality_business_count || 0) },
        { label: '其他', value: toBigNumber(kpiDetail.non_quality_business_count || 0) },
      ];
    case 'coverage_mix':
      return [
        { label: '单交', value: toBigNumber(kpiDetail.coverage_danjiao_count || 0) },
        { label: '交三', value: toBigNumber(kpiDetail.coverage_jiaosan_count || 0) },
        { label: '主全', value: toBigNumber(kpiDetail.coverage_zhuquan_count || 0) },
        { label: '其他', value: toBigNumber(kpiDetail.coverage_other_count || 0) },
      ];
    case 'vehicle_type':
      return [
        { label: '货车', value: toBigNumber(kpiDetail.vehicle_truck_count || 0) },
        { label: '客车', value: toBigNumber(kpiDetail.vehicle_bus_count || 0) },
        { label: '摩托车', value: toBigNumber(kpiDetail.vehicle_motorcycle_count || 0) },
        { label: '其他', value: toBigNumber(kpiDetail.vehicle_other_count || 0) },
      ];
    case 'region':
      return [
        { label: '同城', value: toBigNumber(kpiDetail.same_city_count || 0) },
        { label: '异地', value: toBigNumber(kpiDetail.remote_count || 0) },
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
  visibleKpisByGroup?: Record<KpiGroup, KpiCardId[]>;
}

/**
 * KPI 指标卡片区域组件
 *
 * 显示：
 * - 数值类 KPI（总保费、保单件数、人均保费）
 * - 核心占比类 KPI（非过户占比、续保占比、商业险占比）
 * - 其他占比类 KPI（电销占比、新能源占比、新车占比）
 */
export const KpiSection = memo<KpiSectionProps>(({
  kpis,
  kpiDetails,
  loading,
  visibleKpisByGroup,
}) => {
  const [activeGroup, setActiveGroup] = useState<KpiGroup>('core');

  const groupLabel: Record<KpiGroup, string> = {
    core: '核心指标',
    focus: '关注指标',
  };

  const labelMap = KPI_CARD_META.reduce((acc, item) => {
    acc[item.id] = item.label;
    return acc;
  }, {} as Record<KpiCardId, string>);

  const buildCardProps = (id: KpiCardId): EnhancedKpiCardProps | null => {
    const title = labelMap[id] || id;
    switch (id) {
      case 'vehicle_premium':
        return { title, value: kpis.vehicle_premium, formatter: formatPremiumWan, loading, type: 'value' };
      case 'vehicle_achievement_rate':
        return {
          title,
          value: kpis.vehicle_achievement_rate,
          formatter: formatAchievementRate,
          loading,
          type: 'value',
        };
      case 'vehicle_growth_rate':
        return {
          title,
          value: kpis.vehicle_growth_rate,
          formatter: formatAchievementRate,
          loading,
          type: 'value',
        };
      case 'variable_cost_rate':
        return {
          title,
          value: kpis.variable_cost_rate,
          formatter: formatAchievementRate,
          loading,
          type: 'value',
        };
      case 'bundle_renewal_rate':
        return {
          title,
          value: kpis.bundle_renewal_rate,
          formatter: (value) => formatAchievementRate(value, 2),
          loading,
          type: 'value',
        };
      case 'driver_premium':
        return { title, value: kpis.driver_premium, formatter: formatPremiumWan, loading, type: 'value' };
      case 'driver_achievement_rate':
        return {
          title,
          value: kpis.driver_achievement_rate,
          formatter: formatAchievementRate,
          loading,
          type: 'value',
        };
      case 'driver_growth_rate':
        return {
          title,
          value: kpis.driver_growth_rate,
          formatter: formatAchievementRate,
          loading,
          type: 'value',
        };
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
      // 新增：优质业务占比（核心指标）
      case 'quality_business_rate':
        return {
          title,
          value: kpiDetails
            ? calculateRate(
              toNumber(kpiDetails.quality_business_count),
              toNumber(kpiDetails.quality_business_count) + toNumber(kpiDetails.non_quality_business_count)
            )
            : undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'quality_business') : [],
        };
      // 新增：单交/交三/主全占比
      case 'coverage_mix_rate':
        return {
          title,
          value: kpiDetails
            ? calculateRate(
              toNumber(kpiDetails.coverage_danjiao_count) + toNumber(kpiDetails.coverage_jiaosan_count) + toNumber(kpiDetails.coverage_zhuquan_count),
              toNumber(kpiDetails.coverage_danjiao_count) + toNumber(kpiDetails.coverage_jiaosan_count) + toNumber(kpiDetails.coverage_zhuquan_count) + toNumber(kpiDetails.coverage_other_count)
            )
            : undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'coverage_mix') : [],
        };
      // 新增：货车/客车/摩托车占比
      case 'vehicle_type_rate':
        return {
          title,
          value: kpiDetails
            ? calculateRate(
              toNumber(kpiDetails.vehicle_truck_count) + toNumber(kpiDetails.vehicle_bus_count) + toNumber(kpiDetails.vehicle_motorcycle_count),
              toNumber(kpiDetails.vehicle_truck_count) + toNumber(kpiDetails.vehicle_bus_count) + toNumber(kpiDetails.vehicle_motorcycle_count) + toNumber(kpiDetails.vehicle_other_count)
            )
            : undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'vehicle_type') : [],
        };
      // 新增：同城/异地占比
      case 'region_rate':
        return {
          title,
          value: kpiDetails
            ? calculateRate(
              toNumber(kpiDetails.same_city_count),
              toNumber(kpiDetails.same_city_count) + toNumber(kpiDetails.remote_count)
            )
            : undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'region') : [],
        };
      default:
        return null;
    }
  };

  const effectiveOrder = useMemo(() => {
    if (visibleKpisByGroup) {
      return visibleKpisByGroup[activeGroup] ?? [];
    }
    return DEFAULT_KPI_ORDER[activeGroup];
  }, [activeGroup, visibleKpisByGroup]);

  const cardEntries = effectiveOrder
    .map((id) => {
      const props = buildCardProps(id);
      if (!props) return null;
      return { id, props };
    })
    .filter((item): item is { id: KpiCardId; props: EnhancedKpiCardProps } => Boolean(item));

  if (cardEntries.length === 0 && !loading) {
    return (
      <div className={cn(cardStyles.standard, "space-y-4")}>
        <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
          {(['core', 'focus'] as KpiGroup[]).map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => setActiveGroup(group)}
              className={`px-3 py-1.5 text-sm rounded ${activeGroup === group
                  ? 'bg-primary text-white'
                  : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                }`}
            >
              {groupLabel[group]}
            </button>
          ))}
        </div>
        <div className="p-2 text-center text-gray-500">暂无可用KPI指标</div>
      </div>
    );
  }

  return (
    <div className={cn(cardStyles.standard, "space-y-4")}>
      <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
        {(['core', 'focus'] as KpiGroup[]).map((group) => (
          <button
            key={group}
            type="button"
            onClick={() => setActiveGroup(group)}
            className={`px-3 py-1.5 text-sm rounded ${activeGroup === group
                ? 'bg-primary text-white'
                : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
              }`}
          >
            {groupLabel[group]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cardEntries.map((entry) => (
          <EnhancedKpiCard key={entry.id} {...entry.props} />
        ))}
      </div>
    </div>
  );
});
