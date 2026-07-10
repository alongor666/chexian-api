import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDataVersion,
  setDataVersion,
  onDataVersionChange,
  bumpDataVersionFromTimestamp,
  makeTimestampVersionToken,
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
    expect(listener).toHaveBeenCalledWith('aabbccdd', 'init0000', 'full');
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

  it('bumpDataVersionFromTimestamp 兜底：不依赖指纹也能切换版本', () => {
    bumpDataVersionFromTimestamp();
    const first = getDataVersion();
    expect(first).not.toBe('init0000');
    expect(first).toHaveLength(8);
  });

  it('bumpDataVersionFromTimestamp 多次调用产生不同版本（保证旧 cache key 失效）', async () => {
    bumpDataVersionFromTimestamp();
    const v1 = getDataVersion();
    // 用 setImmediate 让 Date.now/Math.random 有机会变更
    await new Promise((r) => setTimeout(r, 5));
    bumpDataVersionFromTimestamp();
    const v2 = getDataVersion();
    expect(v2).not.toBe(v1);
  });

  it('makeTimestampVersionToken 是纯 token 生成器：不改变当前版本（B311 延迟提交）', () => {
    const token = makeTimestampVersionToken();
    expect(token.length).toBeGreaterThanOrEqual(8);
    expect(getDataVersion()).toBe('init0000');
    // 编排方提交后才生效
    setDataVersion(token);
    expect(getDataVersion()).toBe(token.slice(0, 8));
  });

  it('scope 默认为 full，并透传给监听者', async () => {
    const listener = vi.fn();
    onDataVersionChange(listener);
    setDataVersion('abcdef0123456789');
    await new Promise((r) => setImmediate(r));
    expect(listener).toHaveBeenCalledWith('abcdef01', 'init0000', 'full');
  });

  it('bumpDataVersionFromTimestamp 可指定 scope=domains（辅助域 reload，B311）', async () => {
    const listener = vi.fn();
    onDataVersionChange(listener);
    bumpDataVersionFromTimestamp('domains');
    await new Promise((r) => setImmediate(r));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][2]).toBe('domains');
  });
});
