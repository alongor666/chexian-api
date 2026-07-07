/**
 * ETL 台账新鲜度判定（纯函数）——供 governance「防漏记」检查。
 * 设计：docs/plans/2026-06-27-etl-ledger-design.md §8.1
 *
 * 判据用「文件 mtime 对比」而非「事件 ts」：
 *   回填事件的 ts 是历史 commit 时间（最新仅到回填那天），用事件 ts 会误报；
 *   而 etl-ledger.jsonl 的文件 mtime 是「最近一次记账」的真实时刻。
 *   真实 ETL 会同时更新 data-sources-status.json 与 etl-ledger.jsonl 两个文件 mtime，
 *   只有埋点失效（写了状态却没写台账）才会让 data-sources-status 显著新于台账 → 报警。
 *
 * B314 契约/状态拆分后（2026-07）：mtime 判据的对比对象由 data-sources.json 换成
 * data-sources-status.json——拆分后 ETL 只动 status 文件的 mtime，若仍对比契约文件
 * mtime（契约不再随每日 ETL 变化），本检查会退化成永远不报警的死检查。
 *
 * 三态判定（新签名 evaluateLedgerFreshness）：
 *   - 台账、状态文件均不存在 → ok（干净环境，尚无 ETL 活动，不应误报）
 *   - 台账不存在、状态文件存在 → warn（有 ETL 状态却没有台账——疑似漏记/被删）
 *   - 台账存在、状态文件不存在 → warn（拆分后尚未跑首轮 ETL，或状态文件被误删；
 *     提示跑一次 ETL 即可自动生成）
 *   - 两者都存在 → 按 mtime 差值与阈值比较
 */


/**
 * @param {object} p
 * @param {boolean} p.ledgerExists 台账文件是否存在
 * @param {number}  [p.ledgerMtimeMs] 台账文件 mtime（毫秒）
 * @param {boolean} p.statusExists data-sources-status.json 是否存在
 * @param {number}  [p.statusMtimeMs] data-sources-status.json mtime（毫秒）
 * @param {number}  [p.thresholdHours=6] 允许的滞后阈值（小时）
 * @returns {{level: 'ok'|'warn', message: string}}
 */
export function evaluateLedgerFreshness({ ledgerExists, ledgerMtimeMs, statusExists, statusMtimeMs, thresholdHours = 6 }) {
  if (!ledgerExists && !statusExists) {
    return { level: 'ok', message: 'ETL 台账与状态文件均不存在（干净环境，尚无 ETL 活动）' };
  }
  if (!ledgerExists && statusExists) {
    return {
      level: 'warn',
      message: 'ETL 台账不存在（数据管理/ledger/etl-ledger.jsonl），但 data-sources-status.json 已存在——疑似漏记或台账被删',
    };
  }
  if (ledgerExists && !statusExists) {
    return {
      level: 'warn',
      message: 'data-sources-status.json 不存在（数据管理/data-sources-status.json）——拆分后尚未跑首轮 ETL，或状态文件被误删；跑一次 node 数据管理/daily.mjs 后自动生成',
    };
  }
  const lagHours = (statusMtimeMs - ledgerMtimeMs) / 3_600_000;
  if (lagHours > thresholdHours) {
    return {
      level: 'warn',
      message: `data-sources-status.json 比台账文件新 ${lagHours.toFixed(1)}h（阈值 ${thresholdHours}h）——疑似 ETL 更新了状态但未写台账，请检查 daily.mjs 埋点是否生效`,
    };
  }
  return {
    level: 'ok',
    message: `ETL 台账新鲜（与 data-sources-status.json mtime 滞后 ${Math.max(0, lagHours).toFixed(1)}h 内）`,
  };
}
