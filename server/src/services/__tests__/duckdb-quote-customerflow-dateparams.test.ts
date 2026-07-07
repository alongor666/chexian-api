/**
 * BACKLOG 2026-06-27-claude-8f71c0：QuoteConversion / CustomerFlow 视图无 policy_date 列。
 *
 * parseFiltersAndBuildWhere(req) 默认按 commonFilterSchema 把 startDate/endDate 拼成
 * `policy_date >= ...` 条件（server/src/utils/filter-params.ts buildConditionsFromFilterParams
 * 的 dateField 默认值）。QuoteConversion（报价视图，仅 quote_time）与 CustomerFlow（客户流向
 * 视图，仅 insurance_start_date）都不含 policy_date 列 —— 前端 hook 只发 dateStart/dateEnd /
 * dateField=insurance_start_date 不触发，但 MCP/CLI/PAT 等直传通用 startDate/endDate 的调用方
 * 必 DuckDB Binder Error（列不存在：policy_date）。
 *
 * PR #955 已在路由层修复（quote-conversion.ts buildQuoteEffectiveQuery /
 * customer-flow.ts sanitizeFlowQuery，净化副本模式）并配 18 条单测（字符串级断言）。
 * 本文件补引擎级回归：用真实 DuckDB（内存表，无需 Parquet 落盘）复现旧路径的
 * Binder Error，并验证净化后的 whereClause 在真实引擎上查询成功且日期窗口过滤生效
 * —— 防未来重构让字符串断言与引擎行为脱钩。
 *
 * 需 DuckDB 原生二进制，归入 bun run test:integration（文件名 duckdb-* 自动命中
 * vitest.integration.config.ts include，并被 vite.config.ts 同名 exclude 排除出 CI）。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { duckdbService } from '../duckdb.js';
import { commonFilterSchema, buildWhereFromFilterParams } from '../../utils/filter-params.js';
import { generateQuoteKpiQuery, type QuoteConversionFilters } from '../../sql/quote-conversion.js';
import { generateFlowSummaryQuery } from '../../sql/customer-flow.js';
import { buildQuoteEffectiveQuery } from '../../routes/query/quote-conversion.js';
import { sanitizeFlowQuery } from '../../routes/query/customer-flow.js';

/** 旧路径：不净化，直接把通用 query 喂给 commonFilterSchema（等价于修复前 parseFiltersAndBuildWhere(req) 行为） */
function legacyWhere(query: Record<string, unknown>): string {
  const parsed = commonFilterSchema.parse(query);
  return buildWhereFromFilterParams(parsed, '1=1');
}

describe('QuoteConversion / CustomerFlow 通用日期参数 Binder Error 修复（BACKLOG 8f71c0 · 引擎级回归）', () => {
  beforeAll(async () => {
    await duckdbService.init();
    // 最小 QuoteConversion 表：仅含 generateQuoteKpiQuery + buildWhere(quote_time) 引用到的列，
    // 刻意不含 policy_date（与生产视图一致），以复现 Binder Error。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE QuoteConversion AS
      SELECT * FROM (VALUES
        (TIMESTAMP '2026-01-15 10:00:00', '承保', 1000.0, 1200.0, 'S001', '续保'),
        (TIMESTAMP '2026-02-15 10:00:00', '未承保', 1000.0, 1100.0, 'S002', '续保')
      ) AS t(quote_time, is_underwritten, pure_risk_premium, final_quote_premium, salesman_no, renewal_status)
    `);
    // 最小 CustomerFlow 表：仅含 generateFlowSummaryQuery 引用到的列，刻意不含 policy_date。
    await duckdbService.query(`
      CREATE OR REPLACE TABLE CustomerFlow AS
      SELECT * FROM (VALUES
        (DATE '2026-01-20', '平安保险', NULL),
        (DATE '2026-02-20', NULL, '太平洋保险')
      ) AS t(insurance_start_date, previous_insurer, next_insurer)
    `);
  });

  afterAll(async () => {
    await duckdbService.query('DROP TABLE IF EXISTS QuoteConversion');
    await duckdbService.query('DROP TABLE IF EXISTS CustomerFlow');
    await duckdbService.close();
  });

  describe('QuoteConversion（buildQuoteEffectiveQuery 净化副本）', () => {
    it('复现：旧路径（未净化的 startDate/endDate）拼出 policy_date 条件，跑查询即 Binder Error', async () => {
      const whereClause = legacyWhere({ startDate: '2026-01-01', endDate: '2026-01-31' });
      expect(whereClause).toContain('policy_date');
      const sql = generateQuoteKpiQuery({}, whereClause);
      await expect(duckdbService.query(sql)).rejects.toThrow(/policy_date|Binder Error|does not have a column/i);
    });

    it('修复：净化后（dateStart/dateEnd 走 quote_time）查询成功，且日期窗口过滤正确（仅命中 1 月数据）', async () => {
      const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(
        { startDate: '2026-01-01', endDate: '2026-01-31' } as never,
      );
      const filters: QuoteConversionFilters = {
        dateStart: domainQuery.dateStart as string,
        dateEnd: domainQuery.dateEnd as string,
      };
      const whereClause = buildWhereFromFilterParams(commonFilterSchema.parse(commonQuery), '1=1');
      expect(whereClause).not.toContain('policy_date');

      const sql = generateQuoteKpiQuery(filters, whereClause);
      const rows = await duckdbService.query<{ total_quotes: number; total_insured: number }>(sql);
      expect(Number(rows[0].total_quotes)).toBe(1); // 仅 1 月那条命中窗口
      expect(Number(rows[0].total_insured)).toBe(1); // 1 月那条 is_underwritten='承保'
    });

    it('修复：换成 2 月窗口时命中 2 月那条（证明过滤真的按日期生效，非巧合返回全量）', async () => {
      const { domainQuery, commonQuery } = buildQuoteEffectiveQuery(
        { startDate: '2026-02-01', endDate: '2026-02-28' } as never,
      );
      const filters: QuoteConversionFilters = {
        dateStart: domainQuery.dateStart as string,
        dateEnd: domainQuery.dateEnd as string,
      };
      const whereClause = buildWhereFromFilterParams(commonFilterSchema.parse(commonQuery), '1=1');
      const sql = generateQuoteKpiQuery(filters, whereClause);
      const rows = await duckdbService.query<{ total_quotes: number; total_insured: number }>(sql);
      expect(Number(rows[0].total_quotes)).toBe(1);
      expect(Number(rows[0].total_insured)).toBe(0); // 2 月那条未承保
    });
  });

  describe('CustomerFlow（sanitizeFlowQuery 锚定 insurance_start_date）', () => {
    it('复现：旧路径（未净化的 startDate/endDate）拼出 policy_date 条件，跑查询即 Binder Error', async () => {
      const whereClause = legacyWhere({ startDate: '2026-01-01', endDate: '2026-01-31' });
      expect(whereClause).toContain('policy_date');
      const sql = generateFlowSummaryQuery({}, whereClause);
      await expect(duckdbService.query(sql)).rejects.toThrow(/policy_date|Binder Error|does not have a column/i);
    });

    it('修复：锚定 insurance_start_date 后查询成功，且日期窗口过滤正确（仅命中 1 月数据）', async () => {
      const q = sanitizeFlowQuery({ startDate: '2026-01-01', endDate: '2026-01-31' } as never);
      const whereClause = buildWhereFromFilterParams(commonFilterSchema.parse(q), '1=1');
      expect(whereClause).toContain('insurance_start_date');
      expect(whereClause).not.toContain('policy_date');

      const sql = generateFlowSummaryQuery({}, whereClause);
      const rows = await duckdbService.query<{ total_policies: number; has_previous: number; has_next: number }>(sql);
      expect(Number(rows[0].total_policies)).toBe(1); // 仅 1 月那条命中窗口
      expect(Number(rows[0].has_previous)).toBe(1);
      expect(Number(rows[0].has_next)).toBe(0);
    });

    it('修复：换成 2 月窗口时命中 2 月那条（证明过滤真的按日期生效）', async () => {
      const q = sanitizeFlowQuery({ startDate: '2026-02-01', endDate: '2026-02-28' } as never);
      const whereClause = buildWhereFromFilterParams(commonFilterSchema.parse(q), '1=1');
      const sql = generateFlowSummaryQuery({}, whereClause);
      const rows = await duckdbService.query<{ total_policies: number; has_next: number }>(sql);
      expect(Number(rows[0].total_policies)).toBe(1);
      expect(Number(rows[0].has_next)).toBe(1);
    });
  });
});
