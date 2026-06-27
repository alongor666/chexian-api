/**
 * ETL 全链路数据流转台账 — 记录器。
 *
 * 设计：docs/plans/2026-06-27-etl-ledger-design.md
 * 真相源：数据管理/ledger/etl-ledger.jsonl（每行一个 JSON 事件，append-only，merge=union）。
 *
 * RED LINE：recordEvent 全程 try/catch，记账失败一律吞掉返回 null，
 * 绝不抛出、绝不阻断 ETL / 发布主流程（数据发布优先级 > 记账）。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 模块在 scripts/etl-ledger/ 下，../.. = 项目根
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** 台账真相源默认路径 */
export const LEDGER_PATH = join(PROJECT_ROOT, '数据管理/ledger/etl-ledger.jsonl');

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
export function recordEvent(event, { ledgerPath = LEDGER_PATH, noMkdir = false } = {}) {
  try {
    // 不可变：用展开构造新对象，event 的显式字段覆盖缺省值
    const enriched = {
      ts: localIsoNow(),
      run_id: process.env.ETL_RUN_ID || 'adhoc',
      status: 'success',
      backfilled: false,
      ...event,
    };
    if (!noMkdir) mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, JSON.stringify(enriched) + '\n', 'utf8');
    return enriched;
  } catch (e) {
    console.warn(`[etl-ledger] 记账失败（不阻断主流程）: ${e?.message ?? e}`);
    return null;
  }
}
