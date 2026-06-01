/**
 * LazyDomainRegistry — 惰性域注册表
 *
 * 管理辅助数据域的按需加载：
 * - 注册：register(name, loader) — 仅记录 loader 闭包，不加载
 * - 触发：ensureLoaded(name) — 首次调用时触发加载，并发安全（Promise 锁）
 * - 超时：15s 后返回 503，state 保持 loading（下次请求仍可等待原 Promise）
 * - 失败：state 回滚到 unloaded，下次请求自动重试（本次请求仍 throw err，让上游感知）。
 *   这样 transient 错误（如 ConnectionPool acquire timeout）能在连接池恢复后自愈，
 *   permanent 错误（如文件缺失）也只是每请求 retry 一次 fs.existsSync，成本可忽略。
 *
 * @see 04-02-PLAN.md — MAT-01 惰性域架构
 */

const LAZY_LOAD_TIMEOUT_MS = 15_000;

export interface LazyDomainLoadOptions {
  timeoutMs?: number;
}

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

  async ensureLoaded(name: string, options: LazyDomainLoadOptions = {}): Promise<void> {
    const entry = this.domains.get(name);
    if (!entry || entry.state === 'loaded') return;
    const timeoutMs = options.timeoutMs ?? LAZY_LOAD_TIMEOUT_MS;

    if (entry.state === 'loading') {
      // 并发安全：等待已有 Promise（加超时保护）
      return this.raceWithTimeout(entry.promise!, name, timeoutMs);
    }

    // 首次触发加载
    entry.state = 'loading';
    entry.promise = entry.loader()
      .then(() => { entry.state = 'loaded'; })
      .catch((err) => {
        entry.state = 'unloaded';
        entry.promise = null;
        entry.error = err;
        throw err;
      });

    return this.raceWithTimeout(entry.promise!, name, timeoutMs);
  }

  async reload(name: string, options: LazyDomainLoadOptions = {}): Promise<void> {
    const entry = this.domains.get(name);
    if (!entry) {
      const err = new Error(`Domain ${name} is not registered`);
      (err as any).statusCode = 404;
      throw err;
    }
    const timeoutMs = options.timeoutMs ?? LAZY_LOAD_TIMEOUT_MS;
    if (entry.state === 'loading' && entry.promise) {
      return this.raceWithTimeout(entry.promise!, name, timeoutMs);
    }
    entry.state = 'loading';
    entry.error = null;
    entry.promise = entry.loader()
      .then(() => {
        entry.state = 'loaded';
      })
      .catch((err) => {
        entry.state = 'unloaded';
        entry.promise = null;
        entry.error = err;
        throw err;
      });
    return this.raceWithTimeout(entry.promise!, name, timeoutMs);
  }

  /**
   * 在超时上限内等待加载 promise；超时则 reject 503。
   *
   * 关键：用 try/finally 在 race 结束（无论 promise 先完成还是超时）后 clearTimeout，
   * 杜绝旧实现"加载胜出后定时器仍挂着到 timeoutMs 才触发"的泄漏——高频请求下会累积
   * 成百上千个待触发定时器，且 setTimeout 持有闭包引用阻止 GC。另对定时器 unref()，
   * 避免它单独把事件循环钉住（进程/测试无法干净退出）。
   */
  private async raceWithTimeout<T>(promise: Promise<T>, name: string, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Domain ${name} loading timeout (${timeoutMs}ms)`);
        (err as any).statusCode = 503;
        reject(err);
      }, timeoutMs);
      (timer as any).unref?.();
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  isLoaded(name: string): boolean {
    return this.domains.get(name)?.state === 'loaded';
  }

  getState(name: string): string {
    return this.domains.get(name)?.state ?? 'unknown';
  }
}
