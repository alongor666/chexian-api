export interface RouteConcurrencyGateOptions {
  limit: number;
  maxQueue: number;
  queueTimeoutMs: number;
}

export interface RouteConcurrencyGateEnterOptions {
  signal?: AbortSignal;
}

export interface RouteConcurrencyGateStats {
  active: number;
  waiting: number;
  limit: number;
  maxQueue: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

export class RouteConcurrencyError extends Error {
  constructor(message: string, public readonly statusCode = 429) {
    super(message);
    this.name = 'RouteConcurrencyError';
  }
}

export class RouteConcurrencyGate {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private readonly limit: number;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;

  constructor(options: RouteConcurrencyGateOptions) {
    this.limit = Math.max(1, Math.floor(options.limit));
    this.maxQueue = Math.max(0, Math.floor(options.maxQueue));
    this.queueTimeoutMs = Math.max(1, Math.floor(options.queueTimeoutMs));
  }

  enter(options: RouteConcurrencyGateEnterOptions = {}): Promise<() => void> {
    if (options.signal?.aborted) {
      return Promise.reject(new RouteConcurrencyError('Route concurrency request aborted', 499));
    }

    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createRelease());
    }

    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new RouteConcurrencyError('Route concurrency queue full'));
    }

    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(waiter);
        if (idx !== -1) this.queue.splice(idx, 1);
        waiter.cleanup();
        reject(new RouteConcurrencyError('Route concurrency request aborted', 499));
      };
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.queue.indexOf(waiter);
          if (idx !== -1) this.queue.splice(idx, 1);
          waiter.cleanup();
          reject(new RouteConcurrencyError(`Route concurrency queue timeout after ${this.queueTimeoutMs}ms`));
        }, this.queueTimeoutMs),
        cleanup: () => {
          clearTimeout(waiter.timer);
          options.signal?.removeEventListener('abort', onAbort);
        },
      };
      this.queue.push(waiter);
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  stats(): RouteConcurrencyGateStats {
    return {
      active: this.active,
      waiting: this.queue.length,
      limit: this.limit,
      maxQueue: this.maxQueue,
    };
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const waiter = this.queue.shift();
      if (waiter) {
        waiter.cleanup();
        waiter.resolve(this.createRelease());
        return;
      }

      this.active = Math.max(0, this.active - 1);
    };
  }
}
