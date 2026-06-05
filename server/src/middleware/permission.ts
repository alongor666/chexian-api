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

    const { role, organization, branchCode } = req.user;

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

    // 3. 多分公司 RLS（0F feature flag）：可选注入 branch_code 过滤
    // - flag 关闭：保留 0C 之前的单租户行为（兼容期）
    // - flag 开启 + 用户有 branchCode：AND `branch_code='${escape(branchCode)}'`
    // - flag 开启 + 用户无 branchCode（系统级超管 admin）：不加，看全国
    if (isBranchRlsEnabled() && branchCode) {
      req.permissionFilter = `(${baseFilter}) AND branch_code = '${escapeSqlString(branchCode)}'`;
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
