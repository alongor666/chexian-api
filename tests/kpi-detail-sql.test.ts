import { describe, it, expect } from 'vitest';
import { generateKpiDetailQuery } from '../server/src/sql/kpi-detail';

describe('generateKpiDetailQuery', () => {
  it('优质业务占比：使用 category+tonnage 条件，不依赖 insurance_grade', () => {
    const sql = generateKpiDetailQuery();

    expect(sql).toContain('quality_business_count');
    expect(sql).toContain('non_quality_business_count');
    // 条件来自 QUALITY_BUSINESS_CONDITION（非营业个人/企业/货车+吨位）
    expect(sql).toContain('is_nev');
    expect(sql).toContain('customer_category');
    expect(sql).toContain('tonnage_segment');
  });

  it('优质业务占比：quality_business_count 块内不应包含 insurance_grade', () => {
    const sql = generateKpiDetailQuery();

    // 找到 quality_business_count 的 CASE WHEN 块
    const match = sql.match(/CASE WHEN[\s\S]*?quality_business_count/);
    expect(match).not.toBeNull();
    // insurance_grade 不应出现在优质业务计算中
    expect(match![0]).not.toContain('insurance_grade');
  });

  it('业务等级分布：grade_ab/cd/efg 使用 insurance_grade', () => {
    const sql = generateKpiDetailQuery();

    expect(sql).toContain('grade_ab_count');
    expect(sql).toContain('grade_cd_count');
    expect(sql).toContain('grade_efg_count');
    expect(sql).toContain("insurance_grade IN ('A', 'B')");
    expect(sql).toContain("insurance_grade IN ('C', 'D')");
  });

  it('同城/异地：使用 SUM(premium) 保费口径，非 COUNT', () => {
    const sql = generateKpiDetailQuery();

    expect(sql).toContain('same_city_premium');
    expect(sql).toContain('remote_premium');
    // 必须是保费求和
    expect(sql).toMatch(/SUM\(CASE WHEN\s+(?:CAST\()?org_level_3[\s\S]*?THEN premium/);
    // 不应是 COUNT 口径
    expect(sql).not.toMatch(/COUNT\(CASE WHEN\s+(?:CAST\()?org_level_3[\s\S]*?same_city/);
  });

  it('默认承保口径：包含 premium > 0 过滤', () => {
    const sql = generateKpiDetailQuery();
    expect(sql).toContain('premium > 0');
  });

  it('净额口径（useInsuredScope=false）：不含 premium > 0', () => {
    const sql = generateKpiDetailQuery('1=1', false);
    expect(sql).not.toContain('premium > 0');
  });

  it('自定义 WHERE 条件透传', () => {
    const sql = generateKpiDetailQuery("org_level_3 = '天府'");
    expect(sql).toContain("org_level_3 = '天府'");
  });

  it('险别组合：单交/交三/主全三段', () => {
    const sql = generateKpiDetailQuery();

    expect(sql).toContain('coverage_danjiao_count');
    expect(sql).toContain('coverage_jiaosan_count');
    expect(sql).toContain('coverage_zhuquan_count');
    expect(sql).toContain("coverage_combination = '单交'");
    expect(sql).toContain("coverage_combination = '交三'");
    expect(sql).toContain("coverage_combination = '主全'");
  });

  it('车辆类型：货车/客车/摩托三段', () => {
    const sql = generateKpiDetailQuery();

    expect(sql).toContain('vehicle_truck_count');
    expect(sql).toContain('vehicle_bus_count');
    expect(sql).toContain('vehicle_motorcycle_count');
  });
});
