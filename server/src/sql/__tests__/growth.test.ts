import { describe, expect, it } from 'vitest';
import {
  generateYoYGrowthQuery,
  generateMoMGrowthQuery,
  generateYTDGrowthQuery,
  generateCustomGrowthQuery,
  generateGrowthQuery,
  generateDailyGrowthWithContextQuery,
  COMMON_GROWTH_QUERIES,
  type GrowthConfig,
} from '../growth.js';

// ── 共享配置 ──

const BASE_CONFIG: GrowthConfig = {
  growthType: 'yoy',
  timeView: 'monthly',
};

// ═══════════════════════════════════════════════════
// 1. 同比增长率
// ═══════════════════════════════════════════════════

describe('generateYoYGrowthQuery', () => {
  it('基本结构：当期 vs 去年同期', () => {
    const sql = generateYoYGrowthQuery(BASE_CONFIG);
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('current_value');
    expect(sql).toContain('previous_value');
    expect(sql).toContain('growth_rate');
  });

  it('默认指标是 SUM(premium)', () => {
    const sql = generateYoYGrowthQuery(BASE_CONFIG);
    expect(sql).toContain('SUM(premium)');
  });

  it('月视图使用 DATE_TRUNC', () => {
    const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'monthly' });
    expect(sql).toContain("DATE_TRUNC('month'");
  });

  it('日视图使用 CAST AS DATE', () => {
    const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'daily' });
    expect(sql).toContain('CAST(policy_date AS DATE)');
  });

  it('WHERE 子句注入', () => {
    const sql = generateYoYGrowthQuery({
      ...BASE_CONFIG,
      whereClause: "customer_category = '非营业个人客车'",
    });
    expect(sql).toContain("customer_category = '非营业个人客车'");
  });

  it('groupBy 维度', () => {
    const sql = generateYoYGrowthQuery({
      ...BASE_CONFIG,
      groupBy: ['org_level_3'],
    });
    expect(sql).toContain('org_level_3');
  });
});

// ═══════════════════════════════════════════════════
// 2. 环比增长率
// ═══════════════════════════════════════════════════

describe('generateMoMGrowthQuery', () => {
  it('基本结构：当期 vs 上一周期', () => {
    const sql = generateMoMGrowthQuery(BASE_CONFIG);
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('growth_rate');
  });

  it('周视图使用 DATE_TRUNC week', () => {
    const sql = generateMoMGrowthQuery({ ...BASE_CONFIG, timeView: 'weekly' });
    expect(sql).toContain("DATE_TRUNC('week'");
  });
});

// ═══════════════════════════════════════════════════
// 3. YTD 累计
// ═══════════════════════════════════════════════════

describe('generateYTDGrowthQuery', () => {
  it('基本结构', () => {
    const sql = generateYTDGrowthQuery({
      ...BASE_CONFIG,
      growthType: 'ytd',
      referenceYear: 2026,
    });
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('growth_rate');
  });

  it('使用 CURRENT_DATE 获取当前年份（DC-002 Exception）', () => {
    const sql = generateYTDGrowthQuery({
      ...BASE_CONFIG,
      growthType: 'ytd',
    });
    expect(sql).toContain('EXTRACT(YEAR FROM CURRENT_DATE)');
  });
});

// ═══════════════════════════════════════════════════
// 4. 自定义对比
// ═══════════════════════════════════════════════════

describe('generateCustomGrowthQuery', () => {
  it('基本结构：自定义基期 vs 当期', () => {
    const sql = generateCustomGrowthQuery({
      ...BASE_CONFIG,
      growthType: 'custom',
      baselinePeriod: { startDate: '2025-01-01', endDate: '2025-03-31' },
      currentPeriod: { startDate: '2026-01-01', endDate: '2026-03-31' },
    });
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain("'2025-01-01'");
    expect(sql).toContain("'2026-03-31'");
  });

  // B300: currentPeriod/baselinePeriod 经 buildDateCondition 校验，恶意日期必须抛错而非拼入 SQL
  it('当期日期含注入 payload 时抛错', () => {
    expect(() =>
      generateCustomGrowthQuery({
        ...BASE_CONFIG,
        growthType: 'custom',
        baselinePeriod: { startDate: '2025-01-01', endDate: '2025-12-31' },
        currentPeriod: { startDate: "2026-01-01' OR '1'='1", endDate: '2026-03-31' },
      })
    ).toThrow(/Invalid date format/);
  });

  it('基期日期含注入 payload 时抛错', () => {
    expect(() =>
      generateCustomGrowthQuery({
        ...BASE_CONFIG,
        growthType: 'custom',
        baselinePeriod: { startDate: '2025-01-01', endDate: "2025-12-31'; DROP TABLE PolicyFact;--" },
        currentPeriod: { startDate: '2026-01-01', endDate: '2026-03-31' },
      })
    ).toThrow(/Invalid date format/);
  });
});

// ═══════════════════════════════════════════════════
// 5. 统一入口 generateGrowthQuery
// ═══════════════════════════════════════════════════

describe('generateGrowthQuery', () => {
  it('接受预设名称字符串', () => {
    const presetKeys = Object.keys(COMMON_GROWTH_QUERIES);
    expect(presetKeys.length).toBeGreaterThan(0);

    const sql = generateGrowthQuery(presetKeys[0] as keyof typeof COMMON_GROWTH_QUERIES);
    expect(sql).toContain('FROM PolicyFact');
  });

  it('接受 GrowthConfig 对象', () => {
    const sql = generateGrowthQuery(BASE_CONFIG);
    expect(sql).toContain('FROM PolicyFact');
    expect(sql).toContain('growth_rate');
  });
});

// ═══════════════════════════════════════════════════
// 6. 日度增长（带上下文）
// ═══════════════════════════════════════════════════

describe('generateDailyGrowthWithContextQuery', () => {
  it('基本结构（需要 period 配置）', () => {
    const sql = generateDailyGrowthWithContextQuery({
      ...BASE_CONFIG,
      currentPeriod: { startDate: '2026-03-01', endDate: '2026-03-31' },
      baselinePeriod: { startDate: '2025-03-01', endDate: '2025-03-31' },
    });
    expect(sql).toContain('FROM PolicyFact');
  });

  it('缺少 period 配置时抛错', () => {
    expect(() => generateDailyGrowthWithContextQuery(BASE_CONFIG)).toThrow(
      'requires both currentPeriod and baselinePeriod'
    );
  });

  // B300: daily-context 路径下 currentPeriod 直接拼 SQL，恶意日期必须抛错
  it('当期日期含注入 payload 时抛错', () => {
    expect(() =>
      generateDailyGrowthWithContextQuery({
        ...BASE_CONFIG,
        currentPeriod: { startDate: "2026-03-01' OR '1'='1", endDate: '2026-03-31' },
        baselinePeriod: { startDate: '2025-03-01', endDate: '2025-03-31' },
      })
    ).toThrow(/Invalid date format/);
  });
});

// ═══════════════════════════════════════════════════
// 7. 预设常量
// ═══════════════════════════════════════════════════

describe('COMMON_GROWTH_QUERIES', () => {
  it('所有预设都有 growthType 和 timeView', () => {
    for (const [key, preset] of Object.entries(COMMON_GROWTH_QUERIES)) {
      expect(preset).toHaveProperty('growthType');
      expect(preset).toHaveProperty('timeView');
    }
  });
});

// ═══════════════════════════════════════════════════
// 9. 时间视图覆盖
// ═══════════════════════════════════════════════════

describe('时间视图覆盖', () => {
  const views = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;

  it.each(views)('YoY + %s 生成有效 SQL', (view) => {
    const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: view });
    expect(sql.length).toBeGreaterThan(50);
    expect(sql).toContain('FROM PolicyFact');
  });

  it.each(views)('MoM + %s 生成有效 SQL', (view) => {
    const sql = generateMoMGrowthQuery({ ...BASE_CONFIG, timeView: view });
    expect(sql.length).toBeGreaterThan(50);
  });
});

// ═══════════════════════════════════════════════════
// 10. 同比/YTD 幽灵 -100% bug 回归（7a2849）
// ═══════════════════════════════════════════════════

describe('7a2849 同比/YTD 幽灵 -100% 回归', () => {
  describe('YoY 行集必须锚定当期（B306/F-02 单扫合并后由 has_current 承担旧 LEFT JOIN 语义）', () => {
    it('YoY monthly 不使用 FULL OUTER JOIN，且只保留当期出现过的分组', () => {
      const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'monthly' });
      expect(sql).not.toMatch(/FULL\s+OUTER\s+JOIN/i);
      expect(sql).toMatch(/WHERE\s+has_current\s*=\s*1/i);
    });

    it('YoY weekly 不使用 FULL OUTER JOIN，且只保留当期出现过的分组', () => {
      const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'weekly' });
      expect(sql).not.toMatch(/FULL\s+OUTER\s+JOIN/i);
      expect(sql).toMatch(/WHERE\s+has_current\s*=\s*1/i);
    });

    it('YoY 不再 COALESCE(c.time_period, p.time_period)（避免去年时点泄漏）', () => {
      const sql = generateYoYGrowthQuery(BASE_CONFIG);
      expect(sql).not.toMatch(/COALESCE\(c\.time_period,\s*p\.time_period\)/);
      // 输出 time_period 只来自 has_current=1 的 pivot 行，去年独有时点被过滤
      expect(sql).toMatch(/MAX\(CASE WHEN side = 0 THEN 1 ELSE 0 END\) AS has_current/);
    });
  });

  describe('YoY weekly 视图必须先位移再截断（保证周一边界对齐）', () => {
    it('previous_period 表达式包含 DATE_TRUNC(week, date + 1 year)', () => {
      const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'weekly' });
      expect(sql).toMatch(/DATE_TRUNC\('week',\s*\(CAST\(policy_date AS DATE\)\s*\+\s*INTERVAL\s*'1 year'\)\)/);
    });

    it('previous_period 不再使用 DATE_ADD(p.time_period, INTERVAL 1 year)', () => {
      const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'weekly' });
      expect(sql).not.toMatch(/DATE_ADD\(p\.time_period,\s*INTERVAL\s*'1 year'\)/);
    });

    it('YoY monthly 也用 shift-before-truncate', () => {
      const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, timeView: 'monthly' });
      expect(sql).toMatch(/DATE_TRUNC\('month',\s*\(CAST\(policy_date AS DATE\)\s*\+\s*INTERVAL\s*'1 year'\)\)/);
    });
  });

  describe('YTD 必须 LEFT JOIN 且 weekly 视图位移后重新 DATE_TRUNC', () => {
    it('YTD monthly 不再使用 FULL OUTER JOIN', () => {
      const sql = generateYTDGrowthQuery({ ...BASE_CONFIG, growthType: 'ytd', timeView: 'monthly' });
      expect(sql).not.toMatch(/FULL\s+OUTER\s+JOIN/i);
      expect(sql).toMatch(/LEFT\s+JOIN/i);
    });

    it('YTD weekly 在 previous_ytd 中位移后 DATE_TRUNC(week)', () => {
      const sql = generateYTDGrowthQuery({ ...BASE_CONFIG, growthType: 'ytd', timeView: 'weekly' });
      expect(sql).toMatch(/DATE_TRUNC\('week',\s*time_period\s*\+\s*INTERVAL\s*'1 year'\)/);
    });

    it('YTD 不再 COALESCE(c.time_period, p.time_period)', () => {
      const sql = generateYTDGrowthQuery({ ...BASE_CONFIG, growthType: 'ytd', timeView: 'monthly' });
      expect(sql).not.toMatch(/COALESCE\(c\.time_period,\s*p\.time_period\)/);
    });
  });

  describe('groupBy 维度场景：分组列直取，不再 COALESCE 去年值', () => {
    it('YoY + groupBy=org_level_3：分组列贯穿 pivot 直取', () => {
      const sql = generateYoYGrowthQuery({ ...BASE_CONFIG, groupBy: ['org_level_3'] });
      expect(sql).toMatch(/GROUP BY time_period, org_level_3/);
      expect(sql).not.toMatch(/COALESCE\(c\.org_level_3,\s*p\.org_level_3\)/);
    });
  });

  describe('双窗口路径（owner review 二轮修复）', () => {
    it('YoY 同时传 currentPeriod/previousPeriod → 当期/去年侧分别拼自己的日期条件', () => {
      const sql = generateYoYGrowthQuery({
        ...BASE_CONFIG,
        currentPeriod: { startDate: '2026-01-01', endDate: '2026-01-31' },
        previousPeriod: { startDate: '2025-01-01', endDate: '2025-01-31' },
      });
      // side=0（当期）绑定 2026 窗口
      expect(sql).toMatch(/sides\.side = 0[\s\S]*?'2026-01-01'[\s\S]*?'2026-01-31'/);
      // side=1（去年同期）绑定 2025 窗口
      expect(sql).toMatch(/sides\.side = 1[\s\S]*?'2025-01-01'[\s\S]*?'2025-01-31'/);
      // 两窗互不交叉：当期侧条件里不得出现 2025 窗、去年侧不得出现 2026 窗
      expect(sql).not.toMatch(/sides\.side = 0[^)]*'2025-01-01'/);
    });

    it('YoY 退化路径（仅传 currentPeriod 缺 previousPeriod）→ 不拼日期，向下兼容旧行为', () => {
      const sql = generateYoYGrowthQuery({
        ...BASE_CONFIG,
        currentPeriod: { startDate: '2026-01-01', endDate: '2026-01-31' },
      });
      // 单边 currentPeriod 不生效（成对契约），仍走 whereClause-only 路径
      expect(sql).not.toMatch(/'2026-01-01'/);
    });

    it('YTD 双窗口 → yearly_data WHERE 含两年 OR 条件', () => {
      const sql = generateYTDGrowthQuery({
        ...BASE_CONFIG,
        growthType: 'ytd',
        currentPeriod: { startDate: '2026-01-01', endDate: '2026-06-30' },
        previousPeriod: { startDate: '2025-01-01', endDate: '2025-06-30' },
      });
      expect(sql).toMatch(/yearly_data[\s\S]*?WHERE[\s\S]*?'2026-01-01'[\s\S]*?'2026-06-30'[\s\S]*?OR[\s\S]*?'2025-01-01'[\s\S]*?'2025-06-30'/);
    });

    it('YTD 退化路径 → 不拼日期 OR 条件', () => {
      const sql = generateYTDGrowthQuery({
        ...BASE_CONFIG,
        growthType: 'ytd',
      });
      expect(sql).not.toMatch(/'2026-01-01'/);
      expect(sql).not.toMatch(/'2025-01-01'/);
    });
  });
});
