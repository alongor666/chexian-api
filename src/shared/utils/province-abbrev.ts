/**
 * 省份/城市标准简称映射
 *
 * 用于地图标签显示：省份用单字简称（川、渝、粤），
 * 城市去掉"市"/"自治州"等后缀。
 */

/** 省份全名 → GeoJSON 全称（带省/市/自治区后缀） */
export const PROVINCE_TO_GEOJSON: Record<string, string> = {
  北京: '北京市', 天津: '天津市', 河北: '河北省', 山西: '山西省', 内蒙古: '内蒙古自治区',
  辽宁: '辽宁省', 吉林: '吉林省', 黑龙江: '黑龙江省',
  上海: '上海市', 江苏: '江苏省', 浙江: '浙江省', 安徽: '安徽省',
  福建: '福建省', 江西: '江西省', 山东: '山东省',
  河南: '河南省', 湖北: '湖北省', 湖南: '湖南省',
  广东: '广东省', 广西: '广西壮族自治区', 海南: '海南省',
  重庆: '重庆市', 四川: '四川省', 贵州: '贵州省', 云南: '云南省', 西藏: '西藏自治区',
  陕西: '陕西省', 甘肃: '甘肃省', 青海: '青海省', 宁夏: '宁夏回族自治区', 新疆: '新疆维吾尔自治区',
  台湾: '台湾省', 香港: '香港特别行政区', 澳门: '澳门特别行政区',
};

/** GeoJSON 全称 → 省份简名（无后缀） */
export const GEOJSON_TO_PROVINCE: Record<string, string> = Object.fromEntries(
  Object.entries(PROVINCE_TO_GEOJSON).map(([short, full]) => [full, short])
);

/** 省份简名 → 单字简称 */
export const PROVINCE_ABBREV: Record<string, string> = {
  北京: '京', 天津: '津', 河北: '冀', 山西: '晋', 内蒙古: '蒙',
  辽宁: '辽', 吉林: '吉', 黑龙江: '黑',
  上海: '沪', 江苏: '苏', 浙江: '浙', 安徽: '皖',
  福建: '闽', 江西: '赣', 山东: '鲁',
  河南: '豫', 湖北: '鄂', 湖南: '湘',
  广东: '粤', 广西: '桂', 海南: '琼',
  重庆: '渝', 四川: '川', 贵州: '黔', 云南: '滇', 西藏: '藏',
  陕西: '陕', 甘肃: '甘', 青海: '青', 宁夏: '宁', 新疆: '新',
  台湾: '台', 香港: '港', 澳门: '澳',
};

/** 省份简名 → adcode（用于从 DataV CDN 加载省级 GeoJSON） */
export const PROVINCE_ADCODE: Record<string, string> = {
  北京: '110000', 天津: '120000', 河北: '130000', 山西: '140000', 内蒙古: '150000',
  辽宁: '210000', 吉林: '220000', 黑龙江: '230000',
  上海: '310000', 江苏: '320000', 浙江: '330000', 安徽: '340000',
  福建: '350000', 江西: '360000', 山东: '370000',
  河南: '410000', 湖北: '420000', 湖南: '430000',
  广东: '440000', 广西: '450000', 海南: '460000',
  重庆: '500000', 四川: '510000', 贵州: '520000', 云南: '530000', 西藏: '540000',
  陕西: '610000', 甘肃: '620000', 青海: '630000', 宁夏: '640000', 新疆: '650000',
  台湾: '710000', 香港: '810000', 澳门: '820000',
};

/** GeoJSON 全称 → 单字简称（地图标签用） */
export function getProvinceAbbrev(geoJsonName: string): string {
  const short = GEOJSON_TO_PROVINCE[geoJsonName];
  if (short) return PROVINCE_ABBREV[short] ?? short;
  // 回退：去掉后缀
  return geoJsonName
    .replace(/(省|市|自治区|壮族自治区|维吾尔自治区|回族自治区|特别行政区)$/, '');
}

/** 城市名简称：去掉"市"/"地区"/"自治州"等后缀 */
export function getCityAbbrev(cityName: string): string {
  if (!cityName) return '';
  return cityName
    .replace(/(藏族羌族|彝族|藏族|土家族苗族|布依族苗族|壮族|哈尼族彝族|白族|傣族景颇族|傈僳族)自治州/, '')
    .replace(/(自治州|地区|林区|市)$/, '');
}

/**
 * 格式化保费万元为紧凑标签（地图固定标签用）
 * @example formatPremiumLabel(12345.6) => "1.2万"
 * @example formatPremiumLabel(0.8) => "0.8万"
 */
export function formatPremiumLabel(premiumWan: number): string {
  if (premiumWan >= 10000) {
    return `${(premiumWan / 10000).toFixed(1)}亿`;
  }
  if (premiumWan >= 1000) {
    return `${(premiumWan / 1000).toFixed(1)}千万`;
  }
  return `${Math.round(premiumWan)}万`;
}
