/**
 * 地理风险热力图面板
 *
 * 两级地图：全国分省热力图 → 点击四川下钻到省内分城市
 * + 异地出险率 KPI + 双表并排 + 出险频度趋势
 */
import React, { useEffect, useCallback, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, colorClasses, cn, fontStyles, tableStyles } from '@/shared/styles';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import type { useClaimsDetail } from '../hooks/useClaimsDetail';
import chinaGeoJson from '@/shared/assets/china.json';
import sichuanGeoJson from '@/shared/assets/sichuan.json';

interface Props {
  hook: ReturnType<typeof useClaimsDetail>;
  params?: Record<string, string>;
}

// 注册地图（各执行一次）
let chinaRegistered = false;
let sichuanRegistered = false;
function ensureMapsRegistered() {
  if (!chinaRegistered) {
    echarts.registerMap('china', chinaGeoJson as any);
    chinaRegistered = true;
  }
  if (!sichuanRegistered) {
    echarts.registerMap('sichuan', sichuanGeoJson as any);
    sichuanRegistered = true;
  }
}

/** 从 "510000四川省" 提取省份名称 */
function extractProvinceName(raw: string): string {
  if (!raw) return '';
  return raw.replace(/^\d+/, '');
}

/** 从 "510100成都市" 提取城市名（去掉代码和"市"后缀） */
function extractCityName(raw: string): string {
  if (!raw) return '';
  const name = raw.replace(/^\d+/, '');
  return name.replace(/市$/, '');
}

/** adcode 到 GeoJSON name 的映射（四川省内城市） */
const SC_CITY_CODE_TO_NAME: Record<string, string> = {
  '510100': '成都市', '510300': '自贡市', '510400': '攀枝花市',
  '510500': '泸州市', '510600': '德阳市', '510700': '绵阳市',
  '510800': '广元市', '510900': '遂宁市', '511000': '内江市',
  '511100': '乐山市', '511300': '南充市', '511400': '眉山市',
  '511500': '宜宾市', '511600': '广安市', '511700': '达州市',
  '511800': '雅安市', '511900': '巴中市', '512000': '资阳市',
  '513200': '阿坝藏族羌族自治州', '513300': '甘孜藏族自治州',
  '513400': '凉山彝族自治州',
};

type MapMetric = 'cases' | 'reserve_wan' | 'avg_reserve' | 'injury_pct';
type MapLevel = 'china' | 'sichuan';

const MAP_METRIC_OPTIONS: { key: MapMetric; label: string }[] = [
  { key: 'cases', label: '赔案件数' },
  { key: 'reserve_wan', label: '立案金额(万)' },
  { key: 'avg_reserve', label: '案均赔款' },
  { key: 'injury_pct', label: '人伤占比' },
];

export const GeoRiskPanel: React.FC<Props> = ({ hook, params }) => {
  const { geoAccident, geoPlate, geoComparison, frequencyYoy } = hook;
  const [mapMetric, setMapMetric] = useState<MapMetric>('cases');
  const [mapLevel, setMapLevel] = useState<MapLevel>('china');

  const loadData = useCallback(() => {
    hook.fetchGeoData(params);
    hook.fetchFrequencyYoy(params);
  }, [hook.fetchGeoData, hook.fetchFrequencyYoy, params]);

  useEffect(() => { loadData(); }, [loadData]);

  ensureMapsRegistered();

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

  // ── 四川城市级数据 ──
  const sichuanCityData = useMemo(() => {
    return geoAccident.data
      .filter((r: any) => (r.province ?? '').startsWith('51'))
      .map((r: any) => {
        const code = (r.city ?? '').slice(0, 6);
        return {
          name: SC_CITY_CODE_TO_NAME[code] ?? extractCityName(r.city ?? ''),
          cases: r.cases ?? 0,
          reserve_wan: r.reserve_wan ?? 0,
          avg_reserve: r.avg_reserve ?? 0,
          injury_pct: r.injury_pct ?? 0,
          avg_cycle_days: r.avg_cycle_days ?? 0,
        };
      });
  }, [geoAccident.data]);

  // ── 地图 option 生成 ──
  const mapOption = useMemo(() => {
    const isChina = mapLevel === 'china';
    const data = isChina
      ? provinceData.map(p => ({ name: p.name, value: p[mapMetric], ...p }))
      : sichuanCityData.map(c => ({ name: c.name, value: c[mapMetric], ...c }));

    const values = data.map(d => d.value).filter(v => v > 0);
    const maxVal = values.length > 0 ? Math.max(...values) : 100;
    const metricLabel = MAP_METRIC_OPTIONS.find(m => m.key === mapMetric)!.label;

    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: (p: any) => {
          if (!p.data) return p.name;
          const d = p.data;
          return `<b>${p.name}</b><br/>
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
        map: isChina ? 'china' : 'sichuan',
        roam: true,
        label: {
          show: !isChina,
          fontSize: 10,
          formatter: (p: any) => {
            const short = (p.name ?? '')
              .replace(/(藏族羌族|彝族|藏族)自治州/, '')
              .replace(/(市|省|自治区|壮族自治区|维吾尔自治区|回族自治区)$/, '');
            return short;
          },
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
  }, [mapLevel, mapMetric, provinceData, sichuanCityData]);

  // ── 地图点击下钻 ──
  const onMapEvents = useMemo(() => ({
    click: (p: any) => {
      if (mapLevel === 'china' && p.name === '四川省') {
        setMapLevel('sichuan');
      }
    },
  }), [mapLevel]);

  // ── 出险频度同比图 ──
  const yoyChartOption = useMemo(() => {
    const data = frequencyYoy.data;
    if (!data.length) return null;
    const labels = data.map((r: any) => `${r.year}Q${r.quarter}`);
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['出险频度(‰)', '人伤占比(%)'] },
      xAxis: { type: 'category' as const, data: labels, axisLabel: { rotate: 45 } },
      yAxis: [
        { type: 'value' as const, name: '频度(‰)' },
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
  }, [frequencyYoy.data]);

  const isLoading = geoAccident.loading || geoPlate.loading;
  const error = geoAccident.error || geoPlate.error;

  if (error) return <div className={cn(colorClasses.text.danger, 'p-4')}>{error}</div>;

  return (
    <div className="space-y-6">
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
              {mapLevel === 'china' ? '全国出险地分省热力图' : '四川省出险地分城市热力图'}
            </h3>
            {mapLevel === 'sichuan' && (
              <button
                onClick={() => setMapLevel('china')}
                className={cn(
                  'px-2 py-0.5 text-xs rounded border transition-colors',
                  'border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                )}
              >
                ← 返回全国
              </button>
            )}
            {mapLevel === 'china' && (
              <span className={cn(colorClasses.text.neutralMuted, 'text-xs')}>
                点击四川省可下钻查看城市分布
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
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-neutral-700 dark:text-gray-300'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="h-[500px] flex items-center justify-center">加载中...</div>
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
              <table className={tableStyles.base}>
                <thead className="sticky top-0 bg-white dark:bg-neutral-800">
                  <tr>
                    <th className={tableStyles.th}>城市</th>
                    <th className={cn(tableStyles.th, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.th, 'text-right')}>立案金额(万)</th>
                    <th className={cn(tableStyles.th, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.th, 'text-right')}>人伤占比</th>
                    <th className={cn(tableStyles.th, 'text-right')}>理赔周期</th>
                  </tr>
                </thead>
                <tbody>
                  {geoAccident.data.slice(0, 25).map((r: any, i: number) => (
                    <tr key={i} className={tableStyles.tr}>
                      <td className={tableStyles.td}>{extractCityName(r.city ?? '')}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatCount(r.cases ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatCount(r.reserve_wan ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatCount(r.avg_reserve ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatPercent(r.injury_pct ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{r.avg_cycle_days ?? '-'}天</td>
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
              <table className={tableStyles.base}>
                <thead className="sticky top-0 bg-white dark:bg-neutral-800">
                  <tr>
                    <th className={tableStyles.th}>城市</th>
                    <th className={cn(tableStyles.th, 'text-right')}>件数</th>
                    <th className={cn(tableStyles.th, 'text-right')}>立案金额(万)</th>
                    <th className={cn(tableStyles.th, 'text-right')}>案均</th>
                    <th className={cn(tableStyles.th, 'text-right')}>人伤占比</th>
                  </tr>
                </thead>
                <tbody>
                  {geoPlate.data.map((r: any, i: number) => (
                    <tr key={i} className={tableStyles.tr}>
                      <td className={tableStyles.td}>{r.plate_city ?? ''}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatCount(r.cases ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatCount(r.reserve_wan ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatCount(r.avg_reserve ?? 0)}</td>
                      <td className={cn(tableStyles.td, 'text-right', fontStyles.tabular)}>{formatPercent(r.injury_pct ?? 0)}</td>
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
