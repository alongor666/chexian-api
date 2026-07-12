import { describe, expect, it } from 'vitest';
import { getMetric } from '../../config/metric-registry/index.js';
import {
  generateComprehensiveDimensionMetricsQuery,
  generateComprehensiveSummaryQuery,
  generateComprehensiveLossTrendQuery,
} from '../comprehensive-analysis.js';

/**
 * 守恒测试（BACKLOG 2026-07-12-claude-648977 · 审计 FIND-005 · P2）
 *
 * 背景：comprehensive-analysis.ts 中「满期赔付率」（约 118-123 行 / 253-258 行）与
 * 「满期出险率」（约 90-98 行 + 132-140 行 / 196-210 行）是手写 SQL 表达式，仅靠注释
 * （"与注册表 v2.1.0 一致" / "对齐注册表 earned_loss_frequency SSOT"）声明与指标注册表
 * （server/src/config/metric-registry/categories/cost.ts）一致。历史上发生过"注册表改了、
 * 该文件没跟上"的回归（PR#461 引入、Codex P1 复核修正的二次年化 bug，详见文件内注释）。
 *
 * 本测试做两层锁定：
 * 1. 锁定注册表 earned_claim_ratio / earned_loss_frequency 当前的 formula + sql.expression
 *    快照——注册表这两个指标的公式一旦改变，本测试立刻变红，强制维护者去核对
 *    comprehensive-analysis.ts 的手写表达式是否需要同步修正。
 * 2. 锁定 comprehensive-analysis.ts 手写表达式当前的关键片段快照——该文件单方面改动
 *    公式时同样会变红，防止"改了手写表达式但没意识到偏离了注册表 SSOT"。
 *
 * 若本测试因合法的口径修正而失败：
 * 1. 确认 metric-registry 与 comprehensive-analysis.ts 两侧的公式改动在数学上仍然等价
 *    （或已按预期一起调整）
 * 2. 同步更新本文件中的快照常量，使测试重新变绿
 */

// ── 注册表 SSOT 快照（2026-07-12 从 server/src/config/metric-registry/categories/cost.ts 抓取）──

const EXPECTED_EARNED_CLAIM_RATIO_FORMULA = {
  numerator: 'SUM(reported_claims)',
  denominator: 'SUM(premium * earned_days / policy_term)',
};

const EXPECTED_EARNED_CLAIM_RATIO_SQL = `CASE
    WHEN SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE)) > 0
    THEN SUM(reported_claims) * 100.0 / SUM(premium * CAST(earned_days AS DOUBLE) / CAST(policy_term AS DOUBLE))
    ELSE NULL
  END AS earned_claim_ratio`;

const EXPECTED_EARNED_LOSS_FREQUENCY_FORMULA = {
  numerator: 'SUM(claim_cases × policy_term / earned_days)',
  denominator: 'COUNT(DISTINCT policy_no)',
};

const EXPECTED_EARNED_LOSS_FREQUENCY_SQL = `CASE
    WHEN COUNT(DISTINCT policy_no) > 0 AND SUM(earned_days) > 0
    THEN SUM(claim_cases * 1.0 * policy_term / NULLIF(earned_days, 0))
      / COUNT(DISTINCT policy_no) * 100.0
    ELSE NULL
  END AS earned_loss_frequency`;

const BASE_WHERE = "policy_date >= '2026-01-01' AND policy_date <= '2026-03-31'";
const BASE_CUTOFF = '2026-03-31';

describe('守恒测试：满期赔付率/满期出险率 注册表 SSOT ↔ comprehensive-analysis.ts 手写表达式', () => {
  describe('第一层：注册表公式快照（注册表改动即触发）', () => {
    it('earned_claim_ratio（满期赔付率）注册表公式未偏离快照', () => {
      const metric = getMetric('earned_claim_ratio');
      expect(
        metric,
        '指标注册表中找不到 earned_claim_ratio（满期赔付率）——是否被删除或改名？comprehensive-analysis.ts 依赖此指标口径'
      ).toBeDefined();
      expect(
        metric!.formula.numerator,
        '满期赔付率分子公式已变化。请核对 server/src/sql/comprehensive-analysis.ts 中手写表达式' +
          '（generateComprehensiveDimensionMetricsQuery 约 118-123 行、generateComprehensiveLossTrendQuery 约 253-258 行）' +
          '的 reported_claims 相关计算是否仍与注册表等价，确认后同步更新本测试快照'
      ).toBe(EXPECTED_EARNED_CLAIM_RATIO_FORMULA.numerator);
      expect(
        metric!.formula.denominator,
        '满期赔付率分母公式已变化。请核对 server/src/sql/comprehensive-analysis.ts 中手写表达式' +
          '（d.earned_premium / p.earned_premium 相关计算）是否仍与注册表等价，确认后同步更新本测试快照'
      ).toBe(EXPECTED_EARNED_CLAIM_RATIO_FORMULA.denominator);
      expect(
        metric!.sql.expression,
        '满期赔付率 SQL 表达式（注册表 SSOT）已变化。comprehensive-analysis.ts 中手写的等价表达式' +
          '（dim 查询约 118-123 行、趋势查询约 253-258 行）可能需要同步修正；' +
          '汇总查询（generateComprehensiveSummaryQuery）已直接引用 getMetricSql，天然免疫此类回归'
      ).toBe(EXPECTED_EARNED_CLAIM_RATIO_SQL);
    });

    it('earned_loss_frequency（满期出险率）注册表公式未偏离快照', () => {
      const metric = getMetric('earned_loss_frequency');
      expect(
        metric,
        '指标注册表中找不到 earned_loss_frequency（满期出险率）——是否被删除或改名？comprehensive-analysis.ts 的 claim_frequency 列依赖此指标口径'
      ).toBeDefined();
      expect(
        metric!.formula.numerator,
        '满期出险率分子公式已变化。请核对 server/src/sql/comprehensive-analysis.ts 中手写表达式' +
          '（annualized_claim_cases 构造：dim 查询约 94-98 行、汇总查询约 202-206 行）是否仍与注册表等价，确认后同步更新本测试快照'
      ).toBe(EXPECTED_EARNED_LOSS_FREQUENCY_FORMULA.numerator);
      expect(
        metric!.formula.denominator,
        '满期出险率分母公式已变化。请核对 server/src/sql/comprehensive-analysis.ts 中手写表达式' +
          '（d.policy_count / COUNT(DISTINCT policy_no)，约 136-140 行 / 200-210 行）是否仍与注册表等价，确认后同步更新本测试快照'
      ).toBe(EXPECTED_EARNED_LOSS_FREQUENCY_FORMULA.denominator);
      expect(
        metric!.sql.expression,
        '满期出险率 SQL 表达式（注册表 SSOT）已变化。comprehensive-analysis.ts 中手写的 claim_frequency 列' +
          '（dim 查询约 132-140 行、汇总查询约 196-210 行）可能需要同步修正'
      ).toBe(EXPECTED_EARNED_LOSS_FREQUENCY_SQL);
    });
  });

  describe('第二层：comprehensive-analysis.ts 手写表达式快照（该文件单方面改动即触发）', () => {
    it('dim 查询：满期赔付率手写表达式（reported_claims / earned_premium 比值）未偏离', () => {
      const sql = generateComprehensiveDimensionMetricsQuery({
        dimension: 'org',
        whereClause: BASE_WHERE,
        cutoffDate: BASE_CUTOFF,
      });
      expect(
        sql,
        'generateComprehensiveDimensionMetricsQuery 中 earned_claim_ratio 手写表达式已改变，' +
          '需核对是否仍等价于注册表 earned_claim_ratio 的 reported_claims/earned_premium 比值公式'
      ).toContain('d.reported_claims * 100.0 / d.earned_premium');
    });

    it('趋势查询：满期赔付率手写表达式（reported_claims / earned_premium 比值）未偏离', () => {
      const sql = generateComprehensiveLossTrendQuery(BASE_WHERE, BASE_CUTOFF, 'monthly');
      expect(
        sql,
        'generateComprehensiveLossTrendQuery 中 earned_claim_ratio 手写表达式已改变，' +
          '需核对是否仍等价于注册表 earned_claim_ratio 的 reported_claims/earned_premium 比值公式'
      ).toContain('p.reported_claims * 100.0 / p.earned_premium');
    });

    it('汇总查询：满期赔付率直接引用注册表 SSOT（getMetricSql 输出原样出现，天然守恒）', () => {
      const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
      const metric = getMetric('earned_claim_ratio');
      expect(
        sql,
        'generateComprehensiveSummaryQuery 不再直接引用 getMetricSql(\'earned_claim_ratio\')，' +
          '已退化为手写表达式——这会重新引入 B305 类回归风险，请恢复为 getMetricSql 调用'
      ).toContain(metric!.sql.expression);
    });

    it('dim 查询：满期出险率手写表达式（annualized_claim_cases 分子构造 + policy_count 分母）未偏离', () => {
      const sql = generateComprehensiveDimensionMetricsQuery({
        dimension: 'org',
        whereClause: BASE_WHERE,
        cutoffDate: BASE_CUTOFF,
      });
      // 分子：Σ claim_cases × policy_term / earned_days（与注册表分子公式同构）
      expect(
        sql,
        'generateComprehensiveDimensionMetricsQuery 中 annualized_claim_cases 分子构造已改变，' +
          '需核对是否仍等价于注册表 earned_loss_frequency 的 SUM(claim_cases × policy_term / earned_days) 分子公式'
      ).toMatch(
        /SUM\(\s*CAST\(claim_cases AS DOUBLE\) \* CAST\(policy_term AS DOUBLE\)\s*\/ NULLIF\(CAST\(earned_days AS DOUBLE\), 0\)\s*\) AS annualized_claim_cases/
      );
      // 分母：policy_count（= COUNT(DISTINCT policy_no)），乘 100.0 转百分比
      expect(
        sql,
        'generateComprehensiveDimensionMetricsQuery 中 claim_frequency 分母/百分比构造已改变，' +
          '需核对是否仍等价于注册表 earned_loss_frequency 的 COUNT(DISTINCT policy_no) 分母公式'
      ).toContain('d.annualized_claim_cases * 100.0 / CAST(d.policy_count AS DOUBLE)');
    });

    it('汇总查询：满期出险率（claim_frequency）手写表达式未偏离', () => {
      const sql = generateComprehensiveSummaryQuery(BASE_WHERE, BASE_CUTOFF);
      expect(
        sql,
        'generateComprehensiveSummaryQuery 中 claim_frequency 手写表达式已改变，' +
          '需核对是否仍等价于注册表 earned_loss_frequency 的分子分母公式'
      ).toMatch(
        /SUM\(\s*CAST\(claim_cases AS DOUBLE\) \* CAST\(policy_term AS DOUBLE\)\s*\/ NULLIF\(CAST\(earned_days AS DOUBLE\), 0\)\s*\) \* 100\.0 \/ CAST\(COUNT\(DISTINCT policy_no\) AS DOUBLE\)/
      );
    });
  });
});
