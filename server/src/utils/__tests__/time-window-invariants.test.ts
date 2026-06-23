/**
 * 编译期不变量：路由参数 vs 指标时间语义兼容（B290 原始事故防回归闸）
 *
 * 原始事故（2026-05-12）：用户给日期窗口（5/1-5/11）却问"完成率"，
 * plan-achievement 路由（ytd-progress 口径）若接受自由窗口参数会被 zod 静默 strip /
 * 被 LLM 误解。不变量锁死：ytd-progress 口径路由的参数契约禁止声明自由窗口参数。
 *
 * 范围（codex 闸-1 P2.4）：仅锁 ytd-progress。snapshot/policy-year 不纳入
 * （snapshot 可能合法按 endDate 取快照，blanket 禁会误伤）。
 */
import { describe, expect, it } from 'vitest';
import { findYtdProgressWindowParamViolations } from '../route-helpers.js';
import { QUERY_ROUTE_METADATA } from '../../config/query-routes-metadata.js';
import { ROUTE_PARAM_CONTRACTS, contractAllowedKeys } from '../../config/route-param-contracts.js';

describe('findYtdProgressWindowParamViolations（纯函数）', () => {
  it('检出 ytd-progress 路由声明窗口参数（startDate）', () => {
    const v = findYtdProgressWindowParamViolations(
      [{ key: 'X', path: '/x', timeWindow: 'ytd-progress' }],
      () => new Set(['planYear', 'startDate'])
    );
    expect(v).toEqual([{ path: '/x', key: 'X', offendingParams: ['startDate'] }]);
  });

  it('window 口径路由声明窗口参数不算违规', () => {
    const v = findYtdProgressWindowParamViolations(
      [{ key: 'Y', path: '/y', timeWindow: 'window' }],
      () => new Set(['startDate', 'endDate'])
    );
    expect(v).toEqual([]);
  });

  it('ytd-progress 路由仅声明非窗口参数不算违规', () => {
    const v = findYtdProgressWindowParamViolations(
      [{ key: 'Z', path: '/z', timeWindow: 'ytd-progress' }],
      () => new Set(['planYear', 'level', 'orgFilter'])
    );
    expect(v).toEqual([]);
  });

  it('无契约的路由跳过（由 RouteCatalog参数契约 闸单独管）', () => {
    const v = findYtdProgressWindowParamViolations(
      [{ key: 'NC', path: '/no-contract', timeWindow: 'ytd-progress' }],
      () => undefined
    );
    expect(v).toEqual([]);
  });
});

describe('B290 真实注册表不变量', () => {
  it('所有 ytd-progress 路由均不声明自由窗口参数', () => {
    const violations = findYtdProgressWindowParamViolations(
      QUERY_ROUTE_METADATA,
      (path) => {
        const c = ROUTE_PARAM_CONTRACTS[path];
        return c ? contractAllowedKeys(c) : undefined;
      }
    );
    expect(violations).toEqual([]);
  });

  it('防呆：注册表中至少存在一个 ytd-progress 路由（枚举改名时测试不空转）', () => {
    const ytd = QUERY_ROUTE_METADATA.filter((m) => m.timeWindow === 'ytd-progress');
    expect(ytd.length).toBeGreaterThan(0);
  });
});
