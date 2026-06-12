/**
 * KPI 详细数据 SQL 生成器
 *
 * 用途：为占比类指标生成分解数据（用于迷你环形图可视化）
 *
 * 数据口径：
 * - 承保口径（默认）：仅统计 premium > 0 的记录
 * - 净额口径：包含正/零/负保费，反映财务净值
 *
 * 关联文档：开发文档/KPI口径说明.md
 */

import { QUALITY_BUSINESS_CONDITION } from './kpi.js';
import type { KpiDetailResult } from '../types/kpi.js';
export type { KpiDetailResult } from '../types/kpi.js';

/**
 * 同城（成都地区）三级机构名单 — 同城/异地保费占比的判定依据。
 * 异地 = 非同城兜底（原实现同城/异地各自硬编码白名单，新增机构两边都不计入，
 * region 环形图分母静默缺失）。新设成都地区机构时需在此登记。
 */
export const SAME_CITY_ORGS = ['天府', '高新', '新都', '青羊', '武侯', '重客', '本部'] as const;
const sameCityList = SAME_CITY_ORGS.map((o) => `'${o}'`).join(', ');

/**
 * 生成 KPI 详细数据查询
 *
 * @param whereClause - WHERE 子句（默认 '1=1'）
 * @param useInsuredScope - 是否使用承保口径（默认 true）
 * @returns SQL 查询字符串
 */
export const generateKpiDetailQuery = (
  whereClause: string = '1=1',
  useInsuredScope: boolean = true
): string => {
  // 承保口径：仅统计 premium > 0
  // 净额口径：包含所有保费（正/零/负）
  const scopeFilter = useInsuredScope ? 'AND premium > 0' : '';

  return `
    SELECT
      -- 基础 KPI（数值类）
      SUM(premium) as total_premium,
      COUNT(DISTINCT policy_no) as policy_count,
      SUM(premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium,

      -- 过户占比（分解数据）
      COUNT(CASE WHEN is_transfer THEN 1 END) as transfer_count,
      COUNT(CASE WHEN NOT is_transfer THEN 1 END) as non_transfer_count,

      -- 电销占比（分解数据）
      COUNT(CASE WHEN is_telemarketing THEN 1 END) as telesales_count,
      COUNT(CASE WHEN NOT is_telemarketing THEN 1 END) as non_telesales_count,

      -- 续保占比（分解数据）
      COUNT(CASE WHEN is_renewal THEN 1 END) as renewal_count,
      COUNT(CASE WHEN NOT is_renewal THEN 1 END) as non_renewal_count,

      -- 商业险占比（分解数据 - 使用保费作为度量）
      SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) as commercial_premium,
      SUM(CASE WHEN insurance_type != '商业保险' THEN premium ELSE 0 END) as non_commercial_premium,

      -- 新能源占比（分解数据）
      COUNT(CASE WHEN is_nev THEN 1 END) as nev_count,
      COUNT(CASE WHEN NOT is_nev THEN 1 END) as non_nev_count,

      -- 新车占比（分解数据）
      COUNT(CASE WHEN is_new_car THEN 1 END) as new_car_count,
      COUNT(CASE WHEN NOT is_new_car THEN 1 END) as non_new_car_count,

      -- 优质业务占比（与 kpi.ts 同口径：category+tonnage 条件）
      COUNT(CASE WHEN ${QUALITY_BUSINESS_CONDITION} THEN 1 END) as quality_business_count,
      COUNT(CASE WHEN NOT (${QUALITY_BUSINESS_CONDITION}) THEN 1 END) as non_quality_business_count,

      -- 业务等级分布（AB/CD/EFG 三分，基于 insurance_grade）
      COUNT(CASE WHEN insurance_grade IN ('A', 'B') THEN 1 END) as grade_ab_count,
      COUNT(CASE WHEN insurance_grade IN ('C', 'D') THEN 1 END) as grade_cd_count,
      COUNT(CASE WHEN insurance_grade NOT IN ('A', 'B', 'C', 'D') OR insurance_grade IS NULL THEN 1 END) as grade_efg_count,

      -- 险别组合占比（分解数据）
      COUNT(CASE WHEN coverage_combination = '单交' THEN 1 END) as coverage_danjiao_count,
      COUNT(CASE WHEN coverage_combination = '交三' THEN 1 END) as coverage_jiaosan_count,
      COUNT(CASE WHEN coverage_combination = '主全' THEN 1 END) as coverage_zhuquan_count,
      COUNT(CASE WHEN coverage_combination NOT IN ('单交', '交三', '主全') THEN 1 END) as coverage_other_count,

      -- 车辆类型占比（分解数据）
      COUNT(CASE WHEN customer_category LIKE '%货车%' THEN 1 END) as vehicle_truck_count,
      COUNT(CASE WHEN customer_category LIKE '%客车%' OR customer_category = '非营业个人客车' THEN 1 END) as vehicle_bus_count,
      COUNT(CASE WHEN customer_category = '摩托车' THEN 1 END) as vehicle_motorcycle_count,
      COUNT(CASE WHEN customer_category NOT LIKE '%货车%' AND customer_category NOT LIKE '%客车%' AND customer_category != '非营业个人客车' AND customer_category != '摩托车' THEN 1 END) as vehicle_other_count,

      -- 同城/异地占比（保费口径 - 基于机构归属）；异地=非同城兜底，新机构自动归异地
      SUM(CASE WHEN CAST(org_level_3 AS VARCHAR) IN (${sameCityList}) THEN premium ELSE 0 END) as same_city_premium,
      SUM(CASE WHEN org_level_3 IS NOT NULL AND CAST(org_level_3 AS VARCHAR) NOT IN (${sameCityList}) THEN premium ELSE 0 END) as remote_premium
    FROM PolicyFact
    WHERE ${whereClause} ${scopeFilter}
  `;
};

/**
 * 辅助函数：计算占比百分比
 *
 * @param part - 部分值
 * @param total - 总计值
 * @returns 百分比（0-1之间的小数）
 */
export const calculateRate = (part: number, total: number): number => {
  if (total === 0 || total === null || total === undefined) {
    return 0;
  }
  return part / total;
};

/**
 * 辅助函数：从 KpiDetailResult 提取环形图数据
 *
 * @param kpiDetail - KPI详细数据结果
 * @param type - 指标类型
 * @returns 环形图数据数组
 */
export const extractDonutData = (
  kpiDetail: KpiDetailResult,
  type: 'transfer' | 'telesales' | 'renewal' | 'commercial' | 'nev' | 'new_car' | 'quality_business' | 'coverage_mix' | 'vehicle_type' | 'region'
): Array<{ label: string; value: number }> => {
  // 辅助函数：将 bigint 转换为 number
  const toNumber = (value: number | bigint): number =>
    typeof value === 'bigint' ? Number(value) : value;

  switch (type) {
    case 'transfer':
      return [
        { label: '过户', value: toNumber(kpiDetail.transfer_count || 0) },
        { label: '非过户', value: toNumber(kpiDetail.non_transfer_count || 0) },
      ];
    case 'telesales':
      return [
        { label: '电销', value: toNumber(kpiDetail.telesales_count || 0) },
        { label: '非电销', value: toNumber(kpiDetail.non_telesales_count || 0) },
      ];
    case 'renewal':
      return [
        { label: '续保', value: toNumber(kpiDetail.renewal_count || 0) },
        { label: '非续保', value: toNumber(kpiDetail.non_renewal_count || 0) },
      ];
    case 'commercial':
      return [
        { label: '商业险', value: toNumber(kpiDetail.commercial_premium || 0) },
        { label: '非商业险', value: toNumber(kpiDetail.non_commercial_premium || 0) },
      ];
    case 'nev':
      return [
        { label: '新能源', value: toNumber(kpiDetail.nev_count || 0) },
        { label: '非新能源', value: toNumber(kpiDetail.non_nev_count || 0) },
      ];
    case 'new_car':
      return [
        { label: '新车', value: toNumber(kpiDetail.new_car_count || 0) },
        { label: '非新车', value: toNumber(kpiDetail.non_new_car_count || 0) },
      ];
    case 'quality_business':
      return [
        { label: '优质', value: toNumber(kpiDetail.quality_business_count || 0) },
        { label: '其他', value: toNumber(kpiDetail.non_quality_business_count || 0) },
      ];
    case 'coverage_mix':
      return [
        { label: '单交', value: toNumber(kpiDetail.coverage_danjiao_count || 0) },
        { label: '交三', value: toNumber(kpiDetail.coverage_jiaosan_count || 0) },
        { label: '主全', value: toNumber(kpiDetail.coverage_zhuquan_count || 0) },
      ];
    case 'vehicle_type':
      return [
        { label: '货车', value: toNumber(kpiDetail.vehicle_truck_count || 0) },
        { label: '客车', value: toNumber(kpiDetail.vehicle_bus_count || 0) },
        { label: '摩托', value: toNumber(kpiDetail.vehicle_motorcycle_count || 0) },
      ];
    case 'region':
      return [
        { label: '同城', value: toNumber(kpiDetail.same_city_premium || 0) },
        { label: '异地', value: toNumber(kpiDetail.remote_premium || 0) },
      ];
    default:
      return [];
  }
};
