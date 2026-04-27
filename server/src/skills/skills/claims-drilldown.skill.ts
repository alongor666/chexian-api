/**
 * claims-drilldown Skill — 阶段 2
 *
 * 出险下钻：基于 ClaimsDetail（赔案级明细）+ PolicyFact（按 policy_no 去重的子查询），
 * 对当期赔案做 4 个维度聚合：
 *  - 整体概览（已结/未结案件、人伤、车损、财险）
 *  - 按机构 Top N
 *  - 按出险原因 Top N
 *  - 已结案理赔时效（人伤 vs 非人伤）
 *
 * 与 sql/claims-detail.ts 同口径：DEDUPED_POLICY_SUBQUERY 模板（policy_no 去重 + HAVING SUM(premium)>0）。
 * 行级过滤：把 ctx.permissionFilter 注入到 PolicyFact 子查询 WHERE，确保 RBAC。
 */

import { z } from 'zod';
import type { Skill } from '../types.js';
import { PeriodSchema } from '../types.js';
import { runSql } from '../adapters/query-adapter.js';

const InputSchema = z.object({
  period: PeriodSchema,
  /** 客户类别白名单（可选），命中即纳入 */
  customerCategories: z.array(z.string()).optional(),
  /** 险别组合白名单（可选） */
  coverageCombinations: z.array(z.string()).optional(),
  /** 机构 Top N，默认 5 */
  topOrgN: z.number().int().min(1).max(50).default(5),
  /** 原因 Top N，默认 5 */
  topCauseN: z.number().int().min(1).max(50).default(5),
});

const OverviewSchema = z.object({
  totalCases: z.number(),
  settledCases: z.number(),
  pendingCases: z.number(),
  bodilyInjuryCases: z.number(),
  bodilyInjuryRate: z.number().nullable(),
  totalReserveWan: z.number(),
  pendingReserveWan: z.number(),
  bodilyReserveWan: z.number(),
  vehicleReserveWan: z.number(),
  propertyReserveWan: z.number(),
});

const OrgRowSchema = z.object({
  org: z.string(),
  cases: z.number(),
  reserveWan: z.number(),
  avgReserve: z.number(),
  injuryCases: z.number(),
  injuryRate: z.number().nullable(),
});

const CauseRowSchema = z.object({
  cause: z.string(),
  cases: z.number(),
  reserveWan: z.number(),
  avgReserve: z.number(),
  injuryCases: z.number(),
  injuryRate: z.number().nullable(),
});

const CycleRowSchema = z.object({
  bodilyInjury: z.boolean(),
  cases: z.number(),
  avgReportDays: z.number().nullable(),
  avgSettleDays: z.number().nullable(),
  avgPayDays: z.number().nullable(),
  avgTotalDays: z.number().nullable(),
});

const ResultSchema = z.object({
  period: PeriodSchema,
  overview: OverviewSchema,
  topByOrg: z.array(OrgRowSchema),
  topByCause: z.array(CauseRowSchema),
  cycleByInjury: z.array(CycleRowSchema),
  /** 风险信号：人伤占比异常高或赔款集中 */
  signals: z.array(z.string()),
});

type Result = z.infer<typeof ResultSchema>;

interface OverviewRow {
  total_cases: number;
  settled_cases: number;
  pending_cases: number;
  injury_cases: number;
  total_reserve: number;
  pending_reserve: number;
  bodily_reserve: number;
  vehicle_reserve: number;
  property_reserve: number;
}

interface OrgRow {
  org: string | null;
  cases: number;
  reserve_wan: number;
  avg_reserve: number;
  injury_cases: number;
  injury_pct: number | null;
}

interface CauseRow {
  accident_cause: string | null;
  cases: number;
  reserve_wan: number;
  avg_reserve: number;
  injury_cases: number;
  injury_pct: number | null;
}

interface CycleRow {
  is_bodily_injury: boolean;
  cases: number;
  avg_report_days: number | null;
  avg_settle_days: number | null;
  avg_pay_days: number | null;
  avg_total_days: number | null;
}

const escSql = (v: string): string => v.replace(/'/g, "''");

function buildPolicyDedupedSubquery(permissionFilter: string): string {
  // 与 sql/claims-detail.ts 的 DEDUPED_POLICY_SUBQUERY 同形态，但 WHERE 注入 permissionFilter
  const perm = permissionFilter || '1=1';
  return `(
    SELECT
      policy_no,
      SUM(premium) AS premium,
      ANY_VALUE(org_level_3) AS org_level_3,
      ANY_VALUE(customer_category) AS customer_category,
      ANY_VALUE(coverage_combination) AS coverage_combination
    FROM PolicyFact
    WHERE ${perm}
    GROUP BY policy_no
    HAVING SUM(premium) > 0
  )`;
}

function buildPolicyFilters(input: z.infer<typeof InputSchema>): string {
  const parts: string[] = [];
  if (input.customerCategories?.length) {
    const list = input.customerCategories.map((c) => `'${escSql(c)}'`).join(',');
    parts.push(`p.customer_category IN (${list})`);
  }
  if (input.coverageCombinations?.length) {
    const list = input.coverageCombinations.map((c) => `'${escSql(c)}'`).join(',');
    parts.push(`p.coverage_combination IN (${list})`);
  }
  return parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '';
}

export const claimsDrilldownSkill: Skill<typeof InputSchema, Result> = {
  id: 'claims-drilldown',
  name: '出险下钻',
  version: '1.0.0',
  description: '当期赔案下钻：整体概览 + 机构 Top N + 出险原因 Top N + 理赔时效',
  inputSchema: InputSchema,
  outputResultSchema: ResultSchema,
  deterministic: true,
  lazyDomains: ['ClaimsDetail'],
  async run(input, ctx) {
    const policySubquery = buildPolicyDedupedSubquery(ctx.permissionFilter);
    const policyFilters = buildPolicyFilters(input);
    const dateStart = escSql(input.period.startDate);
    const dateEnd = escSql(input.period.endDate);
    const claimsWhere = `c.accident_time >= '${dateStart}' AND c.accident_time <= '${dateEnd} 23:59:59'`;

    // 4 个查询并行
    const [overviewRows, orgRows, causeRows, cycleRows] = await Promise.all([
      runSql<OverviewRow>(`
        SELECT
          CAST(COUNT(*) AS INTEGER) AS total_cases,
          CAST(SUM(CASE WHEN c.claim_status = '已业务结案' THEN 1 ELSE 0 END) AS INTEGER) AS settled_cases,
          CAST(SUM(CASE WHEN c.claim_status = '未业务结案' THEN 1 ELSE 0 END) AS INTEGER) AS pending_cases,
          CAST(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS INTEGER) AS injury_cases,
          ROUND(SUM(c.reserve_amount) / 1e4, 2) AS total_reserve,
          ROUND(SUM(CASE WHEN c.claim_status = '未业务结案' THEN c.reserve_amount ELSE 0 END) / 1e4, 2) AS pending_reserve,
          ROUND(SUM(c.reserve_bodily_amount) / 1e4, 2) AS bodily_reserve,
          ROUND(SUM(c.reserve_vehicle_amount) / 1e4, 2) AS vehicle_reserve,
          ROUND(SUM(c.reserve_property_amount) / 1e4, 2) AS property_reserve
        FROM ClaimsDetail c
        JOIN ${policySubquery} p ON c.policy_no = p.policy_no
        WHERE ${claimsWhere}${policyFilters}
      `),
      runSql<OrgRow>(`
        SELECT
          p.org_level_3 AS org,
          CAST(COUNT(*) AS INTEGER) AS cases,
          ROUND(SUM(c.reserve_amount) / 1e4, 2) AS reserve_wan,
          ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
          CAST(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS INTEGER) AS injury_cases,
          CASE WHEN COUNT(*) > 0
            THEN ROUND(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2)
            ELSE NULL END AS injury_pct
        FROM ClaimsDetail c
        JOIN ${policySubquery} p ON c.policy_no = p.policy_no
        WHERE ${claimsWhere}${policyFilters}
        GROUP BY p.org_level_3
        ORDER BY reserve_wan DESC
        LIMIT ${input.topOrgN}
      `),
      runSql<CauseRow>(`
        SELECT
          c.accident_cause,
          CAST(COUNT(*) AS INTEGER) AS cases,
          ROUND(SUM(c.reserve_amount) / 1e4, 2) AS reserve_wan,
          ROUND(AVG(c.reserve_amount), 0) AS avg_reserve,
          CAST(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) AS INTEGER) AS injury_cases,
          CASE WHEN COUNT(*) > 0
            THEN ROUND(SUM(CASE WHEN c.is_bodily_injury THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2)
            ELSE NULL END AS injury_pct
        FROM ClaimsDetail c
        JOIN ${policySubquery} p ON c.policy_no = p.policy_no
        WHERE ${claimsWhere}${policyFilters}
        GROUP BY c.accident_cause
        ORDER BY cases DESC
        LIMIT ${input.topCauseN}
      `),
      runSql<CycleRow>(`
        SELECT
          c.is_bodily_injury,
          CAST(COUNT(*) AS INTEGER) AS cases,
          ROUND(AVG(DATEDIFF('day', c.accident_time, c.report_time)), 1) AS avg_report_days,
          ROUND(AVG(DATEDIFF('day', c.case_open_time, c.settlement_time)), 1) AS avg_settle_days,
          ROUND(AVG(DATEDIFF('day', c.settlement_time, c.payment_time)), 1) AS avg_pay_days,
          ROUND(AVG(DATEDIFF('day', c.accident_time, c.payment_time)), 1) AS avg_total_days
        FROM ClaimsDetail c
        JOIN ${policySubquery} p ON c.policy_no = p.policy_no
        WHERE ${claimsWhere}${policyFilters}
          AND c.claim_status = '已业务结案'
          AND c.payment_time IS NOT NULL
        GROUP BY c.is_bodily_injury
      `),
    ]);

    const ov = overviewRows[0] ?? {
      total_cases: 0,
      settled_cases: 0,
      pending_cases: 0,
      injury_cases: 0,
      total_reserve: 0,
      pending_reserve: 0,
      bodily_reserve: 0,
      vehicle_reserve: 0,
      property_reserve: 0,
    };
    const totalCases = Number(ov.total_cases ?? 0);
    const injuryCases = Number(ov.injury_cases ?? 0);
    const bodilyInjuryRate = totalCases > 0 ? Number(((injuryCases / totalCases) * 100).toFixed(2)) : null;

    const overview = {
      totalCases,
      settledCases: Number(ov.settled_cases ?? 0),
      pendingCases: Number(ov.pending_cases ?? 0),
      bodilyInjuryCases: injuryCases,
      bodilyInjuryRate,
      totalReserveWan: Number(ov.total_reserve ?? 0),
      pendingReserveWan: Number(ov.pending_reserve ?? 0),
      bodilyReserveWan: Number(ov.bodily_reserve ?? 0),
      vehicleReserveWan: Number(ov.vehicle_reserve ?? 0),
      propertyReserveWan: Number(ov.property_reserve ?? 0),
    };

    const topByOrg = orgRows.map((r) => ({
      org: r.org ?? '未知',
      cases: Number(r.cases ?? 0),
      reserveWan: Number(r.reserve_wan ?? 0),
      avgReserve: Number(r.avg_reserve ?? 0),
      injuryCases: Number(r.injury_cases ?? 0),
      injuryRate: r.injury_pct === null || r.injury_pct === undefined ? null : Number(r.injury_pct),
    }));

    const topByCause = causeRows.map((r) => ({
      cause: r.accident_cause ?? '未知',
      cases: Number(r.cases ?? 0),
      reserveWan: Number(r.reserve_wan ?? 0),
      avgReserve: Number(r.avg_reserve ?? 0),
      injuryCases: Number(r.injury_cases ?? 0),
      injuryRate: r.injury_pct === null || r.injury_pct === undefined ? null : Number(r.injury_pct),
    }));

    const cycleByInjury = cycleRows.map((r) => ({
      bodilyInjury: Boolean(r.is_bodily_injury),
      cases: Number(r.cases ?? 0),
      avgReportDays: r.avg_report_days === null || r.avg_report_days === undefined ? null : Number(r.avg_report_days),
      avgSettleDays: r.avg_settle_days === null || r.avg_settle_days === undefined ? null : Number(r.avg_settle_days),
      avgPayDays: r.avg_pay_days === null || r.avg_pay_days === undefined ? null : Number(r.avg_pay_days),
      avgTotalDays: r.avg_total_days === null || r.avg_total_days === undefined ? null : Number(r.avg_total_days),
    }));

    // 简单风险信号
    const signals: string[] = [];
    if (bodilyInjuryRate !== null && bodilyInjuryRate >= 15) {
      signals.push(`人伤占比 ${bodilyInjuryRate}% ≥ 15%，疑似集中性人伤风险`);
    }
    const topOrg = topByOrg[0];
    if (topOrg && overview.totalReserveWan > 0 && topOrg.reserveWan / overview.totalReserveWan >= 0.4) {
      const share = ((topOrg.reserveWan / overview.totalReserveWan) * 100).toFixed(1);
      signals.push(`机构 ${topOrg.org} 准备金占比 ${share}% ≥ 40%，赔案集中度高`);
    }
    const topCause = topByCause[0];
    if (topCause && totalCases > 0 && topCause.cases / totalCases >= 0.3) {
      const share = ((topCause.cases / totalCases) * 100).toFixed(1);
      signals.push(`出险原因「${topCause.cause}」占比 ${share}% ≥ 30%，建议核保侧专项排查`);
    }

    const warnings: string[] = [];
    if (totalCases === 0) {
      warnings.push(`period [${input.period.startDate} ~ ${input.period.endDate}] 内无赔案数据`);
    }

    return {
      result: {
        period: input.period,
        overview,
        topByOrg,
        topByCause,
        cycleByInjury,
        signals,
      },
      evidence: [
        { metric: 'total_cases', value: totalCases, source: 'ClaimsDetail', note: '按 accident_time 过滤' },
        { metric: 'bodily_injury_rate', value: bodilyInjuryRate, source: 'ClaimsDetail', note: 'is_bodily_injury / total' },
      ],
      confidence: totalCases === 0 ? 0.1 : 1.0,
      warnings,
      assumptions: [
        '日期字段使用 accident_time（赔案口径，不是 policy_date）',
        `policy_no 去重子查询 + HAVING SUM(premium)>0（与 sql/claims-detail.ts 一致）`,
        `行级过滤注入 PolicyFact 子查询: ${ctx.permissionFilter}`,
      ],
      dataLineage: [
        'ClaimsDetail',
        'PolicyFact',
        'sql/claims-detail.ts:DEDUPED_POLICY_SUBQUERY',
      ],
      nextSuggestedSkills: signals.length > 0 ? ['segment-risk-scan'] : [],
    };
  },
};
