/**
 * 权限控制中间件
 * Permission Control Middleware
 *
 * 实现行级安全（Row-Level Security），根据用户角色自动注入SQL WHERE条件
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { dbEnv } from '../config/env.js';
import { PRESET_ROLES } from '../config/preset-users.js';

/**
 * 后端 API 路由前缀 → 前端页面路径映射表（唯一事实源）
 *
 * org_user 的 allowedRoutes 是前端页面路径（如 '/home'、'/performance-analysis'），
 * 而后端路由路径（如 '/cost'、'/salesman-ranking'）需通过此映射表转换后才能与白名单比对。
 *
 * 规则：
 *  - key = 后端 /api/query/ 之后的路径前缀（精确或前缀匹配，最长优先）
 *  - value = 对应的前端页面路径（即 allowedRoutes 中的值）
 *  - 未出现在此表的路由视为"无前端页面对应"，不受白名单限制
 *    （如 /kpi、/trend 是多页面共用基础路由，对 org_user 开放）
 *
 * 新增受限路由时在此表追加，不改其他地方。
 */
export const API_ROUTE_TO_PAGE_MAP: Record<string, string> = {
  // /cost 页面（成本分析）—— org_user 不可见
  '/cost': '/cost',
  '/comprehensive-bundle': '/cost',
  '/comprehensive-analysis-bundle': '/cost',

  // /reports 页面（报表）—— org_user 不可见
  '/premium-report': '/reports',
  '/marketing-report': '/reports',
  '/holiday-drilldown': '/reports',

  // /premium-plan 对应 /reports 下的计划达成版块 —— org_user 不可见
  '/premium-plan': '/reports',
  '/plan-achievement': '/reports',

  // /salesman-ranking 对应 branch_admin 专属报表 —— org_user 不可见
  '/salesman-ranking': '/reports',

  // /repair 页面（维修分析）—— org_user 不可见
  '/repair': '/repair',

  // /customer-flow 页面（客户流转）—— org_user 不可见
  '/customer-flow': '/customer-flow',

  // /claims-detail 页面（赔案明细）—— org_user 不可见
  // 注意：/chart-ledger 页面依赖此域数据，未来给 org_user 开放 /chart-ledger
  // 时须同步在其 allowedRoutes 中开放本页面，否则会出现"页面能进、图表 403"的体验断层
  '/claims-detail': '/claims-detail',

  // /quote-conversion 页面（报价转化）—— org_user 不可见
  // 注意：/chart-ledger 页面依赖此域数据，未来给 org_user 开放 /chart-ledger
  // 时须同步在其 allowedRoutes 中开放本页面，否则会出现"页面能进、图表 403"的体验断层
  '/quote-conversion': '/quote-conversion',

  // /expense-development 页面（费用发展）—— org_user 不可见
  '/expense-development': '/expense-development',

  // /renewal-tracker 页面（续保跟踪）—— org_user 不可见
  '/renewal-tracker': '/renewal-tracker',
};

/**
 * 将后端请求路径（req.path）解析为对应的前端页面路径。
 * 采用精确匹配优先、前缀匹配兜底（最长前缀优先，防止 /cost 误匹配 /cost-detail）。
 *
 * 对非字符串（如 undefined）安全返回 undefined（不受白名单限制），
 * 避免测试环境或异常请求 path 缺失时触发错误。
 *
 * @returns 对应的前端页面路径，或 undefined（此路由无页面映射，不受白名单限制）
 */
function resolvePageRoute(apiPath: string | undefined): string | undefined {
  if (typeof apiPath !== 'string') return undefined;
  // 精确匹配优先
  if (apiPath in API_ROUTE_TO_PAGE_MAP) {
    return API_ROUTE_TO_PAGE_MAP[apiPath];
  }
  // 前缀匹配（最长前缀优先），用于 /sub/path 形式
  const keys = Object.keys(API_ROUTE_TO_PAGE_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (apiPath.startsWith(key + '/')) {
      return API_ROUTE_TO_PAGE_MAP[key];
    }
  }
  return undefined;
}

/**
 * 获取角色的 allowedRoutes（从 PRESET_ROLES 按角色名取，不依赖 JWT token）。
 * org_user 角色的 allowedRoutes 均为 ORG_ROLE_ALLOWED_ROUTES（SSOT 在 PRESET_ROLES）。
 * 返回 null 表示该角色不受路由白名单限制（branch_admin / 系统超管）。
 */
function getAllowedRoutesForRole(role: string): string[] | null {
  // branch_admin 和 admin 不受路由白名单限制
  if (role === UserRole.BRANCH_ADMIN) return null;

  const presetRole = PRESET_ROLES.find((r) => r.role === role);
  if (!presetRole?.allowedRoutes || presetRole.allowedRoutes.length === 0) return null;
  return presetRole.allowedRoutes;
}

/**
 * 用户角色枚举
 */
export enum UserRole {
  /** 分公司管理员 - 可查看所有数据 */
  BRANCH_ADMIN = 'branch_admin',
  /** 三级机构用户 - 只能查看本机构 + 分公司整体 */
  ORG_USER = 'org_user',
  /** 电销用户 - 只能查看电销数据，但可以跨机构查看 */
  TELEMARKETING_USER = 'telemarketing_user',
}

/**
 * 多分公司 RLS 启用判定（0F feature flag）
 * 仅当 BRANCH_RLS_ENABLED === 'true' 时返回 true（严格字符串匹配）
 */
export function isBranchRlsEnabled(): boolean {
  return dbEnv.BRANCH_RLS_ENABLED === 'true';
}

/**
 * 扩展Request类型，添加权限过滤字段
 */
declare global {
  namespace Express {
    interface Request {
      /** 权限过滤SQL WHERE子句（后端强制执行） */
      permissionFilter?: string;
      /**
       * 全国超管解析后的「有效省」：单省码（'SC'/'SX'）或 'ALL'（合并视图）。
       * 普通用户恒等于本人 branchCode（targetBranch 被忽略）。
       * 供 cache key（buildRouteCacheKey）与机构下拉（getVisibleOrganizations）按有效省取值，
       * 避免全国超管切省后仍用静态 branchCode 造成串读 / 下拉错省。
       */
      effectiveBranch?: string;
    }
  }
}

/**
 * 权限中间件
 * 根据用户角色生成行级安全WHERE子句
 */
export function permissionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. 检查用户是否已认证
    if (!req.user) {
      throw new AppError(401, 'Authentication required');
    }

    const { role, organization, branchCode, visibleBranches } = req.user;

    // 2. 路由级白名单校验（纵深防御 —— 第二层，数据已有 RLS 为第一层）
    // 仅对 org_user 生效；admin / branch_admin 不受限。
    // 原理：将 req.path（后端路径，如 '/cost'）映射到前端页面路径（如 '/cost'），
    // 再对比用户 allowedRoutes 白名单（值为前端页面路径，如 '/performance-analysis'）。
    const routeAllowList = getAllowedRoutesForRole(role);
    if (routeAllowList !== null) {
      const pageRoute = resolvePageRoute(req.path as string | undefined);
      if (pageRoute !== undefined && !routeAllowList.includes(pageRoute)) {
        throw new AppError(
          403,
          `无访问权限：该路由（${req.path}）不在您的访问白名单内`
        );
      }
    }

    // 3. 根据角色生成基础权限过滤条件
    let baseFilter: string;
    if (role === UserRole.BRANCH_ADMIN) {
      // 分公司管理员：可查看所有数据
      baseFilter = '1=1';
    } else if (role === UserRole.ORG_USER) {
      // 三级机构用户：只能查看本机构数据（严格等值匹配）
      if (!organization) {
        throw new AppError(403, 'Organization not specified for ORG_USER role');
      }
      baseFilter = `org_level_3 = '${escapeSqlString(organization)}'`;
    } else if (role === UserRole.TELEMARKETING_USER) {
      // 电销用户：只能查看电销数据
      baseFilter = 'is_telemarketing = true';
    } else {
      // 未知角色
      throw new AppError(403, 'Invalid user role');
    }

    // 4. 多分公司 RLS（0F feature flag，含 codex PR #492 P1 fail-closed 修复）
    // - flag 关闭：保留 0C 之前的单租户行为（兼容期）
    // - flag 开启 + 用户有 branchCode：注入 branch_code 等值过滤
    //   - baseFilter='1=1' 时直接 `branch_code='${branchCode}'`（避免冗余括号让 SQL 直通白名单失败）
    //   - 否则 `(${baseFilter}) AND branch_code='${branchCode}'`
    // - flag 开启 + 用户无 branchCode：**fail-closed 401**，强制重登拿带 branchCode 的新 token
    //   旧 JWT（升级前签发）/旧 user_store.json 用户没有 branchCode 字段，必须重新登录刷新 token；
    //   admin（系统超管）由 preset-users 已显式标 'SC'，落在上方有 branchCode 分支。
    if (isBranchRlsEnabled()) {
      // ── fail-closed 校验：对所有 RLS-on 用户无条件前置（codex 闸-1 P1-2）──
      // 必须在「全国超管 / 普通用户」分支之前，否则超管路径回落 branchCode 时会绕过校验。
      if (!branchCode) {
        throw new AppError(
          401,
          'Token missing branchCode (multi-branch RLS enabled). Please re-login to refresh your token.'
        );
      }
      // fail-closed 校验 branchCode 形态（codex PR #804 评审 P1）：必须 CHAR(2) 大写（SC/SX…）。
      // 否则脏配置/异常 token（如小写 'sx'、含单引号 `S'C`、长度不符）会让下游 RLS 解析失效——
      // resolveBranchRlsCode 的 gate-a 正则 `branch_code = '[A-Z]{2}'` 匹配不上 → 返回 undefined →
      // 不注入 → branch_admin（无 org_level_3 段）退成 1=1 → 跨省/全省串读（fail-open）。
      // 在此源头拒绝（403），保证 permissionFilter 只含合法 branch_code 字面量，下游必命中。
      if (!isValidBranchCode(branchCode)) {
        throw new AppError(
          403,
          `Invalid branchCode '${branchCode}' (multi-branch RLS requires uppercase CHAR(2), e.g. SC/SX). 请联系管理员修正账号 branchCode。`
        );
      }

      // ── 全国超管路径（设计 §5；codex 闸-1 P1-2：仅 branch_admin 生效，防 org_user 脏配置越权）──
      // visibleBranches = 该用户可切换/可合并的省集合（服务端 token 白名单，绝不信任请求原值）。
      const canSwitchBranch =
        role === UserRole.BRANCH_ADMIN &&
        Array.isArray(visibleBranches) &&
        visibleBranches.length > 0;

      let effectiveBranch: string;
      let branchClause: string; // 单省 `branch_code = 'XX'` 或 ALL `branch_code IN ('SC','SX')`

      if (canSwitchBranch) {
        // 仅保留形态合法的可见省（每个值过 ^[A-Z]{2}$ 再可能进 SQL）
        const allowedBranches = (visibleBranches as string[]).filter(isValidBranchCode);
        const requested =
          typeof req.query?.targetBranch === 'string' ? req.query.targetBranch : undefined;

        if (allowedBranches.length === 0) {
          // 防御：visibleBranches 全是脏值（被 filter 清空）→ fail-closed 回落本人默认省，绝不放行。
          effectiveBranch = branchCode;
          branchClause = `branch_code = '${escapeSqlString(branchCode)}'`;
        } else if (requested === 'ALL') {
          // 合并视图：**显式 IN 白名单**（codex 闸-2 P1-1 defense-in-depth）——绝不用 1=1。
          // 即便运行时存在未授权省（如未上线的 GD）数据，主路径与所有「下推完整 permissionFilter」
          // 的消费方也只返回 visibleBranches 集合内的省，杜绝「ALL=1=1」直接泄漏未授权省。
          // 每个 b 已过 ^[A-Z]{2}$（allowedBranches），无注入面。
          effectiveBranch = 'ALL';
          branchClause = `branch_code IN (${allowedBranches.map((b) => `'${b}'`).join(', ')})`;
        } else if (requested && allowedBranches.includes(requested)) {
          // 切单省：requested 已经 allowedBranches（含正则）双重校验，可安全内插。
          effectiveBranch = requested;
          branchClause = `branch_code = '${escapeSqlString(requested)}'`;
        } else {
          // 无参 / 非法参 / 未授权省（如未上线的 'GD'）→ 回落本人默认省（保守，绝不默认 ALL）。
          effectiveBranch = branchCode;
          branchClause = `branch_code = '${escapeSqlString(branchCode)}'`;
        }
      } else {
        // ── 普通用户路径：忽略用户可控的 targetBranch（防越权看他省）──
        effectiveBranch = branchCode;
        branchClause = `branch_code = '${escapeSqlString(branchCode)}'`;
      }

      req.effectiveBranch = effectiveBranch;
      req.permissionFilter =
        baseFilter === '1=1' ? branchClause : `(${baseFilter}) AND ${branchClause}`;
    } else {
      req.permissionFilter = baseFilter;
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * 转义SQL字符串，防止SQL注入
 * 当前为等值匹配，仅转义单引号
 */
function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * 分公司编码形态校验：必须大写 CHAR(2)（'SC' / 'SX' …）。
 * 与下游 resolveBranchRlsCode 的 gate-a 正则同源约束，保证拼入 SQL 的 branch_code 字面量合法。
 */
export function isValidBranchCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
}

/**
 * 计算调用者在「用户管理面」可管理的分公司范围（与数据面 RLS 同源收敛）。
 *
 * 数据面已按 branch_code 做行级隔离，但 /api/auth/users|roles 管理面历史上只判角色
 * （requireRole(BRANCH_ADMIN)），导致单省 branch_admin（如山西 sxAdmin）可跨省列出/改密/
 * 禁用/提权四川账号——与其数据权限矛盾的管理面越权。本函数把管理面收敛到与数据面一致的省范围。
 *
 * 返回：
 * - `null` → 可管理**全部**（RLS 关，单租户，行为不变）
 * - `string[]` 非空 → 只能管理这些省的账号（全国超管取 visibleBranches；单省 admin 取本人 branchCode）
 * - `[]` 空数组 → RLS 开但调用者无合法 branchCode（异常态）→ fail-closed，谁都管不了
 */
export function getManageableBranchScope(user: {
  branchCode?: string;
  visibleBranches?: string[];
}): string[] | null {
  if (!isBranchRlsEnabled()) return null;
  const vb = Array.isArray(user.visibleBranches)
    ? user.visibleBranches.filter(isValidBranchCode)
    : [];
  if (vb.length > 0) return vb;
  if (user.branchCode && isValidBranchCode(user.branchCode)) return [user.branchCode];
  return [];
}

/**
 * 判断调用者（由 getManageableBranchScope 得到的 scope）能否管理归属 targetBranch 的账号。
 *
 * - `scope === null`（RLS 关）→ 放行全部。
 * - 目标账号无 branchCode（历史遗留账号）→ **仅** scope===null 放行，否则拒绝（fail-safe，
 *   避免单省 admin 借「无省账号」这一模糊态跨省操作）。
 * - 否则要求 targetBranch ∈ scope。
 */
export function canManageBranch(scope: string[] | null, targetBranch: string | undefined): boolean {
  if (scope === null) return true;
  if (!targetBranch) return false;
  return scope.includes(targetBranch);
}

/**
 * 角色检查中间件
 * 限制某些路由只能由特定角色访问
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role as UserRole)) {
      return next(
        new AppError(403, `Access denied. Required role: ${allowedRoles.join(' or ')}`)
      );
    }

    next();
  };
}

/**
 * fail-closed 收窄（B326 / plan 风险表 m1）：req.permissionFilter 必由 permissionMiddleware
 * 为**每个**已认证请求生成（branch_admin=`'1=1'` / org_user=`org_level_3='...'` /
 * 电销=`is_telemarketing=true`，多分公司 RLS 下再 AND `branch_code='XX'`）。
 *
 * `undefined` = permissionMiddleware **未执行**（路由漏挂中间件 / 装配回归 / 绕过）= bug。
 * 此时必须 **fail-closed 拒绝**，绝不退化为 `|| '1=1'` 放行全表——后者在派生域联邦 /
 * 多分公司下 = 跨机构、跨省越权泄漏面。
 *
 * `'1=1'` 是 branch_admin 的**合法**值（下游短路放行），原样返回，**不**在此拦截。
 * 与 utils/sql-permission-injector.ts `isPermissionFilterMissing` 同源（sql-passthrough.ts m1 守卫）。
 */
export function requirePermissionFilter(permissionFilter: string | undefined): string {
  if (permissionFilter === undefined) {
    throw new AppError(
      403,
      '权限过滤缺失（permissionMiddleware 未生成 req.permissionFilter）— fail-closed 拒绝执行',
    );
  }
  return permissionFilter;
}
