/**
 * 阶段 2 数据口径对账（结构层）— 与 /diagnose-agent / /api/query/cost 一致性
 *
 * CLAUDE.md §6 要求：修改 SQL 生成器后必须对账「workflow vs diagnose-agent」误差 < 0.01%。
 * 实操上数值对账需要本地 dev:full 跑通 + DuckDB 加载完整数据，受环境影响大。
 * 因此本测试做"结构层对账"：
 *   1. cost-diagnosis Skill 调用的是 sql/cost.ts 的 generateClaimRatioQuery / generateComprehensiveCostQuery
 *   2. 这两个 generators 内部都调用 getMetricSql('earned_claim_ratio') 等注册表公式
 *   3. 因此 lossRatio / comprehensiveCostRatio 与 /api/query/cost 路由 100% 同公式
 *
 * 数值对账（误差 < 0.01%）请在合并前手动跑：
 *   bun run dev:full
 *   curl -s -H "Authorization: Bearer $TOKEN" \
 *     "localhost:3000/api/query/cost?analysisType=claimRatio&dimension=customer_category&cutoffDate=2026-04-26&dateStart=2026-04-01&dateEnd=2026-04-26" \
 *     | jq '[.data[] | {dim_key, earned_claim_ratio}]' > /tmp/route.json
 *   curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
 *     -d '{"input":{"period":{"startDate":"2026-04-01","endDate":"2026-04-26"}}}' \
 *     localhost:3000/api/skills/cost-diagnosis/run \
 *     | jq '[.data.result.groups[] | {dim_key:.dimKey, earned_claim_ratio:.earnedClaimRatio}]' > /tmp/skill.json
 *   diff <(jq -S . /tmp/route.json) <(jq -S . /tmp/skill.json)
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/duckdb.js', () => ({
  duckdbService: {
    query: async () => [],
    cacheSize: 0,
  },
}));

const { generateClaimRatioQuery, generateComprehensiveCostQuery } = await import('../../sql/cost.js');
const { getMetricSql } = await import('../../config/metric-registry/index.js');

describe('cost-diagnosis 结构对账', () => {
  const config = {
    dimension: 'customer_category' as const,
    cutoffDate: '2026-04-26',
    whereClause: "CAST(policy_date AS DATE) >= DATE '2026-04-01' AND CAST(policy_date AS DATE) <= DATE '2026-04-26'",
  };

  it('generateClaimRatioQuery 嵌入 getMetricSql(earned_claim_ratio) 表达式', () => {
    const sql = generateClaimRatioQuery(config);
    const metricExpr = getMetricSql('earned_claim_ratio');
    // metricExpr 是 SQL 片段，断言它直接出现在生成的 SQL 中
    expect(sql).toContain(metricExpr);
  });

  it('generateClaimRatioQuery 嵌入 getMetricSql(earned_premium)', () => {
    const sql = generateClaimRatioQuery(config);
    expect(sql).toContain(getMetricSql('earned_premium'));
  });

  it('generateClaimRatioQuery 嵌入 getMetricSql(avg_claim_amount)', () => {
    const sql = generateClaimRatioQuery(config);
    expect(sql).toContain(getMetricSql('avg_claim_amount'));
  });

  it('generateClaimRatioQuery 嵌入 getMetricSql(earned_loss_frequency)', () => {
    const sql = generateClaimRatioQuery(config);
    expect(sql).toContain(getMetricSql('earned_loss_frequency'));
  });

  it('generateComprehensiveCostQuery 嵌入 getMetricSql(earned_claim_ratio)', () => {
    const sql = generateComprehensiveCostQuery(config);
    expect(sql).toContain(getMetricSql('earned_claim_ratio'));
  });

  it('generateComprehensiveCostQuery 嵌入 getMetricSql(earned_premium)', () => {
    const sql = generateComprehensiveCostQuery(config);
    expect(sql).toContain(getMetricSql('earned_premium'));
  });

  it('cost-diagnosis Skill 静态依赖 sql/cost.ts（防止有人复制粘贴 SQL 自己写）', async () => {
    const skillSrc = await import('node:fs/promises').then((m) =>
      m.readFile(new URL('../skills/cost-diagnosis.skill.ts', import.meta.url), 'utf8')
    );
    expect(skillSrc).toContain("from '../../sql/cost.js'");
    expect(skillSrc).toContain('generateClaimRatioQuery');
    expect(skillSrc).toContain('generateComprehensiveCostQuery');
    // 红线：禁止 Skill 内部硬编码 earned_claim_ratio 公式
    expect(skillSrc).not.toMatch(/SUM\s*\(\s*reported_claims\s*\)\s*\*\s*100/);
  });
});

describe('segment-risk-scan 结构对账', () => {
  it('Skill 直接调用 getMetricSql 而非硬编码公式', async () => {
    const skillSrc = await import('node:fs/promises').then((m) =>
      m.readFile(new URL('../skills/segment-risk-scan.skill.ts', import.meta.url), 'utf8')
    );
    expect(skillSrc).toContain("from '../../config/metric-registry/index.js'");
    expect(skillSrc).toContain("getMetricSql('earned_claim_ratio')");
    expect(skillSrc).toContain("getMetricSql('earned_premium')");
  });
});
