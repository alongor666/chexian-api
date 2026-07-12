/**
 * 密码事件 webhook 通知单测（全员密码闭环 · 阶段二，2026-07-11）
 *
 * 锁定语义：
 *   1. 文案含账号、北京时间、中文方式标签、「非本人操作请联系管理员」提醒
 *   2. 静默失败：webhook 报错 / 网络超时 → 不 throw、不阻塞主流程
 *   3. 未配置 webhook → 不发起任何请求
 *   4. 载荷只含 username 与方式标签（令牌明文/密码明文无从进入——函数签名层面就不收）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 可变 env mock：notify 在调用时读取 authEnv 字段，测试间直接改值（vi.hoisted 防止 TDZ）
const envState = vi.hoisted(() => ({ PASSWORD_EVENT_NOTIFY_WEBHOOK: 'https://example.com/hook' }));
vi.mock('../../config/env.js', () => ({
  aiEnv: { UNMATCHED_NOTIFY_WEBHOOK: '' },
  authEnv: envState,
}));

import { notifyPasswordEvent } from '../notify.js';

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));

beforeEach(() => {
  fetchMock.mockClear();
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as never);
  vi.stubGlobal('fetch', fetchMock);
  envState.PASSWORD_EVENT_NOTIFY_WEBHOOK = 'https://example.com/hook';
});

describe('notifyPasswordEvent', () => {
  it('四类事件的中文标签与提醒文案齐全（口径：账号 X 的密码于 <北京时间> 通过 <方式> 变更）', async () => {
    const expectations: Array<[Parameters<typeof notifyPasswordEvent>[0]['method'], string]> = [
      ['activation', '激活令牌激活'],
      ['self_change', '自助改密'],
      ['feishu_reset', '飞书扫码找回'],
      ['admin_reset', '管理员重置'],
    ];
    for (const [method, label] of expectations) {
      fetchMock.mockClear();
      await notifyPasswordEvent({ username: 'leshan', method });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://example.com/hook');
      const body = JSON.parse(String(init.body));
      expect(body.msg_type).toBe('text');
      expect(body.content.text).toContain('账号 leshan 的密码于');
      expect(body.content.text).toContain('北京时间');
      expect(body.content.text).toContain(`「${label}」方式变更`);
      expect(body.content.text).toContain('非本人操作请联系管理员');
    }
  });

  it('静默失败：fetch 拒绝 / 非 2xx → 不 throw（通知失败不阻塞设密主流程）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'self_change' })).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as never);
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'admin_reset' })).resolves.toBeUndefined();
  });

  it('webhook 未配置 → 不发起任何请求', async () => {
    envState.PASSWORD_EVENT_NOTIFY_WEBHOOK = '';
    await notifyPasswordEvent({ username: 'leshan', method: 'activation' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
