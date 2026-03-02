/**
 * 路由重定向状态统一契约。
 *
 * 仅使用 `fromPath` 传递跳转目标，避免历史上 string / location 对象混用导致的竞态。
 */

export interface RedirectState {
  fromPath: string;
}

const DEFAULT_FALLBACK_PATH = '/';

function normalizePath(path: string | null | undefined, fallback: string): string {
  if (!path || typeof path !== 'string') return fallback;
  const trimmed = path.trim();
  if (!trimmed) return fallback;
  if (trimmed === '/login') return fallback;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function tryExtractPath(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (typeof record.pathname === 'string') return record.pathname;
  if (typeof record.fromPath === 'string') return record.fromPath;
  if (typeof record.from === 'string') return record.from;
  if (record.from && typeof record.from === 'object') {
    const nested = record.from as Record<string, unknown>;
    if (typeof nested.pathname === 'string') return nested.pathname;
  }
  return null;
}

export function buildRedirectState(fromPath: string, fallback: string = DEFAULT_FALLBACK_PATH): RedirectState {
  return {
    fromPath: normalizePath(fromPath, fallback),
  };
}

export function resolveRedirectPath(
  state: unknown,
  fallback: string = DEFAULT_FALLBACK_PATH,
): string {
  const normalizedFallback = normalizePath(fallback, DEFAULT_FALLBACK_PATH);
  const candidate = tryExtractPath(state);
  return normalizePath(candidate, normalizedFallback);
}
