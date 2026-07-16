/**
 * specialFeatures 功能开关后端强制（权限治理 Critical-1）
 *
 * 历史缺口：specialFeatures（'cost' / 'moto_cost'）存了库、前端用它控制成本相关视图，
 * 但后端零消费——直连 API（PAT / CLI / MCP / curl）可绕过前端闸。本中间件补上最后一道
 * 运行时校验。
 *
 * 2026-07-06-claude-286f55 产品决策：生产环境三态开关恒为 'true'，'cost' 判定实际
 * 全员放行，前端已下掉对应用户面权限开关（不再有 canAccessCost / COST_ALLOWED_USERS
 * 镜像，见 src/shared/config/organizations.ts）。本文件的 cost 判定（
 * canAccessCostFeature / COST_FALLBACK_USERS）予以保留，作为 'false' / 未设置两态下
 * 的防御性兜底（非生产环境、未来部署形态可能取不同 env 值），非死代码。
 *
 * moto_cost 判定语义仍镜像前端 src/shared/config/organizations.ts（canAccessMotoCost /
 * SUPER_USERS），**两处必须同步修改**：
 * - moto_cost：超管恒通过；否则 specialFeatures 须含 'moto_cost'（未定义 → 拒绝）；
 * - 超管不变量：admin / xuechenglong 对 moto_cost 恒通过（与前端一致）。
 *
 * 环境开关三态（镜像前端 VITE_ENABLE_COMPREHENSIVE_ANALYSIS，生产 .env.production='true'）：
 * - 'true'  → 全员放行（旁路本闸，与前端"全员可见"一致，生产现状不变）；
 * - 'false' → 全员拒绝（前端整个视图隐藏，后端一并关闭）；
 * - 未设置  → 按 specialFeatures 强制（cost 走 COST_FALLBACK_USERS 兜底）。
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from './error.js';
import { getUserByUsername } from '../services/access-control.js';
import { PRESET_USERS } from '../config/preset-users.js';
import { featureEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('special-feature');

export type SpecialFeature = 'cost' | 'moto_cost';

/** 镜像自前端 src/shared/config/organizations.ts SUPER_USERS，两处必须同步 */
export const SUPER_USERS: readonly string[] = ['admin', 'xuechenglong'];

/** 镜像自前端 COST_ALLOWED_USERS（specialFeatures 未定义时的静态回退白名单） */
const COST_FALLBACK_USERS: readonly string[] = ['linxia', 'xuechenglong', 'admin'];

export function isSuperUser(username: string | undefined): boolean {
  if (!username) return false;
  return SUPER_USERS.includes(username);
}

/** 镜像前端 canAccessCost：sf 已定义看开关，未定义回退用户名白名单 */
export function canAccessCostFeature(
  username: string | undefined,
  specialFeatures: string[] | undefined
): boolean {
  if (!username) return false;
  if (specialFeatures !== undefined) {
    return specialFeatures.includes('cost');
  }
  return COST_FALLBACK_USERS.includes(username);
}

/** 镜像前端 canAccessMotoCost：超管恒通过，否则看开关（未定义 → 拒绝） */
export function canAccessMotoCostFeature(
  username: string | undefined,
  specialFeatures: string[] | undefined
): boolean {
  if (isSuperUser(username)) return true;
  if (specialFeatures !== undefined) {
    return specialFeatures.includes('moto_cost');
  }
  return false;
}

export function hasSpecialFeature(
  feature: SpecialFeature,
  username: string | undefined,
  specialFeatures: string[] | undefined
): boolean {
  return feature === 'cost'
    ? canAccessCostFeature(username, specialFeatures)
    : canAccessMotoCostFeature(username, specialFeatures);
}

/**
 * 按 username 解析 specialFeatures：store 为主（与登录返回给前端的口径一致），
 * store 查不到或故障时回退 PRESET_USERS（预置账号在冷启动/存储故障下不失能）。
 * 返回 undefined 表示"该用户未定义 specialFeatures"（cost 走白名单回退语义）。
 */
export async function resolveSpecialFeatures(username: string): Promise<string[] | undefined> {
  try {
    const stored = await getUserByUsername(username);
    if (stored) return stored.specialFeatures;
  } catch (err) {
    log.warn(`specialFeatures 查询失败，回退 preset：${username}`, err);
  }
  return PRESET_USERS[username]?.specialFeatures;
}

/**
 * 路由闸：要求调用者具备指定功能开关。
 *
 * @param feature 功能开关名
 * @param opts.envSwitch 三态环境开关值的 getter（默认读 featureEnv.ENABLE_COMPREHENSIVE_ANALYSIS）。
 *   传 null 表示该路由不受环境开关影响、纯按 specialFeatures 强制。
 */
export function requireSpecialFeature(
  feature: SpecialFeature,
  opts: { envSwitch?: (() => string | undefined) | null } = {}
) {
  const readSwitch =
    opts.envSwitch === null
      ? () => undefined
      : opts.envSwitch ?? (() => featureEnv.ENABLE_COMPREHENSIVE_ANALYSIS);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const sw = readSwitch();
      if (sw === 'true') return next();
      if (sw === 'false') {
        return next(new AppError(403, '该功能已全局关闭'));
      }

      const username = req.user?.username;
      if (!username) {
        return next(new AppError(401, 'Authentication required'));
      }

      const specialFeatures = await resolveSpecialFeatures(username);
      if (!hasSpecialFeature(feature, username, specialFeatures)) {
        return next(new AppError(403, `该功能未对您开通（需要 ${feature} 功能开关）`));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
