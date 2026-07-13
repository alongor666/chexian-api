const TENANT_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const FEISHU_API_ORIGIN = 'https://open.feishu.cn';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenInFlight = new Map<string, Promise<string>>();

export function __resetFeishuAppClientForTest(): void {
  tokenCache.clear();
  tokenInFlight.clear();
}

export async function getFeishuTenantAccessToken(input: {
  appId: string;
  appSecret: string;
  timeoutMs?: number;
}): Promise<string> {
  const cached = tokenCache.get(input.appId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const existing = tokenInFlight.get(input.appId);
  if (existing) return existing;

  const request = (async () => {
    const response = await fetch(TENANT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: input.appId, app_secret: input.appSecret }),
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`tenant_access_token HTTP ${response.status}`);
    const data = await response.json() as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`tenant_access_token code=${data.code} msg=${data.msg ?? ''}`);
    }
    const expireMs = Math.max(0, (data.expire ?? 0) * 1000 - REFRESH_AHEAD_MS);
    tokenCache.set(input.appId, {
      token: data.tenant_access_token,
      expiresAt: Date.now() + expireMs,
    });
    return data.tenant_access_token;
  })();
  tokenInFlight.set(input.appId, request);
  try {
    return await request;
  } finally {
    tokenInFlight.delete(input.appId);
  }
}

export async function feishuAppGetJson<T>(input: {
  appId: string;
  appSecret: string;
  url: string;
  timeoutMs?: number;
}): Promise<T> {
  const url = new URL(input.url);
  if (url.origin !== FEISHU_API_ORIGIN || !url.pathname.startsWith('/open-apis/')) {
    throw new Error('Feishu app GET URL is not allowlisted');
  }
  const token = await getFeishuTenantAccessToken(input);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Feishu app GET HTTP ${response.status}`);
  const data = await response.json() as T & { code?: number; msg?: string };
  if (typeof data === 'object' && data !== null && data.code !== undefined && data.code !== 0) {
    throw new Error(`Feishu app GET code=${data.code} msg=${data.msg ?? ''}`);
  }
  return data;
}
