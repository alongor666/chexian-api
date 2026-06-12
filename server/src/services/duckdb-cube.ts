/**
 * 通用可加性立方体 — 物化与新鲜度管理（第一阶段试点：趋势立方体）
 *
 * 设计文档：开发文档/架构设计/通用立方体查询加速方案.md
 * BACKLOG：uid=2026-06-11-claude-90a92c（P1）
 *
 * 新鲜度模型（结构性规避 B311 类竞态）：
 *   - 构建完成后才记录 builtVersion = 当时的 dataVersion
 *   - 路由侧每次先比对 builtVersion === getDataVersion()，不一致（ETL 重载后）
 *     即判定不新鲜 → 本次请求走原路径，同时后台单飞（single-flight）重建
 *   - 立方体永远不会在"半新半旧"状态被读取：CREATE OR REPLACE TABLE 原子换表，
 *     且 builtVersion 在换表成功后才翻新
 */

import type { DuckDBQueryable } from './duckdb-types.js';
import { getDataVersion } from './data-version.js';
import { buildTrendCubeSql, TREND_CUBE_TABLE } from '../sql/cube/trend-cube.js';

interface CubeState {
  /** 立方体构建完成时的 dataVersion；null = 从未构建成功 */
  builtVersion: string | null;
  /** 进行中的构建（single-flight 去重） */
  building: Promise<void> | null;
  /** 最近一次构建耗时（观测用） */
  lastBuildMs: number | null;
  /** 最近一次构建失败信息（观测用；成功后清空） */
  lastError: string | null;
}

const trendCubeState: CubeState = {
  builtVersion: null,
  building: null,
  lastBuildMs: null,
  lastError: null,
};

/** 观测快照（/health 或日志用） */
export function getTrendCubeState(): Readonly<CubeState> {
  return { ...trendCubeState };
}

/** @internal 测试用：重置状态机 */
export function resetTrendCubeStateForTest(): void {
  trendCubeState.builtVersion = null;
  trendCubeState.building = null;
  trendCubeState.lastBuildMs = null;
  trendCubeState.lastError = null;
}

/** 立方体是否与当前数据版本一致（可安全用于查询） */
export function isTrendCubeFresh(): boolean {
  return trendCubeState.builtVersion !== null && trendCubeState.builtVersion === getDataVersion();
}

/**
 * 物化趋势立方体（阻塞直至完成）。
 * 前置条件：PolicyFact 已加载。构建期间旧表（如有）仍可查询，换表原子。
 */
export async function materializeTrendCube(db: DuckDBQueryable): Promise<void> {
  const versionAtStart = getDataVersion();
  const t0 = Date.now();
  console.log(`[TrendCube] Materializing ${TREND_CUBE_TABLE} (dataVersion=${versionAtStart})...`);

  // branch_code 列探测（多分公司 RLS：列存在则纳入粒度，permissionFilter 条件可直接下推）
  const schema = await db.getTableSchema('PolicyFact');
  const hasBranchCode = schema.some((c: { column_name?: string }) => c.column_name === 'branch_code');

  await db.query(buildTrendCubeSql(hasBranchCode));

  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TREND_CUBE_TABLE}`);
  const elapsed = Date.now() - t0;
  // 构建期间发生 ETL 重载（dataVersion 变化）→ 本次产物已过期，保持不新鲜，
  // 下次请求会再次触发重建（versionAtStart 记账保证不会把旧数据标成新版本）
  trendCubeState.builtVersion = versionAtStart;
  trendCubeState.lastBuildMs = elapsed;
  trendCubeState.lastError = null;
  console.log(`[TrendCube] ${TREND_CUBE_TABLE} ready: ${Number(n).toLocaleString()} rows in ${elapsed}ms (branch_code=${hasBranchCode})`);
}

/**
 * 非阻塞确保新鲜：
 *   - 已新鲜 → 'ready'（可直接查立方体）
 *   - 不新鲜 → 触发后台单飞重建并返回 'building'（本次请求应走原路径）
 *
 * 设计取舍：首个触发请求不等待构建（实测构建秒级，但不让任何请求为它买单），
 * 体验上表现为"开关打开后第 2 个请求起命中立方体"。
 */
export function ensureTrendCubeFresh(db: DuckDBQueryable): 'ready' | 'building' {
  if (isTrendCubeFresh()) return 'ready';
  if (!trendCubeState.building) {
    trendCubeState.building = materializeTrendCube(db)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        trendCubeState.lastError = message;
        console.error(`[TrendCube] Materialization failed (route will keep falling back): ${message}`);
      })
      .finally(() => {
        trendCubeState.building = null;
      });
  }
  return 'building';
}
