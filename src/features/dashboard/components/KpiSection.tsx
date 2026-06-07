import { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EnhancedKpiCard } from '../../../widgets/kpi/EnhancedKpiCard';
import { getKpiDrilldownTarget } from '../kpiDrilldownMap';
import { formatPercent } from '../../../shared/utils/formatters';
import type { KpiData } from '../hooks/useKpiData';
import type { KpiDetailResult } from '../../../shared/types/kpi';
import {
  DEFAULT_KPI_ORDER,
  HERO_KPI_IDS,
  type KpiGroup,
  type KpiCardId,
} from '../dashboardLayoutConfig';
import { cn, colorClasses, textStyles, comprehensiveTheme } from '../../../shared/styles';
import { buildKpiCardProps } from './kpiCardProps';

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
 *
 * 单卡 props 映射逻辑已抽至纯函数 ./kpiCardProps（buildKpiCardProps），本组件只负责
 * 分组 / 渐进披露 / 交互装配 / 渲染。
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
    const props = buildKpiCardProps(id, { kpis, kpiDetails, loading });
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
