/**
 * 权限控制中间件
 * Permission Control Middleware
 *
 * 实现行级安全（Row-Level Security），根据用户角色自动注入SQL WHERE条件
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';

/**
 * 用户角色枚举
 */
export enum UserRole {
  /** 分公司管理员 - 可查看所有数据 */
  BRANCH_ADMIN = 'branch_admin',
  /** 三级机构用户 - 只能查看本机构 + 分公司整体 */
  ORG_USER = 'org_user',
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

    const { role, organization } = req.user;

    // 2. 根据角色生成权限过滤条件
    if (role === UserRole.BRANCH_ADMIN) {
      // 分公司管理员：可查看所有数据
      req.permissionFilter = '1=1';
    } else if (role === UserRole.ORG_USER) {
      // 三级机构用户：只能查看本机构数据
      if (!organization) {
        throw new AppError(403, 'Organization not specified for ORG_USER role');
      }
      // 使用LIKE支持模糊匹配（如"乐山"可匹配"乐山中支"）
      req.permissionFilter = `org_level_3 LIKE '%${escapeSqlString(organization)}%'`;
    } else {
      // 未知角色
      throw new AppError(403, 'Invalid user role');
    }

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * 转义SQL字符串，防止SQL注入
 * 注意：这是简单的转义，生产环境应使用参数化查询
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
