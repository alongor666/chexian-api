import type { QueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';

/**
 * ETL 数据版本轮询（页面侧，替代 sw.js 内已废弃的版本检查）。
 *
 * 为什么在页面侧而不是 Service Worker 内（BACKLOG 2026-06-11-claude-ed63ec）：
 * 1. SW 内旧实现是"fetch 事件顺带触发"——生产 SW 活跃时 React Query
 *    staleTime=Infinity，不发请求 → fetch 事件不发生 → 检查永不执行；
 * 2. SW 内裸 fetch('/api/data/version') 不带登录凭证，而该接口挂 authMiddleware，
 *    生产实测恒 401 被静默吞掉——机制双重死亡。
 * 页面侧走 apiClient（自动带鉴权），用真正的定时器，二者皆解。
 *
 * 基线持久化到 localStorage：覆盖"ETL 更新后用户整页刷新，SW Cache Storage
 * 仍是旧版本（TTL 24h 未到）"的场景——刷新后首轮 tick 即可对比出版本变化并清缓存。
 */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
export const ETL_DATE_STORAGE_KEY = 'chexian:last-etl-date';

export interface EtlVersionPollerOptions {
  queryClient: QueryClient;
  /** 拉取当前 ETL 日期；失败（未登录 401/网络异常）返回 undefined 静默跳过本轮 */
  fetchEtlDate?: () => Promise<string | undefined>;
  intervalMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** 版本变化时通知 SW 清空 Cache Storage */
  notifySw?: () => void;
}

async function defaultFetchEtlDate(): Promise<string | undefined> {
  try {
    const v = await apiClient.data.version();
    return v.etlDate || undefined;
  } catch {
    // 未登录（401）或网络异常：不打扰用户，等下一轮
    return undefined;
  }
}

function defaultNotifySw(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: 'FORCE_REFRESH' });
  }
}

export function startEtlVersionPolling(options: EtlVersionPollerOptions): () => void {
  const {
    queryClient,
    fetchEtlDate = defaultFetchEtlDate,
    intervalMs = DEFAULT_INTERVAL_MS,
    storage = window.localStorage,
    notifySw = defaultNotifySw,
  } = options;

  let stopped = false;

  const tick = async (): Promise<void> => {
    const etlDate = await fetchEtlDate();
    if (stopped || !etlDate) return;

    let prev: string | null = null;
    try {
      prev = storage.getItem(ETL_DATE_STORAGE_KEY);
    } catch {
      // localStorage 不可用（隐私模式等）：退化为纯内存对比，不阻断轮询
    }

    if (prev && prev !== etlDate) {
      notifySw();
      void queryClient.invalidateQueries();
    }

    try {
      storage.setItem(ETL_DATE_STORAGE_KEY, etlDate);
    } catch {
      // 同上，写失败不阻断
    }
  };

  // 立即执行一轮：结合 localStorage 基线，覆盖整页刷新后的旧缓存场景
  void tick();
  const timer = window.setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
