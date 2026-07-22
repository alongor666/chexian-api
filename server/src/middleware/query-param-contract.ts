import type { NextFunction, Request, Response } from 'express';
import { GLOBAL_REGISTERED_QUERY_PARAMS } from '../config/query-param-policy.js';
import {
  ROUTE_PARAM_CONTRACTS,
  contractAllowedKeys,
} from '../config/route-param-contracts.js';
import { AppError } from './error.js';

const GLOBAL_KEYS = new Set<string>(GLOBAL_REGISTERED_QUERY_PARAMS);

/**
 * 对已有参数契约的查询路由执行 fail-closed 参数校验。
 *
 * 未登记路由保持原有下沉/404 行为；一旦登记，任何未知键都在惰性域加载、缓存和 SQL 前
 * 返回 400。错误只回显参数名，不回显用户值。
 */
export function rejectUnknownRegisteredQueryParams(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const contract = ROUTE_PARAM_CONTRACTS[req.path];
  if (!contract) {
    next();
    return;
  }

  const allowed = contractAllowedKeys(contract);
  for (const key of GLOBAL_KEYS) allowed.add(key);
  const unknown = Object.keys(req.query)
    .filter((key) => !allowed.has(key))
    .sort((left, right) => left.localeCompare(right));

  if (unknown.length > 0) {
    next(new AppError(
      400,
      `不支持的查询参数: ${unknown.join(', ')}；请先通过 /api/discover/routes 查看该路由参数契约`,
    ));
    return;
  }
  next();
}
