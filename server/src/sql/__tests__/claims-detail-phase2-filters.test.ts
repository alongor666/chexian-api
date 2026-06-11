/**
 * Phase 2：赔案明细后端补解析 — 三参数 WHERE 语义测试
 * （筛选器联动治理计划 2026-06-10，BACKLOG d0cd4b）
 *
 * 前端已发 insuranceType / enterpriseCar / fuelCategory，后端 parseFilters 静默丢弃
 * → 交/商、企客、气/油 chip 点了数据不动。修法 = parseFilters + ClaimsDetailFilters +
 * buildPolicyWhere（半连接 PolicyFact，p.* 列齐全）补三参数。
 *
 * 口径铁律：WHERE 语义照抄 SSOT server/src/utils/filter-params.ts:206-247，勿自创——
 * - insuranceType true → insurance_type = '交强险'；false → = '商业保险'
 * - fuelCategory electric → is_nev = true；gas → is_nev = false AND fuel_type LIKE '天然气%'；
 *   oil → is_nev = false AND (fuel_type IS NULL OR NOT LIKE '天然气%')
 * - enterpriseCar：home_car 并选 → IN 两类（单一条件）；单独 → = '非营业企业客车'；
 *   与其他车型并选 → 忽略（SSOT :236 行为）
 */
import { describe, expect, it } from 'vitest';
import {
  generatePendingOverviewQuery,
  type ClaimsDetailFilters,
} from '../claims-detail.js';
import {
  generateClaimsHeatmapQuery,
  type ClaimsHeatmapFilters,
} from '../claims-heatmap.js';

const sqlOf = (f: ClaimsDetailFilters) => generatePendingOverviewQuery(f);
const heatmapSqlOf = (f: ClaimsHeatmapFilters) =>
  generateClaimsHeatmapQuery(f, 'org_level_3', 'insurance_start_date', 'report_time', 2026);

describe('claims-detail buildPolicyWhere — Phase 2 三参数（SSOT 语义）', () => {
  it('insuranceType=true → 交强险；=false → 商业保险', () => {
    expect(sqlOf({ insuranceType: 'true' })).toContain("p.insurance_type = '交强险'");
    expect(sqlOf({ insuranceType: 'false' })).toContain("p.insurance_type = '商业保险'");
    expect(sqlOf({})).not.toContain('p.insurance_type');
  });

  it('fuelCategory 三分支与 SSOT 逐字一致', () => {
    expect(sqlOf({ fuelCategory: 'electric' })).toContain('p.is_nev = true');
    const gas = sqlOf({ fuelCategory: 'gas' });
    expect(gas).toContain("p.is_nev = false AND p.fuel_type LIKE '天然气%'");
    const oil = sqlOf({ fuelCategory: 'oil' });
    expect(oil).toContain("p.is_nev = false AND (p.fuel_type IS NULL OR p.fuel_type NOT LIKE '天然气%')");
  });

  it('enterpriseCar 单独 → = 非营业企业客车', () => {
    expect(sqlOf({ enterpriseCar: 'true' })).toContain("p.customer_category = '非营业企业客车'");
  });

  it('enterpriseCar + home_car 并选 → IN 两类（单一条件，SSOT 联动特例）', () => {
    const sql = sqlOf({ enterpriseCar: 'true', vehicleQuickFilter: 'home_car' });
    expect(sql).toContain("p.customer_category IN ('非营业个人客车', '非营业企业客车')");
    expect(sql).not.toContain("p.customer_category = '非营业个人客车'");
  });

  it('enterpriseCar + 其他车型并选 → 忽略企客（SSOT :236 行为）', () => {
    const sql = sqlOf({ enterpriseCar: 'true', vehicleQuickFilter: 'rental' });
    expect(sql).toContain("p.customer_category = '营业出租租赁'");
    expect(sql).not.toContain('非营业企业客车');
  });
});

describe('claims-heatmap buildPolicyWhere — Phase 2 三参数（同文件第二处解析防漂移）', () => {
  it('insuranceType / fuelCategory / enterpriseCar 生效', () => {
    expect(heatmapSqlOf({ insuranceType: 'true' })).toContain("p.insurance_type = '交强险'");
    expect(heatmapSqlOf({ fuelCategory: 'gas' })).toContain("p.is_nev = false AND p.fuel_type LIKE '天然气%'");
    expect(heatmapSqlOf({ enterpriseCar: 'true' })).toContain("p.customer_category = '非营业企业客车'");
  });

  it('enterpriseCar + home_car 联动与 claims-detail 一致', () => {
    const sql = heatmapSqlOf({ enterpriseCar: 'true', vehicleQuickFilter: 'home_car' });
    expect(sql).toContain("p.customer_category IN ('非营业个人客车', '非营业企业客车')");
  });
});
