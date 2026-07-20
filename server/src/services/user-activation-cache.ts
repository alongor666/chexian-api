/**
 * JWT 运行时授权支持：内存态用户授权缓存（纯缓存层，零重依赖）
 *
 * 为什么独立成模块：authMiddleware 需要一个 O(1) 的「该账号是否仍有效」判断，但**不能**为此
 * 传递依赖 access-control → duckdb（原生 .node 模块）——否则任何 import authMiddleware 的单测
 * 都会在 CI（无原生二进制）加载阶段整片失败。故把纯缓存独立于此：
 *   - authMiddleware 只依赖本模块（纯 JS，无 duckdb），O(1) 读取 active / allowedRoutes
 *   - access-control（写侧，已依赖 duckdb）在启动 seed 及每次用户写操作后原子重建
 *
 * 单实例 fork 架构下内存态天然一致（与 rateLimiter / PAT verifyCache 同构）；重启由 seed 重建。
 */

let activeUsernames: Set<string> | null = null;
let allowedRoutesByUsername: Map<string, readonly string[]> | null = null;

export interface RuntimeUserAuthorization {
  username: string;
  active: boolean;
  allowedRoutes?: string[];
}

/** 原子重建认证热路径所需的用户授权缓存。输入来自 UserAccount 当前全量快照。 */
export function setUserAuthorizationCache(users: Iterable<RuntimeUserAuthorization>): void {
  const nextActive = new Set<string>();
  const nextAllowedRoutes = new Map<string, readonly string[]>();
  for (const user of users) {
    if (user.active) nextActive.add(user.username);
    if (user.allowedRoutes && user.allowedRoutes.length > 0) {
      nextAllowedRoutes.set(user.username, Object.freeze([...user.allowedRoutes]));
    }
  }
  activeUsernames = nextActive;
  allowedRoutesByUsername = nextAllowedRoutes;
}

/**
 * 用最新的「active 且存在」用户名集合重建缓存。由 access-control 单向写入（单一写者）。
 */
export function setActiveUsernames(usernames: Iterable<string>): void {
  activeUsernames = new Set(usernames);
}

/**
 * 该用户名当前是否为「有效在职账号」（存在且 active）。供 authMiddleware 在 jwt.verify 后二次校验，
 * 令被禁用 / 删除账号的未过期旧 JWT 立即失效（对齐 PAT 每请求查 active 的安全语义，但零每请求 DB）。
 *
 * 缓存未就绪（null：启动早期 / 未经 seed 的测试）→ **fail-open 返回 true**，绝不因缓存缺失误锁全站；
 * 正常运行期 seedAccessControlData 已重建缓存，恒就绪。
 */
export function isUsernameActive(username: string): boolean {
  if (activeUsernames === null) return true;
  return activeUsernames.has(username);
}

/**
 * 获取用户级页面白名单。undefined 表示未配置或缓存尚未就绪，由 permissionMiddleware
 * 回退角色默认值。返回副本，避免请求侧意外改写全局缓存。
 */
export function getUserAllowedRoutes(username: string): string[] | undefined {
  const routes = allowedRoutesByUsername?.get(username);
  return routes ? [...routes] : undefined;
}

/** 仅供测试：重置缓存到未就绪态（fail-open）。 */
export function __resetActiveUsernamesCacheForTest(): void {
  activeUsernames = null;
  allowedRoutesByUsername = null;
}
