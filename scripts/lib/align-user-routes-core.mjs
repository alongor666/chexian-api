/**
 * 用户级路由白名单对齐 —— 纯函数层（CLI 见 scripts/ops/align-user-routes.mjs）
 *
 * 语义（与角色级 align-role-routes.mjs 的"整体覆盖"刻意不同）：
 * - 只补缺失（union），不删多余 —— 管理面可能给个别用户有意加过路由
 * - 只动 allowedRoutes 一个字段，其余（passwordHash/branchCode/active/organization
 *   等）原样保留 —— RLS-on 生产上 branchCode 丢失 = 全员 401 事故
 * - 只处理"角色在 PRESET_ROLES 中声明了 allowedRoutes"的用户（当前即 org_user）；
 *   branch_admin / telemarketing_user 角色级无 allowedRoutes，天然跳过
 */

/**
 * 计算逐用户对齐计划。
 * @param {{users?: Array<{username: string, role: string, allowedRoutes?: string[]}>}} store
 * @param {Array<{role: string, allowedRoutes?: string[]}>} presetRoles
 * @returns {Array<{username: string, role: string, current: string[], missing: string[], extra: string[], hadRoutesField: boolean}>}
 */
export function planUserRouteAdditions(store, presetRoles) {
  const roleRoutes = new Map(
    presetRoles
      .filter((p) => Array.isArray(p.allowedRoutes) && p.allowedRoutes.length > 0)
      .map((p) => [p.role, p.allowedRoutes]),
  );
  const entries = [];
  for (const user of store.users || []) {
    const presetRoutes = roleRoutes.get(user.role);
    if (!presetRoutes) continue;
    const hadRoutesField = Array.isArray(user.allowedRoutes);
    const current = hadRoutesField ? user.allowedRoutes : [];
    entries.push({
      username: user.username,
      role: user.role,
      current,
      missing: presetRoutes.filter((r) => !current.includes(r)),
      extra: current.filter((r) => !presetRoutes.includes(r)),
      hadRoutesField,
    });
  }
  return entries;
}

/**
 * 按计划返回新 store（不可变，不改入参）：仅对 missing 非空的用户
 * 把缺失路由追加到 allowedRoutes 末尾，其余字段与其他用户原样保留。
 */
export function applyUserRouteAdditions(store, plan) {
  const additions = new Map(
    plan.filter((e) => e.missing.length > 0).map((e) => [e.username, e.missing]),
  );
  return {
    ...store,
    users: (store.users || []).map((user) => {
      const missing = additions.get(user.username);
      if (!missing) return user;
      const current = Array.isArray(user.allowedRoutes) ? user.allowedRoutes : [];
      return { ...user, allowedRoutes: [...current, ...missing] };
    }),
  };
}
