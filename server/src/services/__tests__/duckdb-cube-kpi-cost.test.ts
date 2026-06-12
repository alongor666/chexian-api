/**
 * KPI 路由级端到端 + cost 三项立方体等值集成测试（需 DuckDB 原生二进制，仅本地）
 *
 * 用真实 express 应用 + 真实 DuckDB（:memory:）验证 /api/query/kpi 的三态行为：
 *   ① 双开关关闭（默认）：原 KPI SQL 跑（含 variable_cost CTE + JOIN ClaimsAgg）
 *   ② CUBE_ROUTING_ENABLED + dateField=insurance_start_date：
 *      主 SQL 携 excludeVariableCost=true 与立方体单行并行 → 合并 26 列
 *      26 列与原路径全部相等（cost 三项依赖立方体等值，其他 23 项依赖主 SQL 不动）
 *   ③ CUBE_SHADOW_COMPARE：对外返回原路径结果，后台双跑 cost 三项比对计 match
 *   ④ dateField=policy_date：自动回退原路径（立方体无 policy_date 列）
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { duckdbService } from '../duckdb.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import { ensureCostCubeFresh, resetCostCubeStateForTest } from '../duckdb-cube.js';
import { getShadowStats, resetShadowStatsForTest } from '../cube-shadow.js';
import { dbEnv } from '../../config/env.js';
import kpiRouter from '../../routes/query/kpi.js';

let server: Server;
let baseUrl: string;

const setFlags = (routing: boolean, shadow: boolean) => {
  (dbEnv as unknown as Record<string, string>).CUBE_ROUTING_ENABLED = String(routing);
  (dbEnv as unknown as Record<string, string>).CUBE_SHADOW_COMPARE = String(shadow);
};

const getKpi = async (params: Record<string, string>) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/query/kpi?${qs}`);
  const body = await res.json() as { success: boolean; data: Record<string, unknown> };
  return { status: res.status, body };
};

const waitFor = async (cond: () => boolean, timeoutMs = 15_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 50));
  }
};

beforeAll(async () => {
  _resetDataVersionForTesting();
  resetCostCubeStateForTest();
  resetShadowStatsForTest();
  setFlags(false, false);

  await duckdbService.init();
  // 集成测试共享 duckdbService 实例，前序套件可能已建表 → 先清场
  for (const t of ['PolicyFact', 'ClaimsAgg', 'achievement_cache', 'KpiPlanConfig', 'CubeTrendDay', 'CubeCostDay']) {
    await duckdbService.query(`DROP TABLE IF EXISTS ${t}`);
  }
  // PolicyFact：含批改重复行（B252 形态）→ variable_cost_base 去重后 JOIN ClaimsAgg
  await duckdbService.query(`
    CREATE TABLE PolicyFact AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      'V' || lpad(CAST(i % 7800 AS VARCHAR), 6, '0') AS vehicle_frame_no,
      DATE '2025-01-01' + CAST(i % 500 AS INTEGER) AS policy_date,
      DATE '2025-01-01' + CAST(floor(random() * 540) AS INTEGER) AS insurance_start_date,
      'org_' || CAST(i % 5 AS VARCHAR) AS org_level_3,
      'sales_' || CAST(i % 20 AS VARCHAR) AS salesman_name,
      CASE i % 4 WHEN 0 THEN '非营业个人客车' WHEN 1 THEN '营业货车' WHEN 2 THEN '非营业货车' ELSE '摩托车' END AS customer_category,
      CASE i % 5 WHEN 0 THEN '主全' WHEN 1 THEN '交三' WHEN 2 THEN '单交' WHEN 3 THEN '主全' ELSE '主全' END AS coverage_combination,
      CASE WHEN i % 2 = 0 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      CASE i % 6 WHEN 0 THEN '1吨以下' WHEN 1 THEN '2-9吨' WHEN 2 THEN '10吨以上' ELSE '1-2吨' END AS tonnage_segment,
      (i % 2 = 0) AS is_renewal,
      (i % 7 = 0) AS is_new_car,
      (i % 11 = 0) AS is_transfer,
      (i % 5 = 0) AS is_nev,
      (i % 13 = 0) AS is_telemarketing,
      CASE WHEN i % 3 = 0 THEN '套单' ELSE '非套单' END AS is_commercial_insure,
      CASE WHEN i % 2 = 0 AND i % 17 != 0 THEN 'PR' || lpad(CAST(i AS VARCHAR), 8, '0') ELSE NULL END AS renewal_policy_no,
      CAST(NULL AS VARCHAR) AS endorsement_no,
      300 + random() * 4000 AS premium,
      random() * 200 AS fee_amount,
      0.0 AS cross_sell_premium_driver
    FROM range(20000) t(i)
  `);
  // 批改行：B252 形态（同 policy_no + 起保日 + 维度，保费 5%）
  await duckdbService.query(`
    INSERT INTO PolicyFact
    SELECT policy_no, vehicle_frame_no, policy_date + 20, insurance_start_date, org_level_3,
           salesman_name, customer_category, coverage_combination, insurance_type, tonnage_segment,
           is_renewal, is_new_car, is_transfer, is_nev, is_telemarketing,
           is_commercial_insure, renewal_policy_no,
           'E' || policy_no AS endorsement_no,
           premium * 0.05, fee_amount * 0.05, 0.0
    FROM (SELECT * FROM PolicyFact USING SAMPLE 8 PERCENT (bernoulli, 11))
  `);
  // ClaimsAgg：约 1/3 保单有赔案
  await duckdbService.query(`
    CREATE TABLE ClaimsAgg AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      1 + i % 2 AS claim_cases,
      300 + random() * 8000 AS reported_claims
    FROM range(0, 20100, 3) t(i)
  `);
  // KPI 用的两张维表（plan 数据可为空 → 计划达成率输出 NULL，不影响 cost 三项比对）
  await duckdbService.query(`CREATE TABLE achievement_cache (org_name VARCHAR, full_name VARCHAR, plan_vehicle DOUBLE)`);
  await duckdbService.query(`CREATE TABLE KpiPlanConfig (business_line VARCHAR, level VARCHAR, level_key VARCHAR, plan_year INTEGER, plan_premium DOUBLE)`);
  setDataVersion('verKpi1');

  const app = express();
  app.use((req, _res, next) => { req.permissionFilter = '1=1'; next(); });
  app.use('/api/query', kpiRouter);
  // 测试用 JSON error handler（默认 HTML 500/503 会让 res.json() 抛 SyntaxError 遮蔽真因）
  app.use((err: { statusCode?: number; status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err?.statusCode ?? err?.status ?? 500;
    res.status(status).json({ success: false, error: err?.message ?? String(err) });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  setFlags(false, false);
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  try { await duckdbService.close(); } catch { /* ignore */ }
  _resetDataVersionForTesting();
  resetCostCubeStateForTest();
  resetShadowStatsForTest();
});

const COST_COLUMNS = ['variable_cost_ratio', 'earned_claim_ratio', 'expense_ratio'] as const;
// 浮点容差比对（与 cube-shadow.ts 同一公式）+ 对象（DuckDB DATE/Numeric 序列化）按 JSON 字符串等价
const numericClose = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    const scale = Math.max(1, Math.abs(na), Math.abs(nb));
    return Math.abs(na - nb) / scale < 1e-9;
  }
  // DATE → { days } 等结构等同；不可比时退化字符串
  return JSON.stringify(a) === JSON.stringify(b);
};

describe('/api/query/kpi 立方体三态行为', () => {
  it('① 双开关关闭：原 KPI SQL 跑（含 variable_cost CTE + LEFT JOIN ClaimsAgg）', async () => {
    setFlags(false, false);
    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getKpi({ dateField: 'insurance_start_date', _bust: 'A' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('variable_cost_ratio');
    const sqls = spy.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /variable_cost_base/.test(s))).toBe(true);
    expect(sqls.some((s) => /LEFT JOIN ClaimsAgg/.test(s))).toBe(true);
    expect(sqls.some((s) => /CubeCostDay/.test(s))).toBe(false);
    spy.mockRestore();
  });

  it('② routing + insurance_start_date：主 SQL 去 variable_cost + 立方体并行，合并 26 列', async () => {
    setFlags(true, false);
    // 首请求：立方体未构建 → 回退原路径，触发后台构建
    await getKpi({ dateField: 'insurance_start_date', _bust: 'B0' });
    await waitFor(() => ensureCostCubeFresh(duckdbService) === 'ready');

    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getKpi({ dateField: 'insurance_start_date', _bust: 'B1' });
    expect(status).toBe(200);
    const sqls = spy.mock.calls.map(([sql]) => sql);
    // 主 SQL 必须去掉 cost 重头戏，立方体单行 SQL 必须跑过
    expect(sqls.some((s) => /CubeCostDay/.test(s))).toBe(true);
    const mainSqls = sqls.filter((s) => /FROM PolicyFact/.test(s));
    expect(mainSqls.length).toBeGreaterThan(0);
    expect(mainSqls.every((s) => !/variable_cost_base/.test(s))).toBe(true);
    expect(mainSqls.every((s) => !/LEFT JOIN ClaimsAgg/.test(s))).toBe(true);
    for (const col of COST_COLUMNS) {
      expect(body.data).toHaveProperty(col);
    }
    expect(body.data).toHaveProperty('total_premium');
    expect(body.data).toHaveProperty('policy_count');
    expect(body.data).toHaveProperty('salesman_count');
    expect(body.data).toHaveProperty('bundle_renewal_rate');
    spy.mockRestore();
  }, 30_000);

  it('② 立方体路径与原路径 26 列逐字段等值（cost 三项依赖立方体等值，其余依赖主 SQL 不动）', async () => {
    setFlags(true, false);
    await waitFor(() => ensureCostCubeFresh(duckdbService) === 'ready');
    const cubeRes = await getKpi({ dateField: 'insurance_start_date', _bust: 'C1' });

    setFlags(false, false);
    const legacyRes = await getKpi({ dateField: 'insurance_start_date', _bust: 'C2' });

    expect(cubeRes.status).toBe(200);
    expect(legacyRes.status).toBe(200);
    const a = cubeRes.body.data;
    const b = legacyRes.body.data;
    for (const key of Object.keys(b)) {
      expect(numericClose(a[key], b[key]), `字段 ${key} 不等：cube=${String(a[key])} legacy=${String(b[key])}`).toBe(true);
    }
    for (const col of COST_COLUMNS) {
      expect(a[col]).not.toBeNull();
      expect(b[col]).not.toBeNull();
    }
  }, 30_000);

  it('④ dateField=policy_date：自动回退原路径（立方体无 policy_date 列）', async () => {
    setFlags(true, false);
    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getKpi({ dateField: 'policy_date', _bust: 'D' });
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('variable_cost_ratio');
    const sqls = spy.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /variable_cost_base/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM CubeCostDay/.test(s))).toBe(false);
    spy.mockRestore();
  });

  it('④ 立方体外列（业务员筛选）自动回退原路径', async () => {
    setFlags(true, false);
    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getKpi({ dateField: 'insurance_start_date', salesmanName: 'sales_3', _bust: 'E' });
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('variable_cost_ratio');
    const sqls = spy.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /variable_cost_base/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM CubeCostDay/.test(s))).toBe(false);
    spy.mockRestore();
  });

  it('③ 影子对账：对外返回原路径，后台双跑 cost 三项比对计 match 且零 mismatch', async () => {
    setFlags(false, true);
    resetShadowStatsForTest();
    await waitFor(() => ensureCostCubeFresh(duckdbService) === 'ready');
    const { status, body } = await getKpi({ dateField: 'insurance_start_date', _bust: 'F' });
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('variable_cost_ratio');
    await waitFor(() => {
      const s = getShadowStats()['kpi'];
      return !!s && s.match + s.mismatch + s.error > 0;
    });
    const stats = getShadowStats()['kpi'];
    expect(stats.mismatch).toBe(0);
    expect(stats.error).toBe(0);
    expect(stats.match).toBeGreaterThan(0);
  }, 30_000);
});
