/**
 * cube-routing helper 单元测试（PR #11 部分切流闸 CUBE_ROUTING_ROUTES）。
 *
 * 覆盖：
 *   ① 全闸关：所有路由 routing/shadow 均 false（与 CUBE_ROUTING_ENABLED 默认零行为变更）
 *   ② 仅 routing 开 + 白名单缺省：5 路由全部切流（向后兼容旧"一刀切"行为）
 *   ③ routing 开 + 白名单非空：仅白名单成员切流，余者保持原路径
 *   ④ 白名单容错：空白 / 大小写 / 空逗号项
 *   ⑤ shadow 与 routing 互斥：切流路由的 shadow 始终 false（避免双跑）
 *   ⑥ 仅 shadow 开 + 路由未切流：所有 5 路由 shadow=true
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { dbEnv } from '../../config/env.js';
import {
  isCubeRoutingEnabledFor,
  isCubeShadowEnabledFor,
  type CubeRouteKey,
} from '../cube-routing.js';

const ALL_ROUTES: CubeRouteKey[] = ['trend', 'growth', 'cost', 'kpi', 'salesman-ranking'];

type DbEnvMutable = Record<string, string>;

const setFlags = (routing: string, shadow: string, routes: string = '') => {
  (dbEnv as unknown as DbEnvMutable).CUBE_ROUTING_ENABLED = routing;
  (dbEnv as unknown as DbEnvMutable).CUBE_SHADOW_COMPARE = shadow;
  (dbEnv as unknown as DbEnvMutable).CUBE_ROUTING_ROUTES = routes;
};

describe('cube-routing helper', () => {
  let saved: { routing: string; shadow: string; routes: string };

  beforeEach(() => {
    saved = {
      routing: dbEnv.CUBE_ROUTING_ENABLED,
      shadow: dbEnv.CUBE_SHADOW_COMPARE,
      routes: dbEnv.CUBE_ROUTING_ROUTES,
    };
  });

  afterEach(() => {
    setFlags(saved.routing, saved.shadow, saved.routes);
  });

  describe('isCubeRoutingEnabledFor', () => {
    it('① 全闸关：所有路由 routing=false', () => {
      setFlags('false', 'false', '');
      for (const r of ALL_ROUTES) {
        expect(isCubeRoutingEnabledFor(r)).toBe(false);
      }
    });

    it('② routing 开 + 白名单缺省：5 路由全部切流（向后兼容）', () => {
      setFlags('true', 'false', '');
      for (const r of ALL_ROUTES) {
        expect(isCubeRoutingEnabledFor(r)).toBe(true);
      }
    });

    it('② routing 开 + 白名单全空白：等价缺省，全部切流', () => {
      setFlags('true', 'false', '   ');
      for (const r of ALL_ROUTES) {
        expect(isCubeRoutingEnabledFor(r)).toBe(true);
      }
    });

    it('③ routing 开 + 白名单 3 路由：仅白名单成员切流', () => {
      setFlags('true', 'false', 'trend,growth,salesman-ranking');
      expect(isCubeRoutingEnabledFor('trend')).toBe(true);
      expect(isCubeRoutingEnabledFor('growth')).toBe(true);
      expect(isCubeRoutingEnabledFor('salesman-ranking')).toBe(true);
      expect(isCubeRoutingEnabledFor('cost')).toBe(false);
      expect(isCubeRoutingEnabledFor('kpi')).toBe(false);
    });

    it('③ routing 开 + 白名单仅 trend：余 4 路由保持原路径', () => {
      setFlags('true', 'false', 'trend');
      expect(isCubeRoutingEnabledFor('trend')).toBe(true);
      for (const r of ALL_ROUTES.filter(x => x !== 'trend')) {
        expect(isCubeRoutingEnabledFor(r)).toBe(false);
      }
    });

    it('④ 白名单容错：空格 / 大小写 / 空逗号项', () => {
      setFlags('true', 'false', '  Trend , , GROWTH ,,salesman-Ranking ');
      expect(isCubeRoutingEnabledFor('trend')).toBe(true);
      expect(isCubeRoutingEnabledFor('growth')).toBe(true);
      expect(isCubeRoutingEnabledFor('salesman-ranking')).toBe(true);
      expect(isCubeRoutingEnabledFor('cost')).toBe(false);
      expect(isCubeRoutingEnabledFor('kpi')).toBe(false);
    });

    it('④ 白名单仅含未知 key：5 路由都不切流（保守）', () => {
      setFlags('true', 'false', 'nonexistent-route');
      for (const r of ALL_ROUTES) {
        expect(isCubeRoutingEnabledFor(r)).toBe(false);
      }
    });

    it('总闸优先：CUBE_ROUTING_ENABLED=false 即使白名单非空仍 false', () => {
      setFlags('false', 'false', 'trend,growth,cost,kpi,salesman-ranking');
      for (const r of ALL_ROUTES) {
        expect(isCubeRoutingEnabledFor(r)).toBe(false);
      }
    });
  });

  describe('isCubeShadowEnabledFor', () => {
    it('① 全闸关：所有路由 shadow=false', () => {
      setFlags('false', 'false', '');
      for (const r of ALL_ROUTES) {
        expect(isCubeShadowEnabledFor(r)).toBe(false);
      }
    });

    it('⑥ 仅 shadow 开 + 路由未切流：5 路由 shadow=true', () => {
      setFlags('false', 'true', '');
      for (const r of ALL_ROUTES) {
        expect(isCubeShadowEnabledFor(r)).toBe(true);
      }
    });

    it('⑤ routing+shadow 双开 + 白名单切流 3 路由：切流路由 shadow=false（互斥避双跑）', () => {
      setFlags('true', 'true', 'trend,growth,salesman-ranking');
      // 切流路由：routing=true 接管对外结果，shadow 自动让出（避免一路径双跑）
      expect(isCubeShadowEnabledFor('trend')).toBe(false);
      expect(isCubeShadowEnabledFor('growth')).toBe(false);
      expect(isCubeShadowEnabledFor('salesman-ranking')).toBe(false);
      // 未切流路由：shadow 继续观察 cube vs legacy 差异
      expect(isCubeShadowEnabledFor('cost')).toBe(true);
      expect(isCubeShadowEnabledFor('kpi')).toBe(true);
    });

    it('⑤ 双开 + 白名单缺省（全切）：所有路由 shadow=false（无未切流路径）', () => {
      setFlags('true', 'true', '');
      for (const r of ALL_ROUTES) {
        expect(isCubeShadowEnabledFor(r)).toBe(false);
      }
    });

    it('⑤ 与既有 cube-route.test 行为对齐：routing=true shadow=false（缺省白名单）→ 全 routing true / 全 shadow false', () => {
      setFlags('true', 'false', '');
      for (const r of ALL_ROUTES) {
        expect(isCubeRoutingEnabledFor(r)).toBe(true);
        expect(isCubeShadowEnabledFor(r)).toBe(false);
      }
    });
  });
});
