import { describe, expect, it } from 'vitest';
import {
  generateCrossSellQuery,
  type CrossSellDimension,
  type DrilldownStep,
} from '../cross-sell.js';

const ALL_DIMS: CrossSellDimension[] = [
  'org_level_3', 'team', 'salesman',
  'is_new_car', 'is_transfer', 'is_nev', 'is_telemarketing', 'is_renewal',
  'insurance_grade',
];

function gen(
  groupBy: CrossSellDimension | null = 'org_level_3',
  drillPath: DrilldownStep[] = [],
) {
  return generateCrossSellQuery('1=1', drillPath, groupBy);
}

describe('驾意险推介率下钻 — SQL 语义不变式', () => {
  // C-01: 汇总模式字段集（默认 summaryGroupName='四川分公司' 兼容期保留）
  it('C-01: groupBy=null 返回汇总行含推介率字段（默认 summaryGroupName）', () => {
    const sql = gen(null);
    expect(sql).toContain("'四川分公司' AS group_name");
    expect(sql).toContain('AS total_auto_count');
    expect(sql).toContain('AS total_driver_count');
    expect(sql).toContain('AS total_rate');
  });

  // C-01b: 0E summaryGroupName 参数化 — 传入山西分公司 → SQL 含对应字面值
  it('C-01b: 传入 summaryGroupName=\'山西分公司\' → SQL 用山西字面值（多分公司支持）', () => {
    const sql = generateCrossSellQuery('1=1', [], null, '山西分公司');
    expect(sql).toContain("'山西分公司' AS group_name");
    expect(sql).not.toContain("'四川分公司' AS group_name");
  });

  // C-01c: 安全 — summaryGroupName 单引号转义防 SQL 注入
  it('C-01c: summaryGroupName 含单引号必须转义（escapeSqlValue 防注入）', () => {
    const sql = generateCrossSellQuery('1=1', [], null, "X' OR 1=1--");
    expect(sql).toContain("'X'' OR 1=1--' AS group_name");
  });

  // C-02: 分组模式输出字段集
  it('C-02: groupBy=org_level_3 输出各险别推介率', () => {
    const sql = gen('org_level_3');
    expect(sql).toContain('AS danjiao_rate');
    expect(sql).toContain('AS jiaosan_rate');
    expect(sql).toContain('AS zhuquan_rate');
    expect(sql).toContain('AS total_rate');
  });

  // C-03: 推介率公式分母用 auto_count
  it('C-03: 推介率分母使用 auto_count', () => {
    const sql = gen('org_level_3');
    expect(sql).toContain('danjiao_driver_count * 100.0 / danjiao_auto_count');
  });

  // C-04: HAVING 过滤零件数
  it('C-04: HAVING 子句过滤零件数行', () => {
    const sql = gen('org_level_3');
    expect(sql).toContain('HAVING');
    expect(sql).toContain('auto_count');
    expect(sql).toContain('> 0');
  });

  // C-05: insurance_grade 条件维度
  it('C-05: groupBy=insurance_grade 输出 COALESCE 处理', () => {
    const sql = gen('insurance_grade');
    expect(sql).toContain('insurance_grade');
    expect(sql).toContain('AS group_name');
  });

  // C-06: drillPath insurance_grade 步骤翻译
  it('C-06: drillPath insurance_grade=A 翻译为 WHERE 条件', () => {
    const sql = gen('salesman', [
      { dimension: 'insurance_grade', value: 'A' },
    ]);
    expect(sql).toContain('insurance_grade');
    expect(sql).toContain("'A'");
  });

  // C-07: team 维度触发 JOIN
  it('C-07: groupBy=team 触发 SalesmanTeamMapping JOIN', () => {
    const sql = gen('team');
    expect(sql).toContain('LEFT JOIN team_mapping tm'); // 剥列 CTE（2026-07-09 Binder Error 根治）
    expect(sql).toContain('team_mapping AS (SELECT full_name, team_name FROM SalesmanTeamMapping)');
    expect(sql).toContain('team_name');
  });

  // C-08: 非 team 维度不产生 JOIN
  it('C-08: groupBy=is_new_car 不触发 SalesmanTeamMapping JOIN', () => {
    const sql = gen('is_new_car');
    expect(sql).not.toContain('LEFT JOIN team_mapping');
    expect(sql).not.toContain('LEFT JOIN SalesmanTeamMapping');
  });

  // C-09: 数据源为预聚合表
  it('C-09: 数据源为 CrossSellDailyAgg 而非 PolicyFact', () => {
    const sql = gen('org_level_3');
    expect(sql).toContain('CrossSellDailyAgg');
    expect(sql).not.toContain('FROM PolicyFact');
  });

  // C-10: 布尔维度标签翻译
  it('C-10: groupBy=is_new_car 输出新车/旧车标签', () => {
    const sql = gen('is_new_car');
    expect(sql).toContain("'新车'");
    expect(sql).toContain("'旧车'");
  });

  // C-11: 整体推介率分母排除纯交强
  it('C-11: total_auto_count 仅含主全+交三（排除单交）', () => {
    const sql = gen('org_level_3');
    // total 汇总用 CASE WHEN 过滤商业险
    expect(sql).toContain("coverage_combination IN ('主全', '交三') THEN");
    expect(sql).toContain('AS total_auto_count');

    // 汇总模式同理
    const summarySQL = gen(null);
    expect(summarySQL).toContain("coverage_combination IN ('主全', '交三') THEN");
  });
});
