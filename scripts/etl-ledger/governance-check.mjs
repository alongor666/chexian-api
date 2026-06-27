/**
 * ETL 台账新鲜度判定（纯函数）——供 governance「防漏记」检查。
 * 设计：docs/plans/2026-06-27-etl-ledger-design.md §8.1
 *
 * 判据用「文件 mtime 对比」而非「事件 ts」：
 *   回填事件的 ts 是历史 commit 时间（最新仅到回填那天），用事件 ts 会误报；
 *   而 etl-ledger.jsonl 的文件 mtime 是「最近一次记账」的真实时刻。
 *   真实 ETL 会同时更新 data-sources.json 与 etl-ledger.jsonl 两个文件 mtime，
 *   只有埋点失效（写了 metadata 却没写台账）才会让 data-sources 显著新于台账 → 报警。
 */

/**
 * @param {object} p
 * @param {boolean} p.ledgerExists 台账文件是否存在
 * @param {number}  p.ledgerMtimeMs 台账文件 mtime（毫秒）
 * @param {number}  p.dataSourcesMtimeMs data-sources.json mtime（毫秒）
 * @param {number}  [p.thresholdHours=6] 允许的滞后阈值（小时）
 * @returns {{level: 'ok'|'warn', message: string}}
 */
export function evaluateLedgerFreshness({ ledgerExists, ledgerMtimeMs, dataSourcesMtimeMs, thresholdHours = 6 }) {
  if (!ledgerExists) {
    return { level: 'warn', message: 'ETL 台账不存在（数据管理/ledger/etl-ledger.jsonl）——尚未初始化或被删除' };
  }
  const lagHours = (dataSourcesMtimeMs - ledgerMtimeMs) / 3_600_000;
  if (lagHours > thresholdHours) {
    return {
      level: 'warn',
      message: `data-sources.json 比台账文件新 ${lagHours.toFixed(1)}h（阈值 ${thresholdHours}h）——疑似 ETL 更新了 metadata 但未写台账，请检查 daily.mjs 埋点是否生效`,
    };
  }
  return {
    level: 'ok',
    message: `ETL 台账新鲜（与 data-sources.json mtime 滞后 ${Math.max(0, lagHours).toFixed(1)}h 内）`,
  };
}
