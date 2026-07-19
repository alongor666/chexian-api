/**
 * ETL 全链路数据流转台账 — 记录器。
 *
 * 设计：docs/plans/2026-06-27-etl-ledger-design.md
 * 真相源：数据管理/ledger/etl-ledger.jsonl（封存历史）+
 * 数据管理/ledger/events/YYYY-MM.jsonl（月度 append-only，merge=union）。
 *
 * RED LINE：recordEvent 全程 try/catch，记账失败一律吞掉返回 null，
 * 绝不抛出、绝不阻断 ETL / 发布主流程（数据发布优先级 > 记账）。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 模块在 scripts/etl-ledger/ 下，../.. = 项目根
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** 台账目录与封存历史。LEDGER_PATH 保留为兼容别名，新事件不再写入该热点文件。 */
export const LEDGER_ROOT = join(PROJECT_ROOT, '数据管理/ledger');
export const LEGACY_LEDGER_PATH = join(LEDGER_ROOT, 'etl-ledger.jsonl');
export const LEDGER_EVENTS_DIR = join(LEDGER_ROOT, 'events');
export const LEDGER_PATH = LEGACY_LEDGER_PATH;

/** 根据带时区 ISO 时间戳选择月度分片；无法解析时回退北京时间当前月。 */
export function monthlyLedgerPath(ts = localIsoNow()) {
  const match = String(ts).match(/^(\d{4}-\d{2})-/);
  const month = match?.[1] ?? localIsoNow().slice(0, 7);
  return join(LEDGER_EVENTS_DIR, `${month}.jsonl`);
}

/** 按稳定顺序列出封存历史 + 月度分片，供报告、分析和治理读侧聚合。 */
export function listLedgerPaths({ legacyPath = LEGACY_LEDGER_PATH, eventsDir = LEDGER_EVENTS_DIR } = {}) {
  const paths = existsSync(legacyPath) ? [legacyPath] : [];
  if (!existsSync(eventsDir)) return paths;
  const monthly = readdirSync(eventsDir)
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))
    .sort()
    .map((name) => join(eventsDir, name));
  return [...paths, ...monthly];
}

/**
 * 生成本地时区（+08:00）的 ISO 时间戳。
 * @param {Date} [d] 可注入（便于测试）；默认当前时刻
 * @returns {string} 形如 2026-06-27T08:00:00.000+08:00
 */
export function localIsoNow(d = new Date()) {
  const local = new Date(d.getTime() + 8 * 3600 * 1000);
  return local.toISOString().replace('Z', '+08:00');
}

/**
 * 追加一笔流转事件到台账。失败返回 null（不抛、不阻断主流程）。
 *
 * @param {object} event 事件字段（stage/step/domain/status/row_count/... 见设计文档 §5）
 * @param {object} [opts]
 * @param {string} [opts.ledgerPath] 覆盖台账路径（测试用）
 * @param {boolean} [opts.noMkdir] 跳过建目录（测试写失败路径用）
 * @returns {object|null} 写入的完整事件，失败则 null
 */
export function recordEvent(event, { ledgerPath, noMkdir = false } = {}) {
  try {
    // 不可变：用展开构造新对象，event 的显式字段覆盖缺省值
    const enriched = {
      ts: localIsoNow(),
      run_id: process.env.ETL_RUN_ID || 'adhoc',
      status: 'success',
      backfilled: false,
      ...event,
    };
    const targetPath = ledgerPath ?? monthlyLedgerPath(enriched.ts);
    if (!noMkdir) mkdirSync(dirname(targetPath), { recursive: true });
    appendFileSync(targetPath, JSON.stringify(enriched) + '\n', 'utf8');
    return enriched;
  } catch (e) {
    console.warn(`[etl-ledger] 记账失败（不阻断主流程）: ${e?.message ?? e}`);
    return null;
  }
}
