/**
 * route-runner.test.mjs — buildQueryString / runWithConcurrency / ROUTES 单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  ROUTES,
  buildQueryString,
  runWithConcurrency,
} from '../lib/route-runner.mjs';

// ─── buildQueryString ─────────────────────────────────────────────

describe('buildQueryString — query string 序列化', () => {
  it('空对象 → 返回空字符串', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('值为 undefined 或 null → 跳过这些 key', () => {
    const qs = buildQueryString({ a: 'hello', b: undefined, c: null, d: 'world' });
    expect(qs).toContain('a=hello');
    expect(qs).toContain('d=world');
    expect(qs).not.toContain('b=');
    expect(qs).not.toContain('c=');
  });

  it('boolean true/false → 序列化为字符串 true/false', () => {
    const qs = buildQueryString({ enabled: true, visible: false });
    expect(qs).toContain('enabled=true');
    expect(qs).toContain('visible=false');
  });

  it('数字值 → 序列化为字符串', () => {
    const qs = buildQueryString({ year: 2026, count: 0 });
    expect(qs).toContain('year=2026');
    expect(qs).toContain('count=0');
  });
});

// ─── runWithConcurrency ───────────────────────────────────────────

describe('runWithConcurrency — 并发执行器', () => {
  it('3 个同步 thunk + concurrency=2 → 结果数组长度为 3，顺序对应', async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];
    const results = await runWithConcurrency(tasks, 2);
    expect(results).toHaveLength(3);
    expect(results[0]).toBe(1);
    expect(results[1]).toBe(2);
    expect(results[2]).toBe(3);
  });

  it('1 个 thunk 抛错 + concurrency=1 → Promise.reject 不卡死，抛出错误', async () => {
    const tasks = [() => Promise.reject(new Error('测试错误'))];
    await expect(runWithConcurrency(tasks, 1)).rejects.toThrow('测试错误');
  });

  it('concurrency=2 真并发 → 总耗时显著低于串行', async () => {
    // 3 个 task，每个 sleep 80ms。
    // 串行（concurrency=1）≈ 240ms；concurrency=2 分 2+1 批次 ≈ 160ms。
    // 阈值 200ms：比串行少 40ms buffer，兼顾 CI 环境调度抖动。
    const mkTask = () => () => new Promise(r => setTimeout(() => r('ok'), 80));
    const tasks = [mkTask(), mkTask(), mkTask()];
    const start = performance.now();
    const results = await runWithConcurrency(tasks, 2);
    const elapsed = performance.now() - start;
    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(elapsed).toBeLessThan(200); // 串行会是 240ms+，此处验证真并发效果
  });
});

// ─── ROUTES ──────────────────────────────────────────────────────

describe('ROUTES 常量', () => {
  it('长度为 5', () => {
    expect(ROUTES).toHaveLength(5);
  });

  it('包含 5 个预期路由 key', () => {
    const keys = ROUTES.map(r => r.key);
    expect(keys).toContain('trend');
    expect(keys).toContain('growth');
    expect(keys).toContain('cost');
    expect(keys).toContain('kpi');
    expect(keys).toContain('salesman');
  });

  it('每个路由的 path 映射符合预期', () => {
    const byKey = Object.fromEntries(ROUTES.map(r => [r.key, r.path]));
    expect(byKey.trend).toBe('/api/query/trend');
    expect(byKey.growth).toBe('/api/query/growth');
    expect(byKey.cost).toBe('/api/query/cost');
    expect(byKey.kpi).toBe('/api/query/kpi');
    expect(byKey.salesman).toBe('/api/query/salesman-ranking');
  });
});
