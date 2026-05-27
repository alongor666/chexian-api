import { describe, it, expect, vi } from 'vitest';
import { LazyDomainRegistry } from '../lazy-domain-registry.js';

describe('LazyDomainRegistry', () => {
  it('首次 ensureLoaded 触发 loader，二次调用不重复执行', async () => {
    const reg = new LazyDomainRegistry();
    let callCount = 0;
    reg.register('TestDomain', async () => { callCount++; });
    await reg.ensureLoaded('TestDomain');
    await reg.ensureLoaded('TestDomain');
    expect(callCount).toBe(1);
    expect(reg.isLoaded('TestDomain')).toBe(true);
  });

  it('并发两次 ensureLoaded：loader 只调用一次，两个 Promise 都 resolve', async () => {
    const reg = new LazyDomainRegistry();
    let callCount = 0;
    reg.register('ConcurrentDomain', async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 10));
    });
    await Promise.all([
      reg.ensureLoaded('ConcurrentDomain'),
      reg.ensureLoaded('ConcurrentDomain'),
    ]);
    expect(callCount).toBe(1);
    expect(reg.isLoaded('ConcurrentDomain')).toBe(true);
  });

  it('loader 失败：state 回滚为 unloaded，下次 ensureLoaded 重新调用 loader（不缓存 failed）', async () => {
    const reg = new LazyDomainRegistry();
    let callCount = 0;
    const originalErr = new Error('load failed');
    reg.register('FailDomain', async () => {
      callCount++;
      throw originalErr;
    });
    await expect(reg.ensureLoaded('FailDomain')).rejects.toBe(originalErr);
    expect(reg.getState('FailDomain')).toBe('unloaded');
    await expect(reg.ensureLoaded('FailDomain')).rejects.toBe(originalErr);
    expect(callCount).toBe(2); // loader 被重试，而非缓存上次失败
  });

  it('loader 首次失败、二次成功：transient 错误自愈（覆盖 ConnectionPool acquire timeout 场景）', async () => {
    const reg = new LazyDomainRegistry();
    let callCount = 0;
    reg.register('FlakeyDomain', async () => {
      callCount++;
      if (callCount === 1) throw new Error('ConnectionPool: acquire timeout after 2000ms');
    });
    await expect(reg.ensureLoaded('FlakeyDomain')).rejects.toThrow('ConnectionPool');
    expect(reg.getState('FlakeyDomain')).toBe('unloaded');
    await reg.ensureLoaded('FlakeyDomain');
    expect(reg.isLoaded('FlakeyDomain')).toBe(true);
    expect(callCount).toBe(2);
  });

  it('reload 已加载域时会重新执行 loader', async () => {
    const reg = new LazyDomainRegistry();
    let callCount = 0;
    reg.register('CustomerFlow', async () => {
      callCount++;
    });

    await reg.ensureLoaded('CustomerFlow');
    await reg.reload('CustomerFlow');

    expect(callCount).toBe(2);
    expect(reg.isLoaded('CustomerFlow')).toBe(true);
  });

  it('加载超时（15s 模拟）：抛出 statusCode=503 的错误，state 保持 loading', async () => {
    vi.useFakeTimers();
    const reg = new LazyDomainRegistry();
    // 永不 resolve 的 loader
    reg.register('SlowDomain', () => new Promise(() => {}));
    const loadPromise = reg.ensureLoaded('SlowDomain');
    vi.advanceTimersByTime(15_001);
    const err = await loadPromise.catch(e => e);
    expect((err as any).statusCode).toBe(503);
    expect(err.message).toContain('timeout');
    expect(reg.getState('SlowDomain')).toBe('loading');  // state 不变为 failed
    vi.useRealTimers();
  });

  it('内部调用在默认 15s 超时窗口内仍可继续等待真实完成', async () => {
    vi.useFakeTimers();
    const reg = new LazyDomainRegistry();
    reg.register('SlowWarmupDomain', () => new Promise<void>((resolve) => setTimeout(resolve, 20_000)));

    const loadPromise = reg.ensureLoaded('SlowWarmupDomain');
    vi.advanceTimersByTime(15_001);
    await expect(loadPromise).rejects.toMatchObject({ statusCode: 503 });
    expect(reg.getState('SlowWarmupDomain')).toBe('loading');

    vi.advanceTimersByTime(5_000);
    await reg.ensureLoaded('SlowWarmupDomain');
    expect(reg.isLoaded('SlowWarmupDomain')).toBe(true);
    vi.useRealTimers();
  });

  // TC-05: 域依赖链 —— ClaimsAgg → ClaimsDetail 模式验证
  // 验证计划 04-02-PLAN.md 中 ClaimsAgg 三路回退最终分支的显式依赖声明
  it('TC-05: 域 B 的 loader 内调用 ensureLoaded(A)，两个域均成功加载', async () => {
    const reg = new LazyDomainRegistry();
    const loadOrder: string[] = [];

    // Domain A：叶子节点，独立加载
    reg.register('ClaimsDetail', async () => {
      loadOrder.push('ClaimsDetail');
    });

    // Domain B：依赖 A，loader 内部显式先调用 ensureLoaded('ClaimsDetail')
    reg.register('ClaimsAgg', async () => {
      await reg.ensureLoaded('ClaimsDetail'); // 显式依赖声明
      loadOrder.push('ClaimsAgg');
    });

    await reg.ensureLoaded('ClaimsAgg');

    // 两个域均已加载
    expect(reg.isLoaded('ClaimsDetail')).toBe(true);
    expect(reg.isLoaded('ClaimsAgg')).toBe(true);

    // ClaimsDetail 先于 ClaimsAgg 加载
    expect(loadOrder).toEqual(['ClaimsDetail', 'ClaimsAgg']);
  });

  // TC-06: 域 A 已加载时，域 B 触发的 ensureLoaded(A) 不重复执行 A 的 loader
  it('TC-06: 依赖域已加载时，依赖链不触发重复加载', async () => {
    const reg = new LazyDomainRegistry();
    let detailLoadCount = 0;

    reg.register('ClaimsDetail', async () => {
      detailLoadCount++;
    });

    reg.register('ClaimsAgg', async () => {
      await reg.ensureLoaded('ClaimsDetail');
    });

    // 先独立加载 ClaimsDetail
    await reg.ensureLoaded('ClaimsDetail');
    expect(detailLoadCount).toBe(1);

    // 再加载 ClaimsAgg（内部再次 ensureLoaded ClaimsDetail）
    await reg.ensureLoaded('ClaimsAgg');
    // ClaimsDetail loader 只执行了一次
    expect(detailLoadCount).toBe(1);
  });
});
