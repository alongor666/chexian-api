/**
 * 权限控制中间件
 * Permission Control Middleware
 *
 * 实现行级安全（Row-Level Security），根据用户角色自动注入SQL WHERE条件
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { dbEnv } from '../config/env.js';

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
function isBranchRlsEnabled(): boolean {
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

    // 2. 根据角色生成基础权限过滤条件
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

    // 3. 多分公司 RLS（0F feature flag，含 codex PR #492 P1 fail-closed 修复）
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
function isValidBranchCode(code: string): boolean {
  return /^[A-Z]{2}$/.test(code);
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
