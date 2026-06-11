/**
 * buildRenewalTrackerParams — 续保页筛选映射层单测
 * （筛选器联动治理计划 2026-06-10 Task 1-C，BACKLOG f5b2a3）
 *
 * 锁三件事：
 * ① 统一 buildFilterParams 全量取参后按续保后端能力裁剪（新维度默认进入，不再漏读）
 * ② 车型/企客/营非 → customerCategories 的交集语义与主站独立 AND 条件逐字一致；
 *    交集为空传 '__none__' 复现"空结果"，禁止回退（评审 🟡4）
 * ③ 续保域不可表达的维度防御性剥离（insuranceType / gas / 吨位与车型货车 chip）
 */
import { describe, it, expect } from 'vitest';
import { buildRenewalTrackerParams } from '../useRenewalTracker';
import type { AdvancedFilterState } from '../../../../shared/types';

const base: AdvancedFilterState = {} as AdvancedFilterState;

describe('buildRenewalTrackerParams — 直通白名单', () => {
  it('机构/业务员/客户类别/险别组合/四布尔直通', () => {
    const out = buildRenewalTrackerParams({
      ...base,
      org_level_3: ['天府', '高新'],
      salesman_name: ['张三'],
      customer_category: ['非营业个人客车'],
      coverage_combination: ['主全'],
      is_nev: true,
      is_new_car: false,
      is_transfer: true,
      is_renewal: false,
    });
    expect(out.orgNames).toBe('天府,高新');
    expect(out.salesmanNames).toBe('张三');
    expect(out.customerCategories).toBe('非营业个人客车');
    expect(out.coverageCombinations).toBe('主全');
    expect(out.isNev).toBe('true');
    expect(out.isNewCar).toBe('false');
    expect(out.isTransfer).toBe('true');
    expect(out.isRenewal).toBe('false');
  });

  it('时间字段不进参数（续保接口的 start/end/cutoff 独立管理）', () => {
    const out = buildRenewalTrackerParams({
      ...base,
      policy_date_start: '2026-01-01',
      policy_date_end: '2026-06-08',
      date_criteria: 'policy_date',
    });
    expect(out.startDate).toBeUndefined();
    expect(out.endDate).toBeUndefined();
    expect(out.dateField).toBeUndefined();
  });

  it('insuranceType 残留被裁剪（续保域无险类维度，chip 已隐藏）', () => {
    const out = buildRenewalTrackerParams({ ...base, insurance_type: true });
    expect(out.insuranceType).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(0);
  });
});

describe('buildRenewalTrackerParams — fuelCategory 映射', () => {
  it('oil → 油，electric → 电', () => {
    expect(buildRenewalTrackerParams({ ...base, fuel_category: 'oil' }).fuelCategories).toBe('油');
    expect(buildRenewalTrackerParams({ ...base, fuel_category: 'electric' }).fuelCategories).toBe('电');
  });

  it('gas 防御性剥离（续保域派生列无"气"值，映射会返回错误的空结果）', () => {
    const out = buildRenewalTrackerParams({ ...base, fuel_category: 'gas' });
    expect(out.fuelCategories).toBeUndefined();
  });
});

describe('buildRenewalTrackerParams — 车型/企客/营非 → customerCategories', () => {
  it('家自车 → 非营业个人客车', () => {
    const out = buildRenewalTrackerParams({ ...base, vehicle_quick_filter: 'home_car' });
    expect(out.customerCategories).toBe('非营业个人客车');
  });

  it('家自车+企客 → 两类并集（主站 home_car+enterpriseCar 联动特例）', () => {
    const out = buildRenewalTrackerParams({
      ...base,
      vehicle_quick_filter: 'home_car',
      enterprise_car: true,
    });
    expect(out.customerCategories!.split(',').sort()).toEqual(
      ['非营业个人客车', '非营业企业客车'].sort()
    );
  });

  it('营/非 → 注册表前缀派生展开（与主站 LIKE 语义一致，摩托/特种/挂车不归入）', () => {
    const commercial = buildRenewalTrackerParams({ ...base, business_nature: 'commercial' });
    expect(commercial.customerCategories!.split(',').sort()).toEqual(
      ['营业货车', '营业出租租赁', '营业公路客运', '营业城市公交'].sort()
    );
    const nonCommercial = buildRenewalTrackerParams({ ...base, business_nature: 'non_commercial' });
    expect(nonCommercial.customerCategories!.split(',').sort()).toEqual(
      ['非营业个人客车', '非营业货车', '非营业企业客车', '非营业机关客车'].sort()
    );
  });

  it('多来源 = 独立 AND 条件求交集：租网+非营 → 互斥 → __none__（不回退）', () => {
    const out = buildRenewalTrackerParams({
      ...base,
      vehicle_quick_filter: 'rental',
      business_nature: 'non_commercial',
    });
    expect(out.customerCategories).toBe('__none__');
  });

  it('高级面板类别参与交集：[营业货车]+营业 → 营业货车', () => {
    const out = buildRenewalTrackerParams({
      ...base,
      customer_category: ['营业货车'],
      business_nature: 'commercial',
    });
    expect(out.customerCategories).toBe('营业货车');
  });

  it('高级面板类别与 chip 互斥：[摩托车]+家自车 → __none__（禁止静默丢弃面板选择）', () => {
    const out = buildRenewalTrackerParams({
      ...base,
      customer_category: ['摩托车'],
      vehicle_quick_filter: 'home_car',
    });
    expect(out.customerCategories).toBe('__none__');
  });

  it('不可表达车型残留（dump/truck_1t）防御性剥离，不产生类别条件', () => {
    for (const vqf of ['dump', 'truck_1t'] as const) {
      const out = buildRenewalTrackerParams({ ...base, vehicle_quick_filter: vqf });
      expect(out.customerCategories).toBeUndefined();
    }
  });
});
