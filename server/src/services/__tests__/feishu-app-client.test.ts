import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetFeishuAppClientForTest,
  feishuAppGetJson,
  getFeishuTenantAccessToken,
} from '../feishu-app-client.js';

const tokenResponse = (token = 'token-1', expire = 7200) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 0, tenant_access_token: token, expire }),
});

beforeEach(() => {
  __resetFeishuAppClientForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Feishu application client', () => {
  it('缓存 token，并在过期前五分钟刷新', async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse());
    vi.stubGlobal('fetch', fetchMock);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const input = { appId: 'app', appSecret: 'secret' };
    await getFeishuTenantAccessToken(input);
    now.mockReturnValue(1_000_000 + 6_899_000);
    await getFeishuTenantAccessToken(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 6_901_000);
    await getFeishuTenantAccessToken(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('并发首次请求只换取一次 token', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => { await gate; return tokenResponse(); });
    vi.stubGlobal('fetch', fetchMock);
    const input = { appId: 'app', appSecret: 'secret' };
    const requests = [getFeishuTenantAccessToken(input), getFeishuTenantAccessToken(input)];
    release();
    await expect(Promise.all(requests)).resolves.toEqual(['token-1', 'token-1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 与业务错误不泄露 secret/token，GET 使用超时信号', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse('sensitive-token'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 999, msg: 'denied' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(feishuAppGetJson({
      appId: 'app', appSecret: 'sensitive-secret', url: 'https://open.feishu.cn/open-apis/contact', timeoutMs: 1234,
    })).rejects.toThrow('code=999');
    const error = await feishuAppGetJson({
      appId: 'other', appSecret: 'sensitive-secret', url: 'https://open.feishu.cn/open-apis/contact',
    }).catch((caught) => caught);
    expect(String(error)).not.toContain('sensitive-secret');
    expect(String(error)).not.toContain('sensitive-token');
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('拒绝向非飞书 API 域名携带应用 token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(feishuAppGetJson({
      appId: 'app', appSecret: 'secret', url: 'https://attacker.example/open-apis/contact',
    })).rejects.toThrow('not allowlisted');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
