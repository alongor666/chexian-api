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

import { execFileSync } from 'node:child_process';

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

/**
 * 台账白名单：B314 拆分后仍入库、且随日常发布变动的追踪文件（2419ed）。
 * data-sources.json 状态字段已拆出（B314）、field-coverage-report.json 已迁出 git（2419ed），
 * 均不在此列。
 */
export const LEDGER_TRACKED_FILES = [
  '数据管理/ledger/etl-ledger.jsonl',
  '数据管理/knowledge/QUICK_REFERENCE.md',
];

/**
 * 台账未提交体量判定（纯函数）——2419ed 防累积撞 PR 体量门禁。
 * 背景：auto-release 每日发布会更新上述入库台账文件但不自动 commit（自动 push 机制过重，
 * 见 2419ed 取舍），累积 diff 搭车他人 PR 曾撞 2000 行体量门禁。阈值 300 行 ≈ 2-3 周累积。
 *
 * @param {object} p
 * @param {Array<{path: string, added: number, deleted: number}>} p.files 各台账文件未提交 diff 行数
 * @param {number} [p.thresholdLines=300] 提醒阈值（新增+删除行合计）
 * @returns {{level: 'ok'|'warn', totalLines: number, message: string}}
 */
export function evaluateLedgerUncommittedBulk({ files, thresholdLines = 300 }) {
  const totalLines = (files || []).reduce((sum, f) => sum + (f.added || 0) + (f.deleted || 0), 0);
  if (totalLines > thresholdLines) {
    const detail = (files || []).filter((f) => (f.added || 0) + (f.deleted || 0) > 0)
      .map((f) => `${f.path} +${f.added}/-${f.deleted}`).join('；');
    return {
      level: 'warn',
      totalLines,
      message: `台账文件未提交 diff 累积 ${totalLines} 行（阈值 ${thresholdLines}）：${detail}——请尽快单独 chore commit 清空（git add <台账文件> && git commit），避免搭车其他 PR 撞体量门禁`,
    };
  }
  return { level: 'ok', totalLines, message: `台账未提交 diff ${totalLines} 行（阈值 ${thresholdLines} 内）` };
}

/**
 * governance 检查主体「台账未提交体量」（2419ed）——实现在本模块，
 * check-governance.mjs 只注册（H5 单体棘轮 4000 行上限，新检查不进单体）。
 *
 * --numstat 相对 HEAD（含已暂存+未暂存）；CI 工作区干净天然 0 行不误报。
 * core.quotepath=off：中文路径原样输出，避免 warn 明细出现八进制转义。
 *
 * @param {object} p
 * @param {string} p.rootDir 仓库根目录
 * @param {(m: string) => void} p.info
 * @param {(m: string) => void} p.success
 * @param {(m: string) => void} p.warning
 * @returns {boolean} 恒 true（warn 级提醒，不阻断 governance；2419ed 取舍：自动 push 机制过重）
 */
export function runLedgerUncommittedBulkCheck({ rootDir, info, success, warning }) {
  info('检查台账文件未提交体量（2419ed 防累积撞 PR 体量门禁）...');
  let out;
  try {
    out = execFileSync('git', ['-c', 'core.quotepath=off', 'diff', '--numstat', 'HEAD', '--', ...LEDGER_TRACKED_FILES], {
      cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    warning('git diff 不可用（无 git 环境），跳过台账体量检查');
    return true;
  }
  const files = out.split('\n').filter(Boolean).map((line) => {
    const [added, deleted, ...rest] = line.split('\t');
    return { path: rest.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 };
  });
  const { level, message } = evaluateLedgerUncommittedBulk({ files });
  if (level === 'ok') {
    success(message);
  } else {
    warning(message);
  }
  return true;
}
