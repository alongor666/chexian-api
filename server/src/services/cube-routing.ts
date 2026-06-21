/**
 * 立方体灰度路由判定（SSOT for `cubeRouting` / `cubeShadow` 开关解析）。
 *
 * 抽象目的：
 *   - 5 个 query 路由（trend / growth / cost / kpi / salesman-ranking）原本各自
 *     `dbEnv.CUBE_ROUTING_ENABLED === 'true'` 解析，#7 部分切流要求引入按路由白名单
 *     `CUBE_ROUTING_ROUTES`，集中在此 helper 解析避免 5 处独立重复同步。
 *   - 影子对账 `CUBE_SHADOW_COMPARE` 同样集中——按 RED LINE「与 CUBE_ROUTING_ENABLED
 *     互斥使用」语义校验，影子模式 routes 白名单全程不生效（影子只是观察，不切对外结果）。
 *
 * 与 SSOT `scripts/shared/cube-routes.mjs` 关系：本文件 RouteKey 字面量与 SSOT
 *   `CUBE_ROUTES[*].shadowKey` 一一对应；governance「cube routing routes 白名单覆盖」
 *   检查（PR-13 引入）会在 CI 上对账两边集合相等。
 */

import { dbEnv } from '../config/env.js';

/** 与 cube-routes.mjs SSOT shadowKey 对齐的字面量集合（编译期校验调用点输错路由名）。 */
export type CubeRouteKey =
  | 'trend'
  | 'growth'
  | 'cost'
  | 'kpi'
  | 'salesman-ranking';

/**
 * 解析 `CUBE_ROUTING_ROUTES` 白名单。
 *   缺省 / 空 / 全 whitespace → null（不限制，等价于切全部 5 路由）
 *   非空 → 去空格 + 转小写后的 Set；调用方未在白名单中的路由保持原路径。
 *
 * 与 server boot 解耦：每次读 `dbEnv.CUBE_ROUTING_ROUTES`，便于测试用 dbEnv 直接 mutate
 * （沿用 cube-route.test.ts / cube-kpi-cost.test.ts 既有模式，无需新增依赖注入）。
 */
function parseRoutesAllowlist(): Set<string> | null {
  const raw = (dbEnv.CUBE_ROUTING_ROUTES ?? '').trim();
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length === 0 ? null : new Set(parts);
}

/**
 * 判定单一路由是否被 CUBE_ROUTING 切流接管（对外直接返回 cube 结果）。
 *   - 全局总闸 `CUBE_ROUTING_ENABLED=false` → 始终 false
 *   - 总闸开 + 白名单缺省 → true（向后兼容旧"一刀切"行为）
 *   - 总闸开 + 白名单非空 → 仅白名单成员为 true
 */
export function isCubeRoutingEnabledFor(route: CubeRouteKey): boolean {
  if (dbEnv.CUBE_ROUTING_ENABLED !== 'true') return false;
  const allowlist = parseRoutesAllowlist();
  if (allowlist === null) return true;
  return allowlist.has(route);
}

/**
 * 判定单一路由是否启用影子对账（后台双跑、对外仍返回原路径结果）。
 *
 * RED LINE：影子与切流互斥——切流已接管该路由对外返回时，本函数对该路由始终返回 false，
 * 避免"切流路径已直出 cube 结果"后再额外双跑徒增一倍 DuckDB 负载。
 * 与原 5 路由 `cubeRouting || cubeShadow` 语义等价：同一路由不会同时进两条分支。
 */
export function isCubeShadowEnabledFor(route: CubeRouteKey): boolean {
  if (dbEnv.CUBE_SHADOW_COMPARE !== 'true') return false;
  if (isCubeRoutingEnabledFor(route)) return false;
  return true;
}

/**
 * 判定一次【已切流】请求是否要做切流后采样影子对账（R3 缺口闭环，BACKLOG bf2c4e）。
 *
 * 背景：切流后 isCubeShadowEnabledFor 对该路由返回 false（影子期双跑已停），
 * cube-vs-legacy 的数值背离不再被持续探测 —— 改写器语义漂移 / 类型回归（如
 * issue #608）将无生产 oracle 发现。本判定让【已切流】路由按 CUBE_SHADOW_SAMPLE_RATE
 * 采样：命中的请求对外仍直返 cube（不伤时延），路由层后台跑 legacy 与已返回的
 * cube 对账（cube-shadow.ts runPostCutoverShadowSample）。
 *
 * 仅对已切流路由生效（未切流路由由 isCubeShadowEnabledFor 全量影子覆盖）；
 * 缺省采样率 0 → 始终 false，零行为变更。
 */
export function shouldSamplePostCutoverShadow(route: CubeRouteKey): boolean {
  if (!isCubeRoutingEnabledFor(route)) return false;
  const rate = Number(dbEnv.CUBE_SHADOW_SAMPLE_RATE ?? '0');
  if (!(rate > 0)) return false;
  return Math.random() < rate;
}
