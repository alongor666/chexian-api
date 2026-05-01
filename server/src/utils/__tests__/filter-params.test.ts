import { describe, it, expect } from 'vitest';
import {
  pushVehicleQuickFilterConditions,
  VEHICLE_QUICK_FILTER_VALUES,
} from '../filter-params.js';

describe('pushVehicleQuickFilterConditions — 9 case 单一来源', () => {
  it('home_car: 仅追加非营业个人客车条件', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'home_car');
    expect(conds).toEqual(["customer_category = '非营业个人客车'"]);
  });

  it('truck_1t: customer_category IN + tonnage_segment 1吨以下', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'truck_1t');
    expect(conds).toContain("customer_category IN ('营业货车', '非营业货车')");
    expect(conds).toContain("tonnage_segment = '1吨以下'");
  });

  it('truck_2_9t: 2-9吨', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'truck_2_9t');
    expect(conds).toContain("tonnage_segment = '2-9吨'");
  });

  it('truck_1_2t: 1-2吨', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'truck_1_2t');
    expect(conds).toContain("tonnage_segment = '1-2吨'");
  });

  it('motorcycle: customer_category=摩托车', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'motorcycle');
    expect(conds).toEqual(["customer_category = '摩托车'"]);
  });

  it('rental: 营业出租租赁', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'rental');
    expect(conds).toEqual(["customer_category = '营业出租租赁'"]);
  });

  it('dump: 营业货车 + 10吨以上 + LIKE %自卸%', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'dump');
    expect(conds).toEqual([
      "customer_category = '营业货车'",
      "tonnage_segment = '10吨以上'",
      "vehicle_model LIKE '%自卸%'",
    ]);
  });

  it('tractor: 营业货车 + 10吨以上 + LIKE %牵引%', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'tractor');
    expect(conds).toEqual([
      "customer_category = '营业货车'",
      "tonnage_segment = '10吨以上'",
      "vehicle_model LIKE '%牵引%'",
    ]);
  });

  it('general: 营业货车 + 10吨以上 + NOT LIKE 自卸 AND NOT LIKE 牵引', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'general');
    expect(conds).toEqual([
      "customer_category = '营业货车'",
      "tonnage_segment = '10吨以上'",
      "vehicle_model NOT LIKE '%自卸%'",
      "vehicle_model NOT LIKE '%牵引%'",
    ]);
  });

  it('prefix 参数：claims-* SQL 用 p. 别名', () => {
    const conds: string[] = [];
    pushVehicleQuickFilterConditions(conds, 'dump', 'p.');
    expect(conds[0]).toBe("p.customer_category = '营业货车'");
    expect(conds[2]).toBe("p.vehicle_model LIKE '%自卸%'");
  });

  it('未知值不抛错也不污染（未来加 case 时这里要更新）', () => {
    const conds: string[] = ['existing'];
    pushVehicleQuickFilterConditions(conds, 'nonsense_unknown');
    expect(conds).toEqual(['existing']);
  });

  it('所有 9 个 VEHICLE_QUICK_FILTER_VALUES 都至少 push 一条 customer_category 条件（防漏 case）', () => {
    expect(VEHICLE_QUICK_FILTER_VALUES).toHaveLength(9);
    for (const v of VEHICLE_QUICK_FILTER_VALUES) {
      const conds: string[] = [];
      pushVehicleQuickFilterConditions(conds, v);
      expect(
        conds.some((c) => c.includes('customer_category')),
        `case '${v}' 必须 push customer_category 条件`,
      ).toBe(true);
    }
  });
});
