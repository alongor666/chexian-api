/**
 * 数据版本服务
 *
 * 维护一个 8 字符版本字符串，绑定到当前 raw_parquet 表的内容指纹。
 * 用于：
 *   - route-cache key 的版本后缀（ETL 完成后旧 key 自然不再被命中，由 LRU 淘汰）
 *   - ETag 提前计算（不需要执行 SQL 即可返回 304）
 *
 * 由 duckdb-parquet-loader 在加载完成后调用 setDataVersion(fingerprint) 更新。
 * 启动初始为占位值 'init0000'，加载完成后切换。
 */

type VersionChangeListener = (next: string, previous: string) => void | Promise<void>;

let currentVersion = 'init0000';
const listeners: VersionChangeListener[] = [];

export function getDataVersion(): string {
  return currentVersion;
}

/**
 * 从 Parquet 指纹（SHA-256 hex）派生 8 字符版本号。
 * 取前 8 字符即可保证「数据未变 → 版本不变」的一一映射，
 * 同时让 cache key 紧凑、便于日志诊断。
 *
 * 版本变更时异步通知所有监听者（如 cache-warmer 预热新版本 key）。
 */
export function setDataVersion(fingerprint: string | null | undefined): void {
  if (!fingerprint) return;
  const next = fingerprint.slice(0, 8);
  if (!next || next === currentVersion) return;

  const previous = currentVersion;
  currentVersion = next;
  console.log(`[DataVersion] bumped: ${previous} → ${next}`);

  for (const listener of listeners) {
    Promise.resolve()
      .then(() => listener(next, previous))
      .catch((err) => console.warn('[DataVersion] listener error:', err));
  }
}

/**
 * 注册版本变更监听者。每次 setDataVersion() 触发新版本时异步调用。
 * 用法：app.ts 在 bootstrap 前注册，cache-warmer 在版本变更后重新预热。
 */
export function onDataVersionChange(listener: VersionChangeListener): void {
  listeners.push(listener);
}

export function _resetDataVersionForTesting(): void {
  currentVersion = 'init0000';
  listeners.length = 0;
}
