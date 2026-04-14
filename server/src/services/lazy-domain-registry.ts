/**
 * LazyDomainRegistry — 惰性域注册表
 *
 * 管理辅助数据域的按需加载：
 * - 注册：register(name, loader) — 仅记录 loader 闭包，不加载
 * - 触发：ensureLoaded(name) — 首次调用时触发加载，并发安全（Promise 锁）
 * - 超时：15s 后返回 503，state 保持 loading（下次请求仍可等待原 Promise）
 * - 失败：state=failed，后续调用立即 throw 同一 error（不重试）
 *
 * @see 04-02-PLAN.md — MAT-01 惰性域架构
 */

const LAZY_LOAD_TIMEOUT_MS = 15_000;

interface LazyDomainEntry {
  loader: () => Promise<void>;
  state: 'unloaded' | 'loading' | 'loaded' | 'failed';
  promise: Promise<void> | null;
  error: Error | null;
}

export class LazyDomainRegistry {
  private readonly domains = new Map<string, LazyDomainEntry>();

  register(name: string, loader: () => Promise<void>): void {
    this.domains.set(name, { loader, state: 'unloaded', promise: null, error: null });
  }

  async ensureLoaded(name: string): Promise<void> {
    const entry = this.domains.get(name);
    if (!entry || entry.state === 'loaded') return;

    if (entry.state === 'loading') {
      // 并发安全：等待已有 Promise（加超时保护）
      return Promise.race([
        entry.promise!,
        this.timeoutReject(name),
      ]);
    }

    if (entry.state === 'failed') throw entry.error!;

    // 首次触发加载
    entry.state = 'loading';
    entry.promise = entry.loader()
      .then(() => { entry.state = 'loaded'; })
      .catch((err) => { entry.state = 'failed'; entry.error = err; throw err; });

    return Promise.race([entry.promise, this.timeoutReject(name)]);
  }

  private timeoutReject(name: string): Promise<never> {
    return new Promise<never>((_, reject) =>
      setTimeout(() => {
        const err = new Error(`Domain ${name} loading timeout (${LAZY_LOAD_TIMEOUT_MS}ms)`);
        (err as any).statusCode = 503;
        reject(err);
      }, LAZY_LOAD_TIMEOUT_MS)
    );
  }

  isLoaded(name: string): boolean {
    return this.domains.get(name)?.state === 'loaded';
  }

  getState(name: string): string {
    return this.domains.get(name)?.state ?? 'unknown';
  }
}
