/**
 * requireSpecialFeature 中间件单测（权限治理 Critical-1）
 *
 * 语义镜像前端 src/shared/config/organizations.ts（canAccessCost / canAccessMotoCost），
 * 覆盖：环境开关三态旁路 / store 主源 / preset 回退 / cost 白名单回退 / moto 超管不变量。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// featureEnv mock：可变对象，用例按需切三态
const envMock = vi.hoisted(() => ({
  ENABLE_COMPREHENSIVE_ANALYSIS: undefined as string | undefined,
}));
vi.mock('../../config/env.js', () => ({
  featureEnv: envMock,
}));

// access-control store mock
const getUserByUsernameMock = vi.hoisted(() =>
  vi.fn(async (_username: string): Promise<{ specialFeatures?: string[] } | null> => null)
);
vi.mock('../../services/access-control.js', () => ({
  getUserByUsername: getUserByUsernameMock,
}));

// preset mock：受控的最小预置表
vi.mock('../../config/preset-users.js', () => ({
  PRESET_USERS: {
    presetCostUser: { username: 'presetCostUser', specialFeatures: ['cost'] },
    presetPlainUser: { username: 'presetPlainUser' },
  },
}));

import {
  requireSpecialFeature,
  canAccessCostFeature,
  canAccessMotoCostFeature,
  resolveSpecialFeatures,
} from '../special-feature.js';

function makeReq(username?: string) {
  return { user: username ? { username } : undefined } as any;
}

/** 跑中间件，返回 next 收到的参数（undefined = 放行） */
async function run(mw: ReturnType<typeof requireSpecialFeature>, req: any): Promise<any> {
  return new Promise((resolve) => {
    void mw(req, {} as any, (err?: unknown) => resolve(err));
  });
}

beforeEach(() => {
  envMock.ENABLE_COMPREHENSIVE_ANALYSIS = undefined;
  getUserByUsernameMock.mockReset();
  getUserByUsernameMock.mockResolvedValue(null);
});

describe('纯函数：canAccessCostFeature（镜像前端 canAccessCost）', () => {
  it('specialFeatures 已定义 → 看开关', () => {
    expect(canAccessCostFeature('anyone', ['cost'])).toBe(true);
    expect(canAccessCostFeature('anyone', [])).toBe(false);
  });

  it('specialFeatures 未定义 → 回退静态白名单', () => {
    expect(canAccessCostFeature('linxia', undefined)).toBe(true);
    expect(canAccessCostFeature('stranger', undefined)).toBe(false);
  });

  it('username 缺失 → 拒绝', () => {
    expect(canAccessCostFeature(undefined, ['cost'])).toBe(false);
  });
});

describe('纯函数：canAccessMotoCostFeature（镜像前端 canAccessMotoCost）', () => {
  it('超管恒通过（即使开关被显式改掉）', () => {
    expect(canAccessMotoCostFeature('admin', [])).toBe(true);
    expect(canAccessMotoCostFeature('xuechenglong', undefined)).toBe(true);
  });

  it('普通用户看开关；未定义 → 拒绝', () => {
    expect(canAccessMotoCostFeature('alice', ['moto_cost'])).toBe(true);
    expect(canAccessMotoCostFeature('alice', [])).toBe(false);
    expect(canAccessMotoCostFeature('alice', undefined)).toBe(false);
  });
});

describe('resolveSpecialFeatures：store 主源 + preset 回退', () => {
  it('store 命中 → 用 store 值（与登录返回前端的口径一致）', async () => {
    getUserByUsernameMock.mockResolvedValue({ specialFeatures: ['moto_cost'] });
    expect(await resolveSpecialFeatures('presetCostUser')).toEqual(['moto_cost']);
  });

  it('store 未命中 → 回退 preset', async () => {
    getUserByUsernameMock.mockResolvedValue(null);
    expect(await resolveSpecialFeatures('presetCostUser')).toEqual(['cost']);
  });

  it('store 抛错 → 回退 preset（预置账号在存储故障下不失能）', async () => {
    getUserByUsernameMock.mockRejectedValue(new Error('duckdb down'));
    expect(await resolveSpecialFeatures('presetCostUser')).toEqual(['cost']);
  });

  it('store 与 preset 均无 → undefined（cost 走白名单回退语义）', async () => {
    expect(await resolveSpecialFeatures('nobody')).toBeUndefined();
  });
});

describe('requireSpecialFeature 中间件：环境开关三态', () => {
  it("'true' → 全员旁路（生产现状：综合分析全员开放）", async () => {
    envMock.ENABLE_COMPREHENSIVE_ANALYSIS = 'true';
    const err = await run(requireSpecialFeature('cost'), makeReq('stranger'));
    expect(err).toBeUndefined();
  });

  it("'false' → 全员 403（前端整个视图隐藏，后端一并关闭）", async () => {
    envMock.ENABLE_COMPREHENSIVE_ANALYSIS = 'false';
    getUserByUsernameMock.mockResolvedValue({ specialFeatures: ['cost'] });
    const err = await run(requireSpecialFeature('cost'), makeReq('presetCostUser'));
    expect(err).toMatchObject({ statusCode: 403 });
  });

  it('未设置 → 按 specialFeatures 强制：有开关放行', async () => {
    getUserByUsernameMock.mockResolvedValue({ specialFeatures: ['cost'] });
    const err = await run(requireSpecialFeature('cost'), makeReq('alice'));
    expect(err).toBeUndefined();
  });

  it('未设置 → 无开关且不在白名单 → 403（branch_admin 也不例外）', async () => {
    getUserByUsernameMock.mockResolvedValue({ specialFeatures: [] });
    const err = await run(requireSpecialFeature('cost'), makeReq('jiachengxian'));
    expect(err).toMatchObject({ statusCode: 403 });
  });

  it('未认证 → 401', async () => {
    const err = await run(requireSpecialFeature('cost'), makeReq(undefined));
    expect(err).toMatchObject({ statusCode: 401 });
  });

  it('envSwitch: null → 不受环境开关影响（纯按开关强制）', async () => {
    envMock.ENABLE_COMPREHENSIVE_ANALYSIS = 'true';
    getUserByUsernameMock.mockResolvedValue({ specialFeatures: [] });
    const err = await run(
      requireSpecialFeature('moto_cost', { envSwitch: null }),
      makeReq('alice'),
    );
    expect(err).toMatchObject({ statusCode: 403 });
  });
});
