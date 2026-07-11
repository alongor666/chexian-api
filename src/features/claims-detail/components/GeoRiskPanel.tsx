/**
 * 地理风险热力图面板（重设计 v2）
 *
 * 信息架构（自上而下）：
 *   1. 叙事横幅         — 状态徽章 + 一句话结论 + 3 hero 指标（异地出险率为锚）
 *   2. 增强 4 KPI 卡片   — 总赔案 / 异地出险率 / 异地案均 / 本地案均（含 hint）
 *   3. 智能洞察 4 张     — 客户端规则派生（异地出险率 / 集中度 / 同比 / 案均省）
 *   4. 全国/省两级热力地图（100% 保留原交互：下钻 + 4 指标切换 + 漫游）
 *   5. 双表对偶          — 出险地（落点 → in）/ 车牌地（源头 → out）+ RiskBar
 *   6. 出险频度同比图     — 保留 + 同比 delta 徽章
 *
 * 业务洞察规则与阈值集中在 ./geo/insights.ts（待业务校准）。
 */
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { EChartContainer } from '../../../widgets/charts/EChartContainer';
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Info,
} from 'lucide-react';
import {
  cardStyles,
  colorClasses,
  cn,
  fontStyles,
  tableStyles,
  chartColors,
} from '@/shared/styles';
import { EmptyState } from '@/shared/ui';
import { useTheme } from '@/shared/theme';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import { ensureMapRegistered, preloadDefaultMaps } from '@/shared/utils/geo-map-loader';
import {
  GEOJSON_TO_PROVINCE,
  PROVINCE_TO_GEOJSON,
  PROVINCE_ADCODE,
  getProvinceAbbrev,
  getCityAbbrev,
} from '@/shared/utils/province-abbrev';
import { useBranch } from '@/shared/contexts/BranchContext';
import { BRANCH_LABELS } from '@/shared/utils/branchDisplay';
import type { EChartsParam } from '@/shared/types/echarts';
import type { useClaimsDetail } from '../hooks/useClaimsDetail';
import { isGeoRiskEmpty } from './claimsEmptyState';

import { HeroMetric, RiskBar, SectionHeader, StatusPill } from './shared/atoms';
import type { Severity } from './shared/severity';

import { GeoInsightCard } from './geo/GeoInsightCard';
import {
  GEO_THRESHOLDS,
  crossRegionSeverity,
  deriveGeoInsights,
  frequencyYoyDeterioration,
} from './geo/insights';
import type {
  FrequencyYoyRow,
  GeoAccidentRow,
  GeoComparisonRow,
  GeoPlateRow,
} from './geo/types';

/** HTML 转义（防止 tooltip XSS） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

/** 从 "510000四川省" 提取省份名称 */
function extractProvinceName(raw: string): string {
  if (!raw) return '';
  return raw.replace(/^\d+/, '');
}

/** 从 "510100成都市" 提取城市名全称 */
function extractCityFullName(raw: string): string {
  if (!raw) return '';
  return raw.replace(/^\d+/, '');
}

type MapMetric = 'cases' | 'reserve_wan' | 'avg_reserve' | 'injury_pct';
type MapLevel = 'china' | 'province';

const MAP_METRIC_OPTIONS: { key: MapMetric; label: string }[] = [
  { key: 'cases', label: '赔案件数' },
  { key: 'reserve_wan', label: '立案金额(万)' },
  { key: 'avg_reserve', label: '案均赔款' },
  { key: 'injury_pct', label: '人伤占比' },
];

function getProvinceCodePrefix(provinceName: string): string | undefined {
  return PROVINCE_ADCODE[provinceName]?.slice(0, 2);
}

const TABLE_TOP_N = 10;

/** 叙事横幅骨架（数据加载中占位） */
function NarrativeBannerSkeleton() {
  return (
    <div
      className={cn(
        cardStyles.standard,
        'relative overflow-hidden px-6 py-5',
        'bg-gradient-to-br from-white to-neutral-50',
        'dark:from-surface-1 dark:to-surface-2',
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[280px] space-y-3">
          <div className="h-5 w-20 rounded-full bg-neutral-200 dark:bg-surface-2 animate-pulse" />
          <div className="h-6 w-72 rounded bg-neutral-200 dark:bg-surface-2 animate-pulse" />
          <div className="h-4 w-96 max-w-full rounded bg-neutral-100 dark:bg-surface-3 animate-pulse" />
        </div>
        <div className="h-16 w-80 rounded-xl bg-neutral-100 dark:bg-surface-2 animate-pulse" />
      </div>
    </div>
  );
}

/** 增强 KPI 小块（左侧 severity 色边 + 主值 + hint） */
function KpiBox({
  label,
  value,
  unit,
  hint,
  severity,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  severity?: Severity;
}) {
  const accent =
    severity === 'bad'
      ? colorClasses.bg.danger
      : severity === 'warn'
        ? colorClasses.bg.warning
        : severity === 'good'
          ? colorClasses.bg.success
          : 'bg-neutral-200 dark:bg-neutral-700';
  return (
    <div className={cn(cardStyles.standard, 'relative overflow-hidden p-4')}>
      <div className={cn('absolute left-0 top-0 bottom-0 w-1', accent)} aria-hidden />
      <div className={cn('text-xs', colorClasses.text.neutralMuted)}>{label}</div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className={cn(fontStyles.kpi)}>{value}</span>
        {unit && (
          <span className={cn('text-xs', colorClasses.text.neutralMuted)}>{unit}</span>
        )}
      </div>
      {hint && (
        <div
          className={cn(
            'flex items-center gap-1 text-xs mt-1.5',
            colorClasses.text.neutralMuted,
          )}
        >
          {severity === 'bad' || severity === 'warn' ? (
            <AlertTriangle size={10} className={colorClasses.text.warning} />
          ) : (
            <Info size={10} />
          )}
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}

/** RiskBar 三级映射（按"占比"分位） */
function riskBarSeverity(cases: number, max: number): Severity {
  if (max <= 0) return 'neutral';
  const ratio = cases / max;
  if (ratio >= 0.66) return 'bad';
  if (ratio >= 0.33) return 'warn';
  return 'good';
}

export const GeoRiskPanel: React.FC<Props> = ({ hook, params }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { geoAccident, geoPlate, geoComparison, frequencyYoy } = hook;
  const { effectiveBranch } = useBranch();
  // 当前用户归属省（SX='山西', SC='四川', null/ALL 兜底'四川'），决定下钻预热地图按哪个省预加载
  const defaultProvince = (effectiveBranch ? BRANCH_LABELS[effectiveBranch] : null) ?? '四川';
  const [mapMetric, setMapMetric] = useState<MapMetric>('cases');
  const [mapLevel, setMapLevel] = useState<MapLevel>('china');
  const [currentProvince, setCurrentProvince] = useState<string>('');
  const [currentMapKey, setCurrentMapKey] = useState<string>('china');
  const [mapsReady, setMapsReady] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    // 首屏是 'china' 级地图（与 GeoSection 不同），preloadDefaultMaps(defaultProvince) 只是为
    // 用户所属省的下钻预热，避免山西用户点击下钻时仍去加载四川地图。
    preloadDefaultMaps(defaultProvince)
      .then(() => {
        setMapsReady(true);
        return ensureMapRegistered('china').then(key => setCurrentMapKey(key));
      })
      .catch(() => setMapError('地图资源加载失败，请刷新页面重试'));
  }, [defaultProvince]);

  const { fetchGeoData, fetchFrequencyYoy } = hook;
  const loadData = useCallback(() => {
    fetchGeoData(params);
    fetchFrequencyYoy(params);
  }, [fetchGeoData, fetchFrequencyYoy, params]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const accidentSrc = geoAccident.data as GeoAccidentRow[];
  const plateSrc = geoPlate.data as GeoPlateRow[];
  const comparison = geoComparison.data as GeoComparisonRow | null;
  const yoySrc = frequencyYoy.data as FrequencyYoyRow[];

  // 叙事变量
  const totalCases = comparison?.total_cases ?? 0;
  const crossPct = comparison?.cross_region_pct ?? 0;
  const crossCases = comparison?.cross_region_cases ?? 0;
  const crossAvg = comparison?.cross_region_avg_reserve ?? 0;
  const localAvg = comparison?.local_avg_reserve ?? 0;

  const overallSeverity: Severity = useMemo(
    () => crossRegionSeverity(crossPct),
    [crossPct],
  );

  const topPlateOut = useMemo(() => {
    return [...plateSrc]
      .sort((a, b) => (b.cases ?? 0) - (a.cases ?? 0))
      .slice(0, 3)
      .map(p => p.plate_city ?? '')
      .filter(Boolean);
  }, [plateSrc]);

  const topAccidentProvince = useMemo(() => {
    const agg = new Map<string, number>();
    for (const r of accidentSrc) {
      const name = extractProvinceName(r.province ?? '');
      if (!name) continue;
      agg.set(name, (agg.get(name) ?? 0) + (r.cases ?? 0));
    }
    let best: { name: string; cases: number } | null = null;
    for (const [name, cases] of agg.entries()) {
      if (best === null || cases > best.cases) best = { name, cases };
    }
    return best;
  }, [accidentSrc]);

  const insights = useMemo(
    () => deriveGeoInsights(comparison ?? undefined, plateSrc, yoySrc, accidentSrc),
    [comparison, plateSrc, yoySrc, accidentSrc],
  );

  const yoyDelta = useMemo(() => frequencyYoyDeterioration(yoySrc), [yoySrc]);

  // 省级聚合（地图全国视图）
  const provinceData = useMemo(() => {
    const agg = new Map<string, {
      name: string;
      cases: number;
      reserve_wan: number;
      injury_cases: number;
      total_reserve: number;
    }>();
    for (const r of accidentSrc) {
      const provName = extractProvinceName(r.province ?? '');
      if (!provName) continue;
      const prev = agg.get(provName) ?? {
        name: provName,
        cases: 0,
        reserve_wan: 0,
        injury_cases: 0,
        total_reserve: 0,
      };
      prev.cases += r.cases ?? 0;
      prev.reserve_wan += r.reserve_wan ?? 0;
      prev.injury_cases += r.injury_cases ?? 0;
      prev.total_reserve += (r.reserve_wan ?? 0) * 10000;
      agg.set(provName, prev);
    }
    return [...agg.values()].map(p => ({
      ...p,
      avg_reserve: p.cases > 0 ? Math.round(p.total_reserve / p.cases) : 0,
      injury_pct: p.cases > 0 ? Math.round((p.injury_cases / p.cases) * 1000) / 10 : 0,
    }));
  }, [accidentSrc]);

  // 某省城市级数据（地图省视图）
  const provinceCityData = useMemo(() => {
    if (!currentProvince) return [];
    const geoJsonFullName = PROVINCE_TO_GEOJSON[currentProvince];
    const prefix = getProvinceCodePrefix(currentProvince);
    if (!geoJsonFullName && !prefix) return [];
    return accidentSrc
      .filter(r => {
        const rawProvince = (r.province ?? '').replace(/^\d+/, '');
        if (geoJsonFullName && rawProvince === geoJsonFullName) return true;
        if (prefix) {
          const cityCode = r.city ?? '';
          if (/^\d{6}/.test(cityCode)) return cityCode.slice(0, 2) === prefix;
        }
        return false;
      })
      .map(r => ({
        name: extractCityFullName(r.city ?? ''),
        cases: r.cases ?? 0,
        reserve_wan: r.reserve_wan ?? 0,
        avg_reserve: r.avg_reserve ?? 0,
        injury_pct: r.injury_pct ?? 0,
        avg_cycle_days: r.avg_cycle_days ?? 0,
      }));
  }, [accidentSrc, currentProvince]);

  const drillToProvince = useCallback(async (provinceName: string) => {
    setMapLoading(true);
    setMapError(null);
    try {
      const key = await ensureMapRegistered(provinceName);
      setCurrentMapKey(key);
      setCurrentProvince(provinceName);
      setMapLevel('province');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '地图加载失败';
      setMapError(`加载 ${provinceName} 地图失败: ${msg}`);
    } finally {
      setMapLoading(false);
    }
  }, []);

  const backToChina = useCallback(async () => {
    setMapLoading(true);
    setMapError(null);
    try {
      const key = await ensureMapRegistered('china');
      setCurrentMapKey(key);
      setMapLevel('china');
      setCurrentProvince('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '地图加载失败';
      setMapError(msg);
    } finally {
      setMapLoading(false);
    }
  }, []);

  const mapOption = useMemo(() => {
    const isChina = mapLevel === 'china';
    const data = isChina
      ? provinceData.map(p => ({ ...p, name: p.name, value: p[mapMetric] }))
      : provinceCityData.map(c => ({ ...c, name: c.name, value: c[mapMetric] }));

    const values = data.map(d => d.value).filter(v => v > 0);
    const maxVal = values.length > 0 ? Math.max(...values) : 100;
    const metricLabel = MAP_METRIC_OPTIONS.find(m => m.key === mapMetric)!.label;

    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: (p: EChartsParam) => {
          if (!p.data) return escapeHtml(p.name ?? '');
          const d = p.data as {
            cases: number;
            reserve_wan: number;
            avg_reserve: number;
            injury_pct: number;
            avg_cycle_days?: number;
          };
          const name = isChina ? getProvinceAbbrev(p.name as string) : getCityAbbrev(p.name as string);
          return `<b>${escapeHtml(name)}</b><br/>
            赔案: ${formatCount(d.cases)}件<br/>
            立案金额: ${formatCount(d.reserve_wan)}万<br/>
            案均: ${formatCount(d.avg_reserve)}元<br/>
            人伤占比: ${d.injury_pct}%${
              d.avg_cycle_days ? `<br/>理赔周期: ${d.avg_cycle_days}天` : ''
            }`;
        },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        text: ['高', '低'],
        realtime: false,
        calculable: true,
        inRange: { color: [...chartColors.geoRamp.greenBlue] },
        left: 'left',
        bottom: 20,
      },
      series: [
        {
          name: metricLabel,
          type: 'map' as const,
          map: currentMapKey,
          roam: true,
          label: {
            show: !isChina,
            fontSize: 10,
            formatter: (p: EChartsParam) => getCityAbbrev(p.name ?? ''),
          },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 'bold' as const },
            itemStyle: { areaColor: chartColors.mapAreaHighlight },
          },
          select: {
            label: { show: true },
            itemStyle: { areaColor: chartColors.mapAreaHighlight },
          },
          data,
        },
      ],
    };
  }, [mapLevel, mapMetric, provinceData, provinceCityData, currentMapKey]);

  const onMapEvents = useMemo(
    () => ({
      click: (p: unknown) => {
        const param = p as EChartsParam;
        if (mapLevel !== 'china') return;
        const provinceName = GEOJSON_TO_PROVINCE[param.name as string];
        if (provinceName) {
          void drillToProvince(provinceName);
        }
      },
    }),
    [mapLevel, drillToProvince],
  );

  const yoyChartOption = useMemo(() => {
    const data = yoySrc;
    if (!data.length) return null;
    const labels = data.map(r => `${r.year}Q${r.quarter}`);
    return {
      tooltip: { trigger: 'axis' as const },
      legend: {
        data: ['出险频度(‰)', '人伤占比(%)'],
        textStyle: { color: isDark ? '#a3a3a3' : '#595959' },
      },
      xAxis: { type: 'category' as const, data: labels, axisLabel: { rotate: 45 } },
      yAxis: [
        { type: 'value' as const, name: '频度(‰)', splitLine: { show: false } },
        { type: 'value' as const, name: '人伤占比(%)', splitLine: { show: false } },
      ],
      series: [
        {
          name: '出险频度(‰)',
          type: 'line' as const,
          data: data.map(r => r.freq_per_1000 ?? 0),
          smooth: true,
          itemStyle: { color: chartColors.categorical[0] },  // #5470C6
        },
        {
          name: '人伤占比(%)',
          type: 'line' as const,
          yAxisIndex: 1,
          data: data.map(r => r.injury_pct ?? 0),
          smooth: true,
          itemStyle: { color: chartColors.categorical[3] },  // #EE6666
        },
      ],
      grid: { left: 60, right: 60, bottom: 60 },
    };
  }, [yoySrc, isDark]);

  const isLoading = geoAccident.loading || geoPlate.loading;
  /** 加载结束就退出骨架，避免空数据卡骨架（codex P2 #2 教训） */
  const hasData = !isLoading;
  const error = geoAccident.error || geoPlate.error;

  // 数据缺失守卫（2026-06-25-claude-6a5aad follow-up）：出险地/车牌归属地两端点均无规模行
  // （geoAccident.data 与 geoPlate.data 均为 GROUP BY 聚合，无匹配数据时恒返回 []）时，视为
  // 「数据装载中 / 完全无地理归属数据」而非「真实零赔案」——区分于 geoComparison（无 GROUP BY
  // 单行聚合，恒返回 1 行 total_cases=0，不能单独作为数据缺失锚，否则窄筛选下真实零赔案会被
  // 误判为「装载中」）。加载中/请求出错时不判空态，避免抢在骨架屏之前误闪空态卡片。
  const isDataMissing =
    hasData && !error && isGeoRiskEmpty(accidentSrc, plateSrc);

  if (error) {
    return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;
  }

  if (isDataMissing) {
    return (
      <EmptyState
        size="lg"
        title="地理风险数据装载中"
        description="当前筛选范围或机构暂无出险地/车牌归属地数据，可能正在装载，请稍后刷新。若持续为空，请联系管理员确认数据状态——这不代表真实零赔案。"
      />
    );
  }

  const headline =
    overallSeverity === 'bad'
      ? '异地出险率显著偏高，需立即核查'
      : overallSeverity === 'warn'
        ? '异地出险率偏高，建议关注'
        : overallSeverity === 'good'
          ? '本期地理分布平稳'
          : '本期暂无地理对比数据';

  const summarySentence = (() => {
    if (totalCases === 0) return '本期暂无赔案数据。';
    const platePart =
      topPlateOut.length > 0
        ? `车牌主要来自 ${topPlateOut.slice(0, 3).join(' / ')}`
        : '';
    const provPart = topAccidentProvince
      ? `落点最高在 ${topAccidentProvince.name}（${formatCount(topAccidentProvince.cases)} 件）`
      : '';
    const parts = [
      `本期共 ${formatCount(totalCases)} 件赔案，${formatPercent(crossPct)} 异地出险`,
      platePart,
      provPart,
    ].filter(Boolean);
    return parts.join('，') + '。';
  })();

  // 双表对偶 — Top N 行
  const sortedAccident = [...accidentSrc]
    .sort((a, b) => (b.cases ?? 0) - (a.cases ?? 0))
    .slice(0, TABLE_TOP_N);
  const sortedPlate = [...plateSrc]
    .sort((a, b) => (b.cases ?? 0) - (a.cases ?? 0))
    .slice(0, TABLE_TOP_N);
  const maxAccidentCases = sortedAccident.length > 0 ? sortedAccident[0].cases ?? 0 : 0;
  const maxPlateCases = sortedPlate.length > 0 ? sortedPlate[0].cases ?? 0 : 0;

  return (
    <div className="space-y-5">
      {/* 1. 叙事横幅 */}
      {hasData ? (
        <div
          className={cn(
            cardStyles.standard,
            'relative overflow-hidden px-6 py-5',
            'bg-gradient-to-br from-white to-neutral-50',
            'dark:from-surface-1 dark:to-surface-2',
          )}
        >
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <div className="flex items-center gap-3 mb-3">
                <StatusPill
                  severity={overallSeverity}
                  label={
                    overallSeverity === 'bad'
                      ? '异常'
                      : overallSeverity === 'warn'
                        ? '需关注'
                        : overallSeverity === 'good'
                          ? '正常'
                          : '暂无数据'
                  }
                />
                <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
                  地理风险热力图
                </span>
              </div>
              <h2
                className={cn(
                  'text-xl font-bold tracking-tight leading-tight',
                  colorClasses.text.neutralBlack,
                )}
              >
                {headline}
              </h2>
              <p
                className={cn(
                  'text-sm mt-2 leading-relaxed',
                  colorClasses.text.neutralDark,
                )}
              >
                {summarySentence}
              </p>
            </div>
            <div
              className={cn(
                'flex items-center gap-5 px-5 py-3 rounded-xl border',
                'bg-white dark:bg-surface-2',
                colorClasses.border.neutral,
              )}
            >
              <HeroMetric
                label="总赔案"
                value={formatCount(totalCases)}
                unit="件"
                severity={overallSeverity}
              />
              <span className="w-px h-10 bg-neutral-200 dark:bg-subtle" aria-hidden />
              <HeroMetric
                label="异地出险率"
                value={formatPercent(crossPct).replace('%', '')}
                unit="%"
                severity={overallSeverity}
              />
              <span className="w-px h-10 bg-neutral-200 dark:bg-subtle" aria-hidden />
              <HeroMetric
                label="异地案均"
                value={formatCount(crossAvg)}
                unit="元"
                severity={overallSeverity}
                badge={
                  localAvg > 0 && crossAvg > 0
                    ? `${(crossAvg / localAvg).toFixed(1)}× 本地`
                    : undefined
                }
              />
            </div>
          </div>
        </div>
      ) : (
        <NarrativeBannerSkeleton />
      )}

      {/* 地图加载错误提示 */}
      {mapError && (
        <div
          className={cn(
            colorClasses.text.danger,
            'text-sm px-4 py-2 rounded',
            colorClasses.bg.danger,
          )}
        >
          {mapError}
        </div>
      )}

      {/* 2. 增强 4 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBox
          label="总赔案数"
          value={isLoading ? '...' : formatCount(totalCases)}
          unit="件"
          hint={`包含异地 ${formatCount(crossCases)} 件`}
        />
        <KpiBox
          label="异地出险率"
          value={isLoading ? '...' : formatPercent(crossPct).replace('%', '')}
          unit="%"
          severity={overallSeverity}
          hint={
            overallSeverity === 'bad'
              ? `高于阈值 ${GEO_THRESHOLDS.crossRegionPctBad}%`
              : overallSeverity === 'warn'
                ? `高于阈值 ${GEO_THRESHOLDS.crossRegionPctWarn}%`
                : '在正常范围'
          }
        />
        <KpiBox
          label="异地案均"
          value={isLoading ? '...' : formatCount(crossAvg)}
          unit="元"
          hint={
            localAvg > 0 && crossAvg > 0
              ? `是本地的 ${(crossAvg / localAvg).toFixed(1)} 倍`
              : '—'
          }
        />
        <KpiBox
          label="本地案均"
          value={isLoading ? '...' : formatCount(localAvg)}
          unit="元"
          hint={`${formatCount(totalCases - crossCases)} 件本地`}
        />
      </div>

      {/* 3. 智能洞察 4 张 */}
      <section>
        <SectionHeader title="智能洞察" sub="基于地理风险信号的客户端规则判定" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {insights.map(ins => (
            <GeoInsightCard key={ins.id} insight={ins} />
          ))}
        </div>
      </section>

      {/* 4. 地图热力图（100% 保留交互） */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">
              {mapLevel === 'china'
                ? '全国出险地分省热力图（风险落点）'
                : `${currentProvince}出险地分城市热力图`}
            </h3>
            {mapLevel === 'province' && (
              <button
                onClick={() => void backToChina()}
                className={cn(
                  'px-2 py-0.5 text-xs rounded border transition-colors',
                  `${colorClasses.border.primary} ${colorClasses.text.primary} hover:bg-primary-bg dark:hover:bg-primary-900/30`,
                )}
              >
                ← 返回全国
              </button>
            )}
            {mapLevel === 'china' && (
              <span className={cn(colorClasses.text.neutralMuted, 'text-xs')}>
                点击任意省份可下钻查看城市分布
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {MAP_METRIC_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setMapMetric(opt.key)}
                className={cn(
                  'px-3 py-1 text-xs rounded-full transition-colors',
                  mapMetric === opt.key
                    ? 'bg-primary-solid text-white'
                    : `${colorClasses.bg.neutral} ${colorClasses.text.neutral} hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300`,
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {isLoading || !mapsReady || mapLoading ? (
          <div className="h-[500px] flex items-center justify-center">
            {mapLoading ? '地图加载中...' : '加载中...'}
          </div>
        ) : (
          <EChartContainer option={mapOption} height={500} notMerge={false} onEvents={onMapEvents} />
        )}
      </div>

      {/* 5. 双表对偶：风险落点 vs 风险源头 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左：出险地（流入 / 风险落点） */}
        <div className={cn(cardStyles.standard, 'p-4')}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                  colorClasses.bg.danger,
                  colorClasses.text.danger,
                )}
              >
                <ArrowDownToLine size={11} />
                流入
              </span>
              <h3 className="font-medium">出险地 Top {TABLE_TOP_N}（风险落点）</h3>
            </div>
            <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
              在哪发生
            </span>
          </div>
          {geoAccident.loading ? (
            <div>加载中...</div>
          ) : sortedAccident.length === 0 ? (
            <div
              className={cn(colorClasses.text.neutralMuted, 'text-center py-8 text-sm')}
            >
              暂无数据
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableStyles.container}>
                <thead>
                  <tr>
                    <th className={tableStyles.headerCell}>城市</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>
                      立案(万)
                    </th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>人伤%</th>
                    <th className={tableStyles.headerCell}>占比</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAccident.map((r, i) => {
                    const cityName = getCityAbbrev(extractCityFullName(r.city ?? ''));
                    const shareSev = riskBarSeverity(r.cases ?? 0, maxAccidentCases);
                    return (
                      <tr
                        key={`acc-${r.province ?? ''}-${r.city ?? ''}-${i}`}
                        className={tableStyles.row}
                      >
                        <td className={tableStyles.cell}>{cityName}</td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatCount(r.cases ?? 0)}
                        </td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatCount(r.reserve_wan ?? 0)}
                        </td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatCount(r.avg_reserve ?? 0)}
                        </td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatPercent(r.injury_pct ?? 0)}
                        </td>
                        <td className={cn(tableStyles.cell, 'w-24')}>
                          <RiskBar severity={shareSev} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 右：车牌归属地（流出 / 风险源头） */}
        <div className={cn(cardStyles.standard, 'p-4')}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                  colorClasses.bg.warning,
                  colorClasses.text.warning,
                )}
              >
                <ArrowUpFromLine size={11} />
                流出
              </span>
              <h3 className="font-medium">车牌归属 Top {TABLE_TOP_N}（风险源头）</h3>
            </div>
            <span className={cn('text-xs', colorClasses.text.neutralMuted)}>
              从哪来
            </span>
          </div>
          {geoPlate.loading ? (
            <div>加载中...</div>
          ) : sortedPlate.length === 0 ? (
            <div
              className={cn(colorClasses.text.neutralMuted, 'text-center py-8 text-sm')}
            >
              暂无数据
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableStyles.container}>
                <thead>
                  <tr>
                    <th className={tableStyles.headerCell}>城市</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>
                      立案(万)
                    </th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>人伤%</th>
                    <th className={tableStyles.headerCell}>占比</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlate.map((r, i) => {
                    const shareSev = riskBarSeverity(r.cases ?? 0, maxPlateCases);
                    return (
                      <tr
                        key={`plate-${r.plate_city ?? ''}-${i}`}
                        className={tableStyles.row}
                      >
                        <td className={tableStyles.cell}>{r.plate_city ?? '—'}</td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatCount(r.cases ?? 0)}
                        </td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatCount(r.reserve_wan ?? 0)}
                        </td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatCount(r.avg_reserve ?? 0)}
                        </td>
                        <td
                          className={cn(
                            tableStyles.cell,
                            'text-right',
                            fontStyles.numeric,
                          )}
                        >
                          {formatPercent(r.injury_pct ?? 0)}
                        </td>
                        <td className={cn(tableStyles.cell, 'w-24')}>
                          <RiskBar severity={shareSev} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 6. 频度同比图（保留 + 同比 delta 徽章） */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">出险频度季度同比（每千保单赔案数）</h3>
          {yoyDelta && (
            <span
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                yoyDelta.yoyPct > 0
                  ? `${colorClasses.bg.danger} ${colorClasses.text.danger}`
                  : `${colorClasses.bg.success} ${colorClasses.text.success}`,
              )}
            >
              {yoyDelta.yoyPct > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              {yoyDelta.latestQuarterLabel} 同比 {yoyDelta.yoyPct > 0 ? '+' : ''}
              {yoyDelta.yoyPct.toFixed(1)}%
            </span>
          )}
        </div>
        {frequencyYoy.loading ? (
          <div className="h-64 flex items-center justify-center">加载中...</div>
        ) : yoyChartOption ? (
          <EChartContainer option={yoyChartOption} height={300} notMerge={false} />
        ) : (
          <div className={cn(colorClasses.text.neutralMuted, 'text-center py-8')}>
            暂无数据
          </div>
        )}
      </div>
    </div>
  );
};
