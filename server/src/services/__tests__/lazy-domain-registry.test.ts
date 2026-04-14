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

  it('loader 失败：state=failed，后续 ensureLoaded 立即 throw 同一 error', async () => {
    const reg = new LazyDomainRegistry();
    const originalErr = new Error('load failed');
    reg.register('FailDomain', async () => { throw originalErr; });
    await expect(reg.ensureLoaded('FailDomain')).rejects.toBe(originalErr);
    await expect(reg.ensureLoaded('FailDomain')).rejects.toBe(originalErr);
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
});
