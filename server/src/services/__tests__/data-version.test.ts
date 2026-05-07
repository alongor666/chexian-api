import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDataVersion,
  setDataVersion,
  onDataVersionChange,
  _resetDataVersionForTesting,
} from '../data-version.js';

describe('data-version', () => {
  beforeEach(() => {
    _resetDataVersionForTesting();
  });

  it('初始版本为 init0000', () => {
    expect(getDataVersion()).toBe('init0000');
  });

  it('setDataVersion 取指纹前 8 字符', () => {
    setDataVersion('abcdef0123456789cafe');
    expect(getDataVersion()).toBe('abcdef01');
  });

  it('忽略空/null 输入', () => {
    setDataVersion(null);
    setDataVersion(undefined);
    setDataVersion('');
    expect(getDataVersion()).toBe('init0000');
  });

  it('相同版本不重复触发监听者', async () => {
    const listener = vi.fn();
    onDataVersionChange(listener);
    setDataVersion('aabbccdd11223344');
    setDataVersion('aabbccdd99999999'); // 前 8 字符相同
    await new Promise((r) => setImmediate(r));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('aabbccdd', 'init0000');
  });

  it('监听者异步触发，不阻塞 setDataVersion', async () => {
    const order: string[] = [];
    const listener = vi.fn(async () => {
      order.push('listener');
    });
    onDataVersionChange(listener);

    setDataVersion('1234567890abcdef');
    order.push('after-set');

    expect(order).toEqual(['after-set']); // listener 还未执行
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['after-set', 'listener']);
  });

  it('监听者抛错不影响其他监听者与版本变更', async () => {
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    onDataVersionChange(failing);
    onDataVersionChange(ok);
    setDataVersion('feedface00000000');
    await new Promise((r) => setImmediate(r));
    expect(getDataVersion()).toBe('feedface');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
