/**
 * GeoJSON 动态加载器
 *
 * china.json / sichuan.json 已捆绑在本地（~500KB）。
 * 其他省份从阿里 DataV GeoAtlas CDN 按需加载，内存缓存。
 *
 * 用法：
 *   await ensureMapRegistered('china');      // 全国（本地）
 *   await ensureMapRegistered('四川');        // 省份简名（四川用本地，其他从 CDN）
 */

import { echarts } from '@/shared/utils/echarts';
import { PROVINCE_ADCODE } from './province-abbrev';

// 已注册的地图名称缓存
const registeredMaps = new Set<string>();

// 正在加载的 Promise 缓存（避免重复请求）
const loadingPromises = new Map<string, Promise<string>>();

/**
 * 确保全国地图已注册
 */
async function ensureChinaMap(): Promise<void> {
  if (registeredMaps.has('china')) return;
  const chinaModule = await import('@/shared/assets/china.json');
  echarts.registerMap('china', chinaModule.default as any);
  registeredMaps.add('china');
}

/**
 * 确保某省级地图已注册
 * @param provinceName 省份简名，如 "四川"、"广东"
 * @returns 注册到 ECharts 的地图名称（province_{adcode}）
 */
async function ensureProvinceMap(provinceName: string): Promise<string> {
  const adcode = PROVINCE_ADCODE[provinceName];
  if (!adcode) throw new Error(`未知省份: ${provinceName}`);

  const mapKey = `province_${adcode}`;

  if (registeredMaps.has(mapKey)) return mapKey;

  // 四川用本地捆绑
  if (provinceName === '四川') {
    const sichuanModule = await import('@/shared/assets/sichuan.json');
    echarts.registerMap(mapKey, sichuanModule.default as any);
    registeredMaps.add(mapKey);
    return mapKey;
  }

  // 其他省从 CDN 加载（10s 超时）
  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`加载 ${provinceName} 地图失败: ${resp.status}`);

  let geoJson: unknown;
  try {
    geoJson = await resp.json();
  } catch {
    throw new Error(`${provinceName} 地图数据解析失败（响应非 JSON）`);
  }

  if (typeof geoJson !== 'object' || geoJson === null || !('features' in geoJson)) {
    throw new Error(`${provinceName} GeoJSON 格式不合法`);
  }

  echarts.registerMap(mapKey, geoJson as any);
  registeredMaps.add(mapKey);
  return mapKey;
}

/**
 * 统一入口：确保地图已注册并返回 ECharts map 名称
 *
 * @param target 'china' 或省份简名（如 "四川"、"广东"）
 * @returns ECharts registerMap 使用的地图名称
 */
export async function ensureMapRegistered(target: string): Promise<string> {
  if (target === 'china') {
    // 全国地图也用 loadingPromises 去重
    const existing = loadingPromises.get('china');
    if (existing) return existing;
    const promise = ensureChinaMap().then(() => 'china');
    loadingPromises.set('china', promise);
    try {
      return await promise;
    } finally {
      loadingPromises.delete('china');
    }
  }

  // 去重：如果同一省正在加载，等待已有 Promise
  const existing = loadingPromises.get(target);
  if (existing) return existing;

  const promise = ensureProvinceMap(target);
  loadingPromises.set(target, promise);

  try {
    return await promise;
  } finally {
    loadingPromises.delete(target);
  }
}

/**
 * 预加载全国 + 四川（首屏默认需要）
 */
export async function preloadDefaultMaps(): Promise<void> {
  await Promise.all([
    ensureMapRegistered('china'),
    ensureMapRegistered('四川'),
  ]);
}
