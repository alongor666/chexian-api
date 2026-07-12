/**
 * 密码事件通知单测（全员密码闭环 · 阶段二，2026-07-11；双通道改造 2026-07-12）
 *
 * 锁定语义：
 *   1. 文案含账号、北京时间、中文方式标签、「非本人操作请联系管理员」提醒
 *   2. 通道选择三分支：webhook 非空走 webhook（旧路径优先，修补不拆除）→
 *      否则 chat_id 非空走飞书应用 API → 两者皆空不发起任何请求
 *   3. tenant_access_token 进程内缓存：命中不重取、过期（提前 5 分钟）后刷新
 *   4. 静默失败：webhook / token / 消息 API 报错 → 不 throw、不阻塞主流程
 *   5. 载荷只含 username 与方式（令牌明文/密码明文无从进入——函数签名层面就不收）；
 *      失败日志不含 app_secret / token
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 可变 env mock：notify 在调用时读取 authEnv/feishuEnv 字段，测试间直接改值（vi.hoisted 防止 TDZ）
const envState = vi.hoisted(() => ({
  auth: {
    PASSWORD_EVENT_NOTIFY_WEBHOOK: 'https://example.com/hook',
    PASSWORD_EVENT_NOTIFY_CHAT_ID: '',
    PASSWORD_NOTIFY_APP_ID: '',
    PASSWORD_NOTIFY_APP_SECRET: '',
  },
  feishu: {
    FEISHU_APP_ID: 'cli_test_app',
    FEISHU_APP_SECRET: 'fake-placeholder-not-a-real-secret',
  },
}));
vi.mock('../../config/env.js', () => ({
  aiEnv: { UNMATCHED_NOTIFY_WEBHOOK: '' },
  authEnv: envState.auth,
  feishuEnv: envState.feishu,
}));

import { notifyPasswordEvent, __resetTenantTokenCacheForTest } from '../notify.js';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id';

const fetchMock = vi.fn(
  async (_url: unknown, _init?: RequestInit): Promise<any> => ({ ok: true, status: 200 })
);

/** 应用 API 双端点路由 mock：token 端点发 t1，消息端点回 code=0 */
function routeAppApiFetch(overrides?: {
  tokenResponse?: unknown;
  messageResponse?: unknown;
}) {
  fetchMock.mockImplementation(async (url: unknown) => {
    if (String(url) === TOKEN_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => overrides?.tokenResponse ?? { code: 0, tenant_access_token: 't1', expire: 7200 },
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => overrides?.messageResponse ?? { code: 0 },
    };
  });
}

/** 切到「仅 chat_id 配置」的应用 API 通道 */
function useChatChannel() {
  envState.auth.PASSWORD_EVENT_NOTIFY_WEBHOOK = '';
  envState.auth.PASSWORD_EVENT_NOTIFY_CHAT_ID = 'oc_test_chat';
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as never);
  vi.stubGlobal('fetch', fetchMock);
  __resetTenantTokenCacheForTest();
  envState.auth.PASSWORD_EVENT_NOTIFY_WEBHOOK = 'https://example.com/hook';
  envState.auth.PASSWORD_EVENT_NOTIFY_CHAT_ID = '';
  envState.auth.PASSWORD_NOTIFY_APP_ID = '';
  envState.auth.PASSWORD_NOTIFY_APP_SECRET = '';
  envState.feishu.FEISHU_APP_ID = 'cli_test_app';
  envState.feishu.FEISHU_APP_SECRET = 'fake-placeholder-not-a-real-secret';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifyPasswordEvent · webhook 旧路径回归', () => {
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
});

describe('notifyPasswordEvent · 通道选择三分支', () => {
  it('webhook 非空 → 只走 webhook，即便 chat_id 也配置了（旧路径优先，修补不拆除）', async () => {
    envState.auth.PASSWORD_EVENT_NOTIFY_CHAT_ID = 'oc_test_chat';
    await notifyPasswordEvent({ username: 'leshan', method: 'self_change' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/hook');
  });

  it('webhook 空 + chat_id 非空 → 走应用 API：先取 token 再发消息，凭证回落 FEISHU_APP_ID/SECRET', async () => {
    useChatChannel();
    routeAppApiFetch();

    await notifyPasswordEvent({ username: 'leshan', method: 'feishu_reset' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe(TOKEN_URL);
    expect(JSON.parse(String(tokenInit.body))).toEqual({
      app_id: 'cli_test_app',
      app_secret: 'fake-placeholder-not-a-real-secret',
    });

    const [msgUrl, msgInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(msgUrl).toBe(MESSAGE_URL);
    expect((msgInit.headers as Record<string, string>).Authorization).toBe('Bearer t1');
    const body = JSON.parse(String(msgInit.body));
    expect(body.receive_id).toBe('oc_test_chat');
    expect(body.msg_type).toBe('text');
    const text = JSON.parse(body.content).text as string;
    expect(text).toContain('账号 leshan 的密码于');
    expect(text).toContain('「飞书扫码找回」方式变更');
  });

  it('PASSWORD_NOTIFY_APP_ID/SECRET 配置时覆盖回落凭证（将来换专用通知应用）', async () => {
    useChatChannel();
    envState.auth.PASSWORD_NOTIFY_APP_ID = 'cli_dedicated';
    envState.auth.PASSWORD_NOTIFY_APP_SECRET = 'fake-placeholder-dedicated-app';
    routeAppApiFetch();

    await notifyPasswordEvent({ username: 'leshan', method: 'activation' });

    const [, tokenInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(tokenInit.body))).toEqual({
      app_id: 'cli_dedicated',
      app_secret: 'fake-placeholder-dedicated-app',
    });
  });

  it('webhook 与 chat_id 皆空 → 不发起任何请求', async () => {
    envState.auth.PASSWORD_EVENT_NOTIFY_WEBHOOK = '';
    envState.auth.PASSWORD_EVENT_NOTIFY_CHAT_ID = '';
    await notifyPasswordEvent({ username: 'leshan', method: 'activation' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chat_id 通道但应用凭证缺失 → 静默跳过，不发起任何请求', async () => {
    useChatChannel();
    envState.feishu.FEISHU_APP_ID = '';
    envState.feishu.FEISHU_APP_SECRET = '';
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'self_change' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('notifyPasswordEvent · tenant_access_token 缓存', () => {
  it('缓存命中：连续两次通知只取一次 token（1 token + 2 消息 = 3 次 fetch）', async () => {
    useChatChannel();
    routeAppApiFetch();

    await notifyPasswordEvent({ username: 'leshan', method: 'self_change' });
    await notifyPasswordEvent({ username: 'leshan', method: 'admin_reset' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url) === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
  });

  it('过期刷新：越过「过期前 5 分钟」阈值后重新取 token', async () => {
    useChatChannel();
    routeAppApiFetch({ tokenResponse: { code: 0, tenant_access_token: 't1', expire: 7200 } });

    const t0 = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await notifyPasswordEvent({ username: 'leshan', method: 'self_change' });

    // 7200s 有效期 − 5min 提前量 = 6900s 后失效；拨到 6901s
    nowSpy.mockReturnValue(t0 + 6901 * 1000);
    await notifyPasswordEvent({ username: 'leshan', method: 'self_change' });

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url) === TOKEN_URL);
    expect(tokenCalls).toHaveLength(2);
  });

  it('未过期不刷新：拨到失效阈值之前仍复用缓存', async () => {
    useChatChannel();
    routeAppApiFetch({ tokenResponse: { code: 0, tenant_access_token: 't1', expire: 7200 } });

    const t0 = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await notifyPasswordEvent({ username: 'leshan', method: 'self_change' });

    nowSpy.mockReturnValue(t0 + 6899 * 1000);
    await notifyPasswordEvent({ username: 'leshan', method: 'self_change' });

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url) === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
  });
});

describe('notifyPasswordEvent · 应用 API 失败静默', () => {
  it('token 获取失败（HTTP 非 2xx / code≠0 / 网络异常）→ 不 throw，且日志不泄露 app_secret', async () => {
    useChatChannel();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as never);
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'self_change' })).resolves.toBeUndefined();

    __resetTenantTokenCacheForTest();
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ code: 10003, msg: 'invalid app_secret' }),
    } as never);
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'self_change' })).resolves.toBeUndefined();

    __resetTenantTokenCacheForTest();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'self_change' })).resolves.toBeUndefined();

    const logged = warnSpy.mock.calls.map(args => args.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('fake-placeholder-not-a-real-secret');
  });

  it('消息 API 失败（HTTP 非 2xx / code≠0）→ 不 throw，且日志不泄露 token', async () => {
    useChatChannel();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    routeAppApiFetch({ messageResponse: { code: 230002, msg: 'bot not in chat' } });
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'admin_reset' })).resolves.toBeUndefined();

    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === TOKEN_URL) {
        return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: 't1', expire: 7200 }) };
      }
      return { ok: false, status: 403, json: async () => ({}) };
    });
    __resetTenantTokenCacheForTest();
    await expect(notifyPasswordEvent({ username: 'leshan', method: 'admin_reset' })).resolves.toBeUndefined();

    const logged = warnSpy.mock.calls.map(args => args.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('t1');
  });
});
