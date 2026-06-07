import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

import {
  inspectWarehouse,
  fetchLocalSeries,
  SQL_TEMPLATES,
  // @ts-expect-error mjs without types
} from '../../scripts/prepublish-gate/lib/fetch-local-metrics.mjs';

describe('fetch-local-metrics SQL_TEMPLATES', () => {
  it('四个 source 都注册了 SQL 模板', () => {
    expect(Object.keys(SQL_TEMPLATES).sort()).toEqual([
      'claims_detail.monthly_claim_amount',
      'claims_detail.monthly_claim_count',
      'policy_dedup.monthly_policy_count',
      'policy_dedup.monthly_premium',
    ]);
  });

  it('monthly_premium 模板含 policy_dedup CTE 与 HAVING SUM(premium) > 0（B252 SSOT）', () => {
    const sql = SQL_TEMPLATES['policy_dedup.monthly_premium']({ policyGlob: '/x/policy/*.parquet' });
    expect(sql).toContain('policy_dedup AS');
    expect(sql).toContain('SUM(premium)');
    expect(sql).toContain('HAVING SUM(premium) > 0');
    expect(sql).toContain('GROUP BY policy_no, CAST(insurance_start_date AS DATE)');
    expect(sql).toContain('/x/policy/*.parquet');
    expect(sql).toContain("strftime(start_date, '%Y-%m')");
  });

  it('monthly_policy_count 模板用 COUNT DISTINCT policy_no（不重复计同保单）', () => {
    const sql = SQL_TEMPLATES['policy_dedup.monthly_policy_count']({ policyGlob: '/x/*.parquet' });
    expect(sql).toContain('COUNT(DISTINCT policy_no)');
    expect(sql).toContain('HAVING SUM(premium) > 0');
  });

  it('monthly_claim_amount 口径锚定 ClaimsAgg SSOT：CASE settlement_time + 过滤无责/零结/注销/拒赔', () => {
    const sql = SQL_TEMPLATES['claims_detail.monthly_claim_amount']({ claimsGlob: '/x/claims/*.parquet' });
    expect(sql).toContain('settled_amount');
    expect(sql).toContain('reserve_amount');
    expect(sql).toContain('settlement_time IS NOT NULL'); // 已结案取 settled、未结案取 reserve
    expect(sql).toContain('liability_ratio'); // 剔除无责案件
    expect(sql).toContain("case_type NOT IN ('零结','注销','拒赔')"); // 剔除零结/注销/拒赔
    // 不再 settled + reserve 二者相加（已结案残留 reserve 会双计）
    expect(sql).not.toContain('COALESCE(settled_amount, 0) + COALESCE(reserve_amount, 0)');
    expect(sql).toContain('accident_time IS NOT NULL');
    expect(sql).toContain('/x/claims/*.parquet');
  });

  it('monthly_claim_count 模板用 COUNT DISTINCT claim_no', () => {
    const sql = SQL_TEMPLATES['claims_detail.monthly_claim_count']({ claimsGlob: '/x/*.parquet' });
    expect(sql).toContain('COUNT(DISTINCT claim_no)');
    expect(sql).toContain('accident_time IS NOT NULL');
  });

  it('所有分区 glob 读取都带 union_by_name=true（对齐生产加载器，容忍混合分片 schema 漂移，codex PR #513 P1）', () => {
    const ctx = { policyGlob: '/x/policy/*.parquet', claimsGlob: '/x/claims/*.parquet', monthStart: '2026-06-01' };
    for (const [source, tmpl] of Object.entries(SQL_TEMPLATES)) {
      const sql = (tmpl as (c: typeof ctx) => string)(ctx);
      expect(sql, `${source} 应带 union_by_name`).toContain('union_by_name=true');
      expect(sql, `${source} 不应有裸 read_parquet('<glob>')`).not.toMatch(/read_parquet\('[^']+'\)/);
    }
  });

  it('注入 monthStart → 用 < DATE 业务月首日（与发布机时区解耦，codex PR #513 P2）', () => {
    // policy 系列（预签未来起期保单）和 claims 系列（迟到报案）都必须排除不完整月，
    // 否则 cutoff 当月会因分母小被误判为断崖。monthStart 由编排器按 Asia/Shanghai 注入。
    const policySql = SQL_TEMPLATES['policy_dedup.monthly_premium']({ policyGlob: '/x/*.parquet', monthStart: '2026-06-01' });
    expect(policySql).toContain("insurance_start_date < DATE '2026-06-01'");
    expect(policySql).not.toContain('current_date');

    const claimsSql = SQL_TEMPLATES['claims_detail.monthly_claim_amount']({ claimsGlob: '/x/*.parquet', monthStart: '2026-06-01' });
    expect(claimsSql).toContain("accident_time < DATE '2026-06-01'");
  });

  it('未注入 monthStart → 回退 date_trunc(current_date)（向后兼容）', () => {
    const sql = SQL_TEMPLATES['policy_dedup.monthly_premium']({ policyGlob: '/x/*.parquet' });
    expect(sql).toContain("insurance_start_date < date_trunc('month', current_date)");
  });

  it('monthStart 格式非法 → 抛错（防 SQL 注入 / 误传）', () => {
    expect(() =>
      SQL_TEMPLATES['policy_dedup.monthly_premium']({ policyGlob: '/x/*.parquet', monthStart: "2026-06-01'; DROP TABLE" })
    ).toThrow(/monthStart 格式非法/);
  });
});

describe('fetch-local-metrics inspectWarehouse', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(os.tmpdir(), 'gate-warehouse-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('两个目录都不存在 → ready=false，missing 含两条', () => {
    const r = inspectWarehouse(tmpRoot);
    expect(r.ready).toBe(false);
    expect(r.missing.length).toBe(2);
    expect(r.policyGlob).toBe(null);
    expect(r.claimsGlob).toBe(null);
  });

  it('目录存在但无 parquet → ready=false，提示空目录', () => {
    mkdirSync(join(tmpRoot, 'fact/policy/current'), { recursive: true });
    mkdirSync(join(tmpRoot, 'fact/claims_detail'), { recursive: true });
    const r = inspectWarehouse(tmpRoot);
    expect(r.ready).toBe(false);
    expect(r.missing.some((m) => m.includes('目录存在但无 parquet 文件'))).toBe(true);
  });

  it('两个目录都有 parquet → ready=true', () => {
    mkdirSync(join(tmpRoot, 'fact/policy/current'), { recursive: true });
    mkdirSync(join(tmpRoot, 'fact/claims_detail'), { recursive: true });
    writeFileSync(join(tmpRoot, 'fact/policy/current/x.parquet'), '');
    writeFileSync(join(tmpRoot, 'fact/claims_detail/y.parquet'), '');
    const r = inspectWarehouse(tmpRoot);
    expect(r.ready).toBe(true);
    expect(r.policyGlob).toMatch(/policy\/current\/\*\.parquet$/);
    expect(r.claimsGlob).toMatch(/claims_detail\/\*\.parquet$/);
  });
});

describe('fetch-local-metrics fetchLocalSeries（注入 runDuckDB）', () => {
  const ctx = { policyGlob: '/x/p.parquet', claimsGlob: '/x/c.parquet', duckdbBin: 'duckdb' };

  it('正常返回 → 转换为 {time_period, value} 数组', async () => {
    const runDuckDB = async ({ sql }: { sql: string }) => {
      expect(sql).toContain('policy_dedup');
      return [
        { time_period: '2025-01', value: 1000 },
        { time_period: '2025-02', value: 1100 },
      ];
    };
    const series = await fetchLocalSeries(ctx, 'policy_dedup.monthly_premium', runDuckDB);
    expect(series).toEqual([
      { time_period: '2025-01', value: 1000 },
      { time_period: '2025-02', value: 1100 },
    ]);
  });

  it('过滤掉 null / NaN / 缺字段的行', async () => {
    const runDuckDB = async () => [
      { time_period: '2025-01', value: 100 },
      { time_period: '2025-02', value: null }, // 过滤
      { time_period: null, value: 200 },        // 过滤
      { time_period: '2025-03', value: 'NaN' }, // 过滤（NaN）
      { time_period: '2025-04', value: '300' }, // 字符串数字 → 300
    ];
    const series = await fetchLocalSeries(ctx, 'policy_dedup.monthly_premium', runDuckDB);
    expect(series).toEqual([
      { time_period: '2025-01', value: 100 },
      { time_period: '2025-04', value: 300 },
    ]);
  });

  it('未知 source → 抛错', async () => {
    const runDuckDB = async () => [];
    await expect(
      fetchLocalSeries(ctx, 'unknown.source', runDuckDB)
    ).rejects.toThrow(/未知 metric source/);
  });

  it('runDuckDB 抛错 → 透传', async () => {
    const runDuckDB = async () => { throw new Error('duckdb crash'); };
    await expect(
      fetchLocalSeries(ctx, 'policy_dedup.monthly_premium', runDuckDB)
    ).rejects.toThrow(/duckdb crash/);
  });
});
