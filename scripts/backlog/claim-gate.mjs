/**
 * claim / release 状态转移判定（纯函数，供 backlog.mjs cmdClaim/cmdRelease 与单测共用）。
 *
 * 抽成纯函数的动机（同 drift-dismissal.mjs）：防重复派发是这套认领机制的**核心闸**，
 * 判定本体必须能脱离文件副作用（appendFileSync）被直接测到——否则只能靠端到端跑命令
 * 间接覆盖，回归时看不清是哪条转移规则被破坏。
 *
 * 转移规则：
 *   claim   —— 仅当任务处于「可认领」态（非 DOING/IN_PROGRESS 的活跃态）才放行；
 *             已 DOING/IN_PROGRESS（有人在做）或终态 → 拒绝（fail-closed，杜绝两人认领同一任务）。
 *   release —— 仅撤回 claim 产生的 DOING（退回 PROPOSED）；IN_PROGRESS/PARTIAL 是实质进展态，
 *             用正常 status 流转，不被 release 简单退回。
 */

/** claim 时视为「已被认领/在做、不可再认领」的活跃状态 */
export const CLAIM_BLOCKED_ACTIVE = Object.freeze(['DOING', 'IN_PROGRESS']);

/**
 * @param {object|null} task 折叠后的任务对象（须含 status；owner 可选，仅用于文案）
 * @param {string[]} terminalStatuses 终态集合（DONE/CANCELLED/WONTFIX，由调用方注入 SSOT）
 * @returns {{ allowed: boolean, code?: string, reason?: string }}
 *   code: 'no-task' | 'already-claimed' | 'terminal'
 */
export function evaluateClaim(task, terminalStatuses = []) {
  if (!task) return { allowed: false, code: 'no-task', reason: '任务不存在' };
  if (CLAIM_BLOCKED_ACTIVE.includes(task.status)) {
    return {
      allowed: false,
      code: 'already-claimed',
      reason: `已被认领/在做（${task.status}，owner: ${task.owner || '—'}）`,
    };
  }
  if (terminalStatuses.includes(task.status)) {
    return { allowed: false, code: 'terminal', reason: `已是终态 ${task.status}` };
  }
  return { allowed: true };
}

/**
 * @param {object|null} task 折叠后的任务对象（须含 status）
 * @returns {{ allowed: boolean, code?: string, reason?: string }}
 *   code: 'no-task' | 'not-doing'
 */
export function evaluateRelease(task) {
  if (!task) return { allowed: false, code: 'no-task', reason: '任务不存在' };
  if (task.status !== 'DOING') {
    return {
      allowed: false,
      code: 'not-doing',
      reason: `当前 ${task.status}，非认领态（DOING）`,
    };
  }
  return { allowed: true };
}
