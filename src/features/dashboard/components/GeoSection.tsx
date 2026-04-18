/**
 * 承保地理分布面板
 *
 * 默认展示四川省分城市热力图（保费），支持返回全国、点击任意省下钻。
 * Top10 省/城市在地图上显示保费固定标签。
 * 下方明细表展示车辆数、占比、保费、占比、件均保费。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts } from '@/shared/utils/echarts';
import { cardStyles, colorClasses, cn, fontStyles, tableStyles } from '@/shared/styles';
import { formatCount, formatPercent } from '@/shared/utils/formatters';
import { buildFilterParams } from '@/shared/utils/filterParams';
import { ensureMapRegistered, preloadDefaultMaps } from '@/shared/utils/geo-map-loader';
import {
  PROVINCE_TO_GEOJSON,
  GEOJSON_TO_PROVINCE,
  PROVINCE_ABBREV,
  getProvinceAbbrev,
  getCityAbbrev,
  formatPremiumLabel,
} from '@/shared/utils/province-abbrev';
import { usePolicyGeo } from '../hooks/usePolicyGeo';
import type { PolicyGeoRow } from '../hooks/usePolicyGeo';
import { useGlobalFilters } from '@/shared/contexts/FilterContext';

type MapLevel = 'china' | 'province';

/** HTML 转义（防止 tooltip XSS） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const GeoSection: React.FC = () => {
  const { filters } = useGlobalFilters();
  const { provinceData, cityData, fetchProvinceData, fetchCityData } = usePolicyGeo();

  const [mapLevel, setMapLevel] = useState<MapLevel>('province');
  const [currentProvince, setCurrentProvince] = useState<string>('四川');
  const [mapKey, setMapKey] = useState<string>(''); // ECharts registered map name
  const [mapsReady, setMapsReady] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // 构建筛选参数（复用共享函数，与页面筛选状态完整联动）
  const filterParams = useMemo(() => buildFilterParams(filters), [filters]);

  // 预加载默认地图
  useEffect(() => {
    preloadDefaultMaps()
      .then(() => setMapsReady(true))
      .catch(() => setMapError('地图资源加载失败，请刷新页面重试'));
  }, []);

  // 数据获取
  useEffect(() => {
    fetchProvinceData(filterParams);
    fetchCityData(currentProvince, filterParams);
  }, [filterParams, fetchProvinceData, fetchCityData, currentProvince]);

  // 初始化默认地图
  useEffect(() => {
    if (mapsReady) {
      ensureMapRegistered('四川').then(key => setMapKey(key)).catch(() => {});
    }
  }, [mapsReady]);

  // 下钻到某省
  const drillToProvince = useCallback(async (provinceName: string) => {
    setMapLoading(true);
    setMapError(null);
    try {
      const key = await ensureMapRegistered(provinceName);
      setMapKey(key);
      setCurrentProvince(provinceName);
      setMapLevel('province');
      fetchCityData(provinceName, filterParams);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '地图加载失败';
      setMapError(`加载 ${provinceName} 地图失败: ${msg}`);
    } finally {
      setMapLoading(false);
    }
  }, [filterParams, fetchCityData]);

  // 返回全国
  const backToChina = useCallback(async () => {
    setMapLoading(true);
    setMapError(null);
    try {
      const key = await ensureMapRegistered('china');
      setMapKey(key);
      setMapLevel('china');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '地图加载失败';
      setMapError(msg);
    } finally {
      setMapLoading(false);
    }
  }, []);

  // ── 省级地图数据（全国模式用）──
  const chinaMapData = useMemo(() => {
    return provinceData.data.map(row => ({
      name: PROVINCE_TO_GEOJSON[row.province] ?? row.province,
      value: row.premium_wan,
      ...row,
    }));
  }, [provinceData.data]);

  // ── 城市地图数据（省级下钻用）──
  const cityMapData = useMemo(() => {
    return cityData.data.map(row => ({
      name: row.city ?? '',
      value: row.premium_wan,
      ...row,
    }));
  }, [cityData.data]);

  // ── Top10 名称集合（用于固定标签判定）──
  const top10Set = useMemo(() => {
    const data = mapLevel === 'china' ? chinaMapData : cityMapData;
    const sorted = [...data].sort((a, b) => b.value - a.value);
    return new Set(sorted.slice(0, 10).map(d => d.name));
  }, [mapLevel, chinaMapData, cityMapData]);

  // ── ECharts option ──
  const mapOption = useMemo(() => {
    const isChina = mapLevel === 'china';
    const data = isChina ? chinaMapData : cityMapData;
    const values = data.map(d => d.value).filter(v => v > 0);
    const maxVal = values.length > 0 ? Math.max(...values) : 100;

    return {
      tooltip: {
        trigger: 'item' as const,
        formatter: (p: any) => {
          if (!p.data) return escapeHtml(p.name ?? '');
          const d = p.data;
          const name = isChina ? getProvinceAbbrev(p.name) : getCityAbbrev(p.name);
          return `<b>${escapeHtml(name)}</b><br/>
            车辆数: ${formatCount(d.vehicle_count)}<br/>
            保费: ${formatPremiumLabel(d.premium_wan)}<br/>
            车辆占比: ${d.vehicle_pct ?? 0}%<br/>
            保费占比: ${d.premium_pct ?? 0}%<br/>
            件均保费: ${formatCount(d.avg_premium)}元`;
        },
      },
      visualMap: {
        min: 0,
        max: maxVal,
        text: ['高', '低'],
        realtime: false,
        calculable: true,
        inRange: { color: ['#e6f4ff', '#91caff', '#4096ff', '#0958d9', '#002c8c'] },
        left: 'left',
        bottom: 20,
      },
      series: [{
        name: '保费(万)',
        type: 'map' as const,
        map: mapKey,
        roam: true,
        label: {
          show: true,
          fontSize: 10,
          formatter: (p: any) => {
            const name = isChina
              ? (GEOJSON_TO_PROVINCE[p.name] ? (PROVINCE_ABBREV[GEOJSON_TO_PROVINCE[p.name]] ?? p.name) : getProvinceAbbrev(p.name))
              : getCityAbbrev(p.name);
            if (top10Set.has(p.name) && p.data?.value > 0) {
              return `{name|${name}}\n{val|${formatPremiumLabel(p.data.value)}}`;
            }
            return isChina ? '' : name;
          },
          rich: {
            name: { fontSize: 11, fontWeight: 'bold' as const, lineHeight: 16 },
            val: { fontSize: 9, color: '#666', lineHeight: 14 },
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
  }, [mapLevel, mapKey, chinaMapData, cityMapData, top10Set]);

  // ── 地图点击：全国模式下点击省份下钻 ──
  const onMapEvents = useMemo(() => ({
    click: (p: any) => {
      if (mapLevel !== 'china') return;
      const provinceName = GEOJSON_TO_PROVINCE[p.name];
      if (provinceName) {
        void drillToProvince(provinceName);
      }
    },
  }), [mapLevel, drillToProvince]);

  // ── 当前展示的表格数据 ──
  const tableData: PolicyGeoRow[] = mapLevel === 'china' ? provinceData.data : cityData.data;
  const isLoading = provinceData.loading || cityData.loading || mapLoading;
  const dataError = provinceData.error || cityData.error;

  if (dataError) return <div className={cn(colorClasses.text.danger, 'p-4')}>{dataError}</div>;

  return (
    <div className="space-y-4">
      {/* 地图错误提示 */}
      {mapError && (
        <div className={cn(colorClasses.text.danger, 'text-sm px-4 py-2 rounded', colorClasses.bg.danger)}>
          {mapError}
        </div>
      )}

      {/* 地图热力图 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-medium">
              {mapLevel === 'china'
                ? '全国车牌归属地分省保费分布'
                : `${currentProvince}车牌归属地分城市保费分布`}
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
        </div>
        {isLoading || !mapsReady || !mapKey ? (
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

      {/* 明细表 */}
      <div className={cn(cardStyles.standard, 'p-4')}>
        <h3 className="font-medium mb-3">
          {mapLevel === 'china' ? '分省明细' : `${currentProvince}分城市明细`}
        </h3>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className={tableStyles.container}>
            <thead className="sticky top-0 bg-white dark:bg-neutral-800 z-10">
              <tr>
                <th className={tableStyles.headerCell}>{mapLevel === 'china' ? '省份' : '城市'}</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>车辆数</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>车辆占比</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>保费(万)</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>保费占比</th>
                <th className={cn(tableStyles.headerCell, 'text-right')}>件均保费</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((row) => {
                const stableKey = mapLevel === 'china'
                  ? `prov-${row.province}`
                  : `city-${row.province}-${row.city ?? ''}`;
                const displayName = mapLevel === 'china'
                  ? row.province
                  : getCityAbbrev(row.city ?? '');
                return (
                  <tr
                    key={stableKey}
                    className={cn(
                      tableStyles.row,
                      mapLevel === 'china' && 'cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-900/20'
                    )}
                    onClick={mapLevel === 'china' ? () => void drillToProvince(row.province) : undefined}
                  >
                    <td className={tableStyles.cell}>
                      {displayName}
                      {mapLevel === 'china' && (
                        <span className={cn(colorClasses.text.neutralMuted, 'text-xs ml-1')}>
                          ({PROVINCE_ABBREV[row.province] ?? ''})
                        </span>
                      )}
                    </td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>
                      {formatCount(row.vehicle_count)}
                    </td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>
                      {formatPercent(row.vehicle_pct ?? 0)}
                    </td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>
                      {formatCount(row.premium_wan)}
                    </td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>
                      {formatPercent(row.premium_pct ?? 0)}
                    </td>
                    <td className={cn(tableStyles.cell, 'text-right', fontStyles.numeric)}>
                      {formatCount(row.avg_premium)}元
                    </td>
                  </tr>
                );
              })}
              {tableData.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className={cn(tableStyles.cell, 'text-center', colorClasses.text.neutralMuted)}>
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
