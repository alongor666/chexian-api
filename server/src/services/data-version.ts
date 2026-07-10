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

/**
 * 版本变更作用域：
 *   - 'full'    — 核心数据（raw_parquet/PolicyFact）重载，监听者应全量重新预热
 *   - 'domains' — 仅辅助 full_snapshot 域（CustomerFlow/NewEnergyClaims）重载；
 *                 版本仍须 bump（route-cache key 与 deterministicEtag 都含版本号，
 *                 不 bump 会让持旧 ETag 的客户端永久 304 读不到新数据），
 *                 但监听者应跳过全量预热/立方体重建风暴
 */
export type DataVersionScope = 'full' | 'domains';

type VersionChangeListener = (next: string, previous: string, scope: DataVersionScope) => void | Promise<void>;

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
export function setDataVersion(fingerprint: string | null | undefined, scope: DataVersionScope = 'full'): void {
  if (!fingerprint) return;
  const next = fingerprint.slice(0, 8);
  if (!next || next === currentVersion) return;

  const previous = currentVersion;
  currentVersion = next;
  console.log(`[DataVersion] bumped: ${previous} → ${next} (scope=${scope})`);

  for (const listener of listeners) {
    Promise.resolve()
      .then(() => listener(next, previous, scope))
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

/**
 * 兜底 bump：当无法计算确定性指纹（如 stat 失败、单文件无指纹通道）时，
 * 用时间戳 + 随机后缀强制产生新版本，保证 ETL/上传后 cache key 不再命中旧数据。
 *
 * 仅用于"不得不让缓存失效，但拿不到内容指纹"的场景。
 * 同一份数据多次调用会产生不同版本，因此**优先使用 setDataVersion(fingerprint)**。
 */
export function bumpDataVersionFromTimestamp(scope: DataVersionScope = 'full'): void {
  setDataVersion(makeTimestampVersionToken(), scope);
}

/**
 * 生成时间戳版本 token（纯函数，不改变当前版本）。
 *
 * 供「加载器计算 token、编排方在视图物化完成后统一 setDataVersion(token) 提交」
 * 的延迟提交模式使用（B311：version bump 必须晚于 PolicyFact 物化，
 * 否则监听者会预热查询中间态视图）。
 */
export function makeTimestampVersionToken(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${ts}${rnd}`.padEnd(8, '0');
}

export function _resetDataVersionForTesting(): void {
  currentVersion = 'init0000';
  listeners.length = 0;
}
