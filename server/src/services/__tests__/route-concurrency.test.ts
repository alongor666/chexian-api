import { describe, expect, it } from 'vitest';
import { RouteConcurrencyGate } from '../route-concurrency.js';

describe('RouteConcurrencyGate', () => {
  it('超过并发上限的请求留在应用层队列，释放后才进入执行区', async () => {
    const gate = new RouteConcurrencyGate({ limit: 2, maxQueue: 4, queueTimeoutMs: 10_000 });
    const entered: number[] = [];

    const run = async (id: number) => {
      const release = await gate.enter();
      entered.push(id);
      return release;
    };

    const first = await run(1);
    const second = await run(2);
    const thirdPromise = run(3);
    const fourthPromise = run(4);

    await Promise.resolve();
    expect(entered).toEqual([1, 2]);
    expect(gate.stats()).toMatchObject({ active: 2, waiting: 2, limit: 2 });

    first();
    const third = await thirdPromise;
    expect(entered).toEqual([1, 2, 3]);
    expect(gate.stats()).toMatchObject({ active: 2, waiting: 1, limit: 2 });

    second();
    const fourth = await fourthPromise;
    expect(entered).toEqual([1, 2, 3, 4]);
    expect(gate.stats()).toMatchObject({ active: 2, waiting: 0, limit: 2 });

    third();
    fourth();
    expect(gate.stats()).toMatchObject({ active: 0, waiting: 0, limit: 2 });
  });

  it('排队请求在客户端断开时可取消，避免之后拿到 permit 泄漏 active', async () => {
    const gate = new RouteConcurrencyGate({ limit: 1, maxQueue: 4, queueTimeoutMs: 10_000 });
    const first = await gate.enter();
    const abortController = new AbortController();

    const queued = gate.enter({ signal: abortController.signal });
    expect(gate.stats()).toMatchObject({ active: 1, waiting: 1, limit: 1 });

    abortController.abort();
    await expect(queued).rejects.toMatchObject({
      name: 'RouteConcurrencyError',
      statusCode: 499,
    });
    expect(gate.stats()).toMatchObject({ active: 1, waiting: 0, limit: 1 });

    first();
    expect(gate.stats()).toMatchObject({ active: 0, waiting: 0, limit: 1 });
  });
});
