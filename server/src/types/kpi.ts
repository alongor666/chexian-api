/**
 * KPI 相关类型定义（服务端权威类型）
 *
 * 字段均为必填，与 kpi-detail SQL 返回列一一对应。
 * 前端引用请使用 src/shared/types/kpi.ts（字段可选）。
 */

export interface KpiDetailResult {
  // 基础 KPI
  total_premium: number | bigint;
  policy_count: number | bigint;
  per_capita_premium: number | bigint;

  // 过户占比
  transfer_count: number | bigint;
  non_transfer_count: number | bigint;

  // 电销占比
  telesales_count: number | bigint;
  non_telesales_count: number | bigint;

  // 续保占比
  renewal_count: number | bigint;
  non_renewal_count: number | bigint;

  // 商业险占比（保费口径）
  commercial_premium: number | bigint;
  non_commercial_premium: number | bigint;

  // 新能源占比
  nev_count: number | bigint;
  non_nev_count: number | bigint;

  // 新车占比
  new_car_count: number | bigint;
  non_new_car_count: number | bigint;

  // 优质业务占比（category+tonnage 口径，与 kpi.ts 同定义）
  quality_business_count: number | bigint;
  non_quality_business_count: number | bigint;

  // 业务等级分布（基于 insurance_grade）
  grade_ab_count: number | bigint;
  grade_cd_count: number | bigint;
  grade_efg_count: number | bigint;

  // 险别组合占比
  coverage_danjiao_count: number | bigint;
  coverage_jiaosan_count: number | bigint;
  coverage_zhuquan_count: number | bigint;
  coverage_other_count: number | bigint;

  // 车辆类型占比
  vehicle_truck_count: number | bigint;
  vehicle_bus_count: number | bigint;
  vehicle_motorcycle_count: number | bigint;
  vehicle_other_count: number | bigint;

  // 同城/异地保费占比
  same_city_premium: number | bigint;
  remote_premium: number | bigint;
}
