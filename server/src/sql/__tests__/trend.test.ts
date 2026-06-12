import { describe, expect, it } from 'vitest';
import {
  generatePremiumTrendQuery,
  generateTotalPremiumTrendQuery,
  generateQualityBusinessTrendQuery,
  type TimeView,
} from '../trend.js';

// ── 共享常量 ──

const ALL_TIME_VIEWS: TimeView[] = ['daily', 'weekly', 'monthly'];

// ═══════════════════════════════════════════════════
// 1. generatePremiumTrendQuery（按机构分组趋势）
// ═══════════════════════════════════════════════════

describe('generatePremiumTrendQuery', () => {
  it('基本结构：WITH base_data + cumulative_stats + PolicyFact', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain('WITH base_data AS');
    expect(sql).toContain('cumulative_stats AS');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('输出列完整性：time_period / org_level_3 / premium / next_month_ratio', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain('time_period');
    expect(sql).toContain('org_level_3');
    expect(sql).toContain('premium');
    expect(sql).toContain('next_month_ratio');
  });

  it('月视图：使用 STRFTIME 格式化为 %Y-%m', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain("STRFTIME");
    expect(sql).toContain("'%Y-%m'");
  });

  it('日视图：使用 CAST AS VARCHAR', () => {
    const sql = generatePremiumTrendQuery('daily');
    expect(sql).toContain('CAST(');
    expect(sql).toContain('AS VARCHAR)');
  });

  it('周视图：使用 CONCAT + DAYOFYEAR + ISODOW', () => {
    const sql = generatePremiumTrendQuery('weekly');
    expect(sql).toContain('CONCAT(');
    expect(sql).toContain('DAYOFYEAR(');
    expect(sql).toContain('ISODOW(');
    expect(sql).toContain("'-W'");
  });

  it('周视图：使用 LPAD 补零至两位', () => {
    const sql = generatePremiumTrendQuery('weekly');
    expect(sql).toContain('LPAD(');
    expect(sql).toContain("'0'");
  });

  it('默认视角保费：使用 SUM(premium)', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain('SUM(premium)');
  });

  it('视角 policy_count：使用 COUNT(DISTINCT policy_no)', () => {
    const sql = generatePremiumTrendQuery('monthly', '1=1', 'policy_date', 'policy_count');
    expect(sql).toContain('COUNT(DISTINCT policy_no)');
  });

  it('WHERE 子句注入', () => {
    const sql = generatePremiumTrendQuery('monthly', "org_level_3 = '天府'");
    expect(sql).toContain("org_level_3 = '天府'");
  });

  it('DC-001：动态日期字段注入（insurance_start_date）', () => {
    const sql = generatePremiumTrendQuery('monthly', '1=1', 'insurance_start_date');
    expect(sql).toContain('insurance_start_date');
  });

  it('次月起保逻辑：包含 insurance_start_date 月份比较', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain('insurance_start_date');
    expect(sql).toContain('YEAR(');
    expect(sql).toContain('MONTH(');
  });

  it('累积窗口函数：ROWS UNBOUNDED PRECEDING', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain('ROWS UNBOUNDED PRECEDING');
  });

  it('按 time_period 和 org_level_3 排序', () => {
    const sql = generatePremiumTrendQuery('monthly');
    expect(sql).toContain('ORDER BY time_period, org_level_3');
  });

  it('自定义分组维度 groupDim', () => {
    const sql = generatePremiumTrendQuery('monthly', '1=1', 'policy_date', 'premium', 'customer_category');
    expect(sql).toContain('customer_category');
  });

  it('未知时间视图抛出 Unknown time view 错误', () => {
    expect(() => generatePremiumTrendQuery('quarterly' as TimeView)).toThrow('Unknown time view');
  });

  it.each(ALL_TIME_VIEWS)('时间视图 %s 生成有效 SQL（长度 > 100）', (view) => {
    const sql = generatePremiumTrendQuery(view);
    expect(sql.length).toBeGreaterThan(100);
    expect(sql).toContain('FROM PolicyFact');
  });
});

// ═══════════════════════════════════════════════════
// 2. generateTotalPremiumTrendQuery（总体趋势，不分机构）
// ═══════════════════════════════════════════════════

describe('generateTotalPremiumTrendQuery', () => {
  it('基本结构：WITH base_data + cumulative_stats + PolicyFact', () => {
    const sql = generateTotalPremiumTrendQuery('monthly');
    expect(sql).toContain('WITH base_data AS');
    expect(sql).toContain('cumulative_stats AS');
    expect(sql).toContain('FROM PolicyFact');
  });

  it('输出列：total_premium / next_month_ratio（无 org_level_3）', () => {
    const sql = generateTotalPremiumTrendQuery('monthly');
    expect(sql).toContain('total_premium');
    expect(sql).toContain('next_month_ratio');
    // 总体趋势不按机构分组
    expect(sql).not.toContain('GROUP BY org_level_3');
  });

  it('月视图：时间维度使用 STRFTIME %Y-%m', () => {
    const sql = generateTotalPremiumTrendQuery('monthly');
    expect(sql).toContain("STRFTIME");
    expect(sql).toContain("'%Y-%m'");
  });

  it('日视图：使用 CAST AS VARCHAR', () => {
    const sql = generateTotalPremiumTrendQuery('daily');
    expect(sql).toContain('CAST(');
    expect(sql).toContain('AS VARCHAR)');
  });

  it('周视图：使用 CONCAT + DAYOFYEAR + ISODOW + LPAD', () => {
    const sql = generateTotalPremiumTrendQuery('weekly');
    expect(sql).toContain('CONCAT(');
    expect(sql).toContain('DAYOFYEAR(');
    expect(sql).toContain('ISODOW(');
    expect(sql).toContain('LPAD(');
  });

  it('默认视角保费：使用 SUM(premium)', () => {
    const sql = generateTotalPremiumTrendQuery('monthly');
    expect(sql).toContain('SUM(premium)');
  });

  it('视角 policy_count：使用 COUNT(DISTINCT policy_no)', () => {
    const sql = generateTotalPremiumTrendQuery('monthly', '1=1', 'policy_date', 'policy_count');
    expect(sql).toContain('COUNT(DISTINCT policy_no)');
  });

  it('WHERE 子句注入', () => {
    const sql = generateTotalPremiumTrendQuery('monthly', "customer_category = '非营业个人客车'");
    expect(sql).toContain("customer_category = '非营业个人客车'");
  });

  it('DC-001：动态日期字段（insurance_start_date）', () => {
    const sql = generateTotalPremiumTrendQuery('monthly', '1=1', 'insurance_start_date');
    expect(sql).toContain('insurance_start_date');
  });

  it('累积窗口函数：PARTITION BY month_key', () => {
    const sql = generateTotalPremiumTrendQuery('monthly');
    expect(sql).toContain('PARTITION BY month_key');
    expect(sql).toContain('ROWS UNBOUNDED PRECEDING');
  });

  it('只按 time_period 排序（无 org_level_3）', () => {
    const sql = generateTotalPremiumTrendQuery('monthly');
    expect(sql).toContain('ORDER BY time_period');
  });

  it('未知时间视图抛出 Unknown time view 错误', () => {
    expect(() => generateTotalPremiumTrendQuery('yearly' as TimeView)).toThrow('Unknown time view');
  });

  it.each(ALL_TIME_VIEWS)('时间视图 %s 生成有效 SQL（长度 > 100）', (view) => {
    const sql = generateTotalPremiumTrendQuery(view);
    expect(sql.length).toBeGreaterThan(100);
    expect(sql).toContain('FROM PolicyFact');
  });
});

// ═══════════════════════════════════════════════════
// 3. generateQualityBusinessTrendQuery（优质业务占比趋势）
// ═══════════════════════════════════════════════════

describe('generateQualityBusinessTrendQuery', () => {
  it('基本结构：SELECT + FROM PolicyFact + GROUP BY + ORDER BY', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('ORDER BY time_period');
  });

  it('输出列：time_period / quality_premium / total_premium / quality_ratio', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain('time_period');
    expect(sql).toContain('quality_premium');
    expect(sql).toContain('total_premium');
    expect(sql).toContain('quality_ratio');
  });

  it('优质业务定义：非新能源 + 客户类别条件', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain('is_nev = false');
    expect(sql).toContain('非营业个人');
  });

  it('优质业务定义：货车 + 吨位分段条件', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain('货车');
    expect(sql).toContain('tonnage_segment');
    expect(sql).toContain("'1吨以下'");
    expect(sql).toContain("'2-9吨'");
  });

  it('占比分母防零：WHEN > 0 THEN ... ELSE 0', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain('> 0 THEN');
    expect(sql).toContain('ELSE 0');
  });

  it('月视图：使用 STRFTIME %Y-%m', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain("STRFTIME");
    expect(sql).toContain("'%Y-%m'");
  });

  it('日视图：使用 CAST AS VARCHAR', () => {
    const sql = generateQualityBusinessTrendQuery('daily');
    expect(sql).toContain('CAST(');
    expect(sql).toContain('AS VARCHAR)');
  });

  it('周视图：使用 CONCAT + DAYOFYEAR + LPAD', () => {
    const sql = generateQualityBusinessTrendQuery('weekly');
    expect(sql).toContain('CONCAT(');
    expect(sql).toContain('DAYOFYEAR(');
    expect(sql).toContain('LPAD(');
  });

  it('默认视角保费：SUM(premium) 聚合', () => {
    const sql = generateQualityBusinessTrendQuery('monthly');
    expect(sql).toContain('SUM(premium)');
  });

  it('视角 policy_count：COUNT(*) 聚合', () => {
    const sql = generateQualityBusinessTrendQuery('monthly', '1=1', 'policy_date', 'policy_count');
    expect(sql).toContain('COUNT(');
  });

  it('WHERE 子句注入', () => {
    const sql = generateQualityBusinessTrendQuery('monthly', "org_level_3 = '乐山'");
    expect(sql).toContain("org_level_3 = '乐山'");
  });

  it('DC-001：动态日期字段（insurance_start_date）', () => {
    const sql = generateQualityBusinessTrendQuery('monthly', '1=1', 'insurance_start_date');
    expect(sql).toContain('insurance_start_date');
  });

  it('未知时间视图抛出 Unknown time view 错误', () => {
    expect(() => generateQualityBusinessTrendQuery('quarterly' as TimeView)).toThrow('Unknown time view');
  });

  it.each(ALL_TIME_VIEWS)('时间视图 %s 生成有效 SQL（长度 > 100）', (view) => {
    const sql = generateQualityBusinessTrendQuery(view);
    expect(sql.length).toBeGreaterThan(100);
    expect(sql).toContain('FROM PolicyFact');
  });
});

// ═══════════════════════════════════════════════════
// 6. 跨函数一致性验证
// ═══════════════════════════════════════════════════

describe('跨函数 SQL 一致性', () => {
  it('所有函数在月视图下都引用 PolicyFact', () => {
    const sqls = [
      generatePremiumTrendQuery('monthly'),
      generateTotalPremiumTrendQuery('monthly'),
      generateQualityBusinessTrendQuery('monthly'),
    ];
    sqls.forEach((sql) => {
      expect(sql).toContain('PolicyFact');
    });
  });

  it('generatePremiumTrendQuery 和 generateTotalPremiumTrendQuery 在月视图下均包含次月起保逻辑', () => {
    const byOrg = generatePremiumTrendQuery('monthly');
    const total = generateTotalPremiumTrendQuery('monthly');
    expect(byOrg).toContain('insurance_start_date');
    expect(total).toContain('insurance_start_date');
  });

  it('周视图下两个趋势函数均使用相同的自然周计算逻辑（ISODOW）', () => {
    const byOrg = generatePremiumTrendQuery('weekly');
    const total = generateTotalPremiumTrendQuery('weekly');
    expect(byOrg).toContain('ISODOW(');
    expect(total).toContain('ISODOW(');
  });
});
