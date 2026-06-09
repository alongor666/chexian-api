/**
 * KPI 单卡 props 构造 — 从 KpiSection 组件抽出的纯函数层
 *
 * 职责：把 (KpiCardId + 运行时数据) 映射成 EnhancedKpiCardProps。
 * 与渲染解耦 → 可独立单测（见 __tests__/kpiCardProps.test.ts）。
 *
 * ⚠️ 行为契约：本模块只做数据→props 映射，不得引入任何渲染/副作用；
 *    任何改动须保证 kpiCardProps.test.ts 全绿（映射逐项锁定）。
 */
import type { EnhancedKpiCardProps } from '../../../widgets/kpi/EnhancedKpiCard';
import {
  formatAchievementRate,
  formatCount,
  formatPremiumWan,
  formatRate,
  formatWanDirect,
} from '../../../shared/utils/formatters';
import type { KpiData } from '../hooks/useKpiData';
import type { KpiDetailResult } from '../../../shared/types/kpi';
import { KPI_CARD_META, type KpiCardId } from '../dashboardLayoutConfig';
import { comprehensiveTheme } from '../../../shared/styles';
import { statusFor } from '../utils/kpiStatus';

/** 卡片 id→标签映射，派生自静态 KPI_CARD_META，模块级常量（避免每次渲染 reduce） */
const KPI_LABEL_MAP = KPI_CARD_META.reduce((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {} as Record<KpiCardId, string>);

/* ---------- 数据辅助：环形/段值提取 ---------- */

const calculateRate = (part: number, total: number): number => {
  if (total === 0 || total === null || total === undefined) return 0;
  return part / total;
};

const toNumber = (value: number | bigint | null | undefined): number => {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
};

const extractDonutData = (
  kpiDetail: KpiDetailResult,
  type:
    | 'transfer'
    | 'telesales'
    | 'renewal'
    | 'commercial'
    | 'nev'
    | 'new_car'
    | 'quality_business'
    | 'coverage_mix'
    | 'vehicle_type'
    | 'region'
): Array<{ label: string; value: number }> => {
  const toBig = (v: number | bigint): number => (typeof v === 'bigint' ? Number(v) : v);
  switch (type) {
    case 'transfer':
      return [
        { label: '过户', value: toBig(kpiDetail.transfer_count || 0) },
        { label: '非过户', value: toBig(kpiDetail.non_transfer_count || 0) },
      ];
    case 'telesales':
      return [
        { label: '电销', value: toBig(kpiDetail.telesales_count || 0) },
        { label: '非电销', value: toBig(kpiDetail.non_telesales_count || 0) },
      ];
    case 'renewal':
      return [
        { label: '续保', value: toBig(kpiDetail.renewal_count || 0) },
        { label: '非续保', value: toBig(kpiDetail.non_renewal_count || 0) },
      ];
    case 'commercial':
      return [
        { label: '商业险', value: toBig(kpiDetail.commercial_premium || 0) },
        { label: '非商业险', value: toBig(kpiDetail.non_commercial_premium || 0) },
      ];
    case 'nev':
      return [
        { label: '新能源', value: toBig(kpiDetail.nev_count || 0) },
        { label: '非新能源', value: toBig(kpiDetail.non_nev_count || 0) },
      ];
    case 'new_car':
      return [
        { label: '新车', value: toBig(kpiDetail.new_car_count || 0) },
        { label: '非新车', value: toBig(kpiDetail.non_new_car_count || 0) },
      ];
    case 'quality_business':
      return [
        { label: '优质', value: toBig(kpiDetail.quality_business_count || 0) },
        { label: '其他', value: toBig(kpiDetail.non_quality_business_count || 0) },
      ];
    case 'coverage_mix':
      return [
        { label: '单交', value: toBig(kpiDetail.coverage_danjiao_count || 0) },
        { label: '交三', value: toBig(kpiDetail.coverage_jiaosan_count || 0) },
        { label: '主全', value: toBig(kpiDetail.coverage_zhuquan_count || 0) },
      ];
    case 'vehicle_type':
      return [
        { label: '货车', value: toBig(kpiDetail.vehicle_truck_count || 0) },
        { label: '客车', value: toBig(kpiDetail.vehicle_bus_count || 0) },
        { label: '摩托', value: toBig(kpiDetail.vehicle_motorcycle_count || 0) },
      ];
    case 'region':
      return [
        { label: '同城', value: toBig(kpiDetail.same_city_premium || 0) },
        { label: '异地', value: toBig(kpiDetail.remote_premium || 0) },
      ];
    default:
      return [];
  }
};

const T = comprehensiveTheme.threshold;

/** 给一个 0~1 / 0~100 自动判断并归一到百分数 */
const toPercent = (v: number | null | undefined): number | null => {
  if (v == null || Number.isNaN(v)) return null;
  return v <= 1.5 ? v * 100 : v;
};

/** buildKpiCardProps 运行时上下文（由 KpiSection 注入） */
export interface KpiCardBuildContext {
  kpis: KpiData;
  kpiDetails: KpiDetailResult | null;
  loading: boolean;
}

/** 标准占比条卡（formatRate + 占比环）— 收敛 7 张同构占比卡的重复构造 */
function donutBarCard(
  title: string,
  value: number | undefined,
  loading: boolean,
  kpiDetails: KpiDetailResult | null,
  donut: Parameters<typeof extractDonutData>[1]
): EnhancedKpiCardProps {
  return {
    title,
    value,
    formatter: formatRate,
    loading,
    type: 'bar',
    variant: 'standard',
    ratioData: kpiDetails ? extractDonutData(kpiDetails, donut) : [],
  };
}

/** 构造单卡 props — Hero 三张携带参照系 + 状态；其它走标准变体（Hero 归属由 HERO_KPI_IDS + visibleHero 分组决定） */
export function buildKpiCardProps(
  id: KpiCardId,
  { kpis, kpiDetails, loading }: KpiCardBuildContext
): EnhancedKpiCardProps | null {
  const title = KPI_LABEL_MAP[id] || id;

  switch (id) {
    /* -------- Hero #1：车险保费（数值型，progress bar） -------- */
    case 'vehicle_premium': {
      const value = toNumber(kpis.vehicle_premium);
      const plan = toNumber(kpis.vehicle_plan_wan ?? null);
      const ratePct =
        typeof kpis.vehicle_achievement_rate === 'number'
          ? toPercent(kpis.vehicle_achievement_rate) ?? 0
          : plan
          ? (value / plan) * 100
          : 0;
      const status = statusFor({ value: ratePct, threshold: T.premiumProgressWarn });
      return {
        title,
        value,
        unit: '万元',
        formatter: formatPremiumWan,
        loading,
        type: 'value',
        variant: 'hero',
        progress: {
          value: ratePct,
          threshold: T.premiumProgressWarn,
          note: plan ? `目标 ${formatWanDirect(plan)} 万元` : undefined,
        },
        status,
      };
    }

    /* -------- Hero #2：车险达成率（ring） -------- */
    case 'vehicle_achievement_rate': {
      const pct = toPercent(kpis.vehicle_achievement_rate) ?? 0;
      const status = statusFor({ value: pct, threshold: T.premiumProgressWarn });
      const gap = T.premiumProgressWarn - pct;
      return {
        title,
        value: pct,
        unit: '%',
        formatter: (v) => v.toFixed(1),
        loading,
        type: 'value',
        variant: 'hero',
        ring: { value: pct, threshold: T.premiumProgressWarn },
        status,
        note:
          gap > 0
            ? `阈值 ${T.premiumProgressWarn}% · 落后 ${gap.toFixed(1)}pt`
            : `阈值 ${T.premiumProgressWarn}% · 已达成`,
      };
    }

    /* -------- Hero #3：变动成本率（segments：满期赔付率 + 费用率） -------- */
    case 'variable_cost_ratio': {
      const value = toPercent(kpis.variable_cost_ratio) ?? 0;
      const earnedClaimRatio = toPercent(kpis.earned_claim_ratio);
      const expenseRatio = toPercent(kpis.expense_ratio);
      const status = statusFor({
        value,
        threshold: T.costRateWarn,
        reverse: true,
      });
      // 满期赔付率 + 费用率 = 变动成本率（后端 /api/query/kpi 同源拆分，注册表口径）。
      // 分项缺失时回退为合计单段，不再用 ×0.69 假估算（BACKLOG 40f3ff）。
      const segments =
        earnedClaimRatio !== null && expenseRatio !== null
          ? [
              { label: '满期赔付率', value: earnedClaimRatio, tone: 'primary' as const },
              { label: '费用率', value: expenseRatio, tone: 'warning' as const },
            ]
          : [{ label: '变动成本率', value, tone: 'primary' as const }];
      return {
        title,
        value,
        unit: '%',
        formatter: (v) => v.toFixed(1),
        loading,
        type: 'bar',
        variant: 'hero',
        segments,
        segmentsThreshold: T.costRateWarn,
        status,
        note: `阈值 ${T.costRateWarn}% · ${status.label || '—'}`,
      };
    }

    /* -------- Core (6) -------- */
    case 'vehicle_growth_rate':
      return {
        title,
        value: kpis.vehicle_growth_rate,
        formatter: formatAchievementRate,
        loading,
        type: 'value',
        variant: 'standard',
        deltaMoM:
          typeof kpis.vehicle_growth_rate === 'number'
            ? { value: kpis.vehicle_growth_rate, unit: 'pt', label: '环比' }
            : undefined,
      };
    case 'bundle_renewal_rate':
      return {
        title,
        value: kpis.bundle_renewal_rate,
        formatter: (value) => formatAchievementRate(value, 2),
        loading,
        type: 'value',
        variant: 'standard',
      };
    case 'driver_premium':
      return {
        title,
        value: kpis.driver_premium,
        unit: '万元',
        formatter: formatPremiumWan,
        loading,
        type: 'value',
        variant: 'standard',
      };
    case 'driver_achievement_rate':
      return {
        title,
        value: kpis.driver_achievement_rate,
        formatter: formatAchievementRate,
        loading,
        type: 'value',
        variant: 'standard',
        status: statusFor({
          value: toPercent(kpis.driver_achievement_rate),
          threshold: T.premiumProgressWarn,
        }),
      };
    case 'driver_growth_rate':
      return {
        title,
        value: kpis.driver_growth_rate,
        formatter: formatAchievementRate,
        loading,
        type: 'value',
        variant: 'standard',
      };
    case 'quality_business_rate':
      return {
        title,
        value: kpiDetails
          ? calculateRate(
              toNumber(kpiDetails.quality_business_count),
              toNumber(kpiDetails.quality_business_count) +
                toNumber(kpiDetails.non_quality_business_count)
            )
          : undefined,
        formatter: formatRate,
        loading,
        type: 'bar',
        variant: 'standard',
        ratioData: kpiDetails ? extractDonutData(kpiDetails, 'quality_business') : [],
      };

    /* -------- Watch (13) -------- */
    case 'total_premium':
      return {
        title,
        value: kpis.total_premium,
        unit: '万元',
        formatter: formatPremiumWan,
        loading,
        type: 'value',
        variant: 'standard',
      };
    case 'policy_count':
      return {
        title,
        value: kpis.policy_count,
        unit: '件',
        formatter: formatCount,
        loading,
        type: 'value',
        variant: 'standard',
      };
    case 'per_capita_premium':
      return {
        title,
        value: kpis.per_capita_premium,
        unit: '元',
        formatter: formatPremiumWan,
        loading,
        type: 'value',
        variant: 'standard',
      };
    case 'per_vehicle_premium':
      return {
        title,
        value: kpis.per_vehicle_premium,
        unit: '元',
        formatter: formatCount,
        loading,
        type: 'value',
        variant: 'standard',
      };
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
        variant: 'standard',
        ratioData: kpiDetails
          ? [
              { label: '非过户', value: kpiDetails.non_transfer_count || 0 },
              { label: '过户', value: kpiDetails.transfer_count || 0 },
            ]
          : [],
      };
    case 'renewal_rate':
      return donutBarCard(title, kpis.renewal_rate, loading, kpiDetails, 'renewal');
    case 'commercial_rate':
      return donutBarCard(title, kpis.commercial_rate, loading, kpiDetails, 'commercial');
    case 'telesales_rate':
      return donutBarCard(title, kpis.telesales_rate, loading, kpiDetails, 'telesales');
    case 'nev_rate':
      return donutBarCard(title, kpis.nev_rate, loading, kpiDetails, 'nev');
    case 'new_car_rate':
      return donutBarCard(title, kpis.new_car_rate, loading, kpiDetails, 'new_car');
    case 'coverage_mix_rate':
      return donutBarCard(title, undefined, loading, kpiDetails, 'coverage_mix');
    case 'vehicle_type_rate':
      return donutBarCard(title, undefined, loading, kpiDetails, 'vehicle_type');
    case 'region_rate':
      return {
        title,
        value: kpiDetails
          ? calculateRate(
              toNumber(kpiDetails.same_city_premium),
              toNumber(kpiDetails.same_city_premium) + toNumber(kpiDetails.remote_premium)
            )
          : undefined,
        formatter: formatRate,
        loading,
        type: 'bar',
        variant: 'standard',
        ratioData: kpiDetails ? extractDonutData(kpiDetails, 'region') : [],
      };
    default:
      return null;
  }
}
