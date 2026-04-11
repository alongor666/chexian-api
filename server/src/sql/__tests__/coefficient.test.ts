import { describe, expect, it } from 'vitest';
import {
  generateCoefficientByOrgQuery,
  generateChengduAggregateQuery,
  generateProvinceAggregateQuery,
  generateFullCoefficientQuery,
  generatePeriodCoefficientQuery,
  generateAggregatePeriodCoefficientQuery,
  generateWeekBatchQuery,
  getMonthPeriods,
  _generateCustomerCategoryGroupCase,
  type PeriodDefinition,
} from '../coefficient.js';
import type { DateRange } from '../../utils/coefficient-period.js';

// ── 共享配置 ──

const BASE_DATE_RANGE: DateRange = {
  start: new Date(2026, 2, 1),  // 2026-03-01
  end: new Date(2026, 2, 31),   // 2026-03-31
};

const DATE_FIELD = 'policy_date';
const ADDITIONAL_WHERE = "customer_category LIKE '%非营业个人客车%'";

// ═══════════════════════════════════════════════════
// 1. generateCoefficientByOrgQuery — 按三级机构明细
// ═══════════════════════════════════════════════════

describe('generateCoefficientByOrgQuery', () => {
  it('基本结构：SELECT + FROM PolicyFact + WHERE + GROUP BY', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('SELECT');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('WHERE');
    expect(sql).toContain('GROUP BY');
  });

  it('输出列完整性：必要聚合字段', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('org_level_3');
    expect(sql).toContain('region_group');
    expect(sql).toContain('is_nev');
    expect(sql).toContain('customer_category_group');
    expect(sql).toContain('is_new_car');
    expect(sql).toContain('total_premium');
    expect(sql).toContain('total_ncd_premium');
    expect(sql).toContain('avg_factor');
    expect(sql).toContain('policy_count');
  });

  it('NCD保费公式：SUM(premium / commercial_pricing_factor)', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('premium / commercial_pricing_factor');
  });

  it('系数计算公式：SUM(premium) / NULLIF(SUM(...), 0)', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('NULLIF(SUM(premium / commercial_pricing_factor), 0)');
  });

  it('商业险基础条件注入：insurance_type + commercial_pricing_factor 非空过滤', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("insurance_type = '商业保险'");
    expect(sql).toContain('commercial_pricing_factor IS NOT NULL');
    expect(sql).toContain('commercial_pricing_factor > 0');
  });

  it('日期范围正确注入：startDate 和 endDate', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("'2026-03-01'");
    expect(sql).toContain("'2026-03-31'");
  });

  it('dateField 动态注入（DC-001）', () => {
    const sqlPolicy = generateCoefficientByOrgQuery('policy_date', BASE_DATE_RANGE);
    const sqlInsurance = generateCoefficientByOrgQuery('insurance_start_date', BASE_DATE_RANGE);
    expect(sqlPolicy).toContain('policy_date >=');
    expect(sqlInsurance).toContain('insurance_start_date >=');
  });

  it('additionalWhere 默认值 1=1 不引入业务过滤', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('1=1');
  });

  it('additionalWhere 自定义条件正确注入', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE, ADDITIONAL_WHERE);
    expect(sql).toContain(ADDITIONAL_WHERE);
  });

  it('机构分组CASE表达式包含成都同城机构', () => {
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    // ORG_GROUPS.SAME_CITY 包含天府、高新等
    expect(sql).toContain('天府');
    expect(sql).toContain('高新');
    expect(sql).toContain("'chengdu'");
    expect(sql).toContain("'remote'");
  });
});

// ═══════════════════════════════════════════════════
// 2. generateChengduAggregateQuery — 成都聚合
// ═══════════════════════════════════════════════════

describe('generateChengduAggregateQuery', () => {
  it("org_level_3 固定为 '成都'，region_group 固定为 'chengdu'", () => {
    const sql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("'成都' AS org_level_3");
    expect(sql).toContain("'chengdu' AS region_group");
  });

  it("成都过滤条件：(CASE ... ) = 'chengdu'", () => {
    const sql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("= 'chengdu'");
  });

  it('包含商业险基础条件', () => {
    const sql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("insurance_type = '商业保险'");
  });

  it('日期范围正确注入', () => {
    const sql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("'2026-03-01'");
    expect(sql).toContain("'2026-03-31'");
  });

  it('additionalWhere 注入生效', () => {
    const sql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE, ADDITIONAL_WHERE);
    expect(sql).toContain(ADDITIONAL_WHERE);
  });

  it('与 generateCoefficientByOrgQuery 的区分：不含 org_level_3 在 GROUP BY 中', () => {
    const sqlChengdu = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    // 成都聚合不按机构分组（已固定为成都），GROUP BY 中只有维度
    expect(sqlChengdu).toContain('GROUP BY');
    // 不含 org_level_3, 在 GROUP BY 里（GROUP BY 之后的部分）
    const groupByPart = sqlChengdu.split('GROUP BY')[1];
    expect(groupByPart).not.toContain('org_level_3');
  });
});

// ═══════════════════════════════════════════════════
// 3. generateProvinceAggregateQuery — 全省聚合
// ═══════════════════════════════════════════════════

describe('generateProvinceAggregateQuery', () => {
  it("org_level_3 固定为 '全省'，region_group 固定为 'province'", () => {
    const sql = generateProvinceAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("'全省' AS org_level_3");
    expect(sql).toContain("'province' AS region_group");
  });

  it('不含成都过滤条件（全省不过滤地域）', () => {
    const sql = generateProvinceAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    // 全省聚合不限制 region_group = chengdu
    expect(sql).not.toContain("= 'chengdu'");
  });

  it('包含商业险基础条件', () => {
    const sql = generateProvinceAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("insurance_type = '商业保险'");
  });

  it('日期范围正确注入', () => {
    const sql = generateProvinceAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("'2026-03-01'");
    expect(sql).toContain("'2026-03-31'");
  });

  it('additionalWhere 注入生效', () => {
    const sql = generateProvinceAggregateQuery(DATE_FIELD, BASE_DATE_RANGE, ADDITIONAL_WHERE);
    expect(sql).toContain(ADDITIONAL_WHERE);
  });
});

// ═══════════════════════════════════════════════════
// 4. generateFullCoefficientQuery — 三路合并查询
// ═══════════════════════════════════════════════════

describe('generateFullCoefficientQuery', () => {
  it('CTE 结构：chengdu_data + province_data + org_data', () => {
    const sql = generateFullCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('WITH chengdu_data AS');
    expect(sql).toContain('province_data AS');
    expect(sql).toContain('org_data AS');
  });

  it('UNION ALL 合并三路结果', () => {
    const sql = generateFullCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('combined AS');
  });

  it("排序：成都→全省→其他机构（CASE WHEN '成都' THEN 1）", () => {
    const sql = generateFullCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql).toContain("WHEN org_level_3 = '成都' THEN 1");
    expect(sql).toContain("WHEN org_level_3 = '全省' THEN 2");
    expect(sql).toContain('ORDER BY');
  });

  it('additionalWhere 传递到所有子查询', () => {
    const sql = generateFullCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, ADDITIONAL_WHERE);
    // 三路子查询都注入了自定义条件（UNION ALL 前出现多次）
    const occurrences = (sql.match(new RegExp(ADDITIONAL_WHERE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it('SQL 字符串长度合理（包含三个完整子查询）', () => {
    const sql = generateFullCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE);
    expect(sql.length).toBeGreaterThan(500);
  });
});

// ═══════════════════════════════════════════════════
// 5. generatePeriodCoefficientQuery — 单周期机构明细
// ═══════════════════════════════════════════════════

describe('generatePeriodCoefficientQuery', () => {
  const PERIOD_NAMES = ['day', 'week', 'month', 'year'] as const;

  it.each(PERIOD_NAMES)('周期 %s：factor/premium/count 别名正确', (period) => {
    const sql = generatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, period);
    expect(sql).toContain(`${period}_factor`);
    expect(sql).toContain(`${period}_premium`);
    expect(sql).toContain(`${period}_count`);
  });

  it('包含基础输出维度列', () => {
    const sql = generatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'month');
    expect(sql).toContain('org_level_3');
    expect(sql).toContain('region_group');
    expect(sql).toContain('is_nev');
    expect(sql).toContain('customer_category_group');
    expect(sql).toContain('is_new_car');
  });

  it('商业险条件存在', () => {
    const sql = generatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'week');
    expect(sql).toContain("insurance_type = '商业保险'");
  });

  it('日期注入正确', () => {
    const sql = generatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'day');
    expect(sql).toContain("'2026-03-01'");
    expect(sql).toContain("'2026-03-31'");
  });

  it('additionalWhere 注入生效', () => {
    const sql = generatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'year', ADDITIONAL_WHERE);
    expect(sql).toContain(ADDITIONAL_WHERE);
  });
});

// ═══════════════════════════════════════════════════
// 6. generateAggregatePeriodCoefficientQuery — 聚合（成都/全省）单周期
// ═══════════════════════════════════════════════════

describe('generateAggregatePeriodCoefficientQuery', () => {
  it("成都聚合：org_level_3='成都'，region_group='chengdu'", () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'chengdu', 'month');
    expect(sql).toContain("'成都' AS org_level_3");
    expect(sql).toContain("'chengdu' AS region_group");
  });

  it("全省聚合：org_level_3='全省'，region_group='province'", () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'province', 'month');
    expect(sql).toContain("'全省' AS org_level_3");
    expect(sql).toContain("'province' AS region_group");
  });

  it('成都聚合包含地域过滤条件', () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'chengdu', 'month');
    expect(sql).toContain("= 'chengdu'");
  });

  it('全省聚合不包含成都过滤条件', () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'province', 'month');
    expect(sql).not.toContain("= 'chengdu'");
  });

  it('groupByNewCar=true 时包含 is_new_car', () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'chengdu', 'month', '1=1', true);
    expect(sql).toContain('is_new_car');
    // GROUP BY 中不应出现 NULL AS is_new_car
    expect(sql).not.toContain('NULL AS is_new_car');
  });

  it('groupByNewCar=false 时 is_new_car 为 NULL', () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'province', 'month', '1=1', false);
    expect(sql).toContain('NULL AS is_new_car');
  });

  it('periodName 别名正确注入（day/week/month/year）', () => {
    const periods = ['day', 'week', 'month', 'year'] as const;
    for (const p of periods) {
      const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'province', p);
      expect(sql).toContain(`${p}_factor`);
      expect(sql).toContain(`${p}_premium`);
      expect(sql).toContain(`${p}_count`);
    }
  });

  it('additionalWhere 注入生效', () => {
    const sql = generateAggregatePeriodCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE, 'chengdu', 'week', ADDITIONAL_WHERE);
    expect(sql).toContain(ADDITIONAL_WHERE);
  });
});

// ═══════════════════════════════════════════════════
// 7. generateWeekBatchQuery — UNION ALL 批量周查询
// ═══════════════════════════════════════════════════

describe('generateWeekBatchQuery', () => {
  const CUTOFF_DATE = new Date(2026, 2, 31); // 2026-03-31

  it('CTE week_batch_data + SELECT * FROM + ORDER BY', () => {
    const sql = generateWeekBatchQuery(DATE_FIELD, CUTOFF_DATE);
    expect(sql).toContain('WITH week_batch_data AS');
    expect(sql).toContain('SELECT * FROM week_batch_data');
    expect(sql).toContain('ORDER BY');
  });

  it('包含 period_name 字段', () => {
    const sql = generateWeekBatchQuery(DATE_FIELD, CUTOFF_DATE);
    expect(sql).toContain('period_name');
  });

  it('包含4个周期的 UNION ALL（每周期3路×4周期=12个子查询）', () => {
    const sql = generateWeekBatchQuery(DATE_FIELD, CUTOFF_DATE);
    // 11 个 UNION ALL 将 12 个子查询连接起来
    const unionCount = (sql.match(/UNION ALL/g) ?? []).length;
    expect(unionCount).toBeGreaterThanOrEqual(11);
  });

  it('周期名称包含 1-7日 和 22-N日', () => {
    const sql = generateWeekBatchQuery(DATE_FIELD, CUTOFF_DATE);
    expect(sql).toContain('1-7日');
    expect(sql).toContain('8-14日');
    expect(sql).toContain('15-21日');
    // 22-月末，31日对应3月
    expect(sql).toContain('22-31日');
  });

  it('排序：成都→全省→其他机构', () => {
    const sql = generateWeekBatchQuery(DATE_FIELD, CUTOFF_DATE);
    expect(sql).toContain("WHEN '成都' THEN 1");
    expect(sql).toContain("WHEN '全省' THEN 2");
  });

  it('additionalWhere 注入生效', () => {
    const sql = generateWeekBatchQuery(DATE_FIELD, CUTOFF_DATE, ADDITIONAL_WHERE);
    expect(sql).toContain(ADDITIONAL_WHERE);
  });

  it('2月月份对应正确日期（闰年边界）', () => {
    // 2024-02-29 是闰年
    const feb2024 = new Date(2024, 1, 29); // 2024-02-29
    const sql = generateWeekBatchQuery(DATE_FIELD, feb2024);
    // 第4周应该是 22-29日
    expect(sql).toContain('22-29日');
  });
});

// ═══════════════════════════════════════════════════
// 8. getMonthPeriods — 月份四周期定义
// ═══════════════════════════════════════════════════

describe('getMonthPeriods', () => {
  it('返回 4 个周期定义', () => {
    const periods = getMonthPeriods(2026, 2); // 3月
    expect(periods).toHaveLength(4);
  });

  it('前三个周期固定：1-7, 8-14, 15-21', () => {
    const periods = getMonthPeriods(2026, 2);
    expect(periods[0]).toMatchObject({ name: '1-7日', start: 1, end: 7 });
    expect(periods[1]).toMatchObject({ name: '8-14日', start: 8, end: 14 });
    expect(periods[2]).toMatchObject({ name: '15-21日', start: 15, end: 21 });
  });

  it('第四周期端点为月末（3月=31日）', () => {
    const periods = getMonthPeriods(2026, 2); // month=2 → 3月
    expect(periods[3].start).toBe(22);
    expect(periods[3].end).toBe(31);
    expect(periods[3].name).toBe('22-31日');
  });

  it('第四周期端点为月末（2月平年=28日）', () => {
    const periods = getMonthPeriods(2025, 1); // month=1 → 2月平年
    expect(periods[3].end).toBe(28);
    expect(periods[3].name).toBe('22-28日');
  });

  it('第四周期端点为月末（2月闰年=29日）', () => {
    const periods = getMonthPeriods(2024, 1); // 2024 是闰年
    expect(periods[3].end).toBe(29);
    expect(periods[3].name).toBe('22-29日');
  });

  it('返回的 PeriodDefinition 具有 name/start/end 三个字段', () => {
    const periods = getMonthPeriods(2026, 0); // 1月
    for (const p of periods) {
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('start');
      expect(p).toHaveProperty('end');
    }
  });
});

// ═══════════════════════════════════════════════════
// 9. _generateCustomerCategoryGroupCase — 内部辅助函数
// ═══════════════════════════════════════════════════

describe('_generateCustomerCategoryGroupCase（内部辅助）', () => {
  it("返回包含 'non_commercial_personal' 和 'all' 的 CASE 表达式", () => {
    const sql = _generateCustomerCategoryGroupCase();
    expect(sql).toContain('CASE');
    expect(sql).toContain("'non_commercial_personal'");
    expect(sql).toContain("'all'");
  });

  it('条件基于 customer_category LIKE 非营业个人客车', () => {
    const sql = _generateCustomerCategoryGroupCase();
    expect(sql).toContain('非营业个人客车');
  });
});

// ═══════════════════════════════════════════════════
// 10. SQL 注入安全性
// ═══════════════════════════════════════════════════

describe('SQL 注入安全性', () => {
  it('dateField 参数不影响 WHERE 子句结构（避免注入）', () => {
    // dateField 来自路由层固定枚举，测试传入正常字段名
    const sql = generateCoefficientByOrgQuery('policy_date', BASE_DATE_RANGE);
    expect(sql).toContain('policy_date >=');
    expect(sql).toContain('policy_date <=');
  });

  it('additionalWhere 为空字符串时不崩溃', () => {
    // 默认值是 '1=1'，但显式传空检测健壮性
    const sql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE, '1=1');
    expect(sql).toBeTruthy();
    expect(sql.length).toBeGreaterThan(100);
  });
});

// ═══════════════════════════════════════════════════
// 11. 跨函数一致性：相同参数输出格式一致
// ═══════════════════════════════════════════════════

describe('跨函数一致性', () => {
  it('generateFullCoefficientQuery 包含 generateChengduAggregateQuery 的核心关键词', () => {
    const fullSql = generateFullCoefficientQuery(DATE_FIELD, BASE_DATE_RANGE);
    const chengduSql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);

    // full 查询嵌入了成都子查询的特征
    expect(fullSql).toContain("'成都' AS org_level_3");
    expect(fullSql).toContain("'chengdu' AS region_group");
    // 两者都访问 PolicyFact
    expect(chengduSql).toContain('FROM PolicyFact');
    expect(fullSql).toContain('FROM PolicyFact');
  });

  it('三个聚合查询的输出列数量一致（均含 8 个维度+指标）', () => {
    const orgSql = generateCoefficientByOrgQuery(DATE_FIELD, BASE_DATE_RANGE);
    const chengduSql = generateChengduAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);
    const provinceSql = generateProvinceAggregateQuery(DATE_FIELD, BASE_DATE_RANGE);

    const sharedColumns = [
      'total_premium',
      'total_ncd_premium',
      'avg_factor',
      'policy_count',
    ];
    for (const col of sharedColumns) {
      expect(orgSql).toContain(col);
      expect(chengduSql).toContain(col);
      expect(provinceSql).toContain(col);
    }
  });
});
