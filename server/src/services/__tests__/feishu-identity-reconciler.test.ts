import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => vi.fn());
const disable = vi.hoisted(() => vi.fn());
const resolve = vi.hoisted(() => vi.fn());
vi.mock('../auth-identity.js', () => ({
  listEnabledFeishuIdentities: list,
  disableFeishuIdentity: disable,
}));
vi.mock('../feishu.js', () => ({
  feishuService: { resolveDepartmentEntitlement: resolve },
}));

import {
  reconcileFeishuIdentitiesOnce,
  startFeishuIdentityReconciler,
  stopFeishuIdentityReconciler,
} from '../feishu-identity-reconciler.js';

beforeEach(() => {
  list.mockReset(); disable.mockReset(); resolve.mockReset(); stopFeishuIdentityReconciler();
});
afterEach(() => { stopFeishuIdentityReconciler(); vi.useRealTimers(); });

describe('飞书身份生命周期对账', () => {
  it('明确非成员才停用，API 不可用保持原状', async () => {
    list.mockResolvedValue([
      { id: 'i1', providerSubject: 'member' },
      { id: 'i2', providerSubject: 'gone' },
      { id: 'i3', providerSubject: 'unknown' },
    ]);
    resolve
      .mockResolvedValueOnce({ status: 'member', entitlement: {} })
      .mockResolvedValueOnce({ status: 'not_member' })
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'timeout' });
    await expect(reconcileFeishuIdentitiesOnce()).resolves.toEqual({ checked: 3, disabled: 1, unavailable: 1 });
    expect(disable).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledWith('gone');
  });

  it('调度器幂等启动并可停止', async () => {
    vi.useFakeTimers();
    list.mockResolvedValue([]);
    startFeishuIdentityReconciler(1000);
    startFeishuIdentityReconciler(1000);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledOnce();
    stopFeishuIdentityReconciler();
    expect(vi.getTimerCount()).toBe(0);
  });
});
