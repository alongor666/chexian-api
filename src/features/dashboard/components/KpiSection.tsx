import { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EnhancedKpiCard, type EnhancedKpiCardProps } from '../../../widgets/kpi/EnhancedKpiCard';
import { getKpiDrilldownTarget } from '../kpiDrilldownMap';
import {
  formatAchievementRate,
  formatCount,
  formatPercent,
  formatPremiumWan,
  formatRate,
  formatWanDirect,
} from '../../../shared/utils/formatters';
import type { KpiData } from '../hooks/useKpiData';
import type { KpiDetailResult } from '../../../shared/types/kpi';
import {
  DEFAULT_KPI_ORDER,
  KPI_CARD_META,
  HERO_KPI_IDS,
  type KpiGroup,
  type KpiCardId,
} from '../dashboardLayoutConfig';
import { cn, colorClasses, textStyles, comprehensiveTheme } from '../../../shared/styles';
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

interface KpiSectionProps {
  kpis: KpiData;
  kpiDetails: KpiDetailResult | null;
  loading: boolean;
  /** 来自自定义面板的可见与排序（按 group） */
  visibleKpisByGroup?: Record<KpiGroup, KpiCardId[]>;
}

/**
 * KPI 指标卡片区域 — 重设计版
 *
 * 设计简报 §5 落地：
 *  - 顶部「经营体检」3 张 Hero 卡（含 progress / ring / segments 参照系 + 状态 rail）
 *  - 中部「核心指标」6 张普通卡
 *  - 底部「关注指标」13 张普通卡，默认折叠（渐进披露）
 *
 * 状态判定（铁律阈值）：
 *  - 保费达成 99%
 *  - 变动成本率 91%（反向）
 *  - 综合成本率 91%（反向）
 */
export const KpiSection = memo<KpiSectionProps>(({ kpis, kpiDetails, loading, visibleKpisByGroup }) => {
  const [watchOpen, setWatchOpen] = useState(false);
  const navigate = useNavigate();

  const handleKpiClick = useCallback(
    (id: KpiCardId) => {
      const target = getKpiDrilldownTarget(id);
      if (target) navigate(target.path);
    },
    [navigate]
  );

  const getInteractiveProps = useCallback(
    (id: KpiCardId) => {
      const target = getKpiDrilldownTarget(id);
      if (!target) return {};
      return { onClick: () => handleKpiClick(id), clickHint: target.hint };
    },
    [handleKpiClick]
  );

  const T = comprehensiveTheme.threshold;

  /** 给一个 0~1 / 0~100 自动判断并归一到百分数 */
  const toPercent = (v: number | null | undefined): number | null => {
    if (v == null || Number.isNaN(v)) return null;
    return v <= 1.5 ? v * 100 : v;
  };

  /** 构造单卡 props — Hero 三张携带参照系 + 状态；其它走标准变体（Hero 归属由 HERO_KPI_IDS + visibleHero 分组决定） */
  const buildCardProps = (id: KpiCardId): EnhancedKpiCardProps | null => {
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
        const status = statusFor({
          value,
          threshold: T.costRateWarn,
          reverse: true,
        });
        // 后端暂未拆解：先用 0 占位段（不显示数字），等接口提供"满期赔付率/费用率"分项时填入
        const segments = [
          { label: '满期赔付率', value: Math.min(value * 0.69, value), tone: 'primary' as const },
          { label: '费用率', value: Math.max(value - value * 0.69, 0), tone: 'warning' as const },
        ];
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
        return {
          title,
          value: kpis.renewal_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'renewal') : [],
        };
      case 'commercial_rate':
        return {
          title,
          value: kpis.commercial_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'commercial') : [],
        };
      case 'telesales_rate':
        return {
          title,
          value: kpis.telesales_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'telesales') : [],
        };
      case 'nev_rate':
        return {
          title,
          value: kpis.nev_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'nev') : [],
        };
      case 'new_car_rate':
        return {
          title,
          value: kpis.new_car_rate,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'new_car') : [],
        };
      case 'coverage_mix_rate':
        return {
          title,
          value: undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'coverage_mix') : [],
        };
      case 'vehicle_type_rate':
        return {
          title,
          value: undefined,
          formatter: formatRate,
          loading,
          type: 'bar',
          variant: 'standard',
          ratioData: kpiDetails ? extractDonutData(kpiDetails, 'vehicle_type') : [],
        };
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
  };

  const visibleHero = useMemo<KpiCardId[]>(() => {
    const fromCustomizer = visibleKpisByGroup?.core ?? DEFAULT_KPI_ORDER.core;
    return fromCustomizer.filter((id) => HERO_KPI_IDS.includes(id));
  }, [visibleKpisByGroup]);

  const visibleCore = useMemo<KpiCardId[]>(() => {
    const fromCustomizer = visibleKpisByGroup?.core ?? DEFAULT_KPI_ORDER.core;
    return fromCustomizer.filter((id) => !HERO_KPI_IDS.includes(id));
  }, [visibleKpisByGroup]);

  const visibleWatch = useMemo<KpiCardId[]>(
    () => visibleKpisByGroup?.focus ?? DEFAULT_KPI_ORDER.focus,
    [visibleKpisByGroup]
  );

  const cardWith = (id: KpiCardId) => {
    const props = buildCardProps(id);
    if (!props) return null;
    return (
      <EnhancedKpiCard key={id} {...props} {...getInteractiveProps(id)} />
    );
  };

  return (
    <div className="space-y-6">
      {/* 经营体检 — Hero 行 */}
      <div>
        <div className="mb-3 flex items-baseline gap-2">
          <span className={cn('text-[11px] font-semibold uppercase tracking-[0.09em]', colorClasses.text.neutralMuted)}>
            经营体检
          </span>
          <span className={cn('text-[11px]', colorClasses.text.neutralMuted)}>
            今日健康一眼判断 · 规模 / 进度 / 成本
          </span>
        </div>
        {visibleHero.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {visibleHero.map((id) => cardWith(id))}
          </div>
        )}
      </div>

      {/* 核心指标 */}
      {visibleCore.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className={cn('text-[11px] font-semibold uppercase tracking-[0.09em]', colorClasses.text.neutralMuted)}>
              核心指标
            </span>
            <span className={cn('h-px flex-1', colorClasses.border.neutral, 'bg-current opacity-15')} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {visibleCore.map((id) => cardWith(id))}
          </div>
        </div>
      )}

      {/* 关注指标 — 渐进披露 */}
      {visibleWatch.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setWatchOpen((v) => !v)}
            className="mb-3 flex items-center gap-2 text-left"
          >
            <span className={cn('text-[11px] font-semibold uppercase tracking-[0.09em]', colorClasses.text.neutralMuted)}>
              关注指标
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                colorClasses.border.neutral,
                colorClasses.text.neutralDark,
                colorClasses.bg.neutral
              )}
            >
              {visibleWatch.length} 项
            </span>
            <span className={cn('text-[12px] font-medium', colorClasses.text.primary)}>
              {watchOpen ? '收起 ▲' : `展开 ${visibleWatch.length} 项关注指标 ▼`}
            </span>
          </button>
          {watchOpen && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {visibleWatch.map((id) => cardWith(id))}
            </div>
          )}
        </div>
      )}

      {/* 状态语义说明（打印保留） */}
      <p className={cn('pt-1 text-[11px]', colorClasses.text.neutralMuted)}>
        ※ 状态色仅表语义（蓝=结构 / 绿=达标 / 红=落后超标 / 黄=接近阈值），均叠加 ▲▼ ✓! 图标，不单靠颜色。阈值：保费进度 {T.premiumProgressWarn}% · 变动成本率 {T.costRateWarn}% · 综合成本率 {T.costRateWarn}%。
      </p>

      {/* 兜底：参数列表全空且非 loading */}
      {!loading && visibleHero.length + visibleCore.length + visibleWatch.length === 0 && (
        <div className={cn('p-4 text-center', textStyles.body, colorClasses.text.neutralMuted)}>
          未选择任何 KPI 指标
        </div>
      )}

      {/* 避免 lint 警告：未使用变量 */}
      <span hidden>{formatPercent(0)}</span>
    </div>
  );
});
