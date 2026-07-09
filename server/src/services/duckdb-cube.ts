/**
 * 通用可加性立方体 — 物化与新鲜度管理（趋势立方体 CubeTrendDay + 成本立方体 CubeCostDay）
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
import { isOutOfMemoryError } from './duckdb-error-classifier.js';
import { buildTrendCubeSql, TREND_CUBE_TABLE } from '../sql/cube/trend-cube.js';
import { buildCostCubeSql, buildCostCubeProbeSql, COST_CUBE_TABLE } from '../sql/cube/cost-cube.js';
import { buildSalesmanCubeSql, SALESMAN_CUBE_TABLE } from '../sql/cube/salesman-cube.js';

/** PolicyFact.policy_date 是否 TIMESTAMP 类（DESCRIBE column_type 含 TIMESTAMP 前缀） */
function detectPolicyDateIsTimestamp(schema: Array<{ column_name?: string; column_type?: string }>): boolean {
  const col = schema.find((c) => c.column_name === 'policy_date');
  return typeof col?.column_type === 'string' && col.column_type.toUpperCase().startsWith('TIMESTAMP');
}

interface CubeState {
  /** 立方体构建完成时的 dataVersion；null = 从未构建成功 */
  builtVersion: string | null;
  /** 进行中的构建（single-flight 去重） */
  building: Promise<void> | null;
  /** 最近一次构建耗时（观测用） */
  lastBuildMs: number | null;
  /** 最近一次构建失败信息（观测用；成功后清空） */
  lastError: string | null;
  /** 同一 dataVersion 内连续构建失败次数（成功 / 版本翻新时清零） */
  failCount: number;
  /** failCount 归属的 dataVersion（版本翻新后计数不跨版本累积） */
  failVersion: string | null;
}

/**
 * 同一 dataVersion 内构建失败重试上限。达到上限后本版本不再自动重建
 * （下次 ETL 版本翻新自动恢复重试资格）。
 *
 * 背景（2026-07-09 审计）：构建失败仅记 lastError、builtVersion 保持 null，
 * 每个命中请求都会重新触发注定失败的重型构建（探针/物化对 260万+ 行全扫）——
 * cost 立方体在生产自 2026-06-25 起如此空转两周（哨兵 issue #608 持续 CRITICAL），
 * 2 线程 VPS 的 DuckDB 资源被反复无效消耗。上限=3 保留瞬时故障（连接抖动等）
 * 的自愈机会，同时终结确定性失败的无限重试。
 */
const MAX_BUILD_FAILURES_PER_VERSION = 3;

/** 记录一次构建失败（版本翻新则重新计数），返回累计后的失败次数 */
function recordBuildFailure(state: CubeState, version: string): number {
  if (state.failVersion !== version) {
    state.failVersion = version;
    state.failCount = 0;
  }
  state.failCount += 1;
  return state.failCount;
}

/** 当前 dataVersion 是否已达失败重试上限（触发端判定，禁止再自动重建） */
function isBuildRetryExhausted(state: CubeState): boolean {
  return state.failVersion === getDataVersion() && state.failCount >= MAX_BUILD_FAILURES_PER_VERSION;
}

const trendCubeState: CubeState = {
  builtVersion: null,
  building: null,
  lastBuildMs: null,
  lastError: null,
  failCount: 0,
  failVersion: null,
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
  trendCubeState.failCount = 0;
  trendCubeState.failVersion = null;
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
  // policy_date 类型探测：立方体列类型必须跟随源列（生产 ETL 落盘 TIMESTAMP、本地常为 DATE；
  // 类型不一致会让 CAST(policy_date AS VARCHAR) 等表达式两边输出不同 → 影子 mismatch，issue #608）
  const policyDateIsTimestamp = detectPolicyDateIsTimestamp(schema);

  await db.query(buildTrendCubeSql(hasBranchCode, policyDateIsTimestamp));

  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TREND_CUBE_TABLE}`);
  const elapsed = Date.now() - t0;
  // 构建期间发生 ETL 重载（dataVersion 变化）→ 本次产物已过期，保持不新鲜，
  // 下次请求会再次触发重建（versionAtStart 记账保证不会把旧数据标成新版本）
  trendCubeState.builtVersion = versionAtStart;
  trendCubeState.lastBuildMs = elapsed;
  trendCubeState.lastError = null;
  trendCubeState.failCount = 0;
  trendCubeState.failVersion = null;
  console.log(`[TrendCube] ${TREND_CUBE_TABLE} ready: ${Number(n).toLocaleString()} rows in ${elapsed}ms (branch_code=${hasBranchCode}, policy_date_ts=${policyDateIsTimestamp})`);
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
  // 失败退避：同版本连续失败达上限后不再自动重建（版本翻新自动恢复）
  if (isBuildRetryExhausted(trendCubeState)) return 'building';
  if (!trendCubeState.building) {
    const versionAtTrigger = getDataVersion();
    trendCubeState.building = materializeTrendCube(db)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        trendCubeState.lastError = message;
        const fails = recordBuildFailure(trendCubeState, versionAtTrigger);
        console.error(`[TrendCube] Materialization failed (${fails}/${MAX_BUILD_FAILURES_PER_VERSION}, route will keep falling back): ${message}`);
      })
      .finally(() => {
        trendCubeState.building = null;
      });
  }
  return 'building';
}

// ── 成本立方体（CubeCostDay · 第三批次） ─────────────────────────────────────

interface CostCubeState extends CubeState {
  /**
   * 构建期探针结论：true = 无跨格保单，等值前提成立可服务；
   * false = 发现跨格保单，本数据版本整体降级（不建表、不重试，回退原路径）；
   * null = 本版本尚未探针。语义见 sql/cube/cost-cube.ts 文件头。
   */
  exact: boolean | null;
}

const costCubeState: CostCubeState = {
  builtVersion: null,
  building: null,
  lastBuildMs: null,
  lastError: null,
  failCount: 0,
  failVersion: null,
  exact: null,
};

/** 观测快照（/health 或日志用） */
export function getCostCubeState(): Readonly<CostCubeState> {
  return { ...costCubeState };
}

/** @internal 测试用：重置状态机 */
export function resetCostCubeStateForTest(): void {
  costCubeState.builtVersion = null;
  costCubeState.building = null;
  costCubeState.lastBuildMs = null;
  costCubeState.lastError = null;
  costCubeState.failCount = 0;
  costCubeState.failVersion = null;
  costCubeState.exact = null;
}

/** 成本立方体是否与当前数据版本一致且探针通过（可安全用于查询） */
export function isCostCubeFresh(): boolean {
  return (
    costCubeState.builtVersion !== null &&
    costCubeState.builtVersion === getDataVersion() &&
    costCubeState.exact === true
  );
}

/**
 * 物化成本立方体（阻塞直至完成）。
 * 前置条件：PolicyFact 与 ClaimsAgg 均已加载（cost 路由的 createDomainMiddleware
 * 保证 ClaimsAgg 惰性域已就绪后才会触发本函数）。
 *
 * 流程：跨格保单探针 → 通过才建表；不通过则记 exact=false 并跳过建表
 * （本数据版本内不再重试，路由持续回退原路径——结构性降级而非报错）。
 */
export async function materializeCostCube(db: DuckDBQueryable): Promise<void> {
  const versionAtStart = getDataVersion();
  const t0 = Date.now();
  console.log(`[CostCube] Probing + materializing ${COST_CUBE_TABLE} (dataVersion=${versionAtStart})...`);

  const schema = await db.getTableSchema('PolicyFact');
  const hasBranchCode = schema.some((c: { column_name?: string }) => c.column_name === 'branch_code');

  // 探针与建表同享 OOM 降级保护：探针本身是 260万+ 行的重型 GROUP BY，
  // 多省数据下也可能 OOM——OOM 即降级本版本，不再让每个请求重复触发注定失败的探针。
  let impurePolicies: number;
  try {
    const [{ impure_policies }] = await db.query<{ impure_policies: number | bigint }>(
      buildCostCubeProbeSql(hasBranchCode)
    );
    impurePolicies = Number(impure_policies);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isOutOfMemoryError(err)) {
      costCubeState.builtVersion = versionAtStart;
      costCubeState.exact = false;
      costCubeState.lastError = message;
      costCubeState.lastBuildMs = Date.now() - t0;
      console.warn(
        `[CostCube] 探针 OOM，标记 degraded（exact=false, builtVersion=${versionAtStart}）。` +
        `本数据版本不再重试，cost 路由回退原 SQL。下次 ETL 更新后自动重试。`
      );
      return;
    }
    throw err; // 非 OOM 探针错误由外层 catch 记录（含失败退避计数）
  }
  if (impurePolicies > 0) {
    costCubeState.builtVersion = versionAtStart;
    costCubeState.exact = false;
    costCubeState.lastBuildMs = Date.now() - t0;
    costCubeState.lastError = null;
    console.warn(
      `[CostCube] 探针发现 ${impurePolicies} 张跨格保单（行间起保日/维度值不一致），` +
      `本数据版本降级：cost 路由保持原路径（等值前提不成立，详见 sql/cube/cost-cube.ts）`
    );
    return;
  }

  // 方案 A：分阶段执行三条 SQL（建临时去重表 → 主表 JOIN 聚合 → 清理临时表）
  // 每步在独立 statement 中运行，DuckDB TEMP TABLE 允许溢出磁盘，根治内存峰值。
  const [tempTableSql, mainTableSql, cleanupSql] = buildCostCubeSql(hasBranchCode);
  try {
    await db.query(tempTableSql);   // 步骤 1：B252 去重物化到临时表
    await db.query(mainTableSql);  // 步骤 2：轻量 JOIN 聚合成格子
  } catch (err) {
    // 方案 C：OOM 降级在 versionAtStart 作用域内处理（PR #645 review fix）。
    // 防止构建期间 ETL 推进 dataVersion 时，外层 catch 用 getDataVersion() 把
    // 新版本无辜标 degraded（新版本可能不会 OOM，应留给后续 ensureCostCubeFresh
    // 重新尝试构建的机会）。
    const message = err instanceof Error ? err.message : String(err);
    // isOutOfMemoryError：结构化标记优先——生产 duckdb.ts 抛错前已脱敏消息，
    // 纯消息正则在生产永远不命中（2026-07-09 审计发现的死代码根因）
    if (isOutOfMemoryError(err)) {
      costCubeState.builtVersion = versionAtStart;
      costCubeState.exact = false;
      costCubeState.lastError = message;
      costCubeState.lastBuildMs = Date.now() - t0;
      console.warn(
        `[CostCube] OOM 检测到，标记 degraded（exact=false, builtVersion=${versionAtStart}）。` +
        `本数据版本不再重试，cost 路由回退原 SQL。下次 ETL 更新后自动重试。`
      );
      return; // 不 rethrow，外层 ensureCostCubeFresh 的 catch 不再处理 OOM
    }
    throw err; // 非 OOM 错误（Binder/语法等）由外层 catch 记录
  } finally {
    // 步骤 3：无论成功失败都清理临时表，避免内存泄漏
    await db.query(cleanupSql).catch((e: unknown) => {
      console.warn(`[CostCube] TEMP TABLE 清理失败（非致命）: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${COST_CUBE_TABLE}`);
  const elapsed = Date.now() - t0;
  // 与趋势立方体同一竞态规避：versionAtStart 记账，构建期间 ETL 重载则保持不新鲜
  costCubeState.builtVersion = versionAtStart;
  costCubeState.exact = true;
  costCubeState.lastBuildMs = elapsed;
  costCubeState.lastError = null;
  costCubeState.failCount = 0;
  costCubeState.failVersion = null;
  console.log(`[CostCube] ${COST_CUBE_TABLE} ready: ${Number(n).toLocaleString()} rows in ${elapsed}ms (branch_code=${hasBranchCode})`);
}

/**
 * 非阻塞确保新鲜（与趋势立方体同一模型，多一个探针降级态）：
 *   - 'ready'    新鲜且探针通过 → 可直接查立方体
 *   - 'degraded' 本版本探针未通过 → 回退原路径，且不再重复触发构建
 *   - 'building' 不新鲜 → 触发后台单飞重建，本次请求走原路径
 */
export function ensureCostCubeFresh(db: DuckDBQueryable): 'ready' | 'building' | 'degraded' {
  if (isCostCubeFresh()) return 'ready';
  if (costCubeState.builtVersion === getDataVersion() && costCubeState.exact === false) {
    return 'degraded';
  }
  // 失败退避：同版本非 OOM 失败达上限后转正式 degraded（版本翻新自动恢复）
  if (isBuildRetryExhausted(costCubeState)) return 'degraded';
  if (!costCubeState.building) {
    const versionAtTrigger = getDataVersion();
    costCubeState.building = materializeCostCube(db)
      .catch((err: unknown) => {
        // OOM 已在 materializeCostCube 内部用 versionAtStart 处理（PR #645 review fix）；
        // 这里只处理非 OOM 错误（Binder/语法/连接错），记录后保持 builtVersion=null
        // 允许下次重试；同版本连续失败达上限则停止自动重建（失败退避）。
        const message = err instanceof Error ? err.message : String(err);
        costCubeState.lastError = message;
        const fails = recordBuildFailure(costCubeState, versionAtTrigger);
        console.error(`[CostCube] 物化失败（${fails}/${MAX_BUILD_FAILURES_PER_VERSION}，路由持续回退原路径）: ${message}`);
      })
      .finally(() => {
        costCubeState.building = null;
      });
  }
  return 'building';
}

// ── 业务员立方体（CubeSalesmanDay · 第五批次） ───────────────────────────────
// 行级可加度量（无保单去重语义）→ 无需探针，与趋势立方体同一新鲜度模型。

const salesmanCubeState: CubeState = {
  builtVersion: null,
  building: null,
  lastBuildMs: null,
  lastError: null,
  failCount: 0,
  failVersion: null,
};

/** 观测快照（/health 或日志用） */
export function getSalesmanCubeState(): Readonly<CubeState> {
  return { ...salesmanCubeState };
}

/** @internal 测试用：重置状态机 */
export function resetSalesmanCubeStateForTest(): void {
  salesmanCubeState.builtVersion = null;
  salesmanCubeState.building = null;
  salesmanCubeState.lastBuildMs = null;
  salesmanCubeState.lastError = null;
  salesmanCubeState.failCount = 0;
  salesmanCubeState.failVersion = null;
}

/** 业务员立方体是否与当前数据版本一致（可安全用于查询） */
export function isSalesmanCubeFresh(): boolean {
  return salesmanCubeState.builtVersion !== null && salesmanCubeState.builtVersion === getDataVersion();
}

/**
 * 物化业务员立方体（阻塞直至完成）。
 * 前置条件：PolicyFact 已加载。构建期间旧表（如有）仍可查询，换表原子。
 */
export async function materializeSalesmanCube(db: DuckDBQueryable): Promise<void> {
  const versionAtStart = getDataVersion();
  const t0 = Date.now();
  console.log(`[SalesmanCube] Materializing ${SALESMAN_CUBE_TABLE} (dataVersion=${versionAtStart})...`);

  const schema = await db.getTableSchema('PolicyFact');
  const hasBranchCode = schema.some((c: { column_name?: string }) => c.column_name === 'branch_code');
  const policyDateIsTimestamp = detectPolicyDateIsTimestamp(schema);

  await db.query(buildSalesmanCubeSql(hasBranchCode, policyDateIsTimestamp));

  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${SALESMAN_CUBE_TABLE}`);
  const elapsed = Date.now() - t0;
  // 与趋势立方体同一竞态规避：versionAtStart 记账，构建期间 ETL 重载则保持不新鲜
  salesmanCubeState.builtVersion = versionAtStart;
  salesmanCubeState.lastBuildMs = elapsed;
  salesmanCubeState.lastError = null;
  salesmanCubeState.failCount = 0;
  salesmanCubeState.failVersion = null;
  console.log(`[SalesmanCube] ${SALESMAN_CUBE_TABLE} ready: ${Number(n).toLocaleString()} rows in ${elapsed}ms (branch_code=${hasBranchCode}, policy_date_ts=${policyDateIsTimestamp})`);
}

/**
 * 非阻塞确保新鲜（与趋势立方体同一模型）：
 *   - 已新鲜 → 'ready'（可直接查立方体）
 *   - 不新鲜 → 触发后台单飞重建并返回 'building'（本次请求应走原路径）
 */
export function ensureSalesmanCubeFresh(db: DuckDBQueryable): 'ready' | 'building' {
  if (isSalesmanCubeFresh()) return 'ready';
  // 失败退避：同版本连续失败达上限后不再自动重建（版本翻新自动恢复）
  if (isBuildRetryExhausted(salesmanCubeState)) return 'building';
  if (!salesmanCubeState.building) {
    const versionAtTrigger = getDataVersion();
    salesmanCubeState.building = materializeSalesmanCube(db)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        salesmanCubeState.lastError = message;
        const fails = recordBuildFailure(salesmanCubeState, versionAtTrigger);
        console.error(`[SalesmanCube] Materialization failed (${fails}/${MAX_BUILD_FAILURES_PER_VERSION}, route will keep falling back): ${message}`);
      })
      .finally(() => {
        salesmanCubeState.building = null;
      });
  }
  return 'building';
}
