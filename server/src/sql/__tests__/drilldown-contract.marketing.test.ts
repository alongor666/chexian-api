import { describe, expect, it } from 'vitest';
import {
  generateHolidayFreeDrilldownQuery,
  type HolidayDrillDimension,
  type HolidayDrillStep,
} from '../marketing-report.js';

const ALL_DIMS: HolidayDrillDimension[] = [
  'org_level_3', 'team', 'salesman',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing',
];

function gen(
  groupBy: HolidayDrillDimension = 'org_level_3',
  drillPath: HolidayDrillStep[] = [],
  holidayDates: string[] = ['2026-02-01'],
) {
  return generateHolidayFreeDrilldownQuery('1=1', holidayDates, groupBy, drillPath);
}

describe('假日营销自由维度下钻 — SQL 语义不变式', () => {
  // M-01: 输出字段集不变式
  it('M-01: 输出含保费万元/开单人数/开单率核心字段', () => {
    const sql = gen();
    expect(sql).toContain('AS premium_wan');
    expect(sql).toContain('AS commercial_premium_wan');
    expect(sql).toContain('AS total_salesman');
    expect(sql).toContain('AS active_salesman');
    expect(sql).toContain('AS auto_active_rate');
    expect(sql).toContain('AS commercial_active_rate');
  });

  // M-02: 空假日降级
  it('M-02: 空假日日期降级为 1900-01-01 防止空 VALUES', () => {
    const sql = gen('org_level_3', [], []);
    expect(sql).toContain("'1900-01-01'");
  });

  // M-03: team 维度触发 CTE JOIN
  it('M-03: groupBy=team 时生成 team_mapping CTE', () => {
    const sql = gen('team');
    expect(sql).toContain('team_mapping AS');
    expect(sql).toContain('LEFT JOIN team_mapping tm');
  });

  // M-04: 非 team 维度不产生 JOIN
  it('M-04: groupBy=salesman 时无 team_mapping', () => {
    const sql = gen('salesman');
    expect(sql).not.toContain('team_mapping AS');
  });

  // M-05: 布尔维度 CASE WHEN 翻译
  it('M-05: groupBy=is_nev 时输出新能源/传统燃油标签', () => {
    const sql = gen('is_nev');
    expect(sql).toContain("'新能源'");
    expect(sql).toContain("'传统燃油'");
  });

  // M-06: drillPath 生成 AND 条件
  it('M-06: drillPath 步骤翻译为 WHERE 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'org_level_3', value: '天府' },
    ]);
    expect(sql).toContain("p.org_level_3 = '天府'");
  });

  // M-07: 总业务员基数使用全量数据
  it('M-07: all_salesman CTE 计算全量基数（非仅假日）', () => {
    const sql = gen();
    expect(sql).toContain('all_salesman AS');
    expect(sql).toContain('total_by_group AS');
    expect(sql).toContain('total_salesman');
  });

  // M-08: 多步 drillPath AND 连接
  it('M-08: 多步 drillPath 产生多个 AND 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'org_level_3', value: '天府' },
      { dimension: 'is_new_car', value: '新车' },
    ]);
    expect(sql).toContain("p.org_level_3 = '天府'");
    expect(sql).toContain("p.is_new_car = 'true'");
  });

  // M-09: drillPath 含 team 时自动触发 team_mapping
  it('M-09: drillPath 含 team 步骤时也触发 team_mapping JOIN', () => {
    const sql = gen('salesman', [
      { dimension: 'team', value: 'A团队' },
    ]);
    expect(sql).toContain('team_mapping AS');
  });

  // M-10: 布尔维度 falseLabel 翻译
  it('M-10: drillPath is_nev=传统燃油 翻译为 false 条件', () => {
    const sql = gen('org_level_3', [
      { dimension: 'is_nev', value: '传统燃油' },
    ]);
    expect(sql).toContain("p.is_nev = 'false'");
  });

  // M-11: 业务员聚合键带工号防同名真人合并（2026-06-27 口径修复，跟进 PR #830）
  // 口径见业务规则字典 §业务员（聚合键 vs 展示口径 RED LINE）
  it('M-11: groupBy=salesman 聚合键带工号 + display_name 短名两级判重', () => {
    const sql = gen('salesman');
    // 聚合键 group_name 用带工号 salesman_name（selectExpr 内 p. 已被 replaceAll 为 hp.），非去工号短名
    expect(sql).toContain('hp.salesman_name AS group_name');
    expect(sql).toContain('GROUP BY hp.salesman_name');
    expect(sql).not.toContain("REGEXP_REPLACE(hp.salesman_name, '^[0-9]+', '') AS group_name");
    // display_name：短名 + 冲突两级判重（同机构同名加工号兜底 REGEXP_EXTRACT），机构后缀取 MAX(org_level_3)
    expect(sql).toContain('AS display_name');
    expect(sql).toContain("REGEXP_EXTRACT(h.group_name, '^[0-9]+')");
    expect(sql).toContain('MAX(hp.org_level_3) AS org_level_3');
  });

  // M-11b: groupBy=salesman 时注入 SalesmanDim JOIN 用归属机构
  it('M-11b: groupBy=salesman 时注入 SalesmanDim JOIN 取归属机构', () => {
    const sql = gen('salesman');
    expect(sql).toContain('LEFT JOIN SalesmanDim sd ON h.group_name = sd.full_name');
    expect(sql).toContain('COALESCE(sd.organization');
  });

  // M-12: 业务员下钻用带工号精确匹配（防同名多人）
  it('M-12: drillPath salesman 步骤用带工号精确匹配，非去工号短名', () => {
    const sql = gen('org_level_3', [
      { dimension: 'salesman', value: '118069129张丽' },
    ]);
    expect(sql).toContain("p.salesman_name = '118069129张丽'");
    expect(sql).not.toContain("REGEXP_REPLACE(p.salesman_name, '^[0-9]+', '') = '118069129张丽'");
  });
});
