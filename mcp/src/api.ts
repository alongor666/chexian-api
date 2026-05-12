/**
 * MCP server 内部 HTTP 客户端
 * 比 CLI 简化：所有错误转为 MCP 工具调用错误（throw Error），无重试 UI 提示。
 */
export interface McpConfig {
  baseUrl: string;
  token: string;
}

export function loadMcpConfig(): McpConfig {
  const baseUrl = process.env.CX_BASE_URL || 'https://chexian.cretvalu.com';
  const token = process.env.CX_PAT;
  if (!token) {
    throw new Error('Missing CX_PAT env variable. Set it in Claude Desktop mcpServers config.');
  }
  if (!token.startsWith('cx_pat_')) {
    throw new Error('CX_PAT must start with cx_pat_');
  }
  return { baseUrl, token };
}

export async function mcpGet<T = unknown>(
  cfg: McpConfig,
  routePath: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(routePath.startsWith('http') ? routePath : `${cfg.baseUrl}${routePath}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return (await res.json()) as T;
}
