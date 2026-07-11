/**
 * shadow-judge.test.mjs — snapshotShadow / computeDelta / judge 单元测试
 *
 * 覆盖：
 *   - snapshotShadow：正常提取、缺字段兜底、cubeShadow 整体缺失
 *   - computeDelta：正常 delta、负 delta（after < before）
 *   - judge 五种结局：PASS / FAIL（mismatch）/ WARN（error）/ INSUFFICIENT / 多路由优先级
 *   - judge minMatch 默认值与自定义值
 */

import { describe, it, expect } from 'vitest';
import {
  snapshotShadow,
  computeDelta,
  judge,
  VERDICT,
  ACTIVE_SHADOW_KEYS,
} from '../lib/shadow-judge.mjs';

// ─── fixtures ─────────────────────────────────────────────────────

/** 5 路由全部为 0 的基础快照 */
function zeroHealth() {
  return {
    cubeShadow: {
      trend:              { match: 0, mismatch: 0, error: 0 },
      growth:             { match: 0, mismatch: 0, error: 0 },
      cost:               { match: 0, mismatch: 0, error: 0 },
      kpi:                { match: 0, mismatch: 0, error: 0 },
      'salesman-ranking': { match: 0, mismatch: 0, error: 0 },
    },
  };
}

/** 5 路由全部有足够 match 的健康快照 */
function healthyHealth(matchCount = 2000) {
  const entry = { match: matchCount, mismatch: 0, error: 0 };
  return {
    cubeShadow: {
      trend:              { ...entry },
      growth:             { ...entry },
      cost:               { ...entry },
      kpi:                { ...entry },
      'salesman-ranking': { ...entry },
    },
  };
}

// ─── snapshotShadow ───────────────────────────────────────────────

describe('snapshotShadow — 快照提取', () => {
  it('正常 health 响应 → 返回 3 条活跃路由各三字段，退役 cost/kpi 不进快照', () => {
    const snap = snapshotShadow(healthyHealth(500));
    const keys = ACTIVE_SHADOW_KEYS;
    expect(Object.keys(snap)).toEqual(expect.arrayContaining(keys));
    for (const k of keys) {
      expect(snap[k]).toMatchObject({ match: 500, mismatch: 0, error: 0 });
    }
    // 2026-07-11（f1c991）：cost/kpi 随 65f495 退役，判定域收窄到活跃路由
    expect(snap.cost).toBeUndefined();
    expect(snap.kpi).toBeUndefined();
  });

  it('cubeShadow 整体缺失 → 所有路由兜底为 0，不抛出', () => {
    const snap = snapshotShadow({});
    for (const val of Object.values(snap)) {
      expect(val).toMatchObject({ match: 0, mismatch: 0, error: 0 });
    }
  });

  it('某活跃路由缺失（如 growth 不在 cubeShadow 中，生产懒构建前实况）→ growth 兜底 0', () => {
    const health = {
      cubeShadow: {
        trend:              { match: 10, mismatch: 0, error: 0 },
        // growth 故意缺失（生产未有流量命中时 /health 不含该 key）
        'salesman-ranking': { match: 10, mismatch: 0, error: 0 },
      },
    };
    const snap = snapshotShadow(health);
    expect(snap.growth).toMatchObject({ match: 0, mismatch: 0, error: 0 });
  });

  it('字段值为字符串数字 → 转为 number', () => {
    const health = {
      cubeShadow: {
        trend: { match: '100', mismatch: '2', error: '1' },
        growth: {}, cost: {}, kpi: {}, 'salesman-ranking': {},
      },
    };
    const snap = snapshotShadow(health);
    expect(snap.trend.match).toBe(100);
    expect(snap.trend.mismatch).toBe(2);
    expect(snap.trend.error).toBe(1);
  });
});

// ─── computeDelta ─────────────────────────────────────────────────

describe('computeDelta — delta 计算', () => {
  it('before=0, after=1000 → delta.match=1000', () => {
    const before = snapshotShadow(zeroHealth());
    const after  = snapshotShadow(healthyHealth(1000));
    const delta  = computeDelta(before, after);
    for (const key of ACTIVE_SHADOW_KEYS) {
      expect(delta[key].match).toBe(1000);
      expect(delta[key].mismatch).toBe(0);
      expect(delta[key].error).toBe(0);
    }
  });

  it('after < before（负 delta）→ 返回负数，不抛出', () => {
    const before = snapshotShadow(healthyHealth(500));
    const after  = snapshotShadow(zeroHealth());
    const delta  = computeDelta(before, after);
    expect(delta.trend.match).toBe(-500);
  });

  it('before === after → delta 全为 0', () => {
    const h = healthyHealth(500);
    const delta = computeDelta(snapshotShadow(h), snapshotShadow(h));
    expect(delta.trend.match).toBe(0);
    expect(delta.growth.mismatch).toBe(0);
    expect(delta['salesman-ranking'].error).toBe(0);
  });

  it('各字段均正增长 → match delta 为正数，mismatch/error delta 非负', () => {
    const before = snapshotShadow(zeroHealth());
    const after  = snapshotShadow(healthyHealth(1000));
    const delta  = computeDelta(before, after);
    expect(delta.trend.match).toBeGreaterThan(0);
    expect(delta.growth.mismatch).toBeGreaterThanOrEqual(0);
    expect(delta['salesman-ranking'].error).toBeGreaterThanOrEqual(0);
  });

  it('部分路由有 mismatch 增量 → 对应 mismatch delta > 0', () => {
    const before = snapshotShadow(zeroHealth());
    const afterHealth = {
      cubeShadow: {
        trend:              { match: 100, mismatch: 3, error: 0 },
        growth:             { match: 100, mismatch: 0, error: 0 },
        cost:               { match: 100, mismatch: 0, error: 0 },
        kpi:                { match: 100, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 100, mismatch: 0, error: 0 },
      },
    };
    const after = snapshotShadow(afterHealth);
    const delta = computeDelta(before, after);
    expect(delta.trend.mismatch).toBe(3);
    expect(delta.growth.mismatch).toBe(0);
  });
});

// ─── judge — 判定逻辑 ─────────────────────────────────────────────

describe('judge — PASS', () => {
  it('所有路由 match>=1000, mismatch=0, error=0 → PASS', () => {
    const before = snapshotShadow(zeroHealth());
    const after  = snapshotShadow(healthyHealth(1500));
    const delta  = computeDelta(before, after);
    const result = judge(delta, { minMatch: 1000 });
    expect(result.verdict).toBe(VERDICT.PASS);
  });

  it('minMatch 自定义为 100，match=150 → PASS', () => {
    const before = snapshotShadow(zeroHealth());
    const after  = snapshotShadow(healthyHealth(150));
    const delta  = computeDelta(before, after);
    const result = judge(delta, { minMatch: 100 });
    expect(result.verdict).toBe(VERDICT.PASS);
  });
});

describe('judge — FAIL（mismatch > 0）', () => {
  it('任一路由 mismatch_delta > 0 → FAIL', () => {
    const before = snapshotShadow(zeroHealth());
    const afterHealth = {
      cubeShadow: {
        trend:              { match: 2000, mismatch: 1, error: 0 },
        growth:             { match: 2000, mismatch: 0, error: 0 },
        cost:               { match: 2000, mismatch: 0, error: 0 },
        kpi:                { match: 2000, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 2000, mismatch: 0, error: 0 },
      },
    };
    const delta  = computeDelta(snapshotShadow(zeroHealth()), snapshotShadow(afterHealth));
    const result = judge(delta, { minMatch: 1000 });
    expect(result.verdict).toBe(VERDICT.FAIL);
    expect(result.perRoute.trend.verdict).toBe(VERDICT.FAIL);
  });
});

describe('judge — WARN（error > 0, 无 mismatch）', () => {
  it('error_delta > 0 且 mismatch=0 → WARN', () => {
    const before = snapshotShadow(zeroHealth());
    const afterHealth = {
      cubeShadow: {
        trend:              { match: 2000, mismatch: 0, error: 2 },
        growth:             { match: 2000, mismatch: 0, error: 0 },
        cost:               { match: 2000, mismatch: 0, error: 0 },
        kpi:                { match: 2000, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 2000, mismatch: 0, error: 0 },
      },
    };
    const delta  = computeDelta(snapshotShadow(zeroHealth()), snapshotShadow(afterHealth));
    const result = judge(delta, { minMatch: 1000 });
    expect(result.verdict).toBe(VERDICT.WARN);
  });
});

describe('judge — INSUFFICIENT（match < minMatch）', () => {
  it('match_delta < minMatch 且 mismatch=0 error=0 → INSUFFICIENT', () => {
    const before = snapshotShadow(zeroHealth());
    const after  = snapshotShadow(healthyHealth(50));  // 50 < 默认 1000
    const delta  = computeDelta(before, after);
    const result = judge(delta);  // 默认 minMatch=1000
    expect(result.verdict).toBe(VERDICT.INSUFFICIENT);
  });
});

describe('judge — 多路由优先级 FAIL > WARN > INSUFFICIENT', () => {
  it('同时有 mismatch + error → FAIL 优先', () => {
    const before = snapshotShadow(zeroHealth());
    const afterHealth = {
      cubeShadow: {
        trend:              { match: 2000, mismatch: 1, error: 0 },
        growth:             { match: 2000, mismatch: 0, error: 3 },
        cost:               { match: 2000, mismatch: 0, error: 0 },
        kpi:                { match: 2000, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 2000, mismatch: 0, error: 0 },
      },
    };
    const delta  = computeDelta(snapshotShadow(zeroHealth()), snapshotShadow(afterHealth));
    const result = judge(delta, { minMatch: 1000 });
    expect(result.verdict).toBe(VERDICT.FAIL);
  });

  it('同时有 error + match 不足 → WARN 优先（error > INSUFFICIENT）', () => {
    const before = snapshotShadow(zeroHealth());
    const afterHealth = {
      cubeShadow: {
        trend:              { match: 5, mismatch: 0, error: 1 },   // error + insufficient
        growth:             { match: 5, mismatch: 0, error: 0 },   // insufficient only
        cost:               { match: 2000, mismatch: 0, error: 0 },
        kpi:                { match: 2000, mismatch: 0, error: 0 },
        'salesman-ranking': { match: 2000, mismatch: 0, error: 0 },
      },
    };
    const delta  = computeDelta(snapshotShadow(zeroHealth()), snapshotShadow(afterHealth));
    const result = judge(delta, { minMatch: 1000 });
    expect(result.verdict).toBe(VERDICT.WARN);
  });

  it('perRoute 每个活跃路由的 verdict 独立正确，退役路由不进 perRoute', () => {
    const afterHealth = {
      cubeShadow: {
        trend:              { match: 2000, mismatch: 1, error: 0 },  // FAIL
        growth:             { match: 2000, mismatch: 0, error: 1 },  // WARN
        'salesman-ranking': { match: 5,    mismatch: 0, error: 0 },  // INSUFFICIENT
      },
    };
    const delta  = computeDelta(snapshotShadow(zeroHealth()), snapshotShadow(afterHealth));
    const result = judge(delta, { minMatch: 1000 });
    expect(result.perRoute.trend.verdict).toBe(VERDICT.FAIL);
    expect(result.perRoute.growth.verdict).toBe(VERDICT.WARN);
    expect(result.perRoute['salesman-ranking'].verdict).toBe(VERDICT.INSUFFICIENT);
    expect(result.perRoute.cost).toBeUndefined();
    expect(result.perRoute.kpi).toBeUndefined();
    // 全局取最高优先级
    expect(result.verdict).toBe(VERDICT.FAIL);
  });

  it('summary 是非空字符串', () => {
    const delta = computeDelta(snapshotShadow(zeroHealth()), snapshotShadow(healthyHealth(2000)));
    const result = judge(delta, { minMatch: 1000 });
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
