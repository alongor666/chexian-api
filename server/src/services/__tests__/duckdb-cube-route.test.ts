/**
 * 趋势立方体 路由级端到端集成测试（需 DuckDB 原生二进制，仅本地：bun run test:integration）
 *
 * 用真实 express 应用 + 真实 DuckDB（:memory:）验证 /api/query/trend 的三态行为：
 *   ① 双开关关闭（默认）：行为与历史一致，SQL 走 PolicyFact
 *   ② CUBE_ROUTING_ENABLED：可服务请求走 CubeTrendDay（首请求触发后台构建并回退原路径），
 *      结果与原路径逐行相等；不可服务筛选自动回退 PolicyFact
 *   ③ CUBE_SHADOW_COMPARE：对外返回原路径结果，后台双跑比对计 match
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { duckdbService } from '../duckdb.js';
import { setDataVersion, _resetDataVersionForTesting } from '../data-version.js';
import { isTrendCubeFresh, resetTrendCubeStateForTest } from '../duckdb-cube.js';
import { getShadowStats, resetShadowStatsForTest } from '../cube-shadow.js';
import { dbEnv } from '../../config/env.js';
import trendRouter from '../../routes/query/trend.js';

let server: Server;
let baseUrl: string;

/** 运行时改写 env 注册表（dbEnv 在 import 时定值，测试用例间需切换开关） */
const setFlags = (routing: boolean, shadow: boolean) => {
  (dbEnv as unknown as Record<string, string>).CUBE_ROUTING_ENABLED = String(routing);
  (dbEnv as unknown as Record<string, string>).CUBE_SHADOW_COMPARE = String(shadow);
};

const getTrend = async (params: Record<string, string>) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${baseUrl}/api/query/trend?${qs}`);
  const body = await res.json() as { success: boolean; data: Array<Record<string, unknown>> };
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
  resetTrendCubeStateForTest();
  resetShadowStatsForTest();
  setFlags(false, false);

  await duckdbService.init();
  await duckdbService.query(`
    CREATE TABLE PolicyFact AS
    SELECT
      'P' || lpad(CAST(i AS VARCHAR), 8, '0') AS policy_no,
      DATE '2026-01-01' + CAST(i % 150 AS INTEGER) AS policy_date,
      DATE '2026-01-01' + CAST(i % 150 AS INTEGER) + CAST(i % 6 AS INTEGER) AS insurance_start_date,
      'org_' || CAST(i % 5 AS VARCHAR) AS org_level_3,
      CASE i % 3 WHEN 0 THEN '非营业个人客车' WHEN 1 THEN '营业货车' ELSE '摩托车' END AS customer_category,
      CASE WHEN i % 2 = 0 THEN '交强险' ELSE '商业保险' END AS insurance_type,
      (i % 2 = 0) AS is_renewal,
      (i % 7 = 0) AS is_new_car,
      (i % 11 = 0) AS is_transfer,
      (i % 5 = 0) AS is_nev,
      (i % 13 = 0) AS is_telemarketing,
      'sales_' || CAST(i % 20 AS VARCHAR) AS salesman_name,
      500 + (i % 4000) * 1.0 AS premium
    FROM range(20000) t(i)
  `);
  setDataVersion('verRoute1');

  const app = express();
  app.use((req, _res, next) => { req.permissionFilter = '1=1'; next(); });
  app.use('/api/query', trendRouter);
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
  resetTrendCubeStateForTest();
  resetShadowStatsForTest();
});

describe('/api/query/trend 立方体三态行为', () => {
  it('① 双开关关闭：200 + 非空数据，SQL 走 PolicyFact（历史行为）', async () => {
    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getTrend({ granularity: 'month', endDate: '2026-05-01' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const sqls = spy.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /FROM PolicyFact/.test(s))).toBe(true);
    expect(sqls.some((s) => /CubeTrendDay/.test(s))).toBe(false);
    spy.mockRestore();
  });

  it('② 正式路由：首请求触发构建并回退，就绪后走立方体且结果与原路径逐行相等', async () => {
    setFlags(true, false);
    // 首请求：立方体未构建 → 回退原路径（仍 200），同时后台单飞构建
    const first = await getTrend({ granularity: 'month', endDate: '2026-05-02' });
    expect(first.status).toBe(200);
    await waitFor(() => isTrendCubeFresh());

    // 就绪后：同参数请求走立方体（用未缓存过的参数绕开路由缓存）
    const spy = vi.spyOn(duckdbService, 'query');
    const cubeServed = await getTrend({ granularity: 'month', endDate: '2026-05-03' });
    expect(cubeServed.status).toBe(200);
    expect(spy.mock.calls.some(([sql]) => /FROM CubeTrendDay/.test(sql))).toBe(true);
    spy.mockRestore();

    // 等值：开关关闭后同参数（再换参数绕缓存）的原路径结果 = 立方体结果
    setFlags(false, false);
    const legacy = await getTrend({ granularity: 'month', endDate: '2026-05-03', _bust: '1' });
    expect(legacy.body.data).toEqual(cubeServed.body.data);
    setFlags(true, false);
  }, 30_000);

  it('② 不可服务筛选（业务员）自动回退原路径', async () => {
    setFlags(true, false);
    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getTrend({ granularity: 'month', salesmanName: 'sales_3', endDate: '2026-05-04' });
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    const sqls = spy.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /FROM PolicyFact/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM CubeTrendDay/.test(s))).toBe(false);
    spy.mockRestore();
  });

  it('② 件数视角（去重计数非可加）自动回退原路径', async () => {
    setFlags(true, false);
    const spy = vi.spyOn(duckdbService, 'query');
    const { status, body } = await getTrend({ granularity: 'month', perspective: 'policy_count', endDate: '2026-05-06' });
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    const sqls = spy.mock.calls.map(([sql]) => sql);
    expect(sqls.some((s) => /FROM PolicyFact/.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM CubeTrendDay/.test(s))).toBe(false);
    spy.mockRestore();
  });

  it('③ 影子对账：对外返回原路径结果，后台比对计 match 且零 mismatch', async () => {
    setFlags(false, true);
    const { status, body } = await getTrend({ granularity: 'week', endDate: '2026-05-05' });
    expect(status).toBe(200);
    expect(body.data.length).toBeGreaterThan(0);
    await waitFor(() => {
      const s = getShadowStats()['trend'];
      return !!s && s.match + s.mismatch + s.error > 0;
    });
    const stats = getShadowStats()['trend'];
    expect(stats.mismatch).toBe(0);
    expect(stats.error).toBe(0);
    expect(stats.match).toBeGreaterThan(0);
    expect(stats.lastMismatchDetail).toBeNull();
  }, 30_000);
});
