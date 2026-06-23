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
      'policy_trend.monthly_policy_count',
      'policy_trend.monthly_premium',
    ]);
  });

  it('monthly_premium 镜像生产 trend SSOT：raw PolicyFact + SUM(premium)（codex PR #513 第7轮 P2，无 policy_dedup CTE）', () => {
    const sql = SQL_TEMPLATES['policy_trend.monthly_premium']({ policyGlob: '/x/policy/*.parquet' });
    // 镜像 server/src/sql/trend/premium-trend.ts perspective='premium' 路径：
    //   valueAggregation='SUM(premium)' by STRFTIME(policy_date, '%Y-%m')
    expect(sql).toContain("strftime(policy_date, '%Y-%m')");
    expect(sql).toContain('SUM(premium)');
    expect(sql).toContain('/x/policy/*.parquet');
    // 不再用 policy_dedup CTE / HAVING / GROUP BY policy_no（dedup 是 cost-ratios 口径，
    // 不是 trend SSOT；dedup 会把跨月批改净额搬回原单月让生产 trend 断崖被掩盖）
    expect(sql, '不应有 policy_dedup CTE').not.toContain('policy_dedup AS');
    expect(sql, '不应过滤 HAVING SUM(premium) > 0').not.toContain('HAVING SUM(premium) > 0');
    expect(sql, '不应按 policy_no 去重 GROUP BY').not.toContain('GROUP BY policy_no');
    expect(sql, '不应有 ANY_VALUE sign_date 取法').not.toContain('ANY_VALUE');
  });

  it('monthly_policy_count 镜像生产 trend SSOT：raw PolicyFact + COUNT(*)（codex PR #513 第7轮 P2，非 COUNT DISTINCT）', () => {
    const sql = SQL_TEMPLATES['policy_trend.monthly_policy_count']({ policyGlob: '/x/*.parquet' });
    // 镜像 premium-trend.ts:45 perspective='policy_count' 路径 valueAggregation='COUNT(*)'
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain("strftime(policy_date, '%Y-%m')");
    // 不应用 COUNT DISTINCT：批改副本/冲正在生产 trend 中是计入的，闸门若 DISTINCT 会与 sentinel 对不上
    expect(sql, '不应用 COUNT DISTINCT（生产是 COUNT(*)）').not.toContain('COUNT(DISTINCT');
    expect(sql, '不应有 policy_dedup CTE').not.toContain('policy_dedup AS');
  });

  it('policy 月度 flow 指标按 policy_date 月聚合（对齐生产 trend SSOT，codex PR #513 第4轮 P2 + 第7轮 P2）', () => {
    // 生产 server/src/sql/trend/premium-trend.ts:31 默认 dateField='policy_date'，
    // sentinel fetchTrend(perspective=premium|policy_count, monthly) 走该路径；
    // 闸门若按 insurance_start_date 聚合，policy_date ETL 写错时漏检 → sentinel post-publish 才抓到。
    const sources = ['policy_trend.monthly_premium', 'policy_trend.monthly_policy_count'];
    for (const source of sources) {
      const sql = SQL_TEMPLATES[source]({ policyGlob: '/x/*.parquet', monthStart: '2026-06-01' });
      // WHERE 过滤用 policy_date（不是 insurance_start_date）
      expect(sql, `${source} WHERE 应按 policy_date 过滤完整月`).toContain("policy_date < DATE '2026-06-01'");
      expect(sql, `${source} WHERE 不应按 insurance_start_date 过滤`).not.toContain("insurance_start_date < DATE");
      // 输出 GROUP BY 用 policy_date 月
      expect(sql, `${source} 输出应按 policy_date 月分组`).toContain("strftime(policy_date, '%Y-%m')");
    }
  });

  it('claims 月度指标按 accident_time 月聚合（与 claims-heatmap cohort SSOT 一致，不切到 policy_date）', () => {
    // 与 policy 不同：claims 的业务月由"出险时间"定义，生产 cost-ratios.ts/claims-heatmap.ts 都按
    // accident_time/insurance_start_date cohort 不按 policy_date——闸门保持这套口径。
    const sources = ['claims_detail.monthly_claim_amount', 'claims_detail.monthly_claim_count'];
    for (const source of sources) {
      const sql = SQL_TEMPLATES[source]({ claimsGlob: '/x/*.parquet', monthStart: '2026-06-01' });
      expect(sql, `${source} 应按 accident_time 分组`).toContain("strftime(accident_time, '%Y-%m')");
      expect(sql, `${source} WHERE 应按 accident_time 过滤`).toContain("accident_time < DATE '2026-06-01'");
      // claims 不切换到 policy_date——claims_detail 表里 policy_date 仅作为 JOIN 字段，无业务月含义
      expect(sql, `${source} 不应引用 policy_date`).not.toContain('policy_date');
    }
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

  it('读法镜像生产：policy 与 claims 均带 union_by_name=true（P3-A 后两个 loader 对齐 schema 漂移容忍）', () => {
    // P3-A（codex 闸-2 P1 采纳）：claims_detail ETL 加派生 branch_code 列后，CDC 旧分区无、
    // 新分区有，loader 升级为 union_by_name=true 容忍混分区 schema 漂移。schema 一致性由
    // ETL fields.json + governance #17 + schema 契约保证，loader 层不再兜底强一致性。
    // 历史背景（PR #513 第2/3轮）：claims 曾用裸读金丝雀防"prepublish 通过 + 生产首次加载崩"，
    // 但 schema 演进无法靠 loader 层兜底；金丝雀已随 P3-A 同步升级到对称镜像生产 union_by_name。
    const ctx = { policyGlob: '/x/policy/*.parquet', claimsGlob: '/x/claims/claims_*.parquet', monthStart: '2026-06-01' };
    const allSources = [
      'policy_trend.monthly_premium',
      'policy_trend.monthly_policy_count',
      'claims_detail.monthly_claim_amount',
      'claims_detail.monthly_claim_count',
    ];
    for (const source of allSources) {
      const sql = SQL_TEMPLATES[source](ctx);
      // policy/current 真有旧静态分片+新周更分片；claims_* P3-A 后旧无/新有 branch_code → 双双需要 union_by_name
      expect(sql, `${source} 应带 union_by_name（镜像生产 loader 升级后行为）`).toContain('union_by_name=true');
    }
  });

  it('注入 monthStart → 用 < DATE 业务月首日（与发布机时区解耦，codex PR #513 P2）', () => {
    // policy 系列（按 policy_date 签单月对齐生产 trend SSOT）和 claims 系列（按 accident_time 出险月）
    // 都必须排除不完整月，否则 cutoff 当月会因分母小被误判为断崖。
    // monthStart 由编排器按 Asia/Shanghai 注入，避免发布机 UTC 时区在月初退到上月。
    const policySql = SQL_TEMPLATES['policy_trend.monthly_premium']({ policyGlob: '/x/*.parquet', monthStart: '2026-06-01' });
    expect(policySql).toContain("policy_date < DATE '2026-06-01'");
    expect(policySql).not.toContain('current_date');

    const claimsSql = SQL_TEMPLATES['claims_detail.monthly_claim_amount']({ claimsGlob: '/x/*.parquet', monthStart: '2026-06-01' });
    expect(claimsSql).toContain("accident_time < DATE '2026-06-01'");
  });

  it('未注入 monthStart → 回退 date_trunc(current_date)（向后兼容）', () => {
    const sql = SQL_TEMPLATES['policy_trend.monthly_premium']({ policyGlob: '/x/*.parquet' });
    expect(sql).toContain("policy_date < date_trunc('month', current_date)");
  });

  it('monthStart 格式非法 → 抛错（防 SQL 注入 / 误传）', () => {
    expect(() =>
      SQL_TEMPLATES['policy_trend.monthly_premium']({ policyGlob: '/x/*.parquet', monthStart: "2026-06-01'; DROP TABLE" })
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

  it('policy 有 parquet + claims 有 claims_* 分区 → ready=true，glob 镜像生产 bootstrapper', () => {
    mkdirSync(join(tmpRoot, 'fact/policy/current'), { recursive: true });
    mkdirSync(join(tmpRoot, 'fact/claims_detail'), { recursive: true });
    writeFileSync(join(tmpRoot, 'fact/policy/current/x.parquet'), '');
    writeFileSync(join(tmpRoot, 'fact/claims_detail/claims_2026.parquet'), '');
    const r = inspectWarehouse(tmpRoot);
    expect(r.ready).toBe(true);
    expect(r.policyGlob).toMatch(/policy\/current\/\*\.parquet$/);
    expect(r.claimsGlob).toMatch(/claims_detail\/claims_\*\.parquet$/);
  });

  it('claims 仅有 latest.parquet（旧架构）→ glob 回退到 latest.parquet（镜像 bootstrapper 回退）', () => {
    mkdirSync(join(tmpRoot, 'fact/policy/current'), { recursive: true });
    mkdirSync(join(tmpRoot, 'fact/claims_detail'), { recursive: true });
    writeFileSync(join(tmpRoot, 'fact/policy/current/x.parquet'), '');
    writeFileSync(join(tmpRoot, 'fact/claims_detail/latest.parquet'), '');
    const r = inspectWarehouse(tmpRoot);
    expect(r.ready).toBe(true);
    expect(r.claimsGlob).toMatch(/claims_detail\/latest\.parquet$/);
  });

  it('claims 同时有 claims_* 与 latest → 优先分区（与 bootstrapper 一致）', () => {
    mkdirSync(join(tmpRoot, 'fact/policy/current'), { recursive: true });
    mkdirSync(join(tmpRoot, 'fact/claims_detail'), { recursive: true });
    writeFileSync(join(tmpRoot, 'fact/policy/current/x.parquet'), '');
    writeFileSync(join(tmpRoot, 'fact/claims_detail/claims_2026.parquet'), '');
    writeFileSync(join(tmpRoot, 'fact/claims_detail/latest.parquet'), '');
    const r = inspectWarehouse(tmpRoot);
    expect(r.claimsGlob).toMatch(/claims_detail\/claims_\*\.parquet$/);
  });

  it('claims 只有杂项 parquet（非 claims_*、非 latest）→ ready=false（生产不会服务，codex PR #513 3b）', () => {
    mkdirSync(join(tmpRoot, 'fact/policy/current'), { recursive: true });
    mkdirSync(join(tmpRoot, 'fact/claims_detail'), { recursive: true });
    writeFileSync(join(tmpRoot, 'fact/policy/current/x.parquet'), '');
    writeFileSync(join(tmpRoot, 'fact/claims_detail/tmp_export.parquet'), '');
    const r = inspectWarehouse(tmpRoot);
    expect(r.ready).toBe(false);
    expect(r.claimsGlob).toBe(null);
    expect(r.missing.some((m) => m.includes('生产加载器不会服务'))).toBe(true);
  });
});

describe('fetch-local-metrics fetchLocalSeries（注入 runDuckDB）', () => {
  const ctx = { policyGlob: '/x/p.parquet', claimsGlob: '/x/c.parquet', duckdbBin: 'duckdb' };

  it('正常返回 → 转换为 {time_period, value} 数组', async () => {
    const runDuckDB = async ({ sql }: { sql: string }) => {
      // raw PolicyFact + SUM(premium) by policy_date month（codex PR #513 第7轮 P2）
      expect(sql).toContain('SUM(premium)');
      expect(sql).toContain("strftime(policy_date, '%Y-%m')");
      return [
        { time_period: '2025-01', value: 1000 },
        { time_period: '2025-02', value: 1100 },
      ];
    };
    const series = await fetchLocalSeries(ctx, 'policy_trend.monthly_premium', runDuckDB);
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
    const series = await fetchLocalSeries(ctx, 'policy_trend.monthly_premium', runDuckDB);
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
      fetchLocalSeries(ctx, 'policy_trend.monthly_premium', runDuckDB)
    ).rejects.toThrow(/duckdb crash/);
  });
});
