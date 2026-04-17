/**
 * 地理风险热力图面板
 *
 * 两级地图：全国分省热力图 → 点击任意省下钻到城市级
 * + 异地出险率 KPI + 双表并排 + 出险频度趋势
 */
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, colorClasses, cn, fontStyles, tableStyles } from '@/shared/styles';
import { useTheme } from '@/shared/theme';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import { ensureMapRegistered, preloadDefaultMaps } from '@/shared/utils/geo-map-loader';
import { GEOJSON_TO_PROVINCE, PROVINCE_TO_GEOJSON, PROVINCE_ADCODE, getProvinceAbbrev, getCityAbbrev } from '@/shared/utils/province-abbrev';
import type { useClaimsDetail } from '../hooks/useClaimsDetail';

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

/** 从 "510100成都市" 提取城市名全称（保留"市"后缀以匹配 GeoJSON） */
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

/** 从 PROVINCE_ADCODE 派生 adcode 前两位，消除重复维护 */
function getProvinceCodePrefix(provinceName: string): string | undefined {
  return PROVINCE_ADCODE[provinceName]?.slice(0, 2);
}

export const GeoRiskPanel: React.FC<Props> = ({ hook, params }) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { geoAccident, geoPlate, geoComparison, frequencyYoy } = hook;
  const [mapMetric, setMapMetric] = useState<MapMetric>('cases');
  const [mapLevel, setMapLevel] = useState<MapLevel>('china');
  const [currentProvince, setCurrentProvince] = useState<string>('');
  const [currentMapKey, setCurrentMapKey] = useState<string>('china');
  const [mapsReady, setMapsReady] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    preloadDefaultMaps()
      .then(() => {
        setMapsReady(true);
        return ensureMapRegistered('china').then(key => setCurrentMapKey(key));
      })
      .catch(() => setMapError('地图资源加载失败，请刷新页面重试'));
  }, []);

  const { fetchGeoData, fetchFrequencyYoy } = hook;
  const loadData = useCallback(() => {
    fetchGeoData(params);
    fetchFrequencyYoy(params);
  }, [fetchGeoData, fetchFrequencyYoy, params]);

  useEffect(() => { loadData(); }, [loadData]);

  const comp = geoComparison.data;

  // ── 省级聚合数据 ──
  const provinceData = useMemo(() => {
    const agg = new Map<string, { name: string; cases: number; reserve_wan: number; injury_cases: number; total_reserve: number }>();
    for (const r of geoAccident.data) {
      const provName = extractProvinceName(r.province ?? '');
      if (!provName) continue;
      const prev = agg.get(provName) ?? { name: provName, cases: 0, reserve_wan: 0, injury_cases: 0, total_reserve: 0 };
      prev.cases += r.cases ?? 0;
      prev.reserve_wan += r.reserve_wan ?? 0;
      prev.injury_cases += r.injury_cases ?? 0;
      prev.total_reserve += (r.reserve_wan ?? 0) * 10000;
      agg.set(provName, prev);
    }
    return [...agg.values()].map(p => ({
      ...p,
      avg_reserve: p.cases > 0 ? Math.round(p.total_reserve / p.cases) : 0,
      injury_pct: p.cases > 0 ? Math.round(p.injury_cases / p.cases * 1000) / 10 : 0,
    }));
  }, [geoAccident.data]);

  // ── 某省城市级数据（动态按省筛选）──
  const provinceCityData = useMemo(() => {
    if (!currentProvince) return [];
    const geoJsonFullName = PROVINCE_TO_GEOJSON[currentProvince];
    const prefix = getProvinceCodePrefix(currentProvince);
    if (!geoJsonFullName && !prefix) return [];
    return geoAccident.data
      .filter((r: any) => {
        const rawProvince = (r.province ?? '').replace(/^\d+/, '');
        if (geoJsonFullName && rawProvince === geoJsonFullName) return true;
        if (prefix) {
          const cityCode = r.city ?? '';
          if (/^\d{6}/.test(cityCode)) return cityCode.slice(0, 2) === prefix;
        }
        return false;
      })
      .map((r: any) => ({
        name: extractCityFullName(r.city ?? ''),
        cases: r.cases ?? 0,
        reserve_wan: r.reserve_wan ?? 0,
        avg_reserve: r.avg_reserve ?? 0,
        injury_pct: r.injury_pct ?? 0,
        avg_cycle_days: r.avg_cycle_days ?? 0,
      }));
  }, [geoAccident.data, currentProvince]);

  // 下钻到某省
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

  // 返回全国
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

  // ── 地图 option 生成 ──
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
        formatter: (p: any) => {
          if (!p.data) return escapeHtml(p.name ?? '');
          const d = p.data;
          const name = isChina ? getProvinceAbbrev(p.name) : getCityAbbrev(p.name);
          return `<b>${escapeHtml(name)}</b><br/>
            赔案: ${formatCount(d.cases)}件<br/>
            立案金额: ${formatCount(d.reserve_wan)}万<br/>
            案均: ${formatCount(d.avg_reserve)}元<br/>
            人伤占比: ${d.injury_pct}%${d.avg_cycle_days ? `<br/>理赔周期: ${d.avg_cycle_days}天` : ''}`;
        },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        text: ['高', '低'],
        realtime: false,
        calculable: true,
        inRange: { color: ['#e0f3db', '#a8ddb5', '#43a2ca', '#0868ac'] },
        left: 'left',
        bottom: 20,
      },
      series: [{
        name: metricLabel,
        type: 'map' as const,
        map: currentMapKey,
        roam: true,
        label: {
          show: !isChina,
          fontSize: 10,
          formatter: (p: any) => getCityAbbrev(p.name ?? ''),
        },
        emphasis: {
          label: { show: true, fontSize: 13, fontWeight: 'bold' as const },
          itemStyle: { areaColor: '#ffd666' },
        },
        select: {
          label: { show: true },
          itemStyle: { areaColor: '#ffd666' },
        },
        data,
      }],
    };
  }, [mapLevel, mapMetric, provinceData, provinceCityData, currentMapKey]);

  // ── 地图点击下钻 ──
  const onMapEvents = useMemo(() => ({
    click: (p: any) => {
      if (mapLevel !== 'china') return;
      const provinceName = GEOJSON_TO_PROVINCE[p.name];
      if (provinceName) {
        void drillToProvince(provinceName);
      }
    },
  }), [mapLevel, drillToProvince]);

  // ── 出险频度同比图 ──
  const yoyChartOption = useMemo(() => {
    const data = frequencyYoy.data;
    if (!data.length) return null;
    const labels = data.map((r: any) => `${r.year}Q${r.quarter}`);
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['出险频度(‰)', '人伤占比(%)'], textStyle: { color: isDark ? '#a3a3a3' : '#595959' } },
      xAxis: { type: 'category' as const, data: labels, axisLabel: { rotate: 45 } },
      yAxis: [
        { type: 'value' as const, name: '频度(‰)', splitLine: { show: false } },
        { type: 'value' as const, name: '人伤占比(%)', splitLine: { show: false } },
      ],
      series: [
        {
          name: '出险频度(‰)', type: 'line' as const,
          data: data.map((r: any) => r.freq_per_1000 ?? 0),
          smooth: true, itemStyle: { color: '#5470c6' },
        },
        {
          name: '人伤占比(%)', type: 'line' as const, yAxisIndex: 1,
          data: data.map((r: any) => r.injury_pct ?? 0),
          smooth: true, itemStyle: { color: '#ee6666' },
        },
      ],
      grid: { left: 60, right: 60, bottom: 60 },
    };
  }, [frequencyYoy.data, isDark]);

  const isLoading = geoAccident.loading || geoPlate.loading;
  const error = geoAccident.error || geoPlate.error;

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-6">
      {/* 地图加载错误提示 */}
      {mapError && (
        <div className={cn(colorClasses.text.danger, 'text-sm px-4 py-2 rounded', colorClasses.bg.danger)}>
          {mapError}
        </div>
      )}

      {/* 异地出险概览 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={cn(cardStyles.standard, 'p-4 text-center')}>
          <div className={colorClasses.text.neutralMuted}>总赔案数</div>
          <div className={cn(fontStyles.kpi, 'mt-1')}>{isLoading ? '...' : formatCount(comp?.total_cases ?? 0)}</div>
        </div>
        <div className={cn(cardStyles.standard, 'p-4 text-center')}>
          <div className={colorClasses.text.neutralMuted}>异地出险率</div>
          <div className={cn(fontStyles.kpi, 'mt-1', colorClasses.text.danger)}>
            {isLoading ? '...' : formatPercent(comp?.cross_region_pct ?? 0)}
          </div>
          <div className={cn(colorClasses.text.neutralMuted, 'text-xs mt-1')}>{formatCount(comp?.cross_region_cases ?? 0)} 件异地</div>
        </div>
        <div className={cn(cardStyles.standard, 'p-4 text-center')}>
          <div className={colorClasses.text.neutralMuted}>异地案均赔款</div>
          <div className={cn(fontStyles.kpi, 'mt-1')}>{isLoading ? '...' : `${formatCount(comp?.cross_region_avg_reserve ?? 0)}元`}</div>
        </div>
        <div className={cn(cardStyles.standard, 'p-4 text-center')}>
          <div className={colorClasses.text.neutralMuted}>本地案均赔款</div>
          <div className={cn(fontStyles.kpi, 'mt-1')}>{isLoading ? '...' : `${formatCount(comp?.local_avg_reserve ?? 0)}元`}</div>
        </div>
      </div>

      {/* 地图热力图 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">
              {mapLevel === 'china'
                ? '全国出险地分省热力图'
                : `${currentProvince}出险地分城市热力图`}
            </h3>
            {mapLevel === 'province' && (
              <button
                onClick={() => void backToChina()}
                className={cn(
                  'px-2 py-0.5 text-xs rounded border transition-colors',
                  `${colorClasses.border.primary} ${colorClasses.text.primary} hover:bg-primary-bg dark:hover:bg-primary-900/30`
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
                    : `${colorClasses.bg.neutral} ${colorClasses.text.neutral} hover:bg-neutral-200 dark:bg-neutral-700 dark:text-neutral-300`
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
          <ReactEChartsCore
            echarts={echarts}
            option={mapOption}
            style={{ height: 500 }}
            onEvents={onMapEvents}
          />
        )}
      </div>

      {/* 双表并排：出险地 vs 车牌归属地 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 出险地点表 */}
        <div className={cn(cardStyles.standard, 'p-4')}>
          <h3 className="font-medium mb-3">按出险地点（风险发生地）</h3>
          {geoAccident.loading ? <div>加载中...</div> : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className={tableStyles.container}>
                <thead className="sticky top-0 bg-white dark:bg-neutral-800">
                  <tr>
                    <th className={tableStyles.headerCell}>城市</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>立案金额(万)</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>人伤占比</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>理赔周期</th>
                  </tr>
                </thead>
                <tbody>
                  {geoAccident.data.slice(0, 25).map((r: any) => (
                    <tr key={`acc-${r.province ?? ''}-${r.city ?? ''}`} className={tableStyles.row}>
                      <td className={tableStyles.cell}>{getCityAbbrev(extractCityFullName(r.city ?? ''))}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.cases ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.reserve_wan ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.avg_reserve ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatPercent(r.injury_pct ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{r.avg_cycle_days ?? '-'}天</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 车牌归属地表 */}
        <div className={cn(cardStyles.standard, 'p-4')}>
          <h3 className="font-medium mb-3">按车牌归属地（风险来源）</h3>
          {geoPlate.loading ? <div>加载中...</div> : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className={tableStyles.container}>
                <thead className="sticky top-0 bg-white dark:bg-neutral-800">
                  <tr>
                    <th className={tableStyles.headerCell}>城市</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>立案金额(万)</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.headerCell, 'text-right')}>人伤占比</th>
                  </tr>
                </thead>
                <tbody>
                  {geoPlate.data.map((r: any) => (
                    <tr key={`plate-${r.plate_city ?? ''}`} className={tableStyles.row}>
                      <td className={tableStyles.cell}>{r.plate_city ?? ''}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.cases ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.reserve_wan ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatCount(r.avg_reserve ?? 0)}</td>
                      <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>{formatPercent(r.injury_pct ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 出险频度同比 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <h3 className="font-medium mb-3">出险频度季度同比（每千保单赔案数）</h3>
        {frequencyYoy.loading ? (
          <div className="h-64 flex items-center justify-center">加载中...</div>
        ) : yoyChartOption ? (
          <ReactEChartsCore echarts={echarts} option={yoyChartOption} style={{ height: 300 }} />
        ) : (
          <div className={cn(colorClasses.text.neutralMuted, 'text-center py-8')}>暂无数据</div>
        )}
      </div>
    </div>
  );
};
